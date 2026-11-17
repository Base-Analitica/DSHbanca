/**
 * Focal tests for issue #165 — canonical read boundary for the local reference
 * cache (`.banca/cache/refs.json`).
 *
 * `RefCache.load()` used to call `existsSync` + `readFileSync` on a lexical
 * path, so a symbolic link planted at the leaf file or at an ancestor
 * (`.banca`, `.banca/cache`) could redirect the read outside the workspace and
 * the external JSON was consumed as a legitimate local cache entry. Read
 * failures were also folded into an empty cache, and `banca_refs` could report
 * an external entry as `cache` / `verificada`.
 *
 * These tests exercise the REAL `RefCache` class and the REAL `banca_refs` tool
 * over synthetic scratch workspaces only: no DSH host, no model, no network, no
 * credentials and no real data. External fixtures are synthetic siblings of the
 * scratch workspace and are removed by the same `afterEach` teardown; the only
 * subprocesses are the bounded `bun` workers used for the FIFO destination and
 * for the relative-root scenarios.
 *
 * Coverage:
 * - refusals: external leaf link, external ancestor link, broken link,
 *   directory destination, FIFO destination (bounded, with timeout), and an
 *   internal regular file that cannot be read;
 * - absence: a truly missing `refs.json` keeps the legitimate empty-cache
 *   behavior and is never confused with an unsafe origin or a read failure;
 * - positives: regular internal file, internal leaf link and internal ancestor
 *   link, relative root and `./` root, key/DOI matching, protected `set()`/save
 *   round-trip;
 * - tool flow: legitimate cache-only validation is preserved, an unsafe cache
 *   origin becomes a sanitized `blocked:` refusal with no report and no false
 *   validation, and a missing cache keeps the historical blocked behavior;
 * - read-only proof: complete recursive inventory/hashes and external fixture
 *   hashes are unchanged across refusals.
 *
 * Residual TOCTOU limits (documented, not claimed as solved): the canonical
 * inspection happens immediately before the read, but a concurrent mutation
 * between the two calls is not defended against. Hard links to an external
 * inode are path-indistinguishable and are out of scope of this boundary. The
 * FIFO/relative-root workers are bounded scaffolding for the test, not a
 * permission or sandbox mechanism.
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
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { RefCache } from "../src/lib/cache"
import { PathTraversalError } from "../src/lib/safe_paths"
import { bancaRefs } from "../src/tools/banca_refs"
import type { RefMetadata, ValidationResult } from "../src/lib/academic"

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const symlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-165-link-probe-"))
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
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-165-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

/**
 * A FIFO would block `readFileSync`; the scenario runs the real class in a
 * bounded child process so a regression fails by timeout instead of hanging the
 * suite.
 */
const fifoTest = mkfifoSupported ? stest : test.skip

/** Reading a 0o000 file is enforced for non-root users only. */
const readPermissionTest = (() => {
  const getuid = (process as unknown as { getuid?: () => number }).getuid
  return typeof getuid === "function" && getuid() === 0 ? test.skip : test
})()

/** Synthetic token that must never appear in a refusal diagnostic. */
const OUTSIDE_SECRET = "SEGREDO_SINTETICO_CACHE_EXTERNO_165_NAO_DEVE_VAZAR"
/** External marker used to prove the outside JSON was (or was not) consumed. */
const EXTERNAL_MARKER = "SYNTHETIC_OUTSIDE_CACHE_MATCH_2026"
/** Internal marker for legitimate cache entries. */
const INTERNAL_MARKER = "SYNTHETIC_INTERNAL_CACHE_MATCH_2026"
const CACHE_KEY = "sintetico165"
const CACHE_DOI = "10.9999/sintetico.165"

const FIXED_RESULT = (evidence: string, score = 96): ValidationResult => ({
  key: CACHE_KEY,
  found: true,
  score,
  status: "verificada",
  matchedBy: "doi",
  evidence,
  metadata: {
    key: CACHE_KEY,
    title: `Entrada sintetica ${OUTSIDE_SECRET}`,
    doi: CACHE_DOI,
  },
})

const FIXED_REF: RefMetadata = { key: CACHE_KEY, doi: CACHE_DOI }

function cacheEntryJson(evidence: string, doi: string = CACHE_DOI): string {
  return JSON.stringify(
    [
      {
        key: CACHE_KEY,
        doi,
        result: FIXED_RESULT(evidence),
        cachedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    null,
    2,
  )
}

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-165-cache-"))
  project = join(base, "workspace")
  mkdirSync(project, { recursive: true })
})

afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function cachePath(): string {
  return join(project, ".banca", "cache", "refs.json")
}

function reports(): string[] {
  const dir = join(project, ".banca", "reports")
  return existsSync(dir) ? readdirSync(dir) : []
}

/** Point `linkPath` at `targetPath` with a relative target (portable scratch). */
function linkTo(targetPath: string, linkPath: string): void {
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(relative(dirname(linkPath), targetPath), linkPath)
}

/** Point `linkPath` at a target that does not exist. */
function brokenLink(linkPath: string): void {
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(join(dirname(linkPath), "missing-target-165.json"), linkPath)
}

function seedInternalCache(content: string = cacheEntryJson(INTERNAL_MARKER)): void {
  mkdirSync(dirname(cachePath()), { recursive: true })
  writeFileSync(cachePath(), content, "utf-8")
}

/** Synthetic external cache file beside the workspace. */
function writeExternalCache(): string {
  const outside = join(base, "outside")
  mkdirSync(outside, { recursive: true })
  const external = join(outside, "refs.json")
  writeFileSync(external, cacheEntryJson(EXTERNAL_MARKER), "utf-8")
  return external
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * Complete recursive inventory of a scratch tree: relative path -> kind.
 * Directories, symlink targets and SHA-256 of regular-file bytes are recorded,
 * so equality proves nothing was created, removed, rewritten or repointed.
 */
function inventory(rootDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const rel = relative(rootDir, full)
      const st = lstatSync(full)
      if (st.isSymbolicLink()) {
        out[rel] = `link->${readlinkSync(full)}`
      } else if (st.isDirectory()) {
        out[rel] = "dir"
        walk(full)
      } else {
        out[rel] = `file:${sha256OfFile(full)}`
      }
    }
  }
  walk(rootDir)
  return out
}

function writeBib(): void {
  writeFileSync(
    join(project, "referencias.bib"),
    `@article{${CACHE_KEY},
  author = {Sintetico, Autor},
  title = {Entrada Sintetica de Teste},
  year = {2026},
  doi = {${CACHE_DOI}}
}
`,
    "utf-8",
  )
}

async function runRefs(root: string = project): Promise<string> {
  return String(await bancaRefs.execute({ projectRoot: root }, { directory: root }))
}

/** Fixed sanitized refusal for an unsafe/unreadable cache origin. */
function expectSanitizedRefusal(error: unknown): void {
  expect(error).toBeInstanceOf(PathTraversalError)
  const message = (error as Error).message
  expect(message).toMatch(/^reference cache refused: /)
  expect(message).not.toContain(base)
  expect(message).not.toContain(project)
  expect(message).not.toContain(EXTERNAL_MARKER)
  expect(message).not.toContain(OUTSIDE_SECRET)
  // No raw filesystem diagnostics or link targets leak into the refusal.
  expect(message).not.toMatch(/\bE(?:NOENT|ACCES|PERM|LOOP|ISDIR|IO|MFILE|NFILE|NAMETOOLONG|STALE)\b/)
  expect(message).not.toContain("->")
}

function expectNoToolArtifacts(): void {
  expect(reports()).toEqual([])
}

function expectToolRefusal(text: string): void {
  expect(text.startsWith("blocked: reference cache origin was refused")).toBe(true)
  expect(text).toContain("no reference result or report was produced")
  expect(text).not.toContain(EXTERNAL_MARKER)
  expect(text).not.toContain(OUTSIDE_SECRET)
  expect(text).not.toContain(base)
  expect(text).not.toContain("Verified: 1")
  expect(text).not.toContain("cache=1")
  expectNoToolArtifacts()
}

// ---------------------------------------------------------------------------
// Bounded worker: FIFO destination and relative project roots
// ---------------------------------------------------------------------------
const WORKER_SOURCE = [
  "const moduleUrl = process.argv[2]",
  "const mode = process.argv[3]",
  "const projectRoot = process.argv[4]",
  "const mod = await import(moduleUrl)",
  'const KEY = "sintetico165"',
  'const DOI = "10.9999/sintetico.165"',
  'const RESULT = { key: KEY, found: true, score: 95, status: "verificada", matchedBy: "doi", evidence: "bounded worker synthetic entry" }',
  "try {",
  "  const cache = new mod.RefCache(projectRoot)",
  '  if (mode === "set") cache.set(KEY, DOI, RESULT)',
  "  const hit = cache.get({ key: KEY, doi: DOI })",
  '  console.log(JSON.stringify({ ok: true, hit: hit ? { score: hit.score, evidence: hit.evidence } : null, summary: cache.summary() }))',
  "} catch (error) {",
  '  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))',
  "}",
  "",
].join("\n")

interface BoundedResult {
  timedOut: boolean
  parsed: {
    ok: boolean
    hit?: { score: number; evidence: string } | null
    summary?: { total: number; verified: number; pending: number }
    name?: string
    message?: string
  }
}

function boundedCache(cwd: string, mode: string, projectRoot: string): BoundedResult {
  const worker = join(base, `cache-worker-165-${mode}.mjs`)
  writeFileSync(worker, WORKER_SOURCE, "utf-8")
  const moduleUrl = pathToFileURL(join(import.meta.dir, "..", "src", "lib", "cache.ts")).href
  const outcome = spawnSync(process.execPath, [worker, moduleUrl, mode, projectRoot], {
    cwd,
    env: { ...process.env, PATH: "" },
    timeout: 20_000,
    encoding: "utf-8",
  })
  const timedOut = outcome.error !== undefined || outcome.signal !== null
  const jsonLine = (outcome.stdout ?? "")
    .split("\n")
    .reverse()
    .find((line) => line.trim().startsWith("{"))
  const parsed = jsonLine
    ? (JSON.parse(jsonLine) as BoundedResult["parsed"])
    : { ok: false, name: "NONE", message: "no JSON result from bounded worker" }
  return { timedOut, parsed }
}

// ---------------------------------------------------------------------------
// Refusals — decided before any byte of the cache is read
// ---------------------------------------------------------------------------
describe("RefCache read boundary: unsafe origins are refused", () => {
  stest("external leaf symlink is refused, marker not consumed, fixture untouched", () => {
    const external = writeExternalCache()
    const externalHash = sha256OfFile(external)
    linkTo(external, cachePath())
    const before = inventory(project)

    let error: unknown = null
    try {
      new RefCache(project)
    } catch (caught) {
      error = caught
    }

    expectSanitizedRefusal(error)
    expect(sha256OfFile(external)).toBe(externalHash)
    expect(inventory(project)).toEqual(before)
  })

  stest("external ancestor symlink (.banca/cache) is refused, fixture untouched", () => {
    const outsideCache = join(base, "outside", "cache")
    mkdirSync(outsideCache, { recursive: true })
    const external = join(outsideCache, "refs.json")
    writeFileSync(external, cacheEntryJson(EXTERNAL_MARKER), "utf-8")
    mkdirSync(join(project, ".banca"), { recursive: true })
    linkTo(outsideCache, join(project, ".banca", "cache"))
    const externalHash = sha256OfFile(external)

    let error: unknown = null
    try {
      new RefCache(project)
    } catch (caught) {
      error = caught
    }

    expectSanitizedRefusal(error)
    expect(sha256OfFile(external)).toBe(externalHash)
  })

  stest("broken leaf symlink is a controlled refusal", () => {
    brokenLink(cachePath())

    let error: unknown = null
    try {
      new RefCache(project)
    } catch (caught) {
      error = caught
    }

    expectSanitizedRefusal(error)
  })

  stest("broken ancestor symlink is a controlled refusal", () => {
    mkdirSync(join(project, ".banca"), { recursive: true })
    symlinkSync(join(base, "missing-cache-165"), join(project, ".banca", "cache"))

    let error: unknown = null
    try {
      new RefCache(project)
    } catch (caught) {
      error = caught
    }

    expectSanitizedRefusal(error)
  })

  test("directory destination is refused and never opened", () => {
    mkdirSync(cachePath(), { recursive: true })
    const before = inventory(project)

    let error: unknown = null
    try {
      new RefCache(project)
    } catch (caught) {
      error = caught
    }

    expectSanitizedRefusal(error)
    expect(inventory(project)).toEqual(before)
  })

  fifoTest("FIFO destination is refused without a blocking read", () => {
    mkdirSync(dirname(cachePath()), { recursive: true })
    expect(spawnSync("mkfifo", [cachePath()]).status).toBe(0)

    const run = boundedCache(base, "read", project)

    expect(run.timedOut).toBe(false)
    expect(run.parsed.ok).toBe(false)
    expect(run.parsed.name).toBe("PathTraversalError")
    expect(run.parsed.message).toMatch(/^reference cache refused: /)
    expect(run.parsed.message).not.toContain(base)
  })

  readPermissionTest("unreadable internal cache is a read refusal, not an empty cache", () => {
    seedInternalCache()
    chmodSync(cachePath(), 0o000)
    try {
      let error: unknown = null
      try {
        new RefCache(project)
      } catch (caught) {
        error = caught
      }

      expectSanitizedRefusal(error)
      expect((error as Error).message).toContain("could not be read")
    } finally {
      chmodSync(cachePath(), 0o600)
    }
  })
})

// ---------------------------------------------------------------------------
// Legitimate absence and preserved positive behavior
// ---------------------------------------------------------------------------
describe("RefCache read boundary: legitimate states are preserved", () => {
  test("truly missing cache keeps the historical empty-cache behavior", () => {
    const cache = new RefCache(project)

    expect(cache.get(FIXED_REF)).toBeNull()
    expect(cache.summary()).toEqual({ total: 0, verified: 0, pending: 0 })
    expect(existsSync(cachePath())).toBe(false)
  })

  test("regular internal cache preserves key and DOI matching", () => {
    seedInternalCache()

    const cache = new RefCache(project)
    const byKey = cache.get({ key: CACHE_KEY })
    const byDoi = cache.get({ key: "outra-chave", doi: CACHE_DOI.toUpperCase() })

    expect(byKey?.evidence).toBe(INTERNAL_MARKER)
    expect(byDoi?.evidence).toBe(INTERNAL_MARKER)
    expect(cache.get({ key: "nao-existe", doi: "10.9999/outro" })).toBeNull()
    expect(cache.summary().total).toBe(1)
    expect(cache.summary().verified).toBe(1)
  })

  test("invalid JSON in an authorized internal cache stays an empty cache", () => {
    seedInternalCache("{ this is not json ")

    const cache = new RefCache(project)

    expect(cache.get(FIXED_REF)).toBeNull()
    expect(cache.summary().total).toBe(0)
  })

  stest("internal leaf symlink to an internal regular file is accepted", () => {
    const real = join(project, ".banca", "cache", "refs-real.json")
    mkdirSync(dirname(real), { recursive: true })
    writeFileSync(real, cacheEntryJson(INTERNAL_MARKER), "utf-8")
    linkTo(real, cachePath())

    const cache = new RefCache(project)

    expect(cache.get(FIXED_REF)?.evidence).toBe(INTERNAL_MARKER)
  })

  stest("internal ancestor symlink inside the workspace is accepted", () => {
    const realCacheDir = join(project, ".banca", "cache-real")
    mkdirSync(realCacheDir, { recursive: true })
    writeFileSync(join(realCacheDir, "refs.json"), cacheEntryJson(INTERNAL_MARKER), "utf-8")
    mkdirSync(join(project, ".banca"), { recursive: true })
    linkTo(realCacheDir, join(project, ".banca", "cache"))

    const cache = new RefCache(project)

    expect(cache.get(FIXED_REF)?.evidence).toBe(INTERNAL_MARKER)
  })

  test("relative and ./ project roots are normalized once (no nested duplication)", () => {
    for (const rootArg of ["workspace", "./workspace"]) {
      rmSync(join(project, ".banca"), { recursive: true, force: true })
      const run = boundedCache(base, "set", rootArg)

      expect(run.timedOut).toBe(false)
      expect(run.parsed.ok).toBe(true)
      expect(run.parsed.hit?.evidence).toBe("bounded worker synthetic entry")
      // Saved to the workspace cache, not to a duplicated nested root.
      expect(existsSync(cachePath())).toBe(true)
      expect(existsSync(join(project, "workspace"))).toBe(false)
    }
  })

  test("protected set()/save round-trip is preserved", () => {
    const cache = new RefCache(project)
    cache.set(CACHE_KEY, CACHE_DOI, FIXED_RESULT(INTERNAL_MARKER))

    // Saved as a regular internal file (never through an external symlink).
    expect(lstatSync(cachePath()).isFile()).toBe(true)
    expect(lstatSync(cachePath()).isSymbolicLink()).toBe(false)
    const stored = JSON.parse(readFileSync(cachePath(), "utf-8"))
    expect(stored).toHaveLength(1)
    expect(stored[0].key).toBe(CACHE_KEY)

    // A fresh instance reads the saved entry back.
    const reloaded = new RefCache(project)
    expect(reloaded.get(FIXED_REF)?.evidence).toBe(INTERNAL_MARKER)
  })
})

// ---------------------------------------------------------------------------
// Tool flow — banca_refs distinguishes refusal from empty cache
// ---------------------------------------------------------------------------
describe("banca_refs tool flow: reference cache origin is enforced", () => {
  test("legitimate internal cache validates by key/DOI without external transport", async () => {
    writeBib()
    seedInternalCache()

    const text = await runRefs()

    expect(text).not.toContain("blocked:")
    expect(text).toContain("Verified: 1")
    expect(text).toContain("cache=1")
    expect(text).toContain("Evaluated: 1/1")
    expect(reports()).toHaveLength(1)
    expect(readFileSync(join(project, ".banca", "reports", reports()[0]), "utf-8")).toContain(INTERNAL_MARKER)
  })

  stest("external cache symlink is a sanitized refusal with no report or false validation", async () => {
    writeBib()
    const external = writeExternalCache()
    const externalHash = sha256OfFile(external)
    linkTo(external, cachePath())

    const text = await runRefs()

    expectToolRefusal(text)
    expect(sha256OfFile(external)).toBe(externalHash)
  })

  test("truly missing cache keeps the historical external-provider-blocked behavior", async () => {
    writeBib()

    const text = await runRefs()

    expect(text.startsWith("blocked: external reference provider is not available in DSH")).toBe(true)
    expect(text).toContain("only local cache was checked")
    expect(text).not.toContain("Verified: 1")
    expect(text).not.toContain("cache=1")
  })
})
