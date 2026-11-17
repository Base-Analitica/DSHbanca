/**
 * Focal tests for issue #163 — canonical read boundary for the `banca_loop`
 * main manuscript.
 *
 * `resolveManuscriptPaths` is lexical, so the pre-fix tool followed a symbolic
 * link planted at `main.tex` (or at an ancestor / the configured manuscript
 * root) and read bytes from outside the workspace, feeding them into the
 * heuristic score, the marker snapshot, the report and the iteration history.
 *
 * These tests exercise the REAL tool over synthetic scratch workspaces only:
 * no DSH host, no model, no network, no credentials, no real manuscript and no
 * external subprocess beyond the bounded workers used for the FIFO and
 * relative-root scenarios. External fixtures are synthetic siblings of the
 * scratch workspace and are removed by the same `afterEach` teardown.
 *
 * Coverage:
 * - refusals: external leaf link, external ancestor link, external configured
 *   root, broken link, directory and FIFO destinations, plus sanitized
 *   refusal of lexically unsafe configured paths;
 * - absence: a truly missing main file keeps the historical
 *   `main file not found` behavior, never confused with an unsafe origin;
 * - positives: regular internal main (absolute, relative, `./`, nested root),
 *   internal main link and internal ancestor link, with the same heuristic
 *   score as the baseline computation;
 * - preservation: heuristic scores, threshold branch, non-restorable marker,
 *   report, iteration history and both circuit breakers;
 * - read-only proof: full recursive inventory/hashes before and after every
 *   refusal, and untouched external fixtures.
 *
 * Residual TOCTOU limits (documented, not claimed as solved): the canonical
 * inspection happens immediately before the read, but a concurrent mutation
 * between the two calls is not defended against. Hard links to an external
 * inode are path-indistinguishable and are out of scope of this boundary.
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
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { analyzeCitationDensity } from "../src/lib/citation"
import { ChapterDiscoveryError } from "../src/lib/paths"
import { loadSnapshotManifest } from "../src/lib/snapshot"

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const symlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-163-link-probe-"))
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

/** Symlink scenarios are skipped only on filesystems without symlink support. */
const stest = symlinksSupported ? test : test.skip

const mkfifoSupported = (() => {
  if (process.platform === "win32") return false
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-163-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

/**
 * A FIFO would block `readFileSync`; the scenario runs the tool in a bounded
 * child process so a regression fails by timeout instead of hanging the suite.
 */
const fifoTest = mkfifoSupported ? stest : test.skip

/** chmod 000 only denies reads for a non-privileged process. */
const unreadableTestSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0
const unreadableTest = unreadableTestSupported ? test : test.skip

/** Synthetic token that must never appear in a refusal diagnostic. */
const OUTSIDE_SECRET = "SEGREDO_SINTETICO_EXTERNO_163_NAO_DEVE_VAZAR"

/** External synthetic manuscript: five cited paragraphs => heuristic score 8. */
const OUTSIDE_MAIN =
  [
    "O parágrafo 1 desenvolve a fundamentação teórica com \\cite{chaveExterna163} segundo a literatura sintética de referência.",
    "O parágrafo 2 desenvolve a fundamentação teórica com \\cite{chaveExterna163} segundo a literatura sintética de referência.",
    "O parágrafo 3 desenvolve a fundamentação teórica com \\cite{chaveExterna163} segundo a literatura sintética de referência.",
    "O parágrafo 4 desenvolve a fundamentação teórica com \\cite{chaveExterna163} segundo a literatura sintética de referência.",
    "O parágrafo 5 desenvolve a fundamentação teórica com \\cite{chaveExterna163} segundo a literatura sintética de referência.",
  ].join("\n\n") +
  `\n% ${OUTSIDE_SECRET}\n`

/** Indicators derived from an external manuscript that must not leak out. */
const FORBIDDEN_REFUSAL_FRAGMENTS = [
  OUTSIDE_SECRET,
  "Loop iteration",
  "Heuristic citation score",
  "Citations:",
  "Snapshot:",
  "Report:",
  "circuit breaker",
]

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-163-loop-"))
  project = join(base, "project")
  mkdirSync(project, { recursive: true })
  mkdirSync(join(project, ".banca"), { recursive: true })
})

afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

function writeProjectConfig(
  options: {
    root?: string
    main?: string
    chapters?: string[]
    targetScore?: number
  } = {},
): void {
  mkdirSync(join(project, ".banca"), { recursive: true })
  const config = {
    version: 1,
    manuscript: {
      format: "latex",
      root: options.root ?? ".",
      main: options.main ?? "main.tex",
      bib: "refs.bib",
      chapters: options.chapters ?? ["capitulos/*.tex"],
      outputDir: "trabalhos",
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: options.targetScore ?? 9,
    providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
    mcp: { crossrefAcademicEnabled: false },
  }
  writeFileSync(join(project, ".banca", "project.json"), JSON.stringify(config, null, 2), "utf-8")
}

function writeFile(relativePath: string, content: string): string {
  const path = join(project, relativePath)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content, "utf-8")
  return path
}

/** Write a synthetic fixture beside the workspace (outside the project root). */
function writeExternal(relativePath: string, content: string): string {
  const path = join(base, relativePath)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content, "utf-8")
  return path
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function sha256OfFile(path: string): string {
  return sha256(readFileSync(path))
}

/**
 * Complete recursive inventory of a scratch tree: relative path -> kind.
 * Directories, symlink targets and SHA-256 of regular-file bytes are recorded,
 * so equality proves nothing was created, removed, rewritten or repointed.
 */
function inventory(rootDir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(rootDir, abs).split(sep).join("/")
      const stat = lstatSync(abs)
      if (stat.isSymbolicLink()) snapshot[rel] = `symlink:${readlinkSync(abs)}`
      else if (stat.isDirectory()) {
        snapshot[rel] = "dir"
        visit(abs)
      } else if (stat.isFile()) snapshot[rel] = `file:${sha256OfFile(abs)}`
      else snapshot[rel] = "special"
    }
  }
  visit(rootDir)
  return snapshot
}

// ---------------------------------------------------------------------------
// Manuscript content and state helpers
// ---------------------------------------------------------------------------
function citedParagraph(index: number): string {
  return `O parágrafo ${index} desenvolve a fundamentação teórica com \\cite{chaveInexistente} sem que a chave exista na bibliografia sintética.`
}

function uncitedParagraph(index: number): string {
  return `O parágrafo ${index} apresenta a síntese parcial do capítulo sem qualquer chamada bibliográfica neste trecho sintético.`
}

/** Main manuscript with `cited` cited blocks and `uncited` uncited blocks. */
function mainTex(cited: number, uncited: number): string {
  const paragraphs: string[] = []
  for (let index = 1; index <= cited; index++) paragraphs.push(citedParagraph(index))
  for (let index = cited + 1; index <= cited + uncited; index++) {
    paragraphs.push(uncitedParagraph(index))
  }
  return paragraphs.join("\n\n") + "\n"
}

function statePath(): string {
  return join(project, ".banca", "state.json")
}

function reportsDir(): string {
  return join(project, ".banca", "reports")
}

function snapshotsDir(): string {
  return join(project, ".banca", "snapshots")
}

function reportFiles(): string[] {
  if (!existsSync(reportsDir())) return []
  return readdirSync(reportsDir()).filter((file) => file.endsWith(".md"))
}

function readStateJson(): any {
  return JSON.parse(readFileSync(statePath(), "utf-8"))
}

function writeStateJson(state: unknown): void {
  writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8")
}

interface Iteration {
  date: string
  action: string
  scoreBefore: number | null
  scoreAfter: number | null
  status: string
}

function iteration(
  action: string,
  scoreBefore: number | null,
  scoreAfter: number | null,
  status: string,
  date: string,
): Iteration {
  return { date, action, scoreBefore, scoreAfter, status }
}

function seedLoopHistory(currentScore: number, scores: number[]): void {
  const loops: Iteration[] = scores.map((score, index) =>
    iteration(
      "loop",
      index === 0 ? null : scores[index - 1],
      score,
      "ok",
      `2026-01-0${index + 1}T00:00:00.000Z`,
    ),
  )
  writeStateJson({
    currentScore,
    lastAudit: null,
    lastLoop: null,
    snapshots: [],
    iterations: loops,
  })
}

/** Snapshot project footprint used by effect-free refusal assertions. */
function expectNoLoopArtifacts(): void {
  expect(reportFiles()).toEqual([])
  expect(existsSync(snapshotsDir())).toBe(false)
  expect(existsSync(statePath())).toBe(false)
}

// ---------------------------------------------------------------------------
// Tool invocation (real tool, no mocks)
// ---------------------------------------------------------------------------
async function runLoop(args: { targetScore?: number; projectRoot?: string } = {}): Promise<string> {
  const { bancaLoop } = await import("../src/tools/banca_loop")
  expect(typeof bancaLoop?.execute).toBe("function")
  const executeArgs: Record<string, unknown> = { projectRoot: args.projectRoot ?? project }
  if (args.targetScore !== undefined) executeArgs.targetScore = args.targetScore
  const result = await bancaLoop.execute(executeArgs as any, { directory: project } as any)
  expect(typeof result).toBe("string")
  return String(result)
}

const WORKER_SOURCE = [
  "const toolUrl = process.argv[2]",
  "const args = JSON.parse(process.argv[3])",
  "const ctxDirectory = process.argv[4]",
  "const mod = await import(toolUrl)",
  "try {",
  "  const result = await mod.bancaLoop.execute(args, { directory: ctxDirectory })",
  '  console.log(JSON.stringify({ ok: true, result: String(result) }))',
  "} catch (error) {",
  '  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))',
  "}",
  "",
].join("\n")

interface BoundedLoopResult {
  timedOut: boolean
  parsed: { ok: boolean; result?: string; name?: string; message?: string }
}

/**
 * Execute the real tool in a bounded child process with an explicit cwd. Used
 * for the FIFO destination (a blocking read must not hang the suite) and for
 * the relative `projectRoot` scenario (the tool resolves it against `cwd`).
 * No path, snapshot, state or report mechanism is replaced by a mock.
 */
function writeWorker(workerName: string): string {
  const worker = join(base, workerName)
  writeFileSync(worker, WORKER_SOURCE, "utf-8")
  return worker
}

function boundedLoop(
  cwd: string,
  args: Record<string, unknown>,
  ctxDirectory: string,
  workerName: string,
): BoundedLoopResult {
  const worker = writeWorker(workerName)
  const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_loop.ts")).href
  const outcome = spawnSync(
    process.execPath,
    [worker, toolUrl, JSON.stringify(args), ctxDirectory],
    {
      cwd,
      env: { ...process.env, PATH: "" },
      timeout: 20_000,
      encoding: "utf-8",
    },
  )
  const timedOut = outcome.error !== undefined || outcome.signal !== null
  const jsonLine = (outcome.stdout ?? "")
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"))
  const parsed = jsonLine
    ? (JSON.parse(jsonLine) as BoundedLoopResult["parsed"])
    : { ok: false, name: "NONE", message: "no JSON result from bounded worker" }
  return { timedOut, parsed }
}

function matchLine(text: string, pattern: RegExp): string {
  const line = text.split("\n").find((candidate) => pattern.test(candidate))
  expect(line).toBeDefined()
  return line ?? ""
}

/**
 * Fail-closed contract for a refused main manuscript origin: a controlled
 * `blocked:` result, no path/target/content leak, no derived academic
 * indicator, no score, iteration, marker or report.
 */
function expectReadBoundaryRefusal(text: string): void {
  expect(text).toContain("blocked:")
  expect(text).toContain("no score, iteration, marker or report was produced")
  expect(text).not.toContain(base)
  for (const fragment of FORBIDDEN_REFUSAL_FRAGMENTS) {
    expect(text).not.toContain(fragment)
  }
  expectNoLoopArtifacts()
}

// ---------------------------------------------------------------------------
// Negative scenarios — unsafe origins are refused without effects
// ---------------------------------------------------------------------------
describe("issue #163 RED — external main manuscript symlink", () => {
  stest("external main.tex symlink is refused before reading external bytes", async () => {
    writeProjectConfig()
    const external = writeExternal("outside.tex", OUTSIDE_MAIN)
    symlinkSync("../outside.tex", join(project, "main.tex"), "file")

    const before = inventory(base)
    const externalHash = sha256OfFile(external)
    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(inventory(base)).toEqual(before)
    expect(sha256OfFile(external)).toBe(externalHash)
    expect(readFileSync(external, "utf-8")).toBe(OUTSIDE_MAIN)
    // The vulnerable tool produced score 8 and `Citations: 5/5` from this file.
    expect(text).not.toMatch(/\b8\b/)
  })

  stest("external ancestor directory symlink is refused", async () => {
    writeProjectConfig({ main: "documento/principal.tex" })
    writeExternal("outside-documento/principal.tex", OUTSIDE_MAIN)
    symlinkSync("../outside-documento", join(project, "documento"), "dir")

    const before = inventory(base)
    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(inventory(base)).toEqual(before)
  })

  stest("configured manuscript root redirected outside is refused before chapter discovery", async () => {
    writeProjectConfig({ root: "raiz-externa", chapters: ["capitulos/*.tex"] })
    writeExternal("outside-raiz/main.tex", OUTSIDE_MAIN)
    writeExternal("outside-raiz/capitulos/capitulo1.tex", "\\chapter{Sintético}\n")
    symlinkSync("../outside-raiz", join(project, "raiz-externa"), "dir")

    const before = inventory(base)
    const text = await runLoop()

    // The refusal is returned as controlled output (not as a discovery error)
    // and no external directory listing or main content drives the result.
    expectReadBoundaryRefusal(text)
    expect(inventory(base)).toEqual(before)
  })
})

describe("issue #163 RED — other unsafe main destinations", () => {
  stest("broken main symlink is refused as blocked, not reported as absent", async () => {
    writeProjectConfig()
    symlinkSync("../nao-existe/main.tex", join(project, "main.tex"), "file")

    const before = inventory(base)
    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(text).not.toContain("main file not found")
    expect(inventory(base)).toEqual(before)
  })

  test("non-regular main destination (directory) is refused without reading", async () => {
    writeProjectConfig()
    mkdirSync(join(project, "main.tex"), { recursive: true })

    const before = inventory(base)
    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(inventory(base)).toEqual(before)
  })

  fifoTest(
    "FIFO main destination is refused without a blocking read",
    async () => {
      writeProjectConfig()
      const fifoPath = join(project, "main.tex")
      expect(spawnSync("mkfifo", [fifoPath]).status).toBe(0)
      writeWorker("loop-worker-163-fifo.mjs")

      const before = inventory(base)
      const run = boundedLoop(project, { projectRoot: project }, project, "loop-worker-163-fifo.mjs")

      // A correct refusal exits quickly; reading the FIFO would hit the timeout.
      expect(run.timedOut).toBe(false)
      expect(run.parsed.ok).toBe(true)
      const text = String(run.parsed.result)
      expectReadBoundaryRefusal(text)
      expect(inventory(base)).toEqual(before)
    },
    30_000,
  )

  unreadableTest("unreadable regular main is refused with a sanitized diagnostic and no effects", async () => {
    writeProjectConfig()
    const mainPath = writeFile("main.tex", mainTex(5, 0))
    const before = inventory(base)
    chmodSync(mainPath, 0o000)
    let text = ""
    try {
      text = await runLoop()
    } finally {
      chmodSync(mainPath, 0o644)
    }

    expectReadBoundaryRefusal(text)
    expect(text).toContain("could not be read safely")
    // The raw Node error (`EACCES: permission denied, open '/abs/path'`) is not exposed.
    expect(text).not.toContain("EACCES")
    expect(text).not.toContain("permission denied")
    expect(text).not.toContain(mainPath)
    expect(inventory(base)).toEqual(before)
  })

  test("absolute manuscript.main is refused with a sanitized diagnostic", async () => {
    const absoluteMain = join(base, "PRIVATE_SYNTHETIC_ABSOLUTE_MAIN.tex")
    writeProjectConfig({ main: absoluteMain })
    writeExternal("PRIVATE_SYNTHETIC_ABSOLUTE_MAIN.tex", OUTSIDE_MAIN)

    const before = inventory(base)
    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(text).not.toContain("PRIVATE_SYNTHETIC_ABSOLUTE_MAIN")
    expect(text).not.toContain("absolute paths are not allowed")
    expect(inventory(base)).toEqual(before)
  })

  test("traversal in manuscript.main is refused with a sanitized diagnostic", async () => {
    writeProjectConfig({ main: "../PRIVATE_SYNTHETIC_TRAVERSAL.tex" })
    writeExternal("PRIVATE_SYNTHETIC_TRAVERSAL.tex", OUTSIDE_MAIN)

    const before = inventory(base)
    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(text).not.toContain("PRIVATE_SYNTHETIC_TRAVERSAL")
    expect(text).not.toContain("path traversal segments")
    expect(inventory(base)).toEqual(before)
  })

  test("absolute manuscript.root is refused with a sanitized diagnostic", async () => {
    const absoluteRoot = join(base, "PRIVATE_SYNTHETIC_ROOT")
    writeProjectConfig({ root: absoluteRoot, chapters: [] })

    const text = await runLoop()

    expectReadBoundaryRefusal(text)
    expect(text).not.toContain("PRIVATE_SYNTHETIC_ROOT")
    expect(text).not.toContain("absolute paths are not allowed")
  })
})

// ---------------------------------------------------------------------------
// Preserved controlled diagnostics (not swallowed by the new boundary)
// ---------------------------------------------------------------------------
describe("issue #163 — preserved controlled diagnostics", () => {
  test("ChapterDiscoveryError keeps its own contract and safe diagnostics", async () => {
    writeProjectConfig({ chapters: ["../fora/*.tex"] })
    writeFile("main.tex", mainTex(0, 5))

    const { bancaLoop } = await import("../src/tools/banca_loop")
    let caught: unknown = null
    try {
      await bancaLoop.execute({ projectRoot: project } as any, { directory: project } as any)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ChapterDiscoveryError)
    const error = caught as ChapterDiscoveryError
    expect(error.diagnostics.some((diagnostic) => diagnostic.code === "unsafe_pattern")).toBe(true)
    expect(`${error.message}\n${JSON.stringify(error.diagnostics)}`).not.toContain(base)
    expectNoLoopArtifacts()
  })
})

// ---------------------------------------------------------------------------
// GREEN controls — legitimate reads remain allowed
// ---------------------------------------------------------------------------
describe("issue #163 GREEN controls — legitimate internal main files", () => {
  test("regular internal main keeps the same heuristic score as the baseline", async () => {
    writeProjectConfig({ targetScore: 9 })
    const content = mainTex(5, 0)
    writeFile("main.tex", content)
    const expected = analyzeCitationDensity(content)

    const before = inventory(base)
    const text = await runLoop()

    expect(text).toContain("Loop iteration")
    const scoreLine = matchLine(text, /^Current heuristic citation score: /)
    expect(scoreLine).toBe(`Current heuristic citation score: ${expected.score}`)
    expect(text).toContain(`Citations: ${expected.citedParagraphs}/${expected.totalParagraphs}`)
    // The accepted run writes only its own loop artifacts (marker + report + state).
    const after = inventory(base)
    expect(after["project/.banca/state.json"]).toMatch(/^file:/)
    expect(Object.keys(after).some((key) => key.startsWith("project/.banca/reports/"))).toBe(true)
    expect(Object.keys(after).some((key) => key.includes("project/.banca/snapshots/"))).toBe(true)
    expect(after["project/main.tex"]).toBe(before["project/main.tex"])
  })

  test("relative projectRoot resolves inside the workspace and is accepted", async () => {
    writeProjectConfig({ targetScore: 9 })
    writeFile("main.tex", mainTex(5, 0))
    const expected = analyzeCitationDensity(mainTex(5, 0))

    const run = boundedLoop(base, { projectRoot: "project" }, base, "loop-worker-163-relative.mjs")
    expect(run.timedOut).toBe(false)
    expect(run.parsed.ok).toBe(true)
    const text = String(run.parsed.result)
    expect(text).toContain("Loop iteration")
    expect(matchLine(text, /^Current heuristic citation score: /)).toBe(
      `Current heuristic citation score: ${expected.score}`,
    )
  })

  test("./ prefixed configured root and main are accepted", async () => {
    writeProjectConfig({ root: "./", main: "./main.tex", targetScore: 9 })
    const content = mainTex(5, 0)
    writeFile("main.tex", content)
    const expected = analyzeCitationDensity(content)

    const text = await runLoop()
    expect(text).toContain("Loop iteration")
    expect(matchLine(text, /^Current heuristic citation score: /)).toBe(
      `Current heuristic citation score: ${expected.score}`,
    )
  })

  test("nested internal manuscript root is accepted", async () => {
    writeProjectConfig({ root: "manuscrito", main: "main.tex", chapters: [], targetScore: 9 })
    const content = mainTex(5, 0)
    writeFile("manuscrito/main.tex", content)
    const expected = analyzeCitationDensity(content)

    const text = await runLoop()
    expect(text).toContain("Loop iteration")
    expect(matchLine(text, /^Current heuristic citation score: /)).toBe(
      `Current heuristic citation score: ${expected.score}`,
    )
    expect(text).toContain("Report: .banca/reports/loop-")
  })

  stest("internal symlink to an internal main file is allowed", async () => {
    writeProjectConfig({ targetScore: 9 })
    const content = mainTex(5, 0)
    writeFile("texto/real-main.tex", content)
    symlinkSync("texto/real-main.tex", join(project, "main.tex"), "file")
    const expected = analyzeCitationDensity(content)

    const before = inventory(base)
    const text = await runLoop()

    expect(text).toContain("Loop iteration")
    expect(matchLine(text, /^Current heuristic citation score: /)).toBe(
      `Current heuristic citation score: ${expected.score}`,
    )
    // The link and the target are untouched by the accepted run.
    const after = inventory(base)
    expect(after["project/main.tex"]).toBe("symlink:texto/real-main.tex")
    expect(after["project/texto/real-main.tex"]).toBe(before["project/texto/real-main.tex"])
  })

  stest("internal symlink in an ancestor directory is allowed", async () => {
    writeProjectConfig({ main: "documento/principal.tex", targetScore: 9 })
    const content = mainTex(5, 0)
    writeFile("conteudo/principal.tex", content)
    symlinkSync("conteudo", join(project, "documento"), "dir")
    const expected = analyzeCitationDensity(content)

    const text = await runLoop()
    expect(text).toContain("Loop iteration")
    expect(matchLine(text, /^Current heuristic citation score: /)).toBe(
      `Current heuristic citation score: ${expected.score}`,
    )
  })

  test("truly absent main file keeps the historical 'main file not found' behavior", async () => {
    writeProjectConfig({ targetScore: 9 })

    const text = await runLoop()

    expect(text).toContain("main file not found")
    expect(text).not.toContain("blocked:")
    expectNoLoopArtifacts()
  })
})

// ---------------------------------------------------------------------------
// #120 / #147 contract preservation on accepted runs
// ---------------------------------------------------------------------------
describe("issue #163 — academic contract preserved on accepted runs", () => {
  test("threshold branch records the heuristic action without marker or report", async () => {
    writeProjectConfig({ targetScore: 8 })
    writeFile("main.tex", mainTex(5, 0))

    const text = await runLoop()
    expect(text).toContain("✓ Local heuristic citation threshold reached.")
    expect(text).not.toContain("Loop iteration")
    expect(reportFiles()).toEqual([])
    expect(existsSync(snapshotsDir())).toBe(false)

    const state = readStateJson()
    expect(state.iterations).toHaveLength(1)
    expect(state.iterations[0].action).toBe("loop-heuristic-threshold")
    expect(state.iterations[0].status).toBe("ok")
    expect(state.iterations[0].scoreAfter).toBe(8)
    expect(state.snapshots).toEqual([])
  })

  test("marker branch keeps the non-restorable marker, report and iteration history", async () => {
    writeProjectConfig({ targetScore: 9 })
    const content = mainTex(5, 0)
    const mainPath = writeFile("main.tex", content)
    const mainHash = sha256OfFile(mainPath)

    const text = await runLoop()
    const label = matchLine(text, /^Snapshot: (loop-\S+)$/).replace("Snapshot: ", "")
    expect(text).toContain(`Report: .banca/reports/loop-${label}.md`)
    expect(text).toContain("non-restorable")
    expect(text).toContain("does not enable restore")

    const manifestState = loadSnapshotManifest(snapshotsDir(), label)
    expect(manifestState.kind).toBe("valid")
    if (manifestState.kind === "valid") {
      expect(manifestState.manifest.kind).toBe("marker")
      expect(manifestState.manifest.files).toEqual([])
    }
    expect(readdirSync(join(snapshotsDir(), label))).toEqual([])

    const report = readFileSync(join(reportsDir(), `loop-${label}.md`), "utf-8")
    expect(report).toContain("# LOOP — ")
    expect(report).toContain(`Citations: ${analyzeCitationDensity(content).citedParagraphs}/5`)
    expect(report).toContain("Snapshot kind: marker (process milestone; non-restorable).")

    const state = readStateJson()
    expect(state.snapshots).toHaveLength(1)
    expect(state.currentScore).toBe(8)
    const loops = state.iterations.filter((item: any) => item.action === "loop")
    expect(loops).toHaveLength(1)
    expect(loops[0].status).toBe("ok")
    expect(loops[0].scoreAfter).toBe(8)
    expect(sha256OfFile(mainPath)).toBe(mainHash)
  })

  test("stagnation circuit breaker still interrupts with failed status and no artifacts", async () => {
    writeProjectConfig({ targetScore: 9 })
    writeFile("main.tex", mainTex(0, 5))
    seedLoopHistory(6, [6, 6, 6])
    const stateBefore = readFileSync(statePath(), "utf-8")

    const text = await runLoop()

    expect(text).toContain("circuit breaker: last 3 loops same score (6)")
    expect(text).toContain('status "failed"')
    expect(reportFiles()).toEqual([])
    expect(existsSync(snapshotsDir())).toBe(false)
    const state = readStateJson()
    expect(state.iterations).toHaveLength(4)
    expect(state.iterations[3].action).toBe("loop-circuit-break")
    expect(state.iterations[3].status).toBe("failed")
    expect(readFileSync(statePath(), "utf-8")).not.toBe(stateBefore)
  })

  test("oscillation circuit breaker still interrupts with failed status and no artifacts", async () => {
    writeProjectConfig({ targetScore: 9 })
    writeFile("main.tex", mainTex(0, 5))
    seedLoopHistory(6, [6, 8, 6])

    const text = await runLoop()

    expect(text).toContain("circuit breaker: score oscillation")
    expect(text).toContain('status "failed"')
    expect(reportFiles()).toEqual([])
    expect(existsSync(snapshotsDir())).toBe(false)
    const state = readStateJson()
    const last = state.iterations[state.iterations.length - 1]
    expect(last.action).toBe("loop-oscillation")
    expect(last.status).toBe("failed")
  })
})
