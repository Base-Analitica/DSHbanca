import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import {
  createAnalysisCheckpoint,
  nextAnalysisBatch,
} from "../src/lib/analysis_checkpoint"

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
}

function writeProjectConfig(
  root: string,
  opts?: {
    chapters?: string[]
    maxCharactersPerBatch?: number
    main?: string
  },
): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(
    join(root, ".banca", "project.json"),
    JSON.stringify({
      version: 1,
      manuscript: {
        format: "latex",
        root: ".",
        main: opts?.main ?? "main.tex",
        bib: "refs.bib",
        chapters: opts?.chapters ?? ["capitulos/*.tex"],
        outputDir: "trabalhos",
      },
      compile: { enabled: false, command: [] },
      allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
      protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
      immutableFacts: [],
      externalDependencies: [],
      rubricProfile: "banca-rigorosa",
      targetScore: 9.0,
      mcp: { crossrefAcademicEnabled: false },
      analysis: {
        coverageMode: "exhaustive",
        maxCharactersPerBatch: opts?.maxCharactersPerBatch ?? 50_000,
      },
    }),
    "utf-8",
  )
}

function listContextPacks(projectRoot: string): string[] {
  const ctxDir = join(projectRoot, ".banca", "context")
  if (!existsSync(ctxDir)) return []
  return readdirSync(ctxDir)
    .filter((n) => n.startsWith("context-") && n.endsWith(".md"))
    .map((n) => join(ctxDir, n))
}

function parseMetadata(packBody: string): Record<string, unknown> {
  const match = packBody.match(/```json\n([\s\S]*?)\n```/)
  expect(match).not.toBeNull()
  return JSON.parse(match![1]) as Record<string, unknown>
}

function extractLatexChunks(packBody: string): string[] {
  const chunks: string[] = []
  const re = /```latex\n([\s\S]*?)\n```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(packBody)) !== null) {
    chunks.push(m[1])
  }
  return chunks
}

describe("banca_context — canonical exhaustive first batch", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ob-banca-context-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("nested include + complementary chapter: pack has first batch order and exact text", async () => {
    // main → outer → inner; complementary chapter not in main graph
    writeTree(projectRoot, {
      "main.tex": `\\documentclass{article}
\\begin{document}
MAIN-HEAD
\\input{chapters/outer}
MAIN-TAIL
\\end{document}
`,
      "chapters/outer.tex": `OUTER-BEFORE
\\input{inner}
OUTER-AFTER
`,
      "chapters/inner.tex": "INNER-BODY\n",
      "capitulos/extra.tex": "COMPLEMENT-CHAPTER\n",
    })
    writeProjectConfig(projectRoot, {
      chapters: ["capitulos/*.tex"],
      maxCharactersPerBatch: 50_000,
    })

    const { bancaContext } = await import("../src/tools/banca_context")
    const result = await bancaContext.execute(
      { projectRoot },
      { directory: projectRoot } as any,
    )

    expect(typeof result).toBe("string")
    expect(result).toMatch(/^context → /)
    const packPath = String(result).replace(/^context → /, "")
    expect(packPath.startsWith(join(projectRoot, ".banca", "context"))).toBe(true)
    expect(existsSync(packPath)).toBe(true)

    const body = readFileSync(packPath, "utf-8")
    const meta = parseMetadata(body)

    // Expected via same public APIs (oracle), not a reimplementation of planning.
    const config = loadConfig(projectRoot)
    const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
    const plan = planExhaustiveAnalysisBatches(
      manuscript,
      config.analysis.maxCharactersPerBatch,
    )
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBe(1)
    const checkpoint = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, checkpoint)
    expect(first).not.toBeNull()

    expect((meta.manuscript as any).fingerprint).toBe(plan.fingerprint)
    expect((meta.plan as any).strategy).toBe("ordered-source-spans-exhaustive-v1")
    expect((meta.plan as any).planId).toBe(checkpoint.planId)
    expect((meta.checkpoint as any).planId).toBe(checkpoint.planId)
    expect((meta.batch as any).batchId).toBe(first!.batchId)
    expect((meta.batch as any).index).toBe(0)
    expect((meta.batch as any).totalBatches).toBe(1)
    expect((meta.batch as any).characters).toBe(first!.characters)

    const latexChunks = extractLatexChunks(body)
    expect(latexChunks).toEqual(first!.chunks.map((c) => c.text))
    // Nested + complementary order from loader
    const joined = latexChunks.join("")
    expect(joined).toContain("MAIN-HEAD")
    expect(joined).toContain("INNER-BODY")
    expect(joined).toContain("OUTER-BEFORE")
    expect(joined).toContain("COMPLEMENT-CHAPTER")
    // Order: main head before outer before inner before complement
    expect(joined.indexOf("MAIN-HEAD")).toBeLessThan(joined.indexOf("OUTER-BEFORE"))
    expect(joined.indexOf("OUTER-BEFORE")).toBeLessThan(joined.indexOf("INNER-BODY"))
    expect(joined.indexOf("INNER-BODY")).toBeLessThan(joined.indexOf("COMPLEMENT-CHAPTER"))

    const chunkMeta = meta.chunks as Array<Record<string, unknown>>
    expect(chunkMeta.length).toBe(first!.chunks.length)
    for (let i = 0; i < first!.chunks.length; i++) {
      expect(chunkMeta[i].file).toBe(first!.chunks[i].source.file)
      expect(chunkMeta[i].startLine).toBe(first!.chunks[i].source.startLine)
      expect(chunkMeta[i].endLine).toBe(first!.chunks[i].source.endLine)
      expect(chunkMeta[i].startOffset).toBe(first!.chunks[i].source.startOffset)
      expect(chunkMeta[i].endOffset).toBe(first!.chunks[i].source.endOffset)
      expect(pathIsPublic(String(chunkMeta[i].file))).toBe(true)
    }

    expect(body.includes(resolve(projectRoot))).toBe(false)
  })

  test("document larger than maxCharactersPerBatch: multi-batch metadata, first batch only, no extra truncation", async () => {
    // Build text long enough to force >1 batch at limit 40.
    const pad = "ABCDEFGHIJ" // 10 chars
    const bodyA = pad.repeat(6) // 60
    const bodyB = pad.repeat(5) // 50
    writeTree(projectRoot, {
      "main.tex": `\\input{a}
\\input{b}
`,
      "a.tex": bodyA,
      "b.tex": bodyB,
    })
    writeProjectConfig(projectRoot, {
      chapters: [],
      maxCharactersPerBatch: 40,
    })

    const config = loadConfig(projectRoot)
    const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
    const plan = planExhaustiveAnalysisBatches(
      manuscript,
      config.analysis.maxCharactersPerBatch,
    )
    expect(plan.status).toBe("complete")
    expect(plan.coverage.batchCount).toBeGreaterThan(1)
    const checkpoint = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, checkpoint)!
    expect(first.index).toBe(0)
    expect(first.characters).toBeLessThanOrEqual(40)
    // Full first-batch text length equals sum of chunk texts (no silent truncation).
    const exactFirstText = first.chunks.map((c) => c.text).join("")
    expect(exactFirstText.length).toBe(first.characters)

    const { bancaContext } = await import("../src/tools/banca_context")
    const result = await bancaContext.execute(
      { projectRoot },
      { directory: projectRoot } as any,
    )
    const packPath = String(result).replace(/^context → /, "")
    const body = readFileSync(packPath, "utf-8")
    const meta = parseMetadata(body)

    expect((meta.plan as any).batchCount).toBe(plan.coverage.batchCount)
    expect((meta.batch as any).totalBatches).toBe(plan.coverage.batchCount)
    expect((meta.batch as any).batchId).toBe(first.batchId)
    expect((meta.batch as any).index).toBe(0)
    expect((meta.batch as any).characters).toBe(first.characters)

    const latexChunks = extractLatexChunks(body)
    expect(latexChunks).toEqual(first.chunks.map((c) => c.text))
    // Entire first batch present with no additional .slice truncation
    expect(latexChunks.join("")).toBe(exactFirstText)
    // Later batch content must not appear as full later batches in the pack body
    // (chunks from batch index > 0 should not be listed under first batch).
    const laterTexts = plan.batches
      .slice(1)
      .flatMap((b) => b.chunks.map((c) => c.text))
    // Some later fragments could theoretically substring-overlap; assert that
    // the concatenated pack latex equals only the first batch.
    expect(latexChunks.join("")).not.toBe(
      plan.batches.flatMap((b) => b.chunks.map((c) => c.text)).join(""),
    )
    // And pack character total for first batch matches metadata.
    expect(latexChunks.join("").length).toBe(first.characters)

    // Sanity: at least one later unique segment is absent when long enough
    for (const t of laterTexts) {
      if (t.length >= 10 && !exactFirstText.includes(t)) {
        expect(body.includes(`\`\`\`latex\n${t}\n\`\`\``)).toBe(false)
      }
    }

    expect(body.includes(resolve(projectRoot))).toBe(false)
  })

  test("incomplete ingestion (missing include) does not create a valid complete pack", async () => {
    writeTree(projectRoot, {
      "main.tex": `HEAD
\\input{missing-chapter}
TAIL
`,
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 1000 })

    const before = listContextPacks(projectRoot)
    expect(before).toEqual([])

    // Oracle: canonical plan diagnostics for the same incomplete manuscript.
    const config = loadConfig(projectRoot)
    const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
    const plan = planExhaustiveAnalysisBatches(
      manuscript,
      config.analysis.maxCharactersPerBatch,
    )
    expect(plan.status).toBe("blocked")
    expect(plan.diagnostics.length).toBeGreaterThan(0)

    const { bancaContext } = await import("../src/tools/banca_context")
    const result = await bancaContext.execute(
      { projectRoot },
      { directory: projectRoot } as any,
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("context blocked")
    expect(result).toContain("status=blocked")
    expect(result).not.toMatch(/^context → /)
    // No pack file that looks complete
    expect(listContextPacks(projectRoot)).toEqual([])

    // Blocked output surfaces canonical diagnostic codes/messages without a pack.
    // Provenance (file/target) stays public/relative on the plan diagnostics;
    // the consumer only summarizes code+message and must not rewrite paths.
    let sawFile = false
    let sawTarget = false
    for (const d of plan.diagnostics) {
      expect(String(result)).toContain(d.code)
      expect(String(result)).toContain(d.message)
      if (d.file !== undefined) {
        sawFile = true
        expect(pathIsPublic(d.file)).toBe(true)
        expect(d.file.includes(resolve(projectRoot))).toBe(false)
        expect(d.file.includes(projectRoot)).toBe(false)
      }
      if (d.target !== undefined) {
        sawTarget = true
        // Include targets are relative manuscript refs (e.g. missing-chapter), not abs paths.
        expect(d.target.includes(resolve(projectRoot))).toBe(false)
        expect(d.target.startsWith("/")).toBe(false)
        expect(/^[A-Za-z]:/.test(d.target)).toBe(false)
      }
    }
    expect(sawFile).toBe(true)
    expect(sawTarget).toBe(true)
    // Absolute temporary project path must not leak into the blocked message.
    expect(String(result).includes(resolve(projectRoot))).toBe(false)
    expect(String(result).includes(projectRoot)).toBe(false)
  })

  test("complete empty manuscript → success with zero batches and 100% coverage", async () => {
    writeTree(projectRoot, {
      "main.tex": "",
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 100 })

    const { bancaContext } = await import("../src/tools/banca_context")
    const result = await bancaContext.execute(
      { projectRoot },
      { directory: projectRoot } as any,
    )

    expect(result).toMatch(/^context → /)
    const packPath = String(result).replace(/^context → /, "")
    const body = readFileSync(packPath, "utf-8")
    const meta = parseMetadata(body)

    expect((meta.plan as any).status).toBe("complete")
    expect((meta.plan as any).batchCount).toBe(0)
    expect((meta.plan as any).coveragePercent).toBe(100)
    expect((meta.checkpoint as any).state).toBe("complete")
    expect((meta.checkpoint as any).totalBatches).toBe(0)
    expect((meta.checkpoint as any).coveragePercent).toBe(100)
    expect((meta.batch as any).batchId).toBeNull()
    expect((meta.batch as any).totalBatches).toBe(0)
    expect((meta.batch as any).characters).toBe(0)
    expect((meta.batch as any).initialCoveragePercent).toBe(100)
    expect(meta.chunks).toEqual([])
    expect(body).toContain("zero batches")
    expect(body.includes(resolve(projectRoot))).toBe(false)
  })

  test("absolute temp project path never appears in pack content", async () => {
    writeTree(projectRoot, {
      "main.tex": "\\begin{document}\nHello path leak check.\n\\end{document}\n",
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 500 })

    const { bancaContext } = await import("../src/tools/banca_context")
    const result = await bancaContext.execute(
      { projectRoot },
      { directory: projectRoot } as any,
    )
    const packPath = String(result).replace(/^context → /, "")
    const body = readFileSync(packPath, "utf-8")
    const abs = resolve(projectRoot)
    expect(body.includes(abs)).toBe(false)
    // Metadata chunk files must be public relative paths
    const meta = parseMetadata(body)
    for (const c of meta.chunks as Array<{ file: string }>) {
      expect(pathIsPublic(c.file)).toBe(true)
      expect(c.file.includes(abs)).toBe(false)
    }
  })

  test("optional scorecard.md and knowledge.md are included without altering canonical metadata", async () => {
    writeTree(projectRoot, {
      "main.tex": "ONLY-CANONICAL-BODY\n",
      ".banca/scorecard.md": "# Scorecard\nscore: 7.5\n",
      ".banca/knowledge.md": "# Knowledge\nnote about domain\n",
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 500 })

    const config = loadConfig(projectRoot)
    const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
    const plan = planExhaustiveAnalysisBatches(
      manuscript,
      config.analysis.maxCharactersPerBatch,
    )
    const checkpoint = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, checkpoint)!

    const { bancaContext } = await import("../src/tools/banca_context")
    const result = await bancaContext.execute(
      { projectRoot },
      { directory: projectRoot } as any,
    )
    const packPath = String(result).replace(/^context → /, "")
    const body = readFileSync(packPath, "utf-8")
    const meta = parseMetadata(body)

    // Canonical identity unchanged vs oracle without scorecard/knowledge
    expect((meta.manuscript as any).fingerprint).toBe(plan.fingerprint)
    expect((meta.plan as any).planId).toBe(checkpoint.planId)
    expect((meta.batch as any).batchId).toBe(first.batchId)
    expect(extractLatexChunks(body)).toEqual(first.chunks.map((c) => c.text))

    // Optional files still present in pack
    expect(body).toContain("# Scorecard")
    expect(body).toContain("score: 7.5")
    expect(body).toContain("# Knowledge")
    expect(body).toContain("note about domain")

    // Optional section appears after canonical batch section
    const batchPos = body.indexOf("## First exhaustive batch")
    const statePos = body.indexOf("## Project state")
    expect(batchPos).toBeGreaterThan(-1)
    expect(statePos).toBeGreaterThan(batchPos)
  })

  test("production tool does not use resolveManuscriptPaths, direct chapter FS reads, or slice(0, 1500)", async () => {
    // Structural/source contract for the shipped tool module.
    const src = readFileSync(
      join(import.meta.dir, "../src/tools/banca_context.ts"),
      "utf-8",
    )
    expect(src).not.toContain("resolveManuscriptPaths")
    expect(src).not.toContain(".slice(0, 1500)")
    expect(src).not.toContain("sanitizeDiagnosticText")
    expect(src).not.toContain("sanitizeDiagnostics")
    expect(src).toContain("loadCanonicalLatexManuscript")
    expect(src).toContain("planExhaustiveAnalysisBatches")
    expect(src).toContain("createAnalysisCheckpoint")
    expect(src).toContain("nextAnalysisBatch")
    expect(src).toContain("maxCharactersPerBatch")
    // Diagnostics are a shallow copy of the canonical plan — no consumer sanitization.
    expect(src).toMatch(/plan\.diagnostics\.map\(\s*\(?d\)?\s*=>\s*\(\s*\{\s*\.\.\.d\s*\}\s*\)/)
    // No chapter loop over paths.chapters
    expect(src).not.toMatch(/paths\.chapters/)
    // No direct .tex chapter iteration for context body
    expect(src).not.toMatch(/readFileSync\([^)]*\.tex/)
  })

  test("writes only under .banca/context and does not persist checkpoint/findings", async () => {
    writeTree(projectRoot, {
      "main.tex": "persist-check body\n",
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 500 })

    const { bancaContext } = await import("../src/tools/banca_context")
    await bancaContext.execute({ projectRoot }, { directory: projectRoot } as any)

    const packs = listContextPacks(projectRoot)
    expect(packs.length).toBe(1)
    // No checkpoint or findings artifacts introduced
    expect(existsSync(join(projectRoot, ".banca", "checkpoint.json"))).toBe(false)
    expect(existsSync(join(projectRoot, ".banca", "findings.json"))).toBe(false)
    expect(existsSync(join(projectRoot, ".banca", "analysis-checkpoint.json"))).toBe(
      false,
    )
    // Only context dir under .banca besides project.json
    const bancaEntries = readdirSync(join(projectRoot, ".banca"))
    expect(bancaEntries.sort()).toEqual(["context", "project.json"].sort())
  })
})

function pathIsPublic(file: string): boolean {
  if (file.length === 0) return false
  if (file.startsWith("/")) return false
  if (/^[A-Za-z]:/.test(file)) return false
  if (file.includes("\\")) return false
  if (file.split("/").includes("..")) return false
  return true
}
