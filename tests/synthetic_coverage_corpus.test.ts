import { describe, test, expect } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import {
  loadCanonicalLatexManuscript,
  type CanonicalLatexManuscriptResult,
} from "../src/lib/latex_loader"
import {
  planAnalysisCoverage,
  planExhaustiveAnalysisBatches,
  type ExhaustiveAnalysisPlan,
} from "../src/lib/analysis_coverage"
import {
  createAnalysisCheckpoint,
  nextAnalysisBatch,
  completeAnalysisBatch,
  computePlanIdentity,
  AnalysisCheckpointError,
  type AnalysisCheckpoint,
} from "../src/lib/analysis_checkpoint"
import {
  validateAnalysisFindingsForPlan,
  createAnalysisFinding,
  AnalysisFindingError,
  type AnalysisFinding,
  type AnalysisFindingInput,
} from "../src/lib/analysis_findings"
import {
  createGlobalAnalysisSynthesisInput,
  AnalysisSynthesisError,
} from "../src/lib/analysis_synthesis"
import type { ProjectConfig } from "../src/lib/config"

interface CaseManifest {
  id: string
  name: string
  category: "correct" | "boundary" | "defective" | "ambiguous"
  path: string
  description: string
  config: {
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
  expected: {
    loader: {
      complete: boolean
      hasFingerprint: boolean
      diagnosticsCount?: number
      expectedDiagnosticCode?: string
    }
    coverage: {
      status: "complete" | "partial" | "blocked"
      strategy: string
      coveragePercent?: number
      minBatches?: number
      batchCount?: number
      omissionReason?: string
    }
    checkpoint: {
      resumesCleanly: boolean
      finalState?: string
      expectedErrorCode?: string
    }
    synthesis: {
      allowed: boolean
      expectedErrorCode?: string
      inapplicableReason?: string
    }
    classification: {
      scorable: boolean
      groundTruth: "positive_for_defect" | "negative_for_defect" | "unscoreable"
      isAmbiguous: boolean
    }
  }
}

interface CorpusManifest {
  version: string
  description: string
  metadata: {
    totalCases: number
    categories: Record<string, number>
    deterministicRulesEvaluated: string[]
  }
  cases: CaseManifest[]
}

const CORPUS_ROOT = path.resolve(
  __dirname,
  "fixtures/academic-coverage/v1",
)
const MANIFEST_PATH = path.join(CORPUS_ROOT, "manifest.json")

function validateCorpusManifestSchema(manifest: unknown): asserts manifest is CorpusManifest {
  if (typeof manifest !== "object" || manifest === null) {
    throw new TypeError("Manifest must be a non-null object")
  }
  const m = manifest as Record<string, unknown>
  if (m.version !== "academic-coverage-corpus-v1") {
    throw new Error(`Invalid manifest version: ${String(m.version)}`)
  }
  if (typeof m.description !== "string" || m.description.length === 0) {
    throw new Error("Manifest description must be a non-empty string")
  }
  if (typeof m.metadata !== "object" || m.metadata === null) {
    throw new Error("Manifest metadata must be a non-null object")
  }
  const meta = m.metadata as Record<string, unknown>
  if (typeof meta.totalCases !== "number" || meta.totalCases <= 0) {
    throw new Error("metadata.totalCases must be a positive integer")
  }
  if (typeof meta.categories !== "object" || meta.categories === null) {
    throw new Error("metadata.categories must be a non-null object")
  }
  const cats = meta.categories as Record<string, unknown>
  const requiredCategories = ["correct", "boundary", "defective", "ambiguous"]
  let categorySum = 0
  for (const cat of requiredCategories) {
    if (typeof cats[cat] !== "number" || cats[cat] < 0) {
      throw new Error(`metadata.categories.${cat} must be a non-negative integer`)
    }
    categorySum += cats[cat] as number
  }
  if (categorySum !== meta.totalCases) {
    throw new Error(
      `Sum of categories (${categorySum}) does not match totalCases (${meta.totalCases})`,
    )
  }
  if (!Array.isArray(meta.deterministicRulesEvaluated) || meta.deterministicRulesEvaluated.length === 0) {
    throw new Error("metadata.deterministicRulesEvaluated must be a non-empty array")
  }
  if (!Array.isArray(m.cases) || m.cases.length !== meta.totalCases) {
    throw new Error(`cases array length (${Array.isArray(m.cases) ? m.cases.length : 0}) must match totalCases (${meta.totalCases})`)
  }

  for (let i = 0; i < m.cases.length; i++) {
    const c = m.cases[i] as Record<string, unknown>
    if (typeof c.id !== "string" || c.id.length === 0) {
      throw new Error(`cases[${i}].id must be a non-empty string`)
    }
    if (!requiredCategories.includes(c.category as string)) {
      throw new Error(`cases[${i}].category must be one of ${requiredCategories.join(", ")}`)
    }
    if (typeof c.path !== "string" || c.path.length === 0) {
      throw new Error(`cases[${i}].path must be a non-empty string`)
    }
    const exp = c.expected as Record<string, unknown>
    if (typeof exp !== "object" || exp === null) {
      throw new Error(`cases[${i}].expected must be a non-null object`)
    }
    const cls = exp.classification as Record<string, unknown>
    if (typeof cls !== "object" || cls === null) {
      throw new Error(`cases[${i}].expected.classification must be a non-null object`)
    }
    if (typeof cls.scorable !== "boolean") {
      throw new Error(`cases[${i}].expected.classification.scorable must be a boolean`)
    }
    if (!["positive_for_defect", "negative_for_defect", "unscoreable"].includes(cls.groundTruth as string)) {
      throw new Error(`cases[${i}].expected.classification.groundTruth must be positive_for_defect, negative_for_defect or unscoreable`)
    }
    if (typeof cls.isAmbiguous !== "boolean") {
      throw new Error(`cases[${i}].expected.classification.isAmbiguous must be a boolean`)
    }
  }
}

function loadManifest(): CorpusManifest {
  expect(existsSync(MANIFEST_PATH)).toBe(true)
  const raw = readFileSync(MANIFEST_PATH, "utf8")
  const parsed = JSON.parse(raw) as unknown
  validateCorpusManifestSchema(parsed)
  return parsed
}

function buildProjectConfig(caseDef: CaseManifest): ProjectConfig {
  return {
    version: 1,
    manuscript: {
      format: caseDef.config.manuscript.format,
      root: caseDef.config.manuscript.root,
      main: caseDef.config.manuscript.main,
      bib: caseDef.config.manuscript.bib,
      chapters: caseDef.config.manuscript.chapters,
      outputDir: caseDef.config.manuscript.outputDir,
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex"],
    protectedPaths: [],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9.0,
    providers: {
      references: {
        primary: "cache",
        fallbacks: [],
        timeoutMs: 1000,
      },
    },
    mcp: { crossrefAcademicEnabled: false },
    analysis: {
      coverageMode: caseDef.config.analysis.coverageMode,
      maxCharactersPerBatch: caseDef.config.analysis.maxCharactersPerBatch,
    },
  }
}

interface CaseEvaluationOutcome {
  caseId: string
  isAmbiguous: boolean
  scorable: boolean
  groundTruth: "positive_for_defect" | "negative_for_defect" | "unscoreable"
  detectedDefect: boolean
  detectionStage: "loader" | "checkpoint" | "finding" | "none"
  classification?: "TP" | "TN" | "FP" | "FN" | "UNSCOREABLE"
  evidence: unknown
}

interface EvaluationMetrics {
  tp: number
  tn: number
  fp: number
  fn: number
  ambiguousCount: number
  scorableCount: number
  precision: number
  recall: number
  accuracy: number
}

interface EvaluationOptions {
  checkpointValidatorOverride?: (plan: ExhaustiveAnalysisPlan, cp: AnalysisCheckpoint) => void
  findingValidatorOverride?: (plan: ExhaustiveAnalysisPlan, input: AnalysisFindingInput) => void
}

/**
 * Execute real deterministic domain validators against a case without using caseDef.id
 * as an oracle for defect detection.
 */
function evaluateCorpusCase(
  caseDef: CaseManifest,
  corpusRoot: string,
  options?: EvaluationOptions,
): CaseEvaluationOutcome {
  const caseDir = path.join(corpusRoot, caseDef.path)
  const config = buildProjectConfig(caseDef)

  // Ambiguous cases are handled separately
  if (caseDef.expected.classification.isAmbiguous || !caseDef.expected.classification.scorable) {
    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    return {
      caseId: caseDef.id,
      isAmbiguous: true,
      scorable: false,
      groundTruth: "unscoreable",
      detectedDefect: false,
      detectionStage: "none",
      classification: "UNSCOREABLE",
      evidence: { loadedComplete: loaded.complete },
    }
  }

  // 1. Stage: Loader validation
  const loaded = loadCanonicalLatexManuscript(caseDir, config)
  if (!loaded.complete || loaded.fingerprint === null) {
    const diagCode = loaded.diagnostics[0]?.code ?? "unknown_loader_error"
    return {
      caseId: caseDef.id,
      isAmbiguous: false,
      scorable: true,
      groundTruth: caseDef.expected.classification.groundTruth,
      detectedDefect: true,
      detectionStage: "loader",
      evidence: { diagnostics: loaded.diagnostics, diagCode },
    }
  }

  // 2. Stage: Checkpoint validation with scenario file if present in fixture
  const checkpointScenarioPath = path.join(caseDir, "checkpoint_scenario.json")
  if (existsSync(checkpointScenarioPath)) {
    const scenarioRaw = readFileSync(checkpointScenarioPath, "utf8")
    const scenario = JSON.parse(scenarioRaw) as {
      scenario: string
      tamper: Partial<AnalysisCheckpoint>
      expectedErrorCode: string
    }
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    const validCp = createAnalysisCheckpoint(plan)
    const tamperedCp = { ...validCp, ...scenario.tamper }

    let defectCaught = false
    let caughtError: unknown
    try {
      const validator = options?.checkpointValidatorOverride ?? ((p, cp) => {
        nextAnalysisBatch(p, cp)
      })
      validator(plan, tamperedCp)
    } catch (err) {
      if (err instanceof AnalysisCheckpointError) {
        defectCaught = true
        caughtError = err
      } else {
        throw err
      }
    }

    return {
      caseId: caseDef.id,
      isAmbiguous: false,
      scorable: true,
      groundTruth: caseDef.expected.classification.groundTruth,
      detectedDefect: defectCaught,
      detectionStage: "checkpoint",
      evidence: { caughtError, defectCaught },
    }
  }

  // 3. Stage: Finding provenance validation with scenario file if present in fixture
  const findingScenarioPath = path.join(caseDir, "finding_scenario.json")
  if (existsSync(findingScenarioPath)) {
    const scenarioRaw = readFileSync(findingScenarioPath, "utf8")
    const scenario = JSON.parse(scenarioRaw) as {
      scenario: string
      targetBatchIndex: number
      provenanceBatchIndex: number
      category: string
      severity: string
      claim: string
      evidence: string
      sectionId: string
      expectedErrorCode: string
    }
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    const targetBatch = plan.batches[scenario.targetBatchIndex]
    const provenanceBatch = plan.batches[scenario.provenanceBatchIndex]
    const invalidFindingInput: AnalysisFindingInput = {
      category: scenario.category,
      severity: scenario.severity,
      claim: scenario.claim,
      evidence: scenario.evidence,
      file: provenanceBatch.chunks[0].source.file,
      startLine: provenanceBatch.chunks[0].source.startLine,
      endLine: provenanceBatch.chunks[0].source.endLine,
      sectionId: scenario.sectionId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: targetBatch.batchId,
    }

    let defectCaught = false
    let caughtError: unknown
    try {
      const validator = options?.findingValidatorOverride ?? ((p, input) => {
        createAnalysisFinding(p, input)
      })
      validator(plan, invalidFindingInput)
    } catch (err) {
      if (err instanceof AnalysisFindingError) {
        defectCaught = true
        caughtError = err
      } else {
        throw err
      }
    }

    return {
      caseId: caseDef.id,
      isAmbiguous: false,
      scorable: true,
      groundTruth: caseDef.expected.classification.groundTruth,
      detectedDefect: defectCaught,
      detectionStage: "finding",
      evidence: { caughtError, defectCaught },
    }
  }

  // 4. Conforming cases: verify planning and progress without unexpected defect
  let defectUnexpected = false
  let unexpectedError: unknown
  try {
    if (caseDef.config.analysis.coverageMode === "exhaustive") {
      const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
      let cp = createAnalysisCheckpoint(plan)
      for (const batch of plan.batches) {
        const next = nextAnalysisBatch(plan, cp)
        if (!next || next.batchId !== batch.batchId) {
          defectUnexpected = true
          break
        }
        cp = completeAnalysisBatch(plan, cp, batch.batchId)
      }
      if (cp.state !== "complete" || cp.coveragePercent !== 100) {
        defectUnexpected = true
      }
    } else {
      const plan = planAnalysisCoverage(loaded, config.analysis!.maxCharactersPerBatch)
      if (plan.coverage.status === "blocked") {
        defectUnexpected = true
      }
    }
  } catch (err) {
    defectUnexpected = true
    unexpectedError = err
  }

  return {
    caseId: caseDef.id,
    isAmbiguous: false,
    scorable: true,
    groundTruth: caseDef.expected.classification.groundTruth,
    detectedDefect: defectUnexpected,
    detectionStage: "none",
    evidence: { defectUnexpected, unexpectedError },
  }
}

function runCorpusEvaluation(
  manifest: CorpusManifest,
  corpusRoot: string,
  options?: EvaluationOptions,
): { outcomes: CaseEvaluationOutcome[]; metrics: EvaluationMetrics } {
  const outcomes: CaseEvaluationOutcome[] = []
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  let ambiguousCount = 0

  for (const caseDef of manifest.cases) {
    const outcome = evaluateCorpusCase(caseDef, corpusRoot, options)

    if (outcome.isAmbiguous || !outcome.scorable) {
      ambiguousCount++
      outcome.classification = "UNSCOREABLE"
    } else {
      const expectedDefect = outcome.groundTruth === "positive_for_defect"
      if (expectedDefect && outcome.detectedDefect) {
        tp++
        outcome.classification = "TP"
      } else if (!expectedDefect && outcome.detectedDefect) {
        fp++
        outcome.classification = "FP"
      } else if (!expectedDefect && !outcome.detectedDefect) {
        tn++
        outcome.classification = "TN"
      } else if (expectedDefect && !outcome.detectedDefect) {
        fn++
        outcome.classification = "FN"
      }
    }
    outcomes.push(outcome)
  }

  const scorableCount = tp + tn + fp + fn
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0
  const accuracy = scorableCount > 0 ? (tp + tn) / scorableCount : 0

  return {
    outcomes,
    metrics: {
      tp,
      tn,
      fp,
      fn,
      ambiguousCount,
      scorableCount,
      precision,
      recall,
      accuracy,
    },
  }
}

describe("Corpus Acadêmico Sintético de Cobertura v1", () => {
  const manifest = loadManifest()

  test("Validação estrutural do schema de manifest.json (validação de schema efetiva)", () => {
    expect(() => validateCorpusManifestSchema(manifest)).not.toThrow()

    // Teste negativo: manifest inválido é rejeitado
    expect(() => {
      validateCorpusManifestSchema({ version: "invalid-version" })
    }).toThrow("Invalid manifest version: invalid-version")

    expect(() => {
      validateCorpusManifestSchema({
        version: "academic-coverage-corpus-v1",
        description: "teste",
        metadata: { totalCases: 2, categories: { correct: 1, boundary: 0, defective: 0, ambiguous: 0 } },
        cases: [],
      })
    }).toThrow("Sum of categories (1) does not match totalCases (2)")
  })

  test("Caso 01 (correto): reconstrução integral de texto, ordem estrita e proveniência de lotes", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_01_canonical_valid")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)
    expect(typeof loaded.fingerprint).toBe("string")
    expect(loaded.fingerprint!.length).toBeGreaterThan(0)
    expect(loaded.diagnostics.length).toBe(0)

    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBeGreaterThanOrEqual(caseDef.expected.coverage.minBatches!)
    expect(plan.coverage.coveragePercent).toBe(100)

    // 1. Reconstrução integral de texto caractere a caractere
    const originalTextConcat = loaded.orderedSources.map((s) => s.text).join("")
    const allChunks = plan.batches.flatMap((b) => b.chunks)
    const reconstructedChunkText = allChunks.map((c) => c.text).join("")
    expect(reconstructedChunkText).toBe(originalTextConcat)
    expect(reconstructedChunkText.length).toBe(plan.coverage.totalCharacters)

    // 2. Ordem estrita de chunks e proveniência de offsets por span
    let expectedGlobalIndex = 0
    let currentSpanIndex = -1
    let expectedNextOffset = 0

    for (const chunk of allChunks) {
      expect(chunk.index).toBe(expectedGlobalIndex)
      expectedGlobalIndex++

      const sourceSpan = loaded.orderedSources[chunk.source.sourceSpanIndex]
      expect(sourceSpan).toBeDefined()
      expect(chunk.source.file).toBe(sourceSpan.file)

      // Se mudou de span, o offset reseta para 0
      if (chunk.source.sourceSpanIndex !== currentSpanIndex) {
        currentSpanIndex = chunk.source.sourceSpanIndex
        expectedNextOffset = 0
      }

      expect(chunk.source.startOffset).toBe(expectedNextOffset)
      expect(chunk.source.endOffset).toBe(expectedNextOffset + chunk.text.length)
      expect(chunk.text).toBe(
        sourceSpan.text.slice(chunk.source.startOffset, chunk.source.endOffset),
      )
      expectedNextOffset = chunk.source.endOffset

      expect(chunk.source.startLine).toBeGreaterThanOrEqual(sourceSpan.startLine)
      expect(chunk.source.endLine).toBeLessThanOrEqual(sourceSpan.endLine)
    }

    // 3. Checkpoint e síntese
    let cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("pending")
    for (const batch of plan.batches) {
      const next = nextAnalysisBatch(plan, cp)
      expect(next?.batchId).toBe(batch.batchId)
      cp = completeAnalysisBatch(plan, cp, batch.batchId)
    }
    expect(cp.state).toBe("complete")

    const synthesisInput = createGlobalAnalysisSynthesisInput(plan, cp, [])
    expect(synthesisInput.planId).toBe(cp.planId)
    expect(synthesisInput.manuscriptFingerprint).toBe(plan.fingerprint!)
    expect(synthesisInput.coverage.state).toBe("complete")
  })

  test("Caso 02 (fronteira): span extenso particionado com reconstrução integral exata sem truncamento", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_02_oversized_span")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    const maxBudget = config.analysis!.maxCharactersPerBatch
    const plan = planExhaustiveAnalysisBatches(loaded, maxBudget)
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBeGreaterThanOrEqual(caseDef.expected.coverage.minBatches!)

    const singleOriginalSpan = loaded.orderedSources[0]
    expect(singleOriginalSpan.text.length).toBeGreaterThan(maxBudget)

    // Reconstrução integral sem omissão nem duplicação
    const allChunks = plan.batches.flatMap((b) => b.chunks)
    const reconstructed = allChunks.map((c) => c.text).join("")
    expect(reconstructed).toBe(singleOriginalSpan.text)

    // Continuidade de offsets
    let runningOffset = 0
    for (const chunk of allChunks) {
      expect(chunk.source.startOffset).toBe(runningOffset)
      expect(chunk.source.endOffset).toBe(runningOffset + chunk.text.length)
      runningOffset = chunk.source.endOffset
    }
    expect(runningOffset).toBe(singleOriginalSpan.text.length)
  })

  test("Caso 03 (fronteira): integridade de substituição de caracteres UTF-16", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_03_utf16_surrogates")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("complete")

    for (const batch of plan.batches) {
      for (const chunk of batch.chunks) {
        for (let i = 0; i < chunk.text.length; i++) {
          const code = chunk.text.charCodeAt(i)
          if (code >= 0xd800 && code <= 0xdbff) {
            expect(i + 1).toBeLessThan(chunk.text.length)
            const nextCode = chunk.text.charCodeAt(i + 1)
            expect(nextCode >= 0xdc00 && nextCode <= 0xdfff).toBe(true)
            i++
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            throw new Error(`Low surrogate órfão no offset ${i} do chunk ${chunk.index}`)
          }
        }
      }
    }
  })

  test("Caso 04 (defeito): include inexistente bloqueia deterministamente", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_04_missing_include_blocked")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(false)
    expect(loaded.fingerprint).toBeNull()
    expect(loaded.diagnostics.some((d) => d.code === "include_not_found")).toBe(true)

    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("blocked")
    const cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("blocked")

    expect(() => {
      createGlobalAnalysisSynthesisInput(plan, cp, [])
    }).toThrow(AnalysisSynthesisError)
  })

  test("Caso 05 (defeito): ciclo de inclusão bloqueia com diagnóstico", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_05_include_cycle_defect")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(false)
    expect(loaded.fingerprint).toBeNull()
    expect(loaded.diagnostics.some((d) => d.code === "include_cycle")).toBe(true)

    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("blocked")
    const cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("blocked")

    expect(() => {
      createGlobalAnalysisSynthesisInput(plan, cp, [])
    }).toThrow(AnalysisSynthesisError)
  })

  test("Caso 06 (fronteira): prefixo parcial e reconciliação honesta do contrato de síntese", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_06_budget_exceeded_partial")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    // 1. Validação do planejador por prefixo
    const budget = 120
    const prefixPlan = planAnalysisCoverage(loaded, budget)
    expect(prefixPlan.coverage.status).toBe("partial")
    expect(prefixPlan.coverage.omittedSpans.length).toBeGreaterThan(0)
    expect(prefixPlan.coverage.omittedSpans[0].reason).toBe("budget_exceeded")

    // 2. Validação honesta do gate de síntese com cobertura incompleta (lotes pendentes)
    const exhaustivePlan = planExhaustiveAnalysisBatches(loaded, 100)
    expect(exhaustivePlan.batches.length).toBeGreaterThanOrEqual(2)
    const incompleteCp = createAnalysisCheckpoint(exhaustivePlan) // state: "pending"

    // Comprovando que a síntese é rejeitada com incomplete_coverage
    expect(() => {
      createGlobalAnalysisSynthesisInput(exhaustivePlan, incompleteCp, [])
    }).toThrow(AnalysisSynthesisError)

    try {
      createGlobalAnalysisSynthesisInput(exhaustivePlan, incompleteCp, [])
    } catch (err) {
      expect(err instanceof AnalysisSynthesisError).toBe(true)
      expect((err as AnalysisSynthesisError).code).toBe("incomplete_coverage")
    }
  })

  test("Caso 07 (defeito): validador de checkpoint rejeita adulteração observada", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_07_tampered_checkpoint")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    const validCp = createAnalysisCheckpoint(plan)

    // Carrega o cenário de adulteração da fixture
    const scenarioRaw = readFileSync(path.join(caseDir, "checkpoint_scenario.json"), "utf8")
    const scenario = JSON.parse(scenarioRaw) as { tamper: Partial<AnalysisCheckpoint>; expectedErrorCode: string }
    const tamperedCp: AnalysisCheckpoint = { ...validCp, ...scenario.tamper }

    // Executa o validador real e comprova a falha controlada
    expect(() => {
      nextAnalysisBatch(plan, tamperedCp)
    }).toThrow(AnalysisCheckpointError)

    try {
      nextAnalysisBatch(plan, tamperedCp)
    } catch (err) {
      expect(err instanceof AnalysisCheckpointError).toBe(true)
      expect((err as AnalysisCheckpointError).code).toBe(scenario.expectedErrorCode)
    }
  })

  test("Caso 08 (defeito): validador de finding rejeita desvio de proveniência observado", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_08_finding_provenance_tamper")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)

    // Carrega o cenário de finding da fixture
    const scenarioRaw = readFileSync(path.join(caseDir, "finding_scenario.json"), "utf8")
    const scenario = JSON.parse(scenarioRaw) as {
      targetBatchIndex: number
      provenanceBatchIndex: number
      category: string
      severity: string
      claim: string
      evidence: string
      sectionId: string
      expectedErrorCode: string
    }

    const targetBatch = plan.batches[scenario.targetBatchIndex]
    const provenanceBatch = plan.batches[scenario.provenanceBatchIndex]

    const invalidFindingInput: AnalysisFindingInput = {
      category: scenario.category,
      severity: scenario.severity,
      claim: scenario.claim,
      evidence: scenario.evidence,
      file: provenanceBatch.chunks[0].source.file,
      startLine: provenanceBatch.chunks[0].source.startLine,
      endLine: provenanceBatch.chunks[0].source.endLine,
      sectionId: scenario.sectionId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: targetBatch.batchId,
    }

    expect(() => {
      createAnalysisFinding(plan, invalidFindingInput)
    }).toThrow(AnalysisFindingError)

    try {
      createAnalysisFinding(plan, invalidFindingInput)
    } catch (err) {
      expect(err instanceof AnalysisFindingError).toBe(true)
      expect((err as AnalysisFindingError).code).toBe(scenario.expectedErrorCode)
    }
  })

  test("Caso 09 (fronteira): retomada determinística serializada multi-turn sem perdas nem duplicações", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_09_serialized_resume_clean")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)

    let serializedCp = JSON.stringify(createAnalysisCheckpoint(plan))

    for (let i = 0; i < plan.batches.length; i++) {
      const cp: AnalysisCheckpoint = JSON.parse(serializedCp)
      const next = nextAnalysisBatch(plan, cp)
      expect(next).not.toBeNull()
      expect(next!.batchId).toBe(plan.batches[i].batchId)

      if (i > 0) {
        const idempotentCp = completeAnalysisBatch(plan, cp, plan.batches[i - 1].batchId)
        expect(idempotentCp.completedBatches).toBe(cp.completedBatches)
        expect(idempotentCp.completedCharacters).toBe(cp.completedCharacters)
      }

      const updatedCp = completeAnalysisBatch(plan, cp, next!.batchId)
      serializedCp = JSON.stringify(updatedCp)
    }

    const finalCp: AnalysisCheckpoint = JSON.parse(serializedCp)
    expect(finalCp.state).toBe("complete")
    expect(finalCp.completedBatches).toBe(plan.batches.length)
    expect(finalCp.coveragePercent).toBe(100)

    const synthesis = createGlobalAnalysisSynthesisInput(plan, finalCp, [])
    expect(synthesis.coverage.orderedBatchIds).toEqual(plan.batches.map((b) => b.batchId))
  })

  test("Caso 10 (ambíguo): tratado isoladamente como não-pontuável sem inflar métricas", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_10_ambiguous_unclassified")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    expect(caseDef.expected.classification.isAmbiguous).toBe(true)
    expect(caseDef.expected.classification.scorable).toBe(false)
    expect(caseDef.expected.classification.groundTruth).toBe("unscoreable")
  })

  // TESTES DE SENSIBILIDADE DA MATRIZ (RED DE MUTAÇÃO CONTROLADA)
  test("RED SENSIBILIDADE: falha de detecção no detector de checkpoint (caso 07) produz FN e reduz revocação", () => {
    // Injeta validador mutado que silencia erros e aceita checkpoint adulterado
    const mutatedRun = runCorpusEvaluation(manifest, CORPUS_ROOT, {
      checkpointValidatorOverride: (_plan, _cp) => {
        // MUTAÇÃO: não lança erro
      },
    })

    const case07Outcome = mutatedRun.outcomes.find((o) => o.caseId === "case_07_tampered_checkpoint")
    expect(case07Outcome).toBeDefined()
    expect(case07Outcome!.detectedDefect).toBe(false)
    expect(case07Outcome!.classification).toBe("FN") // Converteu para Falso Negativo!

    // A matriz acusa a falha do detector
    expect(mutatedRun.metrics.fn).toBe(1)
    expect(mutatedRun.metrics.tp).toBe(3) // 3 em vez de 4
    expect(mutatedRun.metrics.recall).toBe(0.75) // 75%, NUNCA falso 100%
    expect(mutatedRun.metrics.accuracy).toBeCloseTo(8 / 9, 4)
  })

  test("RED SENSIBILIDADE: falha de detecção no detector de proveniência de finding (caso 08) produz FN e reduz revocação", () => {
    // Injeta validador mutado que silencia erros de proveniência
    const mutatedRun = runCorpusEvaluation(manifest, CORPUS_ROOT, {
      findingValidatorOverride: (_plan, _input) => {
        // MUTAÇÃO: não lança erro
      },
    })

    const case08Outcome = mutatedRun.outcomes.find((o) => o.caseId === "case_08_finding_provenance_tamper")
    expect(case08Outcome).toBeDefined()
    expect(case08Outcome!.detectedDefect).toBe(false)
    expect(case08Outcome!.classification).toBe("FN") // Converteu para Falso Negativo!

    // A matriz acusa a falha do detector
    expect(mutatedRun.metrics.fn).toBe(1)
    expect(mutatedRun.metrics.tp).toBe(3)
    expect(mutatedRun.metrics.recall).toBe(0.75)
  })

  // GREEN EXECUÇÃO REAL COM VALIDADORES GENUÍNOS
  test("GREEN: matriz de confusão calculada estritamente sobre execução de validadores observados", () => {
    const run = runCorpusEvaluation(manifest, CORPUS_ROOT)

    expect(run.metrics.scorableCount).toBe(9)
    expect(run.metrics.ambiguousCount).toBe(1)

    // Resultados observados caso a caso
    expect(run.metrics.tp).toBe(4) // casos 04, 05, 07, 08 detectados efetivamente pelos validadores
    expect(run.metrics.tn).toBe(5) // casos 01, 02, 03, 06, 09 conformes sem falso alarme
    expect(run.metrics.fp).toBe(0)
    expect(run.metrics.fn).toBe(0)

    expect(run.metrics.precision).toBe(1.0)
    expect(run.metrics.recall).toBe(1.0)
    expect(run.metrics.accuracy).toBe(1.0)

    // Validação individual dos resultados gravados
    const c04 = run.outcomes.find((o) => o.caseId === "case_04_missing_include_blocked")!
    expect(c04.classification).toBe("TP")
    expect(c04.detectionStage).toBe("loader")

    const c05 = run.outcomes.find((o) => o.caseId === "case_05_include_cycle_defect")!
    expect(c05.classification).toBe("TP")
    expect(c05.detectionStage).toBe("loader")

    const c07 = run.outcomes.find((o) => o.caseId === "case_07_tampered_checkpoint")!
    expect(c07.classification).toBe("TP")
    expect(c07.detectionStage).toBe("checkpoint")

    const c08 = run.outcomes.find((o) => o.caseId === "case_08_finding_provenance_tamper")!
    expect(c08.classification).toBe("TP")
    expect(c08.detectionStage).toBe("finding")

    const c10 = run.outcomes.find((o) => o.caseId === "case_10_ambiguous_unclassified")!
    expect(c10.classification).toBe("UNSCOREABLE")
    expect(c10.isAmbiguous).toBe(true)
  })
})
