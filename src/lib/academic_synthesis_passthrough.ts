import { GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION } from "./analysis_synthesis"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSynthesisInputShape(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.coverage)) return false

  const coverage = value.coverage
  return (
    value.version === GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION &&
    typeof value.planId === "string" &&
    value.planId.length > 0 &&
    typeof value.manuscriptFingerprint === "string" &&
    value.manuscriptFingerprint.length > 0 &&
    coverage.state === "complete" &&
    typeof coverage.totalBatches === "number" &&
    typeof coverage.completedBatches === "number" &&
    typeof coverage.totalCharacters === "number" &&
    typeof coverage.completedCharacters === "number" &&
    coverage.coveragePercent === 100 &&
    Array.isArray(coverage.orderedBatchIds) &&
    coverage.orderedBatchIds.every((batchId) => typeof batchId === "string") &&
    Array.isArray(value.findings)
  )
}

function soleJsonFenceContents(text: string): string | undefined {
  const match = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)
  return match?.[1]
}

/**
 * Signals only a standalone textual echo of the canonical synthesis-input shape:
 * raw JSON or one JSON/unlabelled Markdown fence, with optional outer whitespace.
 *
 * This does not validate the truth or academic meaning of any field, the quality
 * of a synthesis, or relations between findings. A standalone example with the
 * same shape can be a false positive; an echo embedded in prose or another
 * serialization/wrapper can be a false negative by design.
 */
export function isStandaloneSynthesisInputEcho(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false

  const candidate = soleJsonFenceContents(trimmed) ?? trimmed
  try {
    return isSynthesisInputShape(JSON.parse(candidate) as unknown)
  } catch {
    return false
  }
}
