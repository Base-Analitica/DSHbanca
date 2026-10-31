import { describe, test, expect } from "bun:test"
import {
  BATCH_AUDIT_CONFIRMATION_VERSION,
  BATCH_AUDIT_DISCLAIMER,
  AnalysisAuditConfirmationError,
  createBatchAuditConfirmation,
  validateBatchAuditConfirmation,
  validateBatchAuditConfirmationsForPlan,
  assertAllBatchesConfirmed,
  mergeBatchAuditConfirmations,
  type BatchAuditConfirmation,
} from "../src/lib/analysis_audit_confirmation"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint"
import type { ExhaustiveAnalysisPlan } from "../src/lib/analysis_coverage"

function createSyntheticPlan(opts?: {
  batchCount?: number
  charactersPerBatch?: number
  fingerprint?: string
}): ExhaustiveAnalysisPlan {
  const batchCount = opts?.batchCount ?? 2
  const chars = opts?.charactersPerBatch ?? 100
  const fingerprint = opts?.fingerprint ?? "a".repeat(64)
  const batches = []
  let globalChunkIndex = 0

  for (let i = 0; i < batchCount; i++) {
    const text = "x".repeat(chars)
    const chunk = {
      index: globalChunkIndex++,
      text,
      source: {
        file: `chapter_${i}.tex`,
        startLine: 1,
        endLine: 10,
        sourceSpanIndex: 0,
        startOffset: 0,
        endOffset: chars,
      },
    }
    batches.push({
      batchId: `batch-id-${i}`,
      index: i,
      characters: chars,
      chunks: [chunk],
    })
  }

  const totalCharacters = batchCount * chars
  return {
    status: "complete",
    strategy: "ordered-source-spans-exhaustive-v1",
    fingerprint,
    diagnostics: [],
    coverage: {
      totalCharacters,
      plannedCharacters: totalCharacters,
      coveragePercent: 100,
      batchCount,
    },
    batches,
  }
}

describe("analysis_audit_confirmation — pure contract", () => {
  test("createBatchAuditConfirmation produces exact versioned record", () => {
    const plan = createSyntheticPlan()
    const confirmation = createBatchAuditConfirmation(plan, plan.batches[0], 5)

    expect(confirmation.version).toBe(BATCH_AUDIT_CONFIRMATION_VERSION)
    expect(confirmation.planId).toBe(computePlanIdentity(plan))
    expect(confirmation.manuscriptFingerprint).toBe(plan.fingerprint!)
    expect(confirmation.batchId).toBe("batch-id-0")
    expect(confirmation.batchIndex).toBe(0)
    expect(confirmation.acceptedCount).toBe(5)
    expect(confirmation.disclaimer).toBe(BATCH_AUDIT_DISCLAIMER)
  })

  test("zero findings is valid and distinct from absence", () => {
    const plan = createSyntheticPlan()
    const confirmation = createBatchAuditConfirmation(plan, plan.batches[0], 0)
    expect(confirmation.acceptedCount).toBe(0)
    expect(confirmation.batchId).toBe("batch-id-0")
  })

  test("createBatchAuditConfirmation rejects blocked plan", () => {
    const plan: ExhaustiveAnalysisPlan = {
      status: "blocked",
      strategy: "ordered-source-spans-exhaustive-v1",
      fingerprint: null,
      diagnostics: [{ code: "missing_file", message: "blocked" }],
      coverage: {
        totalCharacters: 10,
        plannedCharacters: 0,
        coveragePercent: 0,
        batchCount: 0,
      },
      batches: [],
    }
    expect(() =>
      createBatchAuditConfirmation(
        plan,
        { batchId: "b0", index: 0, characters: 10, chunks: [] },
        0,
      ),
    ).toThrow(AnalysisAuditConfirmationError)
  })

  test("createBatchAuditConfirmation rejects negative acceptedCount", () => {
    const plan = createSyntheticPlan()
    expect(() =>
      createBatchAuditConfirmation(plan, plan.batches[0], -1),
    ).toThrow(AnalysisAuditConfirmationError)
  })

  test("validateBatchAuditConfirmation rejects tampered fields", () => {
    const plan = createSyntheticPlan()
    const valid = createBatchAuditConfirmation(plan, plan.batches[0], 1)

    // Wrong version
    expect(() =>
      validateBatchAuditConfirmation(plan, { ...valid, version: "v99" }),
    ).toThrow(AnalysisAuditConfirmationError)

    // Wrong planId
    expect(() =>
      validateBatchAuditConfirmation(plan, { ...valid, planId: "b".repeat(64) }),
    ).toThrow(AnalysisAuditConfirmationError)

    // Wrong fingerprint
    expect(() =>
      validateBatchAuditConfirmation(plan, {
        ...valid,
        manuscriptFingerprint: "c".repeat(64),
      }),
    ).toThrow(AnalysisAuditConfirmationError)

    // Unknown batchId
    expect(() =>
      validateBatchAuditConfirmation(plan, {
        ...valid,
        batchId: "nonexistent",
      }),
    ).toThrow(AnalysisAuditConfirmationError)

    // Wrong index
    expect(() =>
      validateBatchAuditConfirmation(plan, {
        ...valid,
        batchIndex: 99,
      }),
    ).toThrow(AnalysisAuditConfirmationError)

    // Negative count
    expect(() =>
      validateBatchAuditConfirmation(plan, {
        ...valid,
        acceptedCount: -5,
      }),
    ).toThrow(AnalysisAuditConfirmationError)

    // Extra unknown key
    expect(() =>
      validateBatchAuditConfirmation(plan, {
        ...valid,
        extraKey: "illegal",
      }),
    ).toThrow(AnalysisAuditConfirmationError)
  })

  test("validateBatchAuditConfirmationsForPlan rejects duplicates", () => {
    const plan = createSyntheticPlan({ batchCount: 2 })
    const c0 = createBatchAuditConfirmation(plan, plan.batches[0], 1)
    const c0Dup = createBatchAuditConfirmation(plan, plan.batches[0], 2)

    expect(() =>
      validateBatchAuditConfirmationsForPlan(plan, [c0, c0Dup]),
    ).toThrow(AnalysisAuditConfirmationError)
  })

  test("mergeBatchAuditConfirmations updates existing without duplicating", () => {
    const plan = createSyntheticPlan({ batchCount: 2 })
    const c0 = createBatchAuditConfirmation(plan, plan.batches[0], 1)
    const c1 = createBatchAuditConfirmation(plan, plan.batches[1], 2)

    const initial = [c0, c1]
    const c0Updated = createBatchAuditConfirmation(plan, plan.batches[0], 5)

    const merged = mergeBatchAuditConfirmations(initial, c0Updated)
    expect(merged.length).toBe(2)
    expect(merged[0].acceptedCount).toBe(5)
    expect(merged[1].acceptedCount).toBe(2)
  })

  test("assertAllBatchesConfirmed fails when any batch is unconfirmed", () => {
    const plan = createSyntheticPlan({ batchCount: 3 })
    const c0 = createBatchAuditConfirmation(plan, plan.batches[0], 0)
    const c1 = createBatchAuditConfirmation(plan, plan.batches[1], 0)

    // Missing batch 2
    expect(() => assertAllBatchesConfirmed(plan, [c0, c1])).toThrow(
      AnalysisAuditConfirmationError,
    )

    // All present succeeds
    const c2 = createBatchAuditConfirmation(plan, plan.batches[2], 0)
    expect(() => assertAllBatchesConfirmed(plan, [c0, c1, c2])).not.toThrow()
  })

  test("assertAllBatchesConfirmed succeeds on empty plan (0 batches)", () => {
    const emptyPlan: ExhaustiveAnalysisPlan = {
      status: "complete",
      strategy: "ordered-source-spans-exhaustive-v1",
      fingerprint: "e".repeat(64),
      diagnostics: [],
      coverage: {
        totalCharacters: 0,
        plannedCharacters: 0,
        coveragePercent: 100,
        batchCount: 0,
      },
      batches: [],
    }

    expect(() => assertAllBatchesConfirmed(emptyPlan, [])).not.toThrow()
  })
})
