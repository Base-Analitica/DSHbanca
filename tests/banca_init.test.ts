/**
 * banca_init — initialization order and academic-state preflight (issue #140).
 *
 * `banca_init` used to create `.banca/` directories and write/replace
 * `.banca/project.json` before `loadState` inspected `.banca/state.json`.
 * A deterministic state refusal (internal directory/FIFO, unsafe origin or a
 * real read failure) was therefore discovered only after initialization had
 * already produced effects, and a retry without force then reported a false
 * `skipped`.
 *
 * The scenarios below execute the real tool on synthetic scratch trees, with a
 * synthetic PATH (controlled failing probes) so no real LaTeX binary or
 * manuscript is used. Refusals are asserted before any effect with recursive
 * inventory (names, kinds, link targets and SHA-256) before/after.
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
import { bancaInit } from "../src/tools/banca_init"

/** Synthetic token that must never reach a refusal diagnostic. */
const SYNTHETIC_SECRET = "SEGREDO_ESTADO_SINTETICO_140"

/** External state fixture with identifiable content. */
const EXTERNAL_STATE = JSON.stringify(
  {
    currentScore: 7.3,
    lastAudit: null,
    lastLoop: SYNTHETIC_SECRET,
    snapshots: [{ id: "synthetic-id", label: "SYNTHETIC_EXTERNAL_LABEL", createdAt: "2026-01-01T00:00:00Z", scoreBefore: null }],
    iterations: [],
  },
  null,
  2,
)

/** Historical empty state produced when `.banca/state.json` is legitimately absent. */
const EMPTY_STATE = {
  currentScore: null,
  lastAudit: null,
  lastLoop: null,
  snapshots: [],
  iterations: [],
}

/** Legitimate preexisting academic state that must survive initialization. */
const HISTORY_STATE = {
  currentScore: 6.5,
  lastAudit: "2026-01-02T00:00:00Z",
  lastLoop: null,
  snapshots: [],
  iterations: [
    { date: "2026-01-02T00:00:00Z", action: "loop", scoreBefore: 6, scoreAfter: 6.5, status: "ok" as const },
  ],
}

/** Legitimate customized configuration used to prove it is not replaced. */
const SYNTHETIC_CONFIG = {
  version: 1,
  manuscript: {
    format: "latex",
    root: ".",
    main: "tcc.tex",
    bib: "referencias.bib",
    chapters: ["capitulos/*.tex"],
    outputDir: "trabalhos",
  },
  compile: { enabled: false, command: [] },
  allowedPaths: ["**/*.tex"],
  protectedPaths: ["main.tex", "dados/**"],
  immutableFacts: ["fato-sintetico"],
  externalDependencies: [],
  rubricProfile: "sintetica",
  targetScore: 7,
  providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
  mcp: { crossrefAcademicEnabled: false },
}

/** Raw filesystem fragments that must never surface in a refusal. */
const RAW_DIAGNOSTIC_FRAGMENTS = [
  "EACCES",
  "EPERM",
  "EISDIR",
  "ENOTDIR",
  "ELOOP",
  "ENOENT",
  "permission denied",
  "no such file",
  "illegal operation",
  "open '",
]

const symlinksSupported = (() => {
  try {
    const probe = mkdtempSync(join(tmpdir(), "dshbanca-init-140-link-"))
    try {
      symlinkSync(probe, join(probe, "link"))
      return true
    } finally {
      rmSync(probe, { recursive: true, force: true })
    }
  } catch {
    return false
  }
})()

const stest = symlinksSupported ? test : test.skip

function findExecutable(name: string): string | null {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    if (!directory) continue
    const candidate = join(directory, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const mkfifoBinary = findExecutable("mkfifo")
const fifoSupported = (() => {
  if (mkfifoBinary === null) return false
  const probe = mkdtempSync(join(tmpdir(), "dshbanca-init-140-fifo-"))
  try {
    return spawnSync(mkfifoBinary, [join(probe, "fifo")]).status === 0
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
})()

const fifoTest = fifoSupported ? test : test.skip
const fifoSymlinkTest = fifoSupported && symlinksSupported ? test : test.skip

/** `chmod 000` only denies reads for a non-privileged process. */
const unreadableSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0
const unreadableTest = unreadableSupported ? test : test.skip

function sha256(path: string): string | null {
  if (!existsSync(path)) return null
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * Complete recursive inventory: relative path -> kind, link target or SHA-256.
 * An unreadable regular file is recorded without content, so refusal
 * inventories remain comparable.
 */
function inventory(rootDir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const abs = join(dir, entry.name)
      const rel = relative(rootDir, abs).split(sep).join("/")
      const stat = lstatSync(abs)
      if (stat.isSymbolicLink()) {
        snapshot[rel] = `symlink:${readlinkSync(abs)}`
      } else if (stat.isDirectory()) {
        snapshot[rel] = "dir"
        visit(abs)
      } else if (stat.isFile()) {
        try {
          snapshot[rel] = `file:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`
        } catch {
          snapshot[rel] = "file:unreadable"
        }
      } else if (stat.isFIFO()) {
        snapshot[rel] = "special:fifo"
      } else {
        snapshot[rel] = "special"
      }
    }
  }
  if (existsSync(rootDir)) visit(rootDir)
  return snapshot
}

describe("banca_init", () => {
  let base: string
  let project: string
  let syntheticBin: string
  let originalPath: string | undefined

  const bancaDir = (): string => join(project, ".banca")
  const configFile = (): string => join(bancaDir(), "project.json")
  const stateFile = (): string => join(bancaDir(), "state.json")
  const dshDir = (): string => join(project, ".dsh")

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-init-140-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
    // Controlled LaTeX probes: present but failing immediately. No real
    // typesetting software is ever executed by this suite.
    syntheticBin = join(base, "synthetic-bin")
    mkdirSync(syntheticBin)
    for (const command of ["lualatex", "xelatex", "pdflatex"]) {
      writeFileSync(join(syntheticBin, command), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
    }
    originalPath = process.env.PATH
    process.env.PATH = syntheticBin
  })

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    rmSync(base, { recursive: true, force: true })
  })

  async function runInit(args: { force?: boolean } = {}): Promise<string> {
    return String(
      await bancaInit.execute({ projectRoot: project, ...args }, { directory: project } as never),
    )
  }

  function writeManuscripts(): void {
    writeFileSync(join(project, "main.tex"), "manuscrito sintetico\n", "utf-8")
    writeFileSync(join(project, "tcc.tex"), "principal sintetico\n", "utf-8")
  }

  function writeSyntheticConfig(): void {
    mkdirSync(bancaDir(), { recursive: true })
    writeFileSync(configFile(), JSON.stringify(SYNTHETIC_CONFIG, null, 2), "utf-8")
  }

  function expectSanitizedRefusal(output: string, requiredFragments: string[] = []): void {
    expect(output).toContain("blocked")
    for (const fragment of requiredFragments) expect(output).toContain(fragment)
    expect(output).not.toContain(base)
    for (const fragment of [SYNTHETIC_SECRET, ...RAW_DIAGNOSTIC_FRAGMENTS]) {
      expect(output).not.toContain(fragment)
    }
  }

  /**
   * Run the real tool in a bounded subprocess. Used for FIFO destinations and
   * for the relative-root consumer contract so a blocking read or deadlock is
   * observed as a timeout instead of hanging the suite.
   */
  function boundedInit(
    rootArg: string,
    cwd: string,
    force = false,
  ): { timedOut: boolean; parsed: { ok: boolean; result?: string; name?: string; message?: string } } {
    const worker = join(cwd, `banca-init-worker-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
    const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_init.ts")).href
    writeFileSync(
      worker,
      [
        "const toolUrl = process.argv[2]",
        "const root = process.argv[3]",
        "const force = process.argv[4] === '1'",
        "const { bancaInit } = await import(toolUrl)",
        "try {",
        "  const result = await bancaInit.execute({ projectRoot: root, force }, { directory: root })",
        "  console.log(JSON.stringify({ ok: true, result: String(result) }))",
        "} catch (error) {",
        "  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    )
    const outcome = spawnSync(process.execPath, [worker, toolUrl, rootArg, force ? "1" : "0"], {
      cwd,
      env: { ...process.env, PATH: "" },
      timeout: 8000,
      encoding: "utf-8",
    })
    const timedOut = outcome.error !== undefined || outcome.signal !== null
    const jsonLine = (outcome.stdout ?? "")
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"))
    const parsed = jsonLine
      ? (JSON.parse(jsonLine) as { ok: boolean; result?: string; name?: string; message?: string })
      : { ok: false, name: "NONE", message: "no JSON result from bounded worker" }
    return { timedOut, parsed }
  }

  describe("basic contract", () => {
    test("creates .banca directory structure", async () => {
      const result = await runInit()

      expect(typeof result).toBe("string")
      expect(result).toContain(".banca/ + config + state")
      expect(existsSync(configFile())).toBe(true)
      expect(existsSync(join(bancaDir(), "reports"))).toBe(true)
      expect(existsSync(join(bancaDir(), "context"))).toBe(true)
      expect(existsSync(join(bancaDir(), "snapshots"))).toBe(true)
      expect(existsSync(join(bancaDir(), "cache"))).toBe(true)
      expect(existsSync(stateFile())).toBe(true)
    })

    test("skips if already initialized", async () => {
      await runInit()
      const result = await runInit()

      expect(result).toContain("skipped")
    })

    test("force overwrites existing config", async () => {
      await runInit()
      const result = await runInit({ force: true })

      expect(result).toContain(".banca/ + config + state")
    })
  })

  describe("issue #140 — state preflight before initialization effects", () => {
    test("refuses a state.json directory before creating config or academic directories", async () => {
      mkdirSync(stateFile(), { recursive: true })
      writeManuscripts()
      const before = inventory(project)

      const first = await runInit()

      expectSanitizedRefusal(first, ["state refused", "safe regular file"])
      expect(existsSync(configFile())).toBe(false)
      for (const sub of ["reports", "context", "snapshots", "cache"]) {
        expect(existsSync(join(bancaDir(), sub))).toBe(false)
      }
      expect(existsSync(dshDir())).toBe(false)
      expect(existsSync(join(project, "banca-auditor.md"))).toBe(false)
      expect(lstatSync(stateFile()).isDirectory()).toBe(true)
      expect(inventory(project)).toEqual(before)

      // A retry must keep refusing instead of reporting a false skip caused by
      // the first (effectful) attempt.
      const second = await runInit()
      expect(second).toContain("blocked")
      expect(second).not.toContain("skipped")
      expect(inventory(project)).toEqual(before)
    })

    test("force refuses before replacing a legitimate configuration", async () => {
      writeSyntheticConfig()
      writeManuscripts()
      mkdirSync(stateFile(), { recursive: true })
      const configHash = sha256(configFile())
      const mainHash = sha256(join(project, "main.tex"))
      const before = inventory(project)

      const output = await runInit({ force: true })

      expectSanitizedRefusal(output, ["state refused", "safe regular file"])
      expect(sha256(configFile())).toBe(configHash)
      expect(JSON.parse(readFileSync(configFile(), "utf-8"))).toEqual(SYNTHETIC_CONFIG)
      expect(sha256(join(project, "main.tex"))).toBe(mainHash)
      expect(existsSync(dshDir())).toBe(false)
      expect(inventory(project)).toEqual(before)
    })

    stest("refuses an external state.json symlink before any effect", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      mkdirSync(join(base, "outside"), { recursive: true })
      const outside = join(base, "outside", "state.json")
      writeFileSync(outside, EXTERNAL_STATE, "utf-8")
      symlinkSync(outside, stateFile(), "file")
      writeManuscripts()
      const before = inventory(project)

      const output = await runInit()

      expectSanitizedRefusal(output)
      expect(inventory(project)).toEqual(before)
      expect(readFileSync(outside, "utf-8")).toBe(EXTERNAL_STATE)
      expect(existsSync(configFile())).toBe(false)
      expect(existsSync(dshDir())).toBe(false)
    })

    stest("refuses a broken state.json symlink before any effect", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      symlinkSync("../missing/state.json", stateFile(), "file")
      writeManuscripts()
      const before = inventory(project)

      const output = await runInit()

      expectSanitizedRefusal(output)
      expect(inventory(project)).toEqual(before)
      expect(existsSync(configFile())).toBe(false)
    })

    stest("refuses an escaping .banca ancestor before any effect", async () => {
      mkdirSync(join(base, "outside"), { recursive: true })
      writeFileSync(join(base, "outside", "state.json"), EXTERNAL_STATE, "utf-8")
      symlinkSync(join(base, "outside"), bancaDir(), "dir")
      writeManuscripts()
      const before = inventory(project)

      const output = await runInit()

      expectSanitizedRefusal(output)
      expect(inventory(project)).toEqual(before)
      expect(existsSync(configFile())).toBe(false)
      expect(existsSync(dshDir())).toBe(false)
    })

    test("refuses a non-directory .banca ancestor before any effect", async () => {
      writeFileSync(bancaDir(), "not a directory\n", "utf-8")
      writeManuscripts()
      const before = inventory(project)

      const output = await runInit()

      expectSanitizedRefusal(output)
      expect(inventory(project)).toEqual(before)
    })

    fifoTest(
      "refuses an internal FIFO without a blocking read and before any effect",
      async () => {
        mkdirSync(bancaDir(), { recursive: true })
        expect(spawnSync(mkfifoBinary as string, [stateFile()]).status).toBe(0)
        writeManuscripts()
        const before = inventory(project)

        const { timedOut, parsed } = boundedInit(project, base)

        expect(timedOut).toBe(false)
        expect(parsed.ok).toBe(true)
        const output = String(parsed.result)
        expectSanitizedRefusal(output, ["state refused", "safe regular file"])
        expect(inventory(project)).toEqual(before)
        expect(lstatSync(stateFile()).isFIFO()).toBe(true)
        expect(existsSync(configFile())).toBe(false)
        expect(existsSync(dshDir())).toBe(false)
      },
      20_000,
    )

    fifoSymlinkTest(
      "refuses an external FIFO through a symlink without blocking or effect",
      async () => {
        mkdirSync(bancaDir(), { recursive: true })
        mkdirSync(join(base, "outside"), { recursive: true })
        const outsideFifo = join(base, "outside", "state.json")
        expect(spawnSync(mkfifoBinary as string, [outsideFifo]).status).toBe(0)
        symlinkSync(outsideFifo, stateFile(), "file")
        writeManuscripts()
        const before = inventory(project)

        const { timedOut, parsed } = boundedInit(project, base)

        expect(timedOut).toBe(false)
        expect(parsed.ok).toBe(true)
        expectSanitizedRefusal(String(parsed.result))
        expect(inventory(project)).toEqual(before)
        expect(lstatSync(outsideFifo).isFIFO()).toBe(true)
        expect(existsSync(configFile())).toBe(false)
      },
      20_000,
    )

    unreadableTest("refuses a present but unreadable state file without silent fallback", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      writeFileSync(stateFile(), JSON.stringify(HISTORY_STATE, null, 2), "utf-8")
      writeManuscripts()
      chmodSync(stateFile(), 0o000)
      try {
        let rawCode: string | undefined
        try {
          readFileSync(stateFile(), "utf-8")
        } catch (error) {
          rawCode = (error as NodeJS.ErrnoException).code
        }
        expect(rawCode).toBe("EACCES")

        const before = inventory(project)
        const output = await runInit()

        expectSanitizedRefusal(output, ["state refused", "could not be read"])
        expect(inventory(project)).toEqual(before)
        expect(existsSync(configFile())).toBe(false)
        expect(existsSync(dshDir())).toBe(false)
      } finally {
        chmodSync(stateFile(), 0o644)
      }
    })

    test(
      "refuses a state.json directory with a relative project root before prefixed effects",
      async () => {
        mkdirSync(stateFile(), { recursive: true })
        writeManuscripts()
        const before = inventory(project)

        // The consumer contract resolves a relative projectRoot against the
        // process cwd. A bounded subprocess keeps that cwd explicit.
        const { timedOut, parsed } = boundedInit("project", base)

        expect(timedOut).toBe(false)
        expect(parsed.ok).toBe(true)
        expectSanitizedRefusal(String(parsed.result), ["state refused"])
        expect(inventory(project)).toEqual(before)
        expect(existsSync(join(project, "project"))).toBe(false)
      },
      20_000,
    )

    test("initializes a legitimate project with state.json legitimately absent", async () => {
      writeManuscripts()

      const output = await runInit()

      expect(output).toContain(".banca/ + config + state")
      expect(output).toContain("assets installed")
      expect(existsSync(configFile())).toBe(true)
      expect(JSON.parse(readFileSync(stateFile(), "utf-8"))).toEqual(EMPTY_STATE)
      expect(existsSync(join(bancaDir(), "reports"))).toBe(true)
      expect(existsSync(join(dshDir(), "agents", "banca-auditor.md"))).toBe(true)
      expect(existsSync(join(dshDir(), "commands", "banca-init.md"))).toBe(true)
      expect(existsSync(join(dshDir(), "skills", "banca-avaliacao", "SKILL.md"))).toBe(true)
      expect(existsSync(join(project, "banca-auditor.md"))).toBe(true)
      expect(existsSync(join(bancaDir(), "style-guide.md"))).toBe(true)
    })

    test("initializes with a preexisting regular internal state and preserves its history", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      writeFileSync(stateFile(), JSON.stringify(HISTORY_STATE, null, 2), "utf-8")
      writeManuscripts()

      const output = await runInit()

      expect(output).toContain(".banca/ + config + state")
      expect(JSON.parse(readFileSync(stateFile(), "utf-8"))).toEqual(HISTORY_STATE)
      expect(existsSync(configFile())).toBe(true)
    })

    stest("keeps the internal state symlink policy during initialization", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      mkdirSync(join(project, "estado-real"), { recursive: true })
      writeFileSync(join(project, "estado-real", "state.json"), JSON.stringify(HISTORY_STATE, null, 2), "utf-8")
      symlinkSync(join(project, "estado-real", "state.json"), stateFile(), "file")
      writeManuscripts()

      const output = await runInit()

      expect(output).toContain(".banca/ + config + state")
      expect(JSON.parse(readFileSync(join(project, "estado-real", "state.json"), "utf-8"))).toEqual(HISTORY_STATE)
    })

    test("preserves the legitimate skip without force and without effects", async () => {
      writeSyntheticConfig()
      writeManuscripts()
      // Even with an invalid state present, a regular existing configuration
      // keeps the historical effect-free skip when force is not requested.
      mkdirSync(stateFile(), { recursive: true })
      const before = inventory(project)

      const output = await runInit()

      expect(output).toContain("skipped")
      expect(inventory(project)).toEqual(before)
    })

    test("force legitimately reinitializes and preserves preexisting state history", async () => {
      writeSyntheticConfig()
      writeManuscripts()
      writeFileSync(stateFile(), JSON.stringify(HISTORY_STATE, null, 2), "utf-8")

      const output = await runInit({ force: true })

      expect(output).toContain(".banca/ + config + state")
      expect(output).toContain("assets installed")
      // Legitimate force policy is preserved: configuration is replaced.
      const config = JSON.parse(readFileSync(configFile(), "utf-8"))
      expect(config.targetScore).toBe(9)
      expect(config.manuscript.main).toBe("main.tex")
      // Academic state history is not reset by initialization.
      expect(JSON.parse(readFileSync(stateFile(), "utf-8"))).toEqual(HISTORY_STATE)
      expect(existsSync(join(dshDir(), "agents", "banca-auditor.md"))).toBe(true)
    })

    test("keeps the historical empty-state fallback for invalid internal JSON", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      writeFileSync(stateFile(), "{ invalid }", "utf-8")
      writeManuscripts()

      const output = await runInit()

      expect(output).toContain(".banca/ + config + state")
      expect(JSON.parse(readFileSync(stateFile(), "utf-8"))).toEqual(EMPTY_STATE)
      expect(existsSync(configFile())).toBe(true)
    })

    stest("preserves config confinement: force refuses an escaping project.json symlink", async () => {
      mkdirSync(bancaDir(), { recursive: true })
      mkdirSync(join(base, "outside"), { recursive: true })
      const externalConfig = join(base, "outside", "project.json")
      writeFileSync(externalConfig, JSON.stringify(SYNTHETIC_CONFIG, null, 2), "utf-8")
      symlinkSync(externalConfig, configFile(), "file")
      writeManuscripts()
      const before = inventory(project)

      const output = await runInit({ force: true })

      expect(output).toContain("blocked")
      expect(inventory(project)).toEqual(before)
      expect(readFileSync(externalConfig, "utf-8")).toBe(JSON.stringify(SYNTHETIC_CONFIG, null, 2))
      expect(existsSync(dshDir())).toBe(false)
    })
  })
})
