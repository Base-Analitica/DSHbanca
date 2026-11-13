import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { basename, dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { bancaRefs } from "../src/tools/banca_refs"
import { RefCache } from "../src/lib/cache"
import { McpClient } from "../src/lib/mcp_client"
import { PathTraversalError } from "../src/lib/safe_paths"
import type { RefMetadata } from "../src/lib/academic"

// ---------------------------------------------------------------------------
// Hermetic regression for the `banca_refs` consumer of parseBibtex
// (issue #111). Synthetic workspaces only; no network, MCP, model or external
// transport is reachable from this file by design.
// ---------------------------------------------------------------------------

const BIB_FILE = "referencias.bib"
const REPORT_DIR = ".banca/reports"

const ISSUE_BIB = `@article{exemplo,
  title = {Estudo da {ABNT} no {Brasil}},
  author = {Gon{\\c{c}}alves},
  journal = "Revista",
  year = {2026},
  doi = "10.1000/issue111",
}
`

const MALFORMED_BIB = "@article{quebrada,\n  title = {A},\n"

function projectConfig(bib = BIB_FILE) {
  return {
    version: 1,
    manuscript: { format: "latex", root: ".", main: "main.tex", bib, chapters: [], outputDir: "trabalhos" },
    mcp: { crossrefAcademicEnabled: false },
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

describe("banca_refs — BibTeX consumer regression (Issue #111)", () => {
  let roots: string[]
  let originalFetch: typeof globalThis.fetch
  let fetchCalls: string[]
  let mcpStartSpy: ReturnType<typeof spyOn>
  let extraFiles: string[]

  function makeProject(bib: string | null = ISSUE_BIB): string {
    const root = mkdtempSync(join(tmpdir(), "dshbanca-refs-bibtex-"))
    roots.push(root)
    mkdirSync(join(root, ".banca", "cache"), { recursive: true })
    writeFileSync(join(root, ".banca", "project.json"), JSON.stringify(projectConfig()), "utf-8")
    if (bib !== null) writeFileSync(join(root, BIB_FILE), bib, "utf-8")
    return root
  }

  function writeConfig(root: string, bib: string): void {
    writeFileSync(join(root, ".banca", "project.json"), JSON.stringify(projectConfig(bib)), "utf-8")
  }

  function reports(root: string): string[] {
    const dir = join(root, REPORT_DIR)
    return existsSync(dir) ? readdirSync(dir) : []
  }

  async function runRefs(root: string): Promise<string> {
    const result = await bancaRefs.execute({ projectRoot: root }, { directory: root } as any)
    return String(result)
  }

  beforeEach(() => {
    roots = []
    extraFiles = []
    fetchCalls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any) => {
      fetchCalls.push(typeof input === "string" ? input : String(input))
      throw new Error("network access is not allowed in hermetic banca_refs tests")
    }) as any
    mcpStartSpy = spyOn(McpClient.prototype, "start").mockImplementation(async function (this: any) {
      throw new Error("mocked McpClient.start: unauthorized MCP client startup detected")
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mcpStartSpy.mockRestore()
    for (const file of extraFiles) {
      try {
        rmSync(file, { force: true })
      } catch {}
    }
    for (const root of roots) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {}
    }
  })

  test("delivers complete parsed metadata to the reference-cache boundary", async () => {
    const root = makeProject()
    const captured: RefMetadata[] = []
    const getSpy = spyOn(RefCache.prototype, "get").mockImplementation((ref: RefMetadata) => {
      captured.push(ref)
      return null
    })

    try {
      const text = await runRefs(root)

      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        key: "exemplo",
        title: "Estudo da {ABNT} no {Brasil}",
        authors: ["Gon{\\c{c}}alves"],
        year: 2026,
        doi: "10.1000/issue111",
        journal: "Revista",
      })

      // No native DSH provider exists, so the uncached reference stays blocked
      // and is never reported as "not found" or as verified.
      expect(text).toContain("blocked: external reference provider is not available in DSH")
      expect(text).toContain("only local cache was checked")
      expect(text).toContain("Blocked (external provider unavailable): 1")
      expect(text).not.toContain("Not found:")
      expect(fetchCalls).toHaveLength(0)
      expect(mcpStartSpy).not.toHaveBeenCalled()
    } finally {
      getSpy.mockRestore()
    }
  })

  test("verifies a cached reference by the DOI parsed from a quoted value", async () => {
    const root = makeProject()
    new RefCache(root).set("catalogo-remoto", "10.1000/issue111", {
      key: "catalogo-remoto",
      found: true,
      score: 95,
      status: "verificada",
      matchedBy: "doi",
      metadata: {
        key: "catalogo-remoto",
        title: "Estudo da {ABNT} no {Brasil}",
        authors: ["Gon{\\c{c}}alves"],
        year: 2026,
        doi: "10.1000/issue111",
      },
      evidence: "Verified via pre-seeded cache entry",
    })

    const text = await runRefs(root)

    // The cache entry is stored under a different key; only the DOI parsed from
    // the quoted field can match it.
    expect(text).not.toContain("blocked:")
    expect(text).toContain("Verified: 1")
    expect(text).toContain("cache=1")
    expect(text).toContain("Evaluated: 1/1")
    expect(text).toContain("Avg Score: 95/100")
    expect(fetchCalls).toHaveLength(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
  })

  test("keeps an uncached reference explicitly blocked instead of inventing validation", async () => {
    const root = makeProject()

    const text = await runRefs(root)

    expect(text.startsWith("blocked: external reference provider is not available in DSH")).toBe(true)
    expect(text).toContain("Blocked (external provider unavailable): 1")
    expect(text).toContain("Verified: 0")
    expect(text).toContain("Avg Score: N/A")
    expect(text).not.toContain("Not found:")
    expect(fetchCalls).toHaveLength(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
  })

  test("fails closed with an identifiable parse error for a malformed bib", async () => {
    const root = makeProject(MALFORMED_BIB)
    const bibPath = join(root, BIB_FILE)
    const bibHash = sha256(bibPath)
    let cacheGets = 0
    const getSpy = spyOn(RefCache.prototype, "get").mockImplementation(() => {
      cacheGets++
      return null
    })

    try {
      const text = await runRefs(root)

      expect(text.startsWith("bib parse error:")).toBe(true)
      expect(text).toContain("BibTeX malformed")
      expect(text).toMatch(/line \d+/)
      expect(text).not.toContain("no entries found in bib file")
      expect(text).not.toContain("References:")
      expect(text).not.toContain("blocked:")
      expect(cacheGets).toBe(0)
      expect(reports(root)).toEqual([])
      expect(sha256(bibPath)).toBe(bibHash)
      expect(fetchCalls).toHaveLength(0)
      expect(mcpStartSpy).not.toHaveBeenCalled()
    } finally {
      getSpy.mockRestore()
    }
  })

  test("rejects a file with a valid entry followed by a malformed one without partial report", async () => {
    const root = makeProject(`@article{valida,
  title = {Entrada válida},
}
@article{quebrada,
  title = {Entrada sem fechamento}
`)

    const text = await runRefs(root)

    expect(text.startsWith("bib parse error:")).toBe(true)
    expect(text).not.toContain("References: 1")
    expect(reports(root)).toEqual([])
    expect(fetchCalls).toHaveLength(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
  })

  test("distinguishes parse error from missing and empty bib files", async () => {
    const missingRoot = makeProject(null)
    const missingText = await runRefs(missingRoot)
    expect(missingText.startsWith("bib not found: ")).toBe(true)

    const emptyRoot = makeProject("")
    const emptyText = await runRefs(emptyRoot)
    expect(emptyText).toBe("no entries found in bib file")

    const commentOnlyRoot = makeProject("% arquivo sintético sem referências\n")
    const commentOnlyText = await runRefs(commentOnlyRoot)
    expect(commentOnlyText).toBe("no entries found in bib file")

    const invalidRoot = makeProject(MALFORMED_BIB)
    const invalidText = await runRefs(invalidRoot)
    expect(invalidText.startsWith("bib parse error:")).toBe(true)

    expect(new Set([missingText, emptyText, invalidText]).size).toBe(3)
    expect(fetchCalls).toHaveLength(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
  })

  test("preserves original files and existing path containment guard", async () => {
    // Success path: only a report under .banca/reports is written; the bib and
    // project config stay byte-identical.
    const root = makeProject()
    const bibPath = join(root, BIB_FILE)
    const configPath = join(root, ".banca", "project.json")
    const bibHash = sha256(bibPath)
    const configHash = sha256(configPath)

    await runRefs(root)

    expect(sha256(bibPath)).toBe(bibHash)
    expect(sha256(configPath)).toBe(configHash)
    const reportFiles = reports(root)
    expect(reportFiles).toHaveLength(1)
    const reportText = readFileSync(join(root, REPORT_DIR, reportFiles[0]), "utf-8")
    expect(reportText).toContain("Reference Validation")

    // Path guard: a bibliography path escaping the workspace is rejected before
    // any read, even when the outside file exists.
    const traversalRoot = makeProject()
    const outsidePath = join(dirname(traversalRoot), `outside-${basename(traversalRoot)}.bib`)
    extraFiles.push(outsidePath)
    writeFileSync(outsidePath, ISSUE_BIB, "utf-8")
    const outsideHash = sha256(outsidePath)
    writeConfig(traversalRoot, `../${basename(outsidePath)}`)

    await expect(runRefs(traversalRoot)).rejects.toThrow(PathTraversalError)
    expect(sha256(outsidePath)).toBe(outsideHash)
    expect(reports(traversalRoot)).toEqual([])
    expect(fetchCalls).toHaveLength(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
  })
})
