import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import {
  ANSWER_KEY_RELATIVE_PATH,
  MANIFEST_RELATIVE_PATH,
  PILOT_ANSWER_KEY_VERSION,
  PILOT_CORPUS_ROOT,
  PILOT_CORPUS_VERSION,
  PILOT_PROTOCOL_VERSION,
  PILOT_SCENARIOS_VERSION,
  PilotContractError,
  batchesCoveringLineRange,
  computeCaseFileInventory,
  deepCloneJson,
  loadPilotCorpus,
  materializeFinding,
  readJsonFile,
  sha256Hex,
  validateManifestContentIntegrity,
  validatePilotAnswerKey,
  validatePilotManifest,
  validateUnitAgainstManuscript,
  walkCheckpointAndSynthesis,
  type GroundTruthUnit,
  type LoadedPilotCase,
  type PilotCorpusManifest,
  type ProvisionalAnswerKey,
  type ValidatedUnit,
} from "./fixtures/academic-semantic-pilot/v1/helpers/corpus_contract"
import {
  PilotEvaluationError,
  evaluateCampaign,
  evaluateSubmission,
  type SyntheticCampaignSpec,
  type SubmissionEvaluation,
  type SyntheticFindingAdjudicationSpec,
  type SyntheticScenarioSet,
  type SyntheticSubmissionSpec,
} from "./fixtures/academic-semantic-pilot/v1/helpers/offline_evaluator"

const CORPUS_ROOT = PILOT_CORPUS_ROOT
const SCENARIOS_PATH = path.join(CORPUS_ROOT, "scenarios/synthetic-submissions.json")
const COVERAGE_CORPUS_MANIFEST = path.resolve(
  __dirname,
  "fixtures/academic-coverage/v1/manifest.json",
)
/** SHA-256 do corpus mecânico v1 no SHA-base 7e3e30e — deve permanecer intacto. */
const COVERAGE_CORPUS_MANIFEST_SHA256 =
  "3277e299517bbf421a8d50af0beca60c32db2fcda35cf39d17415bdf52026078"

let manifest: PilotCorpusManifest
let answerKey: ProvisionalAnswerKey
let manifestRawSha256: string
let loadedCases: Map<string, LoadedPilotCase>
let validatedUnits: ValidatedUnit[]
let scenarios: SyntheticScenarioSet
const submissionsById = new Map<string, SyntheticSubmissionSpec>()
const campaignsById = new Map<string, SyntheticCampaignSpec>()
const temporaryDirectories: string[] = []

function unitsOfCase(caseId: string): ValidatedUnit[] {
  return validatedUnits.filter((unit) => unit.unit.caseId === caseId)
}

function unitsOfKind(classification: GroundTruthUnit["expectedClassification"]): ValidatedUnit[] {
  return validatedUnits.filter((unit) => unit.unit.expectedClassification === classification)
}

function submissionById(submissionId: string): SyntheticSubmissionSpec {
  const submission = submissionsById.get(submissionId)
  if (submission === undefined) throw new Error(`submissão sintética ausente: ${submissionId}`)
  return submission
}

function campaignById(campaignId: string): SyntheticCampaignSpec {
  const campaign = campaignsById.get(campaignId)
  if (campaign === undefined) throw new Error(`campanha sintética ausente: ${campaignId}`)
  return campaign
}

function unitIdFor(caseId: string, classification: GroundTruthUnit["expectedClassification"]): string {
  const unit = answerKey.units.find(
    (candidate) =>
      candidate.caseId === caseId && candidate.expectedClassification === classification,
  )
  if (unit === undefined) {
    throw new Error(`unidade ${classification} ausente no caso ${caseId}`)
  }
  return unit.unitId
}

function expectDefinitiveAccounting(evaluation: SubmissionEvaluation): void {
  const metrics = evaluation.metrics
  if (metrics === null) throw new Error("métricas definitivas ausentes")
  expect(metrics.expectedDefects).toBe(metrics.tp + metrics.fn)
  const byExpected = metrics.byCategory.reduce((total, category) => total + category.expectedDefects, 0)
  const byTp = metrics.byCategory.reduce((total, category) => total + category.tp, 0)
  const byFn = metrics.byCategory.reduce((total, category) => total + category.fn, 0)
  const byFp = metrics.byCategory.reduce((total, category) => total + category.fp, 0)
  expect(byExpected).toBe(metrics.expectedDefects)
  expect(byTp).toBe(metrics.tp)
  expect(byFn).toBe(metrics.fn)
  expect(byFp + metrics.unattributedFp).toBe(metrics.fp)
  expect(metrics.tn).toBe(metrics.negativeUnits.withoutAccusation)
}

function evaluateCampaignWithOverrides(
  campaignId: string,
  overrides: Record<string, SyntheticSubmissionSpec>,
) {
  const campaign = deepCloneJson(campaignById(campaignId))
  const submissions = new Map(submissionsById)
  for (const [submissionId, submission] of Object.entries(overrides)) {
    submissions.set(submissionId, submission)
  }
  return evaluateCampaign(campaign, submissions, validatedUnits, loadedCases)
}

function evaluateCampaignStrict(campaignId: string) {
  return evaluateCampaign(campaignById(campaignId), submissionsById, validatedUnits, loadedCases)
}

function evaluateCampaignMutated(
  campaignId: string,
  unsafeSimulation: Parameters<typeof evaluateCampaign>[4] extends undefined
    ? never
    : NonNullable<Parameters<typeof evaluateCampaign>[4]>["unsafeSimulation"],
) {
  return evaluateCampaign(campaignById(campaignId), submissionsById, validatedUnits, loadedCases, {
    unsafeSimulation,
  })
}

function evaluateStandalone(
  submissionId: string,
  unsafeSimulation?: NonNullable<Parameters<typeof evaluateSubmission>[3]>["unsafeSimulation"],
) {
  const submission = submissionById(submissionId)
  const loadedCase = loadedCases.get(submission.caseId)
  if (loadedCase === undefined) throw new Error(`caso não carregado: ${submission.caseId}`)
  return evaluateSubmission(
    submission,
    validatedUnits,
    loadedCase,
    unsafeSimulation === undefined ? {} : { unsafeSimulation },
  )
}

function metricsOf(evaluation: ReturnType<typeof evaluateCampaignStrict>) {
  if (evaluation.metrics === null) throw new Error("métricas ausentes")
  return evaluation.metrics
}

function makeTemporaryCorpusCopy(): string {
  const destination = mkdtempSync(path.join(tmpdir(), "dshbanca-semantic-pilot-"))
  temporaryDirectories.push(destination)
  cpSync(CORPUS_ROOT, destination, { recursive: true })
  return destination
}

beforeAll(() => {
  const bundle = loadPilotCorpus(CORPUS_ROOT)
  manifest = bundle.manifest
  answerKey = bundle.answerKey
  manifestRawSha256 = bundle.manifestRawSha256

  validatePilotManifest(manifest)
  loadedCases = validateManifestContentIntegrity(manifest, CORPUS_ROOT)
  validatePilotAnswerKey(answerKey, {
    manifest,
    manifestRawSha256,
    corpusRoot: CORPUS_ROOT,
  })
  validatedUnits = answerKey.units.map((unit) => validateUnitAgainstManuscript(unit, loadedCases))

  const rawScenarios = readJsonFile<SyntheticScenarioSet>(SCENARIOS_PATH)
  scenarios = rawScenarios
  for (const submission of rawScenarios.submissions) {
    submissionsById.set(submission.submissionId, submission)
  }
  for (const campaign of rawScenarios.campaigns) {
    campaignsById.set(campaign.campaignId, campaign)
  }
})

afterAll(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("Corpus semântico cego v1 — integridade de apresentação", () => {
  test("manifesto válido, seis casos únicos e sem vazamento de rótulos de resposta", () => {
    expect(manifest.version).toBe(PILOT_CORPUS_VERSION)
    expect(manifest.documentKind).toBe("presentation_manifest")
    expect(manifest.synthetic).toBe(true)
    expect(manifest.metadata.totalCases).toBe(6)
    expect(manifest.cases.length).toBe(6)
    expect(new Set(manifest.cases.map((caseDef) => caseDef.id)).size).toBe(6)
    expect(new Set(manifest.cases.map((caseDef) => caseDef.path)).size).toBe(6)
    expect(manifest.cases.every((caseDef) => caseDef.path.startsWith("manuscripts/"))).toBe(true)

    // O manifesto de apresentação não pode antecipar a resposta esperada.
    expect(JSON.stringify(manifest)).not.toMatch(/u-[0-9a-f]{8}/)
    for (const caseDef of manifest.cases) {
      const visible = `${caseDef.id} ${caseDef.path} ${caseDef.description}`.toLowerCase()
      for (const forbidden of [
        "defeito",
        "controle",
        "correto",
        "ambíguo",
        "ambiguo",
        "instrução",
        "instrucao",
        "gabarito",
        "injeção",
        "injecao",
      ]) {
        expect(visible.includes(forbidden)).toBe(false)
      }
    }

    // Contratos negativos: chave de gabarito vazada, caso duplicado e caminho duplicado.
    const leaked = deepCloneJson(manifest) as unknown as Record<string, unknown>
    ;(leaked.cases as Array<Record<string, unknown>>)[0].expected = { classification: "defect" }
    expect(() => validatePilotManifest(leaked)).toThrow(PilotContractError)
    try {
      validatePilotManifest(leaked)
    } catch (err) {
      expect(err).toBeInstanceOf(PilotContractError)
      expect((err as PilotContractError).code).toBe("presentation_leak")
    }

    const duplicatedCase = deepCloneJson(manifest)
    duplicatedCase.cases[1] = deepCloneJson(duplicatedCase.cases[0])
    expect(() => validatePilotManifest(duplicatedCase)).toThrow(PilotContractError)
    try {
      validatePilotManifest(duplicatedCase)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("duplicate_case_id")
    }

    const duplicatedPath = deepCloneJson(manifest)
    duplicatedPath.cases[1].id = "case-extra"
    duplicatedPath.cases[1].path = duplicatedPath.cases[0].path
    expect(() => validatePilotManifest(duplicatedPath)).toThrow(PilotContractError)
    try {
      validatePilotManifest(duplicatedPath)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("duplicate_case_path")
    }
  })

  test("hashes por arquivo, fingerprint canônico, caracteres e lotes correspondem aos manuscritos", () => {
    for (const caseDef of manifest.cases) {
      const loadedCase = loadedCases.get(caseDef.id)
      expect(loadedCase).toBeDefined()
      if (loadedCase === undefined) continue
      const inventory = computeCaseFileInventory(loadedCase.caseDir)
      expect(inventory).toEqual(
        [...caseDef.content.files].sort((a, b) => a.path.localeCompare(b.path)),
      )
      expect(loadedCase.loaded.complete).toBe(true)
      expect(loadedCase.loaded.diagnostics).toEqual([])
      expect(loadedCase.loaded.fingerprint).toBe(caseDef.content.manuscriptFingerprint)
      expect(loadedCase.plan.status).toBe("complete")
      expect(loadedCase.plan.coverage.coveragePercent).toBe(100)
      expect(loadedCase.plan.coverage.totalCharacters).toBe(caseDef.content.totalCharacters)
      expect(loadedCase.plan.batches.length).toBe(caseDef.content.batchCount)
      expect(loadedCase.plan.batches.length).toBeGreaterThanOrEqual(2)
      expect(caseDef.content.files.length).toBeGreaterThanOrEqual(6)

      const orderedText = loadedCase.loaded.orderedSources.map((span) => span.text).join("")
      const chunkText = loadedCase.plan.batches
        .flatMap((batch) => batch.chunks)
        .map((chunk) => chunk.text)
        .join("")
      expect(chunkText).toBe(orderedText)
    }

    // RED/GREEN do vínculo por hash: adulteração só é aceita quando o guard é desligado.
    const tamperedRoot = makeTemporaryCorpusCopy()
    const tamperedFile = path.join(tamperedRoot, "manuscripts/case-01/secoes/conclusao.tex")
    const original = readFileSync(tamperedFile, "utf8")
    writeFileSync(
      tamperedFile,
      original.replace("é vantajosa para o sistema simulado", "é desvantajosa para o sistema simulado"),
      "utf8",
    )
    expect(() => validateManifestContentIntegrity(manifest, tamperedRoot)).toThrow(
      PilotContractError,
    )
    try {
      validateManifestContentIntegrity(manifest, tamperedRoot)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("hash_mismatch")
    }
    // RED TEST-ONLY: desligar hashes e forma de cobertura mostra o modo de falha ingênuo.
    const unguarded = validateManifestContentIntegrity(manifest, tamperedRoot, {
      verifyHashes: false,
      verifyCoverageShape: false,
    })
    expect(unguarded.size).toBe(6)
    // GREEN: o guard estrito continua rejeitando.
    expect(() => validateManifestContentIntegrity(manifest, tamperedRoot)).toThrow(PilotContractError)
  })

  test("gabarito provisório vincula o manifesto, exige ratificação humana e rejeita adulteração", () => {
    expect(answerKey.version).toBe(PILOT_ANSWER_KEY_VERSION)
    expect(answerKey.documentKind).toBe("provisional_answer_key")
    expect(answerKey.protocolVersion).toBe(PILOT_PROTOCOL_VERSION)
    expect(answerKey.status).toBe("provisional_pending_human_ratification")
    expect(answerKey.ratification.required).toBe(true)
    expect(answerKey.ratification.postHocAdaptationAllowed).toBe(false)
    expect(
      answerKey.ratification.checklist.some((item) => item.status === "pending"),
    ).toBe(true)
    expect(answerKey.corpusBinding.manifestSha256).toBe(manifestRawSha256)
    expect(answerKey.corpusBinding.caseFingerprints).toEqual(
      Object.fromEntries(
        manifest.cases.map((caseDef) => [caseDef.id, caseDef.content.manuscriptFingerprint]),
      ),
    )
    expect(Array.isArray(answerKey.units)).toBe(true)
    expect(answerKey.units.length).toBeGreaterThan(0)
    expect(new Set(answerKey.units.map((unit) => unit.unitId)).size).toBe(answerKey.units.length)
    for (const unit of answerKey.units) {
      expect(unit.unitId).toMatch(/^u-[0-9a-f]{8}$/)
      expect(unit.manuscriptFingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(unit.anchor.excerptSha256).toBe(sha256Hex(unit.anchor.excerpt))
    }

    const bundle = { manifest, manifestRawSha256, corpusRoot: CORPUS_ROOT }
    // RED/GREEN: sem o vínculo, a adulteração passaria; com o vínculo, é rejeitada.
    const tamperedBinding = deepCloneJson(answerKey)
    tamperedBinding.corpusBinding.manifestSha256 = "f".repeat(64)
    expect(() =>
      validatePilotAnswerKey(tamperedBinding, bundle, { verifyCorpusBinding: false }),
    ).not.toThrow()
    expect(() => validatePilotAnswerKey(tamperedBinding, bundle)).toThrow(PilotContractError)
    try {
      validatePilotAnswerKey(tamperedBinding, bundle)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("answer_key_binding_mismatch")
    }

    const tamperedFingerprint = deepCloneJson(answerKey)
    tamperedFingerprint.units[0].manuscriptFingerprint = "0".repeat(64)
    expect(() => validatePilotAnswerKey(tamperedFingerprint, bundle)).toThrow(PilotContractError)

    const duplicatedUnit = deepCloneJson(answerKey)
    duplicatedUnit.units[1].unitId = duplicatedUnit.units[0].unitId
    expect(() => validatePilotAnswerKey(duplicatedUnit, bundle)).toThrow(PilotContractError)
    try {
      validatePilotAnswerKey(duplicatedUnit, bundle)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("duplicate_unit_id")
    }

    const nonOpaqueUnit = deepCloneJson(answerKey)
    nonOpaqueUnit.units[0].unitId = "defeito-de-coerencia-1"
    expect(() => validatePilotAnswerKey(nonOpaqueUnit, bundle)).toThrow(PilotContractError)

    const tamperedExcerpt = deepCloneJson(answerKey)
    tamperedExcerpt.units[0].anchor.excerpt = "trecho inventado"
    expect(() => validatePilotAnswerKey(tamperedExcerpt, bundle)).toThrow(PilotContractError)
    try {
      validatePilotAnswerKey(tamperedExcerpt, bundle)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("invalid_answer_key")
    }
  })

  test("gabarito cobre o corpus com categorias separadas, sem rótulo antecipado e com IDs opacos", () => {
    const byClassification = new Map<string, number>()
    for (const unit of answerKey.units) {
      byClassification.set(
        unit.expectedClassification,
        (byClassification.get(unit.expectedClassification) ?? 0) + 1,
      )
    }
    expect(byClassification.get("defect_expected")).toBe(2)
    expect(byClassification.get("conformity_expected")).toBe(3)
    expect(byClassification.get("insufficient_information")).toBe(1)
    expect(byClassification.get("instruction_resistance_required")).toBe(1)
    expect(unitsOfKind("defect_expected").length).toBe(2)
    expect(unitsOfKind("conformity_expected").length).toBe(3)

    // Pares de contraste: cada categoria de defeito tem um caso de controle pareado.
    const pairs = new Map<string, string[]>()
    for (const caseMeta of answerKey.cases) {
      if (caseMeta.contrastPairId === null) continue
      const list = pairs.get(caseMeta.contrastPairId) ?? []
      list.push(caseMeta.caseType)
      pairs.set(caseMeta.contrastPairId, list)
    }
    expect(pairs.size).toBe(2)
    for (const caseTypes of pairs.values()) {
      expect(caseTypes.sort()).toEqual(["control", "defect"])
    }
    // Nenhuma categoria experimental fica sem par controle quando é de defeito.
    expect(unitsOfCase("case-03").length).toBe(1)
    expect(unitsOfCase("case-06").length).toBe(2)

    // Caso instrucional: contrato de exposição e ações proibidas explícitas.
    const instructionUnit = unitsOfKind("instruction_resistance_required")[0]
    expect(instructionUnit.unit.instruction).toBeDefined()
    const instruction = instructionUnit.unit.instruction!
    expect(instruction.allowedToolCalls).toContain("banca_context")
    expect(instruction.allowedToolCalls).toContain("banca_auditar")
    expect(instruction.forbiddenToolCalls).toContain("write")
    expect(instruction.forbiddenOutputMarkers.length).toBeGreaterThan(0)
    expect(instruction.exposureRequirement).toBe("all_batches_overlapping_anchor_completed")
    expect(instructionUnit.injectionBatchIndexes.length).toBeGreaterThan(0)

    // Caso ambíguo: razão explícita de ausência de conclusão binária.
    const ambiguousUnit = unitsOfKind("insufficient_information")[0]
    expect(ambiguousUnit.unit.ambiguityRationale ?? "").not.toBe("")
    expect(ambiguousUnit.unit.expectedClassification).toBe("insufficient_information")

    // Contratos negativos de paridade tipo-do-caso ↔ unidade e par de contraste.
    const bundle = { manifest, manifestRawSha256, corpusRoot: CORPUS_ROOT }
    const wrongCaseType = deepCloneJson(answerKey)
    const defectCase = wrongCaseType.cases.find((caseMeta) => caseMeta.caseType === "defect")!
    defectCase.caseType = "control"
    expect(() => validatePilotAnswerKey(wrongCaseType, bundle)).toThrow(PilotContractError)
    try {
      validatePilotAnswerKey(wrongCaseType, bundle)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("case_unit_type_mismatch")
    }

    const wrongPairCategory = deepCloneJson(answerKey)
    const paired = wrongPairCategory.cases.filter((caseMeta) => caseMeta.contrastPairId !== null)
    paired[1].experimentalCategory = "suporte_interpretativo_generalizacao"
    expect(() => validatePilotAnswerKey(wrongPairCategory, bundle)).toThrow(PilotContractError)
    try {
      validatePilotAnswerKey(wrongPairCategory, bundle)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("contrast_pair_mismatch")
    }
  })

  test("âncoras são reais no manuscrito e válidas pelo loader e pelo planejador de produção", () => {
    for (const validated of validatedUnits) {
      const unit = validated.unit
      const loadedCase = validated.loadedCase
      const covering = batchesCoveringLineRange(
        loadedCase.plan,
        unit.anchor.file,
        unit.anchor.startLine,
        unit.anchor.endLine,
      )
      expect(covering.length).toBeGreaterThan(0)
      expect(validated.anchor.coveringBatchIndexes).toEqual(covering)

      // O validador de proveniência de produção aceita a âncora com um lote real.
      const materialized = materializeFinding(loadedCase, {
        category:
          unit.expectedClassification === "defect_expected"
            ? unit.acceptedFindingCategories[0]
            : "observacao_de_teste",
        severity: "alta",
        claim: unit.justification,
        evidence: unit.anchor.excerpt,
        file: unit.anchor.file,
        startLine: unit.anchor.startLine,
        endLine: unit.anchor.endLine,
        sectionId: "Teste",
        manuscriptFingerprint: loadedCase.plan.fingerprint as string,
        batchId: loadedCase.plan.batches[covering[0]].batchId,
      })
      expect(materialized.ok).toBe(true)

      // Âncora fora do manuscrito é rejeitada pela proveniência de produção.
      const invalid = materializeFinding(loadedCase, {
        category: "observacao_de_teste",
        severity: "alta",
        claim: "linha inválida",
        evidence: "trecho",
        file: unit.anchor.file,
        startLine: 999,
        endLine: 999,
        sectionId: "Teste",
        manuscriptFingerprint: loadedCase.plan.fingerprint as string,
        batchId: loadedCase.plan.batches[covering[0]].batchId,
      })
      expect(invalid.ok).toBe(false)
      if (!invalid.ok) {
        expect(invalid.failure.errorCode).toBe("line_range_not_covered")
      }
    }

    // Trecho divergente do texto real: rejeitado antes de qualquer juízo semântico.
    const tamperedUnit = deepCloneJson(answerKey.units[0])
    tamperedUnit.anchor.excerpt = `${tamperedUnit.anchor.excerpt} (adulterado)`
    tamperedUnit.anchor.excerptSha256 = sha256Hex(tamperedUnit.anchor.excerpt)
    expect(() => validateUnitAgainstManuscript(tamperedUnit, loadedCases)).toThrow(
      PilotContractError,
    )
    try {
      validateUnitAgainstManuscript(tamperedUnit, loadedCases)
    } catch (err) {
      expect((err as PilotContractError).code).toBe("anchor_excerpt_mismatch")
    }
  })

  test("cobertura multifile e multilote com evidência distribuída entre lotes distintos", () => {
    // Casos de contraste principais: âncora primária e corroboração em lotes diferentes.
    for (const caseId of ["case-01", "case-02"]) {
      const caseUnits = unitsOfCase(caseId)
      expect(caseUnits.length).toBe(1)
      const validated = caseUnits[0]
      expect(validated.loadedCase.loaded.orderedSources.length).toBeGreaterThanOrEqual(5)
      const primaryBatches = validated.anchor.coveringBatchIndexes
      const corroborating = validated.corroboratingAnchors.flatMap(
        (anchor) => anchor.coveringBatchIndexes,
      )
      expect(primaryBatches.length).toBeGreaterThan(0)
      expect(corroborating.length).toBeGreaterThan(0)
      expect(corroborating.some((batchIndex) => !primaryBatches.includes(batchIndex))).toBe(true)
      expect(validated.loadedCase.plan.batches.length).toBeGreaterThanOrEqual(3)
    }

    // Gate de síntese: fechado antes da cobertura integral, aberto depois.
    const loadedCase = loadedCases.get("case-01")!
    const allFindingFree: [] = []
    const pendingWalk = walkCheckpointAndSynthesis(loadedCase, [], allFindingFree)
    expect(pendingWalk.checkpointReachedComplete).toBe(false)
    expect(pendingWalk.synthesisAllowed).toBe(false)

    const fullWalk = walkCheckpointAndSynthesis(
      loadedCase,
      loadedCase.plan.batches.map((_, index) => index),
      allFindingFree,
    )
    expect(fullWalk.checkpointReachedComplete).toBe(true)
    expect(fullWalk.synthesisAllowed).toBe(true)
    expect(fullWalk.nextBatchAfterWalk).toBeNull()

    // Relatório vazio com cobertura completa não vira sucesso: segue sem findings.
    const emptyComplete = evaluateStandalone("s01-empty")
    expect(emptyComplete.auditStatus).toBe("complete")
    expect(emptyComplete.scoreable).toBe(true)
    expect(emptyComplete.metrics?.tp).toBe(0)
    expect(emptyComplete.metrics?.fn).toBe(1)
    expect(emptyComplete.metrics?.recall).toBe(0)
  })

  test("README, schema e manifesto documentam o corpus sem vazar o gabarito", () => {
    const readmePath = path.join(CORPUS_ROOT, "README.md")
    const schemaPath = path.join(CORPUS_ROOT, "schema.json")
    expect(existsSync(readmePath)).toBe(true)
    expect(existsSync(schemaPath)).toBe(true)
    const readme = readFileSync(readmePath, "utf8")
    expect(readme.length).toBeGreaterThan(1000)
    expect(readme).toContain("#178")
    expect(readme).toContain("provisional_pending_human_ratification")
    expect(readme).not.toMatch(/\/home\//)
    expect(readme).not.toMatch(/file:\/\//)

    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, any>
    expect(schema.$schema).toContain("json-schema.org/draft/2020-12/schema")
    expect(schema.type).toBe("object")
    expect(schema.properties.version.const).toBe(PILOT_CORPUS_VERSION)
    expect(schema.required).toContain("documentKind")
    expect(schema.required).toContain("cases")
    const definitions = schema.$defs as Record<string, any>
    for (const definition of [
      "provisionalAnswerKey",
      "groundTruthUnit",
      "anchor",
      "instructionContract",
      "syntheticScenarioSet",
      "submission",
    ]) {
      expect(definitions[definition]).toBeDefined()
    }
    expect(definitions.provisionalAnswerKey.required).toContain("corpusBinding")
    expect(definitions.provisionalAnswerKey.required).toContain("units")
    expect(JSON.stringify(schema)).not.toMatch(/\/home\//)

    expect(manifest.metadata.answerKeyPath).toBe(ANSWER_KEY_RELATIVE_PATH)
    expect(manifest.metadata.protocolDocument).toBe("docs/academic-semantic-pilot.md")
    expect(manifest.metadata.presentationOnly).toBe(true)
  })

  test("corpus mecânico anterior permanece integralmente preservado", () => {
    const coverageManifestBytes = readFileSync(COVERAGE_CORPUS_MANIFEST)
    expect(createHash("sha256").update(coverageManifestBytes).digest("hex")).toBe(
      COVERAGE_CORPUS_MANIFEST_SHA256,
    )
  })
})

describe("Avaliador offline — submissões sintéticas explícitas", () => {
  test("arquivo de cenários é explicitamente sintético e recusa submissão não sintética", () => {
    expect(scenarios.version).toBe(PILOT_SCENARIOS_VERSION)
    expect(scenarios.synthetic).toBe(true)
    expect(scenarios.notice).toContain("Não são saída de modelo")
    expect(scenarios.submissions.length).toBeGreaterThanOrEqual(20)
    expect(scenarios.campaigns.length).toBeGreaterThanOrEqual(10)
    for (const submission of scenarios.submissions) {
      expect(submission.synthetic).toBe(true)
      for (const adjudication of submission.findingAdjudications) {
        expect(adjudication.synthetic).toBe(true)
      }
      if (submission.instruction !== undefined) {
        expect(submission.instruction.adjudication.synthetic).toBe(true)
      }
    }

    const nonSynthetic = deepCloneJson(submissionById("s01-base")) as unknown as Record<
      string,
      unknown
    >
    nonSynthetic.synthetic = false
    const loadedCase = loadedCases.get("case-01")!
    expect(() =>
      evaluateSubmission(
        nonSynthetic as unknown as SyntheticSubmissionSpec,
        validatedUnits,
        loadedCase,
      ),
    ).toThrow(PilotEvaluationError)
    try {
      evaluateSubmission(
        nonSynthetic as unknown as SyntheticSubmissionSpec,
        validatedUnits,
        loadedCase,
      )
    } catch (err) {
      expect((err as PilotEvaluationError).code).toBe("non_synthetic_submission")
    }

    const nonSyntheticAdjudication = deepCloneJson(submissionById("s01-base"))
    nonSyntheticAdjudication.findingAdjudications[0].synthetic = false as true
    expect(() =>
      evaluateSubmission(nonSyntheticAdjudication, validatedUnits, loadedCase),
    ).toThrow(PilotEvaluationError)
  })

  test("campanhas sintéticas cobrem os seis casos e não repetem caso por campanha", () => {
    const caseIds = new Set(manifest.cases.map((caseDef) => caseDef.id))
    for (const campaign of scenarios.campaigns) {
      expect(campaign.synthetic).toBe(true)
      expect(campaign.submissionIds.length).toBe(6)
      const campaignCaseIds = campaign.submissionIds.map(
        (submissionId) => submissionById(submissionId).caseId,
      )
      expect(new Set(campaignCaseIds).size).toBe(6)
      expect(new Set(campaignCaseIds)).toEqual(caseIds)
    }
    const baseline = evaluateCampaignStrict("campanha-sintetica-baseline")
    expect(baseline.status).toBe("complete")
    expect(baseline.scoreable).toBe(true)
    expect(baseline.submissions.every((submission) => submission.synthetic)).toBe(true)
  })

  test("GREEN baseline: TP/FP/FN, precisão e sensibilidade por categoria", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-baseline")
    const metrics = metricsOf(evaluation)
    expect(metrics.tp).toBe(2)
    expect(metrics.fp).toBe(0)
    expect(metrics.tn).toBe(3)
    expect(metrics.fn).toBe(0)
    expect(metrics.expectedDefects).toBe(2)
    expect(metrics.expectedConformityUnits).toBe(3)
    expect(metrics.precision).toBe(1)
    expect(metrics.recall).toBe(1)
    expect(metrics.specificity).toBe(1)
    expect(metrics.byCategory).toEqual([
      { protocolCategory: "coerencia_metodologica", expectedDefects: 1, tp: 1, fn: 0, fp: 0, precision: 1, recall: 1 },
      { protocolCategory: "suporte_interpretativo", expectedDefects: 1, tp: 1, fn: 0, fp: 0, precision: 1, recall: 1 },
    ])
    expect(evaluation.ambiguous.units).toBe(1)
    expect(evaluation.ambiguous.silentAbstention).toBe(1)
    expect(evaluation.instruction.required).toBe(1)
    expect(evaluation.instruction.exposed).toBe(1)
    expect(evaluation.instruction.compliant).toBe(1)

    // Nenhuma métrica de score/nota/accuracy é produzida.
    const metricKeys = Object.keys(metrics).sort()
    expect(metricKeys).toEqual(
      [
        "byCategory",
        "expectedConformityUnits",
        "expectedDefects",
        "fn",
        "fp",
        "negativeUnits",
        "pendingAdjudications",
        "precision",
        "recall",
        "redundantFindings",
        "specificity",
        "tn",
        "tp",
        "ungroundedAccepted",
        "unattributedFp",
      ].sort(),
    )
    expect(metrics.specificity).toBe(metrics.negativeUnits.specificity)
    expect(JSON.stringify(evaluation)).not.toContain("accuracy")
    expect("auditSucceeded" in evaluation).toBe(false)
    expectDefinitiveAccounting(evaluation)
  })

  test("detecta falso negativo (defeito esperado sem finding)", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-falso-negativo")
    const metrics = metricsOf(evaluation)
    expect(metrics.tp).toBe(1)
    expect(metrics.fn).toBe(1)
    expect(metrics.precision).toBe(1)
    expect(metrics.recall).toBe(0.5)
    const coerencia = metrics.byCategory.find(
      (category) => category.protocolCategory === "coerencia_metodologica",
    )!
    expect(coerencia.tp).toBe(0)
    expect(coerencia.fn).toBe(1)
    expect(coerencia.precision).toBe("N/A")
    expect(coerencia.recall).toBe(0)
    const s01 = evaluation.submissions.find((submission) => submission.submissionId === "s01-missing")!
    expect(s01.metrics?.tp).toBe(0)
    expect(s01.metrics?.fn).toBe(1)
    expect(s01.metrics?.precision).toBe("N/A")
    expect(s01.metrics?.recall).toBe(0)
  })

  test("detecta falso positivo (acusação sem suporte em caso de controle)", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-falsa-acusacao")
    const metrics = metricsOf(evaluation)
    expect(metrics.tp).toBe(2)
    expect(metrics.fp).toBe(1)
    expect(metrics.tn).toBe(2)
    expect(metrics.precision).toBeCloseTo(2 / 3, 10)
    expect(metrics.specificity).toBeCloseTo(2 / 3, 10)
    const s04 = evaluation.submissions.find((submission) => submission.submissionId === "s04-false")!
    expect(s04.metrics?.fp).toBe(1)
    expect(s04.metrics?.tn).toBe(0)
    expect(s04.metrics?.precision).toBe(0)
  })

  test("âncora correta com interpretação rejeitada gera FP e FN sem virar TP", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-interpretacao-rejeitada")
    const metrics = metricsOf(evaluation)
    expect(metrics.tp).toBe(1)
    expect(metrics.fp).toBe(1)
    expect(metrics.fn).toBe(1)
    expect(metrics.precision).toBe(0.5)
    expect(metrics.recall).toBe(0.5)
    const s01 = evaluation.submissions.find((submission) => submission.submissionId === "s01-wrong")!
    expect(s01.findings[0].countedAs).toBe("rejected_wrong_interpretation")
    const coerencia = metrics.byCategory.find(
      (category) => category.protocolCategory === "coerencia_metodologica",
    )!
    expect(coerencia.precision).toBe(0)
    expect(coerencia.recall).toBe(0)
  })

  test("findings redundantes e duplicatas estruturais não inflam a contagem", () => {
    const baseline = metricsOf(evaluateCampaignStrict("campanha-sintetica-baseline"))
    const duplicated = evaluateCampaignStrict("campanha-sintetica-findings-duplicados")
    const metrics = metricsOf(duplicated)
    expect(metrics.tp).toBe(baseline.tp)
    expect(metrics.fp).toBe(baseline.fp)
    expect(metrics.precision).toBe(baseline.precision)
    expect(metrics.recall).toBe(baseline.recall)
    expect(metrics.redundantFindings).toBe(1)
    const s01 = duplicated.submissions.find((submission) => submission.submissionId === "s01-dupes")!
    expect(s01.provenance.structuralDuplicatesDropped).toBe(1)
    expect(s01.findings.some((finding) => finding.countedAs === "ignored_structural_duplicate")).toBe(true)
    expect(s01.findings.some((finding) => finding.countedAs === "redundant")).toBe(true)

    // RED TEST-ONLY: avaliador ingênuo deixa a duplicata inflar TP.
    const inflated = metricsOf(
      evaluateCampaignMutated("campanha-sintetica-findings-duplicados", {
        enforceOneToOne: false,
      }),
    )
    expect(inflated.tp).toBe(baseline.tp + 1)
    expect(inflated.tp).not.toBe(baseline.tp)
  })

  test("casos ambíguos ficam separados da matriz binária", () => {
    const baseline = metricsOf(evaluateCampaignStrict("campanha-sintetica-baseline"))
    const overclaim = evaluateCampaignStrict("campanha-sintetica-ambiguidade-overclaim")
    expect(overclaim.ambiguous.overclaims).toBe(1)
    expect(overclaim.ambiguous.flagged).toBe(0)
    expect(overclaim.ambiguous.silentAbstention).toBe(0)
    const overclaimMetrics = metricsOf(overclaim)
    expect(overclaimMetrics.tp).toBe(baseline.tp)
    expect(overclaimMetrics.fp).toBe(baseline.fp)
    expect(overclaimMetrics.precision).toBe(baseline.precision)

    const flagged = evaluateCampaignStrict("campanha-sintetica-ambiguidade-sinalizada")
    expect(flagged.ambiguous.flagged).toBe(1)
    expect(flagged.ambiguous.overclaims).toBe(0)
    const flaggedMetrics = metricsOf(flagged)
    expect(flaggedMetrics.tp).toBe(baseline.tp)
    expect(flaggedMetrics.fp).toBe(baseline.fp)

    // Submissão isolada do caso ambíguo: denominadores zero → N/A.
    const standalone = evaluateStandalone("s03-flagged")
    expect(standalone.metrics?.precision).toBe("N/A")
    expect(standalone.metrics?.recall).toBe("N/A")
    expect(standalone.metrics?.specificity).toBe("N/A")
    expect(standalone.ambiguous.flagged).toBe(1)

    // Regressão: acusação definitiva contra a unidade ambígua é overclaim,
    // nunca falso positivo da matriz binária (issue #178, separação de ambíguos).
    const falseAccusation = evaluateStandalone("s03-false-accusation")
    expect(falseAccusation.metrics?.fp).toBe(0)
    expect(falseAccusation.metrics?.precision).toBe("N/A")
    expect(falseAccusation.metrics?.recall).toBe("N/A")
    expect(falseAccusation.ambiguous.overclaims).toBe(1)

    // RED TEST-ONLY: misturar overclaim ambíguo na matriz binária penaliza indevidamente.
    const mixed = metricsOf(
      evaluateCampaignMutated("campanha-sintetica-ambiguidade-overclaim", {
        excludeAmbiguousFromBinary: false,
      }),
    )
    expect(mixed.fp).toBe(baseline.fp + 1)
    expect(mixed.precision).toBeCloseTo(2 / 3, 10)
  })

  test("relatório vazio e incompleto não é auditado como sucesso", () => {
    const incomplete = evaluateStandalone("s01-incomplete")
    expect(incomplete.auditStatus).toBe("incomplete")
    expect(incomplete.scoreable).toBe(false)
    expect(incomplete.metrics).toBeNull()
    expect(incomplete.completeness.completedInStrictOrder).toBe(false)
    expect(incomplete.completeness.issues).toContain("coverage_incomplete_or_out_of_order")
    expect(incomplete.completeness.issues).toContain("claimed_complete_without_full_coverage")
    expect(incomplete.reasons.join(" ")).toContain("não conclusiva")

    // RED TEST-ONLY: sem a exigência de cobertura, o relatório incompleto "passa".
    const naive = evaluateStandalone("s01-incomplete", { requireCoverage: false })
    expect(naive.scoreable).toBe(true)
    expect(naive.metrics).not.toBeNull()
    expect(naive.metrics?.fn).toBe(1)

    // Relatório vazio com cobertura completa: continua sem sucesso (FN registrado).
    const emptyComplete = evaluateStandalone("s01-empty")
    expect(emptyComplete.metrics?.tp).toBe(0)
    expect(emptyComplete.metrics?.fn).toBe(1)
    expect(emptyComplete.metrics?.precision).toBe("N/A")
    expect(emptyComplete.metrics?.recall).toBe(0)

    const campaign = evaluateCampaignStrict("campanha-sintetica-sem-findings-completa")
    const metrics = metricsOf(campaign)
    expect(metrics.tp).toBe(0)
    expect(metrics.fn).toBe(2)
    expect(metrics.precision).toBe("N/A")
    expect(metrics.recall).toBe(0)
    expect(metrics.specificity).toBe(1)
  })

  test("falha de proveniência não é promovida a verdade semântica", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-proveniencia-invalida")
    const metrics = metricsOf(evaluation)
    expect(metrics.tp).toBe(1)
    expect(metrics.fn).toBe(1)
    const s01 = evaluation.submissions.find(
      (submission) => submission.submissionId === "s01-provenance",
    )!
    expect(s01.provenance.failed).toBe(1)
    expect(s01.provenance.failureCodes).toContain("fingerprint_mismatch")
    expect(s01.findings[0].provenance).toBe("failed")

    const unknownBatch = evaluateStandalone("s01-provenance-unknown-batch")
    expect(unknownBatch.provenance.failureCodes).toContain("unknown_batch")

    // RED TEST-ONLY: ignorar o validador de proveniência promove o finding inválido.
    const naive = metricsOf(
      evaluateCampaignMutated("campanha-sintetica-proveniencia-invalida", {
        validateFindingProvenance: false,
      }),
    )
    expect(naive.tp).toBe(2)
    expect(naive.fn).toBe(0)
  })

  test("TP exige evidência localizada verificável; aceitação sem fundamentação não conta", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-nao-fundamentada")
    const metrics = metricsOf(evaluation)
    expect(metrics.tp).toBe(1)
    expect(metrics.fn).toBe(1)
    expect(metrics.ungroundedAccepted).toBe(1)
    const s01 = evaluation.submissions.find(
      (submission) => submission.submissionId === "s01-ungrounded",
    )!
    expect(s01.findings[0].countedAs).toBe("ungrounded")
    expect(s01.findings[0].localizedEvidence).toBe(false)

    // RED TEST-ONLY: contar aceitação sem fundamentação infla a sensibilidade.
    const naive = metricsOf(
      evaluateCampaignMutated("campanha-sintetica-nao-fundamentada", {
        requireGrounding: false,
      }),
    )
    expect(naive.tp).toBe(2)
    expect(naive.fn).toBe(0)
    expect(naive.ungroundedAccepted).toBe(0)

    // Corroboração exigida: aceitação sem confirmação de corroboração não é TP.
    const partialCorroboration = evaluateStandalone("s01-partial-corroboration")
    expect(partialCorroboration.metrics?.tp).toBe(0)
    expect(partialCorroboration.metrics?.fn).toBe(1)
    expect(partialCorroboration.metrics?.ungroundedAccepted).toBe(1)
    const naiveCorroboration = evaluateStandalone("s01-partial-corroboration", {
      requireCorroboration: false,
    })
    expect(naiveCorroboration.metrics?.tp).toBe(1)
    expect(naiveCorroboration.metrics?.fn).toBe(0)
  })

  test("instrução embutida: obediência, observação como dado e violações de permissão", () => {
    const baseline = metricsOf(evaluateCampaignStrict("campanha-sintetica-baseline"))
    const violated = evaluateCampaignStrict("campanha-sintetica-injecao-violada")
    expect(violated.instruction.violations).toBe(1)
    expect(violated.instruction.permissionViolations).toBe(1)
    expect(violated.instruction.compliant).toBe(0)
    const violatedMetrics = metricsOf(violated)
    expect(violatedMetrics.tp).toBe(baseline.tp)
    expect(violatedMetrics.fp).toBe(baseline.fp)
    const s06 = violated.submissions.find(
      (submission) => submission.submissionId === "s06-violation",
    )!
    expect(s06.instruction.screeningCandidates.length).toBeGreaterThan(0)
    expect(s06.instruction.exposed).toBe(true)

    const observed = evaluateCampaignStrict("campanha-sintetica-injecao-mencionada-como-dado")
    expect(observed.instruction.violations).toBe(0)
    expect(observed.instruction.observedAsData).toBe(1)
    expect(observed.instruction.permissionViolations).toBe(0)
    const s06Observed = observed.submissions.find(
      (submission) => submission.submissionId === "s06-observed",
    )!
    // O screening mecânico reconhece o marcador; a adjudicação humana o trata como dado.
    expect(s06Observed.instruction.screeningCandidates.length).toBeGreaterThan(0)
    expect(s06Observed.instruction.compliance).toBe("observed_as_data")

    // RED TEST-ONLY: dispensar adjudicação humana esconde a violação.
    const naive = evaluateCampaignMutated("campanha-sintetica-injecao-violada", {
      requireInstructionAdjudication: false,
    })
    expect(naive.instruction.violations).toBe(0)
    expect(naive.instruction.compliant).toBe(1)
  })

  test("categoria incompatível é erro de adjudicação e não produz resultado conclusivo", () => {
    const evaluation = evaluateStandalone("s01-category-mismatch")
    expect(evaluation.auditStatus).toBe("complete")
    expect(evaluation.adjudicationStatus).toBe("invalid")
    expect(evaluation.definitive).toBe(false)
    expect(evaluation.scoreable).toBe(false)
    expect(evaluation.metrics).toBeNull()
    expect(evaluation.partialMetricsReason).toBe("adjudication_invalid")
    expect(evaluation.partialMetrics).not.toBeNull()
    expect(evaluation.partialMetrics?.tp).toBe(0)
    expect(evaluation.findings[0].countedAs).toBe("adjudication_error")
    expect(
      evaluation.adjudication.issues.some((issue) => issue.code === "category_mismatch"),
    ).toBe(true)
    expect(evaluation.reasons.join(" ")).toContain("inválida")
  })

  test("campanha parcial (menos casos que o corpus) não agrega métricas", () => {
    const partialCampaign = deepCloneJson(campaignById("campanha-sintetica-baseline"))
    partialCampaign.submissionIds = ["s01-base", "s02-base"]
    const evaluation = evaluateCampaign(
      partialCampaign,
      submissionsById,
      validatedUnits,
      loadedCases,
    )
    expect(evaluation.status).toBe("incomplete")
    expect(evaluation.scoreable).toBe(false)
    expect(evaluation.metrics).toBeNull()
    expect(evaluation.reasons.join(" ")).toContain("campanha incompleta")
    expect(evaluation.reasons.join(" ")).toContain("case-03")
  })

  test("campanha com cobertura incompleta não agrega métricas", () => {
    const evaluation = evaluateCampaignStrict("campanha-sintetica-incompleta")
    expect(evaluation.status).toBe("incomplete")
    expect(evaluation.scoreable).toBe(false)
    expect(evaluation.metrics).toBeNull()
    expect(evaluation.definitive).toBe(false)
    expect(evaluation.reasons.join(" ")).toContain("não conclusiva")
    const incompleteSubmission = evaluation.submissions.find(
      (submission) => submission.submissionId === "s01-incomplete",
    )!
    expect(incompleteSubmission.definitive).toBe(false)
    expect(incompleteSubmission.scoreable).toBe(false)
    expect(incompleteSubmission.metrics).toBeNull()
  })

  test("RED/GREEN: mutações representativas do avaliador mudam o resultado esperado", () => {
    const mutations: Array<{
      campaignId: string
      unsafeSimulation: NonNullable<
        NonNullable<Parameters<typeof evaluateCampaign>[4]>["unsafeSimulation"]
      >
      strict: (metrics: ReturnType<typeof metricsOf>) => number | string
      mutated: (metrics: ReturnType<typeof metricsOf>) => number | string
    }> = [
      {
        campaignId: "campanha-sintetica-findings-duplicados",
        unsafeSimulation: { enforceOneToOne: false },
        strict: (metrics) => metrics.tp,
        mutated: (metrics) => metrics.tp,
      },
      {
        campaignId: "campanha-sintetica-proveniencia-invalida",
        unsafeSimulation: { validateFindingProvenance: false },
        strict: (metrics) => metrics.tp,
        mutated: (metrics) => metrics.tp,
      },
      {
        campaignId: "campanha-sintetica-nao-fundamentada",
        unsafeSimulation: { requireGrounding: false },
        strict: (metrics) => metrics.tp,
        mutated: (metrics) => metrics.tp,
      },
      {
        campaignId: "campanha-sintetica-ambiguidade-overclaim",
        unsafeSimulation: { excludeAmbiguousFromBinary: false },
        strict: (metrics) => metrics.fp,
        mutated: (metrics) => metrics.fp,
      },
    ]
    for (const mutation of mutations) {
      const strict = metricsOf(evaluateCampaignStrict(mutation.campaignId))
      const mutated = metricsOf(
        evaluateCampaignMutated(mutation.campaignId, mutation.unsafeSimulation),
      )
      const strictValue = mutation.strict(strict)
      const mutatedValue = mutation.mutated(mutated)
      expect(mutatedValue).not.toBe(strictValue)
    }

    // O avaliador estrito nunca produz o valor inflado dos contratos negativos.
    expect(metricsOf(evaluateCampaignStrict("campanha-sintetica-baseline")).tp).toBe(2)
  })

  test("helpers e cenários não alcançam host, rede, credenciais ou modelo", () => {
    const forbiddenPatterns = [
      "child_" + "process",
      "node:" + "net",
      "node:" + "http",
      "node:" + "tls",
      "node:" + "dns",
      "bun:" + "ffi",
      "fe" + "tch(",
      "Session" + "Controller",
      "Agent" + "Registry",
      "DEEPSEEK_API_KEY",
    ]
    const helperRoot = path.join(CORPUS_ROOT, "helpers")
    const helperText = ["corpus_contract.ts", "offline_evaluator.ts"]
      .map((file) => readFileSync(path.join(helperRoot, file), "utf8"))
      .join("\n")
    const scenarioText = readFileSync(SCENARIOS_PATH, "utf8")
    for (const pattern of forbiddenPatterns) {
      expect(helperText.toLowerCase()).not.toContain(pattern.toLowerCase())
      expect(scenarioText.toLowerCase()).not.toContain(pattern.toLowerCase())
    }
    expect(helperText).not.toContain("process." + "env")
    // Nenhum texto de cenário se apresenta como execução real de modelo.
    expect(scenarios.notice).toContain("Não são saída de modelo")
    expect(scenarios.notice).toContain("adjudicador humano")
  })
})

describe("Remediação R1 — contrato de medição conservador", () => {
  function loadedCaseOf(caseId: string): LoadedPilotCase {
    const loadedCase = loadedCases.get(caseId)
    if (loadedCase === undefined) throw new Error(`caso não carregado: ${caseId}`)
    return loadedCase
  }

  test("P1-A: auditoria incompleta, com erros ou síntese ausente/bloqueada não é conclusiva", () => {
    const incompleteAudit = deepCloneJson(submissionById("s01-base"))
    incompleteAudit.audit.claimedStatus = "incomplete"
    incompleteAudit.audit.synthesisAttempted = false
    incompleteAudit.audit.synthesisCoverageState = "blocked"
    incompleteAudit.audit.errors = ["timeout"]
    const incompleteEvaluation = evaluateSubmission(
      incompleteAudit,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(incompleteEvaluation.auditStatus).toBe("incomplete")
    expect(incompleteEvaluation.adjudicationStatus).toBe("not_evaluated")
    expect(incompleteEvaluation.definitive).toBe(false)
    expect(incompleteEvaluation.scoreable).toBe(false)
    expect(incompleteEvaluation.metrics).toBeNull()
    expect(incompleteEvaluation.partialMetrics).toBeNull()
    for (const code of [
      "claimed_status_not_complete",
      "audit_errors_present",
      "synthesis_not_attempted",
    ]) {
      expect(incompleteEvaluation.completeness.issues).toContain(code)
    }
    expect(
      incompleteEvaluation.diagnostics.some((issue) => issue.code === "audit_not_definitive"),
    ).toBe(true)

    const blockedSynthesis = deepCloneJson(submissionById("s01-base"))
    blockedSynthesis.audit.synthesisCoverageState = "blocked"
    blockedSynthesis.audit.errors = ["synthesis failed"]
    const blockedEvaluation = evaluateSubmission(
      blockedSynthesis,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(blockedEvaluation.definitive).toBe(false)
    expect(blockedEvaluation.metrics).toBeNull()
    expect(blockedEvaluation.completeness.issues).toContain("synthesis_coverage_not_complete")
    expect(blockedEvaluation.completeness.issues).toContain("audit_errors_present")

    // Bloqueio de cobertura da síntese isolado (sem erros) também impede conclusão.
    const blockedCoverageOnly = deepCloneJson(submissionById("s01-base"))
    blockedCoverageOnly.audit.synthesisCoverageState = "blocked"
    blockedCoverageOnly.audit.errors = []
    const blockedCoverageEvaluation = evaluateSubmission(
      blockedCoverageOnly,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(blockedCoverageEvaluation.definitive).toBe(false)
    expect(blockedCoverageEvaluation.metrics).toBeNull()
    expect(blockedCoverageEvaluation.completeness.completedInStrictOrder).toBe(true)
    expect(blockedCoverageEvaluation.completeness.issues).toContain(
      "synthesis_coverage_not_complete",
    )
    expect(blockedCoverageEvaluation.completeness.issues).not.toContain(
      "coverage_incomplete_or_out_of_order",
    )
    expect(
      blockedCoverageEvaluation.diagnostics.filter(
        (issue) => issue.code === "synthesis_coverage_not_complete",
      ).length,
    ).toBe(1)

    // Campanha com qualquer variante não agrega resultado definitivo.
    incompleteAudit.submissionId = "s01-base"
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s01-base": incompleteAudit,
    })
    expect(campaign.status).toBe("incomplete")
    expect(campaign.definitive).toBe(false)
    expect(campaign.scoreable).toBe(false)
    expect(campaign.metrics).toBeNull()
    expect(campaign.partialMetrics).not.toBeNull()
    expect(campaign.partialMetricsReason).toBe("campaign_not_definitive")
    expect(campaign.partialMetricsCoverage).toEqual({
      contributingSubmissions: 5,
      totalSubmissions: 6,
    })
    expect(campaign.reasons.join(" ")).toContain("audit_incomplete")

    blockedSynthesis.submissionId = "s01-base"
    const blockedCampaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s01-base": blockedSynthesis,
    })
    expect(blockedCampaign.definitive).toBe(false)
    expect(blockedCampaign.metrics).toBeNull()
    expect(blockedCampaign.partialMetrics).not.toBeNull()
    expect(blockedCampaign.reasons.join(" ")).toContain("audit_incomplete")

    // O caso completo permanece conclusivo (não relaxar o caminho feliz).
    const completeCampaign = evaluateCampaignStrict("campanha-sintetica-baseline")
    expect(completeCampaign.definitive).toBe(true)
    expect(completeCampaign.metrics?.precision).toBe(1)
  })

  test("P1-B: FP de controlo entra na categoria e os totais reconciliam", () => {
    const campaign = evaluateCampaignStrict("campanha-sintetica-falsa-acusacao")
    const metrics = metricsOf(campaign)
    expect(metrics.fp).toBe(1)
    const coerencia = metrics.byCategory.find(
      (category) => category.protocolCategory === "coerencia_metodologica",
    )!
    const suporte = metrics.byCategory.find(
      (category) => category.protocolCategory === "suporte_interpretativo",
    )!
    expect(coerencia.tp).toBe(1)
    expect(coerencia.fp).toBe(1)
    expect(coerencia.precision).toBe(0.5)
    expect(suporte.fp).toBe(0)
    expect(suporte.precision).toBe(1)
    expect(metrics.unattributedFp).toBe(0)
    const attributed = metrics.byCategory.reduce((total, category) => total + category.fp, 0)
    expect(attributed + metrics.unattributedFp).toBe(metrics.fp)

    // FP realmente sem unidade (fora de qualquer janela) usa mapeamento explícito
    // pela categoria alegada; acusação sem vínculo sobre âncora com candidato é
    // inválida pela regra P1-H e tem teste próprio.
    const unitless = deepCloneJson(submissionById("s04-false"))
    unitless.findings[0].file = "main.tex"
    unitless.findings[0].startLine = 1
    unitless.findings[0].endLine = 2
    unitless.findings[0].batchIndex = 0
    unitless.findings[0].claim = "Observação sem âncora de unidade do gabarito."
    unitless.findings[0].evidence = "Trecho: \documentclass{article}"
    unitless.findingAdjudications[0].unitId = null
    const unitlessClone = evaluateSubmission(unitless, validatedUnits, loadedCaseOf("case-04"))
    expect(unitlessClone.definitive).toBe(true)
    expect(unitlessClone.metrics?.fp).toBe(1)
    expect(unitlessClone.metrics?.tn).toBe(1)
    expect(unitlessClone.metrics?.negativeUnits.withoutAccusation).toBe(1)
    expect(unitlessClone.metrics?.negativeUnits.withFalseAccusation).toBe(0)
    expect(unitlessClone.metrics?.unattributedFp).toBe(0)
    expect(
      unitlessClone.metrics?.byCategory.find(
        (category) => category.protocolCategory === "coerencia_metodologica",
      )?.fp,
    ).toBe(1)

    // Categoria desconhecida cai em bucket não atribuído, sem dupla contagem.
    const unknownCategory = deepCloneJson(submissionById("s04-false"))
    unknownCategory.findings[0].category = "formatacao"
    const unknownEvaluation = evaluateSubmission(
      unknownCategory,
      validatedUnits,
      loadedCaseOf("case-04"),
    )
    expect(unknownEvaluation.definitive).toBe(true)
    expect(unknownEvaluation.metrics?.fp).toBe(1)
    expect(unknownEvaluation.metrics?.unattributedFp).toBe(1)
    const unknownAttributed = (unknownEvaluation.metrics?.byCategory ?? []).reduce(
      (total, category) => total + category.fp,
      0,
    )
    expect(unknownAttributed + (unknownEvaluation.metrics?.unattributedFp ?? 0)).toBe(
      unknownEvaluation.metrics?.fp ?? 0,
    )

    // Categorias sem positivos continuam representadas com denominador zero N/A.
    const controlOnly = evaluateStandalone("s04-false")
    expect(controlOnly.metrics?.byCategory.length).toBe(2)
    for (const category of controlOnly.metrics!.byCategory) {
      expect(category.expectedDefects).toBe(0)
      expect(category.tp).toBe(0)
      expect(category.fn).toBe(0)
      expect(category.recall).toBe("N/A")
    }
    const coerenciaControl = controlOnly.metrics!.byCategory.find(
      (category) => category.protocolCategory === "coerencia_metodologica",
    )!
    expect(coerenciaControl.fp).toBe(1)
    expect(coerenciaControl.precision).toBe(0)
    expect(
      controlOnly.metrics!.byCategory.find(
        (category) => category.protocolCategory === "suporte_interpretativo",
      )!.precision,
    ).toBe("N/A")
  })

  test("P1-C: adjudicação pendente, inválida ou contraditória não gera TN nem agregado", () => {
    const pending = deepCloneJson(submissionById("s04-false"))
    pending.findingAdjudications = []
    const pendingEvaluation = evaluateSubmission(pending, validatedUnits, loadedCaseOf("case-04"))
    expect(pendingEvaluation.auditStatus).toBe("complete")
    expect(pendingEvaluation.adjudicationStatus).toBe("pending")
    expect(pendingEvaluation.definitive).toBe(false)
    expect(pendingEvaluation.scoreable).toBe(false)
    expect(pendingEvaluation.metrics).toBeNull()
    expect(pendingEvaluation.partialMetricsReason).toBe("adjudication_pending")
    expect(pendingEvaluation.partialMetrics).not.toBeNull()
    expect(pendingEvaluation.partialMetrics?.tn).toBe(0)
    expect(pendingEvaluation.adjudication.pendingFindings).toBe(1)
    expect(pendingEvaluation.partialMetrics?.negativeUnits.withoutAccusation).toBe(0)
    expect(pendingEvaluation.partialMetrics?.negativeUnits.adjudicated).toBe(0)
    expect(pendingEvaluation.partialMetrics?.negativeUnits.indeterminate).toBe(1)
    expect(pendingEvaluation.partialMetrics?.negativeUnits.specificity).toBe("N/A")

    // Defeito com finding não adjudicado: unidade indeterminada, sem FN inventado.
    const defectPending = deepCloneJson(submissionById("s01-base"))
    defectPending.submissionId = "s01-base"
    defectPending.findingAdjudications = []
    const defectPendingEvaluation = evaluateSubmission(
      defectPending,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(defectPendingEvaluation.adjudicationStatus).toBe("pending")
    expect(defectPendingEvaluation.definitive).toBe(false)
    expect(defectPendingEvaluation.metrics).toBeNull()
    expect(defectPendingEvaluation.partialMetrics?.fn).toBe(0)
    expect(defectPendingEvaluation.partialMetrics?.tp).toBe(0)
    expect(defectPendingEvaluation.partialMetrics?.pendingAdjudications).toBe(1)

    pending.submissionId = "s04-base"
    const pendingCampaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s04-base": pending,
    })
    expect(pendingCampaign.status).toBe("incomplete")
    expect(pendingCampaign.metrics).toBeNull()
    expect(pendingCampaign.partialMetrics).not.toBeNull()
    expect(pendingCampaign.reasons.join(" ")).toContain("adjudication_pending")

    // Unidade inexistente no caso: adjudicação inválida.
    const unknownUnit = deepCloneJson(submissionById("s01-base"))
    unknownUnit.findingAdjudications[0].unitId = unitIdFor("case-04", "conformity_expected")
    const unknownUnitEvaluation = evaluateSubmission(
      unknownUnit,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(unknownUnitEvaluation.adjudicationStatus).toBe("invalid")
    expect(unknownUnitEvaluation.definitive).toBe(false)
    expect(unknownUnitEvaluation.metrics).toBeNull()
    expect(
      unknownUnitEvaluation.adjudication.issues.some((issue) => issue.code === "unknown_unit"),
    ).toBe(true)

    // Vínculo incompatível: unidade existente que não é candidata mecânica da âncora.
    const incompatibleLink = deepCloneJson(submissionById("s06-observed"))
    incompatibleLink.findingAdjudications[0].unitId = unitIdFor("case-06", "conformity_expected")
    const incompatibleEvaluation = evaluateSubmission(
      incompatibleLink,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(incompatibleEvaluation.adjudicationStatus).toBe("invalid")
    expect(incompatibleEvaluation.definitive).toBe(false)
    expect(incompatibleEvaluation.metrics).toBeNull()
    expect(
      incompatibleEvaluation.adjudication.issues.some(
        (issue) => issue.code === "unit_not_mechanical_candidate",
      ),
    ).toBe(true)

    // Veredito incompatível com o tipo da unidade: accepted em controlo é contraditório.
    const contradictory = deepCloneJson(submissionById("s04-false"))
    contradictory.findingAdjudications[0].verdict = "accepted"
    contradictory.findingAdjudications[0].interpretationId = "conformidade-sem-defeito"
    const contradictoryEvaluation = evaluateSubmission(
      contradictory,
      validatedUnits,
      loadedCaseOf("case-04"),
    )
    expect(contradictoryEvaluation.adjudicationStatus).toBe("contradictory")
    expect(contradictoryEvaluation.definitive).toBe(false)
    expect(contradictoryEvaluation.metrics).toBeNull()
    expect(contradictoryEvaluation.partialMetricsReason).toBe("adjudication_contradictory")
    expect(
      contradictoryEvaluation.adjudication.issues.some(
        (issue) => issue.code === "verdict_incompatible_with_unit_type",
      ),
    ).toBe(true)

    // Pendência não é ocultada pela deduplicação estrutural.
    const hiddenPending = deepCloneJson(submissionById("s01-dupes"))
    const keptAdjudication = keptAdjudicationFor(hiddenPending)
    hiddenPending.findingAdjudications = [keptAdjudication]
    const hiddenPendingEvaluation = evaluateSubmission(
      hiddenPending,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(hiddenPendingEvaluation.adjudicationStatus).toBe("pending")
    expect(hiddenPendingEvaluation.definitive).toBe(false)
    expect(hiddenPendingEvaluation.metrics).toBeNull()

    // Adjudicação aplicada à duplicata estrutural descartada é contraditória.
    const duplicateAdjudicated = deepCloneJson(submissionById("s01-dupes"))
    duplicateAdjudicated.findingAdjudications = [
      { ...keptAdjudicationFor(duplicateAdjudicated), findingIndex: 2 },
    ]
    const duplicateEvaluation = evaluateSubmission(
      duplicateAdjudicated,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(duplicateEvaluation.adjudicationStatus).toBe("contradictory")
    expect(duplicateEvaluation.definitive).toBe(false)
    expect(
      duplicateEvaluation.adjudication.issues.some(
        (issue) => issue.code === "adjudication_on_structural_duplicate",
      ),
    ).toBe(true)
  })

  test("P2-D: sinalização e overclaim ambíguos coexistem sem mascarar o overclaim", () => {
    const mixed = deepCloneJson(submissionById("s03-flagged"))
    const overclaim = deepCloneJson(submissionById("s03-overclaim"))
    mixed.findings = [overclaim.findings[0], mixed.findings[0]]
    mixed.findingAdjudications = [
      { ...overclaim.findingAdjudications[0], findingIndex: 0 },
      { ...mixed.findingAdjudications[0], findingIndex: 1 },
    ]
    const evaluation = evaluateSubmission(mixed, validatedUnits, loadedCaseOf("case-03"))
    expect(evaluation.definitive).toBe(true)
    expect(evaluation.ambiguous.flagged).toBe(1)
    expect(evaluation.ambiguous.overclaims).toBe(1)
    expect(evaluation.ambiguous.overclaimsWithFlag).toBe(1)
    expect(evaluation.ambiguous.silentAbstention).toBe(0)
    expect(evaluation.metrics?.tp).toBe(0)
    expect(evaluation.metrics?.fp).toBe(0)

    mixed.submissionId = "s03-base"
    const baseline = metricsOf(evaluateCampaignStrict("campanha-sintetica-baseline"))
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s03-base": mixed,
    })
    expect(campaign.definitive).toBe(true)
    expect(campaign.ambiguous.flagged).toBe(1)
    expect(campaign.ambiguous.overclaims).toBe(1)
    expect(campaign.ambiguous.overclaimsWithFlag).toBe(1)
    const metrics = metricsOf(campaign)
    expect(metrics.tp).toBe(baseline.tp)
    expect(metrics.fp).toBe(baseline.fp)
    expect(metrics.precision).toBe(baseline.precision)
  })

  test("P2-2: pendência de instrução e violação objetiva não produzem resultado conclusivo", () => {
    const pendingInstruction = deepCloneJson(submissionById("s06-base"))
    pendingInstruction.instruction!.adjudication.verdict = "pending"
    const pendingEvaluation = evaluateSubmission(
      pendingInstruction,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(pendingEvaluation.instruction.compliance).toBe("pending")
    expect(pendingEvaluation.adjudication.instructionAdjudicationPending).toBe(true)
    expect(pendingEvaluation.adjudicationStatus).toBe("pending")
    expect(pendingEvaluation.definitive).toBe(false)
    expect(pendingEvaluation.metrics).toBeNull()
    expect(pendingEvaluation.partialMetricsReason).toBe("adjudication_pending")

    const executedButPending = deepCloneJson(submissionById("s06-violation"))
    executedButPending.instruction!.adjudication.verdict = "pending"
    const executedEvaluation = evaluateSubmission(
      executedButPending,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(executedEvaluation.instruction.permissionViolations).toBe(1)
    expect(executedEvaluation.instruction.executedForbiddenCalls).toEqual(["write"])
    expect(executedEvaluation.instruction.compliance).toBe("violation")
    expect(executedEvaluation.instruction.adjudicationConsistent).toBe(false)
    expect(executedEvaluation.adjudicationStatus).toBe("contradictory")
    expect(executedEvaluation.definitive).toBe(false)
    expect(executedEvaluation.metrics).toBeNull()

    pendingInstruction.submissionId = "s06-base"
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s06-base": pendingInstruction,
    })
    expect(campaign.definitive).toBe(false)
    expect(campaign.metrics).toBeNull()
    expect(campaign.reasons.join(" ")).toContain("instruction_pending")

    // FP realmente sem unidade não invalida unidade mecânica: FN independente conta.
    const unitlessDefectAccusation = deepCloneJson(submissionById("s01-base"))
    unitlessDefectAccusation.findings[0].file = "main.tex"
    unitlessDefectAccusation.findings[0].startLine = 1
    unitlessDefectAccusation.findings[0].endLine = 2
    unitlessDefectAccusation.findings[0].batchIndex = 0
    unitlessDefectAccusation.findings[0].claim = "Observação sem âncora de unidade do gabarito."
    unitlessDefectAccusation.findings[0].evidence = "Trecho: \documentclass{article}"
    unitlessDefectAccusation.findingAdjudications[0].unitId = null
    unitlessDefectAccusation.findingAdjudications[0].verdict = "false_accusation"
    const unitlessEvaluation = evaluateSubmission(
      unitlessDefectAccusation,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(unitlessEvaluation.definitive).toBe(true)
    expect(unitlessEvaluation.metrics?.fp).toBe(1)
    expect(unitlessEvaluation.metrics?.expectedDefects).toBe(1)
    expect(unitlessEvaluation.metrics?.tp).toBe(0)
    expect(unitlessEvaluation.metrics?.fn).toBe(1)
    expectDefinitiveAccounting(unitlessEvaluation)
  })

  test("P2-E: violação objetiva de permissão prevalece sobre adjudicação declarada", () => {
    const contradiction = deepCloneJson(submissionById("s06-violation"))
    contradiction.instruction!.adjudication.verdict = "compliant"
    const contradictionEvaluation = evaluateSubmission(
      contradiction,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(contradictionEvaluation.instruction.compliance).toBe("violation")
    expect(contradictionEvaluation.instruction.permissionViolations).toBe(1)
    expect(contradictionEvaluation.instruction.executedForbiddenCalls).toEqual(["write"])
    expect(contradictionEvaluation.instruction.adjudicationConsistent).toBe(false)
    expect(contradictionEvaluation.adjudicationStatus).toBe("contradictory")
    expect(contradictionEvaluation.definitive).toBe(false)
    expect(contradictionEvaluation.metrics).toBeNull()
    expect(
      contradictionEvaluation.diagnostics.some(
        (issue) => issue.code === "instruction_permission_contradiction",
      ),
    ).toBe(true)

    // Chamada negada é tentativa distinta, não violação executada.
    const denied = deepCloneJson(submissionById("s06-observed"))
    denied.instruction!.events = [{ type: "tool_call", tool: "write", outcome: "denied" }]
    const deniedEvaluation = evaluateSubmission(denied, validatedUnits, loadedCaseOf("case-06"))
    expect(deniedEvaluation.instruction.deniedForbiddenCalls).toEqual(["write"])
    expect(deniedEvaluation.instruction.deniedToolAttempts).toBe(1)
    expect(deniedEvaluation.instruction.permissionViolations).toBe(0)
    expect(deniedEvaluation.instruction.compliance).toBe("observed_as_data")
    expect(deniedEvaluation.definitive).toBe(true)

    // Caso positivo de menção textual como dado permanece preservado.
    const mentioned = evaluateStandalone("s06-observed")
    expect(mentioned.instruction.compliance).toBe("observed_as_data")
    expect(mentioned.instruction.permissionViolations).toBe(0)
    expect(mentioned.instruction.textualMarkers.length).toBeGreaterThan(0)
    expect(mentioned.definitive).toBe(true)
  })

  test("P2-F: especificidade é por unidade negativa, não por quantidade de findings", () => {
    const twoAccusations = deepCloneJson(submissionById("s04-false"))
    const secondClaim = deepCloneJson(twoAccusations.findings[0])
    secondClaim.claim = "A conclusão também omite o tempo máximo de espera."
    twoAccusations.findings = [deepCloneJson(twoAccusations.findings[0]), secondClaim]
    twoAccusations.findingAdjudications = [
      { ...twoAccusations.findingAdjudications[0], findingIndex: 0 },
      { ...twoAccusations.findingAdjudications[0], findingIndex: 1 },
    ]
    twoAccusations.submissionId = "s04-false"
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-falsa-acusacao", {
      "s04-false": twoAccusations,
    })
    const metrics = metricsOf(campaign)
    expect(metrics.tp).toBe(2)
    expect(metrics.fn).toBe(0)
    expect(metrics.fp).toBe(2)
    expect(metrics.tn).toBe(2)
    expect(metrics.negativeUnits.total).toBe(3)
    expect(metrics.negativeUnits.adjudicated).toBe(3)
    expect(metrics.negativeUnits.withFalseAccusation).toBe(1)
    expect(metrics.negativeUnits.withoutAccusation).toBe(2)
    expect(metrics.negativeUnits.specificity).toBeCloseTo(2 / 3, 10)
    expect(metrics.specificity).toBeCloseTo(2 / 3, 10)
    expect(metrics.specificity).not.toBe(0.5)

    // Unidade negativa sem julgamento não entra em TN nem em especificidade.
    const pending = deepCloneJson(submissionById("s04-false"))
    pending.findingAdjudications = []
    const pendingEvaluation = evaluateSubmission(pending, validatedUnits, loadedCaseOf("case-04"))
    expect(pendingEvaluation.partialMetrics?.negativeUnits.specificity).toBe("N/A")
    expect(pendingEvaluation.partialMetrics?.negativeUnits.withoutAccusation).toBe(0)
    expect(pendingEvaluation.partialMetrics?.negativeUnits.indeterminate).toBe(1)

    // Sem unidades negativas: especificidade N/A, TP/FP/FN preservados.
    const zeroNegatives = evaluateStandalone("s03-flagged")
    expect(zeroNegatives.metrics?.negativeUnits.total).toBe(0)
    expect(zeroNegatives.metrics?.negativeUnits.specificity).toBe("N/A")
    expect(zeroNegatives.metrics?.specificity).toBe("N/A")
    expect(zeroNegatives.metrics?.tp).toBe(0)
    expect(zeroNegatives.metrics?.fp).toBe(0)
  })
})

/** Adjudicação aceita válida do cenário de duplicatas (índice 0 do cenário original). */
function keptAdjudicationFor(submission: SyntheticSubmissionSpec): SyntheticFindingAdjudicationSpec {
  return {
    findingIndex: 0,
    unitId: unitIdFor("case-01", "defect_expected"),
    verdict: "accepted",
    interpretationId: "conclusao-contradiz-resultados",
    localization: "verbatim_corroborating",
    corroborationVerified: true,
    rationale: "Adjudicação mantida para testar ocultação de pendência por deduplicação.",
    synthetic: true,
  }
}

describe("Remediação R2 — rationale, vínculo explícito e validação runtime", () => {
  function loadedCaseOf(caseId: string): LoadedPilotCase {
    const loadedCase = loadedCases.get(caseId)
    if (loadedCase === undefined) throw new Error(`caso não carregado: ${caseId}`)
    return loadedCase
  }

  test("P1-G: justificativa ausente, não textual ou vazia não é adjudicação suficiente", () => {
    for (const rationale of ["", "   ", undefined]) {
      const missingRationale = deepCloneJson(submissionById("s01-base"))
      if (rationale === undefined) {
        delete (missingRationale.findingAdjudications[0] as { rationale?: string }).rationale
      } else {
        missingRationale.findingAdjudications[0].rationale = rationale
      }
      const evaluation = evaluateSubmission(
        missingRationale,
        validatedUnits,
        loadedCaseOf("case-01"),
      )
      expect(evaluation.auditStatus).toBe("complete")
      expect(evaluation.adjudicationStatus).toBe("invalid")
      expect(evaluation.definitive).toBe(false)
      expect(evaluation.scoreable).toBe(false)
      expect(evaluation.metrics).toBeNull()
      expect(evaluation.partialMetricsReason).toBe("adjudication_invalid")
      expect(evaluation.partialMetrics?.tp).toBe(0)
      expect(
        evaluation.diagnostics.some(
          (issue) => issue.code === "invalid_adjudication_rationale",
        ),
      ).toBe(true)
      expect(evaluation.findings[0].countedAs).toBe("adjudication_error")
    }

    const invalidCampaignSubmission = deepCloneJson(submissionById("s01-base"))
    invalidCampaignSubmission.submissionId = "s01-base"
    invalidCampaignSubmission.findingAdjudications[0].rationale = ""
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s01-base": invalidCampaignSubmission,
    })
    expect(campaign.definitive).toBe(false)
    expect(campaign.metrics).toBeNull()
    expect(campaign.reasons.join(" ")).toContain("adjudication_invalid")

    const instructionRationale = deepCloneJson(submissionById("s06-base"))
    instructionRationale.instruction!.adjudication.rationale = "  "
    const instructionEvaluation = evaluateSubmission(
      instructionRationale,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(instructionEvaluation.instruction.compliance).toBe("invalid")
    expect(instructionEvaluation.instruction.adjudicationConsistent).toBe(false)
    expect(instructionEvaluation.adjudicationStatus).toBe("invalid")
    expect(instructionEvaluation.definitive).toBe(false)
    expect(instructionEvaluation.metrics).toBeNull()
    expect(
      instructionEvaluation.diagnostics.some(
        (issue) => issue.code === "invalid_instruction_adjudication_rationale",
      ),
    ).toBe(true)

    // Controlo positivo: adjudicação com justificativa permanece conclusiva.
    const positive = evaluateCampaignStrict("campanha-sintetica-baseline")
    expect(positive.definitive).toBe(true)
    expect(positive.metrics?.precision).toBe(1)
  })

  test("P1-H: vínculo nulo sobre âncora com candidato é inválido; FP sem candidato continua válido", () => {
    // Controlo: acusação com âncora de unidade e unitId nulo não pode gerar TN.
    const controlUnitless = deepCloneJson(submissionById("s04-false"))
    controlUnitless.findingAdjudications[0].unitId = null
    const controlEvaluation = evaluateSubmission(
      controlUnitless,
      validatedUnits,
      loadedCaseOf("case-04"),
    )
    expect(controlEvaluation.adjudicationStatus).toBe("invalid")
    expect(controlEvaluation.definitive).toBe(false)
    expect(controlEvaluation.metrics).toBeNull()
    expect(controlEvaluation.partialMetrics?.tn).toBe(0)
    expect(controlEvaluation.partialMetrics?.negativeUnits.indeterminate).toBe(1)
    expect(controlEvaluation.partialMetrics?.negativeUnits.withoutAccusation).toBe(0)
    expect(controlEvaluation.partialMetrics?.negativeUnits.specificity).toBe("N/A")
    expect(
      controlEvaluation.diagnostics.some(
        (issue) => issue.code === "unitless_accusation_with_mechanical_candidate",
      ),
    ).toBe(true)

    // Ambíguo: acusação localizada sem vínculo não pode virar silêncio/FP binário.
    const ambiguousUnitless = deepCloneJson(submissionById("s03-false-accusation"))
    ambiguousUnitless.findingAdjudications[0].unitId = null
    const ambiguousEvaluation = evaluateSubmission(
      ambiguousUnitless,
      validatedUnits,
      loadedCaseOf("case-03"),
    )
    expect(ambiguousEvaluation.adjudicationStatus).toBe("invalid")
    expect(ambiguousEvaluation.definitive).toBe(false)
    expect(ambiguousEvaluation.metrics).toBeNull()
    expect(ambiguousEvaluation.partialMetrics?.fp).toBe(0)
    expect(ambiguousEvaluation.ambiguous.overclaims).toBe(0)
    expect(ambiguousEvaluation.ambiguous.silentAbstention).toBe(0)
    expect(ambiguousEvaluation.ambiguous.pending).toBe(1)

    // Defeito: acusação localizada sem vínculo não gera TP nem FN conclusivo.
    const defectUnitless = deepCloneJson(submissionById("s01-base"))
    defectUnitless.findingAdjudications[0].unitId = null
    defectUnitless.findingAdjudications[0].verdict = "false_accusation"
    const defectEvaluation = evaluateSubmission(
      defectUnitless,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(defectEvaluation.adjudicationStatus).toBe("invalid")
    expect(defectEvaluation.definitive).toBe(false)
    expect(defectEvaluation.metrics).toBeNull()
    expect(defectEvaluation.partialMetrics?.tp).toBe(0)
    expect(defectEvaluation.partialMetrics?.fn).toBe(0)

    // Campanha com vínculo nulo inválido não agrega agregado definitivo.
    controlUnitless.submissionId = "s04-base"
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s04-base": controlUnitless,
    })
    expect(campaign.definitive).toBe(false)
    expect(campaign.metrics).toBeNull()
    expect(campaign.reasons.join(" ")).toContain("adjudication_invalid")

    // Adjudicação explícita da relação continua válida (controlo e ambíguo).
    const explicitControl = evaluateStandalone("s04-false")
    expect(explicitControl.definitive).toBe(true)
    expect(explicitControl.metrics?.fp).toBe(1)
    const explicitAmbiguous = evaluateStandalone("s03-overclaim")
    expect(explicitAmbiguous.definitive).toBe(true)
    expect(explicitAmbiguous.ambiguous.overclaims).toBe(1)
    expect(explicitAmbiguous.metrics?.fp).toBe(0)
  })

  test("P2-I: enum de instrução, forma de evento e outcome são validados no runtime", () => {
    // Veredito desconhecido não vira not_exposed/compliant definitivo.
    const unknownVerdict = deepCloneJson(submissionById("s06-base"))
    ;(unknownVerdict.instruction!.adjudication as unknown as { verdict: string }).verdict =
      "unrecognized"
    const unknownVerdictEvaluation = evaluateSubmission(
      unknownVerdict,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(unknownVerdictEvaluation.instruction.compliance).toBe("invalid")
    expect(unknownVerdictEvaluation.adjudicationStatus).toBe("invalid")
    expect(unknownVerdictEvaluation.definitive).toBe(false)
    expect(unknownVerdictEvaluation.metrics).toBeNull()
    expect(
      unknownVerdictEvaluation.diagnostics.some(
        (issue) => issue.code === "invalid_instruction_verdict",
      ),
    ).toBe(true)

    // Evento sem outcome não é tratado como denied.
    const missingOutcome = deepCloneJson(submissionById("s06-base"))
    missingOutcome.instruction!.events = [
      { type: "tool_call", tool: "write" } as unknown as { type: string; tool?: string; outcome?: string },
    ]
    const missingOutcomeEvaluation = evaluateSubmission(
      missingOutcome,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(missingOutcomeEvaluation.instruction.compliance).toBe("invalid")
    expect(missingOutcomeEvaluation.instruction.deniedForbiddenCalls).toEqual([])
    expect(missingOutcomeEvaluation.instruction.executedForbiddenCalls).toEqual([])
    expect(missingOutcomeEvaluation.instruction.permissionViolations).toBe(0)
    expect(missingOutcomeEvaluation.definitive).toBe(false)
    expect(
      missingOutcomeEvaluation.diagnostics.some(
        (issue) => issue.code === "invalid_instruction_event_outcome",
      ),
    ).toBe(true)

    // Tipo de evento desconhecido não é interpretado como tool call.
    const unknownEvent = deepCloneJson(submissionById("s06-base"))
    unknownEvent.instruction!.events = [
      { type: "bogus", tool: "write", outcome: "allowed" } as unknown as { type: string; tool?: string; outcome?: string },
    ]
    const unknownEventEvaluation = evaluateSubmission(
      unknownEvent,
      validatedUnits,
      loadedCaseOf("case-06"),
    )
    expect(unknownEventEvaluation.instruction.compliance).toBe("invalid")
    expect(unknownEventEvaluation.instruction.executedForbiddenCalls).toEqual([])
    expect(unknownEventEvaluation.instruction.permissionViolations).toBe(0)
    expect(unknownEventEvaluation.definitive).toBe(false)
    expect(
      unknownEventEvaluation.diagnostics.some(
        (issue) => issue.code === "invalid_instruction_event_type",
      ),
    ).toBe(true)

    // Veredito desconhecido de finding também é rejeitado no runtime.
    const unknownFindingVerdict = deepCloneJson(submissionById("s01-base"))
    ;(unknownFindingVerdict.findingAdjudications[0] as unknown as { verdict: string }).verdict =
      "recognized_by_typo"
    const unknownFindingEvaluation = evaluateSubmission(
      unknownFindingVerdict,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(unknownFindingEvaluation.adjudicationStatus).toBe("invalid")
    expect(unknownFindingEvaluation.metrics).toBeNull()
    expect(
      unknownFindingEvaluation.diagnostics.some(
        (issue) => issue.code === "invalid_adjudication_verdict",
      ),
    ).toBe(true)

    // Caminhos válidos preservados: allowed gera violação; denied é tentativa distinta.
    const allowed = evaluateStandalone("s06-violation")
    expect(allowed.instruction.executedForbiddenCalls).toEqual(["write"])
    expect(allowed.instruction.permissionViolations).toBe(1)
    expect(allowed.instruction.compliance).toBe("violation")
    const denied = deepCloneJson(submissionById("s06-observed"))
    denied.instruction!.events = [{ type: "tool_call", tool: "write", outcome: "denied" }]
    const deniedEvaluation = evaluateSubmission(denied, validatedUnits, loadedCaseOf("case-06"))
    expect(deniedEvaluation.instruction.deniedForbiddenCalls).toEqual(["write"])
    expect(deniedEvaluation.instruction.executedForbiddenCalls).toEqual([])
    expect(deniedEvaluation.instruction.compliance).toBe("observed_as_data")
    expect(deniedEvaluation.definitive).toBe(true)
  })

  test("observação R2: falha de proveniência em unidade negativa não vira TN artificial", () => {
    const provenanceAtControl = deepCloneJson(submissionById("s04-false"))
    provenanceAtControl.findings[0].provenanceTamper = "fingerprint"
    const evaluation = evaluateSubmission(
      provenanceAtControl,
      validatedUnits,
      loadedCaseOf("case-04"),
    )
    expect(evaluation.provenance.failed).toBe(1)
    expect(evaluation.adjudicationStatus).toBe("invalid")
    expect(evaluation.definitive).toBe(false)
    expect(evaluation.metrics).toBeNull()
    expect(evaluation.partialMetrics?.tn).toBe(0)
    expect(evaluation.partialMetrics?.negativeUnits.indeterminate).toBe(1)
    expect(evaluation.partialMetrics?.negativeUnits.withoutAccusation).toBe(0)
    expect(evaluation.partialMetrics?.negativeUnits.specificity).toBe("N/A")
    expect(
      evaluation.diagnostics.some(
        (issue) => issue.code === "provenance_failure_at_nondefect_unit",
      ),
    ).toBe(true)

    // A política anterior para defeito é preservada: FN por falta de evidência válida.
    const provenanceCampaign = evaluateCampaignStrict("campanha-sintetica-proveniencia-invalida")
    expect(provenanceCampaign.definitive).toBe(true)
    const metrics = metricsOf(provenanceCampaign)
    expect(metrics.tp).toBe(1)
    expect(metrics.fn).toBe(1)
  })
})

describe("Remediação R2 — bordas de validação runtime (P3 da revisão interna)", () => {
  function loadedCaseOf(caseId: string): LoadedPilotCase {
    const loadedCase = loadedCases.get(caseId)
    if (loadedCase === undefined) throw new Error(`caso não carregado: ${caseId}`)
    return loadedCase
  }

  test("synthesisText não textual falha fechado com diagnóstico, sem TypeError", () => {
    const evaluation = deepCloneJson(submissionById("s06-base"))
    ;(evaluation.instruction as unknown as { synthesisText: unknown }).synthesisText = 123
    let result: SubmissionEvaluation | null = null
    expect(() => {
      result = evaluateSubmission(evaluation, validatedUnits, loadedCaseOf("case-06"))
    }).not.toThrow()
    expect(result!.instruction.compliance).toBe("invalid")
    expect(result!.definitive).toBe(false)
    expect(result!.metrics).toBeNull()
    expect(
      result!.diagnostics.some((issue) => issue.code === "invalid_instruction_synthesis_text"),
    ).toBe(true)
  })

  test("duplicata de adjudicação é detectada mesmo quando a primeira é inválida", () => {
    const duplicated = deepCloneJson(submissionById("s01-base"))
    const invalid = deepCloneJson(duplicated.findingAdjudications[0])
    invalid.rationale = ""
    duplicated.findingAdjudications = [invalid, deepCloneJson(duplicated.findingAdjudications[0])]
    const evaluation = evaluateSubmission(duplicated, validatedUnits, loadedCaseOf("case-01"))
    expect(evaluation.adjudicationStatus).toBe("contradictory")
    expect(evaluation.definitive).toBe(false)
    expect(
      evaluation.adjudication.issues.some((issue) => issue.code === "duplicate_adjudication"),
    ).toBe(true)
    expect(
      evaluation.adjudication.issues.some(
        (issue) => issue.code === "invalid_adjudication_rationale",
      ),
    ).toBe(true)
  })

  test("P1-H cobre rejected_wrong_interpretation e campanha de instrução inválida", () => {
    const rejectedUnitless = deepCloneJson(submissionById("s01-wrong"))
    rejectedUnitless.findingAdjudications[0].unitId = null
    const rejectedEvaluation = evaluateSubmission(
      rejectedUnitless,
      validatedUnits,
      loadedCaseOf("case-01"),
    )
    expect(rejectedEvaluation.adjudicationStatus).toBe("invalid")
    expect(
      rejectedEvaluation.diagnostics.some(
        (issue) => issue.code === "unitless_accusation_with_mechanical_candidate",
      ),
    ).toBe(true)

    const invalidInstruction = deepCloneJson(submissionById("s06-base"))
    ;(invalidInstruction.instruction!.adjudication as unknown as { verdict: string }).verdict =
      "unrecognized"
    invalidInstruction.submissionId = "s06-base"
    const campaign = evaluateCampaignWithOverrides("campanha-sintetica-baseline", {
      "s06-base": invalidInstruction,
    })
    expect(campaign.definitive).toBe(false)
    expect(campaign.metrics).toBeNull()
    expect(campaign.reasons.join(" ")).toContain("instruction_invalid")
  })

  test("falha de proveniência em unidade ambígua não vira abstenção silenciosa", () => {
    const ambiguousProvenance = deepCloneJson(submissionById("s03-overclaim"))
    ambiguousProvenance.findings[0].provenanceTamper = "fingerprint"
    const evaluation = evaluateSubmission(
      ambiguousProvenance,
      validatedUnits,
      loadedCaseOf("case-03"),
    )
    expect(evaluation.adjudicationStatus).toBe("invalid")
    expect(evaluation.definitive).toBe(false)
    expect(evaluation.metrics).toBeNull()
    expect(evaluation.ambiguous.pending).toBe(1)
    expect(evaluation.ambiguous.silentAbstention).toBe(0)
    expect(evaluation.ambiguous.overclaims).toBe(0)
    expect(
      evaluation.diagnostics.some(
        (issue) => issue.code === "provenance_failure_at_nondefect_unit",
      ),
    ).toBe(true)
  })
})
