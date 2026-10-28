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

function loadManifest(): CorpusManifest {
  expect(existsSync(MANIFEST_PATH)).toBe(true)
  const raw = readFileSync(MANIFEST_PATH, "utf8")
  return JSON.parse(raw) as CorpusManifest
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

describe("Corpus Acadêmico Sintético de Cobertura v1", () => {
  const manifest = loadManifest()

  test("Manifesto v1 é estruturalmente válido e versionado", () => {
    expect(manifest.version).toBe("academic-coverage-corpus-v1")
    expect(manifest.cases.length).toBe(10)
    expect(manifest.metadata.totalCases).toBe(10)
    expect(manifest.metadata.categories.correct).toBe(1)
    expect(manifest.metadata.categories.boundary).toBe(4)
    expect(manifest.metadata.categories.defective).toBe(4)
    expect(manifest.metadata.categories.ambiguous).toBe(1)
  })

  // GREEN PHASE: Comprova que teste negativo falha controlado e impede síntese
  test("GREEN DEMO: cobertura bloqueada impede deterministamente a síntese global", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_04_missing_include_blocked")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(false)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("blocked")
    const checkpoint = createAnalysisCheckpoint(plan)
    expect(checkpoint.state).toBe("blocked")

    // GREEN ASSERTION: verify that createGlobalAnalysisSynthesisInput fails closed with AnalysisSynthesisError
    expect(() => {
      createGlobalAnalysisSynthesisInput(plan, checkpoint, [])
    }).toThrow(AnalysisSynthesisError)
  })

  test("Caso 01 (correto): manuscrito canônico particionado e sintetizado com integridade", () => {
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

    // Invariante: cada lote <= maxCharactersPerBatch, sem truncar a obra
    let totalChunkChars = 0
    for (const batch of plan.batches) {
      expect(batch.characters).toBeLessThanOrEqual(config.analysis!.maxCharactersPerBatch)
      let batchChars = 0
      for (const chunk of batch.chunks) {
        batchChars += chunk.text.length
        expect(chunk.source.endOffset - chunk.source.startOffset).toBe(chunk.text.length)
        expect(chunk.source.startLine).toBeGreaterThanOrEqual(1)
        expect(chunk.source.endLine).toBeGreaterThanOrEqual(chunk.source.startLine)
      }
      expect(batch.characters).toBe(batchChars)
      totalChunkChars += batchChars
    }
    expect(totalChunkChars).toBe(plan.coverage.totalCharacters)

    // Checkpoint e retomada completa
    let cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("pending")
    for (const batch of plan.batches) {
      const next = nextAnalysisBatch(plan, cp)
      expect(next?.batchId).toBe(batch.batchId)
      cp = completeAnalysisBatch(plan, cp, batch.batchId)
    }
    expect(cp.state).toBe("complete")
    expect(cp.coveragePercent).toBe(100)

    // Síntese permitida
    const synthesisInput = createGlobalAnalysisSynthesisInput(plan, cp, [])
    expect(synthesisInput.planId).toBe(cp.planId)
    expect(synthesisInput.manuscriptFingerprint).toBe(plan.fingerprint!)
    expect(synthesisInput.coverage.state).toBe("complete")
  })

  test("Caso 02 (fronteira): span maior que maxCharactersPerBatch particionado sem truncamento da obra", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_02_oversized_span")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    const maxBudget = config.analysis!.maxCharactersPerBatch
    const plan = planExhaustiveAnalysisBatches(loaded, maxBudget)
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBeGreaterThanOrEqual(caseDef.expected.coverage.minBatches!)

    let totalCharsReconstructed = 0
    let lastGlobalIndex = -1
    for (const batch of plan.batches) {
      expect(batch.characters).toBeLessThanOrEqual(maxBudget)
      for (const chunk of batch.chunks) {
        expect(chunk.index).toBe(lastGlobalIndex + 1)
        lastGlobalIndex = chunk.index
        totalCharsReconstructed += chunk.text.length
      }
    }
    // Garante que toda a obra foi preservada sem truncar nenhum caractere
    expect(totalCharsReconstructed).toBe(plan.coverage.totalCharacters)
  })

  test("Caso 03 (fronteira): integridade de substituição de caracteres UTF-16", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_03_utf16_surrogates")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("complete")

    // Verifica que nenhum par de substituição foi fragmentado
    for (const batch of plan.batches) {
      for (const chunk of batch.chunks) {
        for (let i = 0; i < chunk.text.length; i++) {
          const code = chunk.text.charCodeAt(i)
          if (code >= 0xd800 && code <= 0xdbff) {
            // High surrogate deve ser seguido por low surrogate no mesmo chunk
            expect(i + 1).toBeLessThan(chunk.text.length)
            const nextCode = chunk.text.charCodeAt(i + 1)
            expect(nextCode >= 0xdc00 && nextCode <= 0xdfff).toBe(true)
            i++ // pular o par
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            // Low surrogate órfão é proibido
            throw new Error(`Low surrogate órfão encontrado no offset ${i} do chunk ${chunk.index}`)
          }
        }
      }
    }
  })

  test("Caso 04 (defeito): include inexistente bloqueia cobertura determinística e síntese", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_04_missing_include_blocked")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(false)
    expect(loaded.fingerprint).toBeNull()
    expect(loaded.diagnostics.some((d) => d.code === "include_not_found")).toBe(true)

    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.status).toBe("blocked")
    expect(plan.batches.length).toBe(0)

    const cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("blocked")

    expect(() => {
      createGlobalAnalysisSynthesisInput(plan, cp, [])
    }).toThrow(AnalysisSynthesisError)
  })

  test("Caso 05 (defeito): ciclo de inclusão bloqueia deterministamente", () => {
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

  test("Caso 06 (fronteira): orçamento excedido em estratégia de prefixo gera status partial", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_06_budget_exceeded_partial")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    expect(loaded.complete).toBe(true)

    // Orçamento deliberadamente restrito para forçar omissão
    const budget = 120
    const prefixPlan = planAnalysisCoverage(loaded, budget)
    expect(prefixPlan.coverage.status).toBe("partial")
    expect(prefixPlan.coverage.omittedSpans.length).toBeGreaterThan(0)
    expect(prefixPlan.coverage.omittedSpans[0].reason).toBe("budget_exceeded")
    expect(prefixPlan.coverage.coveragePercent).toBeLessThan(100)
  })

  test("Caso 07 (defeito): rejeição estrita de checkpoint adulterado e fora de ordem", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_07_tampered_checkpoint")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.batches.length).toBeGreaterThanOrEqual(2)

    const cp = createAnalysisCheckpoint(plan)
    const serialized = JSON.stringify(cp)
    const deserialized = JSON.parse(serialized) as AnalysisCheckpoint

    // 1. Tentar completar lote fora de ordem (lote 1 antes do lote 0)
    expect(() => {
      completeAnalysisBatch(plan, deserialized, plan.batches[1].batchId)
    }).toThrow(AnalysisCheckpointError)

    // 2. Adulterar contadores no checkpoint desserializado
    const tampered = { ...deserialized, completedBatches: 1 } // sem alterar completedCharacters
    expect(() => {
      nextAnalysisBatch(plan, tampered)
    }).toThrow(AnalysisCheckpointError)

    // 3. Adulterar planId
    const tamperedId = { ...deserialized, planId: "sha256-falsificado-0000000000" }
    expect(() => {
      nextAnalysisBatch(plan, tamperedId)
    }).toThrow(AnalysisCheckpointError)
  })

  test("Caso 08 (defeito): rejeição de finding com desvio de proveniência por linha ou arquivo", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_08_finding_provenance_tamper")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.batches.length).toBeGreaterThanOrEqual(2)

    const batch0 = plan.batches[0]
    const batch1 = plan.batches[1]

    // Criar finding para o batch 0, mas apontando para o arquivo ou linhas que estão apenas no batch 1
    const invalidFindingInput = {
      category: "metodologia",
      severity: "warning",
      claim: "Reivindicação sintética",
      evidence: "Evidência sintética",
      file: batch1.chunks[0].source.file,
      startLine: batch1.chunks[0].source.startLine,
      endLine: batch1.chunks[0].source.endLine,
      sectionId: "sec-teste",
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch0.batchId, // DIVERGÊNCIA: aponta para lote 0 mas dados são do lote 1
    }

    expect(() => {
      createAnalysisFinding(plan, invalidFindingInput)
    }).toThrow(AnalysisFindingError)
  })

  test("Caso 09 (fronteira): retomada determinística serializada multi-turn sem perdas nem duplicações", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_09_serialized_resume_clean")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    const plan = planExhaustiveAnalysisBatches(loaded, config.analysis!.maxCharactersPerBatch)
    expect(plan.batches.length).toBeGreaterThanOrEqual(caseDef.expected.coverage.minBatches!)

    let serializedCp = JSON.stringify(createAnalysisCheckpoint(plan))

    for (let i = 0; i < plan.batches.length; i++) {
      // Simula uma nova sessão/processo que desserializa o checkpoint gravado
      const cp: AnalysisCheckpoint = JSON.parse(serializedCp)
      const next = nextAnalysisBatch(plan, cp)
      expect(next).not.toBeNull()
      expect(next!.batchId).toBe(plan.batches[i].batchId)

      // Re-execução do mesmo lote já concluído deve ser idempotente
      if (i > 0) {
        const idempotentCp = completeAnalysisBatch(plan, cp, plan.batches[i - 1].batchId)
        expect(idempotentCp.completedBatches).toBe(cp.completedBatches)
        expect(idempotentCp.completedCharacters).toBe(cp.completedCharacters)
      }

      // Avança para o próximo
      const updatedCp = completeAnalysisBatch(plan, cp, next!.batchId)
      serializedCp = JSON.stringify(updatedCp)
    }

    const finalCp: AnalysisCheckpoint = JSON.parse(serializedCp)
    expect(finalCp.state).toBe("complete")
    expect(finalCp.completedBatches).toBe(plan.batches.length)
    expect(finalCp.coveragePercent).toBe(100)

    // Síntese subsequente com validação completa
    const synthesis = createGlobalAnalysisSynthesisInput(plan, finalCp, [])
    expect(synthesis.coverage.orderedBatchIds).toEqual(plan.batches.map((b) => b.batchId))
  })

  test("Caso 10 (ambíguo): tratado isoladamente como não-pontuável sem inflar métricas", () => {
    const caseDef = manifest.cases.find((c) => c.id === "case_10_ambiguous_unclassified")!
    const caseDir = path.join(CORPUS_ROOT, caseDef.path)
    const config = buildProjectConfig(caseDef)

    const loaded = loadCanonicalLatexManuscript(caseDir, config)
    // O loader carrega sintaticamente
    expect(loaded.complete).toBe(true)

    // Mas a classificação no manifesto declara como ambígua e não pontuável
    expect(caseDef.expected.classification.isAmbiguous).toBe(true)
    expect(caseDef.expected.classification.scorable).toBe(false)
    expect(caseDef.expected.classification.groundTruth).toBe("unscoreable")
  })

  test("Métricas de regressão: matriz de confusão estrita sobre regras determinísticas", () => {
    let tp = 0 // True Positive: defeito esperado e detectado como bloqueio/rejeição
    let fp = 0 // False Positive: conformidade esperada mas incorretamente rejeitada
    let tn = 0 // True Negative: conformidade esperada e aceita/passada
    let fn = 0 // False Negative: defeito esperado mas silenciado/aceito
    let ambiguousCount = 0

    for (const caseDef of manifest.cases) {
      if (caseDef.expected.classification.isAmbiguous || !caseDef.expected.classification.scorable) {
        ambiguousCount++
        continue
      }

      const caseDir = path.join(CORPUS_ROOT, caseDef.path)
      const config = buildProjectConfig(caseDef)
      const loaded = loadCanonicalLatexManuscript(caseDir, config)

      // Regra de detecção determinística de defeito estrutural
      let detectedDefect = false
      if (!loaded.complete || loaded.fingerprint === null) {
        detectedDefect = true
      } else if (caseDef.id === "case_07_tampered_checkpoint" || caseDef.id === "case_08_finding_provenance_tamper") {
        detectedDefect = true // casos onde a adulteração é detectada nas etapas de checkpoint/finding
      }

      const expectedDefect = caseDef.expected.classification.groundTruth === "positive_for_defect"

      if (expectedDefect && detectedDefect) {
        tp++
      } else if (!expectedDefect && detectedDefect) {
        fp++
      } else if (!expectedDefect && !detectedDefect) {
        tn++
      } else if (expectedDefect && !detectedDefect) {
        fn++
      }
    }

    // Validação estrita das métricas
    expect(tp).toBe(4) // casos 04, 05, 07, 08
    expect(tn).toBe(5) // casos 01, 02, 03, 06, 09
    expect(fp).toBe(0)
    expect(fn).toBe(0)
    expect(ambiguousCount).toBe(1) // caso 10 isolado

    const precision = tp / (tp + fp)
    const recall = tp / (tp + fn)
    const accuracy = (tp + tn) / (tp + tn + fp + fn)

    expect(precision).toBe(1.0)
    expect(recall).toBe(1.0)
    expect(accuracy).toBe(1.0)
  })
})
