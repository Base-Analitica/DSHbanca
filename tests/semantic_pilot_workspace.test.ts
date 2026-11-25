/**
 * Teste hermético do workspace individual cego por caso do piloto semântico
 * (DSHbanca, issue #180).
 *
 * Escopo:
 * - demonstra os riscos RED do baseline (caso cru usa defaults; cópia ampla
 *   expõe gabarito; materializador ingênuo aceita hash adulterado);
 * - materializa os seis casos com allowlist/hashes exatos e configuração
 *   persistida derivada de `buildProjectConfig`;
 * - recarrega a configuração com `validateConfig`/`loadConfig` de produção e
 *   compara o plano acadêmico com o caso original usando loader/planejador reais;
 * - exercita os contratos negativos (hash, extra, symlink, traversal,
 *   sobreposição, destino não vazio, config ausente/adulterada/defaults,
 *   estado contaminado, vazamento de outro caso e falha parcial).
 *
 * Este teste não executa DSH, Agent/Session, modelo, rede, credencial, custo ou
 * campanha. Todo o corpus é sintético. Nenhum manuscrito real é usado.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  chownSync,
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  BLIND_WORKSPACE_CONFIG_RELATIVE_PATH,
  BlindWorkspaceError,
  blindControllerCaseOrder,
  buildBlindCampaignPlan,
  loadPresentationCaseAcademicState,
  loadPresentationCorpus,
  materializeBlindCaseWorkspace,
  neutralAuditPrompt,
  verifyBlindCaseWorkspace,
  writeBlindCaseControlArtifacts,
  type BlindCaseWorkspace,
  type PresentationCorpus,
} from "./fixtures/academic-semantic-pilot/v1/helpers/blind_case_workspace"
import {
  PILOT_CORPUS_ROOT,
  buildProjectConfig,
  computeCaseFileInventory,
  sha256Hex,
  type PilotCorpusCase,
  type PilotCorpusManifest,
} from "./fixtures/academic-semantic-pilot/v1/helpers/corpus_contract"
import { loadConfig, validateConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"

const CORPUS_ROOT = PILOT_CORPUS_ROOT

const scratchDirectories: string[] = []

function newScratch(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  scratchDirectories.push(directory)
  return directory
}

afterAll(() => {
  for (const directory of [...scratchDirectories].reverse()) {
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      // Limpeza best-effort de scratch de teste.
    }
  }
})

function sortByPath<T extends { path: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

function expectedWorkspaceFiles(caseDef: PilotCorpusCase): string[] {
  return [
    ...caseDef.content.files.map((file) => file.path),
    BLIND_WORKSPACE_CONFIG_RELATIVE_PATH,
  ].sort()
}

function caseDirOf(corpusRoot: string, caseDef: PilotCorpusCase): string {
  return path.join(corpusRoot, ...caseDef.path.split("/"))
}

function expectBlindError(run: () => unknown, code: string): BlindWorkspaceError {
  try {
    run()
  } catch (error) {
    if (!(error instanceof BlindWorkspaceError)) throw error
    expect(error.code).toBe(code)
    return error
  }
  throw new Error(`expected BlindWorkspaceError(${code}) but the operation succeeded`)
}

/** Copia de teste do corpus de apresentação; nunca é usada pelo helper. */
function copyPresentationCorpus(
  options: {
    includeAnswerKey?: boolean
    includeScenarios?: boolean
    includeHelpers?: boolean
  } = {},
): string {
  const root = newScratch("dshbanca-180-corpus-")
  copyFileSync(path.join(CORPUS_ROOT, "manifest.json"), path.join(root, "manifest.json"))
  cpSync(path.join(CORPUS_ROOT, "manuscripts"), path.join(root, "manuscripts"), {
    recursive: true,
  })
  if (options.includeAnswerKey !== false) {
    cpSync(path.join(CORPUS_ROOT, "answer-key"), path.join(root, "answer-key"), {
      recursive: true,
    })
  }
  if (options.includeScenarios !== false) {
    cpSync(path.join(CORPUS_ROOT, "scenarios"), path.join(root, "scenarios"), {
      recursive: true,
    })
  }
  if (options.includeHelpers === true) {
    cpSync(path.join(CORPUS_ROOT, "helpers"), path.join(root, "helpers"), {
      recursive: true,
    })
  }
  return root
}

function readManifestJson(corpusRoot: string): PilotCorpusManifest {
  return JSON.parse(readFileSync(path.join(corpusRoot, "manifest.json"), "utf8")) as PilotCorpusManifest
}

function writeManifestJson(corpusRoot: string, manifest: PilotCorpusManifest): void {
  writeFileSync(path.join(corpusRoot, "manifest.json"), JSON.stringify(manifest))
}

/** Materializador ingênuo de teste: sem hash, link, destino ou equivalência. */
function naiveMaterializeCorpusCase(
  corpusRoot: string,
  caseId: string,
  destinationRoot: string,
): void {
  const manifest = readManifestJson(corpusRoot)
  const caseDef = manifest.cases.find((candidate) => candidate.id === caseId)
  if (caseDef === undefined) throw new Error(`naive: caseId ausente: ${caseId}`)
  const sourceDir = path.join(corpusRoot, ...caseDef.path.split("/"))
  for (const file of caseDef.content.files) {
    const target = path.join(destinationRoot, ...file.path.split("/"))
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, readFileSync(path.join(sourceDir, ...file.path.split("/"))))
  }
  mkdirSync(path.join(destinationRoot, ".banca"), { recursive: true })
  writeFileSync(
    path.join(destinationRoot, ".banca/project.json"),
    JSON.stringify(buildProjectConfig(caseDef), null, 2),
  )
}

function materialize(caseId: string, corpusRoot: string = CORPUS_ROOT): BlindCaseWorkspace {
  const root = newScratch("dshbanca-180-ws-")
  return materializeBlindCaseWorkspace({
    corpusRoot,
    caseId,
    destinationRoot: path.join(root, caseId),
  })
}

let corpus: PresentationCorpus
let manifest: PilotCorpusManifest
let sixRoot: string
let controlParent: string
const sixWorkspaces = new Map<string, BlindCaseWorkspace>()

beforeAll(() => {
  corpus = loadPresentationCorpus(CORPUS_ROOT)
  manifest = corpus.manifest
  sixRoot = newScratch("dshbanca-180-six-")
  controlParent = newScratch("dshbanca-180-control-")
  for (const caseDef of manifest.cases) {
    sixWorkspaces.set(
      caseDef.id,
      materializeBlindCaseWorkspace({
        corpusRoot: CORPUS_ROOT,
        caseId: caseDef.id,
        destinationRoot: path.join(sixRoot, caseDef.id),
      }),
    )
  }
})

describe("Baseline RED — riscos comprovados antes do helper", () => {
  test("RED: caso cru sem configuração persistida usa defaults de produção e diverge do manifesto", () => {
    const caseDef = manifest.cases[0]
    const rawCaseDir = caseDirOf(CORPUS_ROOT, caseDef)

    const validation = validateConfig(rawCaseDir)
    expect(validation.valid).toBe(false)
    expect(validation.errors).toContain("config not found")

    const defaults = loadConfig(rawCaseDir)
    expect(defaults.compile.enabled).toBe(true)
    expect(defaults.compile.command).toEqual(["lualatex", "bibtex", "lualatex", "lualatex"])
    expect(defaults.analysis.maxCharactersPerBatch).toBe(50_000)
    expect(defaults.providers.references.primary).toBe("mcp:crossref-academic")
    expect(defaults.providers.references.fallbacks.length).toBeGreaterThan(0)
    expect(defaults.manuscript.chapters).toEqual(["capitulos/*.tex"])

    const loaded = loadCanonicalLatexManuscript(rawCaseDir, defaults)
    expect(loaded.complete).toBe(true)
    expect(loaded.fingerprint).toBe(caseDef.content.manuscriptFingerprint)
    const plan = planExhaustiveAnalysisBatches(loaded, defaults.analysis.maxCharactersPerBatch)
    expect(plan.coverage.totalCharacters).toBe(caseDef.content.totalCharacters)
    expect(plan.batches.length).toBe(1)
    expect(plan.batches.length).not.toBe(caseDef.content.batchCount)
  })

  test("RED: cópia recursiva ampla do corpus disponibiliza gabarito, cenários, outros casos e helpers", () => {
    const broadRoot = path.join(newScratch("dshbanca-180-broad-"), "corpus")
    cpSync(CORPUS_ROOT, broadRoot, { recursive: true })

    expect(existsSync(path.join(broadRoot, "answer-key/provisional-ground-truth.json"))).toBe(true)
    expect(existsSync(path.join(broadRoot, "scenarios/synthetic-submissions.json"))).toBe(true)
    expect(existsSync(path.join(broadRoot, "manifest.json"))).toBe(true)
    expect(existsSync(path.join(broadRoot, "helpers/corpus_contract.ts"))).toBe(true)
    expect(existsSync(path.join(broadRoot, "manuscripts/case-02/main.tex"))).toBe(true)

    // GREEN: o workspace individual contém somente o caso e a config inicial.
    const workspace = sixWorkspaces.get("case-01")
    if (workspace === undefined) throw new Error("workspace case-01 ausente")
    expect(workspace.workspaceFiles).not.toContain("manifest.json")
    expect(workspace.workspaceFiles.some((entry) => entry.includes("answer-key"))).toBe(false)
    expect(workspace.workspaceFiles.some((entry) => entry.includes("scenarios"))).toBe(false)
    expect(workspace.workspaceFiles.some((entry) => entry.includes("case-02"))).toBe(false)
    expect(workspace.workspaceFiles.some((entry) => entry.includes("helpers"))).toBe(false)
  })

  test("RED/GREEN: materializador ingênuo aceita fonte adulterada; helper recusa por hash", () => {
    const tamperedCorpus = copyPresentationCorpus()
    const caseDir = path.join(tamperedCorpus, "manuscripts/case-01")
    const target = path.join(caseDir, "secoes/objetivo.tex")
    writeFileSync(target, `${readFileSync(target, "utf8")}\nADULTERADO\n`)

    // RED: sem verificação de hash, a cópia publica conteúdo divergente.
    const naiveDestination = path.join(newScratch("dshbanca-180-naive-"), "case-01")
    naiveMaterializeCorpusCase(tamperedCorpus, "case-01", naiveDestination)
    expect(readFileSync(path.join(naiveDestination, "secoes/objetivo.tex"), "utf8")).toContain(
      "ADULTERADO",
    )

    // GREEN: o helper recusa a fonte adulterada antes de publicar.
    const error = expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: tamperedCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-reject-"), "case-01"),
        }),
      "source_hash_mismatch",
    )
    expect(error.message).not.toContain(tamperedCorpus)

    // O corpus versionado continua materializável.
    const valid = materialize("case-01")
    expect(valid.equivalence.manuscriptFingerprint).toBe(
      manifest.cases[0].content.manuscriptFingerprint,
    )
  })
})

describe("Materialização dos seis casos", () => {
  test("materializa os seis casos com allowlist exata e hashes do manifesto", () => {
    expect(sixWorkspaces.size).toBe(6)
    for (const caseDef of manifest.cases) {
      const workspace = sixWorkspaces.get(caseDef.id)
      if (workspace === undefined) throw new Error(`workspace ausente: ${caseDef.id}`)
      expect(workspace.caseId).toBe(caseDef.id)
      expect(workspace.sources.length).toBe(6)
      expect(workspace.inventory).toEqual(sortByPath([...caseDef.content.files]))
      expect(workspace.workspaceFiles).toEqual(expectedWorkspaceFiles(caseDef))
      expect(workspace.bancaFiles).toEqual([BLIND_WORKSPACE_CONFIG_RELATIVE_PATH])
      for (const file of caseDef.content.files) {
        const bytes = readFileSync(path.join(workspace.workspaceRoot, ...file.path.split("/")))
        expect(sha256Hex(bytes)).toBe(file.sha256)
      }
    }
  })

  test("preserva os totais do corpus: 36 arquivos, 8509 caracteres e 22 lotes", () => {
    let files = 0
    let characters = 0
    let batches = 0
    for (const workspace of sixWorkspaces.values()) {
      files += workspace.sources.length
      characters += workspace.equivalence.totalCharacters
      batches += workspace.equivalence.batchCount
    }
    expect(files).toBe(36)
    expect(characters).toBe(8509)
    expect(batches).toBe(22)

    for (const caseDef of manifest.cases) {
      const workspace = sixWorkspaces.get(caseDef.id)
      if (workspace === undefined) throw new Error(`workspace ausente: ${caseDef.id}`)
      expect(workspace.equivalence.totalCharacters).toBe(caseDef.content.totalCharacters)
      expect(workspace.equivalence.batchCount).toBe(caseDef.content.batchCount)
    }
  })

  test("configuração persistida preserva o contrato experimental e recarrega sem fallback", () => {
    for (const caseDef of manifest.cases) {
      const workspace = sixWorkspaces.get(caseDef.id)
      if (workspace === undefined) throw new Error(`workspace ausente: ${caseDef.id}`)
      const expected = buildProjectConfig(caseDef)
      const configPath = path.join(workspace.workspaceRoot, ...BLIND_WORKSPACE_CONFIG_RELATIVE_PATH.split("/"))

      expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(expected)
      expect(validateConfig(workspace.workspaceRoot)).toEqual({ valid: true, errors: [] })
      expect(loadConfig(workspace.workspaceRoot)).toEqual(expected)
      expect(workspace.config).toEqual(expected)

      expect(workspace.config.manuscript.root).toBe(".")
      expect(workspace.config.manuscript.main).toBe(caseDef.config.manuscript.main)
      expect(workspace.config.manuscript.bib).toBe(caseDef.config.manuscript.bib)
      expect(workspace.config.manuscript.chapters).toEqual(caseDef.config.manuscript.chapters)
      expect(workspace.config.analysis.coverageMode).toBe("exhaustive")
      expect(workspace.config.analysis.maxCharactersPerBatch).toBe(440)
      expect(workspace.config.compile.enabled).toBe(false)
      expect(workspace.config.compile.command).toEqual([])
      expect(workspace.config.providers.references.primary).toBe("cache")
      expect(workspace.config.providers.references.fallbacks).toEqual([])
      expect(workspace.config.mcp.crossrefAcademicEnabled).toBe(false)
      expect(workspace.config.externalDependencies).toEqual([])

      // Contraste com o fallback silencioso do caso cru (RED do baseline).
      const defaults = loadConfig(caseDirOf(CORPUS_ROOT, caseDef))
      expect(defaults).not.toEqual(expected)
      expect(defaults.analysis.maxCharactersPerBatch).toBe(50_000)
      expect(defaults.compile.enabled).toBe(true)
    }
  })

  test("equivalência acadêmica com loader e planejador reais, incluindo planId portátil", () => {
    for (const caseDef of manifest.cases) {
      const workspace = sixWorkspaces.get(caseDef.id)
      if (workspace === undefined) throw new Error(`workspace ausente: ${caseDef.id}`)
      const original = loadPresentationCaseAcademicState(corpus, caseDef.id)

      expect(workspace.equivalence.manuscriptFingerprint).toBe(
        caseDef.content.manuscriptFingerprint,
      )
      expect(workspace.equivalence.fingerprintVersion).toBe("openbanca-manuscript-v1")
      expect(workspace.equivalence.totalCharacters).toBe(caseDef.content.totalCharacters)
      expect(workspace.equivalence.plannedCharacters).toBe(caseDef.content.totalCharacters)
      expect(workspace.equivalence.coveragePercent).toBe(100)
      expect(workspace.equivalence.batchCount).toBe(caseDef.content.batchCount)
      expect(workspace.equivalence.batchIds).toEqual(original.plan.batches.map((batch) => batch.batchId))
      expect(workspace.equivalence.planId).toBe(original.planId)
      expect(workspace.equivalence.planIdentityPortable).toBe(true)
      expect(workspace.equivalence.planIdentityPortability).toContain("relative")
      expect(workspace.equivalence.orderedSourceFiles).toEqual(
        original.loaded.orderedSources.map((source) => source.file),
      )
      expect(workspace.loaded.orderedSources).toEqual(original.loaded.orderedSources)
      expect(workspace.loaded.fingerprint).toBe(original.loaded.fingerprint)
      expect(workspace.plan).toEqual(original.plan)
      expect(workspace.planId).toBe(original.planId)
    }
  })

  test("workspace cego contém apenas o manuscrito do caso e a configuração inicial", () => {
    const forbiddenSegments = [
      "manifest.json",
      "answer-key",
      "scenarios",
      "helpers",
      "README.md",
      "schema.json",
      "docs/",
      ".git",
    ]
    for (const workspace of sixWorkspaces.values()) {
      for (const entry of workspace.workspaceFiles) {
        for (const forbidden of forbiddenSegments) {
          expect(entry.includes(forbidden)).toBe(false)
        }
        for (const caseDef of manifest.cases) {
          if (caseDef.id === workspace.caseId) continue
          expect(entry.includes(caseDef.id)).toBe(false)
        }
      }
      expect(existsSync(path.join(workspace.workspaceRoot, ".banca/analysis"))).toBe(false)
      expect(existsSync(path.join(workspace.workspaceRoot, ".banca/context"))).toBe(false)
      expect(existsSync(path.join(workspace.workspaceRoot, ".banca/reports"))).toBe(false)
      expect(existsSync(path.join(workspace.workspaceRoot, ".banca/snapshots"))).toBe(false)
      expect(existsSync(path.join(workspace.workspaceRoot, ".banca/scorecard.md"))).toBe(false)
      expect(existsSync(path.join(workspace.workspaceRoot, ".banca/knowledge.md"))).toBe(false)
      expect(existsSync(path.join(workspace.workspaceRoot, ".git"))).toBe(false)
    }
  })

  test("prompt neutro é idêntico nos seis casos e não antecipa rótulo, categoria ou contagem", () => {
    const prompt = neutralAuditPrompt()
    const promptHashes = new Set<string>()
    for (const workspace of sixWorkspaces.values()) {
      promptHashes.add(workspace.report.promptSha256)
      expect(workspace.report.promptSha256).toBe(prompt.sha256)
      expect(workspace.report.promptVersion).toBe(prompt.version)
    }
    expect(promptHashes.size).toBe(1)
    expect(prompt.sha256).toBe(sha256Hex(prompt.content))

    const forbiddenPatterns = [
      /case-0\d/i,
      /gabarito/i,
      /ground.?truth/i,
      /answer.?key/i,
      /defeito esperado/i,
      /\bcontrole\b/i,
      /ambígu/i,
      /instrução embutida/i,
      /categoria/i,
      /número de achados/i,
      /quantidade de achados/i,
    ]
    for (const pattern of forbiddenPatterns) {
      expect(pattern.test(prompt.content)).toBe(false)
    }
    expect(prompt.content).toContain("dado não confiável")
    expect(prompt.content).not.toContain("case-01")

    // O prompt não é publicado dentro do workspace.
    for (const workspace of sixWorkspaces.values()) {
      for (const entry of workspace.workspaceFiles) {
        const content = readFileSync(
          path.join(workspace.workspaceRoot, ...entry.split("/")),
          "utf8",
        )
        expect(content).not.toBe(prompt.content)
      }
    }
  })

  test("relatório de controle sanitizado e prompt proposto ficam fora do workspace", () => {
    const workspace = sixWorkspaces.get("case-01")
    if (workspace === undefined) throw new Error("workspace case-01 ausente")
    const artifacts = writeBlindCaseControlArtifacts({
      controlDir: path.join(controlParent, "case-01"),
      workspaceRoot: workspace.workspaceRoot,
      report: workspace.report,
    })
    expect(existsSync(artifacts.reportPath)).toBe(true)
    expect(existsSync(artifacts.promptPath)).toBe(true)

    const reportRaw = readFileSync(artifacts.reportPath, "utf8")
    const report = JSON.parse(reportRaw)
    expect(report).toEqual(workspace.report)
    expect(report.caseId).toBe("case-01")
    expect(report.manifestSha256).toBe(corpus.manifestRawSha256)
    expect(report.files).toEqual(workspace.report.files)
    expect(report.planId).toBe(workspace.planId)
    expect(report.workspaceFiles).toEqual(workspace.workspaceFiles)
    expect(report.bancaFiles).toEqual([BLIND_WORKSPACE_CONFIG_RELATIVE_PATH])

    // Sanitizado: sem caminhos absolutos e sem dados de gabarito.
    expect(reportRaw).not.toContain(CORPUS_ROOT)
    expect(reportRaw).not.toContain(workspace.workspaceRoot)
    expect(reportRaw).not.toContain(tmpdir())
    expect(reportRaw.toLowerCase()).not.toContain("answer-key")
    expect(reportRaw.toLowerCase()).not.toContain("ground truth")
    expect(reportRaw.toLowerCase()).not.toContain("expected")

    const promptRaw = readFileSync(artifacts.promptPath, "utf8")
    expect(sha256Hex(promptRaw)).toBe(workspace.report.promptSha256)
    expect(promptRaw).toBe(neutralAuditPrompt().content)

    // Os artefatos de controle não estão no workspace.
    expect(existsSync(path.join(workspace.workspaceRoot, path.basename(artifacts.reportPath)))).toBe(false)
    expect(existsSync(path.join(workspace.workspaceRoot, "prompt.txt"))).toBe(false)

    // Recusa sobreposição com o workspace.
    expectBlindError(
      () =>
        writeBlindCaseControlArtifacts({
          controlDir: path.join(workspace.workspaceRoot, "control"),
          workspaceRoot: workspace.workspaceRoot,
          report: workspace.report,
        }),
      "control_workspace_overlap",
    )
  })

  test("ordem dos casos é predefinida no lado controlador e não depende de resultados", () => {
    const order = blindControllerCaseOrder(manifest)
    expect(order).toEqual(["case-01", "case-02", "case-03", "case-04", "case-05", "case-06"])
    expect(blindControllerCaseOrder(manifest)).toEqual(order)
    expect(order).toEqual(manifest.cases.map((caseDef) => caseDef.id))

    const campaign = buildBlindCampaignPlan(manifest)
    expect(campaign.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(campaign.map((entry) => entry.caseId)).toEqual(order)
    expect(new Set(campaign.map((entry) => entry.promptSha256)).size).toBe(1)
  })
})

describe("Independência, preservação e corpus de apresentação", () => {
  test("duas materializações independentes do mesmo caso não compartilham inodes nem estado", () => {
    const root = newScratch("dshbanca-180-independent-")
    const first = materializeBlindCaseWorkspace({
      corpusRoot: CORPUS_ROOT,
      caseId: "case-01",
      destinationRoot: path.join(root, "a"),
    })
    const second = materializeBlindCaseWorkspace({
      corpusRoot: CORPUS_ROOT,
      caseId: "case-01",
      destinationRoot: path.join(root, "b"),
    })

    expect(first.workspaceFiles).toEqual(second.workspaceFiles)
    for (const entry of first.workspaceFiles) {
      const leftPath = path.join(first.workspaceRoot, ...entry.split("/"))
      const rightPath = path.join(second.workspaceRoot, ...entry.split("/"))
      const leftStat = lstatSync(leftPath)
      const rightStat = lstatSync(rightPath)
      expect(leftStat.ino).not.toBe(rightStat.ino)
      expect(leftStat.nlink).toBe(1)
      expect(rightStat.nlink).toBe(1)
      expect(sha256Hex(readFileSync(leftPath))).toBe(sha256Hex(readFileSync(rightPath)))
    }

    // Estado acadêmico criado em uma materialização não contamina a outra.
    mkdirSync(path.join(first.workspaceRoot, ".banca/analysis/checkpoints"), { recursive: true })
    writeFileSync(path.join(first.workspaceRoot, ".banca/analysis/checkpoints/plan.json"), "{}")
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: first.workspaceRoot }),
      "academic_state_contaminated",
    )
    expect(() =>
      verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: second.workspaceRoot }),
    ).not.toThrow()

    // Alterar uma cópia não altera a outra nem o corpus original.
    writeFileSync(path.join(first.workspaceRoot, "secoes/objetivo.tex"), "ALTERADO\n")
    expect(readFileSync(path.join(second.workspaceRoot, "secoes/objetivo.tex"), "utf8")).not.toContain(
      "ALTERADO",
    )
    const originalObjetivo = manifest.cases[0].content.files.find(
      (file) => file.path === "secoes/objetivo.tex",
    )
    if (originalObjetivo === undefined) throw new Error("arquivo original ausente")
    expect(
      sha256Hex(readFileSync(path.join(CORPUS_ROOT, "manuscripts/case-01/secoes/objetivo.tex"))),
    ).toBe(originalObjetivo.sha256)
  })

  test("fontes originais permanecem byte a byte intactas após as materializações", () => {
    for (const caseDef of manifest.cases) {
      const caseDir = caseDirOf(CORPUS_ROOT, caseDef)
      const inventory = computeCaseFileInventory(caseDir)
      expect(inventory).toEqual(sortByPath([...caseDef.content.files]))
      const fresh = loadPresentationCaseAcademicState(corpus, caseDef.id)
      expect(fresh.inventory).toEqual(inventory)
      expect(fresh.plan.coverage.totalCharacters).toBe(caseDef.content.totalCharacters)
      expect(existsSync(path.join(caseDir, ".banca"))).toBe(false)
    }
  })

  test("funciona com corpus de apresentação sem answer-key e sem scenarios", () => {
    const stripped = copyPresentationCorpus({
      includeAnswerKey: false,
      includeScenarios: false,
      includeHelpers: false,
    })
    expect(existsSync(path.join(stripped, "answer-key"))).toBe(false)
    expect(existsSync(path.join(stripped, "scenarios"))).toBe(false)
    expect(existsSync(path.join(stripped, "helpers"))).toBe(false)

    const workspace = materializeBlindCaseWorkspace({
      corpusRoot: stripped,
      caseId: "case-03",
      destinationRoot: path.join(newScratch("dshbanca-180-stripped-"), "case-03"),
    })
    expect(workspace.equivalence.manuscriptFingerprint).toBe(
      manifest.cases[2].content.manuscriptFingerprint,
    )
    expect(workspace.report.manifestSha256).toBe(corpus.manifestRawSha256)
    const verified = verifyBlindCaseWorkspace({
      corpusRoot: stripped,
      caseId: "case-03",
      workspaceRoot: workspace.workspaceRoot,
    })
    expect(verified.equivalence.planId).toBe(workspace.planId)
    expect(verified.report).toEqual(workspace.report)
  })

  test("helper é hermético: não lê gabarito/cenários, não copia recursivamente e não importa host", () => {
    const helperPath = path.resolve(
      __dirname,
      "fixtures/academic-semantic-pilot/v1/helpers/blind_case_workspace.ts",
    )
    const source = readFileSync(helperPath, "utf8")
    expect(source).not.toContain("loadPilotCorpus")
    expect(source).not.toContain("ANSWER_KEY_RELATIVE_PATH")
    expect(source).not.toContain("SCENARIOS_RELATIVE_PATH")
    expect(source).not.toContain("cpSync")
    expect(source).not.toContain("copyFileSync")
    expect(source).not.toMatch(/node:(child_process|net|http|https|dns)/)
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/Bun\.spawn|child_process/)
    expect(source).not.toMatch(/from\s+"[^"]*dsh/)

    const importSpecifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1])
    expect(importSpecifiers.length).toBeGreaterThan(0)
    const allowed = [
      "node:fs",
      "node:path",
      "./corpus_contract",
      "../../../../../src/lib/config",
      "../../../../../src/lib/latex_loader",
      "../../../../../src/lib/analysis_coverage",
      "../../../../../src/lib/analysis_checkpoint",
    ]
    for (const specifier of importSpecifiers) {
      expect(allowed).toContain(specifier)
    }
  })
})

describe("Contratos negativos — fail-closed sem override", () => {
  test("recusa arquivos extras no diretório do caso, inclusive gabarito", () => {
    const extraCorpus = copyPresentationCorpus()
    const caseDir = path.join(extraCorpus, "manuscripts/case-01")
    writeFileSync(path.join(caseDir, "extra.txt"), "extra")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: extraCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-extra-"), "case-01"),
        }),
      "unexpected_source_file",
    )

    const answerKeyInCase = copyPresentationCorpus()
    const caseDirWithKey = path.join(answerKeyInCase, "manuscripts/case-01")
    copyFileSync(
      path.join(answerKeyInCase, "answer-key/provisional-ground-truth.json"),
      path.join(caseDirWithKey, "provisional-ground-truth.json"),
    )
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: answerKeyInCase,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-extra-key-"), "case-01"),
        }),
      "unexpected_source_file",
    )
  })

  test("recusa hardlink de fonte para arquivo externo", () => {
    const hardlinkCorpus = copyPresentationCorpus()
    const caseDir = path.join(hardlinkCorpus, "manuscripts/case-01")
    const external = path.join(newScratch("dshbanca-180-hardlink-ext-"), "objetivo.tex")
    writeFileSync(external, readFileSync(path.join(caseDir, "secoes/objetivo.tex")))
    rmSync(path.join(caseDir, "secoes/objetivo.tex"))
    linkSync(external, path.join(caseDir, "secoes/objetivo.tex"))
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: hardlinkCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-hardlink-"), "case-01"),
        }),
      "source_hardlink",
    )
  })

  test("recusa symlink na origem e diretório de caso resolvido fora da raiz", () => {
    const symlinkCorpus = copyPresentationCorpus()
    const caseDir = path.join(symlinkCorpus, "manuscripts/case-01")
    const external = path.join(newScratch("dshbanca-180-external-"), "objetivo.tex")
    writeFileSync(external, readFileSync(path.join(caseDir, "secoes/objetivo.tex")))
    rmSync(path.join(caseDir, "secoes/objetivo.tex"))
    symlinkSync(external, path.join(caseDir, "secoes/objetivo.tex"))
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: symlinkCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-symlink-"), "case-01"),
        }),
      "unsafe_source_entry",
    )

    const directorySymlinkCorpus = copyPresentationCorpus()
    const directoryCase = path.join(directorySymlinkCorpus, "manuscripts/case-01")
    const realSections = path.join(newScratch("dshbanca-180-real-sections-"), "secoes")
    cpSync(path.join(directoryCase, "secoes"), realSections, { recursive: true })
    rmSync(path.join(directoryCase, "secoes"), { recursive: true, force: true })
    symlinkSync(realSections, path.join(directoryCase, "secoes"))
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: directorySymlinkCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-dir-symlink-"), "case-01"),
        }),
      "unsafe_source_entry",
    )

    const escapingCaseCorpus = copyPresentationCorpus()
    const escapingManifest = readManifestJson(escapingCaseCorpus)
    escapingManifest.cases[0].path = "manuscripts/../manuscripts/case-01"
    writeManifestJson(escapingCaseCorpus, escapingManifest)
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: escapingCaseCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-escape-"), "case-01"),
        }),
      "unsafe_case_path",
    )

    const caseSymlinkCorpus = copyPresentationCorpus()
    const externalCase = path.join(newScratch("dshbanca-180-external-case-"), "case-01")
    cpSync(path.join(caseSymlinkCorpus, "manuscripts/case-01"), externalCase, { recursive: true })
    rmSync(path.join(caseSymlinkCorpus, "manuscripts/case-01"), {
      recursive: true,
      force: true,
    })
    symlinkSync(externalCase, path.join(caseSymlinkCorpus, "manuscripts/case-01"))
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: caseSymlinkCorpus,
          caseId: "case-01",
          destinationRoot: path.join(newScratch("dshbanca-180-case-symlink-"), "case-01"),
        }),
      "case_dir_outside_corpus",
    )
  })

  test("recusa path absoluto e traversal na allowlist do manifesto", () => {
    for (const badPath of ["/etc/passwd", "../case-02/main.tex", "secoes/../../main.tex"]) {
      const tamperedCorpus = copyPresentationCorpus()
      const tamperedManifest = readManifestJson(tamperedCorpus)
      tamperedManifest.cases[0].content.files[0].path = badPath
      writeManifestJson(tamperedCorpus, tamperedManifest)
      expectBlindError(
        () =>
          materializeBlindCaseWorkspace({
            corpusRoot: tamperedCorpus,
            caseId: "case-01",
            destinationRoot: path.join(newScratch("dshbanca-180-allowlist-"), "case-01"),
          }),
        "invalid_allowlist_path",
      )
    }
  })

  test("recusa destino não vazio, symlink, relativo e sobreposição origem/destino", () => {
    const root = newScratch("dshbanca-180-dest-")

    const nonEmpty = path.join(root, "non-empty")
    mkdirSync(nonEmpty)
    writeFileSync(path.join(nonEmpty, "existing.txt"), "trabalho alheio")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: nonEmpty,
        }),
      "destination_not_empty",
    )
    expect(readFileSync(path.join(nonEmpty, "existing.txt"), "utf8")).toBe("trabalho alheio")

    const linkTarget = path.join(root, "target")
    mkdirSync(linkTarget)
    const linkDestination = path.join(root, "link-destination")
    symlinkSync(linkTarget, linkDestination)
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: linkDestination,
        }),
      "destination_symlink",
    )

    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: "relative-destination",
        }),
      "destination_not_absolute",
    )

    const insideCorpus = path.join(CORPUS_ROOT, "tmp-workspace")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: insideCorpus,
        }),
      "destination_overlap",
    )
    expect(existsSync(insideCorpus)).toBe(false)

    const corpusAncestor = path.resolve(CORPUS_ROOT, "..")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: corpusAncestor,
        }),
      "destination_overlap",
    )

    const fileDestination = path.join(root, "file-destination")
    writeFileSync(fileDestination, "arquivo")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: fileDestination,
        }),
      "destination_not_directory",
    )
  })

  test("aceita destino vazio pertencente ao chamador e publica sem sobrescrever", () => {
    const root = newScratch("dshbanca-180-empty-")
    const destination = path.join(root, "case-05")
    mkdirSync(destination)
    const workspace = materializeBlindCaseWorkspace({
      corpusRoot: CORPUS_ROOT,
      caseId: "case-05",
      destinationRoot: destination,
    })
    expect(workspace.workspaceRoot).toBe(destination)
    expect(workspace.workspaceFiles).toEqual(expectedWorkspaceFiles(manifest.cases[4]))
    expect(loadConfig(destination)).toEqual(buildProjectConfig(manifest.cases[4]))
  })

  test("recusa configuração ausente, adulterada e substituída por defaults", () => {
    const workspace = materialize("case-01")
    const configPath = path.join(
      workspace.workspaceRoot,
      ...BLIND_WORKSPACE_CONFIG_RELATIVE_PATH.split("/"),
    )
    const expected = buildProjectConfig(manifest.cases[0])

    // Ausente: `loadConfig` de produção cai silenciosamente em defaults (RED).
    rmSync(configPath)
    const silentDefaults = loadConfig(workspace.workspaceRoot)
    expect(silentDefaults.analysis.maxCharactersPerBatch).toBe(50_000)
    expect(silentDefaults.compile.enabled).toBe(true)
    expect(validateConfig(workspace.workspaceRoot).valid).toBe(false)
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: workspace.workspaceRoot }),
      "config_missing",
    )

    // Substituída por defaults de produção.
    writeFileSync(configPath, JSON.stringify(silentDefaults, null, 2))
    expect(validateConfig(workspace.workspaceRoot).valid).toBe(true)
    expect(loadConfig(workspace.workspaceRoot).analysis.maxCharactersPerBatch).toBe(50_000)
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: workspace.workspaceRoot }),
      "config_mismatch",
    )

    // Adulterada, mas ainda formalmente válida para `validateConfig`.
    const tampered = {
      ...expected,
      analysis: { ...expected.analysis!, maxCharactersPerBatch: 50_000 },
    }
    writeFileSync(configPath, JSON.stringify(tampered, null, 2))
    expect(validateConfig(workspace.workspaceRoot).valid).toBe(true)
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: workspace.workspaceRoot }),
      "config_mismatch",
    )

    // JSON inválido.
    writeFileSync(configPath, "{ invalid")
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: workspace.workspaceRoot }),
      "config_invalid",
    )

    // Config substituída por symlink externo.
    rmSync(configPath)
    const external = path.join(newScratch("dshbanca-180-config-ext-"), "project.json")
    writeFileSync(external, JSON.stringify(expected, null, 2))
    symlinkSync(external, configPath)
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-01", workspaceRoot: workspace.workspaceRoot }),
      "config_symlink",
    )
  })

  test("detecta estado acadêmico contaminado, histórico git e arquivos extras", () => {
    const base = materialize("case-02")
    const copyAndMutate = (mutate: (root: string) => void): string => {
      const copyRoot = path.join(newScratch("dshbanca-180-copy-"), "case-02")
      cpSync(base.workspaceRoot, copyRoot, { recursive: true })
      mutate(copyRoot)
      return copyRoot
    }

    const contaminatedState = copyAndMutate((root) => {
      mkdirSync(path.join(root, ".banca/analysis/checkpoints"), { recursive: true })
      writeFileSync(path.join(root, ".banca/analysis/checkpoints/plan.json"), "{}")
    })
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-02", workspaceRoot: contaminatedState }),
      "academic_state_contaminated",
    )

    const scorecardState = copyAndMutate((root) => {
      writeFileSync(path.join(root, ".banca/scorecard.md"), "nota")
    })
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-02", workspaceRoot: scorecardState }),
      "academic_state_contaminated",
    )

    const gitHistory = copyAndMutate((root) => {
      mkdirSync(path.join(root, ".git"))
      writeFileSync(path.join(root, ".git/HEAD"), "ref: refs/heads/x")
    })
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-02", workspaceRoot: gitHistory }),
      "git_history_present",
    )

    const extraFile = copyAndMutate((root) => {
      writeFileSync(path.join(root, "gabarito.json"), "{}")
    })
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-02", workspaceRoot: extraFile }),
      "workspace_extra_file",
    )

    const missingFile = copyAndMutate((root) => {
      rmSync(path.join(root, "secoes/metodo.tex"))
    })
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-02", workspaceRoot: missingFile }),
      "workspace_missing_file",
    )

    const changedHash = copyAndMutate((root) => {
      writeFileSync(path.join(root, "secoes/metodo.tex"), "adulterado")
    })
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-02", workspaceRoot: changedHash }),
      "workspace_hash_mismatch",
    )
  })

  test("não há vazamento de outro caso no workspace individual", () => {
    const fingerprints = manifest.cases.map((caseDef) => caseDef.content.manuscriptFingerprint)
    for (const caseDef of manifest.cases) {
      const workspace = sixWorkspaces.get(caseDef.id)
      if (workspace === undefined) throw new Error(`workspace ausente: ${caseDef.id}`)
      expect(workspace.loaded.fingerprint).toBe(caseDef.content.manuscriptFingerprint)
      expect(fingerprints.filter((fingerprint) => fingerprint === workspace.loaded.fingerprint).length).toBe(1)
      const manuscriptContents = workspace.workspaceFiles
        .filter((entry) => entry.endsWith(".tex") || entry.endsWith(".bib"))
        .map((entry) => readFileSync(path.join(workspace.workspaceRoot, ...entry.split("/")), "utf8"))
        .join("\n")
      for (const other of manifest.cases) {
        if (other.id === caseDef.id) continue
        expect(workspace.workspaceFiles.some((entry) => entry.includes(other.id))).toBe(false)
        expect(manuscriptContents).not.toContain(other.content.manuscriptFingerprint)
      }
    }
  })

  test("falha parcial limpa apenas artefatos próprios e nunca sobrescreve trabalho alheio", () => {
    // (a) Falha durante o staging: o destino nunca é criado.
    const rootA = newScratch("dshbanca-180-partial-a-")
    const destinationA = path.join(rootA, "case-01")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: destinationA,
          testHooks: {
            afterStagedFiles: (written) => {
              if (written === 2) throw new Error("injected staging failure")
            },
          },
        }),
      "injected_failure",
    )
    expect(existsSync(destinationA)).toBe(false)
    expect(readdirSync(rootA)).toEqual([])

    // (b) Trabalho alheio aparece no destino antes da publicação: é preservado.
    const rootB = newScratch("dshbanca-180-partial-b-")
    const destinationB = path.join(rootB, "case-01")
    mkdirSync(destinationB)
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: destinationB,
          testHooks: {
            beforePublish: () => {
              writeFileSync(path.join(destinationB, "trabalho-alheio.txt"), "preservar")
            },
          },
        }),
      "destination_not_empty",
    )
    expect(readFileSync(path.join(destinationB, "trabalho-alheio.txt"), "utf8")).toBe("preservar")
    expect(readdirSync(destinationB)).toEqual(["trabalho-alheio.txt"])
    expect(readdirSync(rootB)).toEqual(["case-01"])

    // (c) Falha durante a publicação: só as entradas publicadas são removidas.
    const rootC = newScratch("dshbanca-180-partial-c-")
    const destinationC = path.join(rootC, "case-01")
    expectBlindError(
      () =>
        materializeBlindCaseWorkspace({
          corpusRoot: CORPUS_ROOT,
          caseId: "case-01",
          destinationRoot: destinationC,
          testHooks: {
            afterPublishEntry: (_entry, index) => {
              if (index === 0) throw new Error("injected publication failure")
            },
          },
        }),
      "injected_failure",
    )
    expect(existsSync(destinationC)).toBe(false)
    expect(readdirSync(rootC)).toEqual([])

    // O corpus original continua intacto depois das falhas injetadas.
    expect(
      sha256Hex(readFileSync(path.join(CORPUS_ROOT, "manuscripts/case-01/main.tex"))),
    ).toBe(manifest.cases[0].content.files.find((file) => file.path === "main.tex")?.sha256)
  })

  test("verify revalida workspace íntegro e recusa raiz ausente ou caseId desconhecido", () => {
    const workspace = sixWorkspaces.get("case-04")
    if (workspace === undefined) throw new Error("workspace case-04 ausente")
    const verified = verifyBlindCaseWorkspace({
      caseId: "case-04",
      workspaceRoot: workspace.workspaceRoot,
    })
    expect(verified.report).toEqual(workspace.report)
    expect(verified.planId).toBe(workspace.planId)
    expect(verified.workspaceFiles).toEqual(workspace.workspaceFiles)
    expect(verified.equivalence).toEqual(workspace.equivalence)

    expectBlindError(
      () =>
        verifyBlindCaseWorkspace({
          caseId: "case-04",
          workspaceRoot: path.join(newScratch("dshbanca-180-missing-root-"), "nope"),
        }),
      "workspace_missing",
    )
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-04", workspaceRoot: "relative" }),
      "invalid_workspace_root",
    )
    expectBlindError(
      () => verifyBlindCaseWorkspace({ caseId: "case-99", workspaceRoot: workspace.workspaceRoot }),
      "unknown_case",
    )
  })

  test.skipIf(typeof process.getuid !== "function" || process.getuid() !== 0)(
    "recusa destino de outro dono quando a verificação de uid está disponível",
    () => {
      const root = newScratch("dshbanca-180-owner-")
      const destination = path.join(root, "case-01")
      mkdirSync(destination)
      chownSync(destination, 12345, 12345)
      expectBlindError(
        () =>
          materializeBlindCaseWorkspace({
            corpusRoot: CORPUS_ROOT,
            caseId: "case-01",
            destinationRoot: destination,
          }),
        "destination_not_owned",
      )
    },
  )
})
