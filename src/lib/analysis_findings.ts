/**
 * Pure, versioned AnalysisFinding contract for ExhaustiveAnalysisPlan batches.
 *
 * Validates provenance (plan, fingerprint, batch, file, line range), assigns a
 * deterministic SHA-256 findingId, and merges exact duplicates idempotently.
 *
 * Plan shape and canonical planId come from analysis-checkpoint-v2
 * (`computePlanIdentity`). Findings add only: source-span fragment continuity,
 * fingerprint/batch/file matching, and line-range union coverage.
 *
 * No filesystem, ProjectState, tools, OpenCode, models, clock, randomness,
 * scoring, or global state.
 */

import { createHash } from "node:crypto"

import {
  AnalysisCheckpointError,
  computePlanIdentity,
} from "./analysis_checkpoint"
import type {
  ExhaustiveAnalysisBatch,
  ExhaustiveAnalysisPlan,
} from "./analysis_coverage"

/** Wire version of the analysis finding document. Bump only with a breaking change. */
export const ANALYSIS_FINDING_VERSION = "analysis-finding-v1" as const

/** Exact key set for analysis-finding-v1 stored findings (no extras, no missing). */
const ANALYSIS_FINDING_V1_KEYS = [
  "version",
  "findingId",
  "planId",
  "category",
  "severity",
  "claim",
  "evidence",
  "file",
  "startLine",
  "endLine",
  "sectionId",
  "manuscriptFingerprint",
  "batchId",
] as const

const ANALYSIS_FINDING_V1_KEY_SET = new Set<string>(ANALYSIS_FINDING_V1_KEYS)

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

/**
 * Resolve plan identity via the canonical checkpoint validator.
 * Maps AnalysisCheckpointError → AnalysisFindingError("invalid_plan", ...).
 */
function resolvePlanId(plan: ExhaustiveAnalysisPlan): string {
  try {
    return computePlanIdentity(plan)
  } catch (err) {
    if (err instanceof AnalysisCheckpointError) {
      throw new AnalysisFindingError("invalid_plan", err.message)
    }
    throw err
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
 * Stored non-normalized strings: non-empty after type check (whitespace-only rejected).
 * Values are used as stored for identity — not re-trimmed.
 */
function requireStoredNonEmptyString(
  value: unknown,
  field: string,
  label: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding.${field} must be a non-empty string`,
    )
  }
  return value
}

/**
 * Canonical text fields on the wire must already be trimmed (create trims).
 * Reject padding even when findingId was computed over the padded value.
 */
function requireStoredCanonicalText(
  value: unknown,
  field: string,
  label: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding.${field} must be a non-empty string`,
    )
  }
  if (value !== value.trim()) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding.${field} must be canonical (no leading/trailing whitespace)`,
    )
  }
  return value
}

function requireStoredPositiveIntegerLine(
  value: unknown,
  field: string,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding.${field} must be a positive integer (>= 1)`,
    )
  }
  return value
}

function assertExactFindingKeys(
  finding: object,
  label: string,
): void {
  const keys = Object.keys(finding)
  if (keys.length !== ANALYSIS_FINDING_V1_KEY_SET.size) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding must have exactly ${ANALYSIS_FINDING_V1_KEY_SET.size} keys for ${ANALYSIS_FINDING_VERSION}`,
    )
  }
  for (const key of keys) {
    if (!ANALYSIS_FINDING_V1_KEY_SET.has(key)) {
      throw new AnalysisFindingError(
        "invalid_finding",
        `${label} finding has unknown key: ${key}`,
      )
    }
  }
  for (const required of ANALYSIS_FINDING_V1_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(finding, required)) {
      throw new AnalysisFindingError(
        "invalid_finding",
        `${label} finding is missing required key: ${required}`,
      )
    }
  }
}

/**
 * Fail-closed structural validation of a stored AnalysisFinding:
 * exact key set, canonical trimmed text fields, recomputed findingId.
 */
function assertValidStoredFinding(
  finding: unknown,
  label: string,
): AnalysisFinding {
  if (finding == null || typeof finding !== "object" || Array.isArray(finding)) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} contains a non-object finding`,
    )
  }

  assertExactFindingKeys(finding, label)
  const f = finding as Record<string, unknown>

  if (f.version !== ANALYSIS_FINDING_VERSION) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding.version must be ${ANALYSIS_FINDING_VERSION}`,
    )
  }

  const findingId = requireStoredNonEmptyString(f.findingId, "findingId", label)
  const planId = requireStoredNonEmptyString(f.planId, "planId", label)
  const category = requireStoredCanonicalText(f.category, "category", label)
  const severity = requireStoredCanonicalText(f.severity, "severity", label)
  const claim = requireStoredCanonicalText(f.claim, "claim", label)
  const evidence = requireStoredCanonicalText(f.evidence, "evidence", label)
  const sectionId = requireStoredCanonicalText(f.sectionId, "sectionId", label)
  const file = requireStoredNonEmptyString(f.file, "file", label)
  const manuscriptFingerprint = requireStoredNonEmptyString(
    f.manuscriptFingerprint,
    "manuscriptFingerprint",
    label,
  )
  const batchId = requireStoredNonEmptyString(f.batchId, "batchId", label)
  const startLine = requireStoredPositiveIntegerLine(
    f.startLine,
    "startLine",
    label,
  )
  const endLine = requireStoredPositiveIntegerLine(f.endLine, "endLine", label)
  if (endLine < startLine) {
    throw new AnalysisFindingError(
      "invalid_finding",
      `${label} finding.endLine must be greater than or equal to startLine`,
    )
  }

  const recomputed = computeFindingIdentity({
    version: ANALYSIS_FINDING_VERSION,
    planId,
    manuscriptFingerprint,
    batchId,
    category,
    severity,
    claim,
    evidence,
    file,
    startLine,
    endLine,
    sectionId,
  })
  if (findingId !== recomputed) {
    throw new AnalysisFindingError(
      "finding_id_mismatch",
      `${label} finding.findingId does not match payload identity`,
    )
  }

  return {
    version: ANALYSIS_FINDING_VERSION,
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
    manuscriptFingerprint,
    batchId,
  }
}

/**
 * Source-span fragment continuity across the plan.
 *
 * Call only after `resolvePlanId` / `computePlanIdentity` succeeds. Checkpoint
 * v2 already guarantees batch/chunk shape, global indices, non-empty text,
 * source file/lines, sourceSpanIndex type, offsets, offset↔text.length
 * coherence, batch character sums, and content digest binding.
 *
 * Findings still require these continuity invariants (not in checkpoint v2):
 * - sourceSpanIndex is non-decreasing in global plan order
 * - first fragment of each span has startOffset === 0
 * - fragments of the same sourceSpanIndex share the same file
 * - consecutive same-span fragments are contiguous
 *   (startOffset === previous endOffset)
 */
function assertPlanSourceSpanContinuity(plan: ExhaustiveAnalysisPlan): void {
  let prevSpanIndex: number | null = null
  let prevSpanFile: string | null = null
  let prevEndOffset: number | null = null

  for (let bi = 0; bi < plan.batches.length; bi++) {
    const batch = plan.batches[bi]
    for (let ci = 0; ci < batch.chunks.length; ci++) {
      const chunk = batch.chunks[ci]
      const path = `plan.batches[${bi}].chunks[${ci}]`
      const { sourceSpanIndex, file, startOffset, endOffset } = chunk.source

      if (prevSpanIndex === null || sourceSpanIndex > prevSpanIndex) {
        // First fragment of the plan or of a new span.
        if (startOffset !== 0) {
          throw new AnalysisFindingError(
            "invalid_plan",
            `${path}: first fragment of a source span must have startOffset === 0`,
          )
        }
      } else if (sourceSpanIndex < prevSpanIndex) {
        throw new AnalysisFindingError(
          "invalid_plan",
          `${path}.source.sourceSpanIndex must be non-decreasing in plan order`,
        )
      } else {
        // Same span as the previous fragment.
        if (file !== prevSpanFile) {
          throw new AnalysisFindingError(
            "invalid_plan",
            `${path}.source.file must match prior fragment of the same sourceSpanIndex`,
          )
        }
        if (startOffset !== prevEndOffset) {
          throw new AnalysisFindingError(
            "invalid_plan",
            `${path}: same-span fragments must be contiguous (startOffset === previous endOffset)`,
          )
        }
      }

      prevSpanIndex = sourceSpanIndex
      prevSpanFile = file
      prevEndOffset = endOffset
    }
  }
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
    if (cur.start <= last.end + 1) {
      if (cur.end > last.end) last.end = cur.end
    } else {
      merged.push({ start: cur.start, end: cur.end })
    }
  }
  return merged
}

/**
 * Collect inclusive line intervals for `file` from a fully validated batch.
 */
function lineIntervalsForFileInBatch(
  batch: ExhaustiveAnalysisBatch,
  file: string,
): Array<{ start: number; end: number }> {
  const intervals: Array<{ start: number; end: number }> = []
  for (const chunk of batch.chunks) {
    if (chunk.source.file === file) {
      intervals.push({
        start: chunk.source.startLine,
        end: chunk.source.endLine,
      })
    }
  }
  return intervals
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
  const intervals = lineIntervalsForFileInBatch(batch, file)
  if (intervals.length === 0) return false

  const merged = mergeLineIntervals(intervals)
  let cursor = startLine
  for (const range of merged) {
    if (range.end < cursor) continue
    if (range.start > cursor) return false
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
    if (chunk.source.file === file) return true
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
  // Canonical plan shape + identity (checkpoint v2; maps to invalid_plan).
  const planId = resolvePlanId(plan)
  // Continuity only: shape/content already validated by resolvePlanId.
  assertPlanSourceSpanContinuity(plan)

  if (plan.status === "blocked") {
    throw new AnalysisFindingError(
      "blocked_plan",
      "cannot create findings for a blocked ExhaustiveAnalysisPlan",
    )
  }

  // Complete plans are guaranteed a non-empty fingerprint by resolvePlanId.
  const planFingerprint = plan.fingerprint as string

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
  if (input.manuscriptFingerprint !== planFingerprint) {
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

  const version = ANALYSIS_FINDING_VERSION
  const findingId = computeFindingIdentity({
    version,
    planId,
    manuscriptFingerprint: planFingerprint,
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
    manuscriptFingerprint: planFingerprint,
    batchId: input.batchId,
  }
}

/**
 * Exact, pure, idempotent merge of findings.
 *
 * - Structurally validates every finding (exact keys, version, canonical text,
 *   fields, findingId identity).
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

  const pushUnique = (raw: unknown, label: string): void => {
    const finding = assertValidStoredFinding(raw, label)
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
