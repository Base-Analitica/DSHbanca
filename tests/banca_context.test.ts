import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  readdirSync,
  symlinkSync,
  lstatSync,
  realpathSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve, relative } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import {
  createAnalysisCheckpoint,
  completeAnalysisBatch,
  nextAnalysisBatch,
  type AnalysisCheckpoint,
} from "../src/lib/analysis_checkpoint"
import {
  getAnalysisCheckpointRelativePath,
  loadAnalysisCheckpoint,
} from "../src/lib/state"

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

function listCheckpointFiles(projectRoot: string): string[] {
  const dir = join(projectRoot, ".banca", "analysis", "checkpoints")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !n.startsWith("."))
    .map((n) => join(dir, n))
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

function pathIsPublic(file: string): boolean {
  if (file.length === 0) return false
  if (file.startsWith("/")) return false
  if (/^[A-Za-z]:/.test(file)) return false
  if (file.includes("\\")) return false
  if (file.split("/").includes("..")) return false
  return true
}

function planOracle(projectRoot: string) {
  const config = loadConfig(projectRoot)
  const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
  const plan = planExhaustiveAnalysisBatches(
    manuscript,
    config.analysis.maxCharactersPerBatch,
  )
  return { config, manuscript, plan }
}

function readPersistedCheckpoint(
  projectRoot: string,
  planId: string,
): AnalysisCheckpoint {
  const rel = getAnalysisCheckpointRelativePath(planId)
  const abs = join(projectRoot, ...rel.split("/"))
  expect(existsSync(abs)).toBe(true)
  const raw = readFileSync(abs, "utf-8")
  expect(raw.includes(resolve(projectRoot))).toBe(false)
  expect(raw).not.toMatch(/(^|[\s"'])(\/tmp\/|\/home\/|\/var\/)/)
  return JSON.parse(raw) as AnalysisCheckpoint
}

function writeMultiBatchProject(projectRoot: string, maxChars = 40): void {
  // Two long files force >1 batch at a small budget.
  const pad = "ABCDEFGHIJ" // 10
  writeTree(projectRoot, {
    "main.tex": `\\input{a}
\\input{b}
`,
    "a.tex": pad.repeat(6), // 60
    "b.tex": pad.repeat(5), // 50
  })
  writeProjectConfig(projectRoot, {
    chapters: [],
    maxCharactersPerBatch: maxChars,
  })
}

async function runContext(
  projectRoot: string,
  opts?: { completedBatchId?: string },
): Promise<string> {
  const { bancaContext } = await import("../src/tools/banca_context")
  return String(
    await bancaContext.execute(
      {
        projectRoot,
        ...(opts?.completedBatchId !== undefined
          ? { completedBatchId: opts.completedBatchId }
          : {}),
      },
      { directory: projectRoot } as any,
    ),
  )
}

/**
 * Run bancaContext in a real child process (true process boundary).
 * Distinguish omission (no opts) from present empty string via explicit opts.
 */
function runContextInChildProcess(
  projectRoot: string,
  opts?: { completedBatchId?: string },
): string {
  const repoRoot = join(import.meta.dir, "..")
  const toolPath = join(import.meta.dir, "../src/tools/banca_context.ts")
  const scriptPath = join(projectRoot, `_run_context_child_${process.pid}_${Date.now()}.ts`)
  const hasCompleted =
    opts !== undefined && Object.prototype.hasOwnProperty.call(opts, "completedBatchId")
  writeFileSync(
    scriptPath,
    `
import { bancaContext } from ${JSON.stringify(toolPath)};
const projectRoot = ${JSON.stringify(projectRoot)};
const hasCompleted = ${JSON.stringify(hasCompleted)};
const completedBatchId = ${JSON.stringify(hasCompleted ? opts!.completedBatchId : null)};
const args = hasCompleted
  ? { projectRoot, completedBatchId: completedBatchId as string }
  : { projectRoot };
const result = await bancaContext.execute(args, { directory: projectRoot } as any);
process.stdout.write(String(result));
`,
    "utf-8",
  )
  try {
    const r = spawnSync("bun", ["run", scriptPath], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: process.env,
      timeout: 60_000,
    })
    if (r.error) {
      throw r.error
    }
    if (r.status !== 0) {
      throw new Error(
        `child process failed: status=${r.status} stderr=${r.stderr ?? ""} stdout=${r.stdout ?? ""}`,
      )
    }
    return r.stdout ?? ""
  } finally {
    try {
      rmSync(scriptPath, { force: true })
    } catch {
      // ignore cleanup failure
    }
  }
}

function packBodyFromResult(result: string): string {
  expect(result).toMatch(/^context → /)
  const packPath = result.replace(/^context → /, "")
  return readFileSync(packPath, "utf-8")
}

function assertNoAbsolutePathLeak(text: string, projectRoot: string): void {
  const abs = resolve(projectRoot)
  expect(text.includes(abs)).toBe(false)
  expect(text).not.toMatch(/(^|[\s"'`=])(\/tmp\/|\/home\/|\/var\/|\/Users\/)/)
}

describe("banca_context — checkpoint persistence and resume", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ob-banca-context-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("1) initial execution creates exactly the checkpoint for the current plan", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBeGreaterThan(1)
    const expected = createAnalysisCheckpoint(plan)

    const result = await runContext(projectRoot)
    expect(result).toMatch(/^context → /)

    const files = listCheckpointFiles(projectRoot)
    expect(files).toHaveLength(1)
    expect(files[0].endsWith(`${expected.planId}.json`)).toBe(true)

    const disk = readPersistedCheckpoint(projectRoot, expected.planId)
    // Oracle: disk equals public createAnalysisCheckpoint for this plan.
    expect(disk).toEqual(expected)
    expect(disk.state).toBe("pending")
    expect(disk.completedBatches).toBe(0)

    const body = packBodyFromResult(result)
    const meta = parseMetadata(body)
    expect((meta.checkpoint as any).planId).toBe(expected.planId)
    expect((meta.checkpoint as any).state).toBe("pending")
    expect((meta.checkpoint as any).path).toBe(
      getAnalysisCheckpointRelativePath(expected.planId),
    )
    expect((meta.checkpoint as any).persisted).toBe(true)
    expect((meta.batch as any).index).toBe(0)
    expect(body).toContain("## Next exhaustive batch")
    expect(body).not.toContain("## First exhaustive batch")
  })

  test("2) resume without completedBatchId returns the same next batch and counters", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const expected = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, expected)!

    await runContext(projectRoot)
    const disk1 = readPersistedCheckpoint(projectRoot, expected.planId)

    const result2 = await runContext(projectRoot)
    const disk2 = readPersistedCheckpoint(projectRoot, expected.planId)
    expect(disk2).toEqual(disk1)
    expect(disk2.completedBatches).toBe(0)

    const meta = parseMetadata(packBodyFromResult(result2))
    expect((meta.batch as any).batchId).toBe(first.batchId)
    expect((meta.batch as any).index).toBe(0)
    expect((meta.checkpoint as any).completedBatches).toBe(0)
  })

  test("3) completing the first batch advances to an intermediate next batch", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.batches.length).toBeGreaterThanOrEqual(2)
    const initial = createAnalysisCheckpoint(plan)
    const firstId = plan.batches[0].batchId

    await runContext(projectRoot)
    const result = await runContext(projectRoot, { completedBatchId: firstId })
    expect(result).toMatch(/^context → /)

    const expectedAfter = completeAnalysisBatch(plan, initial, firstId)
    const disk = readPersistedCheckpoint(projectRoot, initial.planId)
    expect(disk).toEqual(expectedAfter)
    expect(disk.state).toBe("running")
    expect(disk.completedBatches).toBe(1)

    const next = nextAnalysisBatch(plan, disk)!
    expect(next.index).toBe(1)
    const meta = parseMetadata(packBodyFromResult(result))
    expect((meta.batch as any).batchId).toBe(next.batchId)
    expect((meta.batch as any).index).toBe(1)
    expect((meta.checkpoint as any).completedBatches).toBe(1)
    expect((meta.checkpoint as any).coveragePercent).toBe(disk.coveragePercent)
  })

  test("4) resume across a real process boundary (spawn child)", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const initial = createAnalysisCheckpoint(plan)
    const firstId = plan.batches[0].batchId

    // Process A: create checkpoint on disk.
    const createOut = runContextInChildProcess(projectRoot)
    expect(createOut).toMatch(/^context → /)

    // Process B: advance first batch (separate OS process).
    const advanceOut = runContextInChildProcess(projectRoot, {
      completedBatchId: firstId,
    })
    expect(advanceOut).toMatch(/^context → /)

    const fromDisk = readPersistedCheckpoint(projectRoot, initial.planId)
    expect(fromDisk.completedBatches).toBe(1)
    const expectedNext = nextAnalysisBatch(plan, fromDisk)!

    // Process C: resume without advancing — must read the same checkpoint from disk.
    const resumeOut = runContextInChildProcess(projectRoot)
    expect(resumeOut).toMatch(/^context → /)
    const meta = parseMetadata(packBodyFromResult(resumeOut))
    expect((meta.batch as any).batchId).toBe(expectedNext.batchId)
    expect((meta.batch as any).index).toBe(expectedNext.index)
    expect((meta.checkpoint as any).completedBatches).toBe(1)
    expect(readPersistedCheckpoint(projectRoot, initial.planId)).toEqual(fromDisk)
  })

  test("5) completing the last batch yields complete / 100% / no next batch", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    let cp = createAnalysisCheckpoint(plan)

    await runContext(projectRoot)
    for (const batch of plan.batches) {
      const result = await runContext(projectRoot, {
        completedBatchId: batch.batchId,
      })
      cp = completeAnalysisBatch(plan, cp, batch.batchId)
      const disk = readPersistedCheckpoint(projectRoot, cp.planId)
      expect(disk).toEqual(cp)

      if (batch === plan.batches[plan.batches.length - 1]) {
        expect(result).toMatch(/^context → /)
        const body = packBodyFromResult(result)
        const meta = parseMetadata(body)
        expect((meta.checkpoint as any).state).toBe("complete")
        expect((meta.checkpoint as any).coveragePercent).toBe(100)
        expect((meta.checkpoint as any).completedBatches).toBe(plan.batches.length)
        expect((meta.batch as any).batchId).toBeNull()
        expect(nextAnalysisBatch(plan, disk)).toBeNull()
        expect(body).toContain("## Checkpoint coverage complete")
        expect(body).not.toContain("## Exhaustive analysis complete")
        expect(body).toContain("No next batch")
        expect(body).toContain("does not prove model run, findings, or academic analysis")
      }
    }
  })

  test("6) re-completing an already finished batch is idempotent", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const firstId = plan.batches[0].batchId

    await runContext(projectRoot)
    await runContext(projectRoot, { completedBatchId: firstId })
    const afterFirst = readPersistedCheckpoint(
      projectRoot,
      createAnalysisCheckpoint(plan).planId,
    )

    // Repeat the same completed batchId
    const result = await runContext(projectRoot, { completedBatchId: firstId })
    expect(result).toMatch(/^context → /)
    const again = readPersistedCheckpoint(projectRoot, afterFirst.planId)
    expect(again).toEqual(afterFirst)
    expect(again.completedBatches).toBe(1)

    const oracle = completeAnalysisBatch(plan, afterFirst, firstId)
    expect(again).toEqual(oracle)

    const meta = parseMetadata(packBodyFromResult(result))
    expect((meta.batch as any).index).toBe(1)
  })

  test("7) unknown or out-of-order batch fails without mutating the file", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = createAnalysisCheckpoint(plan).planId
    const futureId = plan.batches[1].batchId

    await runContext(projectRoot)
    const before = readFileSync(
      join(projectRoot, ".banca", "analysis", "checkpoints", `${planId}.json`),
      "utf-8",
    )

    const unknown = await runContext(projectRoot, {
      completedBatchId: "batch-does-not-exist",
    })
    expect(unknown).toContain("context checkpoint error")
    expect(unknown).toContain("code=unknown_batch")
    expect(unknown).not.toMatch(/^context → /)
    const afterUnknown = readFileSync(
      join(projectRoot, ".banca", "analysis", "checkpoints", `${planId}.json`),
      "utf-8",
    )
    expect(afterUnknown).toBe(before)

    const ooo = await runContext(projectRoot, { completedBatchId: futureId })
    expect(ooo).toContain("context checkpoint error")
    expect(ooo).toContain("code=out_of_order")
    const afterOoo = readFileSync(
      join(projectRoot, ".banca", "analysis", "checkpoints", `${planId}.json`),
      "utf-8",
    )
    expect(afterOoo).toBe(before)
  })

  test("8) malformed or tampered checkpoint fails without overwrite", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = createAnalysisCheckpoint(plan).planId
    await runContext(projectRoot)

    const abs = join(
      projectRoot,
      ".banca",
      "analysis",
      "checkpoints",
      `${planId}.json`,
    )
    const good = readFileSync(abs, "utf-8")

    // Malformed JSON
    writeFileSync(abs, "{not-json", "utf-8")
    const malformed = await runContext(projectRoot)
    expect(malformed).toContain("context checkpoint error")
    expect(malformed).toContain("code=invalid_checkpoint")
    expect(readFileSync(abs, "utf-8")).toBe("{not-json")

    // Restore good, then tamper counters
    writeFileSync(abs, good, "utf-8")
    const parsed = JSON.parse(good) as AnalysisCheckpoint
    parsed.completedBatches = 99
    parsed.completedCharacters = 1
    writeFileSync(abs, JSON.stringify(parsed, null, 2), "utf-8")
    const tamperedRaw = readFileSync(abs, "utf-8")

    const tampered = await runContext(projectRoot)
    expect(tampered).toContain("context checkpoint error")
    expect(readFileSync(abs, "utf-8")).toBe(tamperedRaw)
  })

  test("9) manuscript change yields a new planId file without reusing old progress", async () => {
    writeMultiBatchProject(projectRoot)
    const firstPlan = planOracle(projectRoot).plan
    const firstId = createAnalysisCheckpoint(firstPlan).planId
    await runContext(projectRoot)
    await runContext(projectRoot, {
      completedBatchId: firstPlan.batches[0].batchId,
    })
    const progressed = readPersistedCheckpoint(projectRoot, firstId)
    expect(progressed.completedBatches).toBe(1)

    // Alter manuscript → new plan identity
    writeFileSync(join(projectRoot, "a.tex"), "ZZZZZZZZZZ".repeat(6), "utf-8")
    const secondPlan = planOracle(projectRoot).plan
    const secondId = createAnalysisCheckpoint(secondPlan).planId
    expect(secondId).not.toBe(firstId)

    const result = await runContext(projectRoot)
    expect(result).toMatch(/^context → /)

    const files = listCheckpointFiles(projectRoot)
    expect(files.some((f) => f.endsWith(`${firstId}.json`))).toBe(true)
    expect(files.some((f) => f.endsWith(`${secondId}.json`))).toBe(true)

    // Old progress untouched
    expect(readPersistedCheckpoint(projectRoot, firstId).completedBatches).toBe(1)
    // New plan starts pending at batch 0
    const fresh = readPersistedCheckpoint(projectRoot, secondId)
    expect(fresh).toEqual(createAnalysisCheckpoint(secondPlan))
    const meta = parseMetadata(packBodyFromResult(result))
    expect((meta.checkpoint as any).planId).toBe(secondId)
    expect((meta.batch as any).index).toBe(0)
  })

  test("10) blocked plan does not create a valid checkpoint file", async () => {
    writeTree(projectRoot, {
      "main.tex": `HEAD
\\input{missing-chapter}
TAIL
`,
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 1000 })

    const result = await runContext(projectRoot)
    expect(result).toContain("context blocked")
    expect(result).toContain("status=blocked")
    expect(listContextPacks(projectRoot)).toEqual([])
    expect(listCheckpointFiles(projectRoot)).toEqual([])
    expect(
      existsSync(join(projectRoot, ".banca", "analysis", "checkpoints")),
    ).toBe(false)
    expect(String(result).includes(resolve(projectRoot))).toBe(false)
  })

  test("11) empty complete document → complete / zero batches / 100%", async () => {
    writeTree(projectRoot, { "main.tex": "" })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 100 })

    const { plan } = planOracle(projectRoot)
    const expected = createAnalysisCheckpoint(plan)
    expect(expected.state).toBe("complete")
    expect(expected.totalBatches).toBe(0)
    expect(expected.coveragePercent).toBe(100)

    const result = await runContext(projectRoot)
    expect(result).toMatch(/^context → /)
    const disk = readPersistedCheckpoint(projectRoot, expected.planId)
    expect(disk).toEqual(expected)
    expect(nextAnalysisBatch(plan, disk)).toBeNull()

    const body = packBodyFromResult(result)
    const meta = parseMetadata(body)
    expect((meta.checkpoint as any).state).toBe("complete")
    expect((meta.checkpoint as any).coveragePercent).toBe(100)
    expect((meta.batch as any).batchId).toBeNull()
    expect(body).toContain("zero batches")
    expect(body).toContain("## Checkpoint coverage complete")
    expect(body).not.toContain("## Exhaustive analysis complete")
    expect(body).toContain("does not prove model run, findings, or academic analysis")
  })

  test("empty completedBatchId returns invalid_batch_id and leaves disk unchanged", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = createAnalysisCheckpoint(plan).planId

    await runContext(projectRoot)
    const before = readFileSync(
      join(projectRoot, ".banca", "analysis", "checkpoints", `${planId}.json`),
      "utf-8",
    )

    const empty = await runContext(projectRoot, { completedBatchId: "" })
    expect(empty).toContain("context checkpoint error")
    expect(empty).toContain("code=invalid_batch_id")
    expect(empty).not.toMatch(/^context → /)
    assertNoAbsolutePathLeak(empty, projectRoot)

    const after = readFileSync(
      join(projectRoot, ".banca", "analysis", "checkpoints", `${planId}.json`),
      "utf-8",
    )
    expect(after).toBe(before)
  })

  test("12) refuses symlink directory or checkpoint target file (live and broken)", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = createAnalysisCheckpoint(plan).planId

    // --- Live symlink as the checkpoints directory ---
    const bancaAnalysis = join(projectRoot, ".banca", "analysis")
    mkdirSync(bancaAnalysis, { recursive: true })
    const outside = mkdtempSync(join(tmpdir(), "ob-cp-outside-"))
    try {
      symlinkSync(outside, join(bancaAnalysis, "checkpoints"))
      expect(lstatSync(join(bancaAnalysis, "checkpoints")).isSymbolicLink()).toBe(
        true,
      )

      const result = await runContext(projectRoot)
      expect(result).toContain("context checkpoint error")
      expect(result).toContain("code=symlink_refused")
      // Nothing valid under the real outside dir as a project checkpoint
      expect(listCheckpointFiles(projectRoot)).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }

    // --- Live symlink as the checkpoint target file ---
    rmSync(join(projectRoot, ".banca", "analysis"), { recursive: true, force: true })
    await runContext(projectRoot)
    const abs = join(
      projectRoot,
      ".banca",
      "analysis",
      "checkpoints",
      `${planId}.json`,
    )
    const good = readFileSync(abs, "utf-8")
    rmSync(abs)
    const decoy = join(projectRoot, "decoy-checkpoint.json")
    writeFileSync(decoy, good, "utf-8")
    symlinkSync(decoy, abs)
    expect(lstatSync(abs).isSymbolicLink()).toBe(true)

    const beforeDecoy = readFileSync(decoy, "utf-8")
    const blocked = await runContext(projectRoot, {
      completedBatchId: plan.batches[0].batchId,
    })
    expect(blocked).toContain("context checkpoint error")
    expect(blocked).toContain("code=symlink_refused")
    // Symlink target content unchanged (no silent overwrite through the link)
    expect(readFileSync(decoy, "utf-8")).toBe(beforeDecoy)
    // Link itself still a symlink (not replaced by a regular JSON file)
    expect(lstatSync(abs).isSymbolicLink()).toBe(true)

    // --- Broken symlink as the checkpoint target file ---
    // existsSync is false for dangling links; storage must still refuse and not rename over it.
    rmSync(abs)
    const danglingTarget = join(projectRoot, "missing-decoy-never-created.json")
    expect(existsSync(danglingTarget)).toBe(false)
    symlinkSync(danglingTarget, abs)
    expect(lstatSync(abs).isSymbolicLink()).toBe(true)
    expect(existsSync(abs)).toBe(false) // dangling: existsSync false, lstat true

    const brokenFileResume = await runContext(projectRoot)
    expect(brokenFileResume).toContain("context checkpoint error")
    expect(brokenFileResume).toContain("code=symlink_refused")
    expect(lstatSync(abs).isSymbolicLink()).toBe(true)
    // Still not a regular checkpoint file
    expect(existsSync(abs)).toBe(false)

    const brokenFileAdvance = await runContext(projectRoot, {
      completedBatchId: plan.batches[0].batchId,
    })
    expect(brokenFileAdvance).toContain("context checkpoint error")
    expect(brokenFileAdvance).toContain("code=symlink_refused")
    expect(lstatSync(abs).isSymbolicLink()).toBe(true)

    // --- Broken symlink as the checkpoints directory ---
    rmSync(join(projectRoot, ".banca", "analysis"), { recursive: true, force: true })
    mkdirSync(bancaAnalysis, { recursive: true })
    const brokenDirLink = join(bancaAnalysis, "checkpoints")
    symlinkSync(join(projectRoot, "no-such-checkpoints-dir"), brokenDirLink)
    expect(lstatSync(brokenDirLink).isSymbolicLink()).toBe(true)
    expect(existsSync(brokenDirLink)).toBe(false)

    const brokenDirResult = await runContext(projectRoot)
    expect(brokenDirResult).toContain("context checkpoint error")
    expect(brokenDirResult).toContain("code=symlink_refused")
    // Link preserved; not replaced by a real directory with JSON
    expect(lstatSync(brokenDirLink).isSymbolicLink()).toBe(true)
    expect(listCheckpointFiles(projectRoot)).toEqual([])
  })

  test("13) no absolute paths in checkpoint JSON or pack content", async () => {
    writeMultiBatchProject(projectRoot)
    const result = await runContext(projectRoot)
    const body = packBodyFromResult(result)
    const abs = resolve(projectRoot)
    expect(body.includes(abs)).toBe(false)

    const meta = parseMetadata(body)
    const cpPath = String((meta.checkpoint as any).path)
    expect(pathIsPublic(cpPath)).toBe(true)
    expect(cpPath.startsWith(".banca/analysis/checkpoints/")).toBe(true)
    expect(cpPath.includes(abs)).toBe(false)

    for (const c of meta.chunks as Array<{ file: string }>) {
      expect(pathIsPublic(c.file)).toBe(true)
    }

    for (const f of listCheckpointFiles(projectRoot)) {
      const raw = readFileSync(f, "utf-8")
      expect(raw.includes(abs)).toBe(false)
      expect(raw).not.toMatch(/\/tmp\//)
    }
  })

  test("14) writes only under .banca/analysis/checkpoints and .banca/context", async () => {
    writeMultiBatchProject(projectRoot)
    await runContext(projectRoot)

    const packs = listContextPacks(projectRoot)
    expect(packs.length).toBe(1)
    for (const p of packs) {
      expect(p.startsWith(join(projectRoot, ".banca", "context"))).toBe(true)
    }

    const cps = listCheckpointFiles(projectRoot)
    expect(cps.length).toBe(1)
    for (const p of cps) {
      expect(
        p.startsWith(join(projectRoot, ".banca", "analysis", "checkpoints")),
      ).toBe(true)
    }

    // No findings / legacy checkpoint dumps
    expect(existsSync(join(projectRoot, ".banca", "findings.json"))).toBe(false)
    expect(existsSync(join(projectRoot, ".banca", "checkpoint.json"))).toBe(false)
    expect(existsSync(join(projectRoot, ".banca", "analysis-checkpoint.json"))).toBe(
      false,
    )

    const bancaEntries = readdirSync(join(projectRoot, ".banca")).sort()
    expect(bancaEntries).toEqual(["analysis", "context", "project.json"].sort())

    const analysisEntries = readdirSync(join(projectRoot, ".banca", "analysis"))
    expect(analysisEntries).toEqual(["checkpoints"])
  })

  test("nested include + complementary chapter: pack order and exact text (batch 0)", async () => {
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

    const result = await runContext(projectRoot)
    expect(result).toMatch(/^context → /)
    const body = packBodyFromResult(result)
    const meta = parseMetadata(body)

    const { plan } = planOracle(projectRoot)
    expect(plan.status).toBe("complete")
    const checkpoint = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, checkpoint)!

    expect((meta.manuscript as any).fingerprint).toBe(plan.fingerprint)
    expect((meta.plan as any).planId).toBe(checkpoint.planId)
    expect((meta.batch as any).batchId).toBe(first.batchId)
    expect(extractLatexChunks(body)).toEqual(first.chunks.map((c) => c.text))

    const joined = extractLatexChunks(body).join("")
    expect(joined.indexOf("MAIN-HEAD")).toBeLessThan(joined.indexOf("OUTER-BEFORE"))
    expect(joined.indexOf("OUTER-BEFORE")).toBeLessThan(joined.indexOf("INNER-BODY"))
    expect(joined.indexOf("INNER-BODY")).toBeLessThan(joined.indexOf("COMPLEMENT-CHAPTER"))

    expect(readPersistedCheckpoint(projectRoot, checkpoint.planId)).toEqual(checkpoint)
  })

  test("multi-batch pack exposes only the next batch text (no silent truncation)", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.coverage.batchCount).toBeGreaterThan(1)
    const checkpoint = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, checkpoint)!
    const exactFirstText = first.chunks.map((c) => c.text).join("")

    const result = await runContext(projectRoot)
    const body = packBodyFromResult(result)
    const meta = parseMetadata(body)

    expect((meta.batch as any).batchId).toBe(first.batchId)
    expect((meta.batch as any).index).toBe(0)
    expect(extractLatexChunks(body).join("")).toBe(exactFirstText)
    expect(extractLatexChunks(body).join("").length).toBe(first.characters)

    const laterTexts = plan.batches
      .slice(1)
      .flatMap((b) => b.chunks.map((c) => c.text))
    for (const t of laterTexts) {
      if (t.length >= 10 && !exactFirstText.includes(t)) {
        expect(body.includes(`\`\`\`latex\n${t}\n\`\`\``)).toBe(false)
      }
    }
  })

  test("optional scorecard/knowledge included without altering checkpoint identity", async () => {
    writeTree(projectRoot, {
      "main.tex": "ONLY-CANONICAL-BODY\n",
      ".banca/scorecard.md": "# Scorecard\nscore: 7.5\n",
      ".banca/knowledge.md": "# Knowledge\nnote about domain\n",
    })
    writeProjectConfig(projectRoot, { chapters: [], maxCharactersPerBatch: 500 })

    const { plan } = planOracle(projectRoot)
    const checkpoint = createAnalysisCheckpoint(plan)
    const first = nextAnalysisBatch(plan, checkpoint)!

    const result = await runContext(projectRoot)
    const body = packBodyFromResult(result)
    const meta = parseMetadata(body)

    expect((meta.plan as any).planId).toBe(checkpoint.planId)
    expect((meta.batch as any).batchId).toBe(first.batchId)
    expect(body).toContain("# Scorecard")
    expect(body).toContain("# Knowledge")

    const batchPos = body.indexOf("## Next exhaustive batch")
    const statePos = body.indexOf("## Project state")
    expect(batchPos).toBeGreaterThan(-1)
    expect(statePos).toBeGreaterThan(batchPos)
  })

  test("production tool wires persistence APIs and does not reimplement progress", async () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/tools/banca_context.ts"),
      "utf-8",
    )
    expect(src).toContain("loadCanonicalLatexManuscript")
    expect(src).toContain("planExhaustiveAnalysisBatches")
    expect(src).toContain("createAnalysisCheckpoint")
    expect(src).toContain("nextAnalysisBatch")
    expect(src).toContain("completeAnalysisBatch")
    expect(src).toContain("loadAnalysisCheckpoint")
    expect(src).toContain("saveAnalysisCheckpoint")
    expect(src).toContain("completedBatchId")
    expect(src).toContain("plan.diagnostics.map")
    expect(src).toContain("## Checkpoint coverage complete")
    // Consumer must not reintroduce diagnostic sanitization (canonical loader owns safety).
    expect(src).not.toContain("sanitizeDiagnosticText")
    expect(src).not.toContain("sanitizeDiagnostics")
    expect(src).not.toContain("Exhaustive analysis complete")
    expect(src).not.toContain("resolveManuscriptPaths")
    expect(src).not.toContain(".slice(0, 1500)")
    expect(src).not.toMatch(/paths\.chapters/)
    expect(src).not.toMatch(/readFileSync\([^)]*\.tex/)

    const stateSrc = readFileSync(
      join(import.meta.dir, "../src/lib/state.ts"),
      "utf-8",
    )
    expect(stateSrc).toContain("renameSync")
    expect(stateSrc).toContain("lstatSync")
    expect(stateSrc).toContain("isSymbolicLink")
    expect(stateSrc).toContain(".banca")
    expect(stateSrc).toContain("analysis")
    expect(stateSrc).toContain("checkpoints")
    // Storage errors must not interpolate err.message (path leak risk).
    expect(stateSrc).not.toMatch(
      /failed to (lstat|read|persist)[\s\S]{0,80}\$\{err/,
    )
  })

  test("tool and persistence error messages do not leak absolute paths", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = createAnalysisCheckpoint(plan).planId
    await runContext(projectRoot)

    const unknown = await runContext(projectRoot, {
      completedBatchId: "batch-does-not-exist",
    })
    expect(unknown).toContain("code=unknown_batch")
    assertNoAbsolutePathLeak(unknown, projectRoot)

    const empty = await runContext(projectRoot, { completedBatchId: "" })
    expect(empty).toContain("code=invalid_batch_id")
    assertNoAbsolutePathLeak(empty, projectRoot)

    // Symlink refusal path
    const abs = join(
      projectRoot,
      ".banca",
      "analysis",
      "checkpoints",
      `${planId}.json`,
    )
    rmSync(abs)
    symlinkSync(join(projectRoot, "decoy-missing.json"), abs)
    const symlinkErr = await runContext(projectRoot)
    expect(symlinkErr).toContain("code=symlink_refused")
    assertNoAbsolutePathLeak(symlinkErr, projectRoot)
  })

  test("loadAnalysisCheckpoint returns null when missing and round-trips via save", async () => {
    writeMultiBatchProject(projectRoot)
    const { plan } = planOracle(projectRoot)
    const cp = createAnalysisCheckpoint(plan)
    expect(loadAnalysisCheckpoint(projectRoot, cp.planId)).toBeNull()

    // Use tool to create file
    await runContext(projectRoot)
    const loaded = loadAnalysisCheckpoint(projectRoot, cp.planId)
    expect(loaded).toEqual(cp)

    // Public relative path is stable and relative
    const rel = getAnalysisCheckpointRelativePath(cp.planId)
    expect(rel).toBe(`.banca/analysis/checkpoints/${cp.planId}.json`)
    expect(pathIsPublic(rel)).toBe(true)
  })
})
