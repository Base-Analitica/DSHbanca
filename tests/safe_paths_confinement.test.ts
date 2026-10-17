/**
 * Symlink confinement — security suite for PR #1 review.
 *
 * Every blocked operation is exercised through the effective tool (not only
 * through the path helper), against externally controlled directories and
 * files whose state (names + contents + links) is asserted unchanged after
 * the attempt. Only temporary directories created by these tests are touched.
 *
 * The helper-level assertions import the module namespace so the suite can be
 * executed before the new canonical helpers exist: undefined helpers fail the
 * helper tests (TypeError) while the tool-level tests fail because the
 * vulnerable operations really escape the workspace (RED), and everything
 * passes once internal destinations are canonicalized against the root (GREEN).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import * as safePaths from "../src/lib/safe_paths"

const { PathTraversalError } = safePaths

const symlinksSupported = (() => {
  try {
    const probe = join(tmpdir(), `dshbanca-link-probe-${process.pid}-${Date.now()}`)
    symlinkSync(tmpdir(), probe)
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
})()

/** Symlink scenarios skip on filesystems without symlink support. */
const stest = symlinksSupported ? test : test.skip

const STATE_JSON = JSON.stringify(
  { currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] },
  null,
  2,
)

let base: string
let project: string
let external: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-confinement-"))
  project = join(base, "project")
  external = join(base, "external")
  mkdirSync(project, { recursive: true })
  mkdirSync(external, { recursive: true })
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content)
  }
}

/** Recursive state snapshot: relative path -> 'dir' | 'symlink' | file content. */
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

describe("safe_paths — canonical containment helpers", () => {
  test("allows '.' and legitimate subdirectories without symlinks", () => {
    expect(safePaths.resolveRealInsideRoot(project, ".")).toBe(realpathSync(project))
    mkdirSync(join(project, "capitulos"))
    expect(safePaths.resolveRealInsideRoot(project, "capitulos")).toBe(realpathSync(join(project, "capitulos")))
  })

  test("rejects traversal segments and absolute paths outside the root", () => {
    expect(() => safePaths.resolveRealInsideRoot(project, "../outside.tex")).toThrow(PathTraversalError)
    expect(() => safePaths.resolveRealInsideRoot(project, join(base, "outside.tex"))).toThrow(PathTraversalError)
    expect(() => safePaths.resolveRealInsideRoot(project, "/etc/passwd")).toThrow(PathTraversalError)
  })

  stest("denies external links, broken links and escaping chains; resolves internal links", () => {
    // external directory link
    symlinkSync(external, join(project, "ext-dir"), "dir")
    expect(() => safePaths.resolveRealInsideRoot(project, "ext-dir")).toThrow(PathTraversalError)
    // external file link
    writeTree(external, { "target.tex": "EXTERNAL" })
    symlinkSync(join(external, "target.tex"), join(project, "ext-file.tex"), "file")
    expect(() => safePaths.resolveRealInsideRoot(project, "ext-file.tex")).toThrow(PathTraversalError)
    // broken link (dangling target)
    symlinkSync(join(base, "missing", "gone.tex"), join(project, "broken.tex"), "file")
    expect(() => safePaths.resolveRealInsideRoot(project, "broken.tex")).toThrow(PathTraversalError)
    // chain: internal link -> external link
    symlinkSync(external, join(project, "hop1"), "dir")
    symlinkSync(join(project, "hop1"), join(project, "hop2"), "dir")
    expect(() => safePaths.resolveRealInsideRoot(project, "hop2")).toThrow(PathTraversalError)
    // entirely internal link resolves to its real target
    mkdirSync(join(project, "real"))
    symlinkSync(join(project, "real"), join(project, "alias"), "dir")
    expect(safePaths.resolveRealInsideRoot(project, "alias")).toBe(realpathSync(join(project, "real")))
  })

  stest("non-existent components stay literal under the canonical root and are created safely", () => {
    const canonicalProject = realpathSync(project)
    expect(safePaths.resolveRealInsideRoot(project, join(project, "novo", "sub", "file.txt"))).toBe(
      join(canonicalProject, "novo", "sub", "file.txt"),
    )
    // non-existent directory under an external link is denied
    symlinkSync(external, join(project, "ext"), "dir")
    expect(() => safePaths.resolveRealInsideRoot(project, join(project, "ext", "agents"))).toThrow(PathTraversalError)
    expect(() => safePaths.ensureRealDirInsideRoot(project, join(project, "ext", "agents"))).toThrow(PathTraversalError)
    // legitimate missing directories are created one level at a time
    const created = safePaths.ensureRealDirInsideRoot(project, join(project, "novo", "sub"))
    expect(created).toBe(join(canonicalProject, "novo", "sub"))
    expect(existsSync(created)).toBe(true)
  })
})

describe("symlink confinement — banca_init", () => {
  stest("denies .dsh pointing outside without any external write", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    writeTree(project, { "main.tex": "conteudo" })
    symlinkSync(external, join(project, ".dsh"), "dir")
    const before = snapshotTree(external)

    const result = await bancaInit.execute({ projectRoot: project }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
    // no partial initialization inside the project either
    expect(existsSync(join(project, ".banca", "project.json"))).toBe(false)
  })

  stest("denies .banca pointing outside without any external write", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    writeTree(project, { "main.tex": "conteudo" })
    symlinkSync(external, join(project, ".banca"), "dir")
    const before = snapshotTree(external)

    const result = await bancaInit.execute({ projectRoot: project }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
    expect(existsSync(join(project, ".dsh", "agents"))).toBe(false)
  })

  test("initializes a legitimate project without symlinks", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    writeTree(project, { "main.tex": "conteudo" })

    const result = await bancaInit.execute({ projectRoot: project }, {} as any)

    expect(String(result)).toContain("assets installed")
    expect(existsSync(join(project, ".banca", "project.json"))).toBe(true)
    expect(existsSync(join(project, ".dsh", "agents"))).toBe(true)
  })

  test("initializes inside a legitimate subdirectory", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    const sub = join(project, "tcc")
    mkdirSync(sub)
    writeTree(sub, { "main.tex": "conteudo" })

    const result = await bancaInit.execute({ projectRoot: sub }, {} as any)

    expect(String(result)).toContain("assets installed")
    expect(existsSync(join(sub, ".banca", "project.json"))).toBe(true)
  })
})

describe("symlink confinement — banca_corrigir", () => {
  stest("denies a manuscript file symlinked to an external file", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    writeTree(external, { "target.tex": "EXTERNAL-ORIGINAL" })
    symlinkSync(join(external, "target.tex"), join(project, "main.tex"), "file")
    const before = snapshotTree(external)

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "EXTERNAL", newText: "TAMPERED" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
    // blocked before any snapshot work
    expect(existsSync(join(project, ".banca", "snapshots"))).toBe(false)
  })

  stest("denies an ancestral directory symlinked outside", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    writeTree(external, { "cap1.tex": "EXTERNAL-CAP" })
    symlinkSync(external, join(project, "capitulos"), "dir")
    const before = snapshotTree(external)

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "capitulos/cap1.tex", oldText: "EXTERNAL", newText: "TAMPERED" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("denies .banca/snapshots escape during the pre-correction snapshot", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    writeTree(project, { "main.tex": "alpha beta" })
    mkdirSync(join(project, ".banca"), { recursive: true })
    symlinkSync(external, join(project, ".banca", "snapshots"), "dir")
    const before = snapshotTree(external)

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "alpha", newText: "gamma" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("alpha beta")
  })

  stest("denies .banca/state.json escape before writing the manuscript", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    writeTree(project, { "main.tex": "alpha beta" })
    mkdirSync(join(project, ".banca"), { recursive: true })
    writeTree(external, { "state.json": STATE_JSON })
    symlinkSync(join(external, "state.json"), join(project, ".banca", "state.json"), "file")
    const before = snapshotTree(external)

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "alpha", newText: "gamma" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe("alpha beta")
  })

  stest("denies a broken symlink at the correction target", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    symlinkSync(join(base, "missing", "gone.tex"), join(project, "main.tex"), "file")

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "a", newText: "b" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(existsSync(join(base, "missing"))).toBe(false)
  })

  test("rejects path traversal with ../", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    writeTree(external, { "x.tex": "EXTERNAL" })

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "../external/x.tex", oldText: "EXTERNAL", newText: "X" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(readFileSync(join(external, "x.tex"), "utf8")).toBe("EXTERNAL")
  })

  stest("allows an entirely internal symlink and writes to its real target", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    writeTree(project, { "texto/main.tex": "alpha beta" })
    symlinkSync(join(project, "texto", "main.tex"), join(project, "main.tex"), "file")

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "alpha", newText: "gamma" }] },
      {} as any,
    )

    expect(String(result)).toContain("✓")
    expect(readFileSync(join(project, "texto", "main.tex"), "utf8")).toBe("gamma beta")
    expect(lstatSync(join(project, "main.tex")).isSymbolicLink()).toBe(true)
  })
})

describe("symlink confinement — banca_snapshot", () => {
  stest("denies .banca/snapshots pointing outside", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    writeTree(project, { "main.tex": "alpha" })
    mkdirSync(join(project, ".banca"), { recursive: true })
    symlinkSync(external, join(project, ".banca", "snapshots"), "dir")
    const before = snapshotTree(external)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "snap-x" }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("denies an external manuscript symlink as snapshot source", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    writeTree(external, { "target.tex": "EXTERNAL-ORIGINAL" })
    symlinkSync(join(external, "target.tex"), join(project, "main.tex"), "file")
    const before = snapshotTree(external)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "snap-y" }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("denies .banca/state.json escape before copying files", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    writeTree(project, { "main.tex": "alpha" })
    mkdirSync(join(project, ".banca"), { recursive: true })
    writeTree(external, { "state.json": STATE_JSON })
    symlinkSync(join(external, "state.json"), join(project, ".banca", "state.json"), "file")
    const before = snapshotTree(external)

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "snap-z" }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("allows an entirely internal .banca/snapshots symlink", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    writeTree(project, { "main.tex": "alpha" })
    mkdirSync(join(project, "internals"), { recursive: true })
    mkdirSync(join(project, ".banca"), { recursive: true })
    symlinkSync(join(project, "internals"), join(project, ".banca", "snapshots"), "dir")

    const result = await bancaSnapshot.execute({ projectRoot: project, label: "internal-live" }, {} as any)

    expect(String(result)).toContain("snapshot →")
    expect(existsSync(join(project, "internals", "internal-live", "main.tex"))).toBe(true)
  })
})

describe("symlink confinement — banca_restore", () => {
  stest("denies an external directory as restore destination without touching external files", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    writeTree(project, { "main.tex": "v1", "capitulos/cap1.tex": "c1" })
    const snap = await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)
    expect(String(snap)).toContain("snapshot →")

    // swap the chapters directory for an external one holding a known file
    rmSync(join(project, "capitulos"), { recursive: true, force: true })
    writeTree(external, { "cap1.tex": "EXTERNAL-KEEP" })
    symlinkSync(external, join(project, "capitulos"), "dir")
    const before = snapshotTree(external)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s1", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("denies .banca/snapshots escape for a registered snapshot", async () => {
    const { bancaRestore } = await import("../src/tools/banca_restore")
    writeTree(project, { "main.tex": "current" })
    mkdirSync(join(project, ".banca"), { recursive: true })
    writeFileSync(
      join(project, ".banca", "state.json"),
      JSON.stringify(
        {
          currentScore: null,
          lastAudit: null,
          lastLoop: null,
          snapshots: [{ id: "evil", label: "s-evil", createdAt: new Date().toISOString(), scoreBefore: null }],
          iterations: [],
        },
        null,
        2,
      ),
    )
    writeTree(external, { "s-evil/main.tex": "EXTERNAL-SNAP" })
    symlinkSync(external, join(project, ".banca", "snapshots"), "dir")
    const before = snapshotTree(external)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s-evil", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("denies an external file as restore destination", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    writeTree(project, { "main.tex": "v1" })
    await bancaSnapshot.execute({ projectRoot: project, label: "s1" }, {} as any)

    rmSync(join(project, "main.tex"))
    writeTree(external, { "target.tex": "EXTERNAL-TARGET" })
    symlinkSync(join(external, "target.tex"), join(project, "main.tex"), "file")
    const before = snapshotTree(external)

    const result = await bancaRestore.execute(
      { projectRoot: project, snapshotId: "s1", confirm: true },
      {} as any,
    )

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })
})

describe("symlink confinement — workspace persistence", () => {
  stest("banca_loop denies .banca/snapshots escape", async () => {
    const { bancaLoop } = await import("../src/tools/banca_loop")
    writeTree(project, { "main.tex": "Conteudo sem citacoes. Outra frase academica." })
    mkdirSync(join(project, ".banca"), { recursive: true })
    symlinkSync(external, join(project, ".banca", "snapshots"), "dir")
    const before = snapshotTree(external)

    const result = await bancaLoop.execute({ projectRoot: project }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("report persistence denies .banca/reports escape", async () => {
    const { bancaContract } = await import("../src/tools/banca_contract")
    writeTree(project, { "main.tex": "alpha" })
    mkdirSync(join(project, ".banca"), { recursive: true })
    symlinkSync(external, join(project, ".banca", "reports"), "dir")
    const before = snapshotTree(external)

    let error: unknown = null
    try {
      await bancaContract.execute({ projectRoot: project, corrections: [], save: true }, {} as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    // controlled error text never exposes the external (private) path
    expect(String((error as Error).message)).not.toContain(external)
    expect(snapshotTree(external)).toEqual(before)
  })

  stest("context pack persistence denies .banca/context escape and keeps the checkpoint", async () => {
    const { bancaContext } = await import("../src/tools/banca_context")
    writeTree(project, { "main.tex": "Conteudo academico de teste." })

    const first = await bancaContext.execute({ projectRoot: project }, {} as any)
    expect(String(first)).toContain("context →")

    rmSync(join(project, ".banca", "context"), { recursive: true, force: true })
    symlinkSync(external, join(project, ".banca", "context"), "dir")
    const before = snapshotTree(external)

    const result = await bancaContext.execute({ projectRoot: project }, {} as any)

    expect(String(result)).toContain("blocked")
    expect(snapshotTree(external)).toEqual(before)
    // legitimate academic checkpoint persistence inside the workspace survives
    expect(existsSync(join(project, ".banca", "analysis"))).toBe(true)
  })
})
