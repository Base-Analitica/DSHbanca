/**
 * Issue #141 — the secure state-origin contract (#136) must be evaluated
 * BEFORE the first snapshot-vault creation in both consumers.
 *
 * `banca_snapshot` resolved `.banca/state.json` canonically and then called
 * `ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))` before the
 * secure reader (`loadState`, #136) ran inside `createSnapshot` →
 * `labelConflictReason`. `banca_corrigir` did the same in its Phase 2. When the
 * state origin is a DIRECTORY, a present-but-unreadable regular file, a FIFO or
 * a socket, both tools refused — but only after creating an empty
 * `.banca/snapshots` vault, and with misleading diagnostics (snapshot:
 * "snapshot path escapes project root"; correction: "pre-correction snapshot
 * failed").
 *
 * Required contract:
 * - reuse the existing `loadState` secure reader in the preflight; never copy
 *   it or add a second authorization implementation;
 * - refuse BEFORE the first mkdir of the vault: no `.banca/snapshots`, no
 *   individual snapshot dir, no manifest, no registration/iteration, no
 *   manuscript/config/external change;
 * - distinct controlled diagnostics for a state-origin refusal vs an unsafe
 *   vault destination, a label conflict or an operational capture failure;
 * - preserve legitimate absence, valid regular state, internal links, the
 *   historical malformed-JSON-empty-state behavior (no new schema validation)
 *   and all later checks (the effective state read during creation/registration
 *   is never replaced);
 * - preserve both public contracts (#30/#110/#146): real snapshots, mandatory
 *   partial pre-correction backup, real restore, label exclusivity.
 *
 * All scenarios use the REAL tools, a real filesystem and synthetic projects
 * only. FIFO/socket cases are bounded subprocesses; a timeout is never accepted
 * as proof of refusal. Relative roots use explicit child cwd (never the shared
 * process cwd).
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
import { dirname, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { bancaSnapshot } from "../src/tools/banca_snapshot"
import { bancaCorrigir } from "../src/tools/banca_corrigir"
import { bancaRestore } from "../src/tools/banca_restore"
import { PathTraversalError } from "../src/lib/safe_paths"
import { loadState } from "../src/lib/state"

const ORIGINAL_MAIN = "ORIGINAL SYNTHETIC 141\n"
const BIB = "@book{sintetica2026, title={Sintética}}\n"
const EXTERNAL_SECRET = "ESTADO_EXTERNO_141_NAO_DEVE_VAZAR"

const PROJECT_CONFIG = (): string =>
  JSON.stringify({
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "referencias.bib",
      chapters: [],
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
  })

// ---------------------------------------------------------------------------
// Environment capability probes
// ---------------------------------------------------------------------------

const mkfifoSupported = (() => {
  if (process.platform === "win32") return false
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-141-fifo-probe-"))
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

/** chmod 000 only denies reads for a non-privileged process. */
const unreadableTest = unreadableSupported ? test : test.skip

const socketSupported = (() => {
  if (process.platform === "win32") return false
  const probeDir = mkdtempSync(join(tmpdir(), "dshbanca-141-socket-probe-"))
  const probeSocket = join(probeDir, "probe.sock")
  const probeScript = join(probeDir, "probe.mjs")
  writeFileSync(
    probeScript,
    [
      'import { createServer } from "node:net"',
      "const server = createServer()",
      "server.listen(process.argv[2], () => server.close(() => process.exit(0)))",
      "setTimeout(() => process.exit(1), 3000)",
      "",
    ].join("\n"),
    "utf-8",
  )
  try {
    return (
      spawnSync(process.execPath, [probeScript, probeSocket], {
        timeout: 10_000,
        encoding: "utf-8",
      }).status === 0
    )
  } catch {
    return false
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
})()

const socketTest = socketSupported ? test : test.skip

// ---------------------------------------------------------------------------
// Fixtures and inspection helpers
// ---------------------------------------------------------------------------

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function setupProject(root: string, mainContent = ORIGINAL_MAIN): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(join(root, ".banca", "project.json"), PROJECT_CONFIG(), "utf-8")
  writeFileSync(join(root, "main.tex"), mainContent, "utf-8")
  writeFileSync(join(root, "referencias.bib"), BIB, "utf-8")
}

/** Complete recursive inventory: path -> kind/link target/file SHA-256. */
function treeSnapshot(rootDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(rootDir)) return out
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const abs = join(dir, entry.name)
      const rel = relative(rootDir, abs).split(sep).join("/")
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) out[rel] = `symlink:${readlinkSync(abs)}`
      else if (st.isDirectory()) {
        out[rel] = "dir"
        visit(abs)
      } else if (st.isFile()) out[rel] = `file:${sha256(readFileSync(abs))}`
      else out[rel] = "special"
    }
  }
  visit(rootDir)
  return out
}

function vaultEntries(root: string): string[] | null {
  const dir = join(root, ".banca", "snapshots")
  if (!existsSync(dir)) return null
  return readdirSync(dir).sort()
}

function stateBytes(root: string): Buffer | null {
  const p = join(root, ".banca", "state.json")
  try {
    const st = lstatSync(p)
    if (!st.isFile()) return null
    return readFileSync(p)
  } catch {
    return null
  }
}

/** Keys of a persisted state document (not a structural validator). */
function stateLabels(root: string): string[] {
  const bytes = stateBytes(root)
  if (bytes === null) return []
  try {
    const parsed = JSON.parse(bytes.toString("utf-8"))
    return Array.isArray(parsed?.snapshots)
      ? parsed.snapshots.map((s: any) => String(s.label))
      : []
  } catch {
    return []
  }
}

function manuscriptHash(root: string): string {
  return sha256(readFileSync(join(root, "main.tex")))
}

function configHash(root: string): string {
  return sha256(readFileSync(join(root, ".banca", "project.json")))
}

/** Redirect the state origin to an unsafe kind, keeping the fixture simple. */
type UnsafeStateKind = "dir" | "external-link" | "broken-link"

function plantUnsafeState(root: string, kind: UnsafeStateKind, base: string): string {
  const statePath = join(root, ".banca", "state.json")
  rmSync(statePath, { recursive: true, force: true })
  if (kind === "dir") {
    mkdirSync(statePath, { recursive: true })
    writeFileSync(join(statePath, "inside.txt"), "state directory content\n")
    return statePath
  }
  const target =
    kind === "external-link"
      ? join(base, "external-state.json")
      : join(root, ".banca", "missing-state.json")
  if (kind === "external-link") {
    writeFileSync(target, JSON.stringify({ external: EXTERNAL_SECRET }), "utf-8")
  }
  symlinkSync(target, statePath, "file")
  return statePath
}

// ---------------------------------------------------------------------------
// Real tool invocation helpers
// ---------------------------------------------------------------------------

async function runSnapshot(
  projectRoot: string,
  label = "s141",
): Promise<{ output?: string; error?: Error }> {
  try {
    return {
      output: String(
        await bancaSnapshot.execute(
          { projectRoot, label },
          { directory: projectRoot } as any,
        ),
      ),
    }
  } catch (error) {
    return { error: error as Error }
  }
}

async function runCorrection(
  projectRoot: string,
): Promise<{ output?: string; error?: Error }> {
  try {
    return {
      output: String(
        await bancaCorrigir.execute(
          {
            projectRoot,
            corrections: [
              {
                file: "main.tex",
                oldText: "ORIGINAL",
                newText: "ALTERADO",
                expectedOccurrences: 1,
              },
            ],
          },
          { directory: projectRoot } as any,
        ),
      ),
    }
  } catch (error) {
    return { error: error as Error }
  }
}

/** Controlled state-origin refusal: names the state origin, no path leakage. */
function expectStateOriginRefusal(
  result: { output?: string; error?: Error },
  detailFragment?: string,
): string {
  expect(result.error).toBeUndefined()
  const output = String(result.output)
  expect(output).toMatch(/^blocked: project state origin refused — /)
  // The diagnosis names the state origin and does not misreport an escaping
  // path or a generic capture failure.
  expect(output).not.toContain("escapes project root")
  expect(output).not.toContain("capture failed")
  expect(output).not.toContain("pre-correction snapshot failed")
  if (detailFragment !== undefined) expect(output).toContain(detailFragment)
  expect(output).not.toMatch(/(^|[\s"'`=:,])(\/tmp\/|\/home\/|\/var\/|\/Users\/)/)
  for (const fragment of [
    EXTERNAL_SECRET,
    "EACCES",
    "ENOENT",
    "ENOTDIR",
    "EISDIR",
    "permission denied",
    "no such file",
    "open '",
  ]) {
    expect(output).not.toContain(fragment)
  }
  return output
}

/**
 * Refusal must leave no vault artifact and no snapshot/iteration registration,
 * and must not touch the manuscript or the configuration.
 */
function expectNoVaultAndIntactSources(options: {
  root: string
  manuscriptBefore: string
  configBefore: string
  stateSnapshotBefore: string
  label?: string
}): void {
  const { root, manuscriptBefore, configBefore, stateSnapshotBefore } = options
  expect(vaultEntries(root)).toBeNull()
  expect(stateLabels(root)).toEqual([])
  expect(manuscriptHash(root)).toBe(manuscriptBefore)
  expect(configHash(root)).toBe(configBefore)
  // State origin (directory/symlink) still has the same shape and content.
  expect(treeSnapshot(join(root, ".banca"))).toEqual(stateSnapshotBefore)
}

// ---------------------------------------------------------------------------
// Bounded child runner for FIFO/socket and relative-root cases
// ---------------------------------------------------------------------------

type ChildRun = {
  status: number | null
  signal: NodeJS.Signals | null
  error?: Error
  timedOut: boolean
  parsed?: {
    ok: boolean
    output?: string
    name?: string
    message?: string
  }
  stdout: string
}

function runToolInChild(options: {
  base: string
  tool: "snapshot" | "corrigir"
  cwd: string
  projectRootArg: string | null
  ctxDirectory: string
  timeoutMs?: number
}): ChildRun {
  const toolUrl = pathToFileURL(
    join(
      import.meta.dir,
      "..",
      "src",
      "tools",
      options.tool === "snapshot" ? "banca_snapshot.ts" : "banca_corrigir.ts",
    ),
  ).href
  const script = join(
    options.base,
    `_state141_${options.tool}_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  )
  writeFileSync(
    script,
    [
      `const mod = await import(${JSON.stringify(toolUrl)})`,
      "const hasRoot = process.argv[2] !== '__OMIT__'",
      `const toolName = ${JSON.stringify(options.tool)}`,
      "const args = hasRoot ? { projectRoot: process.argv[2] } : {}",
      "if (toolName === 'snapshot') { args.label = 's141' }",
      "else { args.corrections = [{ file: 'main.tex', oldText: 'ORIGINAL', newText: 'ALTERADO', expectedOccurrences: 1 }] }",
      "const ctx = { directory: process.argv[3] }",
      "const tool = toolName === 'snapshot' ? mod.bancaSnapshot : mod.bancaCorrigir",
      "try {",
      "  const output = String(await tool.execute(args, ctx))",
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
      [script, options.projectRootArg ?? "__OMIT__", options.ctxDirectory],
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
    return {
      status: outcome.status,
      signal: outcome.signal,
      error: outcome.error as Error | undefined,
      timedOut: Boolean(
        outcome.error &&
          (outcome.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
      ),
      parsed: jsonLine ? JSON.parse(jsonLine) : undefined,
      stdout,
    }
  } finally {
    rmSync(script, { force: true })
  }
}

function expectChildStateOriginRefusal(run: ChildRun, detailFragment?: string): string {
  expect(run.timedOut).toBe(false)
  expect(run.error).toBeUndefined()
  expect(run.signal).toBeNull()
  expect(run.status).toBe(0)
  expect(run.parsed?.ok).toBe(true)
  const output = String(run.parsed?.output)
  expect(output).toMatch(/^blocked: project state origin refused — /)
  if (detailFragment !== undefined) expect(output).toContain(detailFragment)
  expect(output).not.toContain(EXTERNAL_SECRET)
  expect(output).not.toMatch(/(^|[\s"'`=:,])(\/tmp\/|\/home\/|\/var\/|\/Users\/)/)
  return output
}

// ---------------------------------------------------------------------------
// 8.1/8.2 — state origin matrix with the vault initially absent
// ---------------------------------------------------------------------------

describe("issue #141 — state origin is refused before the vault is created", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-141-origin-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
    setupProject(project)
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  test("banca_snapshot refuses a state.json directory without creating the vault", async () => {
    plantUnsafeState(project, "dir", base)
    const stateBefore = treeSnapshot(join(project, ".banca"))
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)

    const result = await runSnapshot(project)
    expectStateOriginRefusal(result, "not a safe regular file inside the workspace")
    expectNoVaultAndIntactSources({
      root: project,
      manuscriptBefore: mainBefore,
      configBefore,
      stateSnapshotBefore: stateBefore,
    })
    // No individual snapshot directory/manifest anywhere.
    expect(existsSync(join(project, ".banca", "snapshots"))).toBe(false)
  })

  test("banca_corrigir refuses a state.json directory without creating the vault", async () => {
    plantUnsafeState(project, "dir", base)
    const stateBefore = treeSnapshot(join(project, ".banca"))
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)

    const result = await runCorrection(project)
    expectStateOriginRefusal(result, "not a safe regular file inside the workspace")
    expectNoVaultAndIntactSources({
      root: project,
      manuscriptBefore: mainBefore,
      configBefore,
      stateSnapshotBefore: stateBefore,
    })
  })

  unreadableTest("banca_snapshot refuses a present but unreadable state file", async () => {
    const statePath = join(project, ".banca", "state.json")
    writeFileSync(
      statePath,
      JSON.stringify({ currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] }),
      "utf-8",
    )
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)
    const stateBefore = treeSnapshot(join(project, ".banca"))
    chmodSync(statePath, 0o000)
    let result: { output?: string; error?: Error }
    try {
      // Prove the environment really denies the read (non-root, no override).
      let rawCode: string | undefined
      try {
        readFileSync(statePath, "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")
      result = await runSnapshot(project)
    } finally {
      chmodSync(statePath, 0o644)
    }
    expectStateOriginRefusal(result!, "could not be read")
    expectNoVaultAndIntactSources({
      root: project,
      manuscriptBefore: mainBefore,
      configBefore,
      stateSnapshotBefore: stateBefore,
    })
  })

  unreadableTest("banca_corrigir refuses a present but unreadable state file", async () => {
    const statePath = join(project, ".banca", "state.json")
    writeFileSync(
      statePath,
      JSON.stringify({ currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] }),
      "utf-8",
    )
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)
    const stateBefore = treeSnapshot(join(project, ".banca"))
    chmodSync(statePath, 0o000)
    let result: { output?: string; error?: Error }
    try {
      let rawCode: string | undefined
      try {
        readFileSync(statePath, "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")
      result = await runCorrection(project)
    } finally {
      chmodSync(statePath, 0o644)
    }
    expectStateOriginRefusal(result!, "could not be read")
    expectNoVaultAndIntactSources({
      root: project,
      manuscriptBefore: mainBefore,
      configBefore,
      stateSnapshotBefore: stateBefore,
    })
  })

  fifoTest("banca_snapshot refuses a FIFO state origin without blocking or creating the vault", () => {
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)
    const fifoPath = join(project, ".banca", "state.json")
    expect(spawnSync("mkfifo", [fifoPath]).status).toBe(0)

    const run = runToolInChild({
      base,
      tool: "snapshot",
      cwd: base,
      projectRootArg: project,
      ctxDirectory: project,
      timeoutMs: 10_000,
    })
    expectChildStateOriginRefusal(run, "not a safe regular file inside the workspace")
    expect(vaultEntries(project)).toBeNull()
    expect(manuscriptHash(project)).toBe(mainBefore)
    expect(configHash(project)).toBe(configBefore)
    // FIFO itself was never opened/replaced.
    expect(lstatSync(fifoPath).isFIFO()).toBe(true)
  }, 30_000)

  fifoTest("banca_corrigir refuses a FIFO state origin without blocking or creating the vault", () => {
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)
    const fifoPath = join(project, ".banca", "state.json")
    expect(spawnSync("mkfifo", [fifoPath]).status).toBe(0)

    const run = runToolInChild({
      base,
      tool: "corrigir",
      cwd: base,
      projectRootArg: project,
      ctxDirectory: project,
      timeoutMs: 10_000,
    })
    expectChildStateOriginRefusal(run, "not a safe regular file inside the workspace")
    expect(vaultEntries(project)).toBeNull()
    expect(manuscriptHash(project)).toBe(mainBefore)
    expect(configHash(project)).toBe(configBefore)
    expect(lstatSync(fifoPath).isFIFO()).toBe(true)
  }, 30_000)

  socketTest("banca_snapshot refuses a UNIX socket state origin without creating the vault", async () => {
    const statePath = join(project, ".banca", "state.json")
    const server = createServer()
    await new Promise<void>((done, fail) => {
      server.once("error", fail)
      server.listen(statePath, done)
    })
    try {
      const mainBefore = manuscriptHash(project)
      const configBefore = configHash(project)
      const result = await runSnapshot(project)
      expectStateOriginRefusal(result, "not a safe regular file inside the workspace")
      expect(vaultEntries(project)).toBeNull()
      expect(manuscriptHash(project)).toBe(mainBefore)
      expect(configHash(project)).toBe(configBefore)
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  test("banca_snapshot keeps the pre-existing path refusal for external/broken state links and creates no vault", async () => {
    // These origins are still rejected by the pre-existing canonical path
    // check, before any vault creation; the historical message is preserved.
    for (const kind of ["external-link", "broken-link"] as const) {
      const root = join(base, `project-${kind}`)
      mkdirSync(root, { recursive: true })
      setupProject(root)
      plantUnsafeState(root, kind, base)
      const externalTarget = join(base, "external-state.json")
      const externalHashBefore =
        kind === "external-link" ? sha256(readFileSync(externalTarget)) : null
      const mainBefore = manuscriptHash(root)
      const result = await runSnapshot(root)
      expect(result.error).toBeUndefined()
      expect(String(result.output)).toContain("blocked: snapshot path escapes project root")
      expect(String(result.output)).not.toContain(EXTERNAL_SECRET)
      expect(vaultEntries(root)).toBeNull()
      expect(manuscriptHash(root)).toBe(mainBefore)
      // The external target of the preserved path refusal was never opened or
      // modified by the tool.
      if (externalHashBefore !== null) {
        expect(sha256(readFileSync(externalTarget))).toBe(externalHashBefore)
      }
    }
  })

  test("banca_corrigir keeps the pre-existing path refusal for external/broken state links and creates no vault", async () => {
    for (const kind of ["external-link", "broken-link"] as const) {
      const root = join(base, `corrigir-${kind}`)
      mkdirSync(root, { recursive: true })
      setupProject(root)
      plantUnsafeState(root, kind, base)
      const externalTarget = join(base, "external-state.json")
      const externalHashBefore =
        kind === "external-link" ? sha256(readFileSync(externalTarget)) : null
      const mainBefore = manuscriptHash(root)
      const result = await runCorrection(root)
      expect(result.error).toBeUndefined()
      expect(String(result.output)).toContain(
        "blocked: workspace state paths escape project root",
      )
      expect(String(result.output)).not.toContain(EXTERNAL_SECRET)
      expect(vaultEntries(root)).toBeNull()
      expect(manuscriptHash(root)).toBe(mainBefore)
      if (externalHashBefore !== null) {
        expect(sha256(readFileSync(externalTarget))).toBe(externalHashBefore)
      }
    }
  })

  socketTest("banca_corrigir refuses a UNIX socket state origin without creating the vault", async () => {
    const statePath = join(project, ".banca", "state.json")
    const server = createServer()
    await new Promise<void>((done, fail) => {
      server.once("error", fail)
      server.listen(statePath, done)
    })
    try {
      const mainBefore = manuscriptHash(project)
      const configBefore = configHash(project)
      const result = await runCorrection(project)
      expectStateOriginRefusal(result, "not a safe regular file inside the workspace")
      expect(vaultEntries(project)).toBeNull()
      expect(manuscriptHash(project)).toBe(mainBefore)
      expect(configHash(project)).toBe(configBefore)
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  test("an internal symlink at the state file keeps the historical read/write contract for both tools", async () => {
    // The canonical policy allows internal links to regular files; the new
    // preflight must reuse that authorization (not tighten it). The link stays
    // a link and the real target receives the durable registration/iteration.
    const stateReal = join(project, ".banca", "state-real.json")
    writeFileSync(
      stateReal,
      JSON.stringify({
        currentScore: null,
        lastAudit: null,
        lastLoop: null,
        snapshots: [],
        iterations: [],
      }),
      "utf-8",
    )
    symlinkSync(stateReal, join(project, ".banca", "state.json"), "file")

    const snapshotResult = await runSnapshot(project, "internal-link")
    expect(snapshotResult.error).toBeUndefined()
    expect(String(snapshotResult.output)).toContain(
      "Recovery point verified: restorable",
    )
    expect(
      existsSync(join(project, ".banca", "snapshots", "internal-link.manifest.json")),
    ).toBe(true)
    const afterSnapshot = JSON.parse(readFileSync(stateReal, "utf-8"))
    expect(afterSnapshot.snapshots.map((s: any) => s.label)).toContain(
      "internal-link",
    )
    expect(lstatSync(join(project, ".banca", "state.json")).isSymbolicLink()).toBe(
      true,
    )

    const correctionResult = await runCorrection(project)
    expect(correctionResult.error).toBeUndefined()
    expect(String(correctionResult.output)).toContain("✓ main.tex (1 replacement)")
    const afterCorrection = JSON.parse(readFileSync(stateReal, "utf-8"))
    expect(afterCorrection.snapshots.length).toBe(2)
    expect(afterCorrection.iterations.length).toBe(1)
    expect(lstatSync(join(project, ".banca", "state.json")).isSymbolicLink()).toBe(
      true,
    )
    expect(vaultEntries(project)?.some((n) => n.startsWith("pre-"))).toBe(true)
  })

  test("legitimate absence and a valid regular state keep both operations working", async () => {
    // Absent state: real restorable snapshot + registered label.
    const absentResult = await runSnapshot(project, "absent-ok")
    expect(absentResult.error).toBeUndefined()
    expect(String(absentResult.output)).toContain("Recovery point verified: restorable")
    expect(existsSync(join(project, ".banca", "snapshots", "absent-ok"))).toBe(true)
    expect(existsSync(join(project, ".banca", "snapshots", "absent-ok.manifest.json"))).toBe(true)
    expect(stateLabels(project)).toEqual(["absent-ok"])

    // Valid regular state: correction creates the mandatory partial backup and
    // applies the authorized bytes; the previous bytes are restorable.
    const correction = await runCorrection(project)
    expect(correction.error).toBeUndefined()
    const text = String(correction.output)
    expect(text).toContain("✓ main.tex (1 replacement)")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(
      "ALTERADO SYNTHETIC 141\n",
    )
    const labels = stateLabels(project)
    expect(labels.length).toBe(2)
    const backupLabel = labels.find((l) => l.startsWith("pre-"))
    expect(backupLabel).toBeDefined()
    expect(existsSync(join(project, ".banca", "snapshots", backupLabel!))).toBe(true)

    // Real restore of the mandatory backup recovers the original bytes.
    const restore = String(
      await bancaRestore.execute(
        { projectRoot: project, snapshotId: backupLabel!, confirm: true },
        { directory: project } as any,
      ),
    )
    expect(restore).toContain(`restored from ${backupLabel}`)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(ORIGINAL_MAIN)
  })

  test("malformed internal JSON keeps the historical empty-state contract (no new schema validation)", async () => {
    writeFileSync(join(project, ".banca", "state.json"), "{not-json", "utf-8")
    const snapshotResult = await runSnapshot(project, "malformed-ok")
    expect(snapshotResult.error).toBeUndefined()
    expect(String(snapshotResult.output)).toContain("Recovery point verified: restorable")
    // The historical contract still treats the malformed authorized state as an
    // empty registry and the real registration rewrites a valid document.
    expect(stateLabels(project)).toEqual(["malformed-ok"])
    const parsed = JSON.parse(
      readFileSync(join(project, ".banca", "state.json"), "utf-8"),
    )
    expect(parsed.snapshots).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 8.3 — preexisting vault must stay byte-identical
// ---------------------------------------------------------------------------

describe("issue #141 — a preexisting vault is untouched by a state refusal", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-141-vault-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
    setupProject(project)
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  async function prepareRealSnapshot(): Promise<string> {
    const created = await runSnapshot(project, "keep-me")
    expect(created.error).toBeUndefined()
    expect(String(created.output)).toContain("Recovery point verified: restorable")
    const labels = stateLabels(project)
    expect(labels).toContain("keep-me")
    return "keep-me"
  }

  test("snapshot refusal leaves a real preexisting snapshot/vault byte-identical", async () => {
    const keepLabel = await prepareRealSnapshot()
    const vaultBefore = treeSnapshot(join(project, ".banca", "snapshots"))
    const stateOriginPath = plantUnsafeState(project, "dir", base)
    const bancaBefore = treeSnapshot(join(project, ".banca"))
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)

    const result = await runSnapshot(project, "second")
    expectStateOriginRefusal(result, "not a safe regular file inside the workspace")

    // No new directory/manifest/marker and no truncation/removal.
    expect(treeSnapshot(join(project, ".banca", "snapshots"))).toEqual(vaultBefore)
    expect(treeSnapshot(join(project, ".banca"))).toEqual(bancaBefore)
    expect(existsSync(join(project, ".banca", "snapshots", keepLabel))).toBe(true)
    expect(
      existsSync(join(project, ".banca", "snapshots", `${keepLabel}.manifest.json`)),
    ).toBe(true)
    expect(manuscriptHash(project)).toBe(mainBefore)
    expect(configHash(project)).toBe(configBefore)
    expect(lstatSync(stateOriginPath).isDirectory()).toBe(true)
  })

  test("correction refusal leaves a real preexisting snapshot/vault byte-identical", async () => {
    const keepLabel = await prepareRealSnapshot()
    const vaultBefore = treeSnapshot(join(project, ".banca", "snapshots"))
    plantUnsafeState(project, "dir", base)
    const bancaBefore = treeSnapshot(join(project, ".banca"))
    const mainBefore = manuscriptHash(project)
    const configBefore = configHash(project)

    const result = await runCorrection(project)
    expectStateOriginRefusal(result, "not a safe regular file inside the workspace")

    expect(treeSnapshot(join(project, ".banca", "snapshots"))).toEqual(vaultBefore)
    expect(treeSnapshot(join(project, ".banca"))).toEqual(bancaBefore)
    expect(existsSync(join(project, ".banca", "snapshots", keepLabel))).toBe(true)
    expect(manuscriptHash(project)).toBe(mainBefore)
    expect(configHash(project)).toBe(configBefore)
  })
})

// ---------------------------------------------------------------------------
// 8.4 — root representations (issue #146 preserved)
// ---------------------------------------------------------------------------

describe("issue #141 — relative root representations also refuse before the vault", () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-141-roots-"))
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  const cases: Array<{
    name: string
    trueRoot: (base: string) => string
    projectRootArg: string | null
    ctxDirectory: (trueRoot: string) => string
  }> = [
    {
      name: "relative 'project'",
      trueRoot: (b) => join(b, "project"),
      projectRootArg: "project",
      ctxDirectory: () => "project",
    },
    {
      name: "'./project'",
      trueRoot: (b) => join(b, "project"),
      projectRootArg: "./project",
      ctxDirectory: () => "./project",
    },
    {
      name: "nested 'parent/project'",
      trueRoot: (b) => join(b, "parent", "project"),
      projectRootArg: "parent/project",
      ctxDirectory: () => "parent/project",
    },
    {
      name: "relative ctx.directory fallback",
      trueRoot: (b) => join(b, "project"),
      projectRootArg: null,
      ctxDirectory: () => "project",
    },
  ]

  for (const testCase of cases) {
    test(`snapshot: ${testCase.name} refuses state directory and creates no vault`, () => {
      const trueRoot = testCase.trueRoot(base)
      mkdirSync(trueRoot, { recursive: true })
      setupProject(trueRoot)
      plantUnsafeState(trueRoot, "dir", base)
      const mainBefore = manuscriptHash(trueRoot)
      const configBefore = configHash(trueRoot)

      const run = runToolInChild({
        base,
        tool: "snapshot",
        cwd: base,
        projectRootArg: testCase.projectRootArg,
        ctxDirectory: testCase.ctxDirectory(trueRoot),
        timeoutMs: 30_000,
      })
      expectChildStateOriginRefusal(run, "not a safe regular file inside the workspace")
      expect(vaultEntries(trueRoot)).toBeNull()
      expect(manuscriptHash(trueRoot)).toBe(mainBefore)
      expect(configHash(trueRoot)).toBe(configBefore)
    }, 60_000)

    test(`correction: ${testCase.name} refuses state directory and creates no vault`, () => {
      const trueRoot = testCase.trueRoot(base)
      mkdirSync(trueRoot, { recursive: true })
      setupProject(trueRoot)
      plantUnsafeState(trueRoot, "dir", base)
      const mainBefore = manuscriptHash(trueRoot)
      const configBefore = configHash(trueRoot)

      const run = runToolInChild({
        base,
        tool: "corrigir",
        cwd: base,
        projectRootArg: testCase.projectRootArg,
        ctxDirectory: testCase.ctxDirectory(trueRoot),
        timeoutMs: 30_000,
      })
      expectChildStateOriginRefusal(run, "not a safe regular file inside the workspace")
      expect(vaultEntries(trueRoot)).toBeNull()
      expect(manuscriptHash(trueRoot)).toBe(mainBefore)
      expect(configHash(trueRoot)).toBe(configBefore)
    }, 60_000)
  }

  test("absolute root control: state directory refusal creates no vault", async () => {
    const trueRoot = join(base, "project")
    mkdirSync(trueRoot, { recursive: true })
    setupProject(trueRoot)
    plantUnsafeState(trueRoot, "dir", base)
    const result = await runSnapshot(trueRoot)
    expectStateOriginRefusal(result, "not a safe regular file inside the workspace")
    expect(vaultEntries(trueRoot)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Distinct refusal categories and positive invariants
// ---------------------------------------------------------------------------

describe("issue #141 — refusal categories stay distinct and the public contracts hold", () => {
  let base: string
  let project: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "dshbanca-141-categories-"))
    project = join(base, "project")
    mkdirSync(project, { recursive: true })
    setupProject(project)
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  test("an unsafe vault destination keeps its own refusal, distinct from the state refusal", async () => {
    const externalVault = join(base, "external-vault")
    mkdirSync(externalVault, { recursive: true })
    symlinkSync(externalVault, join(project, ".banca", "snapshots"), "dir")
    const externalBefore = treeSnapshot(externalVault)
    const mainBefore = manuscriptHash(project)

    const snapshotResult = await runSnapshot(project)
    expect(snapshotResult.error).toBeUndefined()
    const snapshotOutput = String(snapshotResult.output)
    expect(snapshotOutput).toContain("blocked: snapshot path escapes project root")
    expect(snapshotOutput).not.toContain("project state origin refused")
    expect(treeSnapshot(externalVault)).toEqual(externalBefore)
    expect(manuscriptHash(project)).toBe(mainBefore)

    const correctionResult = await runCorrection(project)
    expect(correctionResult.error).toBeUndefined()
    const correctionOutput = String(correctionResult.output)
    expect(correctionOutput).toContain(
      "blocked: workspace state paths escape project root",
    )
    expect(correctionOutput).not.toContain("project state origin refused")
    expect(treeSnapshot(externalVault)).toEqual(externalBefore)
    expect(manuscriptHash(project)).toBe(mainBefore)
  })

  test("an invalid correction is refused before any snapshot effect", async () => {
    const mainBefore = manuscriptHash(project)
    const stateBefore = treeSnapshot(join(project, ".banca"))
    const result = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [
            { file: "main.tex", oldText: "NOT-PRESENT", newText: "X", expectedOccurrences: 1 },
          ],
        },
        { directory: project } as any,
      ),
    )
    expect(result).toMatch(/^blocked:/)
    expect(result).toContain("oldText not found")
    expect(vaultEntries(project)).toBeNull()
    expect(treeSnapshot(join(project, ".banca"))).toEqual(stateBefore)
    expect(manuscriptHash(project)).toBe(mainBefore)
  })

  test("label conflict is refused without overwriting the existing snapshot", async () => {
    const first = await runSnapshot(project, "dup")
    expect(first.error).toBeUndefined()
    const vaultBefore = treeSnapshot(join(project, ".banca", "snapshots"))
    const second = await runSnapshot(project, "dup")
    expect(second.error).toBeUndefined()
    expect(String(second.output)).toContain(`blocked: snapshot label "dup" is not available`)
    expect(treeSnapshot(join(project, ".banca", "snapshots"))).toEqual(vaultBefore)
    expect(existsSync(join(project, ".banca", "snapshots", "dup"))).toBe(true)
  })

  test("the tools reuse the #136 loadState contract (PathTraversalError with sanitized category)", async () => {
    plantUnsafeState(project, "dir", base)
    let error: Error | undefined
    try {
      loadState(project)
    } catch (caught) {
      error = caught as Error
    }
    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String(error?.message)).toContain("state refused")
    expect(String(error?.message)).toContain(
      "not a safe regular file inside the workspace",
    )
    expect(String(error?.message)).not.toContain(resolve(project))

    // The tool surfaces the same controlled category, not a raw exception.
    const result = await runSnapshot(project, "contract")
    expectStateOriginRefusal(result, "not a safe regular file inside the workspace")
  })
})
