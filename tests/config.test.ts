import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { loadConfig, saveConfig, validateConfig } from "../src/lib/config"
import { PathTraversalError } from "../src/lib/safe_paths"
import { bancaCompile } from "../src/tools/banca_compile"
import { bancaValidate } from "../src/tools/banca_validate"

const DEFAULT_LIMIT = 50_000

describe("ProjectConfig analysis per-batch limit", () => {
  let root: string
  let path: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ob-config-test-"))
    mkdirSync(join(root, ".banca"), { recursive: true })
    path = join(root, ".banca", "project.json")
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function writeConfig(config: unknown): void {
    writeFileSync(path, JSON.stringify({ version: 1, ...(config as object) }), "utf-8")
  }

  test("uses the exhaustive per-batch defaults when config is absent", () => {
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
  })

  test("sanitizes malformed JSON to independent defaults and validateConfig diagnoses it", () => {
    writeFileSync(path, "{ invalid }", "utf-8")
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
    expect(validateConfig(root).valid).toBe(false)
  })

  test("adds analysis defaults to legacy configs without analysis", () => {
    writeConfig({ version: 1, manuscript: { format: "latex" } })
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
  })

  test("migrates the legacy budgetCharacters alias without exposing it", () => {
    writeConfig({ analysis: { budgetCharacters: 75_000 } })
    const analysis = loadConfig(root).analysis
    expect(analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 75_000 })
    expect(analysis).not.toHaveProperty("budgetCharacters")
    expect(validateConfig(root)).toEqual({ valid: true, errors: [] })
  })

  test("loads a valid explicit per-batch contract", () => {
    writeConfig({ analysis: { coverageMode: "exhaustive", maxCharactersPerBatch: 100_000 } })
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 100_000 })
    expect(validateConfig(root)).toEqual({ valid: true, errors: [] })
  })

  test("defaults an omitted coverageMode and diagnoses another coverage mode", () => {
    writeConfig({ analysis: { maxCharactersPerBatch: 80_000 } })
    expect(loadConfig(root).analysis.coverageMode).toBe("exhaustive")
    expect(validateConfig(root).valid).toBe(true)

    writeConfig({ analysis: { coverageMode: "partial", maxCharactersPerBatch: 80_000 } })
    expect(loadConfig(root).analysis.coverageMode).toBe("exhaustive")
    expect(validateConfig(root).errors).toContain('analysis.coverageMode must be "exhaustive"')
  })

  test("sanitizes invalid analysis shapes and validateConfig diagnoses each one", () => {
    for (const analysis of [null, "invalid", []]) {
      writeConfig({ analysis })
      expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
      expect(validateConfig(root).errors).toContain("analysis must be an object")
    }
  })

  test("sanitizes invalid per-batch limits and validateConfig diagnoses each one", () => {
    for (const maxCharactersPerBatch of [0, -1, 1.5, "50000", null]) {
      writeConfig({ analysis: { maxCharactersPerBatch } })
      expect(loadConfig(root).analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
      expect(validateConfig(root).errors).toContain("analysis.maxCharactersPerBatch must be a finite integer > 0")
    }

    writeFileSync(path, '{"version":1,"analysis":{"maxCharactersPerBatch":1e999}}', "utf-8")
    expect(loadConfig(root).analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
    expect(validateConfig(root).errors).toContain("analysis.maxCharactersPerBatch must be a finite integer > 0")

    writeFileSync(path, '{"version":1,"analysis":{"maxCharactersPerBatch":NaN}}', "utf-8")
    expect(loadConfig(root).analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
    expect(validateConfig(root).valid).toBe(false)
  })

  test("returns independent analysis objects on every load", () => {
    const first = loadConfig(root)
    const second = loadConfig(root)
    expect(first.analysis).not.toBe(second.analysis)
    first.analysis.maxCharactersPerBatch = 999
    expect(second.analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
  })

  test("round-trips only the new contract", () => {
    writeConfig({ analysis: { budgetCharacters: 75_000 } })
    saveConfig(root, loadConfig(root))
    const persisted = JSON.parse(readFileSync(path, "utf-8"))
    expect(persisted.analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 75_000 })
    expect(persisted.analysis).not.toHaveProperty("budgetCharacters")
    expect(loadConfig(root).analysis).toEqual(persisted.analysis)
  })
})

// ---------------------------------------------------------------------------
// Issue #134 — canonical origin boundary for `.banca/project.json`
//
// `loadConfig`/`validateConfig` historically used `existsSync` + `readFileSync`
// without canonical confinement, so a symlink at the configuration file or at
// its `.banca` ancestor redirected the read outside the workspace (or silently
// degraded broken links, ENOTDIR and read failures to defaults/"not found").
//
// The scenarios below require a fail-closed, sanitized refusal BEFORE any byte
// of an external destination is read. The FIFO scenario proves the refusal is
// earlier than the read: a vulnerable implementation blocks on the open until
// the bounded subprocess timeout, while a correct preflight refuses quickly.
//
// Every scratch directory is synthetic and removed in `afterEach`. No DSH host,
// model, network, LaTeX or real manuscript is involved.
// ---------------------------------------------------------------------------

/** Synthetic token that must never reach a refusal diagnostic. */
const CONFIG134_SECRET = "SEGREDO_SINTETICO_EXTERNO_NAO_DEVE_VAZAR"

/** Minimal external configuration used by the reproduction of issue #134. */
const CONFIG134_EXTERNAL = JSON.stringify({
  version: 1,
  manuscript: { main: "missing.tex" },
  immutableFacts: [CONFIG134_SECRET],
})

const config134SymlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-134-config-link-probe-"))
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

const config134Stest = config134SymlinksSupported ? test : test.skip

const config134MkfifoSupported = (() => {
  if (process.platform === "win32") return false
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-134-config-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

const config134FifoTest =
  config134MkfifoSupported && config134SymlinksSupported ? config134Stest : test.skip

const config134UnreadableSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0

/** chmod 000 only denies reads for a non-privileged process. */
const config134UnreadableTest = config134UnreadableSupported ? test : test.skip

/** Raw filesystem error fragments that must never surface in a refusal. */
const CONFIG134_RAW_DIAGNOSTIC_FRAGMENTS = [
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

/**
 * Complete recursive inventory: relative path -> kind, link target and SHA-256
 * of regular-file bytes. Equality proves nothing was created, rewritten or
 * repointed by an attempted configuration read.
 */
function config134TreeSnapshot(rootDir: string): Record<string, string> {
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

function config134Sha256(path: string): string | null {
  if (!existsSync(path)) return null
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

describe("issue #134 — loadConfig canonical configuration origin", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-134-config-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  const bancaDir = (): string => join(project, ".banca")
  const configFile = (): string => join(bancaDir(), "project.json")

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

  /** Run a call that must refuse; otherwise make the missing refusal explicit. */
  function captureRefusal(call: () => unknown): Error {
    try {
      call()
    } catch (error) {
      return error as Error
    }
    throw new Error("expected a controlled configuration refusal, but the call returned a value")
  }

  /**
   * Fail-closed contract: typed controlled error, fixed message with no host
   * absolute path, external target, external content or raw filesystem message.
   */
  function expectSanitizedRefusal(error: Error, extraForbidden: string[] = []): string {
    expect(error).toBeInstanceOf(PathTraversalError)
    const message = String(error.message)
    expect(message.length).toBeGreaterThan(0)
    expect(message).toContain("config refused")
    expect(message).not.toContain(base)
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
    for (const fragment of [
      CONFIG134_SECRET,
      "missing.tex",
      ...CONFIG134_RAW_DIAGNOSTIC_FRAGMENTS,
      ...extraForbidden,
    ]) {
      expect(message).not.toContain(fragment)
    }
    return message
  }

  function expectDefaultConfig(config: ReturnType<typeof loadConfig>): void {
    expect(config.manuscript.main).toBe("main.tex")
    expect(config.manuscript.bib).toBe("referencias.bib")
    expect(config.targetScore).toBe(9.0)
    expect(config.analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
  }

  // A1 — file symlink to an external sibling configuration.
  config134Stest("refuses a project.json symlink to an external configuration file", () => {
    mkdirSync(bancaDir(), { recursive: true })
    const outsideConfig = writeExternalFile("outside/project.json", CONFIG134_EXTERNAL)
    symlinkSync(outsideConfig, configFile(), "file")

    const before = config134TreeSnapshot(base)
    const error = captureRefusal(() => loadConfig(project))
    expectSanitizedRefusal(error)

    expect(config134TreeSnapshot(base)).toEqual(before)
    expect(readFileSync(outsideConfig, "utf-8")).toBe(CONFIG134_EXTERNAL)
  })

  // A2 — `.banca` ancestor symlink to an external directory.
  config134Stest("refuses an external .banca directory symlink", () => {
    writeExternalFile("outside/project.json", CONFIG134_EXTERNAL)
    symlinkSync(join(base, "outside"), bancaDir(), "dir")

    const error = captureRefusal(() => loadConfig(project))
    expectSanitizedRefusal(error)
  })

  // A3 — broken file symlink is blocked, never "legitimately absent".
  config134Stest("refuses a broken project.json symlink instead of falling back to defaults", () => {
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync("../no-such-dir/project.json", configFile(), "file")

    const error = captureRefusal(() => loadConfig(project))
    expectSanitizedRefusal(error)
  })

  // A4 — broken ancestor symlink is blocked, never "legitimately absent".
  config134Stest("refuses a broken .banca ancestor symlink instead of falling back to defaults", () => {
    symlinkSync("../no-such-banca", bancaDir(), "dir")

    const error = captureRefusal(() => loadConfig(project))
    expectSanitizedRefusal(error)
  })

  // A5 — `.banca` exists as a regular file (ENOTDIR is not absence).
  test("refuses a non-directory .banca ancestor instead of reporting absence", () => {
    writeFileSync(bancaDir(), "not a directory\n", "utf-8")

    const error = captureRefusal(() => loadConfig(project))
    expectSanitizedRefusal(error)
  })

  // A6 — the configuration destination exists as a directory.
  test("refuses a project.json destination that is a directory", () => {
    mkdirSync(configFile(), { recursive: true })

    const error = captureRefusal(() => loadConfig(project))
    expectSanitizedRefusal(error)
  })

  // A7 — non-regular destination: a FIFO must be refused without opening it.
  config134FifoTest(
    "refuses a FIFO configuration destination without a blocking read",
    () => {
      mkdirSync(bancaDir(), { recursive: true })
      mkdirSync(join(base, "outside"), { recursive: true })
      const fifo = join(base, "outside", "project.json")
      expect(spawnSync("mkfifo", [fifo]).status).toBe(0)
      symlinkSync(fifo, configFile(), "file")

      const workerPath = join(base, "config-fifo-worker.mjs")
      const configUrl = pathToFileURL(join(import.meta.dir, "..", "src", "lib", "config.ts")).href
      writeFileSync(
        workerPath,
        [
          "const configUrl = process.argv[2]",
          "const project = process.argv[3]",
          "const { loadConfig, validateConfig } = await import(configUrl)",
          "let load, validate",
          "try { load = { ok: true, main: loadConfig(project).manuscript.main } }",
          'catch (error) { load = { ok: false, name: String(error && error.name), message: String(error && error.message) } }',
          "try { validate = { ok: true, result: validateConfig(project) } }",
          'catch (error) { validate = { ok: false, name: String(error && error.name), message: String(error && error.message) } }',
          "console.log(JSON.stringify({ load, validate }))",
          "",
        ].join("\n"),
        "utf-8",
      )

      const outcome = spawnSync(process.execPath, [workerPath, configUrl, project], {
        timeout: 5000,
        encoding: "utf-8",
      })

      // A vulnerable implementation would block reading the FIFO and hit the
      // timeout; a correct preflight refuses quickly.
      expect(outcome.error).toBeUndefined()
      expect(outcome.signal).toBeNull()
      const jsonLine = (outcome.stdout ?? "")
        .split("\n")
        .reverse()
        .find((line) => line.trim().startsWith("{"))
      expect(jsonLine).toBeDefined()
      const parsed = JSON.parse(jsonLine as string) as {
        load: { ok: boolean; name?: string; message?: string }
        validate: { ok: boolean; result?: { valid: boolean; errors: string[] } }
      }
      expect(parsed.load.ok).toBe(false)
      expect(parsed.load.name).toBe("PathTraversalError")
      expect(parsed.validate.ok).toBe(true)
      expect(parsed.validate.result?.valid).toBe(false)
      expect(parsed.validate.result?.errors.length).toBeGreaterThan(0)
      const serialized = JSON.stringify(parsed)
      expect(serialized).not.toContain(base)
      for (const fragment of [CONFIG134_SECRET, ...CONFIG134_RAW_DIAGNOSTIC_FRAGMENTS]) {
        expect(serialized).not.toContain(fragment)
      }
    },
    20_000,
  )

  // A8 — present configuration that cannot be read is not absence/defaults.
  config134UnreadableTest("refuses a present but unreadable configuration file", () => {
    writeInternalConfig(JSON.stringify({ version: 1, manuscript: { main: "custom.tex" } }))
    chmodSync(configFile(), 0o000)
    try {
      // Prove the environment really denies the read (non-root, no override).
      let rawCode: string | undefined
      try {
        readFileSync(configFile(), "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      const error = captureRefusal(() => loadConfig(project))
      const message = expectSanitizedRefusal(error)
      expect(message).toContain("could not be read")
    } finally {
      chmodSync(configFile(), 0o644)
    }
  })

  // A9 — truly absent `.banca` keeps legitimate defaults.
  test("keeps legitimate defaults when .banca is truly absent", () => {
    expectDefaultConfig(loadConfig(project))
  })

  // A10 — absent configuration inside an existing `.banca` keeps defaults.
  test("keeps legitimate defaults when project.json is truly absent", () => {
    mkdirSync(bancaDir(), { recursive: true })
    expectDefaultConfig(loadConfig(project))
  })

  // A11 — internal regular configuration keeps loading/sanitizing.
  test("loads and sanitizes an internal regular configuration", () => {
    writeInternalConfig(
      JSON.stringify({
        version: 1,
        manuscript: { main: "principal.tex", chapters: ["secoes/*.tex"] },
        targetScore: 8.5,
        analysis: { coverageMode: "exhaustive", maxCharactersPerBatch: 75_000 },
      }),
    )

    const config = loadConfig(project)
    expect(config.manuscript.main).toBe("principal.tex")
    expect(config.manuscript.chapters).toEqual(["secoes/*.tex"])
    expect(config.targetScore).toBe(8.5)
    expect(config.analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 75_000 })
    expect(validateConfig(project)).toEqual({ valid: true, errors: [] })
  })

  // A12 — internal invalid JSON keeps the historical fallback.
  test("keeps the historical defaults fallback for invalid internal JSON", () => {
    writeInternalConfig("{ invalid }")

    expectDefaultConfig(loadConfig(project))
    const result = validateConfig(project)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBe(1)
  })

  // A13 — internal symlinks remain allowed by the existing policy.
  config134Stest("allows an internal symlink at the configuration file", () => {
    mkdirSync(bancaDir(), { recursive: true })
    mkdirSync(join(project, "configs"), { recursive: true })
    writeFileSync(
      join(project, "configs", "real-project.json"),
      JSON.stringify({ version: 1, manuscript: { main: "custom.tex" } }),
      "utf-8",
    )
    symlinkSync(join(project, "configs", "real-project.json"), configFile(), "file")

    expect(loadConfig(project).manuscript.main).toBe("custom.tex")
    expect(validateConfig(project)).toEqual({ valid: true, errors: [] })
  })

  config134Stest("allows an internal symlink ancestor for .banca", () => {
    mkdirSync(join(project, "banca-real"), { recursive: true })
    writeFileSync(
      join(project, "banca-real", "project.json"),
      JSON.stringify({ version: 1, manuscript: { main: "custom.tex" } }),
      "utf-8",
    )
    symlinkSync(join(project, "banca-real"), bancaDir(), "dir")

    expect(loadConfig(project).manuscript.main).toBe("custom.tex")
    expect(validateConfig(project)).toEqual({ valid: true, errors: [] })
  })

  // A14 — historical migration, defaults and exhaustive coverage contracts.
  test("preserves migration and exhaustive coverage configuration contracts", () => {
    writeInternalConfig(
      JSON.stringify({ manuscript: { main: "legado.tex" }, mcp: { referenceValidation: true } }),
    )

    const migrated = loadConfig(project)
    expect(migrated.version).toBe(1)
    expect(migrated.manuscript.main).toBe("legado.tex")
    expect(migrated.providers.references.primary).toBe("mcp:crossref-academic")
    expect(migrated.providers.references.fallbacks).toEqual(["rest:crossref", "cache"])
    // validateConfig keeps validating the stored document (no migration), as before.
    expect(validateConfig(project).errors).toContain("version must be >= 1")

    writeInternalConfig(JSON.stringify({ version: 1, analysis: { budgetCharacters: 75_000 } }))
    expect(loadConfig(project).analysis).toEqual({
      coverageMode: "exhaustive",
      maxCharactersPerBatch: 75_000,
    })
    expect(validateConfig(project)).toEqual({ valid: true, errors: [] })
  })
})

describe("issue #134 — validateConfig canonical configuration origin", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-134-validate-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  const bancaDir = (): string => join(project, ".banca")
  const configFile = (): string => join(bancaDir(), "project.json")

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

  function expectSanitizedInvalid(result: { valid: boolean; errors: string[] }): void {
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(base)
    expect(serialized).not.toContain("config not found")
    for (const fragment of [
      CONFIG134_SECRET,
      "missing.tex",
      ...CONFIG134_RAW_DIAGNOSTIC_FRAGMENTS,
    ]) {
      expect(serialized).not.toContain(fragment)
    }
    expect(result.errors.join("\n")).toContain("config refused")
  }

  config134Stest("returns valid:false for a config file symlinked outside the workspace", () => {
    mkdirSync(bancaDir(), { recursive: true })
    const outsideConfig = writeExternalFile("outside/project.json", CONFIG134_EXTERNAL)
    symlinkSync(outsideConfig, configFile(), "file")

    expectSanitizedInvalid(validateConfig(project))
    expect(readFileSync(outsideConfig, "utf-8")).toBe(CONFIG134_EXTERNAL)
  })

  config134Stest("returns valid:false for an external .banca directory symlink", () => {
    writeExternalFile("outside/project.json", CONFIG134_EXTERNAL)
    symlinkSync(join(base, "outside"), bancaDir(), "dir")

    expectSanitizedInvalid(validateConfig(project))
  })

  config134Stest("does not degrade a broken symlink into 'config not found'", () => {
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync("../no-such-dir/project.json", configFile(), "file")

    expectSanitizedInvalid(validateConfig(project))
  })

  config134Stest("does not degrade a broken .banca ancestor into 'config not found'", () => {
    symlinkSync("../no-such-banca", bancaDir(), "dir")

    expectSanitizedInvalid(validateConfig(project))
  })

  test("refuses a non-regular project.json destination with a sanitized diagnostic", () => {
    mkdirSync(configFile(), { recursive: true })

    expectSanitizedInvalid(validateConfig(project))
  })

  config134UnreadableTest("does not mask a real read failure of a present configuration", () => {
    writeInternalConfig(JSON.stringify({ version: 1, manuscript: { main: "custom.tex" } }))
    chmodSync(configFile(), 0o000)
    try {
      let rawCode: string | undefined
      try {
        readFileSync(configFile(), "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      const result = validateConfig(project)
      expect(result.valid).toBe(false)
      expect(result.errors.join("\n")).toContain("could not be read")
      expect(JSON.stringify(result)).not.toContain(base)
      for (const fragment of CONFIG134_RAW_DIAGNOSTIC_FRAGMENTS) {
        expect(JSON.stringify(result)).not.toContain(fragment)
      }
    } finally {
      chmodSync(configFile(), 0o644)
    }
  })

  test("keeps the historical 'config not found' contract for legitimate absence", () => {
    expect(validateConfig(project)).toEqual({ valid: false, errors: ["config not found"] })
    mkdirSync(bancaDir(), { recursive: true })
    expect(validateConfig(project)).toEqual({ valid: false, errors: ["config not found"] })
  })

  test("keeps validating an internal regular configuration without regressions", () => {
    writeInternalConfig(JSON.stringify({ version: 1 }))
    expect(validateConfig(project)).toEqual({ valid: true, errors: [] })

    writeInternalConfig(JSON.stringify({ version: 1, targetScore: 15 }))
    const result = validateConfig(project)
    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.includes("targetScore"))).toBe(true)

    writeInternalConfig("{ invalid }")
    const malformed = validateConfig(project)
    expect(malformed.valid).toBe(false)
    expect(malformed.errors.length).toBe(1)
  })

  // The public consumer of validateConfig must report the refusal instead of
  // consuming an external configuration as valid.
  test("banca_validate reports the structured refusal, never 'config valid'", async () => {
    writeExternalFile("outside/project.json", CONFIG134_EXTERNAL)
    mkdirSync(bancaDir(), { recursive: true })
    symlinkSync(join(base, "outside", "project.json"), configFile(), "file")

    const output = await bancaValidate.execute({ projectRoot: project }, { directory: project } as never)
    expect(output).toContain("✗ config invalid:")
    expect(output).toContain("config refused")
    expect(output).not.toContain("✓ config valid")
    expect(output).not.toContain(base)
    expect(output).not.toContain(CONFIG134_SECRET)
  })
})

describe("issue #134 — banca_compile refuses before deriving compilation from an external origin", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-134-compile-"))
    project = join(base, "project")
    mkdirSync(join(project, ".banca"), { recursive: true })
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  config134Stest("refuses an external configuration before any compilation decision", async () => {
    const compilerConfig = JSON.stringify({
      version: 1,
      compile: { enabled: false, command: [] },
    })
    const outsideConfig = join(base, "outside-project.json")
    writeFileSync(outsideConfig, compilerConfig, "utf-8")
    symlinkSync(outsideConfig, join(project, ".banca", "project.json"), "file")

    const before = config134TreeSnapshot(base)
    await expect(
      bancaCompile.execute({ projectRoot: project }, { directory: project } as never),
    ).rejects.toThrow(PathTraversalError)
    expect(config134TreeSnapshot(base)).toEqual(before)
    expect(config134Sha256(outsideConfig)).not.toBeNull()
    expect(readFileSync(outsideConfig, "utf-8")).toBe(compilerConfig)
  })
})

// ---------------------------------------------------------------------------
// Issue #134 R1 — relative project roots must inspect the true configuration
//
// R1 regression at HEAD 31bc382: `readConfigOrigin` passed
// `configPath(projectRoot)` (which already contains the root) back to a
// root-relative resolver. For a relative root the root was applied twice and
// the inspected destination became `<root>/<root>/.banca/project.json`, so an
// internal duplicate could be consumed instead of the true configuration (or
// the true insecure origin could be bypassed entirely).
//
// Relative roots are exercised through a bounded child process whose `cwd` is
// the scratch base, so the relative resolution matches a real caller without
// changing the test process working directory.
// ---------------------------------------------------------------------------

const R1_SECRET = "SEGREDO_RELATIVO_EXTERNO_NAO_DEVE_VAZAR"

const R1_TRUE_CONFIG = JSON.stringify({
  version: 1,
  manuscript: { main: "custom.tex" },
  protectedPaths: ["main.tex"],
  targetScore: 7,
})

const R1_DECOY_CONFIG = JSON.stringify({
  version: 1,
  manuscript: { main: "nested-decoy.tex" },
  protectedPaths: [],
  targetScore: 1,
})

const R1_EXTERNAL_CONFIG = JSON.stringify({
  version: 1,
  manuscript: { main: "external.tex" },
  immutableFacts: [R1_SECRET],
})

type R1LibraryRead = {
  load:
    | { ok: true; value: { main: string; protectedPaths: string[]; targetScore: number; version: number } }
    | { ok: false; name: string; message: string }
  validate:
    | { ok: true; result: { valid: boolean; errors: string[] } }
    | { ok: false; name: string; message: string }
}

const R1_LIBRARY_WORKER_SOURCE = [
  "const configUrl = process.argv[2]",
  "const root = process.argv[3]",
  "const { loadConfig, validateConfig } = await import(configUrl)",
  "let load, validate",
  "try {",
  "  const value = loadConfig(root)",
  "  load = { ok: true, value: { main: value.manuscript.main, protectedPaths: value.protectedPaths, targetScore: value.targetScore, version: value.version } }",
  "} catch (error) {",
  '  load = { ok: false, name: String(error && error.name), message: String(error && error.message) }',
  "}",
  "try {",
  "  validate = { ok: true, result: validateConfig(root) }",
  "} catch (error) {",
  '  validate = { ok: false, name: String(error && error.name), message: String(error && error.message) }',
  "}",
  "console.log(JSON.stringify({ load, validate }))",
  "",
].join("\n")

function r1LibraryRead(baseDir: string, root: string): R1LibraryRead {
  const workerPath = join(baseDir, "r1-config-worker.mjs")
  writeFileSync(workerPath, R1_LIBRARY_WORKER_SOURCE, "utf-8")
  const configUrl = pathToFileURL(join(import.meta.dir, "..", "src", "lib", "config.ts")).href
  const outcome = spawnSync(process.execPath, [workerPath, configUrl, root], {
    cwd: baseDir,
    timeout: 15_000,
    encoding: "utf-8",
  })
  expect(outcome.error).toBeUndefined()
  expect(outcome.signal).toBeNull()
  const jsonLine = (outcome.stdout ?? "")
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"))
  expect(jsonLine).toBeDefined()
  return JSON.parse(jsonLine as string) as R1LibraryRead
}

const R1_TOOL_WORKER_SOURCE = [
  "const toolUrl = process.argv[2]",
  "const toolName = process.argv[3]",
  "const root = process.argv[4]",
  "try {",
  "  const mod = await import(toolUrl)",
  "  const result = await mod[toolName].execute({ projectRoot: root }, { directory: root })",
  '  console.log(JSON.stringify({ ok: true, output: typeof result === "string" ? result : result.output }))',
  "} catch (error) {",
  '  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))',
  "}",
  "",
].join("\n")

function r1ToolRead(
  baseDir: string,
  toolRelativePath: string,
  toolName: string,
  root: string,
): { ok: true; output: string } | { ok: false; name?: string; message?: string } {
  const workerPath = join(baseDir, "r1-tool-worker.mjs")
  writeFileSync(workerPath, R1_TOOL_WORKER_SOURCE, "utf-8")
  const toolUrl = pathToFileURL(join(import.meta.dir, "..", toolRelativePath)).href
  const outcome = spawnSync(process.execPath, [workerPath, toolUrl, toolName, root], {
    cwd: baseDir,
    timeout: 15_000,
    encoding: "utf-8",
  })
  expect(outcome.error).toBeUndefined()
  expect(outcome.signal).toBeNull()
  const jsonLine = (outcome.stdout ?? "")
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"))
  expect(jsonLine).toBeDefined()
  return JSON.parse(jsonLine as string)
}

describe("issue #134 R1 — relative project roots inspect the true configuration", () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-134-r1-"))
  })

  afterEach(() => rmSync(base, { recursive: true, force: true }))

  function seedWorkspace(relativeDir: string, configContent = R1_TRUE_CONFIG): string {
    const workspace = join(base, relativeDir)
    mkdirSync(join(workspace, ".banca"), { recursive: true })
    writeFileSync(join(workspace, ".banca", "project.json"), configContent, "utf-8")
    return workspace
  }

  function expectTrueConfiguration(read: R1LibraryRead): void {
    expect(read.load.ok).toBe(true)
    if (!read.load.ok) return
    expect(read.load.value.main).toBe("custom.tex")
    expect(read.load.value.protectedPaths).toEqual(["main.tex"])
    expect(read.load.value.targetScore).toBe(7)
    expect(read.validate.ok).toBe(true)
    if (!read.validate.ok) return
    expect(read.validate.result).toEqual({ valid: true, errors: [] })
  }

  function expectSanitizedR1Refusal(read: R1LibraryRead): void {
    expect(read.load.ok).toBe(false)
    if (read.load.ok) return
    expect(read.load.name).toBe("PathTraversalError")
    expect(read.load.message).toContain("config refused")
    expect(String(read.load.message)).not.toContain(base)
    expect(String(read.load.message)).not.toContain(R1_SECRET)
    expect(String(read.load.message)).not.toContain("external.tex")
    expect(String(read.load.message)).not.toContain("nested-decoy.tex")

    expect(read.validate.ok).toBe(true)
    if (!read.validate.ok) return
    expect(read.validate.result.valid).toBe(false)
    const serialized = JSON.stringify(read.validate.result)
    expect(serialized).not.toContain(base)
    expect(serialized).not.toContain(R1_SECRET)
    expect(serialized).not.toContain("external.tex")
    expect(serialized).not.toContain("nested-decoy.tex")
    expect(read.validate.result.errors.join("\n")).toContain("config refused")
  }

  // A — absolute and relative roots are equivalent for both readers.
  test("loadConfig and validateConfig read the same true config from every root form", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("parent", "workspace"))

    const workspaceAbsolute = join(base, "workspace")
    const nestedAbsolute = join(base, "parent", "workspace")
    const cases: Array<{ label: string; root: string; expectedWorkspace: string }> = [
      { label: "absolute", root: workspaceAbsolute, expectedWorkspace: workspaceAbsolute },
      { label: "relative", root: "workspace", expectedWorkspace: workspaceAbsolute },
      { label: "./relative", root: "./workspace", expectedWorkspace: workspaceAbsolute },
      { label: "nested absolute", root: nestedAbsolute, expectedWorkspace: nestedAbsolute },
      { label: "nested relative", root: join("parent", "workspace"), expectedWorkspace: nestedAbsolute },
    ]

    for (const testCase of cases) {
      const read = r1LibraryRead(base, testCase.root)
      try {
        expectTrueConfiguration(read)
      } catch (error) {
        throw new Error(`root form failed: ${testCase.label} (${testCase.root}): ${String(error)}`)
      }
    }
  })

  // B — the internal duplicate at `<root>/<root>/.banca/project.json` is never consumed.
  test("internal duplicate does not influence loadConfig or validateConfig", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("workspace", "workspace"), R1_DECOY_CONFIG)

    for (const root of [join(base, "workspace"), "workspace"]) {
      const read = r1LibraryRead(base, root)
      expectTrueConfiguration(read)
      // The decoy values would be observable if the wrong destination was chosen.
      if (read.load.ok) {
        expect(read.load.value.main).not.toBe("nested-decoy.tex")
        expect(read.load.value.targetScore).not.toBe(1)
      }
    }
  })

  test("validateConfig uses the true config when the internal duplicate is invalid", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("workspace", "workspace"), JSON.stringify({ version: 0 }))

    const read = r1LibraryRead(base, "workspace")
    // A wrong destination would report the decoy's `version must be >= 1`.
    expect(read.load.ok).toBe(true)
    expect(read.validate.ok).toBe(true)
    if (read.validate.ok) expect(read.validate.result).toEqual({ valid: true, errors: [] })
  })

  test("validateConfig diagnoses the true config when the internal duplicate is valid", () => {
    seedWorkspace(
      "workspace",
      JSON.stringify({ version: 1, manuscript: { main: "custom.tex" }, targetScore: 15 }),
    )
    seedWorkspace(join("workspace", "workspace"), R1_DECOY_CONFIG)

    const read = r1LibraryRead(base, "workspace")
    // A wrong destination would accept the decoy as valid.
    expect(read.validate.ok).toBe(true)
    if (read.validate.ok) {
      expect(read.validate.result.valid).toBe(false)
      expect(read.validate.result.errors.some((error) => error.includes("targetScore"))).toBe(true)
    }
    expect(read.load.ok).toBe(true)
    if (read.load.ok) expect(read.load.value.main).toBe("custom.tex")
  })

  // C — the true insecure origin is refused even when a valid internal duplicate exists.
  config134Stest("refuses external symlink true origin despite an internal duplicate", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("workspace", "workspace"), R1_DECOY_CONFIG)
    const outside = join(base, "outside-workspace-config.json")
    writeFileSync(outside, R1_EXTERNAL_CONFIG, "utf-8")
    rmSync(join(base, "workspace", ".banca", "project.json"))
    symlinkSync(outside, join(base, "workspace", ".banca", "project.json"), "file")

    // Materialize the bounded worker before the inventory snapshot so the
    // harness file is part of the stable tree, not a post-snapshot artifact.
    writeFileSync(join(base, "r1-config-worker.mjs"), R1_LIBRARY_WORKER_SOURCE, "utf-8")
    const before = config134TreeSnapshot(base)
    for (const root of [join(base, "workspace"), "workspace"]) {
      expectSanitizedR1Refusal(r1LibraryRead(base, root))
    }
    expect(config134TreeSnapshot(base)).toEqual(before)
    expect(readFileSync(outside, "utf-8")).toBe(R1_EXTERNAL_CONFIG)
  })

  config134Stest("refuses broken symlink true origin despite an internal duplicate", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("workspace", "workspace"), R1_DECOY_CONFIG)
    rmSync(join(base, "workspace", ".banca", "project.json"))
    symlinkSync("../no-such-r1/config.json", join(base, "workspace", ".banca", "project.json"), "file")

    for (const root of [join(base, "workspace"), "workspace"]) {
      const read = r1LibraryRead(base, root)
      expectSanitizedR1Refusal(read)
      // The valid internal duplicate must not be reported as absence/defaults.
      if (read.validate.ok) expect(read.validate.result.errors).not.toEqual(["config not found"])
    }
  })

  // D — true absence with a valid internal duplicate keeps legitimate absence.
  test("legitimate absence with relative root is not replaced by the internal duplicate", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("workspace", "workspace"), R1_DECOY_CONFIG)
    rmSync(join(base, "workspace", ".banca", "project.json"))

    for (const root of [join(base, "workspace"), "workspace"]) {
      const read = r1LibraryRead(base, root)
      expect(read.load.ok).toBe(true)
      if (read.load.ok) {
        expect(read.load.value.main).toBe("main.tex")
        expect(read.load.value.targetScore).toBe(9)
        expect(read.load.value.protectedPaths).toContain("dados/**")
      }
      expect(read.validate.ok).toBe(true)
      if (read.validate.ok) expect(read.validate.result).toEqual({ valid: false, errors: ["config not found"] })
    }
  })

  // E — the real public validation consumer with a relative root.
  test("banca_validate validates the true configuration from a relative root", () => {
    seedWorkspace("workspace")

    const output = r1ToolRead(base, join("src", "tools", "banca_validate.ts"), "bancaValidate", "workspace")
    expect(output.ok).toBe(true)
    if (output.ok) {
      expect(output.output).toContain("✓ config valid")
      expect(output.output).not.toContain("config not found")
    }
  })

  test("banca_validate refuses an external true origin from a relative root", () => {
    seedWorkspace("workspace")
    seedWorkspace(join("workspace", "workspace"), R1_DECOY_CONFIG)
    const outside = join(base, "outside-workspace-config.json")
    writeFileSync(outside, R1_EXTERNAL_CONFIG, "utf-8")
    rmSync(join(base, "workspace", ".banca", "project.json"))
    symlinkSync(outside, join(base, "workspace", ".banca", "project.json"), "file")

    const output = r1ToolRead(base, join("src", "tools", "banca_validate.ts"), "bancaValidate", "workspace")
    expect(output.ok).toBe(true)
    if (output.ok) {
      expect(output.output).toContain("✗ config invalid:")
      expect(output.output).toContain("config refused")
      expect(output.output).not.toContain("✓ config valid")
      expect(output.output).not.toContain(base)
      expect(output.output).not.toContain(R1_SECRET)
    }
  })
})
