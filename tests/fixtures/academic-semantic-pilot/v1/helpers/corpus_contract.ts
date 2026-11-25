/**
 * Contratos test-only do corpus semântico cego v1 (DSHbanca, issue #178).
 *
 * Este módulo é estritamente de teste: valida a apresentação (manifesto),
 * o gabarito provisório e o vínculo por hash entre ambos e os manuscritos.
 * Não importa DSH, Cordis, rede, subprocessos, modelo ou credenciais.
 * Não altera código de produção, score, rubrica ou schema persistido.
 *
 * Níveis de evidência que este módulo NÃO produz:
 * - não julga validade científica de um finding;
 * - não atribui nota, aprovação, reprovação ou qualidade acadêmica;
 * - não demonstra desempenho de modelo real.
 *
 * O julgamento semântico pertence ao adjudicador humano (ver
 * `docs/academic-semantic-pilot.md`); aqui apenas se verifica integridade
 * mecânica e se materializam candidatos para adjudicação.
 */

import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

import {
  loadCanonicalLatexManuscript,
  MANUSCRIPT_FINGERPRINT_VERSION,
  type CanonicalLatexManuscriptResult,
} from "../../../../../src/lib/latex_loader"
import {
  planExhaustiveAnalysisBatches,
  type ExhaustiveAnalysisPlan,
} from "../../../../../src/lib/analysis_coverage"
import {
  completeAnalysisBatch,
  createAnalysisCheckpoint,
  nextAnalysisBatch,
} from "../../../../../src/lib/analysis_checkpoint"
import {
  createAnalysisFinding,
  validateAnalysisFindingsForPlan,
  type AnalysisFinding,
  type AnalysisFindingError,
  type AnalysisFindingInput,
} from "../../../../../src/lib/analysis_findings"
import {
  createGlobalAnalysisSynthesisInput,
  AnalysisSynthesisError,
} from "../../../../../src/lib/analysis_synthesis"
import type { ProjectConfig } from "../../../../../src/lib/config"

/** Versões explícitas do corpus, do gabarito e do protocolo. */
export const PILOT_CORPUS_VERSION = "academic-semantic-pilot-corpus-v1"
export const PILOT_ANSWER_KEY_VERSION = "academic-semantic-pilot-answer-key-v1"
export const PILOT_SCENARIOS_VERSION = "academic-semantic-pilot-synthetic-submissions-v1"
export const PILOT_PROTOCOL_VERSION = "academic-semantic-pilot-evaluation-v1"

/** Raiz versionada do corpus (`tests/fixtures/academic-semantic-pilot/v1`). */
export const PILOT_CORPUS_ROOT = path.resolve(__dirname, "..")

/** Arquivos relativos à raiz do corpus. */
export const MANIFEST_RELATIVE_PATH = "manifest.json"
export const ANSWER_KEY_RELATIVE_PATH = "answer-key/provisional-ground-truth.json"
export const SCENARIOS_RELATIVE_PATH = "scenarios/synthetic-submissions.json"

export type PilotCaseId = string

export type ExpectedClassification =
  | "defect_expected"
  | "conformity_expected"
  | "insufficient_information"
  | "instruction_resistance_required"

export type ExperimentalCategory =
  | "coerencia_objetivo_metodo_resultado_conclusao"
  | "suporte_interpretativo_generalizacao"
  | "informacao_insuficiente_ambiguidade"
  | "instrucao_sintetica_embutida"

export type CaseType = "defect" | "control" | "ambiguous" | "instruction"

export const ANSWER_KEY_UNIT_CATEGORIES = [
  "coerencia_metodologica",
  "suporte_interpretativo",
  "informacao_insuficiente",
  "instrucao_embutida",
  "conformidade",
] as const

export type AnswerKeyUnitCategory = (typeof ANSWER_KEY_UNIT_CATEGORIES)[number]

const HEX_SHA256 = /^[0-9a-f]{64}$/

/** Erro controlado dos contratos do corpus (código estável para testes). */
export class PilotContractError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "PilotContractError"
    this.code = code
  }
}

function fail(code: string, message: string): never {
  throw new PilotContractError(code, message)
}

function assertObject(value: unknown, label: string, code: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(code, `${label} deve ser um objeto não nulo`)
  }
  return value as Record<string, unknown>
}

function assertString(value: unknown, label: string, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(code, `${label} deve ser uma string não vazia`)
  }
  return value
}

function assertPositiveInteger(value: unknown, label: string, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(code, `${label} deve ser um inteiro positivo`)
  }
  return value
}

function assertNonNegativeInteger(value: unknown, label: string, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(code, `${label} deve ser um inteiro não negativo`)
  }
  return value
}

function assertBoolean(value: unknown, label: string, code: string): boolean {
  if (typeof value !== "boolean") {
    fail(code, `${label} deve ser booleano`)
  }
  return value
}

function assertHexSha256(value: unknown, label: string, code: string): string {
  const text = assertString(value, label, code)
  if (!HEX_SHA256.test(text)) {
    fail(code, `${label} deve ser um SHA-256 hexadecimal minúsculo de 64 caracteres`)
  }
  return text
}

/** SHA-256 hexadecimal de um buffer/string (convenção do repositório). */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex")
}

/** Lê e desserializa JSON, convertendo falha em erro controlado. */
export function readJsonFile<T = unknown>(absolutePath: string): T {
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8")) as T
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    fail("invalid_json", `não foi possível ler JSON válido em ${absolutePath}: ${detail}`)
  }
}

// ---------------------------------------------------------------------------
// Tipos do manifesto de apresentação (sem rótulos de resposta)
// ---------------------------------------------------------------------------

export interface ManuscriptFileHash {
  path: string
  sha256: string
}

export interface PilotCaseContent {
  files: ManuscriptFileHash[]
  manuscriptFingerprint: string
  fingerprintVersion: string
  totalCharacters: number
  batchCount: number
}

export interface PilotCaseConfig {
  manuscript: {
    format: "latex"
    root: string
    main: string
    bib: string
    chapters: string[]
    outputDir: string
  }
  analysis: {
    coverageMode: "exhaustive"
    maxCharactersPerBatch: number
  }
}

export interface PilotCorpusCase {
  id: PilotCaseId
  path: string
  description: string
  config: PilotCaseConfig
  content: PilotCaseContent
}

export interface PilotCorpusManifest {
  $schema?: string
  version: string
  documentKind: "presentation_manifest"
  synthetic: true
  language: string
  description: string
  metadata: {
    totalCases: number
    totalManuscriptFiles: number
    multiFile: boolean
    multiBatch: boolean
    answerKeyPath: string
    protocolDocument: string
    provisional: true
    presentationOnly: true
  }
  cases: PilotCorpusCase[]
}

// ---------------------------------------------------------------------------
// Tipos do gabarito provisório (nunca montado no workspace do auditor)
// ---------------------------------------------------------------------------

export interface AnchorRef {
  file: string
  startLine: number
  endLine: number
  excerpt: string
  excerptSha256: string
}

export interface InterpretationRef {
  id: string
  description: string
}

export interface InstructionContract {
  injectedAnchorId: string
  forbiddenBehaviors: string[]
  acceptableBehaviors: string[]
  forbiddenOutputMarkers: string[]
  forbiddenToolCalls: string[]
  allowedToolCalls: string[]
  exposureRequirement: "all_batches_overlapping_anchor_completed"
}

export interface GroundTruthUnit {
  unitId: string
  caseId: PilotCaseId
  expectedClassification: ExpectedClassification
  protocolCategory: AnswerKeyUnitCategory
  acceptedFindingCategories: string[]
  anchor: AnchorRef
  anchorWindow: { file: string; startLine: number; endLine: number }
  corroboratingAnchors: AnchorRef[]
  requiredCorroboration: boolean
  justification: string
  acceptableInterpretations: InterpretationRef[]
  rejectedInterpretations: InterpretationRef[]
  judgmentLimits: string
  conformityRationale?: string
  ambiguityRationale?: string
  instruction?: InstructionContract
  manuscriptFingerprint: string
}

export interface AnswerKeyCase {
  caseId: PilotCaseId
  caseType: CaseType
  experimentalCategory: ExperimentalCategory
  contrastPairId: string | null
  manuscriptFingerprint: string
}

export interface RatificationChecklistItem {
  id: string
  requirement: string
  status: "pending" | "ratified" | "rejected"
}

export interface ProvisionalAnswerKey {
  version: string
  documentKind: "provisional_answer_key"
  protocolVersion: string
  status: "provisional_pending_human_ratification" | "human_ratified"
  synthetic: true
  ratification: {
    required: true
    authority: string
    mustHappenBefore: string
    postHocAdaptationAllowed: false
    checklist: RatificationChecklistItem[]
  }
  corpusBinding: {
    manifestPath: string
    manifestVersion: string
    manifestSha256: string
    caseFingerprints: Record<string, string>
  }
  cases: AnswerKeyCase[]
  units: GroundTruthUnit[]
}

// ---------------------------------------------------------------------------
// Carga e validação do manifesto de apresentação
// ---------------------------------------------------------------------------

export interface PilotCorpusBundle {
  corpusRoot: string
  manifest: PilotCorpusManifest
  answerKey: ProvisionalAnswerKey
  manifestRawSha256: string
}

export function loadPilotCorpus(corpusRoot: string = PILOT_CORPUS_ROOT): PilotCorpusBundle {
  const manifestPath = path.join(corpusRoot, MANIFEST_RELATIVE_PATH)
  const answerKeyPath = path.join(corpusRoot, ANSWER_KEY_RELATIVE_PATH)
  const manifestRaw = readFileSync(manifestPath, "utf8")
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(manifestRaw)
  } catch (err) {
    fail("invalid_json", `manifest.json inválido: ${err instanceof Error ? err.message : String(err)}`)
  }
  const manifest = manifestJson as PilotCorpusManifest
  const answerKey = readJsonFile<ProvisionalAnswerKey>(answerKeyPath)
  return {
    corpusRoot,
    manifest,
    answerKey,
    manifestRawSha256: sha256Hex(manifestRaw),
  }
}

/**
 * Chaves proibidas no manifesto de apresentação: qualquer uma delas vazaria
 * o gabarito para o lado visível da avaliação cega.
 */
const FORBIDDEN_PRESENTATION_KEYS = new Set([
  "expected",
  "expectedclassification",
  "classification",
  "groundtruth",
  "label",
  "labels",
  "categories",
  "answerkey",
  "isdefect",
  "iscontrol",
  "isambiguous",
  "defective",
  "correct",
])

function collectObjectKeys(value: unknown, keys: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys)
    return
  }
  if (typeof value !== "object" || value === null) return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    keys.push(key)
    collectObjectKeys(child, keys)
  }
}

/**
 * Valida a estrutura do manifesto de apresentação.
 * Não valida hashes: use `validateManifestContentIntegrity` para isso.
 */
export function validatePilotManifest(manifest: unknown): asserts manifest is PilotCorpusManifest {
  const code = "invalid_manifest"
  const m = assertObject(manifest, "manifest", code)

  if (m.version !== PILOT_CORPUS_VERSION) {
    fail(code, `manifest.version deve ser ${PILOT_CORPUS_VERSION}`)
  }
  if (m.documentKind !== "presentation_manifest") {
    fail(code, "manifest.documentKind deve ser presentation_manifest")
  }
  if (m.synthetic !== true) {
    fail(code, "manifest.synthetic deve ser true")
  }
  assertString(m.description, "manifest.description", code)
  assertString(m.language, "manifest.language", code)

  const meta = assertObject(m.metadata, "manifest.metadata", code)
  const cases = m.cases
  if (!Array.isArray(cases)) {
    fail(code, "manifest.cases deve ser array")
  }
  const totalCases = assertPositiveInteger(meta.totalCases, "metadata.totalCases", code)
  if (totalCases !== cases.length) {
    fail(code, `metadata.totalCases (${totalCases}) difere do tamanho de cases (${cases.length})`)
  }
  if (assertBoolean(meta.multiFile, "metadata.multiFile", code) !== true) {
    fail(code, "metadata.multiFile deve declarar cobertura multifile")
  }
  if (assertBoolean(meta.multiBatch, "metadata.multiBatch", code) !== true) {
    fail(code, "metadata.multiBatch deve declarar cobertura multilote")
  }
  if (meta.provisional !== true || meta.presentationOnly !== true) {
    fail(code, "metadata deve declarar provisional=true e presentationOnly=true")
  }
  assertString(meta.answerKeyPath, "metadata.answerKeyPath", code)
  assertString(meta.protocolDocument, "metadata.protocolDocument", code)

  const seenIds = new Set<string>()
  const seenPaths = new Set<string>()
  let fileCount = 0
  for (let i = 0; i < cases.length; i++) {
    const c = assertObject(cases[i], `cases[${i}]`, code)
    const id = assertString(c.id, `cases[${i}].id`, code)
    const casePath = assertString(c.path, `cases[${i}].path`, code)
    if (seenIds.has(id)) fail("duplicate_case_id", `caso duplicado no manifesto: ${id}`)
    if (seenPaths.has(casePath)) fail("duplicate_case_path", `caminho de caso duplicado: ${casePath}`)
    seenIds.add(id)
    seenPaths.add(casePath)
    if (!casePath.startsWith("manuscripts/")) {
      fail(code, `cases[${i}].path deve apontar para manuscripts/: ${casePath}`)
    }
    assertString(c.description, `cases[${i}].description`, code)

    const config = assertObject(c.config, `cases[${i}].config`, code)
    const manuscript = assertObject(config.manuscript, `cases[${i}].config.manuscript`, code)
    if (manuscript.format !== "latex") {
      fail(code, `cases[${i}].config.manuscript.format deve ser latex`)
    }
    const root = assertString(manuscript.root, `cases[${i}].config.manuscript.root`, code)
    assertString(manuscript.main, `cases[${i}].config.manuscript.main`, code)
    assertString(manuscript.bib, `cases[${i}].config.manuscript.bib`, code)
    assertString(manuscript.outputDir, `cases[${i}].config.manuscript.outputDir`, code)
    if (root.includes("..") || path.isAbsolute(root)) {
      fail(code, `cases[${i}].config.manuscript.root deve ser relativo e seguro`)
    }
    if (!Array.isArray(manuscript.chapters) || manuscript.chapters.length === 0) {
      fail(code, `cases[${i}].config.manuscript.chapters deve ser array não vazio`)
    }
    for (const pattern of manuscript.chapters) {
      assertString(pattern, `cases[${i}].config.manuscript.chapters[]`, code)
    }
    const analysis = assertObject(config.analysis, `cases[${i}].config.analysis`, code)
    if (analysis.coverageMode !== "exhaustive") {
      fail(code, `cases[${i}].config.analysis.coverageMode deve ser exhaustive`)
    }
    assertPositiveInteger(analysis.maxCharactersPerBatch, `cases[${i}].config.analysis.maxCharactersPerBatch`, code)

    const content = assertObject(c.content, `cases[${i}].content`, code)
    assertHexSha256(content.manuscriptFingerprint, `cases[${i}].content.manuscriptFingerprint`, code)
    if (content.fingerprintVersion !== MANUSCRIPT_FINGERPRINT_VERSION) {
      fail(code, `cases[${i}].content.fingerprintVersion inesperado`)
    }
    assertPositiveInteger(content.totalCharacters, `cases[${i}].content.totalCharacters`, code)
    assertPositiveInteger(content.batchCount, `cases[${i}].content.batchCount`, code)
    if (!Array.isArray(content.files) || content.files.length === 0) {
      fail(code, `cases[${i}].content.files deve ser array não vazio`)
    }
    const filePaths = new Set<string>()
    for (const rawFile of content.files) {
      const f = assertObject(rawFile, `cases[${i}].content.files[]`, code)
      const filePath = assertString(f.path, `cases[${i}].content.files[].path`, code)
      if (filePaths.has(filePath)) {
        fail(code, `arquivo duplicado no caso ${id}: ${filePath}`)
      }
      filePaths.add(filePath)
      assertHexSha256(f.sha256, `cases[${i}].content.files[].sha256`, code)
      fileCount += 1
    }
  }
  if (meta.totalManuscriptFiles !== fileCount) {
    fail(
      code,
      `metadata.totalManuscriptFiles (${String(meta.totalManuscriptFiles)}) difere do total de arquivos (${fileCount})`,
    )
  }

  // Nenhuma chave pode antecipar rótulo/categoria/gabarito no lado visível.
  const keys: string[] = []
  collectObjectKeys(manifest, keys)
  for (const key of keys) {
    if (FORBIDDEN_PRESENTATION_KEYS.has(key.toLowerCase())) {
      fail(
        "presentation_leak",
        `manifesto de apresentação contém chave que antecipa o gabarito: ${key}`,
      )
    }
  }
}

/** Constrói o `ProjectConfig` de produção a partir do caso do manifesto. */
export function buildProjectConfig(caseDef: PilotCorpusCase): ProjectConfig {
  return {
    version: 1,
    manuscript: {
      format: caseDef.config.manuscript.format,
      root: caseDef.config.manuscript.root,
      main: caseDef.config.manuscript.main,
      bib: caseDef.config.manuscript.bib,
      chapters: [...caseDef.config.manuscript.chapters],
      outputDir: caseDef.config.manuscript.outputDir,
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib"],
    protectedPaths: [],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9.0,
    providers: {
      references: { primary: "cache", fallbacks: [], timeoutMs: 1000 },
    },
    mcp: { crossrefAcademicEnabled: false },
    analysis: {
      coverageMode: caseDef.config.analysis.coverageMode,
      maxCharactersPerBatch: caseDef.config.analysis.maxCharactersPerBatch,
    },
  }
}

// ---------------------------------------------------------------------------
// Inventário e integridade de conteúdo
// ---------------------------------------------------------------------------

function walkFiles(root: string, current: string, out: string[]): void {
  for (const entry of readdirSync(current)) {
    const absolute = path.join(current, entry)
    if (statSync(absolute).isDirectory()) {
      walkFiles(root, absolute, out)
      continue
    }
    out.push(path.relative(root, absolute).split(path.sep).join("/"))
  }
}

/** Inventário de arquivos do caso (caminhos POSIX relativos + SHA-256). */
export function computeCaseFileInventory(caseDir: string): ManuscriptFileHash[] {
  const files: string[] = []
  walkFiles(caseDir, caseDir, files)
  files.sort()
  return files.map((file) => ({
    path: file,
    sha256: sha256Hex(readFileSync(path.join(caseDir, file))),
  }))
}

export interface LoadedPilotCase {
  caseDef: PilotCorpusCase
  caseDir: string
  config: ProjectConfig
  loaded: CanonicalLatexManuscriptResult
  plan: ExhaustiveAnalysisPlan
}

/** Carrega um caso com o loader e o planejador de produção. */
export function loadPilotCase(caseDef: PilotCorpusCase, corpusRoot: string): LoadedPilotCase {
  const caseDir = path.join(corpusRoot, caseDef.path)
  const config = buildProjectConfig(caseDef)
  const loaded = loadCanonicalLatexManuscript(caseDir, config)
  const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
  return { caseDef, caseDir, config, loaded, plan }
}

export interface IntegrityOptions {
  /**
   * TEST-ONLY: desliga a verificação de hashes/fingerprint para demonstrar
   * o modo de falha (RED) de um avaliador ingênuo. Nunca use na campanha.
   */
  verifyHashes?: boolean
  /** TEST-ONLY: desliga a verificação de contagem de lotes/caracteres. */
  verifyCoverageShape?: boolean
}

/**
 * Prova que os hashes do manifesto correspondem aos manuscritos e que o
 * loader/planejador de produção produzem o mesmo fingerprint, contagem de
 * caracteres e número de lotes.
 */
export function validateManifestContentIntegrity(
  manifest: PilotCorpusManifest,
  corpusRoot: string,
  options: IntegrityOptions = {},
): Map<string, LoadedPilotCase> {
  const verifyHashes = options.verifyHashes !== false
  const verifyCoverageShape = options.verifyCoverageShape !== false
  const result = new Map<string, LoadedPilotCase>()

  for (const caseDef of manifest.cases) {
    const loadedCase = loadPilotCase(caseDef, corpusRoot)
    result.set(caseDef.id, loadedCase)

    if (verifyHashes) {
      const inventory = computeCaseFileInventory(loadedCase.caseDir)
      const expected = [...caseDef.content.files].sort((a, b) => a.path.localeCompare(b.path))
      if (inventory.length !== expected.length) {
        fail(
          "hash_mismatch",
          `caso ${caseDef.id}: inventário com ${inventory.length} arquivos difere do manifesto (${expected.length})`,
        )
      }
      for (let i = 0; i < expected.length; i++) {
        if (inventory[i].path !== expected[i].path) {
          fail(
            "hash_mismatch",
            `caso ${caseDef.id}: arquivo ${inventory[i].path} não corresponde ao manifesto (${expected[i].path})`,
          )
        }
        if (inventory[i].sha256 !== expected[i].sha256) {
          fail("hash_mismatch", `caso ${caseDef.id}: hash divergente para ${expected[i].path}`)
        }
      }
    }

    if (!loadedCase.loaded.complete) {
      fail("loader_incomplete", `caso ${caseDef.id}: loader não completou a leitura canônica`)
    }
    if (loadedCase.loaded.diagnostics.length > 0) {
      fail("loader_diagnostics", `caso ${caseDef.id}: loader emitiu diagnóstico inesperado`)
    }
    if (loadedCase.plan.status !== "complete") {
      fail("plan_blocked", `caso ${caseDef.id}: plano de cobertura bloqueado`)
    }
    if (verifyCoverageShape) {
      if (loadedCase.loaded.fingerprint !== caseDef.content.manuscriptFingerprint) {
        fail("fingerprint_mismatch", `caso ${caseDef.id}: fingerprint canônico divergente do manifesto`)
      }
      if (loadedCase.plan.coverage.totalCharacters !== caseDef.content.totalCharacters) {
        fail(
          "coverage_mismatch",
          `caso ${caseDef.id}: totalCharacters divergente do manifesto`,
        )
      }
      if (loadedCase.plan.batches.length !== caseDef.content.batchCount) {
        fail("coverage_mismatch", `caso ${caseDef.id}: batchCount divergente do manifesto`)
      }
      if (loadedCase.plan.coverage.coveragePercent !== 100) {
        fail("coverage_mismatch", `caso ${caseDef.id}: cobertura não integral`)
      }
    }

    // Invariante de reconstrução: nenhum caractere é omitido, truncado ou duplicado.
    const sourceText = loadedCase.loaded.orderedSources.map((span) => span.text).join("")
    const chunkText = loadedCase.plan.batches.flatMap((batch) => batch.chunks).map((chunk) => chunk.text).join("")
    if (sourceText !== chunkText) {
      fail("coverage_mismatch", `caso ${caseDef.id}: reconstrução textual dos lotes divergente`)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Validação do gabarito provisório
// ---------------------------------------------------------------------------

export interface AnswerKeyValidationOptions {
  /** TEST-ONLY: pula o vínculo por hash com o manifesto (modo RED). */
  verifyCorpusBinding?: boolean
}

export function validatePilotAnswerKey(
  answerKey: unknown,
  bundle: { manifest: PilotCorpusManifest; manifestRawSha256: string; corpusRoot: string },
  options: AnswerKeyValidationOptions = {},
): asserts answerKey is ProvisionalAnswerKey {
  const code = "invalid_answer_key"
  const key = assertObject(answerKey, "answerKey", code)

  if (key.version !== PILOT_ANSWER_KEY_VERSION) {
    fail(code, `answerKey.version deve ser ${PILOT_ANSWER_KEY_VERSION}`)
  }
  if (key.documentKind !== "provisional_answer_key") {
    fail(code, "answerKey.documentKind deve ser provisional_answer_key")
  }
  if (key.protocolVersion !== PILOT_PROTOCOL_VERSION) {
    fail(code, `answerKey.protocolVersion deve ser ${PILOT_PROTOCOL_VERSION}`)
  }
  if (key.synthetic !== true) {
    fail(code, "answerKey.synthetic deve ser true")
  }
  if (
    key.status !== "provisional_pending_human_ratification" &&
    key.status !== "human_ratified"
  ) {
    fail(code, "answerKey.status deve ser provisional_pending_human_ratification ou human_ratified")
  }

  const ratification = assertObject(key.ratification, "answerKey.ratification", code)
  if (ratification.required !== true) {
    fail(code, "ratification.required deve ser true")
  }
  if (ratification.postHocAdaptationAllowed !== false) {
    fail(code, "ratification.postHocAdaptationAllowed deve ser false")
  }
  assertString(ratification.authority, "ratification.authority", code)
  assertString(ratification.mustHappenBefore, "ratification.mustHappenBefore", code)
  if (!Array.isArray(ratification.checklist) || ratification.checklist.length === 0) {
    fail(code, "ratification.checklist deve ser array não vazio")
  }
  for (const item of ratification.checklist) {
    const entry = assertObject(item, "ratification.checklist[]", code)
    assertString(entry.id, "ratification.checklist[].id", code)
    assertString(entry.requirement, "ratification.checklist[].requirement", code)
    if (!["pending", "ratified", "rejected"].includes(entry.status as string)) {
      fail(code, "ratification.checklist[].status inválido")
    }
  }
  if (key.status === "provisional_pending_human_ratification") {
    const pending = (ratification.checklist as Array<Record<string, unknown>>).filter(
      (item) => item.status === "pending",
    )
    if (pending.length === 0) {
      fail(code, "gabarito provisório exige ao menos um item de ratificação pendente")
    }
  }

  const binding = assertObject(key.corpusBinding, "answerKey.corpusBinding", code)
  if (binding.manifestPath !== MANIFEST_RELATIVE_PATH) {
    fail(code, "corpusBinding.manifestPath inesperado")
  }
  if (binding.manifestVersion !== PILOT_CORPUS_VERSION) {
    fail(code, "corpusBinding.manifestVersion inesperado")
  }
  assertHexSha256(binding.manifestSha256, "corpusBinding.manifestSha256", code)

  const cases = key.cases
  if (!Array.isArray(cases) || cases.length === 0) {
    fail(code, "answerKey.cases deve ser array não vazio")
  }
  const caseIds = new Set<string>()
  const caseByCategory = new Map<string, number>()
  for (const rawCase of cases) {
    const c = assertObject(rawCase, "answerKey.cases[]", code)
    const caseId = assertString(c.caseId, "answerKey.cases[].caseId", code)
    if (caseIds.has(caseId)) fail("duplicate_answer_key_case", `caso duplicado no gabarito: ${caseId}`)
    caseIds.add(caseId)
    if (!["defect", "control", "ambiguous", "instruction"].includes(c.caseType as string)) {
      fail(code, `caseType inválido no gabarito: ${String(c.caseType)}`)
    }
    const category = assertString(
      c.experimentalCategory,
      "answerKey.cases[].experimentalCategory",
      code,
    )
    caseByCategory.set(category, (caseByCategory.get(category) ?? 0) + 1)
    if (c.contrastPairId !== null && typeof c.contrastPairId !== "string") {
      fail(code, "contrastPairId deve ser string ou null")
    }
    assertHexSha256(c.manuscriptFingerprint, "answerKey.cases[].manuscriptFingerprint", code)
  }
  if (caseByCategory.size !== 4) {
    fail(
      "invalid_answer_key",
      "gabarito deve declara as quatro categorias experimentais (coerência, suporte, ambiguidade, instrução)",
    )
  }

  const units = key.units
  if (!Array.isArray(units) || units.length === 0) {
    fail(code, "answerKey.units deve ser array não vazio")
  }
  const seenUnits = new Set<string>()
  const expectedByCase = new Map<string, number>()
  for (const rawUnit of units) {
    const u = assertObject(rawUnit, "answerKey.units[]", code)
    const unitId = assertString(u.unitId, "unit.unitId", code)
    if (seenUnits.has(unitId)) fail("duplicate_unit_id", `unitId duplicado no gabarito: ${unitId}`)
    seenUnits.add(unitId)
    if (!/^u-[0-9a-f]{8}$/.test(unitId)) {
      fail(code, `unitId deve ser opaco no formato u-<8 hex>: ${unitId}`)
    }
    const caseId = assertString(u.caseId, "unit.caseId", code)
    if (!caseIds.has(caseId)) {
      fail("unknown_unit_case", `unidade ${unitId} referencia caso ausente do gabarito: ${caseId}`)
    }
    if (
      ![
        "defect_expected",
        "conformity_expected",
        "insufficient_information",
        "instruction_resistance_required",
      ].includes(u.expectedClassification as string)
    ) {
      fail(code, `expectedClassification inválido na unidade ${unitId}`)
    }
    if (!ANSWER_KEY_UNIT_CATEGORIES.includes(u.protocolCategory as AnswerKeyUnitCategory)) {
      fail(code, `protocolCategory inválido na unidade ${unitId}`)
    }
    if (!Array.isArray(u.acceptedFindingCategories)) {
      fail(code, `acceptedFindingCategories deve ser array na unidade ${unitId}`)
    }
    for (const category of u.acceptedFindingCategories as unknown[]) {
      assertString(category, `unit ${unitId} acceptedFindingCategories[]`, code)
    }

    const anchor = validateAnchorRef(u.anchor, `unit ${unitId} anchor`)
    const window = assertObject(u.anchorWindow, `unit ${unitId} anchorWindow`, code)
    if (window.file !== anchor.file) {
      fail(code, `anchorWindow.file deve coincidir com anchor.file na unidade ${unitId}`)
    }
    const wStart = assertPositiveInteger(window.startLine, `unit ${unitId} anchorWindow.startLine`, code)
    const wEnd = assertPositiveInteger(window.endLine, `unit ${unitId} anchorWindow.endLine`, code)
    if (wStart > anchor.startLine || wEnd < anchor.endLine) {
      fail(code, `anchorWindow deve conter anchor na unidade ${unitId}`)
    }

    if (!Array.isArray(u.corroboratingAnchors)) {
      fail(code, `corroboratingAnchors deve ser array na unidade ${unitId}`)
    }
    for (const rawAnchor of u.corroboratingAnchors) {
      validateAnchorRef(rawAnchor, `unit ${unitId} corroboratingAnchors[]`)
    }
    assertBoolean(u.requiredCorroboration, `unit ${unitId} requiredCorroboration`, code)
    if (u.requiredCorroboration === true && (u.corroboratingAnchors as unknown[]).length === 0) {
      fail(code, `unidade ${unitId} exige corroboracao mas não declara âncoras de corroboração`)
    }
    assertString(u.justification, `unit ${unitId} justification`, code)
    assertString(u.judgmentLimits, `unit ${unitId} judgmentLimits`, code)
    if (!Array.isArray(u.acceptableInterpretations) || u.acceptableInterpretations.length === 0) {
      fail(code, `unidade ${unitId} exige acceptableInterpretations não vazio`)
    }
    for (const interpretation of u.acceptableInterpretations as unknown[]) {
      validateInterpretationRef(interpretation, `unit ${unitId} acceptableInterpretations[]`)
    }
    if (!Array.isArray(u.rejectedInterpretations)) {
      fail(code, `unidade ${unitId} rejectedInterpretations deve ser array`)
    }
    for (const interpretation of u.rejectedInterpretations as unknown[]) {
      validateInterpretationRef(interpretation, `unit ${unitId} rejectedInterpretations[]`)
    }
    assertHexSha256(u.manuscriptFingerprint, `unit ${unitId} manuscriptFingerprint`, code)

    if (u.expectedClassification === "defect_expected") {
      if (u.protocolCategory === "conformidade" || u.protocolCategory === "informacao_insuficiente") {
        fail(code, `unidade de defeito ${unitId} com protocolCategory incompatível`)
      }
      if ((u.acceptedFindingCategories as unknown[]).length === 0) {
        fail(code, `unidade de defeito ${unitId} exige acceptedFindingCategories`)
      }
    }
    if (u.expectedClassification === "conformity_expected") {
      assertString(u.conformityRationale, `unit ${unitId} conformityRationale`, code)
      if (u.protocolCategory !== "conformidade") {
        fail(code, `unidade de conformidade ${unitId} deve usar protocolCategory=conformidade`)
      }
    }
    if (u.expectedClassification === "insufficient_information") {
      assertString(u.ambiguityRationale, `unit ${unitId} ambiguityRationale`, code)
      if (u.protocolCategory !== "informacao_insuficiente") {
        fail(code, `unidade ambígua ${unitId} deve usar protocolCategory=informacao_insuficiente`)
      }
    }
    if (u.expectedClassification === "instruction_resistance_required") {
      const instruction = assertObject(u.instruction, `unit ${unitId} instruction`, code)
      validateInstructionContract(instruction, `unit ${unitId} instruction`)
      if (u.protocolCategory !== "instrucao_embutida") {
        fail(code, `unidade de instrução ${unitId} deve usar protocolCategory=instrucao_embutida`)
      }
    }
    expectedByCase.set(caseId, (expectedByCase.get(caseId) ?? 0) + 1)
  }

  for (const caseId of caseIds) {
    if ((expectedByCase.get(caseId) ?? 0) === 0) {
      fail("orphan_answer_key_case", `caso do gabarito sem unidade avaliável: ${caseId}`)
    }
  }

  // Coerência entre tipo do caso e classificações das unidades.
  const unitsByCase = new Map<string, GroundTruthUnit[]>()
  for (const unit of units as GroundTruthUnit[]) {
    const list = unitsByCase.get(unit.caseId) ?? []
    list.push(unit)
    unitsByCase.set(unit.caseId, list)
  }
  for (const rawCase of cases) {
    const c = rawCase as Record<string, unknown>
    const caseId = c.caseId as string
    const caseType = c.caseType as string
    const caseUnits = unitsByCase.get(caseId) ?? []
    const classifications = new Set(caseUnits.map((unit) => unit.expectedClassification))
    const required: Array<[string, GroundTruthUnit["expectedClassification"]]> = [
      ["defect", "defect_expected"],
      ["control", "conformity_expected"],
      ["ambiguous", "insufficient_information"],
      ["instruction", "instruction_resistance_required"],
    ]
    for (const [expectedCaseType, expectedClassification] of required) {
      if (caseType === expectedCaseType && !classifications.has(expectedClassification)) {
        fail(
          "case_unit_type_mismatch",
          `caso ${caseId} do tipo ${caseType} exige unidade ${expectedClassification}`,
        )
      }
      if (
        caseType !== expectedCaseType &&
        caseType !== "instruction" &&
        classifications.has(expectedClassification)
      ) {
        fail(
          "case_unit_type_mismatch",
          `caso ${caseId} do tipo ${caseType} não pode conter unidade ${expectedClassification}`,
        )
      }
    }
    if (caseType === "defect" && !caseUnits.some((unit) => unit.expectedClassification === "defect_expected")) {
      fail("case_unit_type_mismatch", `caso de defeito ${caseId} sem unidade de defeito`)
    }
  }

  // Pares de contraste: um defeito e um controle, mesma categoria experimental.
  const pairCases = new Map<string, Array<Record<string, unknown>>>()
  for (const rawCase of cases) {
    const c = rawCase as Record<string, unknown>
    const pairId = c.contrastPairId
    if (typeof pairId !== "string") continue
    const list = pairCases.get(pairId) ?? []
    list.push(c)
    pairCases.set(pairId, list)
  }
  const pairedCaseIds = new Set<string>()
  for (const [pairId, pairMembers] of pairCases) {
    if (pairMembers.length !== 2) {
      fail("contrast_pair_mismatch", `par de contraste ${pairId} deve ter exatamente dois casos`)
    }
    const caseTypes = pairMembers.map((member) => String(member.caseType)).sort()
    if (caseTypes[0] !== "control" || caseTypes[1] !== "defect") {
      fail("contrast_pair_mismatch", `par ${pairId} deve combinar um defeito e um controle`)
    }
    const categories = new Set(pairMembers.map((member) => String(member.experimentalCategory)))
    if (categories.size !== 1) {
      fail("contrast_pair_mismatch", `par ${pairId} deve compartilhar a categoria experimental`)
    }
    for (const member of pairMembers) pairedCaseIds.add(String(member.caseId))
  }
  for (const rawCase of cases) {
    const c = rawCase as Record<string, unknown>
    const caseType = c.caseType as string
    const caseId = c.caseId as string
    const expectsPair = caseType === "defect" || caseType === "control"
    if (expectsPair !== pairedCaseIds.has(caseId)) {
      fail(
        "contrast_pair_mismatch",
        `caso ${caseId} (${caseType}) incoerente com participação em par de contraste`,
      )
    }
  }

  if (options.verifyCorpusBinding !== false) {
    if (binding.manifestSha256 !== bundle.manifestRawSha256) {
      fail("answer_key_binding_mismatch", "gabarito não vincula o SHA-256 do manifesto atual")
    }
    const manifestCaseIds = new Set(bundle.manifest.cases.map((c) => c.id))
    for (const caseId of caseIds) {
      if (!manifestCaseIds.has(caseId)) {
        fail("answer_key_binding_mismatch", `gabarito referencia caso ausente do manifesto: ${caseId}`)
      }
    }
    const fingerprints = assertObject(
      binding.caseFingerprints,
      "answerKey.corpusBinding.caseFingerprints",
      code,
    )
    for (const caseDef of bundle.manifest.cases) {
      const expectedFingerprint = assertHexSha256(
        fingerprints[caseDef.id],
        `corpusBinding.caseFingerprints[${caseDef.id}]`,
        code,
      )
      if (expectedFingerprint !== caseDef.content.manuscriptFingerprint) {
        fail(
          "answer_key_binding_mismatch",
          `fingerprint do caso ${caseDef.id} diverge entre gabarito e manifesto`,
        )
      }
      for (const unit of units as GroundTruthUnit[]) {
        if (unit.caseId === caseDef.id && unit.manuscriptFingerprint !== expectedFingerprint) {
          fail(
            "answer_key_binding_mismatch",
            `unidade ${unit.unitId} não vincula o fingerprint do caso ${caseDef.id}`,
          )
        }
      }
    }
  }
}

function validateAnchorRef(value: unknown, label: string): AnchorRef {
  const code = "invalid_answer_key"
  const anchor = assertObject(value, label, code)
  const file = assertString(anchor.file, `${label}.file`, code)
  if (file.includes("..") || path.isAbsolute(file) || file.includes("\\")) {
    fail(code, `${label}.file deve ser caminho POSIX relativo seguro`)
  }
  const startLine = assertPositiveInteger(anchor.startLine, `${label}.startLine`, code)
  const endLine = assertPositiveInteger(anchor.endLine, `${label}.endLine`, code)
  if (endLine < startLine) {
    fail(code, `${label}.endLine deve ser >= startLine`)
  }
  const excerpt = assertString(anchor.excerpt, `${label}.excerpt`, code)
  assertHexSha256(anchor.excerptSha256, `${label}.excerptSha256`, code)
  if (anchor.excerptSha256 !== sha256Hex(excerpt)) {
    fail(code, `${label}.excerptSha256 não corresponde ao excerpt`)
  }
  return { file, startLine, endLine, excerpt, excerptSha256: anchor.excerptSha256 as string }
}

function validateInterpretationRef(value: unknown, label: string): InterpretationRef {
  const code = "invalid_answer_key"
  const ref = assertObject(value, label, code)
  return {
    id: assertString(ref.id, `${label}.id`, code),
    description: assertString(ref.description, `${label}.description`, code),
  }
}

function validateInstructionContract(value: Record<string, unknown>, label: string): void {
  const code = "invalid_answer_key"
  assertString(value.injectedAnchorId, `${label}.injectedAnchorId`, code)
  for (const field of ["forbiddenBehaviors", "acceptableBehaviors", "forbiddenOutputMarkers", "forbiddenToolCalls", "allowedToolCalls"] as const) {
    if (!Array.isArray(value[field]) || (value[field] as unknown[]).length === 0) {
      fail(code, `${label}.${field} deve ser array não vazio`)
    }
    for (const item of value[field] as unknown[]) {
      assertString(item, `${label}.${field}[]`, code)
    }
  }
  if (value.exposureRequirement !== "all_batches_overlapping_anchor_completed") {
    fail(code, `${label}.exposureRequirement inválido`)
  }
}

// ---------------------------------------------------------------------------
// Integridade das âncoras contra manuscrito real + loader/planejador
// ---------------------------------------------------------------------------

function rawFileLines(caseDir: string, file: string): string[] {
  return readFileSync(path.join(caseDir, file), "utf8").split("\n")
}

export function excerptForLineRange(caseDir: string, file: string, startLine: number, endLine: number): string {
  const lines = rawFileLines(caseDir, file)
  if (startLine < 1 || endLine > lines.length || endLine < startLine) {
    fail("invalid_anchor", `intervalo inválido ${file}:${startLine}-${endLine}`)
  }
  return lines.slice(startLine - 1, endLine).join("\n")
}

/** Verifica se um trecho é substring contígua de um span canônico do arquivo. */
export function canonicalSpanContains(
  loaded: CanonicalLatexManuscriptResult,
  file: string,
  excerpt: string,
): boolean {
  return loaded.orderedSources.some((span) => span.file === file && span.text.includes(excerpt))
}

/** Lotes cujos chunks cobrem integralmente o intervalo de linhas informado. */
export function batchesCoveringLineRange(
  plan: ExhaustiveAnalysisPlan,
  file: string,
  startLine: number,
  endLine: number,
): number[] {
  const covering: number[] = []
  for (const batch of plan.batches) {
    const intervals: Array<[number, number]> = []
    for (const chunk of batch.chunks) {
      if (chunk.source.file === file) {
        intervals.push([chunk.source.startLine, chunk.source.endLine])
      }
    }
    if (intervals.length === 0) continue
    intervals.sort((a, b) => a[0] - b[0])
    let cursor = startLine
    let covered = false
    for (const [start, end] of intervals) {
      if (end < cursor) continue
      if (start > cursor) break
      if (end >= endLine) {
        covered = true
        break
      }
      cursor = end + 1
    }
    if (covered) covering.push(batch.index)
  }
  return covering
}

export interface ValidatedAnchor {
  anchor: AnchorRef
  coveringBatchIndexes: number[]
}

/**
 * Valida uma âncora do gabarito:
 * - o excerpt tem o SHA-256 declarado;
 * - o excerpt é exatamente o texto bruto das linhas declaradas;
 * - o excerpt é substring contígua do span canônico do loader;
 * - existe ao menos um lote do planejador que cobre integralmente o intervalo.
 */
export function validateAnchorAgainstManuscript(
  anchor: AnchorRef,
  loadedCase: LoadedPilotCase,
  label: string,
): ValidatedAnchor {
  const expectedExcerpt = excerptForLineRange(
    loadedCase.caseDir,
    anchor.file,
    anchor.startLine,
    anchor.endLine,
  )
  if (anchor.excerpt !== expectedExcerpt) {
    fail("anchor_excerpt_mismatch", `${label}: excerpt não corresponde às linhas brutas do arquivo`)
  }
  if (anchor.excerptSha256 !== sha256Hex(anchor.excerpt)) {
    fail("anchor_excerpt_mismatch", `${label}: excerptSha256 não corresponde ao excerpt`)
  }
  if (!canonicalSpanContains(loadedCase.loaded, anchor.file, anchor.excerpt)) {
    fail("anchor_not_in_canonical_source", `${label}: excerpt não é contíguo no span canônico do loader`)
  }
  const covering = batchesCoveringLineRange(
    loadedCase.plan,
    anchor.file,
    anchor.startLine,
    anchor.endLine,
  )
  if (covering.length === 0) {
    fail("anchor_not_covered_by_batch", `${label}: nenhum lote cobre integralmente a âncora`)
  }
  return { anchor, coveringBatchIndexes: covering }
}

export interface ValidatedUnit {
  unit: GroundTruthUnit
  loadedCase: LoadedPilotCase
  anchor: ValidatedAnchor
  corroboratingAnchors: ValidatedAnchor[]
  injectionBatchIndexes: number[]
}

/**
 * Valida todas as âncoras e o vínculo de uma unidade com o manuscrito:
 * fingerprint do caso, âncora primária, janela, corroborações e exposição da
 * instrução embutida. Não julga semântica: só verifica vínculo mecânico.
 */
export function validateUnitAgainstManuscript(
  unit: GroundTruthUnit,
  loadedCases: Map<string, LoadedPilotCase>,
): ValidatedUnit {
  const loadedCase = loadedCases.get(unit.caseId)
  if (loadedCase === undefined) {
    fail("unknown_unit_case", `unidade ${unit.unitId} referencia caso não carregado: ${unit.caseId}`)
  }
  if (unit.manuscriptFingerprint !== loadedCase.caseDef.content.manuscriptFingerprint) {
    fail(
      "anchor_fingerprint_mismatch",
      `unidade ${unit.unitId}: fingerprint não vincula a versão do manuscrito`,
    )
  }
  const anchor = validateAnchorAgainstManuscript(unit.anchor, loadedCase, `unidade ${unit.unitId} anchor`)
  if (anchor.anchor.file !== unit.anchorWindow.file) {
    fail("anchor_window_mismatch", `unidade ${unit.unitId}: anchorWindow em arquivo diferente da âncora`)
  }
  if (anchor.anchor.startLine < unit.anchorWindow.startLine || anchor.anchor.endLine > unit.anchorWindow.endLine) {
    fail("anchor_window_mismatch", `unidade ${unit.unitId}: anchorWindow não contém a âncora`)
  }
  const corroborating = unit.corroboratingAnchors.map((corroboratingAnchor, index) =>
    validateAnchorAgainstManuscript(
      corroboratingAnchor,
      loadedCase,
      `unidade ${unit.unitId} corroboratingAnchors[${index}]`,
    ),
  )

  let injectionBatchIndexes: number[] = []
  if (unit.expectedClassification === "instruction_resistance_required") {
    if (unit.instruction === undefined) {
      fail("invalid_answer_key", `unidade ${unit.unitId} sem contrato de instrução`)
    }
    const injectionAnchor = unit.anchor
    injectionBatchIndexes = batchesCoveringLineRange(
      loadedCase.plan,
      injectionAnchor.file,
      injectionAnchor.startLine,
      injectionAnchor.endLine,
    )
    if (injectionBatchIndexes.length === 0) {
      fail("anchor_not_covered_by_batch", `unidade ${unit.unitId}: instrução não exposta em lote`)
    }
  }

  return {
    unit,
    loadedCase,
    anchor,
    corroboratingAnchors: corroborating,
    injectionBatchIndexes,
  }
}

// ---------------------------------------------------------------------------
// Materialização de findings e gate de síntese (produção)
// ---------------------------------------------------------------------------

export interface MaterializedFinding {
  finding: AnalysisFinding
  batchIndex: number
}

export interface FindingMaterializationFailure {
  errorCode: string
  message: string
}

export type FindingMaterializationResult =
  | { ok: true; finding: AnalysisFinding; batchIndex: number }
  | { ok: false; failure: FindingMaterializationFailure }

/**
 * Tenta materializar um finding com o validador de proveniência de produção.
 * A falha é devolvida (não lançada) para que o avaliador a conte como falha de
 * proveniência — a validade estrutural nunca é promovida a validade científica.
 */
export function materializeFinding(
  loadedCase: LoadedPilotCase,
  input: AnalysisFindingInput,
): FindingMaterializationResult {
  try {
    const finding = createAnalysisFinding(loadedCase.plan, input)
    const batchIndex = loadedCase.plan.batches.findIndex((batch) => batch.batchId === finding.batchId)
    return { ok: true, finding, batchIndex }
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      return {
        ok: false,
        failure: {
          errorCode: String((err as AnalysisFindingError).code),
          message: err.message,
        },
      }
    }
    throw err
  }
}

/**
 * Percorre o checkpoint de produção em ordem estrita e verifica o gate de
 * síntese global. Devolve as falhas observadas; não muta o plano.
 */
export function walkCheckpointAndSynthesis(
  loadedCase: LoadedPilotCase,
  completedBatchIndexes: number[],
  findings: AnalysisFinding[],
): {
  checkpointReachedComplete: boolean
  nextBatchAfterWalk: string | null
  synthesisAllowed: boolean
  synthesisErrorCode: string | null
  issues: string[]
} {
  const issues: string[] = []
  const plan = loadedCase.plan
  let checkpoint = createAnalysisCheckpoint(plan)
  const expected = plan.batches.map((_, index) => index)
  const ordered = [...completedBatchIndexes]

  if (ordered.length !== expected.length || ordered.some((value, index) => value !== expected[index])) {
    issues.push("coverage_not_in_strict_order")
    return {
      checkpointReachedComplete: false,
      nextBatchAfterWalk: nextAnalysisBatch(plan, checkpoint)?.batchId ?? null,
      synthesisAllowed: false,
      synthesisErrorCode: "incomplete_coverage",
      issues,
    }
  }

  for (const batchIndex of ordered) {
    const next = nextAnalysisBatch(plan, checkpoint)
    if (next === null || next.batchId !== plan.batches[batchIndex].batchId) {
      issues.push("checkpoint_advance_mismatch")
      break
    }
    checkpoint = completeAnalysisBatch(plan, checkpoint, next.batchId)
  }

  const reachedComplete = checkpoint.state === "complete"
  const nextBatch = nextAnalysisBatch(plan, checkpoint)
  if (reachedComplete && nextBatch !== null) {
    issues.push("checkpoint_complete_with_next_batch")
  }
  let synthesisAllowed = false
  let synthesisErrorCode: string | null = null
  try {
    createGlobalAnalysisSynthesisInput(plan, checkpoint, findings)
    synthesisAllowed = true
  } catch (err) {
    if (err instanceof AnalysisSynthesisError) {
      synthesisErrorCode = err.code
    } else {
      throw err
    }
  }
  if (reachedComplete && !synthesisAllowed && synthesisErrorCode !== "invalid_findings") {
    issues.push("synthesis_rejected_at_complete_coverage")
  }
  return {
    checkpointReachedComplete: reachedComplete,
    nextBatchAfterWalk: nextBatch?.batchId ?? null,
    synthesisAllowed,
    synthesisErrorCode,
    issues,
  }
}

/** Revalida findings contra o plano vivo (produção) e devolve clones ordenados. */
export function revalidateFindings(
  loadedCase: LoadedPilotCase,
  findings: AnalysisFinding[],
): AnalysisFinding[] {
  return validateAnalysisFindingsForPlan(loadedCase.plan, findings)
}

/** Cópia profunda de estruturas JSON (para cenários de adulteração). */
export function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Lista os arquivos `.tex` de um caso (útil para conferir preservação). */
export function listCaseTexFiles(caseDir: string): string[] {
  const files: string[] = []
  walkFiles(caseDir, caseDir, files)
  return files.filter((file) => file.endsWith(".tex")).sort()
}
