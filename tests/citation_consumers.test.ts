/**
 * Issue #112 — consumer regressions for the canonical citation heuristic.
 *
 * `src/lib/citation.ts#analyzeCitationDensity` is the single source of truth
 * consumed by `banca_loop` (citations audit drives `currentScore`) and by
 * `banca_corrigir` (regression check when `previousScore` is provided). These
 * tests prove, through the public tool behavior, that valid LaTeX citation
 * commands formerly ignored by `/\\cite(?:online)?\{[^}]+\}/` now feed the same
 * heuristic index in both consumers:
 *
 *   \parencite[p.~12]{autor2020}   \textcite{autor2020}
 *   \citeauthor{autor2020}         \apud{orig2020}{cons2020}
 *   \cite[p.~7]{autor2020}         \citeonline[p.~1]{autor2020}
 *   \parencite{autor2020,outro2021} \textcite[p.~3]{autor2020}
 *
 * Fixtures are hermetic synthetic LaTeX workspaces in a fresh tmpdir. No
 * network, no DSH host, no model, no real manuscript data. The only mutation
 * outside the tmpdir is none at all.
 *
 * Expected heuristic for the 10-paragraph fixture: 8 quoted paragraphs, 2
 * without citations → 20% without citation → score 8.0. The historical regex
 * sees 0/10 → score 4.0, which is the observable base defect (RED).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let base: string
let project: string

function projectConfig(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "refs.bib",
      chapters: ["capitulos/*.tex"],
      outputDir: "trabalhos",
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: ["dados/**", "protegido/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9.0,
    providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
    mcp: { crossrefAcademicEnabled: false },
    ...overrides,
  }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-issue112-consumers-"))
  project = join(base, "project")
  mkdirSync(join(project, ".banca"), { recursive: true })
  mkdirSync(join(project, "capitulos"), { recursive: true })
  writeFileSync(
    join(project, ".banca", "project.json"),
    JSON.stringify(projectConfig()),
    "utf-8",
  )
  writeFileSync(
    join(project, "refs.bib"),
    "@article{autor2020, author={A}, title={T}, year={2020}}\n",
    "utf-8",
  )
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function writeProjectConfig(overrides: Record<string, unknown>): void {
  writeFileSync(
    join(project, ".banca", "project.json"),
    JSON.stringify(projectConfig(overrides)),
    "utf-8",
  )
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function mainPath(): string {
  return join(project, "main.tex")
}

function writeMain(content: string): void {
  writeFileSync(mainPath(), content, "utf-8")
}

/** Persistent academic state hash, or null when state.json does not exist. */
function stateHash(): string | null {
  const path = join(project, ".banca", "state.json")
  return existsSync(path) ? sha256(readFileSync(path)) : null
}

/** Top-level snapshot-vault entries (manifests and snapshot directories). */
function vaultInventory(): string[] {
  const dir = join(project, ".banca", "snapshots")
  return existsSync(dir) ? readdirSync(dir).sort() : []
}

interface WorkspaceSnapshot {
  mainHash: string
  stateHash: string | null
  vault: string[]
}

function captureWorkspace(): WorkspaceSnapshot {
  return { mainHash: sha256(readFileSync(mainPath())), stateHash: stateHash(), vault: vaultInventory() }
}

/**
 * Fail-closed assertion used by the #110 protection regressions: the blocked
 * message is reported, nothing is announced as corrected, the manuscript bytes,
 * the persistent state and the snapshot vault are exactly as captured.
 */
function expectBlockedWithoutMutation(result: string, before: WorkspaceSnapshot): void {
  expect(result).toContain("blocked")
  expect(result).not.toContain("✓")
  expect(sha256(readFileSync(mainPath()))).toBe(before.mainHash)
  expect(stateHash()).toBe(before.stateHash)
  expect(vaultInventory()).toEqual(before.vault)
}

// ---------------------------------------------------------------------------
// Fixtures — 10 meaningful paragraphs; only the first 8 carry citation
// commands, and every one of those commands is invisible to the historical
// regex. 2 without citation / 10 = 20% without citation → score 8.0.
// ---------------------------------------------------------------------------

const CITED_PARAGRAPHS: string[] = [
  "O primeiro parágrafo apresenta a fundamentação teórica apoiada em \\parencite[p.~12]{autor2020} como referência central.",
  "O segundo parágrafo revisa a literatura recente e mobiliza \\textcite{autor2020} de forma crítica e comparativa.",
  "O terceiro parágrafo atribui a tese central a \\citeauthor{autor2020} sem repetir a referência completa no corpo.",
  "O quarto parágrafo articula as duas tradições por intermédio de \\apud{orig2020}{cons2020} no argumento geral.",
  "O quinto parágrafo retoma a evidência empírica com \\cite[p.~7]{autor2020} logo após a afirmação principal.",
  "O sexto parágrafo comenta o resultado com \\citeonline[p.~1]{autor2020} em nota corrida de rodapé.",
  "O sétimo parágrafo agrega duas fontes distintas em \\parencite{autor2020,outro2021} na mesma frase curta.",
  "O oitavo parágrafo contrapõe as interpretações com \\textcite[p.~3]{autor2020} ao final do período.",
]

const UNCITED_PARAGRAPHS: string[] = [
  "O nono parágrafo encerra a discussão teórica sem qualquer chamada bibliográfica neste trecho.",
  "O décimo parágrafo apresenta a síntese parcial do capítulo sem chamada bibliográfica aqui.",
]

/** All ten paragraphs, blank-line separated (one meaningful block each). */
function tenParagraphs(): string[] {
  return [...CITED_PARAGRAPHS, ...UNCITED_PARAGRAPHS]
}

/** Manuscript with exactly 10 meaningful paragraphs, 8 of them cited. */
function manuscriptWithCitations(paragraphs: string[] = tenParagraphs()): string {
  return paragraphs.join("\n\n") + "\n"
}

// The correction consumer needs one literal, authorized target in the text.
function correctionManuscript(): string {
  const paragraphs = tenParagraphs()
  paragraphs[9] =
    "O décimo parágrafo apresenta a síntese parcial do capítulo e um RASCUNHO pendente de revisão."
  return manuscriptWithCitations(paragraphs)
}

// ---------------------------------------------------------------------------
// (a) banca_loop consumer — citations audit drives the recorded score.
// ---------------------------------------------------------------------------

describe("Issue #112 — banca_loop consome a heurística canônica de citações", () => {
  test("saída e relatório registram 8/10 parágrafos citados (80.0%)", async () => {
    writeMain(manuscriptWithCitations())
    const { bancaLoop } = await import("../src/tools/banca_loop")

    const result = String(await bancaLoop.execute({ projectRoot: project }, {} as any))

    expect(result).toContain("Loop iteration")
    expect(result).toContain("Citations: 8/10 (80.0%)")
    expect(result).toContain("Report: .banca/reports/loop-")

    const reportsDir = join(project, ".banca", "reports")
    const reports = readdirSync(reportsDir).filter((name) => /^loop-.*\.md$/.test(name))
    expect(reports).toHaveLength(1)
    const report = readFileSync(join(reportsDir, reports[0]), "utf-8")
    expect(report).toContain("Citations: 8/10")
  })

  test("estado persiste scoreAfter 8 e preserva o scoreBefore anterior", async () => {
    writeMain(manuscriptWithCitations())
    // Previous academic state: last known score is 6.0 with a prior iteration.
    writeFileSync(
      join(project, ".banca", "state.json"),
      JSON.stringify({
        currentScore: 6.0,
        lastAudit: null,
        lastLoop: null,
        snapshots: [],
        iterations: [
          {
            date: new Date().toISOString(),
            action: "audit",
            scoreBefore: null,
            scoreAfter: 6.0,
            status: "ok",
          },
        ],
      }),
      "utf-8",
    )
    const { bancaLoop } = await import("../src/tools/banca_loop")
    const { loadState } = await import("../src/lib/state")

    const result = String(await bancaLoop.execute({ projectRoot: project }, {} as any))
    expect(result).toContain("Citations: 8/10 (80.0%)")

    const state = loadState(project)
    // The prior audit iteration is preserved untouched.
    expect(state.iterations).toHaveLength(2)
    expect(state.iterations[0].action).toBe("audit")
    expect(state.iterations[0].scoreAfter).toBe(6.0)

    const loopIteration = state.iterations[1]
    expect(loopIteration.action).toBe("loop")
    expect(loopIteration.scoreBefore).toBe(6.0)
    expect(loopIteration.scoreAfter).toBe(8.0)
    expect(loopIteration.status).toBe("ok")
    expect(state.currentScore).toBe(8.0)
    // Loop snapshot (process marker) is registered as before.
    expect(state.snapshots).toHaveLength(1)
    expect(state.snapshots[0].label).toMatch(/^loop-/)
  })
})

// ---------------------------------------------------------------------------
// (b) banca_corrigir consumer — corrected analysis feeds the regression check.
// ---------------------------------------------------------------------------

describe("Issue #112 — banca_corrigir usa a análise corrigida na checagem de regressão", () => {
  test("correção autorizada: sem aviso de regressão, scoreAfter 8, snapshot real restaurável", async () => {
    const original = correctionManuscript()
    writeMain(original)
    const originalHash = sha256(original)
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    const result = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [
            { file: "main.tex", oldText: "RASCUNHO", newText: "TEXTO FINAL", expectedOccurrences: 1 },
          ],
          previousScore: 6,
        } as any,
        {} as any,
      ),
    )

    // The canonical analysis of the corrected manuscript is 8.0, which is not
    // below previousScore 6: success is reported without a regression warning.
    expect(result).toContain("✓ main.tex")
    expect(result).toContain("1 replacement")
    expect(result).not.toContain("⚠")

    const corrected = readFileSync(mainPath(), "utf-8")
    expect(corrected).toContain("TEXTO FINAL")
    expect(corrected).not.toContain("RASCUNHO")

    const state = loadState(project)
    expect(state.iterations).toHaveLength(1)
    const iteration = state.iterations[0]
    expect(iteration.action).toBe("correction")
    expect(iteration.scoreBefore).toBe(6)
    expect(iteration.scoreAfter).toBe(8.0)
    expect(iteration.status).toBe("ok")
    expect(state.currentScore).toBe(8.0)

    // A real partial pre-correction snapshot exists with the original bytes.
    expect(state.snapshots).toHaveLength(1)
    const label = state.snapshots[0].label
    expect(label.startsWith("pre-")).toBe(true)
    const manifest = JSON.parse(
      readFileSync(join(project, ".banca", "snapshots", `${label}.manifest.json`), "utf-8"),
    )
    expect(manifest.kind).toBe("partial")
    expect(manifest.files).toHaveLength(1)
    expect(manifest.files[0].logical).toBe("main.tex")
    expect(manifest.files[0].sha256).toBe(originalHash)
    expect(
      sha256(readFileSync(join(project, ".banca", "snapshots", label, "main.tex"))),
    ).toBe(originalHash)

    // The registered recovery point is visible and restorable through the
    // public banca_restore contract.
    const list = String(await bancaRestore.execute({ projectRoot: project }, {} as any))
    expect(list).toContain(label)
    expect(list).toContain("[partial]")

    const dryRun = String(
      await bancaRestore.execute(
        { projectRoot: project, snapshotId: label, confirm: false } as any,
        {} as any,
      ),
    )
    expect(dryRun).toContain(`Restore Dry-Run for Snapshot: ${label}`)
    expect(dryRun).toContain("- main.tex")

    const restored = String(
      await bancaRestore.execute(
        { projectRoot: project, snapshotId: label, confirm: true } as any,
        {} as any,
      ),
    )
    expect(restored).toContain(`restored from ${label}`)
    expect(readFileSync(mainPath(), "utf-8")).toBe(original)
    expect(sha256(readFileSync(mainPath()))).toBe(originalHash)
  })

  // ----- #110 protections must remain active with the corrected analysis. -----

  test("expectedOccurrences errado bloqueia antes de snapshot, escrita ou estado", async () => {
    writeMain(correctionManuscript())
    const before = captureWorkspace()
    expect(before.stateHash).toBeNull()
    expect(before.vault).toEqual([])
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    const result = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [
            { file: "main.tex", oldText: "RASCUNHO", newText: "TEXTO FINAL", expectedOccurrences: 3 },
          ],
          previousScore: 6,
        } as any,
        {} as any,
      ),
    )

    expectBlockedWithoutMutation(result, before)
    expect(result).toContain("occurrence preflight failed")
    expect(result).toContain("expected 3 (expectedOccurrences), found 1")
    expect(readFileSync(mainPath(), "utf-8")).toBe(correctionManuscript())
  })

  test("alvo protegido por protectedPaths continua bloqueado", async () => {
    mkdirSync(join(project, "protegido"), { recursive: true })
    writeFileSync(join(project, "protegido", "arquivo.tex"), "TEXTO PROTEGIDO\n", "utf-8")
    writeMain(correctionManuscript())
    const before = captureWorkspace()
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    const result = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [
            { file: "protegido/arquivo.tex", oldText: "TEXTO PROTEGIDO", newText: "ALTERADO" },
          ],
          previousScore: 6,
        } as any,
        {} as any,
      ),
    )

    expectBlockedWithoutMutation(result, before)
    expect(result).toContain("protected path")
    expect(readFileSync(join(project, "protegido", "arquivo.tex"), "utf-8")).toBe(
      "TEXTO PROTEGIDO\n",
    )
  })

  test("alvo imutável (immutableFacts) continua bloqueado", async () => {
    writeProjectConfig({ immutableFacts: ["dados/**"] })
    mkdirSync(join(project, "dados"), { recursive: true })
    writeFileSync(join(project, "dados", "experimento.csv"), "1,2,3\n", "utf-8")
    writeMain(correctionManuscript())
    const before = captureWorkspace()
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    const result = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [
            { file: "dados/experimento.csv", oldText: "1,2,3", newText: "9,9,9" },
          ],
          previousScore: 6,
        } as any,
        {} as any,
      ),
    )

    expectBlockedWithoutMutation(result, before)
    expect(result).toContain("immutable")
    expect(readFileSync(join(project, "dados", "experimento.csv"), "utf-8")).toBe("1,2,3\n")
  })

  test("alvo fora da allowlist continua bloqueado", async () => {
    writeFileSync(join(project, "notes.txt"), "anotação qualquer\n", "utf-8")
    writeMain(correctionManuscript())
    const before = captureWorkspace()
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    const result = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [{ file: "notes.txt", oldText: "anotação", newText: "mudança" }],
          previousScore: 6,
        } as any,
        {} as any,
      ),
    )

    expectBlockedWithoutMutation(result, before)
    expect(result).toContain("not in allowed paths")
  })
})

// ---------------------------------------------------------------------------
// (c) Conservative case: comments and commands fragmented across paragraph
// boundaries must not create a citation in either consumer.
// ---------------------------------------------------------------------------

const COMMENT_AND_SPLIT_MANUSCRIPT =
  [
    "Este parágrafo cita apenas dentro de um comentário LaTeX: % \\parencite{autor2020} não conta aqui.",
    "Este parágrafo interrompe o comando entre blocos: \\parencite{autor",
    "2020} e o restante do texto continua depois da quebra de parágrafo.",
  ].join("\n\n") + "\n"

describe("Issue #112 — comentário e comando partido entre parágrafos não contam", () => {
  test("banca_loop reporta 0/3 e banca_corrigir não enxerga regressão fictícia", async () => {
    writeMain(COMMENT_AND_SPLIT_MANUSCRIPT)
    const { bancaLoop } = await import("../src/tools/banca_loop")
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")

    // The command inside the % comment and the command split by a blank line
    // are not citations: three meaningful paragraphs, none cited.
    const loopResult = String(await bancaLoop.execute({ projectRoot: project }, {} as any))
    expect(loopResult).toContain("Citations: 0/3 (0.0%)")
    expect(loadState(project).currentScore).toBe(4.0)

    const correctionResult = String(
      await bancaCorrigir.execute(
        {
          projectRoot: project,
          corrections: [
            { file: "main.tex", oldText: "restante", newText: "demais", expectedOccurrences: 1 },
          ],
          previousScore: 4,
        } as any,
        {} as any,
      ),
    )
    expect(correctionResult).toContain("✓ main.tex")
    expect(correctionResult).not.toContain("⚠")

    const state = loadState(project)
    const corrections = state.iterations.filter((iteration) => iteration.action === "correction")
    expect(corrections).toHaveLength(1)
    expect(corrections[0].scoreBefore).toBe(4.0)
    expect(corrections[0].scoreAfter).toBe(4.0)
    expect(corrections[0].status).toBe("ok")
  })
})
