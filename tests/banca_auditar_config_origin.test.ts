/**
 * Issue #138 — `banca_auditar` must distinguish a known configuration-origin
 * refusal from an unexpected manuscript planning failure.
 *
 * Historical defect (base 135ba3a9): the tool loaded the configuration, the
 * manuscript and the exhaustive plan inside one `try` and converted every
 * exception to `code=unexpected`. The configuration reader in
 * `src/lib/config.ts` (#134) already fails closed with a stable, sanitized
 * `PathTraversalError` for a present-but-unauthorized or unreadable origin, so
 * those known refusals were reported as "an unexpected manuscript planning
 * error occurred".
 *
 * This suite runs the real tool against synthetic workspaces on the real
 * filesystem and requires:
 * - known configuration refusals keep the tool envelope and a sanitized
 *   diagnosis mapped to the existing public codes (`unsafe_origin`,
 *   `inspection_failed`, `unreadable_origin`);
 * - absent/regular/malformed/internal-link configurations keep the historical
 *   audit flow (defaults, plan, fingerprint check, blocked plan, receipt);
 * - a genuine unexpected error (generic exception or an unrelated
 *   `PathTraversalError`) still reports `unexpected`;
 * - every refusal is free of host paths, link targets, external content, raw
 *   errno, stack traces and academic conclusions;
 * - every refusal creates or rewrites nothing (recursive inventory + SHA-256
 *   before/after). FIFO, socket and injected-exception cases run in a bounded
 *   child process; a timeout is never accepted as a result.
 *
 * No DSH host, model, network, LaTeX engine or real manuscript is involved.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
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
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  AUDIT_RECEIPT_KIND,
  bancaAuditar,
} from "../src/tools/banca_auditar"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint"

// ---------------------------------------------------------------------------
// Fixtures and constants
// ---------------------------------------------------------------------------

/** Synthetic token that must never reach a refusal diagnostic. */
const SECRET = "SEGREDO_SINTETICO_138_AUDIT_NAO_DEVE_VAZAR"

/** External configuration fixture with a canary token and a foreign target. */
const EXTERNAL_CONFIG = JSON.stringify({
  version: 1,
  manuscript: { format: "latex", root: ".", main: "externo-inexistente.tex" },
  immutableFacts: [SECRET],
  analysis: { coverageMode: "exhaustive", maxCharactersPerBatch: 1000 },
})

/** Raw filesystem fragments that must never surface in a refusal. */
const RAW_FRAGMENTS = [
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
  "ENXIO",
  "ENOSYS",
  "permission denied",
  "no such file",
  "illegal operation",
  "too many levels of symbolic links",
  "open '",
  " at ",
]

const TOOL_URL = pathToFileURL(
  join(import.meta.dir, "..", "src", "tools", "banca_auditar.ts"),
).href

const SAFE_CONFIG_REFUSAL_MESSAGES = {
  unsafe_origin:
    "config refused: the configured origin is not a safe regular file inside the workspace",
  inspection_failed:
    "config refused: the configured origin could not be inspected safely",
  unreadable_origin:
    "config refused: the present configuration could not be read",
} as const

const symlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-138-audit-link-probe-"))
    try {
      symlinkSync(probeBase, join(probeBase, "link"))
      return true
    } finally {
      rmSync(probeBase, { recursive: true, force: true })
    }
  } catch {
    return false
  }
})()

const stest = symlinksSupported ? test : test.skip

const mkfifoSupported = (() => {
  if (process.platform === "win32") return false
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-138-audit-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

const fifoTest = mkfifoSupported ? test : test.skip

const unreadableSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0

const unreadableTest = unreadableSupported ? test : test.skip

const unixSocketTest = process.platform === "win32" ? test.skip : test

// ---------------------------------------------------------------------------
// Real-filesystem helpers
// ---------------------------------------------------------------------------

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf-8")
  }
}

/** Regular internal configuration that keeps the historical audit flow. */
function writeProjectConfig(
  root: string,
  opts?: { maxCharactersPerBatch?: number; targetScore?: number },
): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(
    join(root, ".banca", "project.json"),
    JSON.stringify({
      version: 1,
      manuscript: {
        format: "latex",
        root: ".",
        main: "main.tex",
        bib: "refs.bib",
        chapters: [],
        outputDir: "trabalhos",
      },
      compile: { enabled: false, command: [] },
      allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
      protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
      immutableFacts: [],
      externalDependencies: [],
      rubricProfile: "banca-rigorosa",
      targetScore: opts?.targetScore ?? 9.0,
      mcp: { crossrefAcademicEnabled: false },
      analysis: {
        coverageMode: "exhaustive",
        maxCharactersPerBatch: opts?.maxCharactersPerBatch ?? 50_000,
      },
    }),
    "utf-8",
  )
}

/** Small synthetic manuscript; one exhaustive batch with the default budget. */
function writeManuscript(root: string): void {
  writeTree(root, {
    "main.tex": "Synthetic line one.\nSynthetic line two.\n",
    "refs.bib": "@book{sintetica138, title={Sintética 138}}\n",
  })
}

/** Missing include: the exhaustive plan is blocked (historical control). */
function writeBlockedManuscript(root: string): void {
  writeTree(root, {
    "main.tex": "\\input{missing-chapter}\nText after missing include.\n",
  })
  writeProjectConfig(root)
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

type AuditArgs = {
  manuscriptFingerprint: string
  batchId: string
  findings: Array<{
    category: string
    severity: string
    claim: string
    evidence: string
    file: string
    startLine: number
    endLine: number
    sectionId: string
  }>
}

async function runAudit(
  projectRoot: string,
  args: AuditArgs,
): Promise<string> {
  return String(
    await bancaAuditar.execute(
      { projectRoot, ...args },
      { directory: projectRoot } as never,
    ),
  )
}

/** Historical fingerprint-mismatch control used for absent/malformed configs. */
function historicalMismatchArgs(): AuditArgs {
  return {
    manuscriptFingerprint: "a".repeat(64),
    batchId: "batch-does-not-exist",
    findings: [],
  }
}

/** Valid receipt arguments derived from the live canonical plan. */
function validReceiptArgs(projectRoot: string) {
  const { plan } = planOracle(projectRoot)
  expect(plan.status).toBe("complete")
  expect(plan.fingerprint).toBeTruthy()
  expect(plan.batches.length).toBeGreaterThan(0)
  const batch = plan.batches[0]!
  const chunk = batch.chunks[0]!
  return {
    plan,
    planId: computePlanIdentity(plan),
    args: {
      manuscriptFingerprint: plan.fingerprint as string,
      batchId: batch.batchId,
      findings: [
        {
          category: "structure",
          severity: "warning",
          claim: "Synthetic claim for issue 138",
          evidence: "Synthetic evidence span for issue 138",
          file: chunk.source.file,
          startLine: chunk.source.startLine,
          endLine: chunk.source.endLine,
          sectionId: "sec:synthetic-138",
        },
      ],
    } satisfies AuditArgs,
  }
}

/** Complete recursive inventory: relative path -> kind, link target, SHA-256. */
function treeSnapshot(rootDir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const abs = join(dir, entry.name)
      const rel = relative(rootDir, abs).split(sep).join("/")
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) {
        snapshot[rel] = `symlink:${readlinkSync(abs)}`
      } else if (st.isDirectory()) {
        snapshot[rel] = "dir"
        visit(abs)
      } else if (st.isFile()) {
        let digest: string
        try {
          digest = createHash("sha256").update(readFileSync(abs)).digest("hex")
        } catch (error) {
          digest = `unreadable:${(error as NodeJS.ErrnoException).code}`
        }
        snapshot[rel] = `file:${digest}`
      } else if (st.isFIFO()) {
        snapshot[rel] = "fifo"
      } else if (st.isSocket()) {
        snapshot[rel] = "socket"
      } else {
        snapshot[rel] = "special"
      }
    }
  }
  visit(rootDir)
  return snapshot
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

// ---------------------------------------------------------------------------
// Error assertions
// ---------------------------------------------------------------------------

function envelopeLines(output: string): string[] {
  return output.split("\n")
}

function errorCode(output: string): string {
  const match = output.match(/^code=(.+)$/m)
  expect(match).not.toBeNull()
  return match![1]!
}

function errorMessage(output: string): string {
  const match = output.match(/^message=(.+)$/m)
  expect(match).not.toBeNull()
  return match![1]!
}

/**
 * Controlled configuration refusal: returned (not thrown), historical audit
 * envelope, existing public code, sanitized fixed message, no leak and no
 * `unexpected`.
 */
function assertConfigRefusal(
  output: string,
  expectedCode: keyof typeof SAFE_CONFIG_REFUSAL_MESSAGES,
  forbidden: string[] = [],
): void {
  const lines = envelopeLines(output)
  expect(lines).toHaveLength(3)
  expect(lines[0]).toBe("audit validation error")
  expect(lines[1]).toBe(`code=${expectedCode}`)
  expect(lines[2]).toBe(`message=${SAFE_CONFIG_REFUSAL_MESSAGES[expectedCode]}`)
  expect(output).not.toContain("unexpected")
  expect(output).not.toContain("blocked_plan")
  expect(output).not.toContain("fingerprint_mismatch")
  for (const fragment of [SECRET, "externo-inexistente.tex", ...RAW_FRAGMENTS, ...forbidden]) {
    expect(output).not.toContain(fragment)
  }
  expect(output).not.toMatch(/(^|[\s"'])(\/tmp\/|\/home\/|\/var\/)/)
  expect(output).not.toMatch(/\bAPROVADO\b/)
  expect(output).not.toMatch(/\bREPROVADO\b/)
  expect(output).not.toMatch(/\bnotaFinal\b/)
}

/** Genuinely unexpected failure keeps the historical fixed diagnostic. */
function assertUnexpected(output: string): void {
  expect(envelopeLines(output)).toHaveLength(3)
  expect(output.startsWith("audit validation error\n")).toBe(true)
  expect(errorCode(output)).toBe("unexpected")
  expect(errorMessage(output)).toBe(
    "an unexpected manuscript planning error occurred",
  )
  expect(output).not.toContain("config refused")
  for (const fragment of RAW_FRAGMENTS) expect(output).not.toContain(fragment)
}

/** Historical control: configuration resolved and the plan was built. */
function assertHistoricalPlanReached(output: string): void {
  expect(output.startsWith("audit validation error\n")).toBe(true)
  expect(errorCode(output)).toBe("fingerprint_mismatch")
  expect(output).not.toContain("unexpected")
  expect(output).not.toContain("config refused")
}

// ---------------------------------------------------------------------------
// Bounded child-process worker (FIFO, socket, injected exceptions)
// ---------------------------------------------------------------------------

const AUDIT_WORKER_SOURCE = `
import { mock } from "bun:test"
const toolUrl = process.argv[2]
const mode = process.argv[3]
const root = process.argv[4]
const configUrl = new URL("../lib/config.ts", toolUrl).href
const loaderUrl = new URL("../lib/latex_loader.ts", toolUrl).href
const safePathsUrl = new URL("../lib/safe_paths.ts", toolUrl).href
if (mode === "generic-config") {
  mock.module(configUrl, () => ({ loadConfig: () => { throw new Error("synthetic generic configuration failure") } }))
} else if (mode === "generic-planning") {
  mock.module(loaderUrl, () => ({ loadCanonicalLatexManuscript: () => { throw new Error("synthetic generic planning failure") } }))
} else if (mode === "inspection-failed") {
  const { PathTraversalError } = await import(safePathsUrl)
  mock.module(configUrl, () => ({ loadConfig: () => { throw new PathTraversalError("config refused: the configured origin could not be inspected safely") } }))
} else if (mode === "unrelated-traversal") {
  const { PathTraversalError } = await import(safePathsUrl)
  mock.module(configUrl, () => ({ loadConfig: () => { throw new PathTraversalError("unrelated internal path refusal") } }))
} else if (mode === "unlisted-config-refusal") {
  const { PathTraversalError } = await import(safePathsUrl)
  mock.module(configUrl, () => ({ loadConfig: () => { throw new PathTraversalError("config refused: a synthetic unlisted refusal that is not part of the contract") } }))
}
const { bancaAuditar } = await import(toolUrl)
let payload
try {
  const output = await bancaAuditar.execute(
    { projectRoot: root, manuscriptFingerprint: "a".repeat(64), batchId: "batch-does-not-exist", findings: [] },
    { directory: root },
  )
  payload = { outcome: "returned", output: String(output) }
} catch (error) {
  payload = {
    outcome: "threw",
    name: String(error && error.name),
    message: String(error && error.message),
  }
}
console.log(JSON.stringify(payload))
`

type WorkerRun = {
  outcome: ReturnType<typeof spawnSync>
  elapsedMs: number
  payload:
    | { outcome: "returned"; output: string }
    | { outcome: "threw"; name: string; message: string }
    | null
}

function runBoundedWorker(
  baseDir: string,
  scriptName: string,
  mode: string,
  root: string,
  timeoutMs: number,
): WorkerRun {
  const scriptPath = join(baseDir, scriptName)
  const started = performance.now()
  const outcome = spawnSync(
    process.execPath,
    [scriptPath, TOOL_URL, mode, root],
    { cwd: baseDir, encoding: "utf-8", timeout: timeoutMs },
  )
  const elapsedMs = performance.now() - started
  const lines = (outcome.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  let payload: WorkerRun["payload"] = null
  try {
    payload = JSON.parse(lines[lines.length - 1] ?? "null")
  } catch {
    payload = null
  }
  return { outcome, elapsedMs, payload }
}

function expectBoundedWorkerCompleted(run: WorkerRun, timeoutMs: number): string {
  expect(run.outcome.error).toBeUndefined()
  expect(run.outcome.signal).toBeNull()
  expect(run.outcome.status).toBe(0)
  expect(run.payload).not.toBeNull()
  expect(run.elapsedMs).toBeLessThan(timeoutMs)
  const payload = run.payload as
    | { outcome: "returned"; output: string }
    | { outcome: "threw"; name: string; message: string }
  expect(payload.outcome).toBe("returned")
  return String((payload as { output?: string }).output)
}

// ---------------------------------------------------------------------------
// Shared workspace
// ---------------------------------------------------------------------------

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-138-audit-origin-"))
  project = join(base, "project")
  mkdirSync(project, { recursive: true })
  writeFileSync(join(base, "audit-worker.mjs"), AUDIT_WORKER_SOURCE, "utf-8")
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const bancaDir = (): string => join(project, ".banca")
const configFile = (): string => join(bancaDir(), "project.json")

function writeExternalFile(relativePath: string, content: string): string {
  const target = join(base, relativePath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, "utf-8")
  return target
}

// ---------------------------------------------------------------------------
// 1. Historical audit flow is preserved for legitimate configurations.
// ---------------------------------------------------------------------------

describe("issue #138 — legitimate configuration keeps the audit flow", () => {
  test("regular configuration yields the historical batch receipt", async () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const { plan, planId, args } = validReceiptArgs(project)
    const before = treeSnapshot(project)

    const output = await runAudit(project, args)

    expect(output.startsWith("{")).toBe(true)
    const receipt = JSON.parse(output)
    expect(receipt.kind).toBe(AUDIT_RECEIPT_KIND)
    expect(receipt.planId).toBe(planId)
    expect(receipt.manuscriptFingerprint).toBe(plan.fingerprint)
    expect(receipt.acceptedCount).toBe(1)
    expect(receipt.findings).toHaveLength(1)
    expect(output).not.toContain(project)

    const after = treeSnapshot(project)
    const findingsRel = relative(
      project,
      join(project, ".banca", "analysis", "findings", `${planId}.json`),
    )
      .split(sep)
      .join("/")
    expect(after[findingsRel]).toMatch(/^file:[0-9a-f]{64}$/)
    // The receipt is the only intended effect: manuscript and config untouched.
    expect(after["main.tex"]).toBe(before["main.tex"])
    expect(after[".banca/project.json"]).toBe(before[".banca/project.json"])
  })

  test("truly absent configuration degrades to defaults and reaches the plan", async () => {
    writeManuscript(project)
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertHistoricalPlanReached(output)
    expect(treeSnapshot(project)).toEqual(before)
  })

  test("malformed JSON in an authorized internal file keeps defaults contract", async () => {
    writeManuscript(project)
    mkdirSync(bancaDir(), { recursive: true })
    writeFileSync(configFile(), "{ invalid }", "utf-8")
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertHistoricalPlanReached(output)
    expect(treeSnapshot(project)).toEqual(before)
  })

  test("blocked exhaustive plan still returns blocked_plan without writes", async () => {
    writeBlockedManuscript(project)
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    expect(output.startsWith("audit validation error\n")).toBe(true)
    expect(errorCode(output)).toBe("blocked_plan")
    expect(output).not.toContain("unexpected")
    expect(output).toContain("diagnostics:")
    expect(treeSnapshot(project)).toEqual(before)
  })

  stest("internal configuration symlink keeps the legitimate audit flow", async () => {
    writeManuscript(project)
    writeTree(project, {
      "configs/project-real.json": JSON.stringify({ version: 1, targetScore: 8.5 }),
    })
    mkdirSync(bancaDir(), { recursive: true })
    const target = join(project, "configs", "project-real.json")
    symlinkSync(target, configFile(), "file")
    const targetHash = sha256(target)
    const { args } = validReceiptArgs(project)

    const output = await runAudit(project, args)

    expect(output.startsWith("{")).toBe(true)
    expect(JSON.parse(output).kind).toBe(AUDIT_RECEIPT_KIND)
    expect(sha256(target)).toBe(targetHash)
  })
})

// ---------------------------------------------------------------------------
// 2. Insecure configuration origins get a controlled, sanitized refusal.
// ---------------------------------------------------------------------------

describe("issue #138 — insecure configuration origins are refused", () => {
  stest("broken project.json symlink is refused as unsafe_origin", async () => {
    writeManuscript(project)
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync("../no-such-dir/project.json", configFile(), "file")
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [base, "no-such-dir"])
    expect(treeSnapshot(project)).toEqual(before)
  })

  stest("broken .banca ancestor symlink is refused as unsafe_origin", async () => {
    writeManuscript(project)
    symlinkSync("../no-such-banca", bancaDir(), "dir")
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [base, "no-such-banca"])
    expect(treeSnapshot(project)).toEqual(before)
  })

  stest("external project.json symlink is refused without reading or leaking it", async () => {
    writeManuscript(project)
    const outside = writeExternalFile("outside/project.json", EXTERNAL_CONFIG)
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync(outside, configFile(), "file")
    const before = treeSnapshot(project)
    const outsideHash = sha256(outside)

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [base, outside, "outside"])
    expect(sha256(outside)).toBe(outsideHash)
    expect(readFileSync(outside, "utf-8")).toBe(EXTERNAL_CONFIG)
    expect(treeSnapshot(project)).toEqual(before)
  })

  stest("external .banca ancestor symlink is refused without reading it", async () => {
    writeManuscript(project)
    writeExternalFile("outside/project.json", EXTERNAL_CONFIG)
    symlinkSync(join(base, "outside"), bancaDir(), "dir")
    const before = treeSnapshot(project)
    const outsideHash = sha256(join(base, "outside", "project.json"))

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [base, "outside"])
    expect(sha256(join(base, "outside", "project.json"))).toBe(outsideHash)
    expect(treeSnapshot(project)).toEqual(before)
  })

  test("directory at the configuration destination is refused as unsafe_origin", async () => {
    writeManuscript(project)
    mkdirSync(configFile(), { recursive: true })
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [project])
    expect(treeSnapshot(project)).toEqual(before)
  })

  test("non-directory .banca ancestor is refused as unsafe_origin", async () => {
    writeManuscript(project)
    writeFileSync(bancaDir(), "not a directory\n", "utf-8")
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [project])
    expect(treeSnapshot(project)).toEqual(before)
  })

  fifoTest("FIFO configuration destination is refused without a blocking read", () => {
    writeManuscript(project)
    mkdirSync(bancaDir(), { recursive: true })
    expect(spawnSync("mkfifo", [configFile()]).status).toBe(0)
    const before = treeSnapshot(project)
    const timeoutMs = 10_000

    const output = expectBoundedWorkerCompleted(
      runBoundedWorker(base, "audit-worker.mjs", "none", project, timeoutMs),
      timeoutMs,
    )

    assertConfigRefusal(output, "unsafe_origin", [project])
    expect(lstatSync(configFile()).isFIFO()).toBe(true)
    expect(treeSnapshot(project)).toEqual(before)
  })

  unixSocketTest("UNIX socket configuration destination is refused", async () => {
    writeManuscript(project)
    mkdirSync(bancaDir(), { recursive: true })
    const socketPath = configFile()
    const server = createServer()
    try {
      await new Promise<void>((resolveListen, reject) => {
        server.once("error", reject)
        server.listen(socketPath, () => resolveListen())
      })
      const before = treeSnapshot(project)
      const timeoutMs = 10_000

      const output = expectBoundedWorkerCompleted(
        runBoundedWorker(base, "audit-worker.mjs", "none", project, timeoutMs),
        timeoutMs,
      )

      assertConfigRefusal(output, "unsafe_origin", [project])
      expect(lstatSync(socketPath).isSocket()).toBe(true)
      expect(treeSnapshot(project)).toEqual(before)
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
  })

  unreadableTest("present but unreadable configuration is refused as unreadable_origin", async () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const before = treeSnapshot(project)
    chmodSync(configFile(), 0o000)
    let output: string
    try {
      let rawCode: string | undefined
      try {
        readFileSync(configFile(), "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      output = await runAudit(project, historicalMismatchArgs())
    } finally {
      chmodSync(configFile(), 0o644)
    }

    assertConfigRefusal(output, "unreadable_origin", [project])
    expect(treeSnapshot(project)).toEqual(before)
  })

  unreadableTest("uninspectable .banca ancestor is refused as unsafe_origin", async () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const before = treeSnapshot(project)
    chmodSync(bancaDir(), 0o000)
    let output: string
    try {
      let rawCode: string | undefined
      try {
        readFileSync(configFile(), "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      output = await runAudit(project, historicalMismatchArgs())
    } finally {
      chmodSync(bancaDir(), 0o755)
    }

    assertConfigRefusal(output, "unsafe_origin", [project])
    expect(treeSnapshot(project)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// 3. Ordering and genuine unexpected errors.
// ---------------------------------------------------------------------------

describe("issue #138 — classification fidelity and ordering", () => {
  stest("configuration refusal precedes manuscript planning errors", async () => {
    // No manuscript at all: the only reason not to plan is the refused config.
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync("../no-such-dir/project.json", configFile(), "file")
    const before = treeSnapshot(project)

    const output = await runAudit(project, historicalMismatchArgs())

    assertConfigRefusal(output, "unsafe_origin", [base, "no-such-dir"])
    expect(output).not.toContain("blocked_plan")
    expect(treeSnapshot(project)).toEqual(before)
  })

  test("generic configuration exception remains unexpected", () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const timeoutMs = 10_000

    const output = expectBoundedWorkerCompleted(
      runBoundedWorker(base, "audit-worker.mjs", "generic-config", project, timeoutMs),
      timeoutMs,
    )

    assertUnexpected(output)
  })

  test("generic planning exception remains unexpected", () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const timeoutMs = 10_000

    const output = expectBoundedWorkerCompleted(
      runBoundedWorker(base, "audit-worker.mjs", "generic-planning", project, timeoutMs),
      timeoutMs,
    )

    assertUnexpected(output)
  })

  test("unrelated PathTraversalError from configuration loading remains unexpected", () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const timeoutMs = 10_000

    const output = expectBoundedWorkerCompleted(
      runBoundedWorker(base, "audit-worker.mjs", "unrelated-traversal", project, timeoutMs),
      timeoutMs,
    )

    assertUnexpected(output)
  })

  test("a path-refusal message with the config prefix but unlisted stays unexpected", () => {
    // Exact-match contract: only the three fixed #134 messages are classified.
    // A prefix-only classifier would wrongly turn this into a refusal.
    writeManuscript(project)
    writeProjectConfig(project)
    const timeoutMs = 10_000

    const output = expectBoundedWorkerCompleted(
      runBoundedWorker(base, "audit-worker.mjs", "unlisted-config-refusal", project, timeoutMs),
      timeoutMs,
    )

    assertUnexpected(output)
  })

  test("inspection_failed is mapped from the explicit configuration contract", () => {
    writeManuscript(project)
    writeProjectConfig(project)
    const timeoutMs = 10_000

    const output = expectBoundedWorkerCompleted(
      runBoundedWorker(base, "audit-worker.mjs", "inspection-failed", project, timeoutMs),
      timeoutMs,
    )

    assertConfigRefusal(output, "inspection_failed")
  })
})
