/**
 * Focal tests for issue #130 — lexical integrity of `banca_checklist`.
 *
 * Contract of record: issue #130 (leaf of the external audit #109). The tool
 * must only count the three fixed structural markers when they are real LaTeX
 * control words outside unescaped `%` comments. It must keep the historical
 * `Checklist: N/M` header, the failure-item presentation and the six checks
 * (three file/structure checks + three main-file markers), and it must state
 * its own limits: a structural lexical checklist of configured files and fixed
 * markers in the main file only, not compilation, not an exhaustive audit, not
 * ABNT compliance and not academic approval.
 *
 * Every scenario runs the REAL tool (`bancaChecklist.execute`) over synthetic
 * LaTeX/BibTeX under `mkdtempSync(tmpdir())`, removed in `afterEach`. No DSH
 * host, model, network, compilation or real manuscript is involved. SHA-256
 * hashes prove the synthetic manuscript is not mutated.
 *
 * The file also covers issue #132 — canonical read confinement of the same
 * tool. Those scenarios plant external, ancestral, broken and non-regular
 * configured destinations and require a controlled, sanitized
 * `PathTraversalError` before any external byte is read or any academic
 * indicator/count is produced. Internal regular files and internal symlinks
 * remain allowed, and a dedicated proof compares a full recursive inventory
 * (names, types, link targets and SHA-256 of file bytes) before/after.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
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
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { bancaChecklist } from "../src/tools/banca_checklist"
import { PathTraversalError } from "../src/lib/safe_paths"

// ---------------------------------------------------------------------------
// Synthetic workspace
// ---------------------------------------------------------------------------
let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-130-checklist-"))
  project = join(base, "project")
  mkdirSync(project, { recursive: true })
  mkdirSync(join(project, ".banca"), { recursive: true })
})

afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

function writeProjectConfig(overrides: {
  main?: string
  bib?: string
  chapters?: string[]
  root?: string
} = {}): void {
  const config = {
    version: 1,
    manuscript: {
      format: "latex",
      root: overrides.root ?? ".",
      main: overrides.main ?? "main.tex",
      bib: overrides.bib ?? "referencias.bib",
      chapters: overrides.chapters ?? ["capitulos/*.tex"],
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
  writeFileSync(join(project, ".banca", "project.json"), JSON.stringify(config), "utf-8")
}

function writeFile(relativePath: string, content: string): string {
  const path = join(project, relativePath)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content, "utf-8")
  return path
}

function writeMain(content: string): string {
  return writeFile("main.tex", content)
}

function writeBib(): string {
  return writeFile(
    "referencias.bib",
    "@article{sintetica2026, author={Autora Sintética}, title={Título Sintético}, year={2026}}\n",
  )
}

function writeChapter(): string {
  return writeFile("capitulos/capitulo1.tex", "\\chapter{Capítulo sintético}\nTexto sintético.\n")
}

/** Main + BibTeX + chapter exist; the main file content is the variable. */
function seedBookSkeleton(mainContent: string): void {
  writeProjectConfig()
  writeMain(mainContent)
  writeBib()
  writeChapter()
}

/** Run the real tool through its public execution contract (no DSH host). */
async function runChecklist(): Promise<string> {
  const result = await bancaChecklist.execute(
    { projectRoot: project },
    { directory: project } as never,
  )
  return typeof result === "string" ? result : result.output
}

function header(output: string): string {
  return output.split("\n")[0] ?? ""
}

/** Failure lines keep the historical `  ✗ item` presentation. */
function failureItems(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("  ✗ "))
    .map((line) => line.slice("  ✗ ".length))
}

const ALL_MARKERS = ["documentclass", "abstract/resumo", "toc"]

/** Genuine, unambiguous LaTeX structure for the main file. */
const GENUINE_MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\begin{abstract}",
  "Resumo sintético.",
  "\\end{abstract}",
  "\\tableofcontents",
  "\\chapter{Introdução}",
  "\\end{document}",
  "",
].join("\n")

/** The transparency lines every result must carry. */
const EXPECTED_SCOPE_FRAGMENTS = [
  "structural lexical checklist",
  "configured",
  "main file",
  "no macro expansion",
  "verbatim",
  "includes",
  "not LaTeX compilation",
  "not an exhaustive manuscript audit",
  "not ABNT compliance",
  "not approval",
]

// ---------------------------------------------------------------------------
// RED — the two reproductions from issue #130
// ---------------------------------------------------------------------------
describe("issue #130 RED reproductions", () => {
  test("A. markers only inside % comments do not satisfy the three checks (3/6)", async () => {
    seedBookSkeleton(
      [
        "% \\documentclass{article}",
        "% \\begin{abstract}",
        "% \\tableofcontents",
        "",
        "Texto sem estrutura acadêmica.",
        "",
      ].join("\n"),
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual(ALL_MARKERS)
    expect(output).not.toContain("6/6")
  })

  test("B. prefixed command names do not satisfy the three checks (3/6)", async () => {
    seedBookSkeleton(
      "\\documentclassFake{article}\n\\resumoExtra\n\\tableofcontentsFake\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual(ALL_MARKERS)
    expect(output).not.toContain("6/6")
  })
})

// ---------------------------------------------------------------------------
// GREEN — genuine structure stays recognized
// ---------------------------------------------------------------------------
describe("issue #130 genuine markers remain recognized", () => {
  test("all three genuine markers keep 6/6 when main, bib and chapter exist", async () => {
    seedBookSkeleton(GENUINE_MAIN)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 6/6")
    expect(failureItems(output)).toEqual([])
  })

  test("\\begin{abstract} is accepted as the abstract alternative", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\n\\begin{abstract}\nResumo.\n\\end{abstract}\n\\tableofcontents\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("\\resumo is accepted as the abstract alternative", async () => {
    seedBookSkeleton("\\documentclass{article}\n\\resumo\n\\tableofcontents\n")

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("inline comments after genuine commands do not invalidate their presence", async () => {
    seedBookSkeleton(
      [
        "\\documentclass{article} % classe sintética",
        "\\begin{abstract} % resumo sintético",
        "Resumo sintético.",
        "\\end{abstract}",
        "\\tableofcontents % sumário sintético",
        "",
      ].join("\n"),
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("a \\% escape is not a comment start and the following command is recognized", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\n\\begin{abstract}\nResumo.\n\\end{abstract}\nTaxa de 50\\% de conclusão. \\tableofcontents\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("an escaped backslash does not hide a genuine command that follows it", async () => {
    seedBookSkeleton(
      "\\\\quebra de linha sintética\n\\documentclass{article}\n\\begin{abstract}\nR.\n\\end{abstract}\n\\tableofcontents\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("markers are recognized in CRLF main files", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\r\n\\begin{abstract}\r\nResumo.\r\n\\end{abstract}\r\n\\tableofcontents\r\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("normal trivia between \\begin and its argument is supported", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\n\\begin {abstract}\nResumo.\n\\end{abstract}\n\\tableofcontents\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("a marker at the very end of the file is recognized", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\n\\begin{abstract}\nResumo.\n\\end{abstract}\n\\tableofcontents",
    )

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })
})

// ---------------------------------------------------------------------------
// Negative — lexical look-alikes stay rejected
// ---------------------------------------------------------------------------
describe("issue #130 negative lexical cases", () => {
  test("commented markers are not counted even when other markers are genuine", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\n% \\begin{abstract}\n% \\tableofcontents\nTexto comum.\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 4/6")
    expect(failureItems(output)).toEqual(["abstract/resumo", "toc"])
  })

  test("prefixed command names are not counted for any marker", async () => {
    seedBookSkeleton(
      "\\documentclassArticle{article}\n\\begin{abstractExtra}\n\\resumoExtra\n\\tableofcontentsPlus\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual(ALL_MARKERS)
  })

  test("a control symbol followed by text is not the expected command", async () => {
    seedBookSkeleton("\\\\documentclass{article}\n\\\\resumo\n\\\\tableofcontents\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual(ALL_MARKERS)
  })

  test("plain text without any marker does not produce a false positive", async () => {
    seedBookSkeleton("Apenas texto comum, sem comandos estruturais.\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual(ALL_MARKERS)
  })

  test("commented markers in CRLF files are not counted", async () => {
    seedBookSkeleton(
      "% \\documentclass{article}\r\n% \\begin{abstract}\r\n% \\tableofcontents\r\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 3/6")
  })

  test("a comment after an escaped backslash pair starts a real comment", async () => {
    // `\\` is a line break; the `%` that follows is therefore unescaped and
    // starts a comment, so the command on that line is not a marker.
    seedBookSkeleton(
      "\\documentclass{article}\n\\begin{abstract}\nResumo.\n\\end{abstract}\n\\\\% \\tableofcontents\n",
    )

    expect(header(await runChecklist())).toBe("Checklist: 5/6")
  })

  test("\\begin{document} is not mistaken for the abstract environment", async () => {
    seedBookSkeleton("\\documentclass{article}\n\\begin{document}\n\\tableofcontents\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(failureItems(output)).toEqual(["abstract/resumo"])
  })
})

// ---------------------------------------------------------------------------
// Count, failure items and the three existence checks are preserved
// ---------------------------------------------------------------------------
describe("issue #130 preserved counting contract", () => {
  test("partial document keeps the historical denominator and failure list", async () => {
    writeProjectConfig()
    writeMain("% \\documentclass{article}\n% \\begin{abstract}\n% \\tableofcontents\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 1/6")
    expect(failureItems(output)).toEqual([
      "Bib file",
      "Chapters",
      "documentclass",
      "abstract/resumo",
      "toc",
    ])
  })

  test("genuine markers with missing bib and chapters score 4/6 with only file failures", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 4/6")
    expect(failureItems(output)).toEqual(["Bib file", "Chapters"])
  })

  test("main present keeps six checks while main absent keeps the three applicable checks", async () => {
    seedBookSkeleton(GENUINE_MAIN)
    expect(header(await runChecklist())).toBe("Checklist: 6/6")

    rmSync(join(project, "main.tex"))
    expect(header(await runChecklist())).toBe("Checklist: 2/3")
  })

  test("missing main file keeps the reduced denominator and reports markers as not evaluated", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 2/3")
    expect(failureItems(output)).toEqual(["Main file"])
    expect(output).toContain("not evaluated")
    expect(output).toContain("documentclass")
    expect(output).toContain("abstract/resumo")
    expect(output).toContain("toc")
    expect(output).toContain("main file missing")
    // A smaller denominator must never be presented as full coverage.
    expect(output).not.toContain("Checklist: 3/3")
  })
})

// ---------------------------------------------------------------------------
// Transparency of the result
// ---------------------------------------------------------------------------
describe("issue #130 transparency of the returned text", () => {
  test("result states that it is a structural lexical checklist with limits", async () => {
    seedBookSkeleton(GENUINE_MAIN)

    const output = await runChecklist()

    for (const fragment of EXPECTED_SCOPE_FRAGMENTS) {
      expect(output).toContain(fragment)
    }
  })

  test("transparency lines are present even when checks fail", async () => {
    writeProjectConfig()
    writeMain("Texto comum.\n")

    const output = await runChecklist()

    for (const fragment of EXPECTED_SCOPE_FRAGMENTS) {
      expect(output).toContain(fragment)
    }
  })

  test("result never claims ABNT certification, compilation or academic approval", async () => {
    seedBookSkeleton(GENUINE_MAIN)

    const output = (await runChecklist()).toLowerCase()

    // The disclaimers are negations; there is no affirmative compliance claim.
    expect(output).toContain("not abnt compliance")
    expect(output).toContain("not latex compilation")
    expect(output).not.toContain("approved")
    expect(output).not.toContain("certified")
    expect(output).not.toContain("abnt compliant")
    expect(output).not.toContain("compiled")
  })
})

// ---------------------------------------------------------------------------
// Configuration / path resolution contracts are preserved
// ---------------------------------------------------------------------------
describe("issue #130 configuration and path contracts", () => {
  test("default config resolves main.tex, referencias.bib and capitulos/*.tex", async () => {
    writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("custom manuscript paths from project.json are honored", async () => {
    writeProjectConfig({
      main: "documento/principal.tex",
      bib: "biblio/fontes.bib",
      chapters: ["secoes/*.tex"],
    })
    writeFile("documento/principal.tex", GENUINE_MAIN)
    writeFile("biblio/fontes.bib", "@book{sintetica2026, title={Sintético}}\n")
    writeFile("secoes/intro.tex", "\\chapter{Sintético}\n")

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("an unsafe chapter pattern is still rejected by path resolution", async () => {
    writeProjectConfig({ chapters: ["../fora/*.tex"] })
    writeMain(GENUINE_MAIN)
    writeBib()

    await expect(runChecklist()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Read-only behavior
// ---------------------------------------------------------------------------
describe("issue #130 read-only execution", () => {
  function sha256Of(relativePath: string): string {
    return createHash("sha256")
      .update(readFileSync(join(project, relativePath)))
      .digest("hex")
  }

  test("the synthetic manuscript is not mutated and no extra files are created", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()

    const before = {
      main: sha256Of("main.tex"),
      bib: sha256Of("referencias.bib"),
      chapter: sha256Of("capitulos/capitulo1.tex"),
      config: sha256Of(".banca/project.json"),
    }
    const expectedPaths = [
      join(project, ".banca", "project.json"),
      join(project, "capitulos", "capitulo1.tex"),
      join(project, "main.tex"),
      join(project, "referencias.bib"),
    ]
    for (const path of expectedPaths) expect(existsSync(path)).toBe(true)

    await runChecklist()

    expect({
      main: sha256Of("main.tex"),
      bib: sha256Of("referencias.bib"),
      chapter: sha256Of("capitulos/capitulo1.tex"),
      config: sha256Of(".banca/project.json"),
    }).toEqual(before)
    for (const path of expectedPaths) expect(existsSync(path)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Issue #132 — canonical manuscript read confinement
//
// The mantenedor reproduced `Checklist: 6/6` with `main.tex` symlinked to a
// synthetic sibling file outside the workspace. The scenarios below exercise
// the REAL tool over scratch directories and require a sanitized controlled
// error before any external byte is read or any academic indicator is produced.
// No DSH host, model, network or real manuscript is involved. External
// fixtures live beside the scratch workspace and are removed by the same
// `afterEach` teardown; only resources created by these tests are touched.
// ---------------------------------------------------------------------------

const symlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-132-link-probe-"))
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
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-132-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

/**
 * A FIFO would block a `readFileSync`. Its scenario runs the tool in a bounded
 * child process so a regression fails after the timeout instead of hanging the
 * suite, and is skipped in environments without `mkfifo`.
 */
const fifoTest = mkfifoSupported ? stest : test.skip

/** Synthetic token that must never appear in a refusal diagnostic. */
const OUTSIDE_SECRET = "SEGREDO_SINTETICO_EXTERNO_NAO_DEVE_VAZAR"

/** External file with all three structural markers plus the private token. */
const OUTSIDE_MAIN = [
  `% ${OUTSIDE_SECRET}`,
  "\\documentclass{article}",
  "\\begin{document}",
  "\\begin{abstract}",
  "Resumo externo sintético.",
  "\\end{abstract}",
  "\\tableofcontents",
  "\\end{document}",
  "",
].join("\n")

const OUTSIDE_BIB = `@article{externo2026, author={${OUTSIDE_SECRET}}, title={Externo}}\n`

/** Fragments that would prove external markers/content reached a diagnostic. */
const FORBIDDEN_DIAGNOSTIC_FRAGMENTS = [
  OUTSIDE_SECRET,
  "documentclass",
  "abstract/resumo",
  "tableofcontents",
  "Checklist:",
]

/** Write a synthetic fixture beside the workspace (outside the project root). */
function writeExternal(relativePath: string, content: string): string {
  const path = join(base, relativePath)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content, "utf-8")
  return path
}

type ChecklistAttempt = { ok: true; output: string } | { ok: false; error: unknown }

/** Run the real tool and keep both success and refusal observable. */
async function attemptChecklist(): Promise<ChecklistAttempt> {
  try {
    return { ok: true, output: await runChecklist() }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * Fail-closed contract for a blocked configured destination: typed controlled
 * error, sanitized message (no scratch/external absolute path and no synthetic
 * fixture content or checklist count) with no derived academic indicator.
 */
function expectBlockedDestination(attempt: ChecklistAttempt): void {
  expect(attempt.ok).toBe(false)
  if (attempt.ok) return
  expect(attempt.error).toBeInstanceOf(PathTraversalError)
  const message = String((attempt.error as Error).message)
  expect(message.length).toBeGreaterThan(0)
  expect(message).not.toContain(base)
  for (const fragment of FORBIDDEN_DIAGNOSTIC_FRAGMENTS) {
    expect(message).not.toContain(fragment)
  }
}

/**
 * Complete recursive inventory of a scratch tree: relative path -> kind.
 * Directories, symlink targets and SHA-256 of regular-file bytes are recorded,
 * so equality proves nothing was created, removed, rewritten or repointed.
 */
function snapshotTree(rootDir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      const abs = join(dir, entry.name)
      const rel = relative(rootDir, abs).split(sep).join("/")
      const stat = lstatSync(abs)
      if (stat.isSymbolicLink()) {
        snapshot[rel] = `symlink:${readlinkSync(abs)}`
      } else if (stat.isDirectory()) {
        snapshot[rel] = "dir"
        visit(abs)
      } else if (stat.isFile()) {
        snapshot[rel] = `file:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`
      } else {
        snapshot[rel] = "special"
      }
    }
  }
  visit(rootDir)
  return snapshot
}

/** Child script: import the real tool, run it, report refusal as JSON. */
const WORKER_SOURCE = [
  "const toolUrl = process.argv[2]",
  "const project = process.argv[3]",
  "try {",
  "  const mod = await import(toolUrl)",
  "  const result = await mod.bancaChecklist.execute({ projectRoot: project }, { directory: project })",
  '  const output = typeof result === "string" ? result : result.output',
  "  console.log(JSON.stringify({ ok: true, output }))",
  "} catch (error) {",
  '  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))',
  "}",
  "",
].join("\n")

// ---------------------------------------------------------------------------
// RED — the mantenedor reproduction for issue #132
// ---------------------------------------------------------------------------
describe("issue #132 RED — external main symlink reproduction", () => {
  stest("main.tex symlinked to an external sibling with all markers is refused", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()
    const outsideMain = writeExternal("outside.tex", OUTSIDE_MAIN)
    symlinkSync("../outside.tex", join(project, "main.tex"), "file")

    const before = snapshotTree(base)
    const attempt = await attemptChecklist()

    expectBlockedDestination(attempt)
    expect(snapshotTree(base)).toEqual(before)
    expect(readFileSync(outsideMain, "utf-8")).toBe(OUTSIDE_MAIN)
  })
})

// ---------------------------------------------------------------------------
// RED — other unsafe configured destinations
// ---------------------------------------------------------------------------
describe("issue #132 RED — other unsafe configured destinations", () => {
  stest("bibliography symlinked outside is refused before any existence signal", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeChapter()
    writeExternal("outside-refs.bib", OUTSIDE_BIB)
    symlinkSync("../outside-refs.bib", join(project, "referencias.bib"), "file")

    expectBlockedDestination(await attemptChecklist())
  })

  stest("ancestral directory symlinked outside is refused", async () => {
    writeProjectConfig({
      main: "documento/principal.tex",
      bib: "documento/fontes.bib",
      chapters: ["capitulos/*.tex"],
    })
    writeFile("capitulos/capitulo1.tex", "\\chapter{Capítulo sintético}\n")
    writeExternal("outside-documento/principal.tex", OUTSIDE_MAIN)
    writeExternal("outside-documento/fontes.bib", OUTSIDE_BIB)
    symlinkSync("../outside-documento", join(project, "documento"), "dir")

    expectBlockedDestination(await attemptChecklist())
  })

  stest("manuscript root redirected outside is refused without chapter patterns", async () => {
    writeProjectConfig({ root: "raiz-externa", chapters: [] })
    writeExternal("outside-raiz/main.tex", OUTSIDE_MAIN)
    writeExternal("outside-raiz/referencias.bib", OUTSIDE_BIB)
    symlinkSync("../outside-raiz", join(project, "raiz-externa"), "dir")

    expectBlockedDestination(await attemptChecklist())
  })

  stest("manuscript root redirected outside is refused before chapter discovery", async () => {
    writeProjectConfig({ root: "raiz-externa" })
    writeExternal("outside-raiz/main.tex", OUTSIDE_MAIN)
    writeExternal("outside-raiz/referencias.bib", OUTSIDE_BIB)
    symlinkSync("../outside-raiz", join(project, "raiz-externa"), "dir")

    expectBlockedDestination(await attemptChecklist())
  })

  stest("broken main symlink is refused as blocked, not reported as absent", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()
    symlinkSync("../nao-existe/main.tex", join(project, "main.tex"), "file")

    const attempt = await attemptChecklist()
    expectBlockedDestination(attempt)
    if (!attempt.ok) {
      // Legacy absence output must not be reused for a broken link.
      expect(String((attempt.error as Error).message)).not.toContain("2/3")
    }
  })

  stest("broken bibliography symlink is refused as blocked", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeChapter()
    symlinkSync("../nao-existe/referencias.bib", join(project, "referencias.bib"), "file")

    expectBlockedDestination(await attemptChecklist())
  })

  test("non-regular main destination (directory) is refused without reading", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()
    mkdirSync(join(project, "main.tex"), { recursive: true })

    expectBlockedDestination(await attemptChecklist())
  })

  fifoTest(
    "FIFO main destination is refused without a blocking read",
    async () => {
      writeProjectConfig()
      writeBib()
      writeChapter()
      const fifoPath = join(project, "main.tex")
      expect(spawnSync("mkfifo", [fifoPath]).status).toBe(0)

      const workerPath = join(base, "checklist-worker.mjs")
      writeFileSync(workerPath, WORKER_SOURCE, "utf-8")
      const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_checklist.ts")).href
      const outcome = spawnSync(process.execPath, [workerPath, toolUrl, project], {
        timeout: 5000,
        encoding: "utf-8",
      })

      // A correct refusal exits quickly; reading the FIFO would hit the timeout.
      expect(outcome.error).toBeUndefined()
      expect(outcome.signal).toBeNull()
      const jsonLine = (outcome.stdout ?? "")
        .split("\n")
        .reverse()
        .find((line) => line.trim().startsWith("{"))
      expect(jsonLine).toBeDefined()
      const parsed = JSON.parse(jsonLine as string) as { ok: boolean; name?: string; message?: string }
      expect(parsed.ok).toBe(false)
      expect(parsed.name).toBe("PathTraversalError")
      const message = String(parsed.message)
      expect(message).not.toContain(base)
      for (const fragment of FORBIDDEN_DIAGNOSTIC_FRAGMENTS) {
        expect(message).not.toContain(fragment)
      }
    },
    20_000,
  )
})

// ---------------------------------------------------------------------------
// GREEN controls — legitimate reads remain allowed
// ---------------------------------------------------------------------------
describe("issue #132 GREEN controls — legitimate reads remain allowed", () => {
  test("internal regular main, bibliography and chapters still report 6/6", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  stest("internal symlink to an internal main file is allowed", async () => {
    writeProjectConfig()
    writeFile("texto/real-main.tex", GENUINE_MAIN)
    writeBib()
    writeChapter()
    symlinkSync("texto/real-main.tex", join(project, "main.tex"), "file")

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  stest("internal symlink to an internal bibliography is allowed", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeChapter()
    writeFile(
      "bibliografia/real.bib",
      "@article{sintetica2026, author={Autora Sintética}, title={Título Sintético}, year={2026}}\n",
    )
    symlinkSync("bibliografia/real.bib", join(project, "referencias.bib"), "file")

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("custom internal manuscript root is allowed", async () => {
    writeProjectConfig({ root: "manuscrito" })
    writeFile("manuscrito/main.tex", GENUINE_MAIN)
    writeFile("manuscrito/referencias.bib", "@book{sintetica2026, title={Sintético}}\n")
    writeFile("manuscrito/capitulos/capitulo1.tex", "\\chapter{Sintético}\n")

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("truly absent main file keeps the #130 reduced denominator and warning", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()

    const attempt = await attemptChecklist()
    expect(attempt.ok).toBe(true)
    if (!attempt.ok) return
    expect(header(attempt.output)).toBe("Checklist: 2/3")
    expect(attempt.output).toContain("not evaluated")
    expect(attempt.output).toContain("main file missing")
    expect(attempt.output).not.toContain("3/3")
  })

  test("legitimately missing bibliography is reported as a failed check, not blocked", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeChapter()

    const output = await runChecklist()
    expect(header(output)).toBe("Checklist: 5/6")
    expect(failureItems(output)).toEqual(["Bib file"])
  })
})

// ---------------------------------------------------------------------------
// Read-only proof — full recursive inventory and hashes before/after
// ---------------------------------------------------------------------------
describe("issue #132 read-only proof — full inventory before/after", () => {
  stest("refused external main leaves workspace, config, external file and links identical", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()
    writeFile("notas/interno.md", "conteúdo interno sintético\n")
    const outsideMain = writeExternal("outside.tex", OUTSIDE_MAIN)
    symlinkSync("../outside.tex", join(project, "main.tex"), "file")

    const before = snapshotTree(base)
    const attempt = await attemptChecklist()
    expectBlockedDestination(attempt)

    const after = snapshotTree(base)
    expect(after).toEqual(before)
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
    expect(readFileSync(outsideMain, "utf-8")).toBe(OUTSIDE_MAIN)
  })

  stest("allowed internal symlink run leaves the full inventory identical", async () => {
    writeProjectConfig()
    writeFile("texto/real-main.tex", GENUINE_MAIN)
    writeBib()
    writeChapter()
    symlinkSync("texto/real-main.tex", join(project, "main.tex"), "file")

    const before = snapshotTree(base)
    expect(header(await runChecklist())).toBe("Checklist: 6/6")

    expect(snapshotTree(base)).toEqual(before)
  })
})
