/**
 * Issue #168 — zero eligible paragraphs must never be reported as evidence.
 *
 * `analyzeCitationDensity` historically mapped the 0/0 denominator to
 * `percentWithoutCitation = 0` and therefore to `citationScore(0) = 8.0`.
 * `banca_loop` then compared that fabricated 8 with the local target and could
 * persist `loop-heuristic-threshold`/`loop`, write a marker and a report;
 * `banca_corrigir` used the same fabricated 8 as a post-correction regression
 * score. Absence of evidence became evidence of quality.
 *
 * This focal suite drives the real tools hermetically against synthetic LaTeX
 * workspaces in a fresh tmpdir (no network, DSH host, model, real manuscript,
 * LaTeX or CopySpider subprocess). It proves:
 *
 *  1. the analyzer reports a typed insufficiency (no 0/0 score, no NaN/Infinity);
 *  2. `banca_loop` refuses to compare the target or record a score/iteration/
 *     marker/report/marker when the main file has no eligible paragraph, and
 *     states that global coverage is not proven;
 *  3. `banca_corrigir` refuses a requested regression check before snapshot,
 *     state or write when the pre-correction main has no eligible paragraph;
 *  4. a valid correction that leaves zero eligible paragraphs is reported as a
 *     partial outcome (regression unavailable), keeps the real recovery
 *     snapshot restorable, and never claims rollback, improvement or verified
 *     regression;
 *  5. corrections without `previousScore` and sufficient-data corrections keep
 *     their historical behavior and formula (20%, 30%, >30%);
 *  6. negative scenarios are proven by hashes/inventories before and after, not
 *     by error-message wording alone.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { analyzeCitationDensity } from "../src/lib/citation"

// ---------------------------------------------------------------------------
// Hermetic synthetic workspace
// ---------------------------------------------------------------------------

let base: string
let project: string

function projectConfig(options: { targetScore?: number; chapters?: string[] } = {}) {
  return {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "refs.bib",
      chapters: options.chapters ?? ["capitulos/*.tex"],
      outputDir: "trabalhos",
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: ["dados/**", "protegido/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: options.targetScore ?? 9.0,
    providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
    mcp: { crossrefAcademicEnabled: false },
  }
}

function writeConfig(options: { targetScore?: number; chapters?: string[] } = {}): void {
  writeFileSync(
    join(project, ".banca", "project.json"),
    JSON.stringify(projectConfig(options)),
    "utf-8",
  )
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-168-zero-evidence-"))
  project = join(base, "project")
  mkdirSync(join(project, ".banca"), { recursive: true })
  mkdirSync(join(project, "capitulos"), { recursive: true })
  writeConfig()
  writeFileSync(
    join(project, "refs.bib"),
    "@article{autor2020, author={A}, title={T}, year={2020}}\n",
    "utf-8",
  )
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function fileHash(rel: string): string {
  return sha256(readFileSync(join(project, rel)))
}

function writeMain(content: string): void {
  writeFileSync(join(project, "main.tex"), content, "utf-8")
}

function writeChapter(rel: string, content: string): void {
  const abs = join(project, rel)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, content, "utf-8")
}

function statePath(): string {
  return join(project, ".banca", "state.json")
}

function stateHash(): string | null {
  return existsSync(statePath()) ? sha256(readFileSync(statePath())) : null
}

function seedState(currentScore: number, extra: Record<string, unknown> = {}): void {
  writeFileSync(
    statePath(),
    JSON.stringify(
      {
        currentScore,
        lastAudit: null,
        lastLoop: null,
        snapshots: [],
        iterations: [],
        ...extra,
      },
      null,
      2,
    ),
    "utf-8",
  )
}

function readStateJson(): any {
  return JSON.parse(readFileSync(statePath(), "utf-8"))
}

/** Top-level snapshot-vault entries (manifests and snapshot directories). */
function vaultInventory(): string[] {
  const dir = join(project, ".banca", "snapshots")
  if (!existsSync(dir)) return []
  if (!lstatSync(dir).isDirectory()) return ["<non-directory>"]
  return readdirSync(dir).sort()
}

function reportFiles(): string[] {
  const dir = join(project, ".banca", "reports")
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith(".md")).sort()
}

interface Before {
  main: string
  chapter: string
  state: string | null
  vault: string[]
  reports: string[]
}

function captureBefore(main = "main.tex", chapter = "capitulos/cap1.tex"): Before {
  return {
    main: fileHash(main),
    chapter: fileHash(chapter),
    state: stateHash(),
    vault: vaultInventory(),
    reports: reportFiles(),
  }
}

function expectNoMutation(before: Before, main = "main.tex", chapter = "capitulos/cap1.tex"): void {
  expect(fileHash(main)).toBe(before.main)
  expect(fileHash(chapter)).toBe(before.chapter)
  expect(stateHash()).toBe(before.state)
  expect(vaultInventory()).toEqual(before.vault)
  expect(reportFiles()).toEqual(before.reports)
}

async function runLoop(args: Record<string, unknown> = {}): Promise<string> {
  const { bancaLoop } = await import("../src/tools/banca_loop")
  return String(await bancaLoop.execute({ projectRoot: project, ...args } as any, {} as any))
}

async function runCorrection(args: Record<string, unknown>): Promise<string> {
  const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
  return String(await bancaCorrigir.execute({ projectRoot: project, ...args } as any, {} as any))
}

async function runSnapshot(label: string): Promise<string> {
  const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
  return String(await bancaSnapshot.execute({ projectRoot: project, label } as any, {} as any))
}

async function runRestore(snapshotId: string): Promise<string> {
  const { bancaRestore } = await import("../src/tools/banca_restore")
  return String(
    await bancaRestore.execute({ projectRoot: project, snapshotId, confirm: true } as any, {} as any),
  )
}

// ---------------------------------------------------------------------------
// Synthetic inputs required by issue #168
// ---------------------------------------------------------------------------

/** Fixed, sanitized diagnostic required for the insufficient-data branch. */
const INSUFFICIENT_DIAGNOSTIC =
  "Dados insuficientes — análise restrita ao arquivo principal; cobertura global não comprovada."

/** Empty main file: historically 0/0 → percent 0 → score 8.0. */
const MAIN_EMPTY = ""

/** Comments only, separated into blocks that are not meaningful paragraphs. */
const MAIN_COMMENTS_ONLY = "% TODO\n\n% FIXME\n"

/** Fragments that never reach the >20 trimmed characters eligibility rule. */
const MAIN_NO_ELIGIBLE_FRAGMENTS = "Curto.\n\nAinda curto.\n"

/** Main file that only carries include commands short enough to be ineligible. */
const MAIN_INCLUDE_ONLY = "\\input{a}\n\n\\include{b}\n"

/** Realistic modular main: only include commands, never the academic text. */
const MAIN_INCLUDE_REALISTIC =
  "\\input{capitulos/cap1.tex}\n\n\\include{capitulos/cap2.tex}\n"

/** Academic text that lives in an external chapter and is NOT examined. */
function externalChapterAcademic(): string {
  const paragraphs: string[] = []
  for (let index = 1; index <= 10; index++) {
    paragraphs.push(
      `O parágrafo ${index} do capítulo externo discute a fundamentação teórica sem qualquer chamada bibliográfica neste trecho sintético.`,
    )
  }
  return paragraphs.join("\n\n") + "\n"
}

/** Long uncited paragraph: one eligible block, no citation. */
const MAIN_SINGLE_ELIGIBLE =
  "Parágrafo sintético longo com o marcador RASCUNHO que será removido pela correção.\n"

/** Chapter carrying the authorized literal correction target. */
const CHAPTER_WITH_TARGET = "Marcador sintético ORIGINAL que deve ser corrigido.\n"

const CHAPTER_CORRECTION = {
  file: "capitulos/cap1.tex",
  oldText: "ORIGINAL",
  newText: "CORRIGIDO",
  expectedOccurrences: 1,
}

/** Ten meaningful paragraphs, `cited` of them with a citation command. */
function corpus(cited: number, uncited: number): string {
  const paragraphs: string[] = []
  let index = 1
  for (; index <= cited; index++) {
    paragraphs.push(
      `O parágrafo ${index} desenvolve a fundamentação teórica com \\cite{autor2020} no corpo do texto sintético.`,
    )
  }
  for (; index <= cited + uncited; index++) {
    paragraphs.push(
      `O parágrafo ${index} apresenta a síntese parcial do capítulo sem qualquer chamada bibliográfica neste trecho.`,
    )
  }
  return paragraphs.join("\n\n") + "\n"
}

/** Lines that only exist when a measured score/target/iteration was produced. */
const MEASURED_SCORE_MARKERS = [
  "Heuristic citation score:",
  "Current heuristic citation score:",
  "Local heuristic target:",
  "Citations:",
  "Loop iteration",
  "Report:",
  "Snapshot:",
  "✓",
]

function expectNoMeasuredEvaluation(text: string): void {
  for (const marker of MEASURED_SCORE_MARKERS) {
    expect(text).not.toContain(marker)
  }
  // No approval/adequacy claims of any kind.
  expect(text).not.toMatch(/no corrections needed/i)
  expect(text).not.toMatch(/\bapproved\b/i)
  expect(text).not.toMatch(/\baprovado\b/i)
  expect(text).not.toMatch(/adequate/i)
  expect(text).not.toMatch(/target reached/i)
}

// ===========================================================================
// 1. Typed insufficiency in the analyzer
// ===========================================================================
describe("issue #168 — analyzeCitationDensity reports insufficient data instead of 0/0", () => {
  const zeroEvidenceInputs: Array<[string, string]> = [
    ["empty main", MAIN_EMPTY],
    ["comments only", MAIN_COMMENTS_ONLY],
    ["fragments without eligible paragraphs", MAIN_NO_ELIGIBLE_FRAGMENTS],
    ["include-only main without eligible text", MAIN_INCLUDE_ONLY],
    ["whitespace-only main", "   \n\n\t\n"],
  ]

  test.each(zeroEvidenceInputs)("%s: typed insufficiency, no fabricated score", (_label, content) => {
    const result = analyzeCitationDensity(content)

    expect(result.status).toBe("insufficient_data")
    expect(result.totalParagraphs).toBe(0)
    expect(result.citedParagraphs).toBe(0)
    expect(result.paragraphsWithoutCitation).toBe(0)
    // 0/0 is not 0%: there is no measured percentage.
    expect(result.percentWithoutCitation).toBeNull()
    // Absence of evidence is not a heuristic score.
    expect(result.score).toBeNull()
    // No NaN and no Infinity: the insufficient branch reports `null`
    // explicitly instead of a non-finite or fabricated number.
  })

  test("a main file with one eligible paragraph keeps the evaluated contract", () => {
    const result = analyzeCitationDensity(
      "Um parágrafo suficientemente longo com \\cite{autor2020} no meio do texto sintético.",
    )
    expect(result.status).toBe("evaluated")
    expect(result.totalParagraphs).toBe(1)
    expect(result.citedParagraphs).toBe(1)
    expect(result.percentWithoutCitation).toBe(0)
    expect(result.score).toBe(8.0)
  })

  test("historical 20%, 30% and >30% results remain unchanged", () => {
    const twenty = analyzeCitationDensity(corpus(8, 2))
    expect(twenty.status).toBe("evaluated")
    expect(twenty.percentWithoutCitation).toBe(20)
    expect(twenty.score).toBe(8.0)

    const thirty = analyzeCitationDensity(corpus(7, 3))
    expect(thirty.percentWithoutCitation).toBe(30)
    expect(thirty.score).toBe(6.0)

    const aboveThirty = analyzeCitationDensity(corpus(6, 4))
    expect(aboveThirty.percentWithoutCitation).toBeCloseTo(40, 10)
    expect(aboveThirty.score).toBe(4.0)
  })
})

// ===========================================================================
// 2. banca_loop — no threshold comparison, no score, no marker/report/state
// ===========================================================================
describe("issue #168 — banca_loop refuses to evaluate zero eligible paragraphs", () => {
  const loopVariants: Array<[string, string]> = [
    ["empty main.tex", MAIN_EMPTY],
    ["comments-only main.tex", MAIN_COMMENTS_ONLY],
    ["fragments without eligible paragraphs", MAIN_NO_ELIGIBLE_FRAGMENTS],
    ["include-only main.tex", MAIN_INCLUDE_ONLY],
  ]

  test.each(loopVariants)(
    "%s with target 8: explicit insufficiency and no mutation",
    async (_label, mainContent) => {
      writeConfig({ targetScore: 8 })
      writeMain(mainContent)
      writeChapter("capitulos/cap1.tex", externalChapterAcademic())
      const before = captureBefore()

      const result = await runLoop()

      expect(result).toContain(INSUFFICIENT_DIAGNOSTIC)
      expectNoMeasuredEvaluation(result)
      // Modular documents never receive a global-coverage claim.
      expect(result).toContain("main manuscript")
      expect(result).not.toContain("capitulos")
      // Nothing was persisted: no iteration, no score, no marker, no report.
      expectNoMutation(before)
      expect(stateHash()).toBe(before.state)
      expect(vaultInventory()).toEqual([])
      expect(reportFiles()).toEqual([])
    },
  )

  test("threshold at or below 8 (7 and 8) is never treated as reached", async () => {
    for (const target of [7, 8]) {
      writeConfig({ targetScore: target })
      writeMain(MAIN_EMPTY)
      writeChapter("capitulos/cap1.tex", externalChapterAcademic())
      const before = captureBefore()

      const result = await runLoop()

      expect(result).toContain(INSUFFICIENT_DIAGNOSTIC)
      expectNoMeasuredEvaluation(result)
      expectNoMutation(before)
    }
  })

  test("an explicit targetScore argument <= 8 does not bypass the refusal", async () => {
    writeConfig({ targetScore: 9 })
    writeMain(MAIN_INCLUDE_ONLY)
    writeChapter("capitulos/cap1.tex", externalChapterAcademic())
    const before = captureBefore()

    const result = await runLoop({ targetScore: 8 })

    expect(result).toContain(INSUFFICIENT_DIAGNOSTIC)
    expectNoMeasuredEvaluation(result)
    expectNoMutation(before)
  })

  test("seeded state is preserved byte-identically (no iteration, scoreAfter or currentScore)", async () => {
    writeConfig({ targetScore: 8 })
    writeMain(MAIN_INCLUDE_ONLY)
    writeChapter("capitulos/cap1.tex", externalChapterAcademic())
    seedState(6.0)
    const before = captureBefore()

    const result = await runLoop()

    expect(result).toContain(INSUFFICIENT_DIAGNOSTIC)
    expect(stateHash()).toBe(before.state)
    const state = readStateJson()
    expect(state.currentScore).toBe(6.0)
    expect(state.iterations).toEqual([])
    expect(state.snapshots).toEqual([])
    expect(vaultInventory()).toEqual([])
    expect(reportFiles()).toEqual([])
  })

})


  // MINOR-1 (revisão adversarial): the canonical circuit breakers are evaluated
  // before the main manuscript read/analysis and remain authoritative. With a
  // historical stagnation they interrupt the process and record their own
  // `failed` interruption based on the PREVIOUS scores, so the insufficiency
  // diagnostic is not reached. This test fixes that preserved precedence; it
  // fabricates no new score and produces no marker/report/snapshot.
  test("preserved circuit breaker precedence: stagnation interrupts before the insufficient-data diagnostic", async () => {
    writeConfig({ targetScore: 8 })
    writeMain(MAIN_EMPTY)
    writeChapter("capitulos/cap1.tex", externalChapterAcademic())
    seedState(8.0, {
      iterations: [1, 2, 3].map((index) => ({
        date: `2026-01-0${index}T00:00:00.000Z`,
        action: "loop",
        scoreBefore: index === 1 ? null : 8,
        scoreAfter: 8,
        status: "ok",
      })),
    })
    const before = captureBefore()

    const result = await runLoop()

    expect(result).toContain("circuit breaker: last 3 loops same score")
    expect(result).not.toContain(INSUFFICIENT_DIAGNOSTIC)
    const state = readStateJson()
    expect(state.iterations).toHaveLength(4)
    const interruption = state.iterations[3]
    expect(interruption.action).toBe("loop-circuit-break")
    expect(interruption.status).toBe("failed")
    // Only the historical recorded score is echoed; no new evaluation value.
    expect(interruption.scoreAfter).toBe(8)
    expect(state.currentScore).toBe(8)
    // Still no manuscript/report/vault artifact for an evaluation.
    expect(fileHash("main.tex")).toBe(before.main)
    expect(fileHash("capitulos/cap1.tex")).toBe(before.chapter)
    expect(vaultInventory()).toEqual([])
    expect(reportFiles()).toEqual([])
  })

// ===========================================================================
// 2b. Preserved behavior (NOT a #168 RED case): realistic modular main files
// whose include commands are themselves eligible text keep the pre-existing
// main-only caveat. The scope of #168 is the zero-denominator case only; these
// assertions pass on the base commit too and exist to keep the caveat honest.
// ===========================================================================
describe("issue #168 — realistic modular main keeps the pre-existing main-only caveat", () => {
  test("external academic chapter is neither scanned nor claimed as covered", async () => {
    writeConfig({ targetScore: 8 })
    writeMain(MAIN_INCLUDE_REALISTIC)
    writeChapter("capitulos/cap1.tex", externalChapterAcademic())
    writeChapter("capitulos/cap2.tex", externalChapterAcademic())

    const result = await runLoop()

    // Realistic include lines are eligible text for the lexical heuristic, but
    // the operation is still main-only and never claims integral coverage.
    expect(result).not.toMatch(/integral coverage is proven/i)
    expect(result).not.toMatch(/global coverage (is )?(proven|verified)/i)
    expect(result).toContain("main manuscript only")
    // External chapters were not read or changed by the loop.
    expect(fileHash("capitulos/cap1.tex")).toBe(sha256(externalChapterAcademic()))
  })
})

// ===========================================================================
// 3. banca_corrigir — scenario 1: previousScore + pre-correction insufficiency
// ===========================================================================
describe("issue #168 — banca_corrigir refuses a regression check without pre-correction evidence", () => {
  const preInsufficient: Array<[string, string]> = [
    ["empty main.tex", MAIN_EMPTY],
    ["comments-only main.tex", MAIN_COMMENTS_ONLY],
    ["include-only main.tex", MAIN_INCLUDE_ONLY],
    ["short fragments", MAIN_NO_ELIGIBLE_FRAGMENTS],
  ]

  test.each(preInsufficient)(
    "%s: blocked before snapshot, state or write",
    async (_label, mainContent) => {
      writeMain(mainContent)
      writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)
      seedState(6.0)
      const before = captureBefore()

      const result = await runCorrection({
        corrections: [CHAPTER_CORRECTION],
        previousScore: 6,
      })

      expect(result).toContain("blocked")
      expect(result).not.toContain("✓")
      expect(result.toLowerCase()).toContain("insufficient")
      expect(result).toContain("no snapshot, state entry or manuscript file was written")
      expect(result).not.toContain("⚠")
      // Proven by bytes/inventory, not only by the message.
      expectNoMutation(before)
      expect(vaultInventory()).toEqual([])
    },
  )

  test("an existing snapshot vault is preserved untouched on refusal", async () => {
    writeMain(MAIN_INCLUDE_ONLY)
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)
    await runSnapshot("seed-vault-168")
    seedState(6.0)
    const before = captureBefore()

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION],
      previousScore: 6,
    })

    expect(result).toContain("blocked")
    expect(result.toLowerCase()).toContain("insufficient")
    expectNoMutation(before)
    expect(vaultInventory()).toEqual(before.vault)
  })
})

// ===========================================================================
// 4. banca_corrigir — scenario 2: correction eliminates all eligible paragraphs
// ===========================================================================
describe("issue #168 — correction that erases the eligible denominator is partial", () => {
  test("post-correction insufficiency: partial, recovery preserved, no fake regression", async () => {
    writeMain(MAIN_SINGLE_ELIGIBLE)
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)
    seedState(6.0)

    const result = await runCorrection({
      corrections: [
        {
          file: "main.tex",
          oldText: "Parágrafo sintético longo com o marcador RASCUNHO que será removido pela correção.",
          newText: "Curto.",
          expectedOccurrences: 1,
        },
      ],
      previousScore: 4,
    })

    // Partial outcome: the mutation happened, the regression is unavailable.
    expect(result).toContain("partial:")
    expect(result).toContain("✓ main.tex")
    expect(result).toContain("regression check could not be verified")
    expect(result.toLowerCase()).toContain("insufficient")
    expect(result).toContain("no automatic rollback was performed")
    expect(result).not.toContain("⚠")
    expect(result).toMatch(/no eligible paragraph/i)
    // No fabricated score, no improvement or verified-regression claim.
    expect(result).not.toContain("score dropped")
    expect(result).not.toMatch(/Current heuristic citation score: 8/)

    // The manuscript was really modified (short fragment now has no eligible paragraph).
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("Curto.\n")

    // State records an honest failed iteration: no scoreAfter value.
    const state = readStateJson()
    const entry = state.iterations[state.iterations.length - 1]
    expect(entry.action).toBe("correction")
    expect(entry.status).toBe("failed")
    expect(entry.scoreAfter).toBeNull()
    expect(state.currentScore).toBe(6.0)

    // The real pre-correction snapshot is registered...
    expect(state.snapshots).toHaveLength(1)
    const label = state.snapshots[0].label
    expect(vaultInventory().length).toBeGreaterThan(0)

    // ...and restores the original bytes through the public contract.
    const restored = await runRestore(label)
    expect(restored).toContain(`restored from ${label}`)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(MAIN_SINGLE_ELIGIBLE)
  })
})

// ===========================================================================
// 5. Preserved historical behavior
// ===========================================================================
describe("issue #168 — historical correction behavior is preserved", () => {
  test("scenario 3: no previousScore keeps the existing behavior even without evidence", async () => {
    writeMain(MAIN_NO_ELIGIBLE_FRAGMENTS)
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)
    const mainHash = fileHash("main.tex")

    const result = await runCorrection({ corrections: [CHAPTER_CORRECTION] })

    expect(result).toContain("✓ capitulos/cap1.tex")
    expect(result).not.toContain("regression")
    expect(result).not.toContain("partial:")
    expect(fileHash("main.tex")).toBe(mainHash)
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toBe(
      CHAPTER_WITH_TARGET.replace("ORIGINAL", "CORRIGIDO"),
    )
    const state = readStateJson()
    const entry = state.iterations[state.iterations.length - 1]
    expect(entry.action).toBe("correction")
    expect(entry.status).toBe("ok")
    expect(entry.scoreAfter).toBeNull()
  })

  test("scenario 4: sufficient data before and after keeps formula and regression check", async () => {
    writeMain(corpus(8, 2)) // 20% without citation → 8.0
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION],
      previousScore: 8,
    })

    expect(result).toContain("✓ capitulos/cap1.tex")
    expect(result).not.toContain("⚠")
    expect(result).not.toContain("partial:")
    const state = readStateJson()
    const entry = state.iterations[state.iterations.length - 1]
    expect(entry.status).toBe("ok")
    expect(entry.scoreAfter).toBe(8)
  })

  test("scenario 4: valid correction keeps a real, restorable pre-correction snapshot", async () => {
    writeMain(corpus(8, 2))
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)
    const mainBefore = readFileSync(join(project, "main.tex"), "utf-8")

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION],
      previousScore: 8,
    })
    expect(result).toContain("✓ capitulos/cap1.tex")

    const state = readStateJson()
    expect(state.snapshots).toHaveLength(1)
    const label = state.snapshots[0].label
    expect(vaultInventory().length).toBeGreaterThan(0)

    const restored = await runRestore(label)
    expect(restored).toContain(`restored from ${label}`)
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toBe(CHAPTER_WITH_TARGET)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(mainBefore)
  })

  test("scenario 4: a real regression (6.0 → 4.0) is still detected and recorded as failed", async () => {
    writeMain(corpus(6, 4)) // 40% without citation → 4.0
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION],
      previousScore: 6,
    })

    expect(result).toContain("⚠ score dropped from 6.0 to 4.0")
    const state = readStateJson()
    const entry = state.iterations[state.iterations.length - 1]
    expect(entry.status).toBe("failed")
    expect(entry.scoreAfter).toBe(4)
  })

  test("scenario 4: 30% boundary (6.0) is preserved through the regression check", async () => {
    writeMain(corpus(7, 3)) // exactly 30% → 6.0
    writeChapter("capitulos/cap1.tex", CHAPTER_WITH_TARGET)

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION],
      previousScore: 6,
    })

    expect(result).not.toContain("⚠")
    expect(result).not.toContain("partial:")
    const state = readStateJson()
    expect(state.iterations[state.iterations.length - 1].scoreAfter).toBe(6)
  })
})
