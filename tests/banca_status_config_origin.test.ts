/**
 * Issue #137 — `banca_status` must distinguish a legitimately absent
 * configuration from a present-but-unauthorized/unreadable configuration
 * origin.
 *
 * Historical defect: the tool gated the configuration with
 * `existsSync(join(root, ".banca", "project.json"))`. `existsSync` follows
 * links, so a broken symlink (or a broken/foreign `.banca` ancestor) degraded
 * to `not initialized — run /banca:init first`, masking an insecure origin and
 * recommending initialization. External links, non-regular destinations and
 * read failures surfaced as a raw `PathTraversalError`.
 *
 * The fix reuses the canonical origin contract already exposed by
 * `validateConfig` (issue #134): `config not found` is legitimate absence,
 * `config refused: ...` is a controlled origin/read refusal, and any other
 * validation error is a content error inside an authorized regular file which
 * keeps the historical `loadConfig` defaults contract.
 *
 * The whole matrix runs the real tool against a synthetic workspace on the
 * real filesystem. Every scenario asserts a complete recursive inventory
 * (kind + link target + SHA-256 of regular files) is unchanged, so a status
 * call cannot create, rewrite or repoint anything. FIFO/socket scenarios run
 * in a bounded child process: a timeout is never accepted as a refusal.
 *
 * No DSH host, model, network, LaTeX engine or real manuscript is involved.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
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
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { bancaStatus } from "../src/tools/banca_status"
import { PathTraversalError } from "../src/lib/safe_paths"

/** The exact historical message for a legitimately absent configuration. */
const NOT_INITIALIZED = "not initialized — run /banca:init first"

/** Synthetic token that must never reach a configuration refusal. */
const CONFIG137_SECRET = "SEGREDO_CONFIG_ORIGEM_NAO_DEVE_VAZAR"

/** External configuration fixture with a canary token and a foreign target. */
const CONFIG137_EXTERNAL = JSON.stringify({
  version: 1,
  targetScore: 7.3,
  manuscript: { main: "externo-inexistente.tex" },
  immutableFacts: [CONFIG137_SECRET],
})

/** Raw filesystem fragments that must never surface in a refusal. */
const CONFIG137_RAW_FRAGMENTS = [
  "EACCES",
  "EPERM",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
  "ENXIO",
  "permission denied",
  "no such file",
  "illegal operation",
  "open '",
]

const TOOL_URL = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_status.ts")).href

const symlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-137-link-probe-"))
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
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-137-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

const fifoTest = mkfifoSupported && symlinksSupported ? stest : test.skip

const unreadableSupported =
  process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0

const unreadableTest = unreadableSupported ? test : test.skip

const unixSocketTest = process.platform === "win32" ? test.skip : test

/** Child that executes the real tool in a bounded process (FIFO/socket/relative roots). */
const STATUS_WORKER_SOURCE = `
const toolUrl = process.argv[2]
const root = process.argv[3]
const { bancaStatus } = await import(toolUrl)
let payload
try {
  const output = await bancaStatus.execute({ projectRoot: root }, { directory: root })
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

/**
 * Complete recursive inventory: relative path -> kind, link target and SHA-256
 * of regular-file bytes. Equality proves the status call created, rewrote or
 * repointed nothing.
 */
function config137TreeSnapshot(rootDir: string): Record<string, string> {
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
        snapshot[rel] = `file:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`
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

function config137Sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

type StatusCall =
  | { outcome: "returned"; output: string }
  | { outcome: "threw"; error: Error }

/** Execute the real tool and keep a thrown result distinguishable. */
async function callStatus(root: string): Promise<StatusCall> {
  try {
    const output = await bancaStatus.execute({ projectRoot: root }, { directory: root } as never)
    return { outcome: "returned", output: String(output) }
  } catch (error) {
    return { outcome: "threw", error: error as Error }
  }
}

/** Execute the tool and require a returned value; throw with context otherwise. */
async function runStatus(root: string): Promise<string> {
  const result = await callStatus(root)
  if (result.outcome === "threw") {
    throw new Error(`status threw unexpectedly: ${result.error.name}: ${result.error.message}`)
  }
  return result.output
}

/**
 * Controlled, sanitized refusal contract: returned (not thrown), never absence,
 * never a partial/successful status, and free of host paths, link targets,
 * external content or raw filesystem diagnostics.
 */
function expectSanitizedConfigRefusal(output: string, forbidden: string[] = []): void {
  expect(output.startsWith("blocked: config refused:")).toBe(true)
  expect(output).not.toContain(NOT_INITIALIZED)
  expect(output).not.toContain("/banca:init")
  expect(output).not.toContain("Score:")
  expect(output).not.toContain("✓")
  expect(output.split("\n").length).toBe(1)
  for (const fragment of [
    CONFIG137_SECRET,
    "externo-inexistente.tex",
    ...CONFIG137_RAW_FRAGMENTS,
    ...forbidden,
  ]) {
    expect(output).not.toContain(fragment)
  }
  expect(output).not.toContain(" at ")
  expect(output).not.toContain("Error:")
}

type WorkerRun = {
  outcome: ReturnType<typeof spawnSync>
  elapsedMs: number
  payload:
    | { outcome: "returned"; output: string }
    | { outcome: "threw"; name: string; message: string }
    | { outcome: "returned"; score: number | null }
    | null
}

/** Run a helper script with an explicit time bound; a timeout is reported, never accepted. */
function runBoundedWorker(
  baseDir: string,
  scriptName: string,
  source: string,
  argument: string,
  timeoutMs: number,
): WorkerRun {
  const scriptPath = join(baseDir, scriptName)
  writeFileSync(scriptPath, source, "utf-8")
  const started = performance.now()
  const outcome = spawnSync(process.execPath, [scriptPath, TOOL_URL, argument], {
    cwd: baseDir,
    encoding: "utf-8",
    timeout: timeoutMs,
  })
  const elapsedMs = performance.now() - started
  const lines = (outcome.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean)
  let payload: WorkerRun["payload"] = null
  try {
    payload = JSON.parse(lines[lines.length - 1] ?? "null")
  } catch {
    payload = null
  }
  return { outcome, elapsedMs, payload }
}

function expectBoundedWorkerCompleted(run: WorkerRun, timeoutMs: number): void {
  expect(run.outcome.error).toBeUndefined()
  expect(run.outcome.signal).toBeNull()
  expect(run.outcome.status).toBe(0)
  expect(run.payload).not.toBeNull()
  expect(run.elapsedMs).toBeLessThan(timeoutMs)
}

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-137-status-origin-"))
  project = join(base, "project")
  mkdirSync(project, { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const bancaDir = (): string => join(project, ".banca")
const configFile = (): string => join(bancaDir(), "project.json")
const projectState = (): string => join(bancaDir(), "state.json")

/** Minimal synthetic manuscript so a legitimate status can be complete. */
function createManuscript(root: string = project): void {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "main.tex"), "\\documentclass{article}\\begin{document}Sintético\\end{document}\n", "utf-8")
  writeFileSync(join(root, "referencias.bib"), "@book{sintetica2026, title={Sintético}}\n", "utf-8")
  mkdirSync(join(root, "capitulos"), { recursive: true })
  writeFileSync(join(root, "capitulos", "cap1.tex"), "\\chapter{Sintético}\n", "utf-8")
}

function createProject(root: string = project): void {
  createManuscript(root)
  mkdirSync(join(root, ".banca"), { recursive: true })
}

function writeInternalConfig(content: string): void {
  mkdirSync(bancaDir(), { recursive: true })
  writeFileSync(configFile(), content, "utf-8")
}

function writeExternalFile(relativePath: string, content: string): string {
  const target = join(base, relativePath)
  mkdirSync(join(target, ".."), { recursive: true })
  writeFileSync(target, content, "utf-8")
  return target
}

function expectCompleteStatus(output: string, targetScore: number, reports: number, iterations: number): void {
  const lines = output.split("\n")
  expect(lines.length).toBe(8)
  expect(lines[0].startsWith("Score: ")).toBe(true)
  expect(lines[0].endsWith(` / ${targetScore}`)).toBe(true)
  expect(lines[1]).toBe(`Main:  ${join(project, "main.tex")} ✓`)
  expect(lines[2]).toBe(`Bib:   ${join(project, "referencias.bib")} ✓`)
  expect(lines[3]).toBe(`Chapters: 1`)
  expect(lines[4]).toBe(`Reports: ${reports}`)
  expect(lines[5]).toBe(`Compile: lualatex`)
  expect(lines[6]).toBe(`Iterations: ${iterations}`)
  expect(lines[7].startsWith("Last audit: ")).toBe(true)
}

// ---------------------------------------------------------------------------
// 1. True absence keeps the exact historical message and creates no state.
// ---------------------------------------------------------------------------

describe("issue #137 — legitimate absence", () => {
  test("returns the exact historical message when .banca does not exist and mutates nothing", async () => {
    createManuscript()
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expect(output).toBe(NOT_INITIALIZED)
    expect(config137TreeSnapshot(project)).toEqual(before)
    expect(existsSync(bancaDir())).toBe(false)
  })

  test("returns the exact historical message when .banca exists but project.json is absent", async () => {
    createProject()
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expect(output).toBe(NOT_INITIALIZED)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// 2. Authorized internal regular configuration keeps the complete status.
// ---------------------------------------------------------------------------

describe("issue #137 — authorized configuration keeps historical status", () => {
  test("reports the complete historical status and field order for a regular config", async () => {
    createProject()
    writeFileSync(configFile(), JSON.stringify({ version: 1, targetScore: 8.5 }), "utf-8")
    writeFileSync(
      projectState(),
      JSON.stringify({
        currentScore: 6.5,
        lastAudit: "2026-01-02T00:00:00Z",
        lastLoop: null,
        snapshots: [],
        iterations: [
          { date: "2026-01-02T00:00:00Z", action: "loop", scoreBefore: 6, scoreAfter: 6.5, status: "ok" },
        ],
      }),
      "utf-8",
    )
    mkdirSync(join(bancaDir(), "reports"), { recursive: true })
    writeFileSync(join(bancaDir(), "reports", "r1.md"), "relatório sintético 1\n", "utf-8")
    writeFileSync(join(bancaDir(), "reports", "r2.md"), "relatório sintético 2\n", "utf-8")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expectCompleteStatus(output, 8.5, 2, 1)
    expect(output).toContain("Score: 6.5 / 8.5")
    expect(output).not.toContain("Last audit: —")
    expect(output).not.toContain("blocked:")
    expect(output).not.toContain(NOT_INITIALIZED)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  test("keeps the historical defaults contract for malformed JSON in an internal regular file", async () => {
    createProject()
    writeInternalConfig("{ invalid }")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expect(output).not.toContain("blocked:")
    expect(output).not.toContain(NOT_INITIALIZED)
    expectCompleteStatus(output, 9, 0, 0)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  test("keeps the historical sanitized read for content-invalid configuration without refusing the origin", async () => {
    createProject()
    // `validateConfig` flags targetScore 15, but the origin is an authorized
    // internal regular file: `loadConfig` clamps it, as before.
    writeInternalConfig(JSON.stringify({ version: 1, targetScore: 15 }))
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expect(output).not.toContain("blocked:")
    expect(output).not.toContain(NOT_INITIALIZED)
    expectCompleteStatus(output, 10, 0, 0)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  test("does not classify a content error that begins like a refusal as an origin refusal", async () => {
    createProject()
    // Invalid JSON whose text starts with the refusal prefix: the parser error
    // is a content error, never an origin refusal.
    writeInternalConfig("config refused: this is invalid JSON content, not an origin")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expect(output).not.toContain("blocked:")
    expect(output).not.toContain(NOT_INITIALIZED)
    expectCompleteStatus(output, 9, 0, 0)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  stest("authorizes a symbolic link whose canonical destination stays inside the workspace", async () => {
    createProject()
    const internalTarget = join(project, "configs", "project-real.json")
    mkdirSync(join(project, "configs"), { recursive: true })
    writeFileSync(internalTarget, JSON.stringify({ version: 1, targetScore: 7.5 }), "utf-8")
    symlinkSync(internalTarget, configFile(), "file")
    const before = config137TreeSnapshot(project)
    const targetHash = config137Sha256(internalTarget)

    const output = await runStatus(project)

    expectCompleteStatus(output, 7.5, 0, 0)
    expect(config137TreeSnapshot(project)).toEqual(before)
    expect(config137Sha256(internalTarget)).toBe(targetHash)
  })
})

// ---------------------------------------------------------------------------
// 3. Insecure origins: controlled, sanitized refusal instead of "not
//    initialized" or a raw exception, before state/manuscript/reports.
// ---------------------------------------------------------------------------

describe("issue #137 — insecure configuration origins are refused, not reported as absent", () => {
  stest("refuses a broken project.json symlink instead of 'not initialized'", async () => {
    createProject()
    symlinkSync("../no-such-dir/project.json", configFile(), "file")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expectSanitizedConfigRefusal(output, [base])
    expect(output).not.toContain("no-such-dir")
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  stest("refuses a broken .banca ancestor symlink instead of 'not initialized'", async () => {
    createManuscript()
    symlinkSync("../no-such-banca", bancaDir(), "dir")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expectSanitizedConfigRefusal(output, [base])
    expect(output).not.toContain("no-such-banca")
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  stest("refuses a project.json symlink to an external file without reading or leaking it", async () => {
    createProject()
    const outsideConfig = writeExternalFile("outside/project.json", CONFIG137_EXTERNAL)
    symlinkSync(outsideConfig, configFile(), "file")
    const before = config137TreeSnapshot(project)
    const outsideHash = config137Sha256(outsideConfig)

    const output = await runStatus(project)

    expectSanitizedConfigRefusal(output, [base, outsideConfig, "outside"])
    expect(config137TreeSnapshot(project)).toEqual(before)
    expect(config137Sha256(outsideConfig)).toBe(outsideHash)
    expect(readFileSync(outsideConfig, "utf-8")).toBe(CONFIG137_EXTERNAL)
  })

  stest("refuses an external .banca ancestor symlink with a sanitized refusal", async () => {
    createManuscript()
    writeExternalFile("outside/project.json", CONFIG137_EXTERNAL)
    symlinkSync(join(base, "outside"), bancaDir(), "dir")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expectSanitizedConfigRefusal(output, [base, "outside"])
    expect(config137TreeSnapshot(project)).toEqual(before)
    expect(readFileSync(join(base, "outside", "project.json"), "utf-8")).toBe(CONFIG137_EXTERNAL)
  })

  test("refuses a project.json destination that is a directory", async () => {
    createProject()
    mkdirSync(configFile(), { recursive: true })
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expectSanitizedConfigRefusal(output)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  test("refuses a non-directory .banca ancestor instead of reporting absence", async () => {
    createManuscript()
    writeFileSync(bancaDir(), "not a directory\n", "utf-8")
    const before = config137TreeSnapshot(project)

    const output = await runStatus(project)

    expectSanitizedConfigRefusal(output)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  fifoTest("refuses a FIFO configuration destination without a blocking read", () => {
    createProject()
    expect(spawnSync("mkfifo", [configFile()]).status).toBe(0)
    const before = config137TreeSnapshot(project)
    const timeoutMs = 10_000

    const run = runBoundedWorker(base, "status-fifo-worker.mjs", STATUS_WORKER_SOURCE, project, timeoutMs)

    expectBoundedWorkerCompleted(run, timeoutMs)
    const payload = run.payload as { outcome: string; output?: string }
    expect(payload.outcome).toBe("returned")
    expectSanitizedConfigRefusal(String(payload.output))
    expect(config137TreeSnapshot(project)).toEqual(before)
    expect(lstatSync(configFile()).isFIFO()).toBe(true)
  })

  unixSocketTest("refuses a UNIX socket configuration destination without a blocking read", async () => {
    createProject()
    const socketPath = configFile()
    const server = createServer()
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(socketPath, () => resolve())
      })
      const before = config137TreeSnapshot(project)
      const timeoutMs = 10_000

      const run = runBoundedWorker(base, "status-socket-worker.mjs", STATUS_WORKER_SOURCE, project, timeoutMs)

      expectBoundedWorkerCompleted(run, timeoutMs)
      const payload = run.payload as { outcome: string; output?: string }
      expect(payload.outcome).toBe("returned")
      expectSanitizedConfigRefusal(String(payload.output))
      expect(config137TreeSnapshot(project)).toEqual(before)
      expect(lstatSync(socketPath).isSocket()).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  unreadableTest("refuses a present configuration that cannot be read instead of degrading it", async () => {
    createProject()
    writeInternalConfig(JSON.stringify({ version: 1, targetScore: 7.5 }))
    const before = config137TreeSnapshot(project)
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

      output = await runStatus(project)
    } finally {
      chmodSync(configFile(), 0o644)
    }

    expect(output.startsWith("blocked: config refused:")).toBe(true)
    expect(output).toContain("could not be read")
    expect(output).not.toContain(NOT_INITIALIZED)
    expect(output).not.toContain("Score:")
    for (const fragment of ["EACCES", "permission denied", base]) {
      expect(output).not.toContain(fragment)
    }
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  unreadableTest("refuses an uninspectable .banca ancestor instead of reporting absence", async () => {
    createProject()
    writeInternalConfig(JSON.stringify({ version: 1, targetScore: 7.5 }))
    const before = config137TreeSnapshot(project)
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

      output = await runStatus(project)
    } finally {
      chmodSync(bancaDir(), 0o755)
    }

    expect(output.startsWith("blocked: config refused:")).toBe(true)
    expect(output).toContain("not a safe regular file inside the workspace")
    expect(output).not.toContain(NOT_INITIALIZED)
    expect(output).not.toContain("Score:")
    for (const fragment of ["EACCES", "permission denied", base]) {
      expect(output).not.toContain(fragment)
    }
    expect(config137TreeSnapshot(project)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// 4. Ordering and error classification: the refusal is earlier than state,
//    paths and reports; unrelated errors are not reclassified.
// ---------------------------------------------------------------------------

describe("issue #137 — refusal ordering and unexpected errors", () => {
  stest("refuses the configuration origin before reading state or inspecting reports", async () => {
    createProject()
    symlinkSync("../no-such-dir/project.json", configFile(), "file")
    // A state whose read would be refused by #136 and a reports path that
    // would make readdirSync throw ENOTDIR: neither may be reached.
    const outsideState = writeExternalFile("outside/state.json", '{"currentScore":7.3}')
    symlinkSync(outsideState, projectState(), "file")
    writeFileSync(join(bancaDir(), "reports"), "not a directory\n", "utf-8")
    const before = config137TreeSnapshot(project)

    const result = await callStatus(project)

    expect(result.outcome).toBe("returned")
    if (result.outcome !== "returned") return
    expectSanitizedConfigRefusal(result.output, [base])
    expect(result.output).not.toContain("state")
    expect(config137TreeSnapshot(project)).toEqual(before)
  })

  stest("propagates a state origin refusal instead of reclassifying it as config absence", async () => {
    createProject()
    writeInternalConfig(JSON.stringify({ version: 1, targetScore: 7.5 }))
    const outsideState = writeExternalFile("outside/state.json", '{"currentScore":7.3}')
    symlinkSync(outsideState, projectState(), "file")
    const before = config137TreeSnapshot(project)

    const result = await callStatus(project)

    expect(result.outcome).toBe("threw")
    if (result.outcome !== "threw") return
    expect(result.error).toBeInstanceOf(PathTraversalError)
    expect(result.error.message).toContain("state refused")
    expect(result.error.message).not.toContain(NOT_INITIALIZED)
    expect(config137TreeSnapshot(project)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// 5. Root semantics: explicit absolute and relative roots share the contract.
// ---------------------------------------------------------------------------

describe("issue #137 — absolute and relative roots share one contract", () => {
  test("relative root produces the same legitimate status as the absolute root", async () => {
    const workspace = join(base, "workspace")
    createProject(workspace)
    writeFileSync(join(workspace, ".banca", "project.json"), JSON.stringify({ version: 1, targetScore: 7.5 }), "utf-8")
    const before = config137TreeSnapshot(workspace)

    const absoluteOutput = await runStatus(workspace)
    const relativeRun = runBoundedWorker(base, "status-relative-worker.mjs", STATUS_WORKER_SOURCE, "workspace", 10_000)

    expectBoundedWorkerCompleted(relativeRun, 10_000)
    const payload = relativeRun.payload as { outcome: string; output?: string }
    expect(payload.outcome).toBe("returned")
    expect(payload.output).toBe(absoluteOutput)
    expect(absoluteOutput).toContain("Score: — / 7.5")
    expect(config137TreeSnapshot(workspace)).toEqual(before)
  })

  stest("relative root refuses a broken link exactly like the absolute root", async () => {
    const workspace = join(base, "workspace")
    createProject(workspace)
    symlinkSync("../no-such-dir/project.json", join(workspace, ".banca", "project.json"), "file")
    const before = config137TreeSnapshot(workspace)

    const absoluteOutput = await runStatus(workspace)
    const relativeRun = runBoundedWorker(base, "status-relative-worker.mjs", STATUS_WORKER_SOURCE, "workspace", 10_000)

    expectBoundedWorkerCompleted(relativeRun, 10_000)
    const payload = relativeRun.payload as { outcome: string; output?: string }
    expect(payload.outcome).toBe("returned")
    expectSanitizedConfigRefusal(String(payload.output), [base])
    expect(payload.output).toBe(absoluteOutput)
    expect(config137TreeSnapshot(workspace)).toEqual(before)
  })

  test("preserves the ctx.directory fallback when projectRoot is omitted", async () => {
    createProject()
    writeInternalConfig(JSON.stringify({ version: 1, targetScore: 7.5 }))

    const output = String(await bancaStatus.execute({}, { directory: project } as never))

    expectCompleteStatus(output, 7.5, 0, 0)
  })

  stest("preserves the ctx.directory fallback refusal for a broken configuration link", async () => {
    createProject()
    symlinkSync("../no-such-dir/project.json", configFile(), "file")
    const before = config137TreeSnapshot(project)

    const output = String(await bancaStatus.execute({}, { directory: project } as never))

    expectSanitizedConfigRefusal(output, [base])
    expect(config137TreeSnapshot(project)).toEqual(before)
  })
})
