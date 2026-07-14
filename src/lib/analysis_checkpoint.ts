/**
 * Pure, versioned, deterministic checkpoint for ExhaustiveAnalysisPlan resume.
 *
 * Records which ordered batches are done and yields the next unfinished batch.
 * JSON-safe: after stringify/parse, resume lands on the same next batch.
 *
 * No I/O, OpenCode, models, tools, filesystem, clock, randomness, global state,
 * or workspace paths. Plan identity uses SHA-256 over length-prefixed fields.
 *
 * Fail-closed: incompatible, tampered, out-of-order, or unknown batch completion
 * throws. Received plan and checkpoint arguments are never mutated.
 */

import { createHash } from "node:crypto"

import type {
  ExhaustiveAnalysisBatch,
  ExhaustiveAnalysisPlan,
} from "./analysis_coverage"

/** Wire version of the checkpoint document. Bump only with a breaking change. */
export const ANALYSIS_CHECKPOINT_VERSION = "analysis-checkpoint-v1" as const

export type AnalysisCheckpointState =
  | "blocked"
  | "pending"
  | "running"
  | "complete"

/**
 * JSON-safe checkpoint for multi-batch exhaustive analysis.
 *
 * `planId` is a compact SHA-256 of the plan identity (not of progress).
 * Progress is carried by completed* counters and `state`.
 */
export interface AnalysisCheckpoint {
  version: typeof ANALYSIS_CHECKPOINT_VERSION
  planId: string
  fingerprint: string | null
  strategy: ExhaustiveAnalysisPlan["strategy"]
  totalBatches: number
  completedBatches: number
  totalCharacters: number
  completedCharacters: number
  coveragePercent: number
  state: AnalysisCheckpointState
}

export class AnalysisCheckpointError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AnalysisCheckpointError"
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

/**
 * Same two-decimal coverage percent contract as the exhaustive planner.
 * Empty complete document → 100 when emptyIsFull; blocked empty → 0.
 */
function coveragePercent(
  completedCharacters: number,
  totalCharacters: number,
  options?: { emptyIsFull?: boolean },
): number {
  if (totalCharacters === 0) {
    return options?.emptyIsFull ? 100 : 0
  }
  const rounded =
    Math.round((completedCharacters / totalCharacters) * 10000) / 100
  if (!Number.isFinite(rounded)) return 0
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

function cloneCheckpoint(checkpoint: AnalysisCheckpoint): AnalysisCheckpoint {
  return {
    version: checkpoint.version,
    planId: checkpoint.planId,
    fingerprint: checkpoint.fingerprint,
    strategy: checkpoint.strategy,
    totalBatches: checkpoint.totalBatches,
    completedBatches: checkpoint.completedBatches,
    totalCharacters: checkpoint.totalCharacters,
    completedCharacters: checkpoint.completedCharacters,
    coveragePercent: checkpoint.coveragePercent,
    state: checkpoint.state,
  }
}

function assertPlanShape(plan: ExhaustiveAnalysisPlan): void {
  if (plan == null || typeof plan !== "object") {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "plan must be an ExhaustiveAnalysisPlan object",
    )
  }
  if (plan.status !== "complete" && plan.status !== "blocked") {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      `plan.status must be "complete" or "blocked"; received ${String(plan.status)}`,
    )
  }
  // complete → non-empty string fingerprint; blocked → null only.
  if (plan.status === "complete") {
    if (typeof plan.fingerprint !== "string" || plan.fingerprint.length === 0) {
      throw new AnalysisCheckpointError(
        "invalid_plan",
        "complete plan must have a non-empty string fingerprint",
      )
    }
  } else if (plan.fingerprint !== null) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "blocked plan must have a null fingerprint",
    )
  }
  if (plan.strategy !== "ordered-source-spans-exhaustive-v1") {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      `unsupported plan.strategy: ${String(plan.strategy)}`,
    )
  }
  if (!Array.isArray(plan.batches)) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "plan.batches must be an array",
    )
  }
  if (
    plan.coverage == null ||
    typeof plan.coverage !== "object" ||
    typeof plan.coverage.totalCharacters !== "number" ||
    !Number.isInteger(plan.coverage.totalCharacters) ||
    plan.coverage.totalCharacters < 0 ||
    typeof plan.coverage.plannedCharacters !== "number" ||
    !Number.isInteger(plan.coverage.plannedCharacters) ||
    plan.coverage.plannedCharacters < 0 ||
    typeof plan.coverage.coveragePercent !== "number" ||
    !Number.isFinite(plan.coverage.coveragePercent) ||
    plan.coverage.coveragePercent < 0 ||
    plan.coverage.coveragePercent > 100 ||
    typeof plan.coverage.batchCount !== "number" ||
    !Number.isInteger(plan.coverage.batchCount) ||
    plan.coverage.batchCount < 0
  ) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "plan.coverage must expose valid totalCharacters, plannedCharacters, coveragePercent, and batchCount",
    )
  }
  if (plan.coverage.batchCount !== plan.batches.length) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "plan.coverage.batchCount must equal plan.batches.length",
    )
  }

  const seenBatchIds = new Set<string>()
  let plannedSum = 0
  for (let i = 0; i < plan.batches.length; i++) {
    const batch = plan.batches[i]
    if (
      batch == null ||
      typeof batch !== "object" ||
      typeof batch.batchId !== "string" ||
      batch.batchId.length === 0 ||
      typeof batch.characters !== "number" ||
      !Number.isInteger(batch.characters) ||
      batch.characters <= 0 ||
      batch.index !== i
    ) {
      throw new AnalysisCheckpointError(
        "invalid_plan",
        `plan.batches[${i}] is malformed`,
      )
    }
    if (seenBatchIds.has(batch.batchId)) {
      throw new AnalysisCheckpointError(
        "invalid_plan",
        `plan.batches has duplicate batchId: ${batch.batchId}`,
      )
    }
    seenBatchIds.add(batch.batchId)
    plannedSum += batch.characters
  }

  if (plan.status === "blocked") {
    // Blocked: no executable batches and no planned coverage appearance.
    // totalCharacters may remain > 0 for incomplete manuscript content.
    if (plan.batches.length !== 0 || plan.coverage.batchCount !== 0) {
      throw new AnalysisCheckpointError(
        "invalid_plan",
        "blocked plan must have zero batches",
      )
    }
    if (plan.coverage.plannedCharacters !== 0) {
      throw new AnalysisCheckpointError(
        "invalid_plan",
        "blocked plan must have plannedCharacters === 0",
      )
    }
    if (plan.coverage.coveragePercent !== 0) {
      throw new AnalysisCheckpointError(
        "invalid_plan",
        "blocked plan must have coveragePercent === 0",
      )
    }
    return
  }

  // Complete: full coverage only. Empty document ⇒ total=planned=0, no batches, 100%.
  if (plannedSum !== plan.coverage.plannedCharacters) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "sum of plan.batches[].characters must equal plan.coverage.plannedCharacters",
    )
  }
  if (plan.coverage.plannedCharacters !== plan.coverage.totalCharacters) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "complete plan requires plannedCharacters === totalCharacters",
    )
  }
  if (plan.coverage.coveragePercent !== 100) {
    throw new AnalysisCheckpointError(
      "invalid_plan",
      "complete plan requires coveragePercent === 100",
    )
  }
}

/**
 * Deterministic plan identity over stable plan fields + ordered batchIds.
 * Null fingerprint is framed as the empty string (blocked plans only).
 * Fail-closed: validates plan shape before hashing.
 */
export function computePlanIdentity(plan: ExhaustiveAnalysisPlan): string {
  assertPlanShape(plan)
  const parts: Buffer[] = []
  appendFramed(parts, ANALYSIS_CHECKPOINT_VERSION)
  appendFramed(parts, plan.status)
  appendFramed(parts, plan.fingerprint ?? "")
  appendFramed(parts, plan.strategy)
  // Total coverage snapshot (plan-level, not progress).
  appendFramed(parts, String(plan.coverage.totalCharacters))
  appendFramed(parts, String(plan.coverage.plannedCharacters))
  appendFramed(parts, String(plan.coverage.coveragePercent))
  appendFramed(parts, String(plan.coverage.batchCount))
  for (const batch of plan.batches) {
    appendFramed(parts, batch.batchId)
  }
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex")
}

function expectedCompletedCharacters(
  plan: ExhaustiveAnalysisPlan,
  completedBatches: number,
): number {
  let total = 0
  for (let i = 0; i < completedBatches; i++) {
    total += plan.batches[i].characters
  }
  return total
}

function expectedState(
  plan: ExhaustiveAnalysisPlan,
  completedBatches: number,
): AnalysisCheckpointState {
  if (plan.status === "blocked") return "blocked"
  if (plan.batches.length === 0) return "complete"
  if (completedBatches <= 0) return "pending"
  if (completedBatches >= plan.batches.length) return "complete"
  return "running"
}

function expectedCoveragePercent(
  plan: ExhaustiveAnalysisPlan,
  completedCharacters: number,
): number {
  if (plan.status === "blocked") {
    return 0
  }
  return coveragePercent(completedCharacters, plan.coverage.totalCharacters, {
    emptyIsFull: true,
  })
}

/**
 * Runtime-validate checkpoint shape and exact compatibility with `plan`.
 * Fail-closed on version, planId, counters, percent, or state drift.
 */
function assertCompatibleCheckpoint(
  plan: ExhaustiveAnalysisPlan,
  checkpoint: AnalysisCheckpoint,
): void {
  if (checkpoint == null || typeof checkpoint !== "object") {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint must be an AnalysisCheckpoint object",
    )
  }
  if (checkpoint.version !== ANALYSIS_CHECKPOINT_VERSION) {
    throw new AnalysisCheckpointError(
      "incompatible_version",
      `checkpoint.version must be ${ANALYSIS_CHECKPOINT_VERSION}; received ${String(checkpoint.version)}`,
    )
  }
  if (typeof checkpoint.planId !== "string" || checkpoint.planId.length === 0) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint.planId must be a non-empty string",
    )
  }
  if (
    checkpoint.fingerprint !== null &&
    (typeof checkpoint.fingerprint !== "string" ||
      checkpoint.fingerprint.length === 0)
  ) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint.fingerprint must be a non-empty string or null",
    )
  }
  if (
    typeof checkpoint.totalBatches !== "number" ||
    !Number.isInteger(checkpoint.totalBatches) ||
    checkpoint.totalBatches < 0 ||
    typeof checkpoint.completedBatches !== "number" ||
    !Number.isInteger(checkpoint.completedBatches) ||
    checkpoint.completedBatches < 0 ||
    typeof checkpoint.totalCharacters !== "number" ||
    !Number.isInteger(checkpoint.totalCharacters) ||
    checkpoint.totalCharacters < 0 ||
    typeof checkpoint.completedCharacters !== "number" ||
    !Number.isInteger(checkpoint.completedCharacters) ||
    checkpoint.completedCharacters < 0 ||
    typeof checkpoint.coveragePercent !== "number" ||
    !Number.isFinite(checkpoint.coveragePercent) ||
    checkpoint.coveragePercent < 0 ||
    checkpoint.coveragePercent > 100 ||
    typeof checkpoint.strategy !== "string" ||
    (checkpoint.state !== "blocked" &&
      checkpoint.state !== "pending" &&
      checkpoint.state !== "running" &&
      checkpoint.state !== "complete")
  ) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint counters, strategy, or state are malformed",
    )
  }

  const expectedPlanId = computePlanIdentity(plan)
  if (checkpoint.planId !== expectedPlanId) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.planId does not match the current ExhaustiveAnalysisPlan identity",
    )
  }
  if (checkpoint.fingerprint !== plan.fingerprint) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.fingerprint does not match the plan fingerprint",
    )
  }
  if (checkpoint.strategy !== plan.strategy) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.strategy does not match the plan strategy",
    )
  }
  if (checkpoint.totalBatches !== plan.batches.length) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.totalBatches does not match plan.batches.length",
    )
  }
  if (checkpoint.totalCharacters !== plan.coverage.totalCharacters) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.totalCharacters does not match plan.coverage.totalCharacters",
    )
  }
  if (checkpoint.completedBatches > checkpoint.totalBatches) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint.completedBatches exceeds totalBatches",
    )
  }

  const expectedChars = expectedCompletedCharacters(
    plan,
    checkpoint.completedBatches,
  )
  if (checkpoint.completedCharacters !== expectedChars) {
    throw new AnalysisCheckpointError(
      "tampered_checkpoint",
      "checkpoint.completedCharacters is inconsistent with completed batches",
    )
  }

  const expectedPercent = expectedCoveragePercent(plan, expectedChars)
  if (checkpoint.coveragePercent !== expectedPercent) {
    throw new AnalysisCheckpointError(
      "tampered_checkpoint",
      "checkpoint.coveragePercent is inconsistent with completed progress",
    )
  }

  const expected = expectedState(plan, checkpoint.completedBatches)
  if (checkpoint.state !== expected) {
    throw new AnalysisCheckpointError(
      "tampered_checkpoint",
      `checkpoint.state must be "${expected}" for the recorded progress; received "${checkpoint.state}"`,
    )
  }

  if (plan.status === "blocked" && checkpoint.state !== "blocked") {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "blocked plan requires checkpoint.state === \"blocked\"",
    )
  }
}

/**
 * Create the initial checkpoint for a plan.
 * - blocked plan → blocked (no executable batch, no full-coverage appearance)
 * - complete empty plan → complete
 * - complete non-empty plan → pending (resume at batch index 0)
 */
export function createAnalysisCheckpoint(
  plan: ExhaustiveAnalysisPlan,
): AnalysisCheckpoint {
  assertPlanShape(plan)

  const planId = computePlanIdentity(plan)
  const totalBatches = plan.batches.length
  const totalCharacters = plan.coverage.totalCharacters

  if (plan.status === "blocked") {
    return {
      version: ANALYSIS_CHECKPOINT_VERSION,
      planId,
      fingerprint: plan.fingerprint,
      strategy: plan.strategy,
      totalBatches: 0,
      completedBatches: 0,
      totalCharacters,
      completedCharacters: 0,
      coveragePercent: 0,
      state: "blocked",
    }
  }

  if (totalBatches === 0) {
    return {
      version: ANALYSIS_CHECKPOINT_VERSION,
      planId,
      fingerprint: plan.fingerprint,
      strategy: plan.strategy,
      totalBatches: 0,
      completedBatches: 0,
      totalCharacters,
      completedCharacters: 0,
      coveragePercent: coveragePercent(0, totalCharacters, { emptyIsFull: true }),
      state: "complete",
    }
  }

  return {
    version: ANALYSIS_CHECKPOINT_VERSION,
    planId,
    fingerprint: plan.fingerprint,
    strategy: plan.strategy,
    totalBatches,
    completedBatches: 0,
    totalCharacters,
    completedCharacters: 0,
    coveragePercent: coveragePercent(0, totalCharacters, { emptyIsFull: true }),
    state: "pending",
  }
}

/**
 * Return the next unfinished batch, or null when blocked/complete.
 * Validates checkpoint structure and exact plan compatibility at runtime.
 */
export function nextAnalysisBatch(
  plan: ExhaustiveAnalysisPlan,
  checkpoint: AnalysisCheckpoint,
): ExhaustiveAnalysisBatch | null {
  assertPlanShape(plan)
  assertCompatibleCheckpoint(plan, checkpoint)

  if (checkpoint.state === "blocked" || checkpoint.state === "complete") {
    return null
  }

  const index = checkpoint.completedBatches
  if (index < 0 || index >= plan.batches.length) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint.completedBatches is out of range for next batch",
    )
  }
  return plan.batches[index]
}

/**
 * Mark `batchId` complete and return a new checkpoint.
 * - Only the expected next batch advances state.
 * - Re-completing an already completed batch is idempotent (returns equal values).
 * - Unknown or out-of-order batchIds fail controlled.
 * Never mutates `plan` or `checkpoint`.
 */
export function completeAnalysisBatch(
  plan: ExhaustiveAnalysisPlan,
  checkpoint: AnalysisCheckpoint,
  batchId: string,
): AnalysisCheckpoint {
  assertPlanShape(plan)
  assertCompatibleCheckpoint(plan, checkpoint)

  if (typeof batchId !== "string" || batchId.length === 0) {
    throw new AnalysisCheckpointError(
      "invalid_batch_id",
      "batchId must be a non-empty string",
    )
  }

  if (checkpoint.state === "blocked") {
    throw new AnalysisCheckpointError(
      "blocked_plan",
      "cannot complete a batch on a blocked plan checkpoint",
    )
  }

  if (checkpoint.state === "complete") {
    // Idempotent only if the batch was part of this plan and already finished.
    const knownIndex = plan.batches.findIndex((b) => b.batchId === batchId)
    if (knownIndex === -1) {
      throw new AnalysisCheckpointError(
        "unknown_batch",
        `batchId is not part of the plan: ${batchId}`,
      )
    }
    return cloneCheckpoint(checkpoint)
  }

  const batchIndex = plan.batches.findIndex((b) => b.batchId === batchId)
  if (batchIndex === -1) {
    throw new AnalysisCheckpointError(
      "unknown_batch",
      `batchId is not part of the plan: ${batchId}`,
    )
  }

  // Already completed: idempotent no-op (new object, equal values).
  if (batchIndex < checkpoint.completedBatches) {
    return cloneCheckpoint(checkpoint)
  }

  // Only the strict next batch may advance.
  if (batchIndex !== checkpoint.completedBatches) {
    throw new AnalysisCheckpointError(
      "out_of_order",
      `expected batch index ${checkpoint.completedBatches}, got index ${batchIndex}`,
    )
  }

  const batch = plan.batches[batchIndex]
  const completedBatches = checkpoint.completedBatches + 1
  const completedCharacters =
    checkpoint.completedCharacters + batch.characters
  const state = expectedState(plan, completedBatches)
  const percent = expectedCoveragePercent(plan, completedCharacters)

  return {
    version: ANALYSIS_CHECKPOINT_VERSION,
    planId: checkpoint.planId,
    fingerprint: checkpoint.fingerprint,
    strategy: checkpoint.strategy,
    totalBatches: checkpoint.totalBatches,
    completedBatches,
    totalCharacters: checkpoint.totalCharacters,
    completedCharacters,
    coveragePercent: percent,
    state,
  }
}
