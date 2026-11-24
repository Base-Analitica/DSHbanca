/**
 * Focal tests for the evidence contract of `banca_checklist`.
 *
 * Contract of record: issues #130 and #169 (leaves of the external audit
 * #109). The tool must only count the three fixed structural markers when they
 * are real LaTeX control words outside unescaped `%` comments. It keeps the
 * historical `Checklist: N/M` header and the six local checks (three
 * file/structure checks + three main-file marker observations). Since issue
 * #169 the `  ✗ ` presentation is reserved for objective failures of the
 * configured files/discovery: a marker not observed in the main file is
 * qualified scoped evidence ("not observed in the configured main file;
 * presence in the whole work is indeterminate/not evaluated") and never a
 * global absence claim, and the count is declared as local checks, not a
 * score, approval or whole-work coverage. The tool still states its own
 * limits: a structural lexical checklist of configured files and fixed markers
 * in the main file only, not compilation, not an exhaustive audit, not ABNT
 * compliance and not academic approval.
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
import { join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { bancaChecklist } from "../src/tools/banca_checklist"
import { ChapterDiscoveryError } from "../src/lib/paths"
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
  outputDir?: string
} = {}): void {
  const config = {
    version: 1,
    manuscript: {
      format: "latex",
      root: overrides.root ?? ".",
      main: overrides.main ?? "main.tex",
      bib: overrides.bib ?? "referencias.bib",
      chapters: overrides.chapters ?? ["capitulos/*.tex"],
      outputDir: overrides.outputDir ?? "trabalhos",
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

/**
 * Objective failure lines of the configured files/discovery keep the
 * historical `  ✗ item` presentation. Lexical marker observations live in
 * their own qualified section and are never collected here (issue #169): a
 * marker that was not examined cannot become an unqualified failure.
 */
function failureItems(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("  ✗ "))
    .map((line) => line.slice("  ✗ ".length))
}

const ALL_MARKERS = ["documentclass", "abstract/resumo", "toc"]

/** Qualified lexical evidence lines: `  ✓ ` observed, `  – ` not observed in main. */
function markerEvidenceLines(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("  ✓ ") || line.startsWith("  – "))
}

function markerLabel(line: string): string {
  return line.slice("  ✓ ".length).split(":")[0]?.trim() ?? ""
}

function observedMarkers(output: string): string[] {
  return markerEvidenceLines(output)
    .filter((line) => line.startsWith("  ✓ "))
    .map(markerLabel)
}

function notObservedMarkers(output: string): string[] {
  return markerEvidenceLines(output)
    .filter((line) => line.startsWith("  – "))
    .map(markerLabel)
}

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
    // Lexical non-observation is qualified evidence, not an objective failure.
    expect(failureItems(output)).toEqual([])
    expect(observedMarkers(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(ALL_MARKERS)
    expect(output).not.toContain("6/6")
  })

  test("B. prefixed command names do not satisfy the three checks (3/6)", async () => {
    seedBookSkeleton(
      "\\documentclassFake{article}\n\\resumoExtra\n\\tableofcontentsFake\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual([])
    expect(observedMarkers(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(ALL_MARKERS)
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
    expect(failureItems(output)).toEqual([])
    expect(observedMarkers(output)).toEqual(["documentclass"])
    expect(notObservedMarkers(output)).toEqual(["abstract/resumo", "toc"])
  })

  test("prefixed command names are not counted for any marker", async () => {
    seedBookSkeleton(
      "\\documentclassArticle{article}\n\\begin{abstractExtra}\n\\resumoExtra\n\\tableofcontentsPlus\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(ALL_MARKERS)
  })

  test("a control symbol followed by text is not the expected command", async () => {
    seedBookSkeleton("\\\\documentclass{article}\n\\\\resumo\n\\\\tableofcontents\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(ALL_MARKERS)
  })

  test("plain text without any marker does not produce a false positive", async () => {
    seedBookSkeleton("Apenas texto comum, sem comandos estruturais.\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(failureItems(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(ALL_MARKERS)
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
    expect(failureItems(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(["abstract/resumo"])
  })
})

// ---------------------------------------------------------------------------
// Count, failure items and the three existence checks are preserved
// ---------------------------------------------------------------------------
describe("issue #130 preserved counting contract", () => {
  test("partial document keeps the historical denominator and objective failure list", async () => {
    writeProjectConfig()
    writeMain("% \\documentclass{article}\n% \\begin{abstract}\n% \\tableofcontents\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 1/6")
    // Only objective file/discovery failures keep the `  ✗ ` presentation.
    expect(failureItems(output)).toEqual(["Bib file", "Chapters"])
    expect(observedMarkers(output)).toEqual([])
    expect(notObservedMarkers(output)).toEqual(ALL_MARKERS)
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
function expectBlockedDestination(attempt: ChecklistAttempt, extraForbidden: string[] = []): void {
  expect(attempt.ok).toBe(false)
  if (attempt.ok) return
  expect(attempt.error).toBeInstanceOf(PathTraversalError)
  const message = String((attempt.error as Error).message)
  expect(message.length).toBeGreaterThan(0)
  expect(message).not.toContain(base)
  for (const fragment of [...FORBIDDEN_DIAGNOSTIC_FRAGMENTS, ...extraForbidden]) {
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

// ---------------------------------------------------------------------------
// Issue #132 R1 — sanitized diagnostics for lexical refusals and read failures
//
// The mantenedor's independent review reproduced two information exposures at
// the previously approved HEAD: (a) absolute/traversal values of manuscript
// main/bib/outputDir still escaped through the lexical refusal produced by
// `resolveManuscriptPaths`; (b) a regular internal main that the process cannot
// read raised the raw Node error `EACCES: permission denied, open '/abs/path'`.
// These scenarios require a controlled, sanitized refusal: no absolute
// scratch/external path, no raw configured value, no system message or cause,
// no derived checklist and no silent absence/partial result.
// ---------------------------------------------------------------------------

const unreadableTestSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0

/** chmod 000 only denies reads for a non-privileged process. */
const unreadableTest = unreadableTestSupported ? test : test.skip

describe("issue #132 R1 RED — lexical refusal sanitization", () => {
  test("absolute manuscript.main is refused without echoing the configured path", async () => {
    const absoluteMain = join(base, "PRIVATE_SYNTHETIC_MAIN.tex")
    writeProjectConfig({ main: absoluteMain })
    writeBib()
    writeChapter()

    const before = snapshotTree(base)
    const attempt = await attemptChecklist()

    expectBlockedDestination(attempt, [
      absoluteMain,
      "PRIVATE_SYNTHETIC_MAIN",
      "absolute paths are not allowed",
    ])
    if (!attempt.ok) {
      expect(String((attempt.error as Error).message)).toContain("safe workspace-relative path")
    }
    expect(snapshotTree(base)).toEqual(before)
  })

  test("absolute manuscript.bib is refused without echoing the configured path", async () => {
    const absoluteBib = join(base, "PRIVATE_SYNTHETIC_BIB.bib")
    writeProjectConfig({ bib: absoluteBib })
    writeMain(GENUINE_MAIN)
    writeChapter()

    expectBlockedDestination(await attemptChecklist(), [
      absoluteBib,
      "PRIVATE_SYNTHETIC_BIB",
      "absolute paths are not allowed",
    ])
  })

  test("absolute manuscript.outputDir is refused without echoing the configured path", async () => {
    const absoluteOutputDir = join(base, "PRIVATE_SYNTHETIC_OUTPUT")
    writeProjectConfig({ outputDir: absoluteOutputDir })
    writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()

    expectBlockedDestination(await attemptChecklist(), [
      absoluteOutputDir,
      "PRIVATE_SYNTHETIC_OUTPUT",
      "absolute paths are not allowed",
    ])
  })

  test("traversal in manuscript.main is refused without echoing the raw value", async () => {
    writeProjectConfig({ main: "../PRIVATE_SYNTHETIC_TRAVERSAL.tex" })
    writeBib()
    writeChapter()

    const attempt = await attemptChecklist()
    expectBlockedDestination(attempt, ["PRIVATE_SYNTHETIC_TRAVERSAL", "path traversal segments", "../"])
    if (!attempt.ok) {
      expect(String((attempt.error as Error).message)).toContain("safe workspace-relative path")
    }
  })

  test("traversal in manuscript.bib is refused without echoing the raw value", async () => {
    writeProjectConfig({ bib: "../PRIVATE_SYNTHETIC_TRAVERSAL.bib" })
    writeMain(GENUINE_MAIN)
    writeChapter()

    expectBlockedDestination(await attemptChecklist(), [
      "PRIVATE_SYNTHETIC_TRAVERSAL",
      "path traversal segments",
      "../",
    ])
  })
})

describe("issue #132 R1 — preserved controlled diagnostics", () => {
  test("absolute manuscript.root remains sanitized (approved behavior control)", async () => {
    const absoluteRoot = join(base, "PRIVATE_SYNTHETIC_ROOT")
    writeProjectConfig({ root: absoluteRoot })

    const attempt = await attemptChecklist()
    expectBlockedDestination(attempt, [
      absoluteRoot,
      "PRIVATE_SYNTHETIC_ROOT",
      "absolute paths are not allowed",
    ])
    if (!attempt.ok) {
      expect(String((attempt.error as Error).message)).toContain("manuscript root")
    }
  })

  test("ChapterDiscoveryError and its safe diagnostics keep their own contract", async () => {
    writeProjectConfig({ chapters: ["../fora/*.tex"] })
    writeMain(GENUINE_MAIN)
    writeBib()

    const attempt = await attemptChecklist()
    expect(attempt.ok).toBe(false)
    if (attempt.ok) return
    expect(attempt.error).toBeInstanceOf(ChapterDiscoveryError)
    const error = attempt.error as ChapterDiscoveryError
    expect(error.diagnostics.some((diagnostic) => diagnostic.code === "unsafe_pattern")).toBe(true)
    const serialized = `${error.message}\n${JSON.stringify(error.diagnostics)}`
    expect(serialized).not.toContain(base)
    // It must not be mistaken for the generic normalized path refusal.
    expect(serialized).not.toContain("safe workspace-relative path")
  })
})

describe("issue #132 R1 RED — physical read failure sanitization", () => {
  unreadableTest("a verified-present internal main that cannot be read fails closed sanitized", async () => {
    writeProjectConfig()
    const mainPath = writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()
    const before = snapshotTree(base)

    chmodSync(mainPath, 0o000)
    try {
      // Prove this environment really denies the read (non-root with no override).
      let rawCode: string | undefined
      try {
        readFileSync(mainPath, "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      const attempt = await attemptChecklist()
      expectBlockedDestination(attempt, ["EACCES", "permission denied"])
      if (!attempt.ok) {
        const message = String((attempt.error as Error).message)
        // Controlled read refusal, distinct from the boundary refusal and from
        // the raw Node system message/path.
        expect(message).toContain("could not be read")
        expect(message).not.toContain(mainPath)
        expect(message).not.toContain("open '")
      }
    } finally {
      chmodSync(mainPath, 0o644)
    }

    // Nothing was read, written or left behind; original inventory is restored.
    expect(snapshotTree(base)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// Issue #134 — canonical origin boundary for `.banca/project.json`
//
// The mantenedor reproduction: a legitimate synthetic manuscript with an
// external sibling JSON reached `bancaChecklist` through a symlinked
// `.banca/project.json` and changed 6/6 into 2/3. The configuration origin is
// inspected physically before any JSON is consumed, so the refusal happens
// before any `Checklist:` header, count, marker evaluation or fallback.
//
// Fixtures are synthetic scratch trees; external files live beside the
// workspace and are removed by the same `afterEach` teardown. No DSH host,
// model, network, compilation or real manuscript is involved.
// ---------------------------------------------------------------------------

/** Synthetic token placed in the external configuration and never consumed. */
const CONFIG134_SECRET = "SEGREDO_SINTETICO_EXTERNO_NAO_DEVE_VAZAR"

/** External configuration that would redirect the checklist to `missing.tex`. */
const CONFIG134_OUTSIDE = JSON.stringify(
  {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "missing.tex",
      bib: "referencias.bib",
      chapters: ["capitulos/*.tex"],
      outputDir: "trabalhos",
    },
    compile: { enabled: false, command: [] },
    immutableFacts: [CONFIG134_SECRET],
  },
  null,
  2,
)

describe("issue #134 — canonical project configuration origin", () => {
  /** Internal manuscript only; the project configuration comes from elsewhere. */
  function seedInternalManuscript(): void {
    writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()
  }

  function linkExternalConfig(): string {
    const external = writeExternal("outside-project.json", CONFIG134_OUTSIDE)
    rmSync(join(project, ".banca", "project.json"), { force: true })
    symlinkSync(external, join(project, ".banca", "project.json"), "file")
    return external
  }

  stest("external project.json symlink is refused before any checklist output", async () => {
    seedInternalManuscript()
    const external = linkExternalConfig()
    const before = snapshotTree(base)

    const attempt = await attemptChecklist()

    expectBlockedDestination(attempt, [CONFIG134_SECRET, "missing.tex", "2/3", "6/6"])
    expect(snapshotTree(base)).toEqual(before)
    expect(readFileSync(external, "utf-8")).toBe(CONFIG134_OUTSIDE)
  })

  stest("external .banca directory symlink is refused before any checklist output", async () => {
    seedInternalManuscript()
    writeExternal("outside-banca/project.json", CONFIG134_OUTSIDE)
    rmSync(join(project, ".banca"), { recursive: true, force: true })
    symlinkSync(join(base, "outside-banca"), join(project, ".banca"), "dir")

    const attempt = await attemptChecklist()

    expectBlockedDestination(attempt, [CONFIG134_SECRET, "missing.tex", "2/3", "6/6"])
  })

  stest("broken project.json symlink is refused instead of falling back to defaults", async () => {
    seedInternalManuscript()
    symlinkSync("../no-such-dir/project.json", join(project, ".banca", "project.json"), "file")

    const attempt = await attemptChecklist()

    // A broken link is not a legitimate absence: no defaults-based 6/6 output.
    expectBlockedDestination(attempt, ["6/6"])
  })

  test("non-regular project.json destination is refused instead of falling back to defaults", async () => {
    seedInternalManuscript()
    mkdirSync(join(project, ".banca", "project.json"), { recursive: true })

    const attempt = await attemptChecklist()

    expectBlockedDestination(attempt, ["6/6"])
  })

  fifoTest(
    "external FIFO configuration destination is refused without a blocking read",
    async () => {
      seedInternalManuscript()
      mkdirSync(join(base, "outside-fifo"), { recursive: true })
      const fifo = join(base, "outside-fifo", "project.json")
      expect(spawnSync("mkfifo", [fifo]).status).toBe(0)
      rmSync(join(project, ".banca", "project.json"), { force: true })
      symlinkSync(fifo, join(project, ".banca", "project.json"), "file")

      const workerPath = join(base, "config-fifo-worker.mjs")
      writeFileSync(workerPath, WORKER_SOURCE, "utf-8")
      const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_checklist.ts")).href
      const outcome = spawnSync(process.execPath, [workerPath, toolUrl, project], {
        timeout: 5000,
        encoding: "utf-8",
      })

      // A vulnerable implementation would block reading the FIFO until timeout.
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
      for (const fragment of [...FORBIDDEN_DIAGNOSTIC_FRAGMENTS, CONFIG134_SECRET, "2/3", "6/6"]) {
        expect(message).not.toContain(fragment)
      }
    },
    20_000,
  )

  stest("internal symlink to an internal configuration file remains allowed", async () => {
    seedInternalManuscript()
    writeFile(
      "configs/project.json",
      JSON.stringify({
        version: 1,
        manuscript: {
          format: "latex",
          root: ".",
          main: "main.tex",
          bib: "referencias.bib",
          chapters: ["capitulos/*.tex"],
          outputDir: "trabalhos",
        },
      }),
    )
    symlinkSync(join(project, "configs", "project.json"), join(project, ".banca", "project.json"), "file")

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })

  test("internal regular configuration keeps the historical 6/6 result", async () => {
    writeProjectConfig()
    seedInternalManuscript()

    expect(header(await runChecklist())).toBe("Checklist: 6/6")
  })
})

// ---------------------------------------------------------------------------
// Issue #134 R1 — relative project roots
//
// The R1 regression in `readConfigOrigin` made a relative root inspect
// `<root>/<root>/.banca/project.json`, so `bancaChecklist` could consume an
// internal duplicate instead of the true configuration. The real tool is run in
// a bounded child process whose `cwd` is the scratch base, keeping the relative
// resolution faithful to a real local caller. DSH dispatch normally normalizes
// the root; this exercises the library/consumer contract directly.
// ---------------------------------------------------------------------------

describe("issue #134 R1 — relative project root configuration", () => {
  function runChecklistFromRelativeRoot(baseDir: string, root: string): { ok: true; output: string } | { ok: false; name?: string; message?: string } {
    const workerPath = join(baseDir, "checklist-relative-worker.mjs")
    writeFileSync(workerPath, WORKER_SOURCE, "utf-8")
    const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_checklist.ts")).href
    const outcome = spawnSync(process.execPath, [workerPath, toolUrl, root], {
      cwd: baseDir,
      timeout: 10_000,
      encoding: "utf-8",
    })
    expect(outcome.error).toBeUndefined()
    expect(outcome.signal).toBeNull()
    const jsonLine = (outcome.stdout ?? "")
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"))
    expect(jsonLine).toBeDefined()
    return JSON.parse(jsonLine as string)
  }

  function seedRelativeWorkspace(relativeRoot: string, config?: string): string {
    const workspace = join(base, relativeRoot)
    mkdirSync(join(workspace, ".banca"), { recursive: true })
    writeFileSync(
      join(workspace, ".banca", "project.json"),
      config ??
        JSON.stringify({
          version: 1,
          manuscript: {
            format: "latex",
            root: ".",
            main: "documento/principal.tex",
            bib: "biblio/fontes.bib",
            chapters: ["secoes/*.tex"],
            outputDir: "trabalhos",
          },
        }),
      "utf-8",
    )
    mkdirSync(join(workspace, "documento"), { recursive: true })
    mkdirSync(join(workspace, "biblio"), { recursive: true })
    mkdirSync(join(workspace, "secoes"), { recursive: true })
    writeFileSync(join(workspace, "documento", "principal.tex"), GENUINE_MAIN, "utf-8")
    writeFileSync(join(workspace, "biblio", "fontes.bib"), "@book{sintetica2026, title={Sintético}}\n", "utf-8")
    writeFileSync(join(workspace, "secoes", "intro.tex"), "\\chapter{Sintético}\n", "utf-8")
    return workspace
  }

  stest("relative root reads the true custom configuration and reports 6/6", () => {
    seedRelativeWorkspace("workspace")

    const outcome = runChecklistFromRelativeRoot(base, "workspace")
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(header(outcome.output)).toBe("Checklist: 6/6")
    }
  })

  stest("relative root refuses an external true origin despite an internal duplicate", () => {
    seedRelativeWorkspace("workspace")
    // Internal duplicate at the doubly-prefixed destination a broken R1 would read.
    mkdirSync(join(base, "workspace", "workspace", ".banca"), { recursive: true })
    writeFileSync(
      join(base, "workspace", "workspace", ".banca", "project.json"),
      JSON.stringify({
        version: 1,
        manuscript: { main: "missing.tex", bib: "referencias.bib", chapters: ["capitulos/*.tex"] },
      }),
      "utf-8",
    )
    const outside = writeExternal("outside-relative-project.json", CONFIG134_OUTSIDE)
    rmSync(join(base, "workspace", ".banca", "project.json"))
    symlinkSync(outside, join(base, "workspace", ".banca", "project.json"), "file")

    // Materialize the bounded worker before the inventory snapshot so the
    // harness file is part of the stable tree, not a post-snapshot artifact.
    writeFileSync(join(base, "checklist-relative-worker.mjs"), WORKER_SOURCE, "utf-8")
    const before = snapshotTree(base)
    const outcome = runChecklistFromRelativeRoot(base, "workspace")

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.name).toBe("PathTraversalError")
      const message = String(outcome.message)
      expect(message.length).toBeGreaterThan(0)
      expect(message).not.toContain(base)
      for (const fragment of [...FORBIDDEN_DIAGNOSTIC_FRAGMENTS, CONFIG134_SECRET, "nested-decoy", "2/3", "6/6"]) {
        expect(message).not.toContain(fragment)
      }
    }
    expect(snapshotTree(base)).toEqual(before)
  })
})
