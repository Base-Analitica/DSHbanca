/**
 * Pure, versioned BatchAuditConfirmation contract for ExhaustiveAnalysisPlan batches.
 *
 * Binds durable audit evidence to planId, manuscriptFingerprint, batchId,
 * canonical batchIndex, and structurally validated acceptedCount.
 *
 * Provides cryptographic binding (findingsDigest, submissionId) between
 * batch audit confirmations and the findings validated by banca_auditar.
 *
 * No filesystem, I/O, models, tools, clocks, or randomness.
 * Fail-closed on invalid, missing, tampered, or mismatched fields.
 */

import { createHash } from "node:crypto"
import { computePlanIdentity } from "./analysis_checkpoint"
import type {
  ExhaustiveAnalysisBatch,
  ExhaustiveAnalysisPlan,
} from "./analysis_coverage"
import type { AnalysisFinding } from "./analysis_findings"

/** Wire version of the batch audit confirmation record. */
export const BATCH_AUDIT_CONFIRMATION_VERSION =
  "batch-audit-confirmation-v1" as const

/** Disclaimer: confirmation proves only structural submission, never inference or grade. */
export const BATCH_AUDIT_DISCLAIMER =
  "Structural validation confirmation for one canonical plan batch. Does not prove model execution, semantic inference, or academic grade." as const

/** Core key set required for any batch-audit-confirmation-v1. */
const BATCH_AUDIT_CONFIRMATION_CORE_KEYS = [
  "version",
  "planId",
  "manuscriptFingerprint",
  "batchId",
  "batchIndex",
  "acceptedCount",
  "disclaimer",
] as const

const BATCH_AUDIT_CONFIRMATION_CORE_KEY_SET = new Set<string>(
  BATCH_AUDIT_CONFIRMATION_CORE_KEYS,
)

const BATCH_AUDIT_CONFIRMATION_ALL_KEYS = new Set<string>([
  ...BATCH_AUDIT_CONFIRMATION_CORE_KEYS,
  "findingIds",
  "findingsDigest",
  "submissionId",
])

/**
 * Durable record certifying that a batch was submitted through structural audit validation.
 * Distinct from absence of audit even when acceptedCount === 0.
 */
export interface BatchAuditConfirmation {
  version: typeof BATCH_AUDIT_CONFIRMATION_VERSION
  planId: string
  manuscriptFingerprint: string
  batchId: string
  batchIndex: number
  acceptedCount: number
  findingIds?: string[]
  findingsDigest?: string
  submissionId?: string
  disclaimer: string
}

export class AnalysisAuditConfirmationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AnalysisAuditConfirmationError"
    this.code = code
  }
}

function utf8(value: string): Buffer {
  return Buffer.from(value, "utf8")
}

function appendFramed(parts: Buffer[], value: string): void {
  const bytes = utf8(value)
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(bytes.byteLength, 0)
  parts.push(header, bytes)
}

/**
 * Compute deterministic digest over the accepted findings of a batch.
 * Uses length-framed UTF-8 of sorted findingIds.
 */
export function computeBatchFindingsDigest(
  findings: readonly (AnalysisFinding | { findingId: string } | string)[],
): string {
  const findingIds = findings
    .map((item) => (typeof item === "string" ? item : item.findingId))
    .sort()

  const parts: Buffer[] = []
  appendFramed(parts, "openbanca-batch-findings-digest-v1")
  appendFramed(parts, String(findingIds.length))
  for (const id of findingIds) {
    appendFramed(parts, id)
  }
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex")
}

/**
 * Compute deterministic submission identity binding confirmation to plan, batch,
 * and findings digest.
 */
export function computeAuditSubmissionId(opts: {
  planId: string
  manuscriptFingerprint: string
  batchId: string
  batchIndex: number
  acceptedCount: number
  findingsDigest: string
}): string {
  const parts: Buffer[] = []
  appendFramed(parts, "openbanca-audit-submission-id-v1")
  appendFramed(parts, opts.planId)
  appendFramed(parts, opts.manuscriptFingerprint)
  appendFramed(parts, opts.batchId)
  appendFramed(parts, String(opts.batchIndex))
  appendFramed(parts, String(opts.acceptedCount))
  appendFramed(parts, opts.findingsDigest)
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex")
}

export type BatchAuditSubmissionInput = {
  findings?: readonly (AnalysisFinding | { findingId: string })[]
  disclaimer?: string
}

/**
 * Create a BatchAuditConfirmation for a canonical plan batch.
 *
 * When called with submission input `{ findings }`, computes findingsDigest and submissionId,
 * producing a verified confirmation backed by audit submission evidence.
 *
 * When called with a raw count `acceptedCount: number`, produces an unverified draft record
 * lacking durable submission evidence (rejected by banca_context and banca_sintese).
 */
export function createBatchAuditConfirmation(
  plan: ExhaustiveAnalysisPlan,
  batch: ExhaustiveAnalysisBatch,
  submissionOrCount: number | BatchAuditSubmissionInput,
  legacyDisclaimer?: string,
): BatchAuditConfirmation {
  if (plan.status !== "complete") {
    throw new AnalysisAuditConfirmationError(
      "blocked_plan",
      "cannot create audit confirmation for a blocked plan",
    )
  }

  if (typeof plan.fingerprint !== "string" || plan.fingerprint.length === 0) {
    throw new AnalysisAuditConfirmationError(
      "invalid_plan",
      "complete plan must have a non-empty string fingerprint",
    )
  }

  const planId = computePlanIdentity(plan)

  if (
    batch == null ||
    typeof batch !== "object" ||
    typeof batch.batchId !== "string" ||
    batch.batchId.length === 0 ||
    typeof batch.index !== "number" ||
    !Number.isInteger(batch.index) ||
    batch.index < 0
  ) {
    throw new AnalysisAuditConfirmationError(
      "invalid_batch",
      "batch must be a valid ExhaustiveAnalysisBatch object",
    )
  }

  const matchingBatch = plan.batches[batch.index]
  if (matchingBatch == null || matchingBatch.batchId !== batch.batchId) {
    throw new AnalysisAuditConfirmationError(
      "unknown_batch",
      `batchId ${batch.batchId} at index ${batch.index} is not part of the plan`,
    )
  }

  if (typeof submissionOrCount === "number") {
    if (!Number.isInteger(submissionOrCount) || submissionOrCount < 0) {
      throw new AnalysisAuditConfirmationError(
        "invalid_accepted_count",
        "acceptedCount must be an integer >= 0",
      )
    }
    // Unverified record without submission evidence
    return {
      version: BATCH_AUDIT_CONFIRMATION_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      batchId: batch.batchId,
      batchIndex: batch.index,
      acceptedCount: submissionOrCount,
      disclaimer: legacyDisclaimer ?? BATCH_AUDIT_DISCLAIMER,
    }
  }

  if (submissionOrCount == null || typeof submissionOrCount !== "object") {
    throw new AnalysisAuditConfirmationError(
      "invalid_submission_input",
      "submission must be an object or non-negative integer",
    )
  }

  const findings = submissionOrCount.findings ?? []
  if (!Array.isArray(findings)) {
    throw new AnalysisAuditConfirmationError(
      "invalid_submission_input",
      "submission findings must be an array",
    )
  }

  const findingIds = findings.map((f) => {
    if (typeof f !== "object" || f === null || typeof f.findingId !== "string") {
      throw new AnalysisAuditConfirmationError(
        "invalid_submission_input",
        "finding in submission must have a non-empty string findingId",
      )
    }
    return f.findingId
  }).sort()

  const findingsDigest = computeBatchFindingsDigest(findingIds)
  const submissionId = computeAuditSubmissionId({
    planId,
    manuscriptFingerprint: plan.fingerprint,
    batchId: batch.batchId,
    batchIndex: batch.index,
    acceptedCount: findings.length,
    findingsDigest,
  })

  return {
    version: BATCH_AUDIT_CONFIRMATION_VERSION,
    planId,
    manuscriptFingerprint: plan.fingerprint,
    batchId: batch.batchId,
    batchIndex: batch.index,
    acceptedCount: findings.length,
    findingIds,
    findingsDigest,
    submissionId,
    disclaimer: submissionOrCount.disclaimer ?? BATCH_AUDIT_DISCLAIMER,
  }
}

/**
 * Validate a single BatchAuditConfirmation against the live plan.
 * Fail-closed on malformed shape, unknown/missing keys, or incompatibility.
 */
export function validateBatchAuditConfirmation(
  plan: ExhaustiveAnalysisPlan,
  confirmation: unknown,
): BatchAuditConfirmation {
  if (
    confirmation == null ||
    typeof confirmation !== "object" ||
    Array.isArray(confirmation)
  ) {
    throw new AnalysisAuditConfirmationError(
      "invalid_confirmation",
      "confirmation must be a JSON object",
    )
  }

  const keys = Object.keys(confirmation)
  for (const required of BATCH_AUDIT_CONFIRMATION_CORE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(confirmation, required)) {
      throw new AnalysisAuditConfirmationError(
        "invalid_confirmation",
        `confirmation is missing required key: ${required}`,
      )
    }
  }
  for (const key of keys) {
    if (!BATCH_AUDIT_CONFIRMATION_ALL_KEYS.has(key)) {
      throw new AnalysisAuditConfirmationError(
        "invalid_confirmation",
        "confirmation contains an unknown key",
      )
    }
  }

  const obj = confirmation as Record<string, unknown>

  if (obj.version !== BATCH_AUDIT_CONFIRMATION_VERSION) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_version",
      `confirmation.version must be ${BATCH_AUDIT_CONFIRMATION_VERSION}`,
    )
  }

  const expectedPlanId = computePlanIdentity(plan)
  if (typeof obj.planId !== "string" || obj.planId !== expectedPlanId) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_plan",
      "confirmation.planId does not match current plan identity",
    )
  }

  if (
    typeof obj.manuscriptFingerprint !== "string" ||
    obj.manuscriptFingerprint !== plan.fingerprint
  ) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_fingerprint",
      "confirmation.manuscriptFingerprint does not match plan fingerprint",
    )
  }

  if (typeof obj.batchId !== "string" || obj.batchId.length === 0) {
    throw new AnalysisAuditConfirmationError(
      "invalid_batch_id",
      "confirmation.batchId must be a non-empty string",
    )
  }

  if (
    typeof obj.batchIndex !== "number" ||
    !Number.isInteger(obj.batchIndex) ||
    obj.batchIndex < 0
  ) {
    throw new AnalysisAuditConfirmationError(
      "invalid_batch_index",
      "confirmation.batchIndex must be an integer >= 0",
    )
  }

  const planBatch = plan.batches[obj.batchIndex]
  if (planBatch == null || planBatch.batchId !== obj.batchId) {
    throw new AnalysisAuditConfirmationError(
      "unknown_batch",
      `confirmation batchId ${obj.batchId} does not match plan batch at index ${obj.batchIndex}`,
    )
  }

  if (
    typeof obj.acceptedCount !== "number" ||
    !Number.isInteger(obj.acceptedCount) ||
    obj.acceptedCount < 0
  ) {
    throw new AnalysisAuditConfirmationError(
      "invalid_accepted_count",
      "confirmation.acceptedCount must be an integer >= 0",
    )
  }

  if (typeof obj.disclaimer !== "string" || obj.disclaimer.length === 0) {
    throw new AnalysisAuditConfirmationError(
      "invalid_disclaimer",
      "confirmation.disclaimer must be a non-empty string",
    )
  }

  const result: BatchAuditConfirmation = {
    version: BATCH_AUDIT_CONFIRMATION_VERSION,
    planId: obj.planId,
    manuscriptFingerprint: obj.manuscriptFingerprint,
    batchId: obj.batchId,
    batchIndex: obj.batchIndex,
    acceptedCount: obj.acceptedCount,
    disclaimer: obj.disclaimer,
  }

  if (obj.findingIds !== undefined) {
    if (!Array.isArray(obj.findingIds)) {
      throw new AnalysisAuditConfirmationError(
        "invalid_confirmation",
        "confirmation.findingIds must be an array of strings",
      )
    }
    for (const id of obj.findingIds) {
      if (typeof id !== "string" || id.length === 0) {
        throw new AnalysisAuditConfirmationError(
          "invalid_confirmation",
          "confirmation.findingIds elements must be non-empty strings",
        )
      }
    }
    result.findingIds = [...obj.findingIds]
  }

  if (obj.findingsDigest !== undefined) {
    if (typeof obj.findingsDigest !== "string" || obj.findingsDigest.length === 0) {
      throw new AnalysisAuditConfirmationError(
        "invalid_confirmation",
        "confirmation.findingsDigest must be a non-empty string",
      )
    }
    result.findingsDigest = obj.findingsDigest
  }

  if (obj.submissionId !== undefined) {
    if (typeof obj.submissionId !== "string" || obj.submissionId.length === 0) {
      throw new AnalysisAuditConfirmationError(
        "invalid_confirmation",
        "confirmation.submissionId must be a non-empty string",
      )
    }
    result.submissionId = obj.submissionId
  }

  return result
}

/**
 * Verify that a batch confirmation is coherent with the validated findings in the store.
 * Fails closed if submission evidence is missing, counts differ, or digests/findingIds mismatch.
 */
export function verifyBatchConfirmationCoherence(
  confirmation: BatchAuditConfirmation,
  batchFindings: readonly AnalysisFinding[],
): void {
  if (
    typeof confirmation.submissionId !== "string" ||
    confirmation.submissionId.length === 0 ||
    typeof confirmation.findingsDigest !== "string" ||
    confirmation.findingsDigest.length === 0 ||
    !Array.isArray(confirmation.findingIds)
  ) {
    throw new AnalysisAuditConfirmationError(
      "missing_submission_evidence",
      `audit confirmation for batch ${confirmation.batchId} lacks durable submission evidence`,
    )
  }

  if (confirmation.acceptedCount !== batchFindings.length) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_batch_audit",
      `audit confirmation acceptedCount (${confirmation.acceptedCount}) does not match stored findings count (${batchFindings.length}) for batch ${confirmation.batchId}`,
    )
  }

  const expectedDigest = computeBatchFindingsDigest(batchFindings)
  if (confirmation.findingsDigest !== expectedDigest) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_batch_audit",
      `audit confirmation findingsDigest does not match stored findings digest for batch ${confirmation.batchId}`,
    )
  }

  const expectedFindingIds = batchFindings.map((f) => f.findingId).sort()
  if (confirmation.findingIds.length !== expectedFindingIds.length) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_batch_audit",
      `audit confirmation findingIds count does not match stored findings for batch ${confirmation.batchId}`,
    )
  }
  for (let i = 0; i < expectedFindingIds.length; i++) {
    if (confirmation.findingIds[i] !== expectedFindingIds[i]) {
      throw new AnalysisAuditConfirmationError(
        "incompatible_batch_audit",
        `audit confirmation findingId at index ${i} does not match stored finding for batch ${confirmation.batchId}`,
      )
    }
  }

  const expectedSubmissionId = computeAuditSubmissionId({
    planId: confirmation.planId,
    manuscriptFingerprint: confirmation.manuscriptFingerprint,
    batchId: confirmation.batchId,
    batchIndex: confirmation.batchIndex,
    acceptedCount: confirmation.acceptedCount,
    findingsDigest: confirmation.findingsDigest,
  })
  if (confirmation.submissionId !== expectedSubmissionId) {
    throw new AnalysisAuditConfirmationError(
      "incompatible_batch_audit",
      `audit confirmation submissionId is invalid for batch ${confirmation.batchId}`,
    )
  }
}

/**
 * Validate an array of confirmations against the live plan.
 * Rejects duplicate batchId or duplicate batchIndex.
 * Returns a new array sorted canonically by batchIndex.
 */
export function validateBatchAuditConfirmationsForPlan(
  plan: ExhaustiveAnalysisPlan,
  confirmations: readonly unknown[],
): BatchAuditConfirmation[] {
  if (!Array.isArray(confirmations)) {
    throw new AnalysisAuditConfirmationError(
      "invalid_confirmation_list",
      "confirmations must be an array",
    )
  }

  const validated: BatchAuditConfirmation[] = []
  const seenBatchIds = new Set<string>()
  const seenIndices = new Set<number>()

  for (const item of confirmations) {
    const c = validateBatchAuditConfirmation(plan, item)
    if (seenBatchIds.has(c.batchId)) {
      throw new AnalysisAuditConfirmationError(
        "duplicate_batch_confirmation",
        `duplicate confirmation for batchId: ${c.batchId}`,
      )
    }
    if (seenIndices.has(c.batchIndex)) {
      throw new AnalysisAuditConfirmationError(
        "duplicate_batch_confirmation",
        `duplicate confirmation for batchIndex: ${c.batchIndex}`,
      )
    }
    seenBatchIds.add(c.batchId)
    seenIndices.add(c.batchIndex)
    validated.push(c)
  }

  return validated.sort((a, b) => a.batchIndex - b.batchIndex)
}

/**
 * Verify that EVERY batch required by the plan has a valid confirmation.
 * Optionally verifies bidirectional coherence against stored findings.
 * Complete empty plan (0 batches) passes.
 */
export function assertAllBatchesConfirmed(
  plan: ExhaustiveAnalysisPlan,
  confirmations: readonly BatchAuditConfirmation[],
  storedFindings?: readonly AnalysisFinding[],
): void {
  const validated = validateBatchAuditConfirmationsForPlan(plan, confirmations)
  const confirmedMap = new Map<string, BatchAuditConfirmation>()
  for (const c of validated) {
    confirmedMap.set(c.batchId, c)
  }

  for (const batch of plan.batches) {
    const confirmation = confirmedMap.get(batch.batchId)
    if (confirmation == null) {
      throw new AnalysisAuditConfirmationError(
        "incomplete_audit_confirmation",
        `audit confirmation missing for batch: ${batch.batchId}`,
      )
    }
    if (confirmation.batchIndex !== batch.index) {
      throw new AnalysisAuditConfirmationError(
        "incompatible_batch_audit",
        `audit confirmation for batch ${batch.batchId} has inconsistent index`,
      )
    }
    if (storedFindings !== undefined) {
      const batchFindings = storedFindings.filter(
        (f) => f.batchId === batch.batchId,
      )
      verifyBatchConfirmationCoherence(confirmation, batchFindings)
    }
  }

  if (storedFindings !== undefined) {
    const validBatchIds = new Set(plan.batches.map((b) => b.batchId))
    for (let i = 0; i < storedFindings.length; i++) {
      const f = storedFindings[i]
      if (!validBatchIds.has(f.batchId)) {
        throw new AnalysisAuditConfirmationError(
          "incompatible_batch_audit",
          `findings store contains finding for unconfirmed or unknown batch: ${f.batchId}`,
        )
      }
    }
  }
}

/**
 * Upsert an incoming confirmation into an existing array.
 * Replaces any existing confirmation with matching batchId, preserving order.
 * If incoming is new, inserts and sorts by batchIndex.
 */
export function mergeBatchAuditConfirmations(
  existing: readonly BatchAuditConfirmation[],
  incoming: BatchAuditConfirmation,
): BatchAuditConfirmation[] {
  const result: BatchAuditConfirmation[] = []
  let replaced = false

  for (const c of existing) {
    if (c.batchId === incoming.batchId) {
      result.push(incoming)
      replaced = true
    } else {
      result.push(c)
    }
  }

  if (!replaced) {
    result.push(incoming)
  }

  return result.sort((a, b) => a.batchIndex - b.batchIndex)
}
