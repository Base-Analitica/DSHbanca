/**
 * Issue #148 — the context pack must live on the same workspace root as the
 * checkpoint, for every valid representation of that root.
 *
 * Before this fix, `banca_context` selected `const root = args.projectRoot ||
 * ctx.directory` without normalizing it and later built the pack destination as
 * `ensureRealDirInsideRoot(root, join(root, ".banca", "context"))`. With a
 * RELATIVE root (`project`), the lexical root was applied twice: the checkpoint
 * was persisted at the true workspace (its consumers resolve internally), while
 * the context pack was written to `project/project/.banca/context` and the tool
 * returned that duplicated path. The #154 preflight had introduced a local
 * `resolve(root)` only for the optional-state reads.
 *
 * This suite executes the REAL tool on a real filesystem with synthetic
 * projects only (no mocks of path/plan/checkpoint/persistence mechanisms) and
 * covers:
 * - the representation matrix from issue #148 (absolute, `project`,
 *   `./project`, nested `parent/project`, and both `ctx.directory` fallbacks);
 * - a legitimate decoy workspace at the historical duplicated destination,
 *   proving it is byte-identical and never receives the pack;
 * - checkpoint resume/advance across different representations of the same
 *   workspace, with the public checkpoint oracles;
 * - the #154 invariants under relative roots (sanitized refusals for unsafe
 *   auxiliary origins, internal links still allowed, preflight before any
 *   checkpoint persistence);
 * - the pre-existing output protection: an unsafe TRUE `.banca/context` must be
 *   refused even when the duplicated destination would have been safe (no
 *   silent fallback). Checkpoint persistence may precede that later output
 *   failure; this suite documents that existing effect instead of promising a
 *   global transaction.
 *
 * Relative roots are exercised in bounded child processes with an explicit
 * `cwd`, so the shared process cwd of the test runner is never changed.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import {
  completeAnalysisBatch,
  createAnalysisCheckpoint,
  nextAnalysisBatch,
  type AnalysisCheckpoint,
} from "../src/lib/analysis_checkpoint"
import {
  ANALYSIS_FINDINGS_STORE_VERSION,
  getAnalysisCheckpointRelativePath,
  loadAnalysisFindings,
  recordBatchAuditConfirmation,
  saveAnalysisFindings,
} from "../src/lib/state"
import { createBatchAuditConfirmation } from "../src/lib/analysis_audit_confirmation"

// ---------------------------------------------------------------------------
// Synthetic fixtures
// ---------------------------------------------------------------------------

const PROJECT_CONFIG = (opts?: {
  chapters?: string[]
  maxCharactersPerBatch?: number
}): string =>
  JSON.stringify({
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "referencias.bib",
      chapters: opts?.chapters ?? [],
      outputDir: "trabalhos",
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9,
    mcp: { crossrefAcademicEnabled: false },
    analysis: {
      coverageMode: "exhaustive",
      maxCharactersPerBatch: opts?.maxCharactersPerBatch ?? 50_000,
    },
  })

const TRUE_MAIN = "TRUE SYNTHETIC MAIN BODY\n"
const DECOY_MAIN = "DECOY CONTENT — MUST STAY UNTOUCHED\n"
const DECOY_MARKER = "MARCADOR_DECOY_148_NAO_DEVE_VAZAR"
const EXTERNAL_SECRET = "MARCADOR_EXTERNO_148_NAO_DEVE_VAZAR"

function writeFile(root: string, rel: string, content: string): string {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, "utf-8")
  return abs
}

/** Single-batch synthetic project at an explicit root. */
function setupProject(root: string, mainContent = TRUE_MAIN): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(join(root, ".banca", "project.json"), PROJECT_CONFIG(), "utf-8")
  writeFileSync(join(root, "main.tex"), mainContent, "utf-8")
}

/** Multi-batch synthetic project (small budget forces > 1 batch). */
function setupMultiBatchProject(root: string): void {
  const pad = "ABCDEFGHIJ" // 10 chars
  mkdirSync(root, { recursive: true })
  writeFile(root, "main.tex", `\\input{a}\n\\input{b}\n`)
  writeFile(root, "a.tex", pad.repeat(6)) // 60
  writeFile(root, "b.tex", pad.repeat(5)) // 50
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(
    join(root, ".banca", "project.json"),
    PROJECT_CONFIG({ chapters: [], maxCharactersPerBatch: 40 }),
    "utf-8",
  )
}

// ---------------------------------------------------------------------------
// Inspection helpers
// ---------------------------------------------------------------------------

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

/** Complete recursive inventory: path -> kind/link target/file SHA-256. */
function treeSnapshot(rootDir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  if (!existsSync(rootDir)) return snapshot
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const abs = join(dir, entry.name)
      const rel = relative(rootDir, abs).split(sep).join("/")
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) snapshot[rel] = `symlink:${readlinkSync(abs)}`
      else if (st.isDirectory()) {
        snapshot[rel] = "dir"
        visit(abs)
      } else if (st.isFile()) {
        snapshot[rel] = `file:${sha256(readFileSync(abs))}`
      } else snapshot[rel] = "special"
    }
  }
  visit(rootDir)
  return snapshot
}

function listContextPacks(trueRoot: string): string[] {
  const dir = join(trueRoot, ".banca", "context")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.startsWith("context-") && n.endsWith(".md"))
    .sort()
    .map((n) => join(dir, n))
}

function listCheckpointFiles(trueRoot: string): string[] {
  const dir = join(trueRoot, ".banca", "analysis", "checkpoints")
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json") && !n.startsWith("."))
    .sort()
    .map((n) => join(dir, n))
}

function metadataOf(packBody: string): Record<string, any> {
  const match = packBody.match(/```json\n([\s\S]*?)\n```/)
  expect(match).not.toBeNull()
  return JSON.parse(match![1]) as Record<string, any>
}

function planOracle(trueRoot: string) {
  const config = loadConfig(trueRoot)
  const manuscript = loadCanonicalLatexManuscript(trueRoot, config)
  const plan = planExhaustiveAnalysisBatches(
    manuscript,
    config.analysis.maxCharactersPerBatch,
  )
  return { config, manuscript, plan }
}

function readPersistedCheckpoint(
  trueRoot: string,
  planId: string,
): AnalysisCheckpoint {
  const rel = getAnalysisCheckpointRelativePath(planId)
  const abs = join(trueRoot, ...rel.split("/"))
  expect(existsSync(abs)).toBe(true)
  return JSON.parse(readFileSync(abs, "utf-8")) as AnalysisCheckpoint
}

function checkpointPath(trueRoot: string, planId: string): string {
  return join(trueRoot, ...getAnalysisCheckpointRelativePath(planId).split("/"))
}

function confirmBatch(trueRoot: string, plan: any, batch: any): void {
  const planId = createAnalysisCheckpoint(plan).planId
  let store = loadAnalysisFindings(trueRoot, planId)
  if (store === null) {
    store = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [],
    }
    saveAnalysisFindings(trueRoot, store)
  }
  const confirmation = createBatchAuditConfirmation(plan, batch, { findings: [] })
  recordBatchAuditConfirmation(trueRoot, confirmation)
}

// ---------------------------------------------------------------------------
// Real tool, bounded child process with explicit cwd
// ---------------------------------------------------------------------------

type ChildRun = {
  ok: boolean
  output?: string
  name?: string
  message?: string
  status: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  stderr: string
}

/**
 * Run the REAL `banca_context` tool in a child process whose cwd is explicit.
 * `projectRoot: null` omits the argument (exercising the ctx.directory
 * fallback). The child never changes the test runner's cwd.
 */
function runContextInChild(options: {
  base: string
  cwd: string
  projectRoot: string | null
  ctxDirectory: string
  timeoutMs?: number
}): ChildRun {
  const toolUrl = pathToFileURL(
    join(import.meta.dir, "..", "src", "tools", "banca_context.ts"),
  ).href
  const script = join(
    options.base,
    `_ctx148_child_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  )
  writeFileSync(
    script,
    [
      `const { bancaContext } = await import(${JSON.stringify(toolUrl)})`,
      "const hasProjectRoot = process.argv[2] !== '__OMIT__'",
      "const args = hasProjectRoot ? { projectRoot: process.argv[2] } : {}",
      "const ctx = { directory: process.argv[3] }",
      "try {",
      "  const output = String(await bancaContext.execute(args, ctx))",
      "  console.log(JSON.stringify({ ok: true, output }))",
      "} catch (error) {",
      "  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  )
  try {
    const outcome = spawnSync(
      process.execPath,
      [script, options.projectRoot ?? "__OMIT__", options.ctxDirectory],
      {
        cwd: options.cwd,
        encoding: "utf-8",
        env: process.env,
        timeout: options.timeoutMs ?? 60_000,
      },
    )
    const stdout = outcome.stdout ?? ""
    const jsonLine = stdout
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"))
    const parsed = jsonLine
      ? (JSON.parse(jsonLine) as {
          ok: boolean
          output?: string
          name?: string
          message?: string
        })
      : {
          ok: false,
          name: "NONE",
          message: "child process produced no JSON result",
        }
    return {
      ...parsed,
      status: outcome.status,
      signal: outcome.signal,
      timedOut: Boolean(
        outcome.error &&
          (outcome.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
      ),
      stderr: outcome.stderr ?? "",
    }
  } finally {
    try {
      rmSync(script, { force: true })
    } catch {
      // best-effort cleanup of the synthetic worker only
    }
  }
}

function successfulPack(run: ChildRun): string {
  expect(run.timedOut).toBe(false)
  expect(run.signal).toBeNull()
  expect(run.status).toBe(0)
  expect(run.ok).toBe(true)
  const output = String(run.output)
  expect(output).toMatch(/^context → /)
  const packPath = output.replace(/^context → /, "")
  expect(existsSync(packPath)).toBe(true)
  return packPath
}

/**
 * Full coherence assertion for one run of the real tool: checkpoint and pack
 * on the TRUE root, pack metadata matching the public plan/checkpoint oracles,
 * exact canonical chunk content, and no duplicated tree.
 */
function expectCoherentRun(options: {
  run: ChildRun
  trueRoot: string
  historicalDuplicateDir: string | null
  plan: any
  expectedCheckpoint: AnalysisCheckpoint
  expectedPackCount?: number
}): { packPath: string; packBody: string } {
  const packPath = successfulPack(options.run)

  // Pack lives exactly in the true `.banca/context` directory, never in a
  // lexically duplicated tree, and the returned path is the persisted one.
  expect(dirname(packPath)).toBe(join(options.trueRoot, ".banca", "context"))
  const packs = listContextPacks(options.trueRoot)
  expect(packs).toHaveLength(options.expectedPackCount ?? 1)
  expect(packs).toContain(packPath)
  if (options.historicalDuplicateDir !== null) {
    expect(existsSync(options.historicalDuplicateDir)).toBe(false)
  }

  // Checkpoint lives exactly in the true workspace and matches the oracle.
  const checkpoints = listCheckpointFiles(options.trueRoot)
  expect(checkpoints).toHaveLength(1)
  expect(checkpoints[0]).toBe(
    checkpointPath(options.trueRoot, options.expectedCheckpoint.planId),
  )
  expect(
    readPersistedCheckpoint(options.trueRoot, options.expectedCheckpoint.planId),
  ).toEqual(options.expectedCheckpoint)

  // Pack metadata and canonical chunk content correspond to the real plan.
  const packBody = readFileSync(packPath, "utf-8")
  const meta = metadataOf(packBody)
  expect((meta.manuscript as any).fingerprint).toBe(options.plan.fingerprint)
  expect((meta.plan as any).planId).toBe(options.expectedCheckpoint.planId)
  expect((meta.plan as any).batchCount).toBe(options.plan.coverage.batchCount)
  expect((meta.plan as any).totalCharacters).toBe(
    options.plan.coverage.totalCharacters,
  )
  expect((meta.checkpoint as any).state).toBe(options.expectedCheckpoint.state)
  expect((meta.checkpoint as any).completedBatches).toBe(
    options.expectedCheckpoint.completedBatches,
  )
  expect((meta.checkpoint as any).coveragePercent).toBe(
    options.expectedCheckpoint.coveragePercent,
  )

  const next = nextAnalysisBatch(options.plan, options.expectedCheckpoint)
  if (next !== null) {
    expect((meta.batch as any).batchId).toBe(next.batchId)
    expect((meta.batch as any).index).toBe(next.index)
    expect((meta.chunks as any[]).length).toBe(next.chunks.length)
    for (let i = 0; i < next.chunks.length; i++) {
      const chunk = next.chunks[i]
      for (const key of [
        "file",
        "startLine",
        "endLine",
        "sourceSpanIndex",
        "startOffset",
        "endOffset",
      ] as const) {
        expect((meta.chunks as any[])[i][key]).toBe(chunk.source[key])
      }
      expect((meta.chunks as any[])[i].characters).toBe(chunk.text.length)
    }
    const latexChunks = [...packBody.matchAll(/```latex\n([\s\S]*?)\n```/g)].map(
      (m) => m[1],
    )
    expect(latexChunks).toEqual(next.chunks.map((c) => c.text))
    expect(next.characters).toBeLessThanOrEqual(
      loadConfig(options.trueRoot).analysis.maxCharactersPerBatch,
    )
  } else {
    expect((meta.batch as any).batchId).toBeNull()
  }

  return { packPath, packBody }
}

// ---------------------------------------------------------------------------
// A. Representation matrix
// ---------------------------------------------------------------------------

describe("issue #148 — root representation matrix", () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-148-matrix-"))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  test("absolute projectRoot keeps checkpoint and pack on the true root (positive control)", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)
    const mainBefore = sha256(readFileSync(join(trueRoot, "main.tex")))

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: trueRoot,
      ctxDirectory: trueRoot,
    })
    expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: null,
      plan,
      expectedCheckpoint: expected,
    })
    expect(sha256(readFileSync(join(trueRoot, "main.tex")))).toBe(mainBefore)
    // No unexpected subtree was created inside the true workspace.
    expect(readdirSync(trueRoot).sort()).toEqual([".banca", "main.tex"])
  })

  test("relative projectRoot 'project' writes checkpoint and pack on the true root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expectCoherentRun({
      run,
      trueRoot,
      // Pre-fix duplication: root applied again inside the true workspace.
      historicalDuplicateDir: resolve(trueRoot, "project", ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
    })
    expect(readdirSync(trueRoot).sort()).toEqual([".banca", "main.tex"])
  })

  test("relative projectRoot './project' writes checkpoint and pack on the true root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "./project",
      ctxDirectory: "./project",
    })
    expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: resolve(trueRoot, "./project", ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
    })
  })

  test("nested relative projectRoot 'parent/project' writes on the true root", () => {
    const trueRoot = join(base, "parent", "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "parent/project",
      ctxDirectory: "parent/project",
    })
    expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: resolve(
        trueRoot,
        "parent/project",
        ".banca",
        "context",
      ),
      plan,
      expectedCheckpoint: expected,
    })
  })

  test("absolute ctx.directory fallback writes on the true root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: null,
      ctxDirectory: trueRoot,
    })
    expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: null,
      plan,
      expectedCheckpoint: expected,
    })
  })

  test("relative ctx.directory fallback writes on the true root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: null,
      ctxDirectory: "project",
    })
    expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: resolve(trueRoot, "project", ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
    })
  })

  test("explicit projectRoot keeps precedence over ctx.directory", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    // A non-existent ctx.directory cannot win over an explicit projectRoot.
    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: join(base, "does-not-exist"),
    })
    expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: resolve(trueRoot, "project", ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
    })
  })
})

// ---------------------------------------------------------------------------
// B. Legitimate decoy at the historical duplicated destination
// ---------------------------------------------------------------------------

describe("issue #148 — decoy workspace at project/project", () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-148-decoy-"))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  test("relative root never writes artifacts into a legitimate decoy workspace", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    // Legitimate homonym workspace at the path the pre-fix implementation used
    // as a duplicated destination.
    const decoyRoot = join(trueRoot, "project")
    setupProject(decoyRoot, DECOY_MAIN)
    writeFile(decoyRoot, "markers/decoy-marker.txt", `${DECOY_MARKER}\n`)
    writeFile(decoyRoot, ".banca/notes/decoy-note.md", "decoy own notes\n")

    const decoyBefore = treeSnapshot(decoyRoot)
    const trueMainBefore = sha256(readFileSync(join(trueRoot, "main.tex")))
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    const { packBody } = expectCoherentRun({
      run,
      trueRoot,
      historicalDuplicateDir: join(decoyRoot, ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
    })

    // The true manuscript is what feeds the pack; decoy bytes never leak in.
    expect(packBody).toContain(TRUE_MAIN.trim())
    expect(packBody).not.toContain(DECOY_MAIN.trim())
    expect(packBody).not.toContain(DECOY_MARKER)
    expect(sha256(readFileSync(join(trueRoot, "main.tex")))).toBe(trueMainBefore)

    // Decoy workspace is byte-identical: no pack/checkpoint/context created.
    expect(treeSnapshot(decoyRoot)).toEqual(decoyBefore)
    expect(existsSync(join(decoyRoot, ".banca", "context"))).toBe(false)
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// C. Resume and advance across representations
// ---------------------------------------------------------------------------

describe("issue #148 — resume/advance across representations", () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-148-resume-"))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  test("one checkpoint and coherent packs across absolute/relative/./ fallbacks", () => {
    const trueRoot = join(base, "project")
    setupMultiBatchProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const expected = createAnalysisCheckpoint(plan)
    const firstNext = nextAnalysisBatch(plan, expected)!
    const cpPath = checkpointPath(trueRoot, expected.planId)

    // Create with an absolute representation.
    const create = runContextInChild({
      base,
      cwd: base,
      projectRoot: trueRoot,
      ctxDirectory: trueRoot,
    })
    expectCoherentRun({
      run: create,
      trueRoot,
      historicalDuplicateDir: null,
      plan,
      expectedCheckpoint: expected,
    })
    const checkpointBytes = readFileSync(cpPath, "utf-8")

    // Resume without advancing through a plain relative root.
    const resume = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    const resumeCoherent = expectCoherentRun({
      run: resume,
      trueRoot,
      historicalDuplicateDir: resolve(trueRoot, "project", ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
      expectedPackCount: 2,
    })
    expect(readFileSync(cpPath, "utf-8")).toBe(checkpointBytes)
    let meta = metadataOf(resumeCoherent.packBody)
    expect((meta.batch as any).batchId).toBe(firstNext.batchId)
    expect((meta.checkpoint as any).completedBatches).toBe(0)

    // Resume again through `./project` and the relative ctx fallback.
    const ctxFallback = runContextInChild({
      base,
      cwd: base,
      projectRoot: null,
      ctxDirectory: "./project",
    })
    const fallbackCoherent = expectCoherentRun({
      run: ctxFallback,
      trueRoot,
      historicalDuplicateDir: resolve(trueRoot, "./project", ".banca", "context"),
      plan,
      expectedCheckpoint: expected,
      expectedPackCount: 3,
    })
    meta = metadataOf(fallbackCoherent.packBody)
    expect((meta.batch as any).batchId).toBe(firstNext.batchId)
    expect(readFileSync(cpPath, "utf-8")).toBe(checkpointBytes)
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })

  test("confirmed advance through a relative root matches the checkpoint oracle", () => {
    const trueRoot = join(base, "project")
    setupMultiBatchProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const initial = createAnalysisCheckpoint(plan)
    const firstBatch = plan.batches[0]
    expect(plan.batches.length).toBeGreaterThan(1)

    const create = runContextInChild({
      base,
      cwd: base,
      projectRoot: trueRoot,
      ctxDirectory: trueRoot,
    })
    expectCoherentRun({
      run: create,
      trueRoot,
      historicalDuplicateDir: null,
      plan,
      expectedCheckpoint: initial,
    })
    confirmBatch(trueRoot, plan, firstBatch)

    // The generic child runner does not pass completedBatchId; use a dedicated
    // worker for the advancing call.
    const advancing = runAdvanceChild({
      base,
      cwd: base,
      projectRoot: "project",
      completedBatchId: firstBatch.batchId,
    })
    expect(advancing.timedOut).toBe(false)
    expect(advancing.status).toBe(0)
    expect(advancing.ok).toBe(true)
    expect(String(advancing.output)).toMatch(/^context → /)
    const packPath = String(advancing.output).replace(/^context → /, "")
    expect(dirname(packPath)).toBe(join(trueRoot, ".banca", "context"))
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )

    const expectedAfter = completeAnalysisBatch(plan, initial, firstBatch.batchId)
    expect(readPersistedCheckpoint(trueRoot, initial.planId)).toEqual(expectedAfter)
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
    const meta = metadataOf(readFileSync(packPath, "utf-8"))
    expect((meta.checkpoint as any).completedBatches).toBe(1)
    expect((meta.batch as any).index).toBe(1)
    expect((meta.plan as any).planId).toBe(initial.planId)
    expect((meta.manuscript as any).fingerprint).toBe(plan.fingerprint)

    // The relative ctx.directory fallback must also work on the ADVANCE path
    // (not only on resume): confirm the next batch and advance through the
    // fallback representation, then compare with the public checkpoint oracle.
    const secondBatch = plan.batches[1]
    expect(secondBatch).toBeDefined()
    confirmBatch(trueRoot, plan, secondBatch)
    const advancingFallback = runAdvanceChild({
      base,
      cwd: base,
      projectRoot: null,
      ctxDirectory: "project",
      completedBatchId: secondBatch.batchId,
    })
    expect(advancingFallback.timedOut).toBe(false)
    expect(advancingFallback.status).toBe(0)
    expect(advancingFallback.ok).toBe(true)
    expect(String(advancingFallback.output)).toMatch(/^context → /)
    const fallbackPack = String(advancingFallback.output).replace(/^context → /, "")
    expect(dirname(fallbackPack)).toBe(join(trueRoot, ".banca", "context"))
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )
    const expectedAfterFallback = completeAnalysisBatch(
      plan,
      expectedAfter,
      secondBatch.batchId,
    )
    expect(readPersistedCheckpoint(trueRoot, initial.planId)).toEqual(
      expectedAfterFallback,
    )
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })

  test("missing confirmation does not advance or duplicate checkpoints", () => {
    const trueRoot = join(base, "project")
    setupMultiBatchProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const initial = createAnalysisCheckpoint(plan)
    const firstBatch = plan.batches[0]
    const cpPath = checkpointPath(trueRoot, initial.planId)

    const create = runContextInChild({
      base,
      cwd: base,
      projectRoot: trueRoot,
      ctxDirectory: trueRoot,
    })
    expectCoherentRun({
      run: create,
      trueRoot,
      historicalDuplicateDir: null,
      plan,
      expectedCheckpoint: initial,
    })
    const before = readFileSync(cpPath, "utf-8")

    const missing = runAdvanceChild({
      base,
      cwd: base,
      projectRoot: "project",
      completedBatchId: firstBatch.batchId,
    })
    expect(missing.timedOut).toBe(false)
    expect(missing.ok).toBe(true)
    expect(String(missing.output)).toContain("context checkpoint error")
    expect(String(missing.output)).toContain("code=missing_batch_audit")
    expect(readFileSync(cpPath, "utf-8")).toBe(before)
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })

  test("invalid or out-of-order batch is refused without mutation", () => {
    const trueRoot = join(base, "project")
    setupMultiBatchProject(trueRoot)
    const { plan } = planOracle(trueRoot)
    const initial = createAnalysisCheckpoint(plan)
    const cpPath = checkpointPath(trueRoot, initial.planId)

    const create = runContextInChild({
      base,
      cwd: base,
      projectRoot: trueRoot,
      ctxDirectory: trueRoot,
    })
    expectCoherentRun({
      run: create,
      trueRoot,
      historicalDuplicateDir: null,
      plan,
      expectedCheckpoint: initial,
    })
    const before = readFileSync(cpPath, "utf-8")

    const unknown = runAdvanceChild({
      base,
      cwd: base,
      projectRoot: "project",
      completedBatchId: "batch-does-not-exist",
    })
    expect(String(unknown.output)).toContain("code=unknown_batch")

    const future = plan.batches[plan.batches.length - 1].batchId
    const outOfOrder = runAdvanceChild({
      base,
      cwd: base,
      projectRoot: "./project",
      completedBatchId: future,
    })
    expect(String(outOfOrder.output)).toContain("code=out_of_order")

    expect(readFileSync(cpPath, "utf-8")).toBe(before)
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )
  })

  test("blocked plan creates no checkpoint, pack or duplicated tree under relative root", () => {
    const trueRoot = join(base, "project")
    mkdirSync(trueRoot, { recursive: true })
    writeFile(trueRoot, "main.tex", `HEAD\n\\input{missing-chapter}\nTAIL\n`)
    mkdirSync(join(trueRoot, ".banca"), { recursive: true })
    writeFileSync(
      join(trueRoot, ".banca", "project.json"),
      PROJECT_CONFIG({ chapters: [], maxCharactersPerBatch: 1000 }),
      "utf-8",
    )

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    expect(String(run.output)).toContain("context blocked")
    expect(String(run.output)).toContain("status=blocked")
    expect(String(run.output)).not.toMatch(/^context → /)
    expect(existsSync(join(trueRoot, ".banca", "analysis"))).toBe(false)
    expect(existsSync(join(trueRoot, ".banca", "context"))).toBe(false)
    expect(existsSync(join(trueRoot, "project"))).toBe(false)
  })
})

/**
 * Advance-capable child runner: same real tool, bounded subprocess, explicit
 * cwd, with `completedBatchId` forwarded exactly (undefined stays omitted only
 * when the caller passes a string).
 */
function runAdvanceChild(options: {
  base: string
  cwd: string
  projectRoot: string | null
  ctxDirectory?: string
  completedBatchId: string
  timeoutMs?: number
}): ChildRun {
  const toolUrl = pathToFileURL(
    join(import.meta.dir, "..", "src", "tools", "banca_context.ts"),
  ).href
  const script = join(
    options.base,
    `_ctx148_advance_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  )
  writeFileSync(
    script,
    [
      `const { bancaContext } = await import(${JSON.stringify(toolUrl)})`,
      "const hasProjectRoot = process.argv[2] !== '__OMIT__'",
      "const args = hasProjectRoot ? { projectRoot: process.argv[2] } : {}",
      "args.completedBatchId = process.argv[3]",
      "const ctx = { directory: process.argv[4] }",
      "try {",
      "  const output = String(await bancaContext.execute(args, ctx))",
      "  console.log(JSON.stringify({ ok: true, output }))",
      "} catch (error) {",
      "  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))",
      "}",
      "",
    ].join("\n"),
    "utf-8",
  )
  try {
    const outcome = spawnSync(
      process.execPath,
      [
        script,
        options.projectRoot ?? "__OMIT__",
        options.completedBatchId,
        options.ctxDirectory ?? options.projectRoot ?? ".",
      ],
      {
        cwd: options.cwd,
        encoding: "utf-8",
        env: process.env,
        timeout: options.timeoutMs ?? 60_000,
      },
    )
    const stdout = outcome.stdout ?? ""
    const jsonLine = stdout
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"))
    const parsed = jsonLine
      ? (JSON.parse(jsonLine) as {
          ok: boolean
          output?: string
          name?: string
          message?: string
        })
      : {
          ok: false,
          name: "NONE",
          message: "child process produced no JSON result",
        }
    return {
      ...parsed,
      status: outcome.status,
      signal: outcome.signal,
      timedOut: Boolean(
        outcome.error &&
          (outcome.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
      ),
      stderr: outcome.stderr ?? "",
    }
  } finally {
    try {
      rmSync(script, { force: true })
    } catch {
      // best-effort cleanup
    }
  }
}

// ---------------------------------------------------------------------------
// D. Output destination security and #154 preservation under relative roots
// ---------------------------------------------------------------------------

describe("issue #148 — destination security under relative roots", () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-148-security-"))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  function setupRelativeProject(): { trueRoot: string; external: string } {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const external = join(base, "external-context")
    mkdirSync(external, { recursive: true })
    return { trueRoot, external }
  }

  test("refuses an external symlink at the TRUE .banca/context destination", () => {
    const { trueRoot, external } = setupRelativeProject()
    rmSync(join(trueRoot, ".banca", "context"), { recursive: true, force: true })
    symlinkSync(external, join(trueRoot, ".banca", "context"), "dir")
    const externalBefore = treeSnapshot(external)

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    expect(String(run.output)).toContain("context blocked")
    expect(String(run.output)).toContain(
      "context pack path escapes workspace root",
    )
    expect(String(run.output)).not.toMatch(/^context → /)
    // No silent fallback to the duplicated destination.
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )
    expect(treeSnapshot(external)).toEqual(externalBefore)
    expect(lstatSync(join(trueRoot, ".banca", "context")).isSymbolicLink()).toBe(
      true,
    )
    // Documented pre-existing effect: checkpoint persistence precedes the pack
    // write, so the checkpoint exists even though the output was refused.
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })

  test("refuses a broken symlink at the TRUE .banca/context destination", () => {
    const { trueRoot } = setupRelativeProject()
    rmSync(join(trueRoot, ".banca", "context"), { recursive: true, force: true })
    symlinkSync(
      join(base, "no-such-context-dir"),
      join(trueRoot, ".banca", "context"),
      "dir",
    )

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    expect(String(run.output)).toContain("context blocked")
    expect(String(run.output)).not.toMatch(/^context → /)
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )
    expect(lstatSync(join(trueRoot, ".banca", "context")).isSymbolicLink()).toBe(
      true,
    )
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })

  test("refuses a non-directory TRUE .banca/context component", () => {
    const { trueRoot } = setupRelativeProject()
    rmSync(join(trueRoot, ".banca", "context"), { recursive: true, force: true })
    writeFileSync(join(trueRoot, ".banca", "context"), "not a directory\n")

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    expect(String(run.output)).toContain("context blocked")
    expect(String(run.output)).not.toMatch(/^context → /)
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )
    expect(readFileSync(join(trueRoot, ".banca", "context"), "utf-8")).toBe(
      "not a directory\n",
    )
    expect(listCheckpointFiles(trueRoot)).toHaveLength(1)
  })

  test("a safe decoy does not mask an unsafe TRUE destination", () => {
    const { trueRoot, external } = setupRelativeProject()
    const decoyRoot = join(trueRoot, "project")
    setupProject(decoyRoot, DECOY_MAIN)
    const decoyBefore = treeSnapshot(decoyRoot)
    rmSync(join(trueRoot, ".banca", "context"), { recursive: true, force: true })
    symlinkSync(external, join(trueRoot, ".banca", "context"), "dir")

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    expect(String(run.output)).toContain("context blocked")
    expect(String(run.output)).not.toMatch(/^context → /)
    expect(treeSnapshot(decoyRoot)).toEqual(decoyBefore)
    expect(existsSync(join(decoyRoot, ".banca", "context"))).toBe(false)
  })

  // ---- #154 preservation under relative roots -----------------------------

  test("preserves #154 refusal of an external scorecard under a relative root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const externalScorecard = join(base, "scorecard_external.md")
    writeFileSync(externalScorecard, `# external\n${EXTERNAL_SECRET}\n`, "utf-8")
    symlinkSync(
      externalScorecard,
      join(trueRoot, ".banca", "scorecard.md"),
      "file",
    )
    const externalHash = sha256(readFileSync(externalScorecard))

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    const output = String(run.output)
    expect(output).toMatch(/^context refused: auxiliary project state/)
    expect(output).toContain("file=.banca/scorecard.md")
    expect(output).toContain("code=unsafe_origin")
    expect(output).not.toContain(EXTERNAL_SECRET)
    expect(output).not.toMatch(/^context → /)

    // Preflight precedes every persistence: no checkpoint and no pack at the
    // true root nor at the historical duplicated destination.
    expect(existsSync(join(trueRoot, ".banca", "analysis"))).toBe(false)
    expect(existsSync(join(trueRoot, ".banca", "context"))).toBe(false)
    expect(existsSync(resolve(trueRoot, "project", ".banca"))).toBe(false)
    expect(sha256(readFileSync(externalScorecard))).toBe(externalHash)
  })

  test("preserves #154 refusal of an external knowledge file under a relative root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    const externalKnowledge = join(base, "knowledge_external.md")
    writeFileSync(externalKnowledge, `# external\n${EXTERNAL_SECRET}\n`, "utf-8")
    symlinkSync(
      externalKnowledge,
      join(trueRoot, ".banca", "knowledge.md"),
      "file",
    )

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    const output = String(run.output)
    expect(output).toMatch(/^context refused: auxiliary project state/)
    expect(output).toContain("file=.banca/knowledge.md")
    expect(output).toContain("code=unsafe_origin")
    expect(output).not.toContain(EXTERNAL_SECRET)
    expect(existsSync(join(trueRoot, ".banca", "analysis"))).toBe(false)
    expect(existsSync(join(trueRoot, ".banca", "context"))).toBe(false)
  })

  test("preserves #154 broken-symlink refusal (never silent absence) under a relative root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    symlinkSync(
      join(base, "no-such-scorecard.md"),
      join(trueRoot, ".banca", "scorecard.md"),
      "file",
    )

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    expect(run.timedOut).toBe(false)
    expect(run.status).toBe(0)
    const output = String(run.output)
    expect(output).toMatch(/^context refused: auxiliary project state/)
    expect(output).toContain("code=unsafe_origin")
    expect(existsSync(join(trueRoot, ".banca", "analysis"))).toBe(false)
    expect(existsSync(join(trueRoot, ".banca", "context"))).toBe(false)
  })

  test("preserves #154 internal symlink allowance under a relative root", () => {
    const trueRoot = join(base, "project")
    setupProject(trueRoot)
    writeFile(
      trueRoot,
      "auxiliares/scorecard-real.md",
      "# INTERNAL SCORECARD 148\n",
    )
    symlinkSync(
      join(trueRoot, "auxiliares", "scorecard-real.md"),
      join(trueRoot, ".banca", "scorecard.md"),
      "file",
    )

    const run = runContextInChild({
      base,
      cwd: base,
      projectRoot: "project",
      ctxDirectory: "project",
    })
    const packPath = successfulPack(run)
    expect(dirname(packPath)).toBe(join(trueRoot, ".banca", "context"))
    expect(readFileSync(packPath, "utf-8")).toContain(
      "# INTERNAL SCORECARD 148",
    )
    expect(lstatSync(join(trueRoot, ".banca", "scorecard.md")).isSymbolicLink()).toBe(
      true,
    )
    expect(existsSync(resolve(trueRoot, "project", ".banca", "context"))).toBe(
      false,
    )
  })
})
