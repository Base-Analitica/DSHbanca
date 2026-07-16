/**
 * Pure, versioned global analysis synthesis input gated on complete coverage.
 * Deterministic JSON-safe input for a future synthesis step only when a
 * compatible checkpoint reports full coverage. No filesystem, OpenCode, models,
 * tools, clock, randomness, scoring, or semantic synthesis.
 */

import {
  AnalysisCheckpointError,
  nextAnalysisBatch,
  type AnalysisCheckpoint,
} from "./analysis_checkpoint"
import type { ExhaustiveAnalysisPlan } from "./analysis_coverage"
import {
  AnalysisFindingError,
  validateAnalysisFindingsForPlan,
  type AnalysisFinding,
} from "./analysis_findings"

export const GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION =
  "global-analysis-synthesis-input-v1" as const

export interface GlobalAnalysisSynthesisInputV1 {
  version: typeof GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION
  planId: string
  manuscriptFingerprint: string
  coverage: {
    state: "complete"
    totalBatches: number
    completedBatches: number
    totalCharacters: number
    completedCharacters: number
    coveragePercent: 100
    orderedBatchIds: string[]
  }
  findings: AnalysisFinding[]
}

export class AnalysisSynthesisError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "AnalysisSynthesisError"
    this.code = code
  }
}

function fail(code: string, message: string): never {
  throw new AnalysisSynthesisError(code, message)
}

/** Map checkpoint primitive errors to controlled public synthesis codes. */
function mapCheckpointError(err: unknown): never {
  if (err instanceof AnalysisCheckpointError) {
    if (err.code === "incompatible_plan" || err.code === "incompatible_version") {
      fail(err.code, "checkpoint is not compatible with the live plan")
    }
    if (err.code === "tampered_checkpoint") {
      fail(
        "tampered_checkpoint",
        "checkpoint progress is inconsistent with the live plan",
      )
    }
    if (err.code === "invalid_plan") {
      fail("invalid_plan", "plan identity could not be validated for synthesis")
    }
    if (err.code === "invalid_checkpoint") {
      fail(
        "invalid_checkpoint",
        "checkpoint is invalid or incompatible with the live plan",
      )
    }
  }
  throw err
}

/**
 * Build deterministic global synthesis input when coverage is complete.
 * Uses `nextAnalysisBatch` as the canonical plan/checkpoint integrity check;
 * after success, `checkpoint.planId` is the validated identity. Revalidates
 * findings; clones only; never mutates inputs. Controlled errors never echo
 * claim/evidence/path-like payload text. Unexpected errors are not masked.
 */
export function createGlobalAnalysisSynthesisInput(
  plan: ExhaustiveAnalysisPlan,
  checkpoint: AnalysisCheckpoint,
  findings: readonly AnalysisFinding[],
): GlobalAnalysisSynthesisInputV1 {
  let nextBatch: ReturnType<typeof nextAnalysisBatch>
  try {
    nextBatch = nextAnalysisBatch(plan, checkpoint)
  } catch (err) {
    mapCheckpointError(err)
  }

  if (plan.status === "blocked" || checkpoint.state === "blocked") {
    fail("blocked_plan", "cannot build global synthesis input for a blocked plan")
  }

  // Counters, fingerprint, and compatibility already enforced by nextAnalysisBatch.
  if (checkpoint.state !== "complete" || nextBatch !== null) {
    fail(
      "incomplete_coverage",
      checkpoint.state !== "complete"
        ? `global synthesis requires checkpoint.state === "complete"; received "${checkpoint.state}"`
        : "global synthesis requires every plan batch to be complete",
    )
  }

  let validatedFindings: AnalysisFinding[]
  try {
    validatedFindings = validateAnalysisFindingsForPlan(plan, findings)
  } catch (err) {
    if (err instanceof AnalysisFindingError) {
      fail(
        "invalid_findings",
        "findings are invalid or incompatible with the live plan",
      )
    }
    throw err
  }

  return {
    version: GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION,
    planId: checkpoint.planId,
    manuscriptFingerprint: plan.fingerprint as string,
    coverage: {
      state: "complete",
      totalBatches: checkpoint.totalBatches,
      completedBatches: checkpoint.completedBatches,
      totalCharacters: checkpoint.totalCharacters,
      completedCharacters: checkpoint.completedCharacters,
      coveragePercent: 100,
      orderedBatchIds: plan.batches.map((b) => b.batchId),
    },
    findings: validatedFindings,
  }
}
