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
