/**
 * Issue #136 — canonical origin boundary for `.banca/state.json`.
 *
 * `loadState` historically used `existsSync` + `readFileSync` without canonical
 * confinement, so a symlink at the state file or at its `.banca` ancestor could
 * redirect the academic state read outside the workspace (external score,
 * iterations and snapshot registry), and broken links, `ENOTDIR`, non-regular
 * destinations and real read failures were silently degraded to an empty state.
 *
 * The scenarios below require a fail-closed, sanitized refusal BEFORE any byte
 * of an external destination is read. The FIFO scenario proves the refusal is
 * earlier than the read: a vulnerable implementation blocks on the open until
 * the bounded subprocess timeout, while a correct preflight refuses quickly.
 *
 * Scratch trees are synthetic and removed in `afterEach`. No DSH host, model,
 * network, LaTeX or real manuscript/snapshot is involved.
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
import { addIteration, addSnapshot, loadState } from "../src/lib/state"
import { PathTraversalError } from "../src/lib/safe_paths"
import { bancaStatus } from "../src/tools/banca_status"
import { bancaInit } from "../src/tools/banca_init"

/** Synthetic token that must never reach a refusal diagnostic. */
const STATE136_SECRET = "SEGREDO_ESTADO_EXTERNO_NAO_DEVE_VAZAR"

/** External state fixture reproduced from issue #136. */
const STATE136_EXTERNAL = JSON.stringify({
  currentScore: 7.3,
  lastAudit: null,
  lastLoop: STATE136_SECRET,
  snapshots: [
    {
      id: "synthetic-id",
      label: "SYNTHETIC_EXTERNAL_STATE_LABEL",
      createdAt: "2026-01-01T00:00:00Z",
      scoreBefore: null,
    },
  ],
  iterations: [],
})

/** The legitimate historical default state. */
const STATE136_DEFAULT = {
  currentScore: null,
  lastAudit: null,
  lastLoop: null,
  snapshots: [],
  iterations: [],
}

/** Internal legitimate state fixture. */
const STATE136_INTERNAL = JSON.stringify({
  currentScore: 6.5,
  lastAudit: "2026-01-02T00:00:00Z",
  lastLoop: null,
  snapshots: [],
  iterations: [
    { date: "2026-01-02T00:00:00Z", action: "loop", scoreBefore: 6.0, scoreAfter: 6.5, status: "ok" },
  ],
})

/** Valid internal academic configuration for consumer-level scenarios. */
const STATE136_CONFIG = JSON.stringify({
  version: 1,
  manuscript: {
    format: "latex",
    root: ".",
    main: "main.tex",
    bib: "referencias.bib",
    chapters: ["capitulos/*.tex"],
    outputDir: "trabalhos",
  },
  compile: { enabled: false, command: [] },
  allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
  protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
  immutableFacts: [],
  externalDependencies: [],
  rubricProfile: "banca-rigorosa",
  targetScore: 9,
  providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
  mcp: { crossrefAcademicEnabled: false },
})

const state136SymlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-136-link-probe-"))
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

const state136Stest = state136SymlinksSupported ? test : test.skip

const state136MkfifoSupported = (() => {
  if (process.platform === "win32") return false
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-136-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

const state136FifoTest =
  state136MkfifoSupported && state136SymlinksSupported ? state136Stest : test.skip

const state136UnreadableSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0

/** chmod 000 only denies reads for a non-privileged process. */
const state136UnreadableTest = state136UnreadableSupported ? test : test.skip

/** Raw filesystem error fragments that must never surface in a refusal. */
const STATE136_RAW_DIAGNOSTIC_FRAGMENTS = [
  "EACCES",
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
  "permission denied",
  "no such file",
  "illegal operation",
  "open '",
]

/** Complete recursive inventory: path -> kind, link target, file SHA-256. */
function state136TreeSnapshot(rootDir: string): Record<string, string> {
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
        const hash = createHash("sha256").update(readFileSync(abs)).digest("hex")
        snapshot[rel] = `file:${hash}`
      } else {
        snapshot[rel] = "special"
      }
    }
  }
  visit(rootDir)
  return snapshot
}

function state136Hash(path: string): string | null {
  if (!existsSync(path)) return null
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

describe("issue #136 — loadState canonical state origin", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-136-state-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  const bancaDir = (): string => join(project, ".banca")
  const stateFile = (): string => join(bancaDir(), "state.json")

  function writeInternalState(content: string): void {
    mkdirSync(bancaDir(), { recursive: true })
    writeFileSync(stateFile(), content, "utf-8")
  }

  function writeExternalFile(relativePath: string, content: string): string {
    const target = join(base, relativePath)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, content, "utf-8")
    return target
  }

  function captureRefusal(call: () => unknown): Error {
    try {
      call()
    } catch (error) {
      return error as Error
    }
    throw new Error("expected a controlled state refusal, but the call returned a value")
  }

  function expectSanitizedRefusal(error: Error, extraForbidden: string[] = []): string {
    expect(error).toBeInstanceOf(PathTraversalError)
    const message = String(error.message)
    expect(message.length).toBeGreaterThan(0)
    expect(message).toContain("state refused")
    expect(message).not.toContain(base)
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
    for (const fragment of [
      STATE136_SECRET,
      "SYNTHETIC_EXTERNAL_STATE_LABEL",
      "synthetic-id",
      ...STATE136_RAW_DIAGNOSTIC_FRAGMENTS,
      ...extraForbidden,
    ]) {
      expect(message).not.toContain(fragment)
    }
    return message
  }

  // External file symlink at state.json.
  state136Stest("refuses a state.json symlink to an external state file", () => {
    mkdirSync(bancaDir(), { recursive: true })
    const outside = writeExternalFile("outside/state.json", STATE136_EXTERNAL)
    symlinkSync(outside, stateFile(), "file")

    const before = state136TreeSnapshot(base)
    const error = captureRefusal(() => loadState(project))

    expectSanitizedRefusal(error)
    expect(state136TreeSnapshot(base)).toEqual(before)
    expect(readFileSync(outside, "utf-8")).toBe(STATE136_EXTERNAL)
  })

  // External `.banca` ancestor symlink.
  state136Stest("refuses an external .banca directory symlink", () => {
    writeExternalFile("outside/state.json", STATE136_EXTERNAL)
    symlinkSync(join(base, "outside"), bancaDir(), "dir")

    const error = captureRefusal(() => loadState(project))
    expectSanitizedRefusal(error)
  })

  // Broken file symlink is blocked, never legitimate absence.
  state136Stest("refuses a broken state.json symlink instead of empty defaults", () => {
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync("../no-such-dir/state.json", stateFile(), "file")

    const error = captureRefusal(() => loadState(project))
    expectSanitizedRefusal(error)
  })

  // Broken ancestor symlink is blocked, never legitimate absence.
  state136Stest("refuses a broken .banca ancestor symlink instead of empty defaults", () => {
    symlinkSync("../no-such-banca", bancaDir(), "dir")

    const error = captureRefusal(() => loadState(project))
    expectSanitizedRefusal(error)
  })

  // `.banca` exists as a regular file (ENOTDIR is not absence).
  test("refuses a non-directory .banca ancestor instead of reporting absence", () => {
    writeFileSync(bancaDir(), "not a directory\n", "utf-8")

    const error = captureRefusal(() => loadState(project))
    expectSanitizedRefusal(error)
  })

  // state.json exists as a directory.
  test("refuses a state.json destination that is a directory", () => {
    mkdirSync(stateFile(), { recursive: true })

    const error = captureRefusal(() => loadState(project))
    expectSanitizedRefusal(error)
  })

  // Non-regular destination: FIFO must be refused without opening it.
  state136FifoTest(
    "refuses a FIFO state destination without a blocking read",
    () => {
      mkdirSync(bancaDir(), { recursive: true })
      mkdirSync(join(base, "outside"), { recursive: true })
      const fifo = join(base, "outside", "state.json")
      expect(spawnSync("mkfifo", [fifo]).status).toBe(0)
      symlinkSync(fifo, stateFile(), "file")

      const workerPath = join(base, "state-fifo-worker.mjs")
      const stateUrl = pathToFileURL(join(import.meta.dir, "..", "src", "lib", "state.ts")).href
      writeFileSync(
        workerPath,
        [
          "const stateUrl = process.argv[2]",
          "const project = process.argv[3]",
          "const { loadState } = await import(stateUrl)",
          "try { console.log(JSON.stringify({ ok: true, score: loadState(project).currentScore })) }",
          'catch (error) { console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) })) }',
          "",
        ].join("\n"),
        "utf-8",
      )
      const outcome = spawnSync(process.execPath, [workerPath, stateUrl, project], {
        timeout: 5000,
        encoding: "utf-8",
      })

      expect(outcome.error).toBeUndefined()
      expect(outcome.signal).toBeNull()
      const jsonLine = (outcome.stdout ?? "")
        .split("\n")
        .reverse()
        .find((line) => line.trim().startsWith("{"))
      expect(jsonLine).toBeDefined()
      const parsed = JSON.parse(jsonLine as string) as { ok: boolean; name?: string; message?: string }
      expect(parsed.ok).toBe(false)
      expect(parsed.name).toBe("PathTraversalError")
      expect(String(parsed.message)).toContain("state refused")
      expect(String(parsed.message)).not.toContain(base)
      for (const fragment of [STATE136_SECRET, ...STATE136_RAW_DIAGNOSTIC_FRAGMENTS]) {
        expect(String(parsed.message)).not.toContain(fragment)
      }
    },
    20_000,
  )

  // Present state that cannot be read is not absence/defaults.
  state136UnreadableTest("refuses a present but unreadable state file", () => {
    writeInternalState(STATE136_INTERNAL)
    chmodSync(stateFile(), 0o000)
    try {
      let rawCode: string | undefined
      try {
        readFileSync(stateFile(), "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      const error = captureRefusal(() => loadState(project))
      const message = expectSanitizedRefusal(error)
      expect(message).toContain("could not be read")
    } finally {
      chmodSync(stateFile(), 0o644)
    }
  })

  // Truly absent `.banca` keeps the historical empty state.
  test("keeps the historical empty state when .banca is truly absent", () => {
    expect(loadState(project)).toEqual(STATE136_DEFAULT)
  })

  // Truly absent state.json inside an existing `.banca`.
  test("keeps the historical empty state when state.json is truly absent", () => {
    mkdirSync(bancaDir(), { recursive: true })
    expect(loadState(project)).toEqual(STATE136_DEFAULT)
  })

  // Internal regular state loads normally.
  test("loads an internal regular state file", () => {
    writeInternalState(STATE136_INTERNAL)
    const state = loadState(project)
    expect(state.currentScore).toBe(6.5)
    expect(state.lastAudit).toBe("2026-01-02T00:00:00Z")
    expect(state.iterations).toHaveLength(1)
    expect(state.iterations[0].action).toBe("loop")
  })

  // Historical fallback for internal invalid JSON is preserved.
  test("keeps the historical empty-state fallback for invalid internal JSON", () => {
    writeInternalState("{ invalid }")
    expect(loadState(project)).toEqual(STATE136_DEFAULT)
  })

  // Internal symlinks remain allowed by the current policy.
  state136Stest("allows an internal symlink at the state file", () => {
    mkdirSync(bancaDir(), { recursive: true })
    mkdirSync(join(project, "estado-real"), { recursive: true })
    writeFileSync(join(project, "estado-real", "state.json"), STATE136_INTERNAL, "utf-8")
    symlinkSync(join(project, "estado-real", "state.json"), stateFile(), "file")

    expect(loadState(project).currentScore).toBe(6.5)
  })

  state136Stest("allows an internal symlink ancestor for .banca", () => {
    mkdirSync(join(project, "banca-real"), { recursive: true })
    writeFileSync(join(project, "banca-real", "state.json"), STATE136_INTERNAL, "utf-8")
    symlinkSync(join(project, "banca-real"), bancaDir(), "dir")

    expect(loadState(project).currentScore).toBe(6.5)
  })

  // Absolute, relative and nested roots must read the same true state, and a
  // decoy at the doubly-prefixed path must not be consumed.
  state136Stest("absolute, relative and nested roots read the same true state", () => {
    const workspace = join(base, "workspace")
    mkdirSync(join(workspace, ".banca"), { recursive: true })
    writeFileSync(join(workspace, ".banca", "state.json"), STATE136_INTERNAL, "utf-8")
    const nested = join(base, "parent", "workspace")
    mkdirSync(join(nested, ".banca"), { recursive: true })
    writeFileSync(join(nested, ".banca", "state.json"), STATE136_INTERNAL, "utf-8")
    // Decoy a doubly-prefixed resolver would find for the relative root.
    mkdirSync(join(workspace, "workspace", ".banca"), { recursive: true })
    writeFileSync(
      join(workspace, "workspace", ".banca", "state.json"),
      JSON.stringify({ ...STATE136_DEFAULT, currentScore: 1.1, lastLoop: "DECOY" }),
      "utf-8",
    )

    const workerPath = join(base, "state-relative-worker.mjs")
    const stateUrl = pathToFileURL(join(import.meta.dir, "..", "src", "lib", "state.ts")).href
    writeFileSync(
      workerPath,
      [
        "const stateUrl = process.argv[2]",
        "const root = process.argv[3]",
        "const { loadState } = await import(stateUrl)",
        "const state = loadState(root)",
        "console.log(JSON.stringify({ score: state.currentScore, lastLoop: state.lastLoop, iterations: state.iterations.length }))",
        "",
      ].join("\n"),
      "utf-8",
    )

    const cases: Array<{ root: string; expectedScore: number }> = [
      { root: workspace, expectedScore: 6.5 },
      { root: "workspace", expectedScore: 6.5 },
      { root: "./workspace", expectedScore: 6.5 },
      { root: join(base, "parent", "workspace"), expectedScore: 6.5 },
      { root: join("parent", "workspace"), expectedScore: 6.5 },
    ]
    for (const testCase of cases) {
      const outcome = spawnSync(process.execPath, [workerPath, stateUrl, testCase.root], {
        cwd: base,
        encoding: "utf-8",
        timeout: 10_000,
      })
      expect(outcome.error).toBeUndefined()
      expect(outcome.signal).toBeNull()
      const parsed = JSON.parse(
        (outcome.stdout ?? "").split("\n").find((line) => line.trim().startsWith("{")) as string,
      ) as { score: number; lastLoop: string | null; iterations: number }
      expect(parsed.score).toBe(testCase.expectedScore)
      expect(parsed.lastLoop).toBeNull()
      expect(parsed.iterations).toBe(1)
    }
  })
})

describe("issue #136 — banca_status refuses external state before presenting it", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-136-status-"))
    project = join(base, "project")
    mkdirSync(join(project, ".banca"), { recursive: true })
    writeFileSync(join(project, ".banca", "project.json"), STATE136_CONFIG, "utf-8")
    writeFileSync(join(project, "main.tex"), "ORIGINAL sintético\n", "utf-8")
    writeFileSync(join(project, "referencias.bib"), "@book{sintetica2026, title={Sintético}}\n", "utf-8")
    mkdirSync(join(project, "capitulos"), { recursive: true })
    writeFileSync(join(project, "capitulos", "cap1.tex"), "\\chapter{Sintético}\n", "utf-8")
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  state136Stest("refuses an external state origin before producing score or iterations", async () => {
    mkdirSync(join(base, "outside"), { recursive: true })
    const outside = join(base, "outside", "state.json")
    writeFileSync(outside, STATE136_EXTERNAL, "utf-8")
    symlinkSync(outside, join(project, ".banca", "state.json"), "file")

    const before = state136TreeSnapshot(base)
    await expect(
      bancaStatus.execute({ projectRoot: project }, { directory: project } as never),
    ).rejects.toThrow(PathTraversalError)

    expect(state136TreeSnapshot(base)).toEqual(before)
    expect(state136Hash(outside)).not.toBeNull()
    expect(readFileSync(outside, "utf-8")).toBe(STATE136_EXTERNAL)
  })

  test("still reports a legitimately initialized project with internal state", async () => {
    writeFileSync(join(project, ".banca", "state.json"), STATE136_INTERNAL, "utf-8")

    const output = String(
      await bancaStatus.execute({ projectRoot: project }, { directory: project } as never),
    )
    expect(output).toContain("Score: 6.5 / 9")
    expect(output).toContain("Iterations: 1")
  })

  test("still reports a legitimately initialized project without state.json", async () => {
    const output = String(
      await bancaStatus.execute({ projectRoot: project }, { directory: project } as never),
    )
    expect(output).toContain("Score: — / 9")
    expect(output).toContain("Iterations: 0")
  })
})

describe("issue #136 — state mutation helpers refuse before persisting", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-136-mutation-"))
    project = join(base, "project")
    mkdirSync(join(project, ".banca"), { recursive: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  state136Stest("addIteration refuses an external state origin without writing", () => {
    mkdirSync(join(base, "outside"), { recursive: true })
    const outside = join(base, "outside", "state.json")
    writeFileSync(outside, STATE136_EXTERNAL, "utf-8")
    symlinkSync(outside, join(project, ".banca", "state.json"), "file")

    const before = state136TreeSnapshot(base)
    let error: Error | undefined
    try {
      addIteration(project, "probe", null, 5, "ok")
    } catch (caught) {
      error = caught as Error
    }
    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String(error?.message)).toContain("state refused")
    expect(state136TreeSnapshot(base)).toEqual(before)
    expect(readFileSync(outside, "utf-8")).toBe(STATE136_EXTERNAL)
  })

  state136Stest("addSnapshot refuses an external state origin without writing", () => {
    mkdirSync(join(base, "outside"), { recursive: true })
    const outside = join(base, "outside", "state.json")
    writeFileSync(outside, STATE136_EXTERNAL, "utf-8")
    symlinkSync(outside, join(project, ".banca", "state.json"), "file")

    const before = state136TreeSnapshot(base)
    let error: Error | undefined
    try {
      addSnapshot(project, "probe-label", null)
    } catch (caught) {
      error = caught as Error
    }
    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String(error?.message)).toContain("state refused")
    expect(state136TreeSnapshot(base)).toEqual(before)
    expect(readFileSync(outside, "utf-8")).toBe(STATE136_EXTERNAL)
  })

  state136Stest("banca_init refuses an external state origin before any project effect", async () => {
    mkdirSync(join(base, "outside"), { recursive: true })
    writeFileSync(join(base, "outside", "state.json"), STATE136_EXTERNAL, "utf-8")
    symlinkSync(join(base, "outside", "state.json"), join(project, ".banca", "state.json"), "file")

    const before = state136TreeSnapshot(base)
    const output = String(
      await bancaInit.execute({ projectRoot: project }, { directory: project } as never),
    )

    expect(output).toContain("blocked")
    expect(state136TreeSnapshot(base)).toEqual(before)
  })
})
