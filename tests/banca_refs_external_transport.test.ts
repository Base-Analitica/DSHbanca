import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as childProcess from "node:child_process"
import { McpClient } from "../src/lib/mcp_client"
import { RefCache } from "../src/lib/cache"

describe("banca_refs external transport confinement (Issue #29)", () => {
  let projectDir: string
  let originalFetch: typeof globalThis.fetch
  let fetchCalls: Array<{ url: string; options?: any }>
  let mcpStartSpy: any
  let spawnSpy: any

  beforeEach(() => {
    projectDir = join(tmpdir(), `dshbanca-refs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(projectDir, ".banca", "cache"), { recursive: true })

    writeFileSync(
      join(projectDir, ".banca", "project.json"),
      JSON.stringify({
        version: 1,
        manuscript: {
          format: "latex",
          root: ".",
          main: "main.tex",
          bib: "referencias.bib",
          chapters: [],
          outputDir: "trabalhos",
        },
        mcp: {
          crossrefAcademicEnabled: false,
        },
      }),
      "utf-8",
    )

    writeFileSync(
      join(projectDir, "main.tex"),
      "\\documentclass{article}\\begin{document}\\cite{silva2024}\\end{document}",
      "utf-8",
    )

    writeFileSync(
      join(projectDir, "referencias.bib"),
      `@article{silva2024,
  author = {Silva, Joao},
  title = {Pesquisa Academica e Integridade},
  year = {2024},
  doi = {10.1000/182}
}`,
      "utf-8",
    )

    fetchCalls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input)
      fetchCalls.push({ url, options: init })
      return new Response(JSON.stringify({ message: { items: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }) as any

    mcpStartSpy = spyOn(McpClient.prototype, "start").mockImplementation(async function(this: any) {
      throw new Error("mocked McpClient.start: unauthorized MCP client startup detected")
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mcpStartSpy.mockRestore()
    delete process.env.OPENBANCA_ENABLE_CROSSREF_MCP
    delete process.env.DSHBANCA_ENABLE_CROSSREF_MCP
    try {
      rmSync(projectDir, { recursive: true, force: true })
    } catch {}
  })

  test("zero REST fetch and zero MCP spawn on uncached references", async () => {
    const { bancaRefs } = await import("../src/tools/banca_refs")
    const result = await bancaRefs.execute({ projectRoot: projectDir }, { directory: projectDir } as any)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(String(result)).toContain("blocked: external reference provider is not available in DSH")
    expect(String(result)).toContain("Blocked (external provider unavailable): 1")
  })

  test("zero McpClient start even when legacy OPENBANCA_ENABLE_CROSSREF_MCP=1 is set", async () => {
    process.env.OPENBANCA_ENABLE_CROSSREF_MCP = "1"
    writeFileSync(
      join(projectDir, ".banca", "project.json"),
      JSON.stringify({
        version: 1,
        manuscript: {
          format: "latex",
          root: ".",
          main: "main.tex",
          bib: "referencias.bib",
          chapters: [],
          outputDir: "trabalhos",
        },
        mcp: {
          crossrefAcademicEnabled: true,
        },
      }),
      "utf-8",
    )

    const { bancaRefs } = await import("../src/tools/banca_refs")
    const result = await bancaRefs.execute({ projectRoot: projectDir }, { directory: projectDir } as any)

    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(fetchCalls.length).toBe(0)
    expect(String(result)).toContain("blocked: external reference provider is not available in DSH")
  })

  test("local cache validation works deterministically with zero network and zero spawn", async () => {
    const cache = new RefCache(projectDir)
    cache.set("silva2024", "10.1000/182", {
      key: "silva2024",
      found: true,
      score: 95,
      status: "verificada",
      matchedBy: "doi",
      metadata: {
        key: "silva2024",
        title: "Pesquisa Academica e Integridade",
        authors: ["Silva, Joao"],
        year: 2024,
        doi: "10.1000/182",
      },
      evidence: "Verified via pre-seeded cache entry",
    })

    const { bancaRefs } = await import("../src/tools/banca_refs")
    const result = await bancaRefs.execute({ projectRoot: projectDir }, { directory: projectDir } as any)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(String(result)).not.toContain("blocked:")
    expect(String(result)).toContain("Verified: 1")
    expect(String(result)).toContain("cache=1")
    expect(String(result)).toContain("Avg Score: 95/100")
  })

  test("mixed bib file: cached entries verify, uncached entries fail-closed without inventing metadata", async () => {
    writeFileSync(
      join(projectDir, "referencias.bib"),
      `@article{cached2023,
  author = {Souza, Maria},
  title = {Trabalho em Cache},
  year = {2023},
  doi = {10.1000/100}
}
@article{uncached2024,
  author = {Pereira, Carlos},
  title = {Trabalho Nao Cacheado},
  year = {2024},
  doi = {10.1000/200}
}`,
      "utf-8",
    )

    const cache = new RefCache(projectDir)
    cache.set("cached2023", "10.1000/100", {
      key: "cached2023",
      found: true,
      score: 95,
      status: "verificada",
      matchedBy: "doi",
      metadata: {
        key: "cached2023",
        title: "Trabalho em Cache",
        authors: ["Souza, Maria"],
        year: 2023,
        doi: "10.1000/100",
      },
      evidence: "Verified via pre-seeded cache",
    })

    const { bancaRefs } = await import("../src/tools/banca_refs")
    const result = await bancaRefs.execute({ projectRoot: projectDir }, { directory: projectDir } as any)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(String(result)).toContain("blocked: external reference provider is not available in DSH")
    expect(String(result)).toContain("Verified: 1")
    expect(String(result)).toContain("Blocked (external provider unavailable): 1")
    expect(String(result)).toContain("cache=1")
    expect(String(result)).toContain("none=1")
  })
})
