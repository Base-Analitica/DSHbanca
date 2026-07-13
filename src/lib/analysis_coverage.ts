/**
 * Pure, deterministic planner for analysis coverage over a canonical LaTeX manuscript.
 *
 * Budget unit: JavaScript string length (`span.text.length`) — UTF-16 code units,
 * not UTF-8 bytes and not LLM tokens. Callers that convert to bytes or tokens must
 * do so outside this module.
 *
 * Inclusion strategy: `ordered-source-spans-prefix-v1` (see `planAnalysisCoverage`).
 * This module does not read the filesystem, config, or tools; it never mutates the
 * manuscript input and never truncates span text mid-span.
 *
 * Fail-closed contract:
 * - Structurally invalid manuscripts throw TypeError (never invent empty content).
 * - Well-shaped incomplete results (`complete === false` or `fingerprint === null`)
 *   return status `blocked`.
 * - Analysis runs only when `complete === true` and fingerprint is a non-empty string.
 */

import type {
  CanonicalLatexManuscriptResult,
  LoaderDiagnostic,
  SourceSpan,
} from "./latex_loader"

export type CoverageStatus = "complete" | "partial" | "blocked"

export type CoverageOmissionReason =
  | "budget_exceeded"
  | "manuscript_incomplete"

export interface SourceSpanRef {
  file: string
  startLine: number
  endLine: number
  characters: number
}

export interface OmittedSourceSpanRef extends SourceSpanRef {
  reason: CoverageOmissionReason
}

export interface AnalysisChunk {
  index: number
  text: string
  source: SourceSpanRef
}

export interface AnalysisCoverage {
  status: CoverageStatus
  totalCharacters: number
  includedCharacters: number
  coveragePercent: number
  budgetCharacters: number
  includedSpans: SourceSpanRef[]
  omittedSpans: OmittedSourceSpanRef[]
  strategy: "ordered-source-spans-prefix-v1"
}

export interface AnalysisCoveragePlan {
  chunks: AnalysisChunk[]
  coverage: AnalysisCoverage
  fingerprint: string | null
  diagnostics: LoaderDiagnostic[]
}

const STRATEGY = "ordered-source-spans-prefix-v1" as const

function assertValidBudget(budgetCharacters: number): void {
  if (
    typeof budgetCharacters !== "number" ||
    !Number.isFinite(budgetCharacters) ||
    !Number.isInteger(budgetCharacters) ||
    budgetCharacters < 0
  ) {
    throw new RangeError(
      `budgetCharacters must be a finite non-negative integer; received ${String(budgetCharacters)}`,
    )
  }
}

function assertSourceSpan(span: unknown, index: number): asserts span is SourceSpan {
  if (span == null || typeof span !== "object") {
    throw new TypeError(
      `orderedSources[${index}] must be a SourceSpan object`,
    )
  }
  const s = span as Record<string, unknown>
  if (typeof s.file !== "string") {
    throw new TypeError(
      `orderedSources[${index}].file must be a string`,
    )
  }
  if (
    typeof s.startLine !== "number" ||
    !Number.isInteger(s.startLine) ||
    s.startLine < 1
  ) {
    throw new TypeError(
      `orderedSources[${index}].startLine must be an integer >= 1`,
    )
  }
  if (
    typeof s.endLine !== "number" ||
    !Number.isInteger(s.endLine) ||
    s.endLine < s.startLine
  ) {
    throw new TypeError(
      `orderedSources[${index}].endLine must be an integer >= startLine`,
    )
  }
  if (typeof s.text !== "string") {
    throw new TypeError(
      `orderedSources[${index}].text must be a string`,
    )
  }
}

/**
 * Validate runtime shape of a CanonicalLatexManuscriptResult.
 * Does not invent defaults for missing arrays or span text.
 */
function assertManuscriptContract(
  manuscript: CanonicalLatexManuscriptResult,
): {
  sources: SourceSpan[]
  diagnostics: LoaderDiagnostic[]
} {
  if (!Array.isArray(manuscript.orderedSources)) {
    throw new TypeError(
      "manuscript.orderedSources must be an array",
    )
  }
  if (!Array.isArray(manuscript.diagnostics)) {
    throw new TypeError(
      "manuscript.diagnostics must be an array",
    )
  }

  const sources = manuscript.orderedSources
  for (let i = 0; i < sources.length; i++) {
    assertSourceSpan(sources[i], i)
  }

  return {
    sources,
    diagnostics: manuscript.diagnostics.slice(),
  }
}

function toSpanRef(span: SourceSpan): SourceSpanRef {
  return {
    file: span.file,
    startLine: span.startLine,
    endLine: span.endLine,
    characters: span.text.length,
  }
}

/**
 * Deterministic coverage percent in [0, 100], two decimal places.
 * Empty complete document → 100; blocked callers must pass 0/0 with forceZero.
 */
function coveragePercent(
  includedCharacters: number,
  totalCharacters: number,
  options?: { emptyIsFull?: boolean },
): number {
  if (totalCharacters === 0) {
    return options?.emptyIsFull ? 100 : 0
  }
  // Two decimal places in one step (equivalent to Math.round(raw * 100) / 100).
  const rounded =
    Math.round((includedCharacters / totalCharacters) * 10000) / 100
  if (!Number.isFinite(rounded)) return 0
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

function blockedPlan(
  sources: SourceSpan[],
  diagnostics: LoaderDiagnostic[],
  budgetCharacters: number,
  totalCharacters: number,
): AnalysisCoveragePlan {
  const omittedSpans: OmittedSourceSpanRef[] = sources.map((span) => ({
    ...toSpanRef(span),
    reason: "manuscript_incomplete" as const,
  }))
  return {
    chunks: [],
    coverage: {
      status: "blocked",
      totalCharacters,
      includedCharacters: 0,
      coveragePercent: 0,
      budgetCharacters,
      includedSpans: [],
      omittedSpans,
      strategy: STRATEGY,
    },
    fingerprint: null,
    diagnostics,
  }
}

/**
 * Plan which ordered source spans fit an explicit character budget.
 *
 * Strategy `ordered-source-spans-prefix-v1`:
 * 1. Walk `orderedSources` in canonical order.
 * 2. Each `SourceSpan` is atomic (never split or mid-truncated).
 * 3. Include whole spans while cumulative length ≤ budget.
 * 4. On first overflow, omit that span and every later span (no backfill).
 * 5. Empty markers before the cut remain included.
 *
 * Contract vs incompleteness:
 * - Structurally invalid input → `TypeError` (never silent empty complete).
 * - Well-shaped incomplete (`complete === false` or `fingerprint === null`) →
 *   `status: "blocked"`, zero chunks, all spans omitted as `manuscript_incomplete`.
 * - Analysis only when `complete === true` and fingerprint is a non-empty string.
 */
export function planAnalysisCoverage(
  manuscript: CanonicalLatexManuscriptResult,
  budgetCharacters: number,
): AnalysisCoveragePlan {
  assertValidBudget(budgetCharacters)

  if (manuscript == null) {
    throw new TypeError("manuscript must be defined")
  }

  const { sources, diagnostics } = assertManuscriptContract(manuscript)

  let totalCharacters = 0
  for (const span of sources) {
    totalCharacters += span.text.length
  }

  // Loader-shaped incomplete: explicit false complete or null fingerprint.
  if (manuscript.complete === false || manuscript.fingerprint === null) {
    return blockedPlan(sources, diagnostics, budgetCharacters, totalCharacters)
  }

  // Analyzable only with strict complete + non-empty string fingerprint.
  // Absent/undefined/empty fingerprint is a contract violation, not "complete".
  if (manuscript.complete !== true) {
    throw new TypeError(
      "manuscript.complete must be true to analyze, or false for blocked incomplete results",
    )
  }
  if (
    typeof manuscript.fingerprint !== "string" ||
    manuscript.fingerprint.length === 0
  ) {
    throw new TypeError(
      "manuscript.fingerprint must be a non-empty string to analyze",
    )
  }

  const fingerprint = manuscript.fingerprint

  const chunks: AnalysisChunk[] = []
  const includedSpans: SourceSpanRef[] = []
  const omittedSpans: OmittedSourceSpanRef[] = []
  let includedCharacters = 0
  let remaining = budgetCharacters
  let omitting = false

  for (const span of sources) {
    const len = span.text.length
    if (omitting) {
      omittedSpans.push({
        ...toSpanRef(span),
        reason: "budget_exceeded",
      })
      continue
    }
    if (len > remaining) {
      omitting = true
      omittedSpans.push({
        ...toSpanRef(span),
        reason: "budget_exceeded",
      })
      continue
    }
    const ref = toSpanRef(span)
    includedSpans.push(ref)
    chunks.push({
      index: chunks.length,
      text: span.text,
      source: ref,
    })
    includedCharacters += len
    remaining -= len
  }

  const status: CoverageStatus =
    omittedSpans.length === 0 ? "complete" : "partial"

  return {
    chunks,
    coverage: {
      status,
      totalCharacters,
      includedCharacters,
      coveragePercent: coveragePercent(includedCharacters, totalCharacters, {
        emptyIsFull: true,
      }),
      budgetCharacters,
      includedSpans,
      omittedSpans,
      strategy: STRATEGY,
    },
    fingerprint,
    diagnostics,
  }
}
