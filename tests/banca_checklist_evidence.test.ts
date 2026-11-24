/**
 * Focal tests for issue #169 — honest evidence contract of `banca_checklist`
 * for modular LaTeX manuscripts.
 *
 * Contract of record: issue #169 (leaf of the external audit #109), authorized
 * base master@c1658f997747e44c1116c028d111846759b38078. The tool keeps a
 * deliberately main-only structural scan: a marker that was not observed in
 * the configured main file must never be presented as an unqualified absence,
 * the result must never claim coverage of the whole work (includes are neither
 * read nor expanded), and an observed lexical occurrence must carry the real
 * line number taken from the scanned text.
 *
 * Before this fix the tool emitted `  ✗ abstract/resumo` for a manuscript whose
 * main.tex contained only `\input{pretextual/resumo}` and whose included file
 * held the abstract — an absolute negative indicator for content the tool never
 * examined. The RED tests below reproduce that failure on the authorized base;
 * the remaining tests pin the corrected evidence contract, the preserved
 * #130/#132/#134 protections and the historical local-check count semantics.
 *
 * All scenarios run the REAL tool (`bancaChecklist.execute`) over synthetic
 * LaTeX/BibTeX scratch trees under `mkdtempSync(tmpdir())`, removed in
 * `afterEach`. No DSH host, model, network, LaTeX compiler or real manuscript is
 * involved. SHA-256 hashes prove the synthetic fixtures are not mutated.
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
import { PathTraversalError } from "../src/lib/safe_paths"

// ---------------------------------------------------------------------------
// Synthetic workspace
// ---------------------------------------------------------------------------
let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-169-checklist-"))
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

type ChecklistAttempt = { ok: true; output: string } | { ok: false; error: unknown }

/** Run the real tool and keep both success and refusal observable. */
async function attemptChecklist(): Promise<ChecklistAttempt> {
  try {
    return { ok: true, output: await runChecklist() }
  } catch (error) {
    return { ok: false, error }
  }
}

// ---------------------------------------------------------------------------
// Result parsing helpers
// ---------------------------------------------------------------------------

function header(output: string): string {
  return output.split("\n")[0] ?? ""
}

function secondLine(output: string): string {
  return output.split("\n")[1] ?? ""
}

/**
 * Objective failures of the configured files/discovery keep the historical
 * `  ✗ item` presentation. Lexical marker observations live in their own
 * qualified section and must never be collected by this helper.
 */
function objectiveFailureItems(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("  ✗ "))
    .map((line) => line.slice("  ✗ ".length))
}

const ALL_MARKERS = ["documentclass", "abstract/resumo", "toc"]

/** Evidence lines for the three fixed markers: `  ✓ ...` observed, `  – ...` not observed. */
function markerEvidenceLines(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("  ✓ ") || line.startsWith("  – "))
}

function markerLabel(line: string): string {
  return line.slice("  ✓ ".length).split(":")[0]?.trim() ?? ""
}

function observedMarkerLabels(output: string): string[] {
  return markerEvidenceLines(output)
    .filter((line) => line.startsWith("  ✓ "))
    .map(markerLabel)
}

function notObservedMarkerLabels(output: string): string[] {
  return markerEvidenceLines(output)
    .filter((line) => line.startsWith("  – "))
    .map(markerLabel)
}

function markerEvidenceLine(output: string, label: string): string {
  const line = markerEvidenceLines(output).find((candidate) => markerLabel(candidate) === label)
  expect(line).toBeDefined()
  return line as string
}

/** 1-based line number reported for an observed marker, or null when absent. */
function reportedLine(output: string, label: string): number | null {
  const match = /\(line (\d+)\)/.exec(markerEvidenceLine(output, label))
  return match ? Number(match[1]) : null
}

// ---------------------------------------------------------------------------
// Synthetic LaTeX fixtures
// ---------------------------------------------------------------------------

/** Genuine structure directly in the main file (lines 1, 3 and 6). */
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

/** Main with a modular structure: the abstract lives only in an included file. */
const MODULAR_ABSTRACT_MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\input{pretextual/resumo}",
  "\\tableofcontents",
  "\\end{document}",
  "",
].join("\n")

/** The included file the tool must NOT treat as examined evidence. */
const INCLUDED_ABSTRACT = [
  "% SENTINELA_RESUMO_INCLUDE_169",
  "\\begin{abstract}",
  "Resumo sintético incluído.",
  "\\end{abstract}",
  "",
].join("\n")

/** Main whose table of contents lives only in an included file. */
const MODULAR_TOC_MAIN = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\input{pretextual/sumario}",
  "\\begin{abstract}",
  "Resumo no arquivo principal.",
  "\\end{abstract}",
  "\\end{document}",
  "",
].join("\n")

const INCLUDED_TOC = ["% SENTINELA_SUMARIO_INCLUDE_169", "\\tableofcontents", ""].join("\n")

/** Sentinel that would prove an included file was read or echoed. */
const INCLUDE_SENTINEL = "SENTINELA_INCLUDE_169_NAO_DEVE_VAZAR"

/** Main content sentinel that must never be echoed in the result text. */
const MAIN_CONTENT_SENTINEL = "SENTINELA_CONTEUDO_MAIN_169"

// ---------------------------------------------------------------------------
// Symlink support probe (refusal scenarios are skipped only without support)
// ---------------------------------------------------------------------------
const symlinksSupported = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-169-link-probe-"))
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

const stest = symlinksSupported ? test : test.skip

/** chmod 000 only denies reads for a non-privileged process. */
const unreadableTestSupported =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0
const unreadableTest = unreadableTestSupported ? test : test.skip

/** Write a synthetic fixture beside the workspace (outside the project root). */
function writeExternal(relativePath: string, content: string): string {
  const path = join(base, relativePath)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, content, "utf-8")
  return path
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

function sha256Of(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex")
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
// RED — issue #169 reproduction: markers only in included files
//
// On the authorized base these scenarios return `  ✗ abstract/resumo` (or
// `  ✗ toc`) even though the file holding the marker was never examined. They
// are the acceptance RED for the fix and must fail for that reason.
// ---------------------------------------------------------------------------
describe("issue #169 RED — markers only in an included file", () => {
  test("abstract/resumo only in an included file is not an unqualified absence", async () => {
    seedBookSkeleton(MODULAR_ABSTRACT_MAIN)
    writeFile("pretextual/resumo.tex", INCLUDED_ABSTRACT)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    // No objective file/discovery failure: the missing markers are not failures.
    expect(objectiveFailureItems(output)).toEqual([])
    // The historical unqualified `✗ abstract/resumo` must be gone.
    expect(output).not.toContain("✗ abstract/resumo")
    // The abstract is declared not observed in the examined scope only.
    const evidence = markerEvidenceLine(output, "abstract/resumo")
    expect(evidence.toLowerCase()).toContain("not observed in the configured main file")
    expect(evidence.toLowerCase()).toContain("indeterminate")
    expect(evidence.startsWith("  ✓ ")).toBe(false)
    // The included file content is never read or echoed.
    expect(output).not.toContain("SENTINELA_RESUMO_INCLUDE_169")
    expect(output).not.toContain(base)
  })

  test("toc only in an included file is not an unqualified absence", async () => {
    seedBookSkeleton(MODULAR_TOC_MAIN)
    writeFile("pretextual/sumario.tex", INCLUDED_TOC)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(objectiveFailureItems(output)).toEqual([])
    expect(output).not.toContain("✗ toc")
    const evidence = markerEvidenceLine(output, "toc")
    expect(evidence.toLowerCase()).toContain("not observed in the configured main file")
    expect(evidence.toLowerCase()).toContain("indeterminate")
    expect(output).not.toContain("SENTINELA_SUMARIO_INCLUDE_169")
    expect(output).not.toContain(base)
  })
})

// ---------------------------------------------------------------------------
// GREEN — genuine markers keep lexical recognition with real provenance
// ---------------------------------------------------------------------------
describe("issue #169 genuine markers keep lexical recognition and provenance", () => {
  test("all three genuine markers keep 6/6 with safe provenance and real lines", async () => {
    seedBookSkeleton(GENUINE_MAIN)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 6/6")
    expect(objectiveFailureItems(output)).toEqual([])
    expect(observedMarkerLabels(output)).toEqual(ALL_MARKERS)
    expect(notObservedMarkerLabels(output)).toEqual([])
    // Line numbers come from the real occurrences in the scanned text.
    expect(reportedLine(output, "documentclass")).toBe(1)
    expect(reportedLine(output, "abstract/resumo")).toBe(3)
    expect(reportedLine(output, "toc")).toBe(6)
    // Provenance is the configured main file, never an absolute host path.
    for (const label of ALL_MARKERS) {
      expect(markerEvidenceLine(output, label)).toContain("configured main file")
    }
    expect(output).not.toContain(base)
    // Lexical recognition is not presented as LaTeX execution or global coverage.
    expect(output.toLowerCase()).toContain("lexical")
    expect(output.toLowerCase()).not.toContain("the work contains")
  })

  test("line numbers point to the genuine occurrence, not to comments or look-alikes", async () => {
    seedBookSkeleton(
      [
        "% \\documentclass{article}",
        "\\documentclass{article}",
        "\\begin {abstract}",
        "Resumo sintético.",
        "\\end{abstract}",
        "\\\\% \\tableofcontents",
        "\\tableofcontents",
        "",
      ].join("\n"),
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 6/6")
    expect(reportedLine(output, "documentclass")).toBe(2)
    expect(reportedLine(output, "abstract/resumo")).toBe(3)
    expect(reportedLine(output, "toc")).toBe(7)
  })

  test("line numbers remain accurate for CRLF main files", async () => {
    seedBookSkeleton(
      "\\documentclass{article}\r\n\\begin{abstract}\r\nResumo.\r\n\\end{abstract}\r\n\\tableofcontents\r\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 6/6")
    expect(reportedLine(output, "documentclass")).toBe(1)
    expect(reportedLine(output, "abstract/resumo")).toBe(2)
    expect(reportedLine(output, "toc")).toBe(5)
  })

  test("line numbers remain accurate for CR-only line endings", async () => {
    // TeX treats a bare CR as a line ending; the reported provenance line must
    // match the real logical line instead of collapsing every marker to line 1.
    seedBookSkeleton(
      "\\documentclass{article}\r\\begin{abstract}\rResumo.\r\\end{abstract}\r\\tableofcontents\r",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 6/6")
    expect(reportedLine(output, "documentclass")).toBe(1)
    expect(reportedLine(output, "abstract/resumo")).toBe(2)
    expect(reportedLine(output, "toc")).toBe(5)
  })

  test("the header keeps the Checklist prefix and the count is declared as local checks", async () => {
    seedBookSkeleton(GENUINE_MAIN)

    const output = await runChecklist()
    const lines = output.split("\n")

    expect(header(output)).toMatch(/^Checklist: \d+\/\d+$/)
    // The clarification is immediate: right after the historical header.
    expect(secondLine(output).toLowerCase()).toContain("local checks")
    expect(lines.join("\n").toLowerCase()).toContain("not a score")
    expect(lines.join("\n").toLowerCase()).toContain("approval")
    expect(lines.join("\n").toLowerCase()).toContain("institutional compliance")
  })
})

// ---------------------------------------------------------------------------
// Main-only scope and indeterminacy — no global conclusions
// ---------------------------------------------------------------------------
describe("issue #169 main-only scope never supports global conclusions", () => {
  test("abntex2 \\begin{resumo} not recognized by the scanner is not an academic absence", async () => {
    seedBookSkeleton(
      [
        "\\documentclass{abntex2}",
        "\\begin{document}",
        "\\begin{resumo}",
        "Resumo sintético.",
        "\\end{resumo}",
        "\\tableofcontents",
        "\\end{document}",
        "",
      ].join("\n"),
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    const evidence = markerEvidenceLine(output, "abstract/resumo")
    expect(evidence.toLowerCase()).toContain("not observed in the configured main file")
    expect(evidence.toLowerCase()).toContain("indeterminate")
    // Nothing in the result may state that the work/manuscript lacks an abstract.
    expect(output.toLowerCase()).not.toContain("lacks")
    expect(output.toLowerCase()).not.toContain("absent from the work")
    expect(output).not.toContain("✗ abstract/resumo")
  })

  test("a nonexistent include is never claimed as covered or as a global absence", async () => {
    seedBookSkeleton(
      [
        "\\documentclass{article}",
        "\\begin{document}",
        "\\input{pretextual/nao-existe.tex}",
        "\\tableofcontents",
        "\\end{document}",
        "",
      ].join("\n"),
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(markerEvidenceLine(output, "abstract/resumo").toLowerCase()).toContain("indeterminate")
    // The included path/content is never echoed or evaluated.
    expect(output).not.toContain("nao-existe")
    expect(output).not.toContain(base)
  })

  test("a main file without explicit includes does not infer whole-work coverage", async () => {
    seedBookSkeleton(GENUINE_MAIN)

    const output = await runChecklist()
    const text = output.toLowerCase()

    expect(text).toContain("main file only")
    expect(text).toContain("includes")
    expect(text).toContain("coverage of the whole work")
    expect(text).not.toContain("the work does not")
    expect(text).not.toContain("manuscript lacks")
  })

  test("an unreferenced file with markers is not counted as examined content", async () => {
    seedBookSkeleton(
      [
        "\\documentclass{article}",
        "\\begin{document}",
        "\\end{document}",
        "",
      ].join("\n"),
    )
    writeFile(
      "extras/nao-referenciado.tex",
      [
        `% ${INCLUDE_SENTINEL}`,
        "\\begin{abstract}",
        "Resumo fora do main.",
        "\\end{abstract}",
        "\\tableofcontents",
        "",
      ].join("\n"),
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 4/6")
    expect(observedMarkerLabels(output)).toEqual(["documentclass"])
    expect(notObservedMarkerLabels(output)).toEqual(["abstract/resumo", "toc"])
    expect(output).not.toContain(INCLUDE_SENTINEL)
    expect(output).not.toContain("nao-referenciado")
  })

  test("markers only in comments remain unobserved in the qualified contract", async () => {
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
    expect(objectiveFailureItems(output)).toEqual([])
    expect(notObservedMarkerLabels(output)).toEqual(ALL_MARKERS)
    expect(output).not.toContain("✗ documentclass")
    expect(output).not.toContain("✗ abstract/resumo")
    expect(output).not.toContain("✗ toc")
  })

  test("look-alike command prefixes remain unobserved in the qualified contract", async () => {
    seedBookSkeleton(
      "\\documentclassFake{article}\n\\resumoExtra\n\\tableofcontentsFake\n",
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 3/6")
    expect(notObservedMarkerLabels(output)).toEqual(ALL_MARKERS)
    expect(output).not.toContain("✗ documentclass")
    expect(output).not.toContain("✗ abstract/resumo")
    expect(output).not.toContain("✗ toc")
  })

  test("markers only in an include never produce a false 100% count", async () => {
    seedBookSkeleton(MODULAR_ABSTRACT_MAIN)
    writeFile("pretextual/resumo.tex", INCLUDED_ABSTRACT)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(output).not.toContain("6/6")
    expect(output).not.toMatch(/100\s*%/)
  })
})

// ---------------------------------------------------------------------------
// Included and external content is never read or exposed
// ---------------------------------------------------------------------------
describe("issue #169 included content is never read, followed or exposed", () => {
  stest("external include paths and symlinked includes do not leak sentinels", async () => {
    seedBookSkeleton(
      [
        "\\documentclass{article}",
        "\\begin{document}",
        "\\input{pretextual/link}",
        "\\input{../fora/resumo-externo}",
        "\\end{document}",
        "",
      ].join("\n"),
    )
    // External file with all markers plus a sentinel; never to be read as evidence.
    const external = writeExternal(
      "fora/resumo-externo.tex",
      [
        `% ${INCLUDE_SENTINEL}`,
        "\\begin{abstract}",
        "Resumo externo sintético.",
        "\\end{abstract}",
        "\\tableofcontents",
        "",
      ].join("\n"),
    )
    // Internal symlink that points to the external file.
    mkdirSync(join(project, "pretextual"), { recursive: true })
    symlinkSync("../../fora/resumo-externo.tex", join(project, "pretextual", "link.tex"), "file")
    const before = sha256Of(external)
    const inventoryBefore = snapshotTree(base)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 4/6")
    expect(observedMarkerLabels(output)).toEqual(["documentclass"])
    expect(notObservedMarkerLabels(output)).toEqual(["abstract/resumo", "toc"])
    expect(output).not.toContain(INCLUDE_SENTINEL)
    expect(output).not.toContain(base)
    expect(sha256Of(external)).toBe(before)
    expect(snapshotTree(base)).toEqual(inventoryBefore)
  })

  unreadableTest("an unreadable include cannot affect the evidence or be required", async () => {
    seedBookSkeleton(MODULAR_ABSTRACT_MAIN)
    const includePath = writeFile("pretextual/resumo.tex", INCLUDED_ABSTRACT)
    chmodSync(includePath, 0o000)
    try {
      // Prove this environment really denies the read before asserting the tool.
      let rawCode: string | undefined
      try {
        readFileSync(includePath, "utf-8")
      } catch (error) {
        rawCode = (error as NodeJS.ErrnoException).code
      }
      expect(rawCode).toBe("EACCES")

      const output = await runChecklist()

      // Unreadable includes are never a refusal nor a failed check: they are
      // simply outside the examined scope, so the lexical evidence is unchanged.
      expect(header(output)).toBe("Checklist: 5/6")
      expect(markerEvidenceLine(output, "abstract/resumo").toLowerCase()).toContain("indeterminate")
      expect(observedMarkerLabels(output)).toEqual(["documentclass", "toc"])
      expect(output).not.toContain("SENTINELA_RESUMO_INCLUDE_169")
      expect(output).not.toContain(base)
    } finally {
      chmodSync(includePath, 0o644)
    }
  })

  test("main content and synthetic sentinels are never echoed by the result", async () => {
    seedBookSkeleton(
      [
        `% ${MAIN_CONTENT_SENTINEL}`,
        "\\documentclass{article}",
        "\\begin{document}",
        `Texto: ${MAIN_CONTENT_SENTINEL}`,
        "\\tableofcontents",
        "\\end{document}",
        "",
      ].join("\n"),
    )

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(output).not.toContain(MAIN_CONTENT_SENTINEL)
    expect(output).not.toContain(base)
  })
})

// ---------------------------------------------------------------------------
// File/discovery failures stay objective and distinct from lexical evidence
// ---------------------------------------------------------------------------
describe("issue #169 file failures remain objective and distinct", () => {
  test("main file absent declares the three markers not evaluated, never absent", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 2/3")
    expect(objectiveFailureItems(output)).toEqual(["Main file"])
    expect(output).toContain("not evaluated")
    expect(output).toContain("main file missing")
    expect(output).toContain("documentclass")
    expect(output).toContain("abstract/resumo")
    expect(output).toContain("toc")
    expect(output).toContain("absence was not established")
    expect(output).not.toContain("✗ documentclass")
    expect(output).not.toContain("✗ abstract/resumo")
    expect(output).not.toContain("✗ toc")
    // The reduced denominator is never presented as full coverage.
    expect(output).not.toContain("Checklist: 3/3")
    expect(markerEvidenceLines(output)).toEqual([])
  })

  test("missing bibliography is an objective file failure, distinct from marker evidence", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeChapter()

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(objectiveFailureItems(output)).toEqual(["Bib file"])
    // The three genuine markers are still observed lexically in main.
    expect(observedMarkerLabels(output)).toEqual(ALL_MARKERS)
    expect(markerEvidenceLines(output)).toHaveLength(3)
    expect(output).not.toContain("✗ abstract/resumo")
  })

  test("missing chapters is an objective discovery failure, not a structural claim", async () => {
    writeProjectConfig()
    writeMain(GENUINE_MAIN)
    writeBib()

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(objectiveFailureItems(output)).toEqual(["Chapters"])
    expect(observedMarkerLabels(output)).toEqual(ALL_MARKERS)
  })
})

// ---------------------------------------------------------------------------
// Relative and custom roots keep the same evidence contract
// ---------------------------------------------------------------------------
describe("issue #169 relative and custom roots keep the same contract", () => {
  test("custom manuscript root keeps the same evidence contract", async () => {
    writeProjectConfig({ root: "manuscrito", chapters: ["capitulos/*.tex"] })
    writeFile("manuscrito/main.tex", GENUINE_MAIN)
    writeFile("manuscrito/referencias.bib", "@book{sintetica2026, title={Sintético}}\n")
    writeFile("manuscrito/capitulos/capitulo1.tex", "\\chapter{Sintético}\n")

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 6/6")
    expect(observedMarkerLabels(output)).toEqual(ALL_MARKERS)
    expect(reportedLine(output, "documentclass")).toBe(1)
    expect(secondLine(output).toLowerCase()).toContain("local checks")
  })

  test("custom root with an include-only marker stays indeterminate", async () => {
    writeProjectConfig({ root: "manuscrito" })
    writeFile("manuscrito/main.tex", MODULAR_ABSTRACT_MAIN)
    writeFile("manuscrito/referencias.bib", "@book{sintetica2026, title={Sintético}}\n")
    writeFile("manuscrito/capitulos/capitulo1.tex", "\\chapter{Sintético}\n")
    writeFile("manuscrito/pretextual/resumo.tex", INCLUDED_ABSTRACT)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(markerEvidenceLine(output, "abstract/resumo").toLowerCase()).toContain("indeterminate")
    expect(output).not.toContain("SENTINELA_RESUMO_INCLUDE_169")
  })

  stest("relative project root reports the same local-check evidence contract", () => {
    const workspace = join(base, "workspace")
    mkdirSync(join(workspace, ".banca"), { recursive: true })
    writeFileSync(
      join(workspace, ".banca", "project.json"),
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

    const workerPath = join(base, "evidence-relative-worker.mjs")
    writeFileSync(workerPath, WORKER_SOURCE, "utf-8")
    const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_checklist.ts")).href
    const outcome = spawnSync(process.execPath, [workerPath, toolUrl, "workspace"], {
      cwd: base,
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
    const parsed = JSON.parse(jsonLine as string) as { ok: boolean; output?: string }
    expect(parsed.ok).toBe(true)
    const output = parsed.output ?? ""
    expect(header(output)).toBe("Checklist: 6/6")
    expect(observedMarkerLabels(output)).toEqual(ALL_MARKERS)
    expect(secondLine(output).toLowerCase()).toContain("local checks")
  })
})

// ---------------------------------------------------------------------------
// Preserved security refusals — no partial checklist, sanitized diagnostics
// ---------------------------------------------------------------------------
describe("issue #169 preserved security refusals", () => {
  /** External configuration that would redirect the checklist to missing.tex. */
  const OUTSIDE_CONFIG = JSON.stringify({
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "missing.tex",
      bib: "referencias.bib",
      chapters: ["capitulos/*.tex"],
      outputDir: "trabalhos",
    },
  })

  function expectSanitizedRefusal(attempt: ChecklistAttempt): void {
    expect(attempt.ok).toBe(false)
    if (attempt.ok) return
    expect(attempt.error).toBeInstanceOf(PathTraversalError)
    const message = String((attempt.error as Error).message)
    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toContain(base)
    expect(message).not.toContain("Checklist:")
    for (const marker of ALL_MARKERS) expect(message).not.toContain(marker)
  }

  stest("insecure configured origin is refused without a checklist", async () => {
    writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()
    const outside = writeExternal("outside-project-169.json", OUTSIDE_CONFIG)
    rmSync(join(project, ".banca", "project.json"), { force: true })
    symlinkSync(outside, join(project, ".banca", "project.json"), "file")
    const inventoryBefore = snapshotTree(base)

    const attempt = await attemptChecklist()

    expectSanitizedRefusal(attempt)
    expect(snapshotTree(base)).toEqual(inventoryBefore)
    expect(readFileSync(outside, "utf-8")).toBe(OUTSIDE_CONFIG)
  })

  stest("external main symlink is still refused without a checklist", async () => {
    writeProjectConfig()
    writeBib()
    writeChapter()
    const outsideMain = writeExternal(
      "outside-main-169.tex",
      ["\\documentclass{article}", "\\begin{abstract}", "R.", "\\end{abstract}", "\\tableofcontents", ""].join("\n"),
    )
    symlinkSync("../outside-main-169.tex", join(project, "main.tex"), "file")
    const inventoryBefore = snapshotTree(base)

    const attempt = await attemptChecklist()

    expectSanitizedRefusal(attempt)
    expect(snapshotTree(base)).toEqual(inventoryBefore)
    expect(readFileSync(outsideMain, "utf-8")).toContain("abstract")
  })

  unreadableTest("unreadable main file fails closed instead of producing partial evidence", async () => {
    // chmod 000 only denies reads for a non-privileged process; the guard above
    // skips this scenario on root/Windows instead of passing vacuously.
    writeProjectConfig()
    const mainPath = writeMain(GENUINE_MAIN)
    writeBib()
    writeChapter()
    chmodSync(mainPath, 0o000)
    try {
      const attempt = await attemptChecklist()
      expectSanitizedRefusal(attempt)
      if (!attempt.ok) {
        expect(String((attempt.error as Error).message)).toContain("could not be read")
      }
    } finally {
      chmodSync(mainPath, 0o644)
    }
  })
})

// ---------------------------------------------------------------------------
// Read-only proof — full recursive inventory and hashes before/after
// ---------------------------------------------------------------------------
describe("issue #169 read-only proof", () => {
  test("modular fixture with includes is not mutated and no file is created", async () => {
    seedBookSkeleton(MODULAR_ABSTRACT_MAIN)
    writeFile("pretextual/resumo.tex", INCLUDED_ABSTRACT)
    writeFile("extras/nao-referenciado.tex", `% ${INCLUDE_SENTINEL}\n\\tableofcontents\n`)
    const inventoryBefore = snapshotTree(base)

    const output = await runChecklist()

    expect(header(output)).toBe("Checklist: 5/6")
    expect(snapshotTree(base)).toEqual(inventoryBefore)
    expect(existsSync(join(project, "pretextual", "resumo.tex"))).toBe(true)
  })
})
