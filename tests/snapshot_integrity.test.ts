/**
 * Snapshot collision & immutability — round-3 integrity suite (P1-A / P1-B).
 *
 * P1-A (restore destination collisions): two distinct logical destinations can
 * resolve to the same physical file (e.g. `main.tex -> capitulos/cap1.tex`).
 * The vulnerable implementation validated each destination in isolation and
 * verified each write in isolation, so sequential writes left one logical path
 * with the wrong content while the restore still reported
 * `restored from <label>`. This suite proves the restore now:
 *   - refuses colliding destinations before any write (fail-closed, even for
 *     identical contents, never order-dependent),
 *   - refuses destinations resolving into protected namespaces
 *     (`.banca/`, `.env`, ...),
 *   - revalidates the plan right before the substitutions,
 *   - verifies the complete final inventory (never a false success).
 *
 * P1-B (snapshot label immutability): `banca_snapshot` could reuse an existing
 * label — the snapshot directory was accepted when it already existed, capture
 * truncated the stored files and manifest with writeFileSync, and state.json
 * appended a duplicate record. This suite proves labels are refused before any
 * modification (registered labels, unregistered dirs, orphan manifests, legacy
 * snapshots, symlinks) and that internal producers (pre-correction snapshot,
 * pre-restore backup, loop marker) get collision-free unique labels without
 * ever overwriting an existing snapshot.
 *
 * Every scenario uses synthetic temporary projects and the real tools. The two
 * mid-flight races (collision after planning, corruption after a write) use a
 * real external watcher process performing real filesystem mutations — no
 * module mocking and no string-only assertions.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0
/** chmod-based fault injection is skipped when running as root. */
const nonRootTest = IS_ROOT ? test.skip : test

const symlinksSupported = (() => {
  try {
    const probe = join(tmpdir(), `dshbanca-integrity-link-probe-${process.pid}-${Date.now()}`)
    symlinkSync(tmpdir(), probe)
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
})()
const stest = symlinksSupported ? test : test.skip

let base: string
let project: string
let external: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-integrity-"))
  project = join(base, "project")
  external = join(base, "external")
  mkdirSync(project, { recursive: true })
  mkdirSync(external, { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

// ---------------------------------------------------------------- helpers

function write(root: string, rel: string, content: string): string {
  const abs = join(root, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  return abs
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split("\\").join("/")
      const st = lstatSync(abs)
      if (st.isSymbolicLink()) out[rel] = "symlink"
      else if (st.isDirectory()) {
        out[rel] = "dir"
        walk(abs)
      } else {
        out[rel] = readFileSync(abs, "utf8")
      }
    }
  }
  walk(root)
  return out
}

function snapshotsRoot(root: string): string {
  return join(root, ".banca", "snapshots")
}

function snapDirOf(root: string, label: string): string {
  return join(snapshotsRoot(root), label)
}

function manifestPathOf(root: string, label: string): string {
  return join(snapshotsRoot(root), `${label}.manifest.json`)
}

function stateFile(root: string): string {
  return join(root, ".banca", "state.json")
}

function readState(root: string): {
  snapshots: Array<{ id: string; label: string }>
} {
  const p = stateFile(root)
  if (!existsSync(p)) return { snapshots: [] }
  return JSON.parse(readFileSync(p, "utf8"))
}

function stateLabels(root: string): string[] {
  return readState(root).snapshots.map((s) => s.label)
}

function stateIds(root: string): string[] {
  return readState(root).snapshots.map((s) => s.id)
}

async function withFrozenNow<T>(now: number, fn: () => Promise<T>): Promise<T> {
  const original = Date.now
  Date.now = () => now
  try {
    return await fn()
  } finally {
    Date.now = original
  }
}

const pad3 = (n: number): string => String(n).padStart(3, "0")

/**
 * External watcher process: performs a real filesystem mutation while the
 * restore is mid-flight. `ready` handshake proves the watcher is alive before
 * the tool runs; exit code 0 proves the mutation actually fired.
 */
const WATCHER_SOURCE = `import { readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [project, mode, readyFile, watchRel, expected, corruptRel] = process.argv.slice(2)
const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1)
const deadline = Date.now() + 30000

writeFileSync(readyFile, "ready")

if (mode === "swap-destination") {
  const snapshots = join(project, ".banca", "snapshots")
  for (;;) {
    let staged = false
    try {
      staged = readdirSync(snapshots).some((name) => name.indexOf(".restore-staging-") === 0)
    } catch {}
    if (staged) break
    if (Date.now() > deadline) process.exit(3)
    wait()
  }
  const target = join(project, "capitulos", "cap1.tex")
  rmSync(target, { force: true })
  symlinkSync("../main.tex", target)
  process.exit(0)
}

if (mode === "corrupt-after-write") {
  const watched = join(project, watchRel)
  for (;;) {
    let content = null
    try {
      content = readFileSync(watched, "utf8")
    } catch {}
    if (content === expected) break
    if (Date.now() > deadline) process.exit(4)
    wait()
  }
  writeFileSync(join(project, corruptRel), "TAMPERED-DURING-RESTORE")
  process.exit(0)
}

process.exit(2)
`

interface WatcherHandle {
  readyFile: string
  exit: Promise<number | null>
}

function startWatcher(opts: {
  mode: "swap-destination" | "corrupt-after-write"
  watchRel?: string
  expected?: string
  corruptRel?: string
}): WatcherHandle {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const scriptPath = join(base, `watcher-${suffix}.mjs`)
  const readyFile = join(base, `watcher-ready-${suffix}.txt`)
  writeFileSync(scriptPath, WATCHER_SOURCE)
  const child = spawn(
    process.execPath,
    [
      scriptPath,
      project,
      opts.mode,
      readyFile,
      opts.watchRel ?? "",
      opts.expected ?? "",
      opts.corruptRel ?? "",
    ],
    { stdio: "ignore" },
  )
  const exit = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code))
    child.on("close", (code) => resolve(code))
    child.on("error", () => resolve(-1))
  })
  return { readyFile, exit }
}

async function waitForFile(path: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error("watcher did not become ready in time")
    await delay(2)
  }
}

// ------------------------------------------- P1-A: destination collisions

describe("restore destination identity (P1-A)", () => {
  stest("colliding destinations with different snapshot contents block the restore before any change", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "VERSAO-MAIN")
    write(project, "capitulos/cap1.tex", "VERSAO-CAPITULO")
    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)
    expect(String(snap)).toContain("snapshot →")

    // Project reorganized: main.tex now resolves to the chapter file.
    rmSync(join(project, "main.tex"))
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))
    write(project, "capitulos/cap1.tex", "MODIFICADO")
    write(external, "untouched.txt", "EXTERNAL")
    const projectBefore = snapshotTree(project)
    const externalBefore = snapshotTree(external)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s1", confirm: true },
      {} as any,
    )
    const text = String(result)

    // no false success and no silent winner: nothing changed at all
    expect(text).not.toContain("restored from")
    expect(text).toContain("blocked")
    expect(text).toMatch(/collide/)
    expect(snapshotTree(project)).toEqual(projectBefore)
    expect(snapshotTree(external)).toEqual(externalBefore)
  })

  stest("a collision with identical contents is still refused deterministically (fail-closed)", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "DUPSAME")
    write(project, "capitulos/cap1.tex", "DUPSAME")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-dup" }, {} as any)

    rmSync(join(project, "main.tex"))
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))
    const projectBefore = snapshotTree(project)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-dup", confirm: true },
      {} as any,
    )
    const text = String(result)

    // explicit, deterministic policy: the identity collision is refused even
    // when both snapshot entries carry the same bytes
    expect(text).not.toContain("restored from")
    expect(text).toContain("blocked")
    expect(text).toMatch(/collide/)
    expect(snapshotTree(project)).toEqual(projectBefore)
  })

  test("independent destinations restore normally", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "FREE-MAIN")
    write(project, "capitulos/cap1.tex", "FREE-CAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-free" }, {} as any)
    write(project, "main.tex", "CHANGED-MAIN")
    write(project, "capitulos/cap1.tex", "CHANGED-CAP")

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-free", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("restored from s-free")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("FREE-MAIN")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("FREE-CAP")
  })

  stest("an internal symlink without collision is restored through the link", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "texto/main.tex", "LINK-V1")
    symlinkSync("texto/main.tex", join(project, "main.tex"))
    write(project, "capitulos/cap1.tex", "LINK-C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-link" }, {} as any)

    write(project, "texto/main.tex", "LINK-V2")
    write(project, "capitulos/cap1.tex", "LINK-C2")

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-link", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("restored from s-link")
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(project, "main.tex"))).toBe("texto/main.tex")
    expect(readFileSync(join(project, "texto", "main.tex"), "utf8")).toBe("LINK-V1")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("LINK-C1")
  })

  stest("an external symlink destination is denied and the external file is untouched", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "EXT-SNAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-ext" }, {} as any)
    write(external, "target.tex", "EXTERNAL-KEEP")
    rmSync(join(project, "main.tex"))
    symlinkSync(join(external, "target.tex"), join(project, "main.tex"))
    const externalBefore = snapshotTree(external)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-ext", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(String(result)).not.toContain("restored from")
    expect(snapshotTree(external)).toEqual(externalBefore)
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
  })

  stest("a collision introduced after planning but before writing aborts safely", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "V-MAIN")
    write(project, "capitulos/cap1.tex", "V-CAP")
    for (let i = 1; i <= 120; i++) {
      write(project, `capitulos/cap${pad3(i)}.tex`, `V-C-${i}`)
    }
    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s-race" }, {} as any)
    expect(String(snap)).toContain("snapshot →")

    write(project, "main.tex", "CUR-MAIN")
    write(project, "capitulos/cap1.tex", "CUR-CAP")
    write(external, "outside.txt", "EXTERNAL")
    const externalBefore = snapshotTree(external)

    // The watcher fires once staging exists (after planning) and turns the
    // planned chapter destination into a symlink to main.tex.
    const watcher = startWatcher({ mode: "swap-destination" })
    await waitForFile(watcher.readyFile)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-race", confirm: true },
      {} as any,
    )
    const exitCode = await watcher.exit
    expect(exitCode).toBe(0)

    const text = String(result)
    expect(text).not.toContain("restored from")
    expect(text).toContain("blocked")
    expect(text).toContain("aborted before writing")
    expect(text).toMatch(/collide/)
    expect(text).toContain("Safety backup created")
    // the restore wrote nothing: the pre-restore content is intact
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("CUR-MAIN")
    expect(lstatSync(join(project, "capitulos", "cap1.tex")).isSymbolicLink()).toBe(true)
    expect(snapshotTree(external)).toEqual(externalBefore)
  })

  stest("a post-write corruption is caught by the final inventory check (no false success)", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "V-MAIN")
    for (let i = 1; i <= 120; i++) {
      write(project, `capitulos/cap${pad3(i)}.tex`, `V-C-${i}`)
    }
    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s-final" }, {} as any)
    expect(String(snap)).toContain("snapshot →")

    write(project, "main.tex", "CUR-MAIN")
    for (let i = 1; i <= 120; i++) {
      write(project, `capitulos/cap${pad3(i)}.tex`, `CUR-C-${i}`)
    }

    // The watcher waits until the first chapter holds its snapshot content
    // again (mid write loop) and then corrupts main.tex, which was already
    // written and verified earlier in the same loop.
    const watcher = startWatcher({
      mode: "corrupt-after-write",
      watchRel: "capitulos/cap001.tex",
      expected: "V-C-1",
      corruptRel: "main.tex",
    })
    await waitForFile(watcher.readyFile)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-final", confirm: true },
      {} as any,
    )
    const exitCode = await watcher.exit
    expect(exitCode).toBe(0)

    const text = String(result)
    expect(text).not.toContain("restored from")
    expect(text).toMatch(/failed/)
    expect(text).toContain("final content verification failed")
    expect(text).toContain("Rollback restored the pre-restore content")
    // rollback returned every applied file to the pre-restore state
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("CUR-MAIN")
    expect(readFileSync(join(project, "capitulos", "cap001.tex"), "utf8")).toBe("CUR-C-1")
  })

  stest("a destination resolving into .banca/state.json is refused and the state is preserved", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "V-MAIN")
    write(project, "capitulos/cap1.tex", "V-CAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-state" }, {} as any)
    const stateBefore = readFileSync(stateFile(project))

    rmSync(join(project, "capitulos", "cap1.tex"))
    symlinkSync("../.banca/state.json", join(project, "capitulos", "cap1.tex"))
    write(project, "main.tex", "CUR-MAIN")

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-state", confirm: true },
      {} as any,
    )
    const text = String(result)

    expect(text).not.toContain("restored from")
    expect(text).toContain("blocked")
    expect(text).toMatch(/protected namespace/)
    expect(readFileSync(stateFile(project)).equals(stateBefore)).toBe(true)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("CUR-MAIN")
  })

  stest("a destination resolving into .env is refused and the secrets file is preserved", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "V-MAIN")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-env" }, {} as any)

    write(project, ".env", "SECRET=KEEP")
    rmSync(join(project, "main.tex"))
    symlinkSync(".env", join(project, "main.tex"))
    const envBefore = readFileSync(join(project, ".env"))

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-env", confirm: true },
      {} as any,
    )
    const text = String(result)

    expect(text).not.toContain("restored from")
    expect(text).toContain("blocked")
    expect(text).toMatch(/protected namespace/)
    expect(readFileSync(join(project, ".env")).equals(envBefore)).toBe(true)
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
  })
})

// -------------------------------------- P1-B: snapshot label immutability

describe("snapshot label immutability (P1-B)", () => {
  test("a fresh label creates and registers the snapshot", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "FRESH-MAIN")
    const result = await bancaSnapshot.execute({ projectRoot: project, label: "fresh" }, {} as any)

    expect(String(result)).toContain("snapshot →")
    expect(readFileSync(join(snapDirOf(project, "fresh"), "main.tex"), "utf8")).toBe("FRESH-MAIN")
    expect(existsSync(manifestPathOf(project, "fresh"))).toBe(true)
    expect(stateLabels(project)).toEqual(["fresh"])
  })

  stest("reusing a registered label is blocked and the first snapshot stays byte-identical and restorable", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "VERSAO-A")
    write(project, "capitulos/cap1.tex", "CAP-A")
    const first = await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)
    expect(String(first)).toContain("snapshot →")

    const storedMain = join(snapDirOf(project, "s1"), "main.tex")
    const storedCap = join(snapDirOf(project, "s1"), "capitulos", "cap1.tex")
    const manifestPath = manifestPathOf(project, "s1")
    const mainBytesBefore = readFileSync(storedMain)
    const capBytesBefore = readFileSync(storedCap)
    const manifestHashBefore = sha256(readFileSync(manifestPath))

    write(project, "main.tex", "VERSAO-B")
    const second = await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)
    const text = String(second)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toContain("already registered in state.json")
    expect(text).toContain("existing snapshot data was left untouched")

    // byte-level proof: files, manifest and registry are all untouched
    expect(readFileSync(storedMain).equals(mainBytesBefore)).toBe(true)
    expect(readFileSync(storedCap).equals(capBytesBefore)).toBe(true)
    expect(sha256(readFileSync(manifestPath))).toBe(manifestHashBefore)
    expect(stateLabels(project)).toEqual(["s1"])

    // the preserved version is still a real, restorable recovery point
    write(project, "main.tex", "VERSAO-C")
    const restored = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s1", confirm: true },
      {} as any,
    )
    expect(String(restored)).toContain("restored from s1")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("VERSAO-A")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("CAP-A")
  })

  test("an existing unregistered snapshot directory is never overwritten", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "CURRENT-MAIN")
    write(project, ".banca/snapshots/ghost/keep.txt", "KEEP-ME")
    const ghostDir = snapDirOf(project, "ghost")
    const ghostBefore = snapshotTree(ghostDir)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "ghost" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toContain("snapshot directory already exists")
    expect(snapshotTree(ghostDir)).toEqual(ghostBefore)
    expect(existsSync(manifestPathOf(project, "ghost"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
  })

  test("an orphan manifest without a directory is preserved", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "CURRENT-MAIN")
    const orphan = manifestPathOf(project, "orphan")
    write(project, ".banca/snapshots/orphan.manifest.json", '{"orphan":true}')
    const orphanBytesBefore = readFileSync(orphan)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "orphan" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toContain("snapshot manifest already exists")
    expect(readFileSync(orphan).equals(orphanBytesBefore)).toBe(true)
    expect(existsSync(snapDirOf(project, "orphan"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
  })

  test("a registered legacy snapshot without manifest is preserved", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { addSnapshot } = await import("../src/lib/state")

    write(project, "main.tex", "CURRENT-MAIN")
    write(project, ".banca/snapshots/legacy/main.tex", "LEGACY-A")
    addSnapshot(project, "legacy", null)
    const legacyDir = snapDirOf(project, "legacy")
    const legacyBefore = snapshotTree(legacyDir)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "legacy" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(snapshotTree(legacyDir)).toEqual(legacyBefore)
    expect(existsSync(manifestPathOf(project, "legacy"))).toBe(false)
    expect(stateLabels(project)).toEqual(["legacy"])
  })

  stest("a label resolving to a symlink is denied and the link target is untouched", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "CURRENT-MAIN")
    write(project, ".banca/snapshots/real-target/keep.txt", "KEEP")
    const realTarget = snapDirOf(project, "real-target")
    symlinkSync("real-target", snapDirOf(project, "linked"))
    const targetBefore = snapshotTree(realTarget)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "linked" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toContain("symbolic link")
    expect(snapshotTree(realTarget)).toEqual(targetBefore)
    expect(lstatSync(snapDirOf(project, "linked")).isSymbolicLink()).toBe(true)
    expect(existsSync(manifestPathOf(project, "linked"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
  })

  test("a label colliding with an unexpected regular file is denied", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "CURRENT-MAIN")
    write(project, ".banca/snapshots/odd", "NOT-A-DIRECTORY")
    const oddBytesBefore = readFileSync(snapDirOf(project, "odd"))

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "odd" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(readFileSync(snapDirOf(project, "odd")).equals(oddBytesBefore)).toBe(true)
    expect(existsSync(manifestPathOf(project, "odd"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
  })

  stest("a symlinked manifest path is denied and its target is preserved", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "CURRENT-MAIN")
    const victim = write(project, ".banca/snapshots/victim.json", "VICTIM-CONTENT")
    symlinkSync("victim.json", manifestPathOf(project, "victim"))
    const victimBytesBefore = readFileSync(victim)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "victim" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toMatch(/manifest.*symbolic link/)
    expect(readFileSync(victim).equals(victimBytesBefore)).toBe(true)
    expect(existsSync(snapDirOf(project, "victim"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
  })

  nonRootTest("a capture failure blocks the snapshot with no registration and no partial vault", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")

    write(project, "main.tex", "M1")
    const bibPath = write(project, "referencias.bib", "B1")
    chmodSync(bibPath, 0o000)
    try {
      const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-fail" }, {} as any)
      const text = String(result)
      expect(text).toContain("blocked")
      expect(text).toContain("snapshot capture failed")
      expect(text).toContain("no snapshot was registered")
    } finally {
      chmodSync(bibPath, 0o644)
    }

    // no half snapshot left behind and no dangling registry record
    expect(existsSync(snapDirOf(project, "s-fail"))).toBe(false)
    expect(existsSync(manifestPathOf(project, "s-fail"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
    // the manuscript was never modified
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("M1")
    expect(readFileSync(bibPath, "utf8")).toBe("B1")
  })

  test("near-simultaneous pre-restore backups get unique labels and never overwrite", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "R-V1")
    write(project, "capitulos/cap1.tex", "R-C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-restore" }, {} as any)

    await withFrozenNow(1700000000000, async () => {
      write(project, "main.tex", "R-V2")
      write(project, "capitulos/cap1.tex", "R-C2")
      const first = await bancaRestore.execute(
        { projectRoot: project, snapshotId: "s-restore", confirm: true },
        {} as any,
      )
      expect(String(first)).toContain("Safety backup created: pre-restore-1700000000000")
      const firstBackupManifestHash = sha256(readFileSync(manifestPathOf(project, "pre-restore-1700000000000")))

      write(project, "main.tex", "R-V3")
      write(project, "capitulos/cap1.tex", "R-C3")
      const second = await bancaRestore.execute(
        { projectRoot: project, snapshotId: "s-restore", confirm: true },
        {} as any,
      )
      const text = String(second)
      expect(text).toContain("Safety backup created: pre-restore-1700000000000-2")

      // the first backup is byte-identical and both recovery points persist
      expect(readFileSync(join(snapDirOf(project, "pre-restore-1700000000000"), "main.tex"), "utf8")).toBe("R-V2")
      expect(sha256(readFileSync(manifestPathOf(project, "pre-restore-1700000000000")))).toBe(firstBackupManifestHash)
      expect(readFileSync(join(snapDirOf(project, "pre-restore-1700000000000-2"), "main.tex"), "utf8")).toBe("R-V3")
      const labels = stateLabels(project)
      expect(labels).toEqual(["s-restore", "pre-restore-1700000000000", "pre-restore-1700000000000-2"])
      const ids = stateIds(project)
      expect(new Set(ids).size).toBe(ids.length)

      // each recovery point still restores its own version
      const backToV2 = await bancaRestore.execute(
        { projectRoot: project, snapshotId: "pre-restore-1700000000000", confirm: true },
        {} as any,
      )
      expect(String(backToV2)).toContain("restored from pre-restore-1700000000000")
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("R-V2")
    })
  })

  test("near-simultaneous pre-correction snapshots never overwrite", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    write(project, "main.tex", "PRE-A")

    await withFrozenNow(1700000001000, async () => {
      const c1 = await bancaCorrigir.execute(
        { projectRoot: project, corrections: [{ file: "main.tex", oldText: "PRE-A", newText: "POST-A" }] },
        {} as any,
      )
      expect(String(c1)).toContain("✓")

      const c2 = await bancaCorrigir.execute(
        { projectRoot: project, corrections: [{ file: "main.tex", oldText: "POST-A", newText: "POST-B" }] },
        {} as any,
      )
      expect(String(c2)).toContain("✓")

      // both snapshots exist with their own version; the first is preserved
      expect(readFileSync(join(snapDirOf(project, "pre-1700000001000"), "main.tex"), "utf8")).toBe("PRE-A")
      expect(readFileSync(join(snapDirOf(project, "pre-1700000001000-2"), "main.tex"), "utf8")).toBe("POST-A")
      expect(existsSync(manifestPathOf(project, "pre-1700000001000"))).toBe(true)
      expect(existsSync(manifestPathOf(project, "pre-1700000001000-2"))).toBe(true)
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("POST-B")

      // pre-correction snapshots are registered in state.snapshots
      expect(stateLabels(project)).toEqual(["pre-1700000001000", "pre-1700000001000-2"])
    })
  })

  test("near-simultaneous loop snapshots never overwrite", async () => {
    const { bancaLoop } = await import("../src/tools/banca_loop")

    write(project, "main.tex", "Conteudo sem citacao alguma para pontuar baixo.")

    await withFrozenNow(1700000002000, async () => {
      const first = await bancaLoop.execute({ projectRoot: project }, {} as any)
      expect(String(first)).toContain("Snapshot: loop-1700000002000")
      const second = await bancaLoop.execute({ projectRoot: project }, {} as any)
      expect(String(second)).toContain("Snapshot: loop-1700000002000-2")

      expect(stateLabels(project)).toEqual(["loop-1700000002000", "loop-1700000002000-2"])
      expect(existsSync(manifestPathOf(project, "loop-1700000002000"))).toBe(true)
      expect(existsSync(manifestPathOf(project, "loop-1700000002000-2"))).toBe(true)
      const ids = stateIds(project)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  stest("a snapshot marked incomplete (capture did not finish) cannot be restored", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    write(project, "main.tex", "INC-V1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-incomplete" }, {} as any)
    write(project, "main.tex", "INC-V2")
    // simulate a capture that never finished (crash between marker and cleanup)
    write(project, ".banca/snapshots/s-incomplete/.capture-incomplete", "capture did not finish")

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-incomplete", confirm: true },
      {} as any,
    )
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).toMatch(/incomplete/)
    expect(text).not.toContain("restored from")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("INC-V2")
  })
})
