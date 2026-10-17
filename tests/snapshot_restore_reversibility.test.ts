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
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

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
