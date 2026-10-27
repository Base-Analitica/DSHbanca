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

describe("symlink confinement — banca_plagio read origin", () => {
  stest("denies relative symlink to external HTML report before reading", async () => {
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    const secretContent = "<table><tr><td>outside_secret.tex</td><td>95</td><td>90</td><td>secret</td></tr></table>"
    writeTree(external, { "report.html": secretContent })
    symlinkSync(join(external, "report.html"), join(project, "evidence.html"), "file")
    const beforeExternal = snapshotTree(external)

    let error: unknown = null
    try {
      await bancaPlagio.execute({ projectRoot: project, reportPath: "evidence.html" }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(external)
    expect(String((error as Error).message)).not.toContain("outside_secret.tex")
    expect(snapshotTree(external)).toEqual(beforeExternal)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("denies absolute symlink to external HTML report before reading", async () => {
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    writeTree(external, { "report.html": "<table><tr><td>sec.tex</td><td>90</td><td>85</td><td>x</td></tr></table>" })
    symlinkSync(join(external, "report.html"), join(project, "evidence_abs.html"), "file")

    let error: unknown = null
    try {
      await bancaPlagio.execute({ projectRoot: project, reportPath: join(project, "evidence_abs.html") }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(external)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("denies broken symlink reportPath before reading", async () => {
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    symlinkSync(join(base, "missing", "gone.html"), join(project, "broken.html"), "file")

    let error: unknown = null
    try {
      await bancaPlagio.execute({ projectRoot: project, reportPath: "broken.html" }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(base)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("denies symlink to external PDF report before invoking pdftotext", async () => {
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    writeTree(external, { "doc.pdf": "%PDF-1.4 dummy" })
    symlinkSync(join(external, "doc.pdf"), join(project, "evidence.pdf"), "file")
    const beforeExternal = snapshotTree(external)

    let error: unknown = null
    try {
      await bancaPlagio.execute({ projectRoot: project, reportPath: "evidence.pdf" }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(external)
    expect(snapshotTree(external)).toEqual(beforeExternal)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("allows internal symlink to legitimate internal HTML report", async () => {
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    const internalContent = "<table><tr><td>capitulo1.tex</td><td>10</td><td>15</td><td>ok</td></tr></table>"
    writeTree(project, {
      "reports_dir/real_report.html": internalContent,
      "main.tex": "\\documentclass{article}\\begin{document}Ola\\end{document}",
    })
    symlinkSync(join(project, "reports_dir", "real_report.html"), join(project, "sym_report.html"), "file")

    const result = await bancaPlagio.execute({ projectRoot: project, reportPath: "sym_report.html" }, { directory: project } as any)
    expect(String(result)).toContain("Plágio — Report")
    expect(String(result)).toContain("capitulo1.tex")
    expect(existsSync(join(project, ".banca", "reports"))).toBe(true)
  })
})

describe("symlink confinement — banca_ia read origin", () => {
  stest("denies external symlink main.tex before reading", async () => {
    const { bancaIa } = await import("../src/tools/banca_ia")
    const secretContent = "Ademais, é imperativo que o segredo externo permaneça confidencial sobremaneira."
    writeTree(external, { "outside_main.tex": secretContent })
    symlinkSync(join(external, "outside_main.tex"), join(project, "main.tex"), "file")
    const beforeExternal = snapshotTree(external)

    let error: unknown = null
    try {
      await bancaIa.execute({ projectRoot: project, forceRegex: true }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(external)
    expect(String((error as Error).message)).not.toContain("segredo externo")
    expect(snapshotTree(external)).toEqual(beforeExternal)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("denies broken symlink main.tex before reading", async () => {
    const { bancaIa } = await import("../src/tools/banca_ia")
    symlinkSync(join(base, "missing", "broken_main.tex"), join(project, "main.tex"), "file")

    let error: unknown = null
    try {
      await bancaIa.execute({ projectRoot: project, forceRegex: true }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(base)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("allows internal symlink to legitimate internal main.tex", async () => {
    const { bancaIa } = await import("../src/tools/banca_ia")
    writeTree(project, {
      "texto/real_main.tex": "\\documentclass{article}\\begin{document}\nAdemais, é imperativo que testemos internamente.\n\\end{document}",
    })
    symlinkSync(join(project, "texto", "real_main.tex"), join(project, "main.tex"), "file")

    const result = await bancaIa.execute({ projectRoot: project, forceRegex: true }, { directory: project } as any)
    expect(String(result)).toContain("IA Detection Report")
    expect(existsSync(join(project, ".banca", "reports"))).toBe(true)
  })
})

describe("symlink confinement — banca_refs read origin", () => {
  stest("denies external symlink referencias.bib before reading", async () => {
    const { bancaRefs } = await import("../src/tools/banca_refs")
    const secretBib = "@article{secret_external_key_2026, author={Classified}, title={Confidential Document}, year={2026}}"
    writeTree(external, { "outside_refs.bib": secretBib })
    writeTree(project, { "main.tex": "\\documentclass{article}\\begin{document}Texto\\end{document}" })
    symlinkSync(join(external, "outside_refs.bib"), join(project, "referencias.bib"), "file")
    const beforeExternal = snapshotTree(external)

    let error: unknown = null
    try {
      await bancaRefs.execute({ projectRoot: project }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(external)
    expect(String((error as Error).message)).not.toContain("secret_external_key_2026")
    expect(snapshotTree(external)).toEqual(beforeExternal)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("denies broken symlink referencias.bib before reading", async () => {
    const { bancaRefs } = await import("../src/tools/banca_refs")
    writeTree(project, { "main.tex": "\\documentclass{article}\\begin{document}Texto\\end{document}" })
    symlinkSync(join(base, "missing", "broken_refs.bib"), join(project, "referencias.bib"), "file")

    let error: unknown = null
    try {
      await bancaRefs.execute({ projectRoot: project }, { directory: project } as any)
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    expect(String((error as Error).message)).not.toContain(base)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  stest("allows internal symlink to legitimate internal referencias.bib", async () => {
    const { bancaRefs } = await import("../src/tools/banca_refs")
    writeTree(project, {
      "main.tex": "\\documentclass{article}\\begin{document}Texto\\end{document}",
      "bibliografia/real.bib": "@article{silva2021, author={Silva, J.}, title={Estudo Academico}, year={2021}}",
    })
    symlinkSync(join(project, "bibliografia", "real.bib"), join(project, "referencias.bib"), "file")

    const result = await bancaRefs.execute({ projectRoot: project }, { directory: project } as any)
    expect(String(result)).toContain("References:")
    expect(existsSync(join(project, ".banca", "reports"))).toBe(true)
  })
})
