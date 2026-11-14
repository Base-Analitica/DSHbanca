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
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { bancaChecklist } from "../src/tools/banca_checklist"

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
