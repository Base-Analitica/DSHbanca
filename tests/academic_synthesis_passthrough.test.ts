import { describe, expect, test } from "bun:test"
import { GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION } from "../src/lib/analysis_synthesis"
import { isStandaloneSynthesisInputEcho } from "../src/lib/academic_synthesis_passthrough"

const syntheticEnvelope = {
  version: GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION,
  planId: "plan-synthetic-001",
  manuscriptFingerprint: "a".repeat(64),
  coverage: {
    state: "complete",
    totalBatches: 2,
    completedBatches: 2,
    totalCharacters: 120,
    completedCharacters: 120,
    coveragePercent: 100,
    orderedBatchIds: ["batch-synthetic-001", "batch-synthetic-002"],
  },
  findings: [],
}

const syntheticJson = JSON.stringify(syntheticEnvelope)

/*
 * Textual limits: a standalone, structurally matching envelope used only as an
 * example can be a false positive. A real echo decorated with prose or another
 * unsupported wrapper can be a false negative. Neither result judges academic
 * meaning or validates the contents of the envelope.
 */
describe("isStandaloneSynthesisInputEcho", () => {
  test("recognizes a complete synthetic synthesis input JSON object", () => {
    expect(isStandaloneSynthesisInputEcho(syntheticJson)).toBe(true)
  })

  test("recognizes the envelope as the only Markdown JSON fence", () => {
    expect(isStandaloneSynthesisInputEcho(`\`\`\`json\n${syntheticJson}\n\`\`\``)).toBe(true)
  })

  test("recognizes the envelope as the only unlabelled Markdown fence", () => {
    expect(isStandaloneSynthesisInputEcho(`\`\`\`\r\n${syntheticJson}\r\n\`\`\``)).toBe(true)
  })

  test("ignores surrounding spaces, tabs, LF, and CRLF", () => {
    for (const text of [
      `  ${syntheticJson}  `,
      `\n${syntheticJson}\n`,
      ` \r\n\t${syntheticJson}\r\n `,
    ]) {
      expect(isStandaloneSynthesisInputEcho(text)).toBe(true)
    }
  })

  test("does not treat an empty or whitespace-only answer as an echo", () => {
    for (const text of ["", "   ", "\n\t\r\n  "]) {
      expect(isStandaloneSynthesisInputEcho(text)).toBe(false)
    }
  })

  test("does not treat generic JSON values or other contracts as the envelope", () => {
    for (const text of [
      "{}",
      "[]",
      "null",
      "true",
      "17",
      JSON.stringify({ id: "synthetic-001", status: "complete" }),
    ]) {
      expect(isStandaloneSynthesisInputEcho(text)).toBe(false)
    }
  })

  test("requires the canonical synthesis input version", () => {
    const wrongVersion = {
      ...syntheticEnvelope,
      version: "global-analysis-synthesis-input-v0",
    }
    expect(isStandaloneSynthesisInputEcho(JSON.stringify(wrongVersion))).toBe(false)
  })

  test("requires each fundamental top-level envelope field", () => {
    const withoutPlanId = { ...syntheticEnvelope } as Record<string, unknown>
    const withoutFingerprint = { ...syntheticEnvelope } as Record<string, unknown>
    const withoutCoverage = { ...syntheticEnvelope } as Record<string, unknown>
    const withoutFindings = { ...syntheticEnvelope } as Record<string, unknown>
    delete withoutPlanId.planId
    delete withoutFingerprint.manuscriptFingerprint
    delete withoutCoverage.coverage
    delete withoutFindings.findings

    for (const value of [
      withoutPlanId,
      withoutFingerprint,
      withoutCoverage,
      withoutFindings,
    ]) {
      expect(isStandaloneSynthesisInputEcho(JSON.stringify(value))).toBe(false)
    }
  })

  test("requires structurally recognizable coverage and findings values", () => {
    for (const value of [
      { ...syntheticEnvelope, coverage: null },
      { ...syntheticEnvelope, coverage: [] },
      { ...syntheticEnvelope, coverage: {} },
      { ...syntheticEnvelope, findings: {} },
    ]) {
      expect(isStandaloneSynthesisInputEcho(JSON.stringify(value))).toBe(false)
    }
  })

  test("returns false for malformed JSON", () => {
    for (const text of ['{"version":', '{"version":"value",}', "{not json}"]) {
      expect(isStandaloneSynthesisInputEcho(text)).toBe(false)
    }
  })

  test("does not flag academic prose with the six required synthesis sections", () => {
    const prose = [
      "Síntese global do manuscrito\nOs achados sintéticos indicam dois temas complementares.",
      "Contradições ou tensões entre seções\nNão há evidência suficiente para afirmar uma contradição.",
      "Coerência entre objetivos, método, resultados e conclusão\nA descrição do método é compatível com o objetivo declarado.",
      "Lacunas globais de argumentação ou evidência\nUma comparação adicional pode esclarecer o limite observado.",
      "Redundâncias e inconsistências recorrentes\nAs duas passagens repetem um mesmo ponto de forma independente.",
      "Prioridades de revisão\nRevisar a transição entre método e resultados.",
    ].join("\n\n")

    expect(isStandaloneSynthesisInputEcho(prose)).toBe(false)
  })

  test("does not flag prose that mentions or quotes a JSON fragment", () => {
    const prose = `A estrutura \`{"version":"${GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION}"}\` identifica a versão do contrato; isso é apenas uma citação.`
    expect(isStandaloneSynthesisInputEcho(prose)).toBe(false)
  })

  test("does not flag an envelope accompanied by substantial prose outside it", () => {
    expect(
      isStandaloneSynthesisInputEcho(
        `A entrada abaixo é evidência de cobertura, não a síntese acadêmica.\n${syntheticJson}`,
      ),
    ).toBe(false)
    expect(
      isStandaloneSynthesisInputEcho(
        `${syntheticJson}\nA análise relacional deve ser redigida separadamente.`,
      ),
    ).toBe(false)
  })

  test("does not flag a JSON fence when the response contains additional content", () => {
    const response = `\`\`\`json\n${syntheticJson}\n\`\`\`\nA síntese relaciona os achados dos dois lotes.`
    expect(isStandaloneSynthesisInputEcho(response)).toBe(false)
  })
})
