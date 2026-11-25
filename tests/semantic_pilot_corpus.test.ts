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
        "pendingAdjudications",
        "precision",
        "recall",
        "redundantFindings",
        "specificity",
        "tn",
        "tp",
        "ungroundedAccepted",
      ].sort(),
    )
    expect(JSON.stringify(evaluation)).not.toContain("accuracy")
    expect("auditSucceeded" in evaluation).toBe(false)
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
    expect(incomplete.reasons.join(" ")).toContain("incompleta")

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

  test("categoria incompatível com a unidade é erro de adjudicação, não TP", () => {
    const evaluation = evaluateStandalone("s01-category-mismatch")
    expect(evaluation.metrics?.tp).toBe(0)
    expect(evaluation.metrics?.fn).toBe(1)
    expect(evaluation.findings[0].countedAs).toBe("adjudication_error")
    expect(evaluation.reasons.join(" ")).toContain("categoria")
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
    expect(evaluation.reasons.join(" ")).toContain("incompleta")
    const incompleteSubmission = evaluation.submissions.find(
      (submission) => submission.submissionId === "s01-incomplete",
    )!
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
