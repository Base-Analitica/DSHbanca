/**
 * Snapshot/restore reversibility — security + academic integrity suite.
 *
 * Covers the two P1 defects from the independent review:
 *   P1-A: snapshots keyed by the physical/canonical path lose the logical
 *         manuscript identity (`main.tex -> texto/main.tex` stored as
 *         `texto/main.tex`), so restore silently omits files and still
 *         reports success.
 *   P1-B: restore deleted the real destination file (rmSync) before proving
 *         it could restore it, losing content on an internal symlink.
 *
 * Every test uses synthetic temporary projects only. The integrated
 * reversibility proof runs the full cycle through the real tools:
 * create project -> snapshot -> modify -> restore -> compare hashes, paths,
 * symlinks, tool result and external tree.
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
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { pathToFileURL } from "node:url"

const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0
/** chmod-based fault injection is skipped when running as root. */
const nonRootTest = IS_ROOT ? test.skip : test

const symlinksSupported = (() => {
  try {
    const probe = join(tmpdir(), `dshbanca-rev-link-probe-${process.pid}-${Date.now()}`)
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
  base = mkdtempSync(join(tmpdir(), "dshbanca-reversibility-"))
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

function sha256File(path: string): string {
  return sha256(readFileSync(path))
}

/** Recursive state of a directory tree: rel path -> dir|symlink|content. */
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

function snapDirOf(root: string, label: string): string {
  return join(root, ".banca", "snapshots", label)
}

function manifestOf(root: string, label: string): any {
  return JSON.parse(readFileSync(join(root, ".banca", "snapshots", `${label}.manifest.json`), "utf8"))
}

function backupLabelFrom(result: string): string {
  const m = result.match(/Safety backup created:\s*(\S+)/)
  if (!m) throw new Error(`no backup label in result: ${result}`)
  return m[1]
}

/** Files listed by a successful restore result. */
function restoredEntries(result: string): string[] {
  const lines = result.split("\n")
  const out: string[] = []
  let inSection = false
  for (const line of lines) {
    if (line.startsWith("Restored files")) {
      inSection = true
      continue
    }
    if (inSection) {
      if (line.startsWith("- ")) out.push(line.slice(2))
      else if (line.trim() !== "") break
    }
  }
  return out
}

// ---------------------------------------------------- P1-A: logical identity

describe("snapshot identity (P1-A)", () => {
  stest("snapshot preserves the logical path of an internal symlinked main.tex", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "texto/main.tex", "ORIGINAL-MAIN")
    symlinkSync("texto/main.tex", join(project, "main.tex"))

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)

    expect(String(result)).toContain("snapshot →")
    const snapDir = snapDirOf(project, "s1")
    // logical identity: the configured manuscript path is the snapshot key
    expect(existsSync(join(snapDir, "main.tex"))).toBe(true)
    expect(readFileSync(join(snapDir, "main.tex"), "utf8")).toBe("ORIGINAL-MAIN")
    // no canonical-path duplication without an explicit logical key
    expect(existsSync(join(snapDir, "texto", "main.tex"))).toBe(false)
    // machine-readable inventory (manifest) records the logical path
    const manifest = manifestOf(project, "s1")
    expect(manifest.files.map((f: any) => f.logical)).toContain("main.tex")
  })

  stest("snapshot records missing expected files instead of silently omitting them", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "texto/main.tex", "ONLY-MAIN")
    symlinkSync("texto/main.tex", join(project, "main.tex"))

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-missing" }, {} as any)

    expect(String(result)).toContain("snapshot →")
    expect(String(result)).toContain("referencias.bib")
    const manifest = manifestOf(project, "s-missing")
    expect(manifest.missing).toContain("referencias.bib")
    expect(manifest.files.map((f: any) => f.logical)).toEqual(["main.tex"])
  })

  test("snapshot aborts explicitly on incomplete chapter discovery", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "main.tex", "content")
    write(
      project,
      ".banca/project.json",
      JSON.stringify({
        version: 1,
        manuscript: { format: "latex", root: ".", main: "main.tex", bib: "referencias.bib", chapters: ["../evil/*.tex"], outputDir: "trabalhos" },
      }),
    )

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-bad" }, {} as any)

    expect(String(result)).toMatch(/blocked|incomplete/)
    expect(existsSync(snapDirOf(project, "s-bad"))).toBe(false)
  })
})

// --------------------------------------- integrated reversibility proof

describe("reversibility proof: snapshot -> modify -> restore", () => {
  stest("restores logical paths, verified contents, symlinks and reports exactly the restored files", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")

    // synthetic project with an internal symlinked manuscript + bib + chapters
    write(project, "texto/main.tex", "V1-MAIN")
    symlinkSync("texto/main.tex", join(project, "main.tex"))
    write(project, "referencias.bib", "V1-BIB")
    write(project, "capitulos/cap1.tex", "V1-CAP1")
    write(project, "capitulos/cap2.tex", "V1-CAP2")
    write(external, "untouched.txt", "EXTERNAL")

    const expected: Record<string, string> = {
      "main.tex": sha256("V1-MAIN"),
      "texto/main.tex": sha256("V1-MAIN"),
      "referencias.bib": sha256("V1-BIB"),
      "capitulos/cap1.tex": sha256("V1-CAP1"),
      "capitulos/cap2.tex": sha256("V1-CAP2"),
    }

    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)
    expect(String(snap)).toContain("snapshot →")
    const externalBefore = snapshotTree(external)

    // modify/delete manuscript content after the snapshot
    write(project, "texto/main.tex", "V2-MAIN")
    write(project, "referencias.bib", "V2-BIB")
    write(project, "capitulos/cap1.tex", "V2-CAP1")
    rmSync(join(project, "capitulos", "cap2.tex"))

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s1", confirm: true }, {} as any)
    const text = String(result)
    expect(text).toContain("restored from s1")
    expect(text).toContain("Safety backup created")
    expect(text).not.toMatch(/blocked|failed|partial/)

    // logical identity, contents and hashes
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(project, "main.tex"))).toBe("texto/main.tex")
    for (const rel of ["texto/main.tex", "referencias.bib", "capitulos/cap1.tex", "capitulos/cap2.tex"]) {
      expect(sha256File(join(project, rel)), rel).toBe(expected[rel])
    }
    // restored-file relation matches the snapshot inventory
    expect(restoredEntries(text).sort()).toEqual(
      ["main.tex", "referencias.bib", "capitulos/cap1.tex", "capitulos/cap2.tex"].sort(),
    )
    // external tree untouched
    expect(snapshotTree(external)).toEqual(externalBefore)

    // the safety backup is a real, restorable recovery point of the pre-restore state
    const backupLabel = backupLabelFrom(text)
    expect(readFileSync(join(snapDirOf(project, backupLabel), "main.tex"), "utf8")).toBe("V2-MAIN")
    expect(readFileSync(join(snapDirOf(project, backupLabel), "capitulos/cap1.tex"), "utf8")).toBe("V2-CAP1")

    // repeated restore: back to V2 via the backup snapshot, then to V1 again
    const back = await bancaRestore.execute({ projectRoot: project, snapshotId: backupLabel, confirm: true }, {} as any)
    expect(String(back)).toContain(`restored from ${backupLabel}`)
    expect(readFileSync(join(project, "texto/main.tex"), "utf8")).toBe("V2-MAIN")
    const again = await bancaRestore.execute({ projectRoot: project, snapshotId: "s1", confirm: true }, {} as any)
    expect(String(again)).toContain("restored from s1")
    expect(readFileSync(join(project, "texto/main.tex"), "utf8")).toBe("V1-MAIN")
  })

  test("restore of plain files is deterministic across repetitions", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "PLAIN-V1")
    write(project, "capitulos/cap1.tex", "PLAIN-C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "plain" }, {} as any)
    write(project, "main.tex", "PLAIN-V2")

    const first = await bancaRestore.execute({ projectRoot: project, snapshotId: "plain", confirm: true }, {} as any)
    const second = await bancaRestore.execute({ projectRoot: project, snapshotId: "plain", confirm: true }, {} as any)
    expect(String(first)).toContain("restored from plain")
    expect(String(second)).toContain("restored from plain")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("PLAIN-V1")
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("PLAIN-C1")
  })

  test("dry-run lists the planned files without touching the project", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "DRY-V1")
    write(project, "capitulos/cap1.tex", "DRY-C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "dry" }, {} as any)
    write(project, "main.tex", "DRY-V2")

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "dry" }, {} as any)
    const text = String(result)
    expect(text).toContain("Restore Dry-Run")
    expect(text).toContain("main.tex")
    expect(text).toContain("capitulos/cap1.tex")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("DRY-V2")
    // no backup snapshot was created for a dry-run
    const snapshots = JSON.parse(readFileSync(join(project, ".banca", "state.json"), "utf8")).snapshots
    expect(snapshots.map((s: any) => s.label)).toEqual(["dry"])
  })
})

// ------------------------------------------------- P1-B: safe restore

describe("restore safety (P1-B)", () => {
  stest("restore through an internal symlink preserves the link and updates its real target", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    // snapshot taken while main.tex was a regular file
    write(project, "main.tex", "SNAPSHOT-CONTENT")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-reorg" }, {} as any)
    // project reorganized: main becomes an internal symlink
    write(project, "texto/main.tex", "CURRENT-CONTENT")
    rmSync(join(project, "main.tex"))
    symlinkSync("texto/main.tex", join(project, "main.tex"))

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-reorg", confirm: true }, {} as any)
    const text = String(result)

    // the fix restores through the link: success, link preserved, target updated
    expect(text).toContain("restored from s-reorg")
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(project, "texto/main.tex"), "utf8")).toBe("SNAPSHOT-CONTENT")
    expect(restoredEntries(text)).toEqual(["main.tex"])
  })

  stest("restore never deletes content: broken destination symlink is blocked with zero changes", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "SNAP")
    write(project, "capitulos/cap1.tex", "CAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-broken" }, {} as any)
    // replace main with a broken internal symlink
    rmSync(join(project, "main.tex"))
    symlinkSync("texto/ghost.tex", join(project, "main.tex"))
    const before = snapshotTree(project)

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-broken", confirm: true }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("restored from")
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(existsSync(join(project, "capitulos/cap1.tex"))).toBe(true)
    // exactly the same tree: no file was deleted or rewritten
    expect(snapshotTree(project)).toEqual(before)
  })

  stest("external destination symlink is blocked and the external file stays untouched", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "SNAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-ext" }, {} as any)
    write(external, "target.tex", "EXTERNAL-KEEP")
    rmSync(join(project, "main.tex"))
    symlinkSync(join(external, "target.tex"), join(project, "main.tex"))
    const externalBefore = snapshotTree(external)

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-ext", confirm: true }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(externalBefore)
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
  })

  test("directory at a destination path is blocked without deleting it", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "SNAP-MAIN")
    write(project, "capitulos/cap1.tex", "SNAP-CAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-dir" }, {} as any)
    // the destination becomes a directory containing an unrelated file
    rmSync(join(project, "capitulos", "cap1.tex"))
    mkdirSync(join(project, "capitulos", "cap1.tex"))
    write(project, "capitulos/cap1.tex/keep.txt", "KEEP")

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-dir", confirm: true }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(String(result)).not.toContain("restored from")
    expect(lstatSync(join(project, "capitulos", "cap1.tex")).isDirectory()).toBe(true)
    expect(readFileSync(join(project, "capitulos", "cap1.tex", "keep.txt"), "utf8")).toBe("KEEP")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("SNAP-MAIN")
  })
})

// ------------------------------------------- incomplete and legacy snapshots

describe("incomplete and legacy snapshots", () => {
  test("snapshot without main.tex never produces a false success", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    write(project, "main.tex", "CURRENT-MAIN")
    write(project, "capitulos/cap1.tex", "CURRENT-CAP")
    // craft a snapshot that only contains a chapter (e.g. produced by the P1-A bug)
    write(project, ".banca/snapshots/s-noMain/capitulos/cap1.tex", "SNAP-CAP")
    const id = addSnapshot(project, "s-noMain", null)
    expect(id).toBeTruthy()

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-noMain", confirm: true }, {} as any)
    const text = String(result)

    expect(text).not.toContain("restored from")
    expect(text).toMatch(/does not include|blocked/)
    // nothing was restored
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("CURRENT-CAP")
  })

  stest("legacy snapshot keyed by the canonical path is restored safely when unambiguous", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    write(project, "texto/main.tex", "CURRENT-REAL")
    symlinkSync("texto/main.tex", join(project, "main.tex"))
    // legacy snapshot: canonical key, no manifest
    write(project, ".banca/snapshots/s-legacy/texto/main.tex", "LEGACY-SNAP")
    addSnapshot(project, "s-legacy", null)

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-legacy", confirm: true }, {} as any)

    expect(String(result)).toContain("restored from s-legacy")
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(project, "texto/main.tex"), "utf8")).toBe("LEGACY-SNAP")
  })

  stest("legacy snapshot with both logical and canonical copies is blocked as ambiguous", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    write(project, "texto/main.tex", "CURRENT")
    symlinkSync("texto/main.tex", join(project, "main.tex"))
    write(project, ".banca/snapshots/s-amb/main.tex", "LOGICAL-COPY")
    write(project, ".banca/snapshots/s-amb/texto/main.tex", "CANONICAL-COPY")
    addSnapshot(project, "s-amb", null)

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-amb", confirm: true }, {} as any)

    expect(String(result)).toMatch(/ambiguous|inconsistent/)
    expect(String(result)).not.toContain("restored from")
    expect(readFileSync(join(project, "texto/main.tex"), "utf8")).toBe("CURRENT")
  })

  test("tampered snapshot content is detected before any change", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "REAL-SNAP")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-tamper" }, {} as any)
    // tamper with the stored snapshot content after capture
    writeFileSync(join(snapDirOf(project, "s-tamper"), "main.tex"), "TAMPERED")
    write(project, "main.tex", "CURRENT")

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-tamper", confirm: true }, {} as any)
    const text = String(result)

    expect(text).not.toContain("restored from")
    expect(text).toMatch(/corrupted|invalid|blocked/)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("CURRENT")
  })

  test("manifest with traversal or absolute entries is rejected", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    write(project, "main.tex", "CURRENT")
    mkdirSync(join(project, ".banca", "snapshots", "s-evil"), { recursive: true })
    writeFileSync(
      join(project, ".banca", "snapshots", "s-evil.manifest.json"),
      JSON.stringify({
        version: 1,
        label: "s-evil",
        createdAt: new Date().toISOString(),
        files: [{ logical: "../outside.txt", sha256: "0".repeat(64), size: 1 }],
        missing: [],
      }),
    )
    addSnapshot(project, "s-evil", null)

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-evil", confirm: true }, {} as any)

    expect(String(result)).toMatch(/invalid|blocked/)
    expect(String(result)).not.toContain("restored from")
    expect(existsSync(join(project, "outside.txt"))).toBe(false)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("CURRENT")
  })
})

// --------------------------------------------------- injected failures

describe("injected failures", () => {
  nonRootTest("unreadable snapshot content aborts with no manuscript change", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "V1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-fault1" }, {} as any)
    write(project, "main.tex", "V2")
    const snapFile = join(snapDirOf(project, "s-fault1"), "main.tex")
    chmodSync(snapFile, 0o000)
    try {
      const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-fault1", confirm: true }, {} as any)
      const text = String(result)
      expect(text).not.toContain("restored from")
      expect(text).toMatch(/blocked|failed/)
      // the original file was neither deleted nor rewritten
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("V2")
    } finally {
      chmodSync(snapFile, 0o644)
    }
  })

  nonRootTest("write failure after the backup triggers a verified rollback of applied files", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(
      project,
      ".banca/project.json",
      JSON.stringify({
        version: 1,
        manuscript: { format: "latex", root: ".", main: "main.tex", bib: "bib/refs.bib", chapters: ["capitulos/*.tex"], outputDir: "trabalhos" },
      }),
    )
    write(project, "main.tex", "MAIN-V1")
    write(project, "bib/refs.bib", "BIB-V1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-fault2" }, {} as any)
    write(project, "main.tex", "MAIN-V2")
    write(project, "bib/refs.bib", "BIB-V2")

    const bibDir = join(project, "bib")
    chmodSync(bibDir, 0o555)
    try {
      const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-fault2", confirm: true }, {} as any)
      const text = String(result)
      expect(text).not.toContain("restored from")
      expect(text).toMatch(/rollback|partial|failed/)
      // main.tex was already replaced before the failure: rollback restored V2
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("MAIN-V2")
      // bib destination was never modified
      expect(readFileSync(join(project, "bib/refs.bib"), "utf8")).toBe("BIB-V2")
    } finally {
      chmodSync(bibDir, 0o755)
    }
  })

  test("restore keeps working when the destination parent directory is missing", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "M1")
    write(project, "capitulos/cap1.tex", "C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-recreate" }, {} as any)
    // the whole chapters directory disappears after the snapshot
    rmSync(join(project, "capitulos"), { recursive: true, force: true })

    const result = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-recreate", confirm: true }, {} as any)

    expect(String(result)).toContain("restored from s-recreate")
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("C1")
  })
})

// ---------------------------------------------------------------------------
// Issue #145 — a relative workspace root must resolve the TRUE snapshot vault
//
// `banca_restore` selected `args.projectRoot || ctx.directory` without
// normalizing it, then built the vault as
// `resolveRealInsideRoot(root, join(root, ".banca", "snapshots"))`. A relative
// root was therefore applied twice: the selected state record still came from
// the true workspace, but the homonym snapshot was read from the duplicated
// vault (`project/project/.banca/snapshots`). A confirmed restore wrote the
// DECOY bytes into the true main.tex and stored the pre-restore safety backup
// in the duplicated vault while registering it in the true state.
//
// These scenarios use the real tools. Snapshot captures always use absolute
// roots (building the decoy legitimately); restores use bounded subprocesses so
// a relative projectRoot/ctx.directory is resolved against an explicit cwd
// without process.chdir.
// ---------------------------------------------------------------------------

describe("issue #145 — relative workspace root resolves the true snapshot vault", () => {
  const TRUE_ORIGINAL = "TRUE ORIGINAL"
  const DECOY_CONTENT = "DECOY CONTENT"
  const CURRENT_MANUSCRIPT = "CURRENT MANUSCRIPT"

  const CONFIG_145 = {
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
  }

  interface BoundedResult {
    timedOut: boolean
    parsed: { ok: boolean; result?: string; name?: string; message?: string }
  }

  function setupWorkspace(root: string, mainContent: string): void {
    mkdirSync(join(root, ".banca"), { recursive: true })
    write(root, ".banca/project.json", JSON.stringify(CONFIG_145))
    write(root, "main.tex", mainContent)
  }

  function vaultOf(root: string): string {
    return join(root, ".banca", "snapshots")
  }

  function stateOf(root: string): any {
    return JSON.parse(readFileSync(join(root, ".banca", "state.json"), "utf8"))
  }

  /** Complete recursive inventory: kind, symlink target or file SHA-256. */
  function inventoryTree(root: string): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        const abs = join(dir, entry.name)
        const rel = relative(root, abs).split("\\").join("/")
        const st = lstatSync(abs)
        if (st.isSymbolicLink()) out[rel] = `symlink:${readlinkSync(abs)}`
        else if (st.isDirectory()) {
          out[rel] = "dir"
          walk(abs)
        } else if (st.isFile()) {
          out[rel] = `file:${sha256(readFileSync(abs))}`
        } else {
          out[rel] = "special"
        }
      }
    }
    walk(root)
    return out
  }

  /** Run the real restore tool in a bounded subprocess with an explicit cwd. */
  function boundedRestore(cwd: string, args: Record<string, unknown>, ctxDirectory: string): BoundedResult {
    const worker = join(cwd, `restore-worker-145-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
    const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_restore.ts")).href
    writeFileSync(
      worker,
      [
        "const toolUrl = process.argv[2]",
        "const args = JSON.parse(process.argv[3])",
        "const ctxDirectory = process.argv[4]",
        "const { bancaRestore } = await import(toolUrl)",
        "try {",
        "  const result = await bancaRestore.execute(args, { directory: ctxDirectory })",
        "  console.log(JSON.stringify({ ok: true, result: String(result) }))",
        "} catch (error) {",
        "  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    )
    const outcome = spawnSync(
      process.execPath,
      [worker, toolUrl, JSON.stringify(args), ctxDirectory],
      { cwd, env: { ...process.env, PATH: "" }, timeout: 20_000, encoding: "utf-8" },
    )
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

  function expectRestoreSuccess(result: BoundedResult, label: string): string {
    expect(result.timedOut).toBe(false)
    expect(result.parsed.ok).toBe(true)
    const text = String(result.parsed.result)
    expect(text).toContain(`restored from ${label}`)
    expect(text).toContain("Safety backup created")
    expect(text).not.toMatch(/blocked|failed|partial:/)
    return text
  }

  function expectBoundedRefusal(result: BoundedResult): string {
    expect(result.timedOut).toBe(false)
    expect(result.parsed.ok).toBe(true)
    const text = String(result.parsed.result)
    expect(text).not.toContain("restored from")
    expect(text).not.toContain("Safety backup created")
    expect(text).not.toContain("Restore Dry-Run")
    return text
  }

  /** Path where the pre-fix implementation applied a relative root twice. */
  function duplicatedRoot(trueRoot: string, rootArg: string): string {
    return join(trueRoot, ...rootArg.split("/").filter((part) => part !== "" && part !== "."))
  }

  /**
   * Issue #151 — deterministic snapshot identity for the homonym scenario.
   *
   * `addSnapshot` derives the ID from `Date.now()` and guarantees uniqueness
   * only inside one workspace's state; two independent workspaces captured in
   * the same millisecond legitimately receive the same ID. The previous fixture
   * relied on the two real captures landing in different milliseconds, which is
   * not guaranteed and flaked in CI (PR #150 and PR #155).
   *
   * These synthetic milliseconds are frozen only for the duration of each REAL
   * capture (never for the restore, which runs in a child process with the real
   * clock), then the original `Date.now` is restored in `finally`. The two
   * values are one millisecond apart, so the true and decoy IDs are known and
   * distinct by construction, independent of machine speed. Nothing else is
   * mocked: state, manifest, vault and captured bytes remain the real product
   * of the existing snapshot logic.
   */
  const FIXTURE_TRUE_SNAPSHOT_MS = 1_794_800_000_000
  const FIXTURE_DECOY_SNAPSHOT_MS = FIXTURE_TRUE_SNAPSHOT_MS + 1

  /**
   * Freeze only `Date.now` while one real snapshot capture registers its
   * recovery point, so production `addSnapshot` receives a controlled
   * millisecond. The patch is process-global for the duration of that one real
   * capture; it relies on this file having no `test.concurrent` and on the
   * runner's file isolation (plain `bun test` runs files sequentially, while
   * `--parallel` gives each file its own worker process). The original function
   * is restored after every capture — success or failure — and the restoration
   * is asserted, so a leaked patch fails the test instead of contaminating the
   * rest of the suite.
   */
  async function withFixedSnapshotMillisecond<T>(
    fixedNow: number,
    run: () => Promise<T>,
  ): Promise<T> {
    const originalNow = Date.now
    ;(Date as unknown as { now: () => number }).now = () => fixedNow
    let captured: { ok: true; value: T } | { ok: false; error: unknown }
    try {
      captured = { ok: true, value: await run() }
    } catch (error) {
      captured = { ok: false, error }
    } finally {
      ;(Date as unknown as { now: () => number }).now = originalNow
    }
    // Restore first, then check: a failed capture still reports its own error
    // instead of being masked by the clock-leak assertion.
    expect(Date.now).toBe(originalNow)
    if (captured.ok) return captured.value
    throw captured.error
  }

  interface Fixture145 {
    trueRoot: string
    trueMainSha: string
    decoyRoot: string | null
    decoyMainSha: string | null
  }

  /**
   * Create the true workspace and (optionally) a legitimate homonym decoy at
   * the pre-fix duplicated destination, capture both with the REAL snapshot
   * tool using absolute roots, then modify the true manuscript.
   */
  async function prepareSnapshotFixture(options: {
    trueRoot: string
    rootArg: string
    withDecoy: boolean
  }): Promise<Fixture145> {
    setupWorkspace(options.trueRoot, TRUE_ORIGINAL)
    let decoyRoot: string | null = null
    if (options.withDecoy) {
      decoyRoot = duplicatedRoot(options.trueRoot, options.rootArg)
      setupWorkspace(decoyRoot, DECOY_CONTENT)
    }

    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const trueCapture = String(
      await withFixedSnapshotMillisecond(FIXTURE_TRUE_SNAPSHOT_MS, () =>
        bancaSnapshot.execute({ projectRoot: options.trueRoot, label: "same" }, {} as any),
      ),
    )
    expect(trueCapture).toContain("snapshot →")
    expect(trueCapture).toContain("restorable")
    // Issue #151: the recovery-point ID is produced by the real registration
    // logic under a controlled millisecond, so it is known by construction.
    expect(
      stateOf(options.trueRoot).snapshots.find((s: any) => s.label === "same").id,
    ).toBe(`snap-${FIXTURE_TRUE_SNAPSHOT_MS}`)
    const trueManifest = manifestOf(options.trueRoot, "same")
    expect(trueManifest.kind).toBe("restorable")
    const trueMainEntry = trueManifest.files.find((entry: any) => entry.logical === "main.tex")
    expect(trueMainEntry.sha256).toBe(sha256(TRUE_ORIGINAL))

    let decoyMainSha: string | null = null
    if (decoyRoot !== null) {
      const decoyCapture = String(
        await withFixedSnapshotMillisecond(FIXTURE_DECOY_SNAPSHOT_MS, () =>
          bancaSnapshot.execute({ projectRoot: decoyRoot, label: "same" }, {} as any),
        ),
      )
      expect(decoyCapture).toContain("snapshot →")
      // Distinct ID deterministic by construction (one controlled ms apart),
      // never dependent on the two captures taking different real milliseconds.
      expect(
        stateOf(decoyRoot).snapshots.find((s: any) => s.label === "same").id,
      ).toBe(`snap-${FIXTURE_DECOY_SNAPSHOT_MS}`)
      expect(`snap-${FIXTURE_DECOY_SNAPSHOT_MS}`).not.toBe(
        `snap-${FIXTURE_TRUE_SNAPSHOT_MS}`,
      )
      const decoyManifest = manifestOf(decoyRoot, "same")
      expect(decoyManifest.kind).toBe("restorable")
      const decoyMainEntry = decoyManifest.files.find((entry: any) => entry.logical === "main.tex")
      expect(decoyMainEntry.sha256).toBe(sha256(DECOY_CONTENT))
      expect(decoyMainEntry.sha256).not.toBe(trueMainEntry.sha256)
      decoyMainSha = decoyMainEntry.sha256
    }

    // The true state registers the true snapshot before the manuscript changes.
    expect(stateOf(options.trueRoot).snapshots.map((s: any) => s.label)).toEqual(["same"])
    write(options.trueRoot, "main.tex", CURRENT_MANUSCRIPT)
    return {
      trueRoot: options.trueRoot,
      trueMainSha: trueMainEntry.sha256,
      decoyRoot,
      decoyMainSha,
    }
  }

  // ------------------------------------------------- P1: selected snapshot

  test("relative root: dry-run is read-only and confirmed restore recovers TRUE ORIGINAL, never the decoy", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    const decoyBefore = inventoryTree(decoyRoot)
    const decoyVaultBefore = inventoryTree(vaultOf(decoyRoot))
    const stateBefore = readFileSync(join(project, ".banca", "state.json"))
    const configBefore = readFileSync(join(project, ".banca", "project.json"))
    const trueBefore = inventoryTree(project)

    // Dry-run without confirm: planned operation, zero effects.
    const dry = boundedRestore(base, { projectRoot: "project", snapshotId: "same" }, "project")
    expect(dry.timedOut).toBe(false)
    expect(dry.parsed.ok).toBe(true)
    const dryText = String(dry.parsed.result)
    expect(dryText).toContain("Restore Dry-Run")
    expect(dryText).toContain("main.tex")
    expect(dryText).not.toContain("Safety backup created")
    expect(inventoryTree(project)).toEqual(trueBefore)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    expect(readFileSync(join(project, ".banca", "state.json"))).toEqual(stateBefore)

    // Dry-run with confirm:false is the same read-only contract.
    const dryFalse = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: "same", confirm: false },
      "project",
    )
    expect(String(dryFalse.parsed.result)).toContain("Restore Dry-Run")
    expect(inventoryTree(project)).toEqual(trueBefore)

    // Confirmed restore: bytes must come from the TRUE vault entry.
    const run = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: "same", confirm: true },
      "project",
    )
    const text = expectRestoreSuccess(run, "same")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(TRUE_ORIGINAL)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(fixture.trueMainSha)
    expect(sha256(readFileSync(join(project, "main.tex")))).not.toBe(fixture.decoyMainSha as string)

    // The whole decoy workspace (and its vault) is untouched.
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    expect(inventoryTree(vaultOf(decoyRoot))).toEqual(decoyVaultBefore)
    expect(readFileSync(join(decoyRoot, "main.tex"), "utf8")).toBe(DECOY_CONTENT)

    // The safety backup lives in the TRUE vault and captures CURRENT MANUSCRIPT.
    const backupLabel = backupLabelFrom(text)
    expect(existsSync(join(vaultOf(project), backupLabel))).toBe(true)
    expect(existsSync(join(vaultOf(decoyRoot), backupLabel))).toBe(false)
    expect(readFileSync(join(vaultOf(project), backupLabel, "main.tex"), "utf8")).toBe(CURRENT_MANUSCRIPT)
    const backupManifest = manifestOf(project, backupLabel)
    expect(backupManifest.kind).toBe("restorable")
    const backupMainEntry = backupManifest.files.find((entry: any) => entry.logical === "main.tex")
    expect(backupMainEntry.sha256).toBe(sha256(CURRENT_MANUSCRIPT))
    expect(backupMainEntry.size).toBe(Buffer.byteLength(CURRENT_MANUSCRIPT))

    // The true state keeps the selected snapshot and registers the true backup.
    const stateAfter = stateOf(project)
    expect(stateAfter.snapshots.map((s: any) => s.label)).toContain("same")
    expect(stateAfter.snapshots.map((s: any) => s.label)).toContain(backupLabel)
    expect(readFileSync(join(project, ".banca", "project.json"))).toEqual(configBefore)

    // The existing staging contract left no residual staging directory.
    expect(readdirSync(vaultOf(project)).filter((name) => name.startsWith(".restore-staging"))).toEqual([])
  })

  test("the true pre-restore backup is itself restorable and recovers CURRENT MANUSCRIPT", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string

    const run = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: "same", confirm: true },
      "project",
    )
    const text = expectRestoreSuccess(run, "same")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(TRUE_ORIGINAL)
    const backupLabel = backupLabelFrom(text)

    const decoyBefore = inventoryTree(decoyRoot)
    const back = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: backupLabel, confirm: true },
      "project",
    )
    const backText = expectRestoreSuccess(back, backupLabel)

    // The safety backup recovers exactly the pre-restore bytes.
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CURRENT_MANUSCRIPT)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    // The new recovery point for the second restore exists only in the true vault.
    const secondBackup = backupLabelFrom(backText)
    expect(existsSync(join(vaultOf(project), secondBackup))).toBe(true)
    expect(existsSync(join(vaultOf(decoyRoot), secondBackup))).toBe(false)
  })

  test("selection by the true state id restores from the true vault under a relative root", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    const trueRecord = stateOf(project).snapshots.find((s: any) => s.label === "same")
    const decoyRecord = stateOf(decoyRoot).snapshots.find((s: any) => s.label === "same")
    expect(trueRecord.id).toBeTruthy()
    expect(decoyRecord.id).toBeTruthy()
    // Issue #151: both IDs are known by construction (controlled milliseconds),
    // not merely "probably different because the captures took more than 1ms".
    expect(trueRecord.id).toBe(`snap-${FIXTURE_TRUE_SNAPSHOT_MS}`)
    expect(decoyRecord.id).toBe(`snap-${FIXTURE_DECOY_SNAPSHOT_MS}`)
    expect(trueRecord.id).not.toBe(decoyRecord.id)

    const decoyBefore = inventoryTree(decoyRoot)
    const run = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: trueRecord.id, confirm: true },
      "project",
    )
    expectRestoreSuccess(run, "same")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(TRUE_ORIGINAL)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
  })

  test("snapshot IDs stay known and distinct even when the surrounding clock is frozen to one millisecond (issue #151)", async () => {
    // Reproduce the exact former failure condition: the ambient wall clock does
    // not advance between the two captures, so an unguarded fixture would give
    // both independent workspaces the same `snap-<ms>` ID and fail the
    // distinctness assertion before restoring. The fixture must control only
    // the registration milliseconds and restore the clock afterwards.
    const originalNow = Date.now
    ;(Date as unknown as { now: () => number }).now = () => FIXTURE_TRUE_SNAPSHOT_MS
    try {
      const fixture = await prepareSnapshotFixture({
        trueRoot: project,
        rootArg: "project",
        withDecoy: true,
      })
      const decoyRoot = fixture.decoyRoot as string
      const trueRecord = stateOf(project).snapshots.find((s: any) => s.label === "same")
      const decoyRecord = stateOf(decoyRoot).snapshots.find((s: any) => s.label === "same")

      // Both remain REAL snapshots registered by the existing logic, with the
      // same label and different captured bytes.
      const trueManifest = manifestOf(project, "same")
      const decoyManifest = manifestOf(decoyRoot, "same")
      expect(trueManifest.kind).toBe("restorable")
      expect(decoyManifest.kind).toBe("restorable")
      expect(trueManifest.label).toBe("same")
      expect(decoyManifest.label).toBe("same")
      expect(
        trueManifest.files.find((entry: any) => entry.logical === "main.tex").sha256,
      ).toBe(sha256(TRUE_ORIGINAL))
      expect(
        decoyManifest.files.find((entry: any) => entry.logical === "main.tex").sha256,
      ).toBe(sha256(DECOY_CONTENT))

      expect(trueRecord.id).toBe(`snap-${FIXTURE_TRUE_SNAPSHOT_MS}`)
      expect(decoyRecord.id).toBe(`snap-${FIXTURE_DECOY_SNAPSHOT_MS}`)
      expect(trueRecord.id).not.toBe(decoyRecord.id)
    } finally {
      ;(Date as unknown as { now: () => number }).now = originalNow
      expect(Date.now).toBe(originalNow)
    }
  })

  // ------------------------------------------------- root representation matrix

  async function expectRepresentationRestoresTrue(options: {
    cwd: string
    trueRoot: string
    rootArg: string
    ctxMode?: boolean
  }): Promise<void> {
    const fixture = await prepareSnapshotFixture({
      trueRoot: options.trueRoot,
      rootArg: options.rootArg,
      withDecoy: true,
    })
    const decoyRoot = fixture.decoyRoot as string
    const decoyBefore = inventoryTree(decoyRoot)
    const args: Record<string, unknown> = { snapshotId: "same", confirm: true }
    if (!options.ctxMode) args.projectRoot = options.rootArg

    const run = boundedRestore(options.cwd, args, options.rootArg)
    const text = expectRestoreSuccess(run, "same")
    expect(readFileSync(join(options.trueRoot, "main.tex"), "utf8")).toBe(TRUE_ORIGINAL)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    const backupLabel = backupLabelFrom(text)
    expect(existsSync(join(vaultOf(options.trueRoot), backupLabel))).toBe(true)
    expect(existsSync(join(vaultOf(decoyRoot), backupLabel))).toBe(false)
  }

  test("absolute root keeps restoring the correct snapshot (regression)", async () => {
    const trueRoot = join(base, "absolute", "project")
    const fixture = await prepareSnapshotFixture({ trueRoot, rootArg: "", withDecoy: false })
    const run = boundedRestore(base, { projectRoot: trueRoot, snapshotId: "same", confirm: true }, trueRoot)
    const text = expectRestoreSuccess(run, "same")
    expect(readFileSync(join(trueRoot, "main.tex"), "utf8")).toBe(TRUE_ORIGINAL)
    expect(sha256(readFileSync(join(trueRoot, "main.tex")))).toBe(fixture.trueMainSha)
    expect(existsSync(join(vaultOf(trueRoot), backupLabelFrom(text)))).toBe(true)
  })

  test("'./project' prefix restores from the true vault", async () => {
    await expectRepresentationRestoresTrue({ cwd: base, trueRoot: project, rootArg: "./project" })
  })

  test("nested relative root restores from the true vault", async () => {
    const trueRoot = join(base, "parent", "project")
    await expectRepresentationRestoresTrue({ cwd: base, trueRoot, rootArg: "parent/project" })
  })

  test("relative ctx.directory fallback restores from the true vault", async () => {
    await expectRepresentationRestoresTrue({
      cwd: base,
      trueRoot: project,
      rootArg: "project",
      ctxMode: true,
    })
  })

  // ------------------------------------------------------ negative cases

  test("refuses when the true snapshot is absent although a valid decoy homonym exists", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    // The true state still registers "same", but the true vault entry is gone.
    rmSync(join(vaultOf(project), "same"), { recursive: true, force: true })
    rmSync(join(vaultOf(project), "same.manifest.json"), { force: true })
    expect(stateOf(project).snapshots.map((s: any) => s.label)).toEqual(["same"])
    // The decoy homonym remains a valid restorable snapshot.
    expect(manifestOf(decoyRoot, "same").kind).toBe("restorable")

    const trueBefore = inventoryTree(project)
    const decoyBefore = inventoryTree(decoyRoot)
    const stateBefore = readFileSync(join(project, ".banca", "state.json"))
    for (const confirm of [false, true]) {
      const result = boundedRestore(
        base,
        { projectRoot: "project", snapshotId: "same", confirm },
        "project",
      )
      const text = expectBoundedRefusal(result)
      expect(text).toMatch(/snapshot directory not found|not found|blocked/)
      expect(inventoryTree(project)).toEqual(trueBefore)
      expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
      expect(readFileSync(join(project, ".banca", "state.json"))).toEqual(stateBefore)
    }
  })

  test("refuses an invalid true manifest and the valid decoy homonym does not mask it", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    writeFileSync(join(vaultOf(project), "same.manifest.json"), "{ this is not json")
    expect(manifestOf(decoyRoot, "same").kind).toBe("restorable")

    const trueBefore = inventoryTree(project)
    const decoyBefore = inventoryTree(decoyRoot)
    const stateBefore = readFileSync(join(project, ".banca", "state.json"))
    for (const confirm of [false, true]) {
      const result = boundedRestore(
        base,
        { projectRoot: "project", snapshotId: "same", confirm },
        "project",
      )
      const text = expectBoundedRefusal(result)
      expect(text).toMatch(/manifest is invalid|invalid|blocked/)
      expect(inventoryTree(project)).toEqual(trueBefore)
      expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
      expect(readFileSync(join(project, ".banca", "state.json"))).toEqual(stateBefore)
    }
  })

  test("refuses a missing true snapshot file even though the decoy vault has a legitimate copy", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    rmSync(join(vaultOf(project), "same", "main.tex"), { force: true })

    const trueBefore = inventoryTree(project)
    const decoyBefore = inventoryTree(decoyRoot)
    for (const confirm of [false, true]) {
      const result = boundedRestore(
        base,
        { projectRoot: "project", snapshotId: "same", confirm },
        "project",
      )
      const text = expectBoundedRefusal(result)
      expect(text).toContain("missing or corrupted")
      expect(inventoryTree(project)).toEqual(trueBefore)
      expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CURRENT_MANUSCRIPT)
    }
  })

  test("refuses a hash-divergent true snapshot file even though the decoy snapshot is valid", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    writeFileSync(join(vaultOf(project), "same", "main.tex"), "TAMPERED TRUE PAYLOAD")

    const trueBefore = inventoryTree(project)
    const decoyBefore = inventoryTree(decoyRoot)
    for (const confirm of [false, true]) {
      const result = boundedRestore(
        base,
        { projectRoot: "project", snapshotId: "same", confirm },
        "project",
      )
      const text = expectBoundedRefusal(result)
      expect(text).toContain("missing or corrupted")
      expect(inventoryTree(project)).toEqual(trueBefore)
      expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CURRENT_MANUSCRIPT)
    }
  })

  stest("refuses an external true vault symlink before effects and keeps the decoy vault valid", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    // Move the true vault outside the workspace and link it back.
    const externalVault = join(base, "external-vault-145")
    renameSync(vaultOf(project), externalVault)
    symlinkSync(externalVault, vaultOf(project), "dir")
    expect(manifestOf(decoyRoot, "same").kind).toBe("restorable")

    const externalBefore = inventoryTree(externalVault)
    const decoyBefore = inventoryTree(decoyRoot)
    const trueBefore = inventoryTree(project)
    for (const confirm of [false, true]) {
      const result = boundedRestore(
        base,
        { projectRoot: "project", snapshotId: "same", confirm },
        "project",
      )
      const text = expectBoundedRefusal(result)
      expect(text).toContain("blocked")
      // Sanitized diagnostic: no external/private path and no raw fs message.
      expect(text).not.toContain(externalVault)
      expect(text).not.toContain(base)
      expect(inventoryTree(project)).toEqual(trueBefore)
      expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
      expect(inventoryTree(externalVault)).toEqual(externalBefore)
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CURRENT_MANUSCRIPT)
    }
  })

  stest("refuses a broken true vault symlink before effects", async () => {
    const fixture = await prepareSnapshotFixture({ trueRoot: project, rootArg: "project", withDecoy: true })
    const decoyRoot = fixture.decoyRoot as string
    renameSync(vaultOf(project), join(base, "moved-vault-145"))
    symlinkSync(join(base, "missing-vault-145"), vaultOf(project), "dir")

    const decoyBefore = inventoryTree(decoyRoot)
    const trueBefore = inventoryTree(project)
    for (const confirm of [false, true]) {
      const result = boundedRestore(
        base,
        { projectRoot: "project", snapshotId: "same", confirm },
        "project",
      )
      const text = expectBoundedRefusal(result)
      expect(text).toContain("blocked")
      expect(text).not.toContain(base)
      expect(inventoryTree(project)).toEqual(trueBefore)
      expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
      expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CURRENT_MANUSCRIPT)
    }
  })

  // ------------------------------------------- snapshot kinds and listing

  test("listing reads the TRUE vault classification (marker) instead of the decoy homonym (partial)", async () => {
    const { createSnapshot } = await import("../src/lib/snapshot")
    setupWorkspace(project, "TRUE MARKER WORKSPACE")
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, "DECOY PARTIAL WORKSPACE")
    mkdirSync(vaultOf(project), { recursive: true })
    mkdirSync(vaultOf(decoyRoot), { recursive: true })
    createSnapshot({
      root: project,
      snapshotsDir: vaultOf(project),
      label: "same",
      candidates: [],
      labelPolicy: "strict",
      register: true,
      kind: "marker",
    })
    createSnapshot({
      root: decoyRoot,
      snapshotsDir: vaultOf(decoyRoot),
      label: "same",
      candidates: [{ logical: "main.tex", abs: join(decoyRoot, "main.tex") }],
      labelPolicy: "strict",
      register: true,
      kind: "partial",
    })
    expect(manifestOf(project, "same").kind).toBe("marker")
    expect(manifestOf(decoyRoot, "same").kind).toBe("partial")

    const trueBefore = inventoryTree(project)
    const decoyBefore = inventoryTree(decoyRoot)
    const listing = boundedRestore(base, { projectRoot: "project" }, "project")
    expect(listing.timedOut).toBe(false)
    expect(listing.parsed.ok).toBe(true)
    const listingText = String(listing.parsed.result)
    expect(listingText).toContain("same")
    expect(listingText).toContain("[marker]")
    expect(listingText).not.toContain("[partial]")
    expect(inventoryTree(project)).toEqual(trueBefore)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)

    // The marker is refused as a process marker; it is never restored from the
    // decoy's valid partial homonym.
    const refused = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: "same", confirm: true },
      "project",
    )
    const refusedText = expectBoundedRefusal(refused)
    expect(refusedText).toContain("process marker")
    expect(inventoryTree(project)).toEqual(trueBefore)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
  })

  test("partial snapshot restores only its captured files from the true vault", async () => {
    const { createSnapshot } = await import("../src/lib/snapshot")
    setupWorkspace(project, "MAIN-NOT-CAPTURED")
    write(project, "capitulos/cap1.tex", "CHAP-CAPTURED")
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, "DECOY-MAIN")
    write(decoyRoot, "capitulos/cap1.tex", "DECOY-CHAP")
    mkdirSync(vaultOf(project), { recursive: true })
    mkdirSync(vaultOf(decoyRoot), { recursive: true })
    createSnapshot({
      root: project,
      snapshotsDir: vaultOf(project),
      label: "same",
      candidates: [{ logical: "capitulos/cap1.tex", abs: join(project, "capitulos/cap1.tex") }],
      labelPolicy: "strict",
      register: true,
      kind: "partial",
    })
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    expect(String(await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "same" }, {} as any))).toContain(
      "snapshot →",
    )

    write(project, "capitulos/cap1.tex", "CHAP-CURRENT")
    const decoyBefore = inventoryTree(decoyRoot)
    const run = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: "same", confirm: true },
      "project",
    )
    const text = expectRestoreSuccess(run, "same")

    expect(text).toContain("Partial recovery")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("CHAP-CAPTURED")
    // Files outside the partial capture are left untouched, never completed
    // from the decoy vault.
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("MAIN-NOT-CAPTURED")
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    const backupLabel = backupLabelFrom(text)
    expect(existsSync(join(vaultOf(project), backupLabel))).toBe(true)
    expect(existsSync(join(vaultOf(decoyRoot), backupLabel))).toBe(false)
    expect(readFileSync(join(vaultOf(project), backupLabel, "capitulos", "cap1.tex"), "utf8")).toBe("CHAP-CURRENT")
  })

  test("legacy snapshot without manifest restores the true vault bytes under a relative root", async () => {
    const { addSnapshot } = await import("../src/lib/state")
    setupWorkspace(project, "LEGACY TRUE")
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, "DECOY LEGACY")
    // True legacy snapshot: logical key, no manifest.
    mkdirSync(join(vaultOf(project), "same"), { recursive: true })
    write(vaultOf(project), "same/main.tex", "LEGACY TRUE")
    addSnapshot(project, "same", null)
    // Decoy homonym is a modern, valid snapshot with a manifest.
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    expect(String(await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "same" }, {} as any))).toContain(
      "snapshot →",
    )

    write(project, "main.tex", "CURRENT LEGACY")
    const decoyBefore = inventoryTree(decoyRoot)
    const run = boundedRestore(
      base,
      { projectRoot: "project", snapshotId: "same", confirm: true },
      "project",
    )
    const text = expectRestoreSuccess(run, "same")

    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("LEGACY TRUE")
    expect(existsSync(join(vaultOf(project), "same.manifest.json"))).toBe(false)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    expect(existsSync(join(vaultOf(project), backupLabelFrom(text)))).toBe(true)
    expect(existsSync(join(vaultOf(decoyRoot), backupLabelFrom(text)))).toBe(false)
  })
})
