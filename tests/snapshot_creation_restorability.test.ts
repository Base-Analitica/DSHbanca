/**
 * Round-4 suite — consistency between snapshot creation and restoration.
 *
 * Two defects (independent review of PR #1):
 *   P1-A: `banca_snapshot` captured two distinct logical paths that resolve to
 *         the same physical file (`main.tex -> capitulos/cap1.tex` plus the
 *         discovered `capitulos/cap1.tex`) and registered a "recovery point"
 *         that `banca_restore` correctly refuses (destination collision). The
 *         announced snapshot could never be restored in the same configuration.
 *   P1-B: `banca_snapshot` accepted a capture without `main.tex` (recorded it
 *         in `missing`) and registered it as a recovery point, while
 *         `banca_restore` requires the main file. The registry therefore
 *         advertised snapshots that restore refuses.
 *
 * The suite proves creation now applies the same physical-destination policy as
 * restore, that a restorable snapshot always carries its mandatory main file,
 * that markers and partial captures have explicit semantics, and that a
 * rejected capture leaves no residue and invalidates nothing.
 *
 * Every scenario uses synthetic temporary projects and the real tools. Refusal
 * proofs compare the filesystem (vault, manuscript, external tree) and
 * `state.json` bytes before/after — never messages alone.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
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

const symlinksSupported = (() => {
  try {
    const probe = join(tmpdir(), `dshbanca-r4-link-probe-${process.pid}-${Date.now()}`)
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
  base = mkdtempSync(join(tmpdir(), "dshbanca-round4-"))
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

/** Recursive tree: rel path -> "dir" | "symlink" | file content. */
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

function manifestOf(root: string, label: string): any {
  return JSON.parse(readFileSync(manifestPathOf(root, label), "utf8"))
}

function stateLabels(root: string): string[] {
  const p = join(root, ".banca", "state.json")
  if (!existsSync(p)) return []
  return JSON.parse(readFileSync(p, "utf8")).snapshots.map((s: any) => s.label)
}

function stateBytes(root: string): string | null {
  const p = join(root, ".banca", "state.json")
  return existsSync(p) ? readFileSync(p).toString("base64") : null
}

/** Contents of the vault only (missing directory = empty vault). */
function vaultTree(root: string): Record<string, string> {
  return snapshotTree(snapshotsRoot(root))
}

/** Everything a rejected capture must not touch. */
interface IntegrityFingerprint {
  manuscript: Record<string, string>
  vault: Record<string, string>
  state: string | null
  external: Record<string, string>
}

function fingerprint(root: string): IntegrityFingerprint {
  const full = snapshotTree(root)
  const manuscript: Record<string, string> = {}
  for (const [rel, value] of Object.entries(full)) {
    if (rel === ".banca" || rel.startsWith(".banca/")) continue
    manuscript[rel] = value
  }
  return {
    manuscript,
    vault: vaultTree(root),
    state: stateBytes(root),
    external: snapshotTree(external),
  }
}

function expectUnchanged(root: string, before: IntegrityFingerprint): void {
  expect(fingerprint(root)).toEqual(before)
}

function backupLabelFrom(result: string): string {
  const m = result.match(/Safety backup created:\s*(\S+)/)
  if (!m) throw new Error(`no backup label in result: ${result}`)
  return m[1]
}

/** Files listed by a successful restore result. */
function restoredEntries(result: string): string[] {
  const out: string[] = []
  let inSection = false
  for (const line of result.split("\n")) {
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

const CHAPTER_CONFIG = {
  version: 1,
  manuscript: {
    format: "latex",
    root: ".",
    main: "main.tex",
    bib: "referencias.bib",
    chapters: ["capitulos/*.tex"],
    outputDir: "trabalhos",
  },
}

function writeConfig(root: string, manuscript: Record<string, unknown>): void {
  write(
    root,
    ".banca/project.json",
    JSON.stringify({ ...CHAPTER_CONFIG, manuscript: { ...CHAPTER_CONFIG.manuscript, ...manuscript } }),
  )
}

// ---------------------------------------- P1-A: creation/restore consistency

describe("P1-A — a capture that restore would refuse is refused at creation", () => {
  stest("two logical paths for the same physical file block the restorable capture", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "capitulos/cap1.tex", "CONTEUDO-CAP1")
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-collide" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toMatch(/collide/)
    expect(text).toMatch(/main\.tex/)
    expect(text).toMatch(/capitulos\/cap1\.tex/)
    // the physical collision is refused before the snapshot is registered
    expect(existsSync(snapDirOf(project, "s-collide"))).toBe(false)
    expect(existsSync(manifestPathOf(project, "s-collide"))).toBe(false)
    expectUnchanged(project, before)
  })

  stest("collision with identical content is refused by the creation policy", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "capitulos/cap1.tex", "MESMO-CONTEUDO")
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-dup" }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(String(result)).not.toContain("snapshot →")
    expect(String(result)).toMatch(/collide/)
    expectUnchanged(project, before)
  })

  test("two independent physical files are a valid restorable capture", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "FREE-MAIN-V1")
    write(project, "capitulos/cap1.tex", "FREE-CAP-V1")

    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s-free" }, {} as any)
    expect(String(snap)).toContain("snapshot →")
    expect(stateLabels(project)).toEqual(["s-free"])
    expect(manifestOf(project, "s-free").kind).toBe("restorable")

    write(project, "main.tex", "FREE-MAIN-V2")
    write(project, "capitulos/cap1.tex", "FREE-CAP-V2")
    const restore = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-free", confirm: true }, {} as any)

    expect(String(restore)).toContain("restored from s-free")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("FREE-MAIN-V1")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("FREE-CAP-V1")
  })

  stest("an internal symlink without collision is captured and restored", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "texto/main.tex", "LINK-V1")
    symlinkSync("texto/main.tex", join(project, "main.tex"))
    write(project, "capitulos/cap1.tex", "LINK-C1")

    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s-link" }, {} as any)
    expect(String(snap)).toContain("snapshot →")

    write(project, "texto/main.tex", "LINK-V2")
    write(project, "capitulos/cap1.tex", "LINK-C2")
    const restore = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-link", confirm: true }, {} as any)

    expect(String(restore)).toContain("restored from s-link")
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(project, "main.tex"))).toBe("texto/main.tex")
    expect(readFileSync(join(project, "texto", "main.tex"), "utf8")).toBe("LINK-V1")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("LINK-C1")
  })

  stest("an external main symlink blocks the capture and the external file is untouched", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(external, "target.tex", "EXTERNAL-KEEP")
    symlinkSync(join(external, "target.tex"), join(project, "main.tex"))
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-ext" }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(String(result)).not.toContain("snapshot →")
    expectUnchanged(project, before)
    expect(readFileSync(join(external, "target.tex"), "utf8")).toBe("EXTERNAL-KEEP")
  })

  stest("a rejected capture does not invalidate or modify an existing recovery point", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "GOOD-V1")
    write(project, "capitulos/cap1.tex", "GOOD-C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-keep" }, {} as any)

    // the project is reorganized so every further capture would collide
    rmSync(join(project, "main.tex"))
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))
    const vaultBefore = vaultTree(project)
    const stateBefore = stateBytes(project)

    const rejected = await bancaSnapshot.execute({ projectRoot: project, label: "s-keep-2" }, {} as any)
    expect(String(rejected)).toContain("blocked")
    expect(String(rejected)).not.toContain("snapshot →")

    // nothing changed in the vault or the registry
    expect(vaultTree(project)).toEqual(vaultBefore)
    expect(stateBytes(project)).toBe(stateBefore)
    expect(stateLabels(project)).toEqual(["s-keep"])

    // the preserved recovery point still restores its own version once the
    // project layout is compatible again (the collision existed only for the
    // rejected capture)
    rmSync(join(project, "main.tex"))
    write(project, "main.tex", "CURRENT-MAIN")
    write(project, "capitulos/cap1.tex", "MUTATED")
    const restored = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-keep", confirm: true }, {} as any)
    expect(String(restored)).toContain("restored from s-keep")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("GOOD-C1")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("GOOD-V1")
  })
})

// ------------------------------------------------ P1-B: mandatory main file

describe("P1-B — a restorable capture always carries its mandatory main file", () => {
  test("an absent main file blocks the capture and registers nothing", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "capitulos/cap1.tex", "ONLY-CHAPTER")
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-nomain" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(text).toMatch(/main\.tex/)
    expect(text).toMatch(/not found/)
    expect(existsSync(snapDirOf(project, "s-nomain"))).toBe(false)
    expect(existsSync(manifestPathOf(project, "s-nomain"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
    expectUnchanged(project, before)
  })

  stest("a broken main symlink blocks the capture without residue", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "capitulos/cap1.tex", "CHAPTER")
    symlinkSync("texto/ghost.tex", join(project, "main.tex"))
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-broken" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(existsSync(snapDirOf(project, "s-broken"))).toBe(false)
    expect(stateLabels(project)).toEqual([])
    expectUnchanged(project, before)
  })

  stest("a main redirected into .banca/ blocks the capture and preserves the target", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, ".banca/notes.txt", "INTERNAL-NOTES")
    symlinkSync(".banca/notes.txt", join(project, "main.tex"))
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-internal" }, {} as any)
    const text = String(result)

    expect(text).toContain("blocked")
    expect(text).not.toContain("snapshot →")
    expect(readFileSync(join(project, ".banca", "notes.txt"), "utf8")).toBe("INTERNAL-NOTES")
    expectUnchanged(project, before)
  })

  test("a rejected capture blocks nothing: the same label succeeds once main exists", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    write(project, "capitulos/cap1.tex", "CHAPTER")

    const rejected = await bancaSnapshot.execute({ projectRoot: project, label: "retry" }, {} as any)
    expect(String(rejected)).toContain("blocked")

    // legitimate fix of the manuscript condition
    write(project, "main.tex", "MAIN-NOW-PRESENT")
    const accepted = await bancaSnapshot.execute({ projectRoot: project, label: "retry" }, {} as any)

    expect(String(accepted)).toContain("snapshot →")
    expect(stateLabels(project)).toEqual(["retry"])
    expect(readFileSync(join(snapDirOf(project, "retry"), "main.tex"), "utf8")).toBe("MAIN-NOW-PRESENT")
    expect(readFileSync(join(snapDirOf(project, "retry"), "capitulos", "cap1.tex"), "utf8")).toBe("CHAPTER")
  })

  test("an absent optional bibliography is explicit and does not block the capture", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    writeConfig(project, {})
    write(project, "main.tex", "MAIN-V1")
    write(project, "capitulos/cap1.tex", "CAP-V1")

    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s-nobib" }, {} as any)
    const text = String(snap)

    expect(text).toContain("snapshot →")
    expect(text).toContain("referencias.bib")
    const manifest = manifestOf(project, "s-nobib")
    expect(manifest.kind).toBe("restorable")
    expect(manifest.missing).toContain("referencias.bib")
    expect(manifest.files.map((f: any) => f.logical).sort()).toEqual(["capitulos/cap1.tex", "main.tex"])

    // the absence is reported at restore time instead of being invented
    write(project, "main.tex", "MAIN-V2")
    write(project, "capitulos/cap1.tex", "CAP-V2")
    const restore = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-nobib", confirm: true }, {} as any)
    const restoreText = String(restore)

    expect(restoreText).toContain("restored from s-nobib")
    expect(restoreText).toContain("Not in snapshot")
    expect(restoreText).toContain("referencias.bib")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("MAIN-V1")
    expect(existsSync(join(project, "referencias.bib"))).toBe(false)
  })

  test("incomplete chapter discovery keeps blocking the capture", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    writeConfig(project, { chapters: ["../evil/*.tex"] })
    write(project, "main.tex", "MAIN")
    const before = fingerprint(project)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "s-discovery" }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(String(result)).not.toContain("snapshot →")
    expect(existsSync(snapDirOf(project, "s-discovery"))).toBe(false)
    expectUnchanged(project, before)
  })
})

// --------------------------------------------- kind semantics: marker/partial

describe("snapshot kind semantics", () => {
  test("a loop marker is preserved and declares itself non-restorable", async () => {
    const { bancaLoop } = await import("../src/tools/banca_loop")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "Conteudo sem citacao para pontuar baixo.")

    const loop = await bancaLoop.execute({ projectRoot: project }, {} as any)
    const label = String(loop).match(/Snapshot: (\S+)/)?.[1]
    expect(label).toBeTruthy()
    const loopLabel = label as string

    // the marker is registered (process milestone) and explicitly a marker
    expect(stateLabels(project)).toEqual([loopLabel])
    const manifest = manifestOf(project, loopLabel)
    expect(manifest.kind).toBe("marker")
    expect(manifest.files).toEqual([])
    const markerBefore = vaultTree(project)
    const stateBefore = stateBytes(project)

    const restore = await bancaRestore.execute({ projectRoot: project, snapshotId: loopLabel, confirm: true }, {} as any)
    const text = String(restore)

    expect(text).toContain("blocked")
    expect(text).not.toContain("restored from")
    expect(text).toMatch(/marker/)
    // a refused restore leaves the marker and the registry untouched
    expect(vaultTree(project)).toEqual(markerBefore)
    expect(stateBytes(project)).toBe(stateBefore)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("Conteudo sem citacao para pontuar baixo.")
  })

  test("a partial pre-correction capture never promises a full restore", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    writeConfig(project, {})
    write(project, "main.tex", "MAIN-INTACT")
    write(project, "capitulos/cap1.tex", "CAP-V1")

    const correction = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "capitulos/cap1.tex", oldText: "CAP-V1", newText: "CAP-V2" }] },
      {} as any,
    )
    expect(String(correction)).toContain("✓")

    const partialLabels = readdirSync(snapshotsRoot(project)).filter(
      (n) => n.startsWith("pre-") && lstatSync(join(snapshotsRoot(project), n)).isDirectory(),
    )
    expect(partialLabels.length).toBeGreaterThan(0)
    const partialLabel = partialLabels[0]
    const manifest = manifestOf(project, partialLabel)
    expect(manifest.kind).toBe("partial")
    expect(manifest.files.map((f: any) => f.logical)).toEqual(["capitulos/cap1.tex"])

    // pre-correction snapshots are registered in state.snapshots
    expect(stateLabels(project)).toEqual([partialLabel])

    // when used for a controlled recovery, the partial nature is explicit
    write(project, "capitulos/cap1.tex", "CAP-V3")
    const restore = await bancaRestore.execute({ projectRoot: project, snapshotId: partialLabel, confirm: true }, {} as any)
    const text = String(restore)

    expect(text).toContain(`restored from ${partialLabel}`)
    expect(text).toMatch(/partial/i)
    expect(restoredEntries(text)).toEqual(["capitulos/cap1.tex"])
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("CAP-V1")
    // the untouched manuscript file was never rewritten by the partial restore
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("MAIN-INTACT")
  })

  test("a pre-restore backup of a complete state is a restorable recovery point", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    write(project, "main.tex", "BK-V1")
    write(project, "capitulos/cap1.tex", "BK-C1")
    await bancaSnapshot.execute({ projectRoot: project, label: "s-base" }, {} as any)

    write(project, "main.tex", "BK-V2")
    write(project, "capitulos/cap1.tex", "BK-C2")
    const restore = await bancaRestore.execute({ projectRoot: project, snapshotId: "s-base", confirm: true }, {} as any)
    const backupLabel = backupLabelFrom(String(restore))

    expect(manifestOf(project, backupLabel).kind).toBe("restorable")
    expect(String(restore)).not.toMatch(/partial/i)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("BK-V1")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("BK-C1")

    // the backup really returns the project to the pre-restore state
    const back = await bancaRestore.execute({ projectRoot: project, snapshotId: backupLabel, confirm: true }, {} as any)
    expect(String(back)).toContain(`restored from ${backupLabel}`)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("BK-V2")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf8")).toBe("BK-C2")
  })

  test("a legacy manifest without kind keeps the round-3 restore contract", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    write(project, "main.tex", "LEGACY-CURRENT")
    // round-3 manifest: same version, no `kind` field
    mkdirSync(snapDirOf(project, "s-legacy-manifest"), { recursive: true })
    const legacyBytes = Buffer.from("LEGACY-SNAP", "utf8")
    write(project, ".banca/snapshots/s-legacy-manifest/main.tex", "LEGACY-SNAP")
    writeFileSync(
      manifestPathOf(project, "s-legacy-manifest"),
      JSON.stringify({
        version: 1,
        label: "s-legacy-manifest",
        createdAt: new Date().toISOString(),
        files: [{ logical: "main.tex", sha256: sha256(legacyBytes), size: legacyBytes.length }],
        missing: ["referencias.bib"],
        skipped: [],
      }),
    )
    addSnapshot(project, "s-legacy-manifest", null)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-legacy-manifest", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("restored from s-legacy-manifest")
    expect(String(result)).not.toMatch(/partial/i)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("LEGACY-SNAP")
  })

  test("a legacy manifest that omits main is still refused", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { addSnapshot } = await import("../src/lib/state")
    write(project, "main.tex", "CURRENT-MAIN")
    const chapterBytes = Buffer.from("LEGACY-CHAPTER", "utf8")
    write(project, ".banca/snapshots/s-legacy-nomain/capitulos/cap1.tex", "LEGACY-CHAPTER")
    writeFileSync(
      manifestPathOf(project, "s-legacy-nomain"),
      JSON.stringify({
        version: 1,
        label: "s-legacy-nomain",
        createdAt: new Date().toISOString(),
        files: [{ logical: "capitulos/cap1.tex", sha256: sha256(chapterBytes), size: chapterBytes.length }],
        missing: ["main.tex"],
        skipped: [],
      }),
    )
    addSnapshot(project, "s-legacy-nomain", null)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-legacy-nomain", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(String(result)).not.toContain("restored from")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("CURRENT-MAIN")
  })
})

// --------------------------------------------------------- integrated proof

describe("integrated proof: synthetic LaTeX/BibTeX project", () => {
  const MAIN = [
    "\\documentclass{article}",
    "\\begin{document}",
    "\\input{capitulos/cap1}",
    "\\bibliographystyle{plain}",
    "\\bibliography{referencias}",
    "\\end{document}",
  ].join("\n")
  const CHAPTER = "\\section{Introducao}\nTexto academico de teste.\n"
  const BIB = "@book{teste,\n  title = {Obra de Teste},\n  author = {Autor, A.},\n  year = {2024}\n}\n"

  stest("snapshot -> modification -> restore preserves contents, hashes and layout", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    writeConfig(project, {})
    // typical layout: the configured main is an internal symlink
    write(project, "texto/main.tex", MAIN)
    symlinkSync("texto/main.tex", join(project, "main.tex"))
    write(project, "capitulos/cap1.tex", CHAPTER)
    write(project, "referencias.bib", BIB)
    write(external, "untouched.txt", "EXTERNAL")

    const expectedHashes: Record<string, string> = {
      "texto/main.tex": sha256(MAIN),
      "capitulos/cap1.tex": sha256(CHAPTER),
      "referencias.bib": sha256(BIB),
    }

    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "integrated" }, {} as any)
    expect(String(snap)).toContain("snapshot →")
    const manifest = manifestOf(project, "integrated")
    expect(manifest.kind).toBe("restorable")
    expect(manifest.files.map((f: any) => f.logical).sort()).toEqual([
      "capitulos/cap1.tex",
      "main.tex",
      "referencias.bib",
    ])
    // the vault mirrors the logical identity
    expect(readFileSync(join(snapDirOf(project, "integrated"), "main.tex"), "utf8")).toBe(MAIN)

    // modify every manuscript file
    write(project, "texto/main.tex", "\\documentclass{article}\nMODIFICADO\n")
    write(project, "capitulos/cap1.tex", "\\section{Mudou}\nOutro texto.\n")
    write(project, "referencias.bib", "@book{outro, title={Outro}}\n")
    const externalBefore = snapshotTree(external)

    const restore = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "integrated", confirm: true },
      {} as any,
    )
    const text = String(restore)

    expect(text).toContain("restored from integrated")
    expect(text).not.toMatch(/blocked|failed|partial/)
    expect(restoredEntries(text).sort()).toEqual([
      "capitulos/cap1.tex",
      "main.tex",
      "referencias.bib",
    ])

    // contents and hashes
    for (const [rel, digest] of Object.entries(expectedHashes)) {
      expect(sha256File(join(project, rel)), rel).toBe(digest)
    }
    // layout (symlink) preserved, logical and physical paths both consistent
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
    expect(readlinkSync(join(project, "main.tex"))).toBe("texto/main.tex")
    expect(sha256File(join(project, "main.tex"))).toBe(expectedHashes["texto/main.tex"])
    expect(snapshotTree(external)).toEqual(externalBefore)

    // the safety backup is a real restorable recovery point
    const backupLabel = backupLabelFrom(text)
    const backup = await bancaRestore.execute({ projectRoot: project, snapshotId: backupLabel, confirm: true }, {} as any)
    expect(String(backup)).toContain(`restored from ${backupLabel}`)
    expect(readFileSync(join(project, "texto", "main.tex"), "utf8")).toContain("MODIFICADO")
  })
})
