/**
 * Pure, versioned AnalysisFinding contract for ExhaustiveAnalysisPlan batches.
 *
 * Validates provenance (plan, fingerprint, batch, file, line range), assigns a
 * deterministic SHA-256 findingId, and merges exact duplicates idempotently.
 *
 * No filesystem, ProjectState, tools, OpenCode, models, clock, randomness,
 * scoring, or global state. Plan identity is delegated to computePlanIdentity.
 */

import { createHash } from "node:crypto"

import { computePlanIdentity } from "./analysis_checkpoint"
import type {
  ExhaustiveAnalysisBatch,
  ExhaustiveAnalysisPlan,
} from "./analysis_coverage"

/** Wire version of the analysis finding document. Bump only with a breaking change. */
export const ANALYSIS_FINDING_VERSION = "analysis-finding-v1" as const

/**
 * Caller-supplied fields for a finding produced against one plan batch.
 * Text fields are trimmed on create; `file` must match a public/POSIX path in the batch.
 */
export interface AnalysisFindingInput {
  category: string
  severity: string
  claim: string
  evidence: string
  file: string
  startLine: number
  endLine: number
  sectionId: string
  manuscriptFingerprint: string
  batchId: string
}

/**
 * Validated, versioned finding bound to a plan identity and deterministic findingId.
 */
export interface AnalysisFinding extends AnalysisFindingInput {
  version: typeof ANALYSIS_FINDING_VERSION
  findingId: string
  planId: string
}

export class AnalysisFindingError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AnalysisFindingError"
    this.code = code
  }
}

function utf8(value: string): Buffer {
  return Buffer.from(value, "utf8")
}

/**
 * Append one length-prefixed UTF-8 field: u32be(byteLength) || bytes.
 * Length framing is unambiguous even when values contain separators or empty strings.
 */
function appendFramed(parts: Buffer[], value: string): void {
  const bytes = utf8(value)
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(bytes.byteLength, 0)
  parts.push(header, bytes)
}

function cloneFinding(finding: AnalysisFinding): AnalysisFinding {
  return {
    version: finding.version,
    findingId: finding.findingId,
    planId: finding.planId,
    category: finding.category,
    severity: finding.severity,
    claim: finding.claim,
    evidence: finding.evidence,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    sectionId: finding.sectionId,
    manuscriptFingerprint: finding.manuscriptFingerprint,
    batchId: finding.batchId,
  }
}

function findingsEqual(a: AnalysisFinding, b: AnalysisFinding): boolean {
  return (
    a.version === b.version &&
    a.findingId === b.findingId &&
    a.planId === b.planId &&
    a.category === b.category &&
    a.severity === b.severity &&
    a.claim === b.claim &&
    a.evidence === b.evidence &&
    a.file === b.file &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.sectionId === b.sectionId &&
    a.manuscriptFingerprint === b.manuscriptFingerprint &&
    a.batchId === b.batchId
  )
}

function assertPlanShape(plan: ExhaustiveAnalysisPlan): void {
  if (plan == null || typeof plan !== "object") {
    throw new AnalysisFindingError(
      "invalid_plan",
      "plan must be an ExhaustiveAnalysisPlan object",
    )
  }
  if (plan.status !== "complete" && plan.status !== "blocked") {
    throw new AnalysisFindingError(
      "invalid_plan",
      `plan.status must be "complete" or "blocked"; received ${String(plan.status)}`,
    )
  }
  if (plan.strategy !== "ordered-source-spans-exhaustive-v1") {
    throw new AnalysisFindingError(
      "invalid_plan",
      `unsupported plan.strategy: ${String(plan.strategy)}`,
    )
  }
  if (!Array.isArray(plan.batches)) {
    throw new AnalysisFindingError(
      "invalid_plan",
      "plan.batches must be an array",
    )
  }
  if (
    plan.coverage == null ||
    typeof plan.coverage !== "object" ||
    typeof plan.coverage.totalCharacters !== "number" ||
    typeof plan.coverage.plannedCharacters !== "number" ||
    typeof plan.coverage.coveragePercent !== "number" ||
    typeof plan.coverage.batchCount !== "number"
  ) {
    throw new AnalysisFindingError(
      "invalid_plan",
      "plan.coverage must expose totalCharacters, plannedCharacters, coveragePercent, and batchCount",
    )
  }
  if (plan.coverage.batchCount !== plan.batches.length) {
    throw new AnalysisFindingError(
      "invalid_plan",
      "plan.coverage.batchCount must equal plan.batches.length",
    )
  }
  for (let i = 0; i < plan.batches.length; i++) {
    const batch = plan.batches[i]
    if (
      batch == null ||
      typeof batch !== "object" ||
      typeof batch.batchId !== "string" ||
      batch.batchId.length === 0 ||
      typeof batch.characters !== "number" ||
      !Number.isFinite(batch.characters) ||
      batch.characters < 0 ||
      batch.index !== i ||
      !Array.isArray(batch.chunks)
    ) {
      throw new AnalysisFindingError(
        "invalid_plan",
        `plan.batches[${i}] is malformed`,
      )
    }
  }
}

function requireNonEmptyTrimmed(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new AnalysisFindingError(
      "invalid_field",
      `${field} must be a non-empty string`,
    )
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new AnalysisFindingError(
      "invalid_field",
      `${field} must be a non-empty string after trim`,
    )
  }
  return trimmed
}

function requirePositiveIntegerLine(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new AnalysisFindingError(
      "invalid_lines",
      `${field} must be a positive integer (>= 1)`,
    )
  }
  return value
}

/**
 * Merge half-open line intervals [start, end] inclusive into sorted disjoint ranges.
 */
function mergeLineIntervals(
  intervals: ReadonlyArray<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return []
  const sorted = intervals
    .slice()
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: Array<{ start: number; end: number }> = [
    { start: sorted[0].start, end: sorted[0].end },
  ]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = merged[merged.length - 1]
    // Adjacent intervals touch when cur.start <= last.end + 1
    if (cur.start <= last.end + 1) {
      if (cur.end > last.end) last.end = cur.end
    } else {
      merged.push({ start: cur.start, end: cur.end })
    }
  }
  return merged
}

/**
 * True when every line in [startLine, endLine] is covered by the union of
 * chunk source ranges for the same file in the batch.
 */
function isLineRangeCoveredByBatch(
  batch: ExhaustiveAnalysisBatch,
  file: string,
  startLine: number,
  endLine: number,
): boolean {
  const intervals: Array<{ start: number; end: number }> = []
  for (const chunk of batch.chunks) {
    if (chunk == null || typeof chunk !== "object" || chunk.source == null) {
      continue
    }
    if (chunk.source.file !== file) continue
    const s = chunk.source.startLine
    const e = chunk.source.endLine
    if (
      typeof s !== "number" ||
      typeof e !== "number" ||
      !Number.isInteger(s) ||
      !Number.isInteger(e) ||
      s < 1 ||
      e < s
    ) {
      continue
    }
    intervals.push({ start: s, end: e })
  }
  if (intervals.length === 0) return false

  const merged = mergeLineIntervals(intervals)
  let cursor = startLine
  for (const range of merged) {
    if (range.end < cursor) continue
    if (range.start > cursor) return false
    // range covers cursor
    if (range.end >= endLine) return true
    cursor = range.end + 1
  }
  return cursor > endLine
}

function batchHasFile(
  batch: ExhaustiveAnalysisBatch,
  file: string,
): boolean {
  for (const chunk of batch.chunks) {
    if (chunk?.source?.file === file) return true
  }
  return false
}

/**
 * Deterministic finding identity: SHA-256 over length-framed UTF-8 fields in
 * fixed order (version, planId, fingerprint, batchId, category, severity,
 * claim, evidence, file, startLine, endLine, sectionId).
 */
export function computeFindingIdentity(finding: {
  version: string
  planId: string
  manuscriptFingerprint: string
  batchId: string
  category: string
  severity: string
  claim: string
  evidence: string
  file: string
  startLine: number
  endLine: number
  sectionId: string
}): string {
  const parts: Buffer[] = []
  appendFramed(parts, finding.version)
  appendFramed(parts, finding.planId)
  appendFramed(parts, finding.manuscriptFingerprint)
  appendFramed(parts, finding.batchId)
  appendFramed(parts, finding.category)
  appendFramed(parts, finding.severity)
  appendFramed(parts, finding.claim)
  appendFramed(parts, finding.evidence)
  appendFramed(parts, finding.file)
  appendFramed(parts, String(finding.startLine))
  appendFramed(parts, String(finding.endLine))
  appendFramed(parts, finding.sectionId)
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex")
}

/**
 * Validate input against plan provenance and return a versioned finding.
 * Never mutates `plan` or `input`. Fail-closed on blocked/malformed plans,
 * fingerprint/batch mismatch, empty text, invalid lines, or out-of-coverage spans.
 */
export function createAnalysisFinding(
  plan: ExhaustiveAnalysisPlan,
  input: AnalysisFindingInput,
): AnalysisFinding {
  assertPlanShape(plan)

  if (plan.status === "blocked") {
    throw new AnalysisFindingError(
      "blocked_plan",
      "cannot create findings for a blocked ExhaustiveAnalysisPlan",
    )
  }

  if (
    plan.fingerprint == null ||
    typeof plan.fingerprint !== "string" ||
    plan.fingerprint.length === 0
  ) {
    throw new AnalysisFindingError(
      "invalid_fingerprint",
      "plan.fingerprint must be a non-empty string to create findings",
    )
  }

  if (input == null || typeof input !== "object") {
    throw new AnalysisFindingError(
      "invalid_input",
      "input must be an AnalysisFindingInput object",
    )
  }

  if (typeof input.manuscriptFingerprint !== "string") {
    throw new AnalysisFindingError(
      "fingerprint_mismatch",
      "manuscriptFingerprint must be a string matching plan.fingerprint",
    )
  }
  if (input.manuscriptFingerprint !== plan.fingerprint) {
    throw new AnalysisFindingError(
      "fingerprint_mismatch",
      "manuscriptFingerprint does not match plan.fingerprint",
    )
  }

  if (typeof input.batchId !== "string" || input.batchId.length === 0) {
    throw new AnalysisFindingError(
      "unknown_batch",
      "batchId must be a non-empty string present in the plan",
    )
  }

  const batch = plan.batches.find((b) => b.batchId === input.batchId)
  if (batch == null) {
    throw new AnalysisFindingError(
      "unknown_batch",
      `batchId is not present in the plan: ${input.batchId}`,
    )
  }

  const category = requireNonEmptyTrimmed(input.category, "category")
  const severity = requireNonEmptyTrimmed(input.severity, "severity")
  const claim = requireNonEmptyTrimmed(input.claim, "claim")
  const evidence = requireNonEmptyTrimmed(input.evidence, "evidence")
  const sectionId = requireNonEmptyTrimmed(input.sectionId, "sectionId")

  if (typeof input.file !== "string" || input.file.length === 0) {
    throw new AnalysisFindingError(
      "file_not_in_batch",
      "file must be a non-empty public/POSIX path present in the batch chunks",
    )
  }
  // Exact match only — no path normalization or alternate forms.
  const file = input.file
  if (!batchHasFile(batch, file)) {
    throw new AnalysisFindingError(
      "file_not_in_batch",
      `file is not present in batch chunks: ${file}`,
    )
  }

  const startLine = requirePositiveIntegerLine(input.startLine, "startLine")
  const endLine = requirePositiveIntegerLine(input.endLine, "endLine")
  if (endLine < startLine) {
    throw new AnalysisFindingError(
      "invalid_lines",
      "endLine must be greater than or equal to startLine",
    )
  }

  if (!isLineRangeCoveredByBatch(batch, file, startLine, endLine)) {
    throw new AnalysisFindingError(
      "line_range_not_covered",
      `line range ${startLine}-${endLine} is not fully covered by batch chunks for file ${file}`,
    )
  }

  const planId = computePlanIdentity(plan)
  const version = ANALYSIS_FINDING_VERSION
  const findingId = computeFindingIdentity({
    version,
    planId,
    manuscriptFingerprint: plan.fingerprint,
    batchId: input.batchId,
    category,
    severity,
    claim,
    evidence,
    file,
    startLine,
    endLine,
    sectionId,
  })

  return {
    version,
    findingId,
    planId,
    category,
    severity,
    claim,
    evidence,
    file,
    startLine,
    endLine,
    sectionId,
    manuscriptFingerprint: plan.fingerprint,
    batchId: input.batchId,
  }
}

/**
 * Exact, pure, idempotent merge of findings.
 *
 * - Preserves first-occurrence order.
 * - Drops only records with identical findingId and full payload.
 * - Rejects same findingId with a different payload (collision).
 * - Never mutates `existing` or `incoming` arrays or their objects.
 */
export function mergeAnalysisFindings(
  existing: readonly AnalysisFinding[],
  incoming: readonly AnalysisFinding[],
): AnalysisFinding[] {
  if (!Array.isArray(existing) || !Array.isArray(incoming)) {
    throw new AnalysisFindingError(
      "invalid_merge_input",
      "existing and incoming must be arrays of AnalysisFinding",
    )
  }

  const result: AnalysisFinding[] = []
  const byId = new Map<string, AnalysisFinding>()

  const pushUnique = (finding: AnalysisFinding, label: string): void => {
    if (finding == null || typeof finding !== "object") {
      throw new AnalysisFindingError(
        "invalid_finding",
        `${label} contains a non-object finding`,
      )
    }
    if (
      typeof finding.findingId !== "string" ||
      finding.findingId.length === 0
    ) {
      throw new AnalysisFindingError(
        "invalid_finding",
        `${label} finding is missing findingId`,
      )
    }
    const prior = byId.get(finding.findingId)
    if (prior == null) {
      const clone = cloneFinding(finding)
      byId.set(clone.findingId, clone)
      result.push(clone)
      return
    }
    if (!findingsEqual(prior, finding)) {
      throw new AnalysisFindingError(
        "finding_id_collision",
        `same findingId associated with different payloads: ${finding.findingId}`,
      )
    }
    // Exact duplicate — keep first occurrence only.
  }

  for (let i = 0; i < existing.length; i++) {
    pushUnique(existing[i], `existing[${i}]`)
  }
  for (let i = 0; i < incoming.length; i++) {
    pushUnique(incoming[i], `incoming[${i}]`)
  }

  return result
}
