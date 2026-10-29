import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as childProcess from "node:child_process"
import { McpClient } from "../src/lib/mcp_client"
import { RefCache } from "../src/lib/cache"

describe("banca_refs external transport and academic classification (Issue #29)", () => {
  let projectDir: string
  let originalFetch: typeof globalThis.fetch
  let fetchCalls: Array<{ url: string; options?: any }>
  let mcpStartSpy: any

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

  test("Cenário A: single uncached ref must be blocked, not counted as Not found, and Avg Score must not be 0/100", async () => {
    const { bancaRefs } = await import("../src/tools/banca_refs")
    const result = await bancaRefs.execute({ projectRoot: projectDir }, { directory: projectDir } as any)
    const text = String(result)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(text).toContain("blocked: external reference provider is not available in DSH")
    expect(text).toContain("Blocked (external provider unavailable): 1")
    expect(text).not.toContain("Not found:")
    expect(text).not.toContain("Avg Score: 0/100")
    expect(text).toContain("Avg Score: N/A")
  })

  test("Cenário B: mixed cached and blocked refs excludes blocked from average and from Not found", async () => {
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
    const text = String(result)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(text).toContain("blocked: external reference provider is not available in DSH")
    expect(text).toContain("Verified: 1")
    expect(text).toContain("Blocked (external provider unavailable): 1")
    expect(text).not.toContain("Not found:")
    expect(text).not.toContain("Avg Score: 47/100")
    expect(text).not.toContain("Avg Score: 48/100")
    expect(text).toContain("Avg Score: 95/100")
    expect(text).toContain("Evaluated: 1/2")
  })

  test("Cenário C: all cached references verify without blocked status and with consistent average", async () => {
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
    const text = String(result)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    expect(text).not.toContain("blocked:")
    expect(text).toContain("Verified: 1")
    expect(text).toContain("cache=1")
    expect(text).toContain("Avg Score: 95/100")
    expect(text).toContain("Evaluated: 1/1")
  })

  test("RED reproduction: verified ref with 'blocked' in evidence string must not be classified as blocked", async () => {
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
      evidence: "Verified by human after previous lookup was blocked",
    })

    const { bancaRefs } = await import("../src/tools/banca_refs")
    const result = await bancaRefs.execute({ projectRoot: projectDir }, { directory: projectDir } as any)
    const text = String(result)

    expect(fetchCalls.length).toBe(0)
    expect(mcpStartSpy).not.toHaveBeenCalled()
    // Must NOT contain global blocked warning
    expect(text).not.toContain("blocked:")
    expect(text).not.toContain("Blocked (external provider unavailable)")
    expect(text).toContain("Verified: 1")
    expect(text).toContain("Evaluated: 1/1")
    expect(text).toContain("Avg Score: 95/100")
  })

  test("Cenário D: legacy OPENBANCA_ENABLE_CROSSREF_MCP triggers zero MCP spawn and zero fetch", async () => {
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
})
