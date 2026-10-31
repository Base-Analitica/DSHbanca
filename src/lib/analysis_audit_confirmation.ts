/**
 * Pure, versioned BatchAuditConfirmation contract for ExhaustiveAnalysisPlan batches.
 *
 * Binds durable audit evidence to planId, manuscriptFingerprint, batchId,
 * canonical batchIndex, and structurally validated acceptedCount.
 *
 * No filesystem, I/O, models, tools, clocks, or randomness.
 * Fail-closed on invalid, missing, tampered, or mismatched fields.
 */

import { computePlanIdentity } from "./analysis_checkpoint"
import type {
  ExhaustiveAnalysisBatch,
  ExhaustiveAnalysisPlan,
} from "./analysis_coverage"

/** Wire version of the batch audit confirmation record. */
export const BATCH_AUDIT_CONFIRMATION_VERSION =
  "batch-audit-confirmation-v1" as const

/** Disclaimer: confirmation proves only structural submission, never inference or grade. */
export const BATCH_AUDIT_DISCLAIMER =
  "Structural validation confirmation for one canonical plan batch. Does not prove model execution, semantic inference, or academic grade." as const

/** Exact key set for batch-audit-confirmation-v1. */
const BATCH_AUDIT_CONFIRMATION_KEYS = [
  "version",
  "planId",
  "manuscriptFingerprint",
  "batchId",
  "batchIndex",
  "acceptedCount",
  "disclaimer",
] as const

const BATCH_AUDIT_CONFIRMATION_KEY_SET = new Set<string>(
  BATCH_AUDIT_CONFIRMATION_KEYS,
)

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

/**
 * Create a new BatchAuditConfirmation for a canonical plan batch.
 * Validates plan status, batch membership, index, and non-negative count.
 */
export function createBatchAuditConfirmation(
  plan: ExhaustiveAnalysisPlan,
  batch: ExhaustiveAnalysisBatch,
  acceptedCount: number,
  disclaimer?: string,
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

  if (
    typeof acceptedCount !== "number" ||
    !Number.isInteger(acceptedCount) ||
    acceptedCount < 0
  ) {
    throw new AnalysisAuditConfirmationError(
      "invalid_accepted_count",
      "acceptedCount must be an integer >= 0",
    )
  }

  return {
    version: BATCH_AUDIT_CONFIRMATION_VERSION,
    planId,
    manuscriptFingerprint: plan.fingerprint,
    batchId: batch.batchId,
    batchIndex: batch.index,
    acceptedCount,
    disclaimer: disclaimer ?? BATCH_AUDIT_DISCLAIMER,
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
  if (keys.length !== BATCH_AUDIT_CONFIRMATION_KEY_SET.size) {
    throw new AnalysisAuditConfirmationError(
      "invalid_confirmation",
      `confirmation must have exactly ${BATCH_AUDIT_CONFIRMATION_KEY_SET.size} keys`,
    )
  }
  for (const key of keys) {
    if (!BATCH_AUDIT_CONFIRMATION_KEY_SET.has(key)) {
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

  return {
    version: BATCH_AUDIT_CONFIRMATION_VERSION,
    planId: obj.planId,
    manuscriptFingerprint: obj.manuscriptFingerprint,
    batchId: obj.batchId,
    batchIndex: obj.batchIndex,
    acceptedCount: obj.acceptedCount,
    disclaimer: obj.disclaimer,
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
 * Complete empty plan (0 batches) passes.
 */
export function assertAllBatchesConfirmed(
  plan: ExhaustiveAnalysisPlan,
  confirmations: readonly BatchAuditConfirmation[],
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
