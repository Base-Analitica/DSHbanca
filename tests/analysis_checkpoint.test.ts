import { describe, test, expect } from "bun:test"
import {
  ANALYSIS_CHECKPOINT_VERSION,
  AnalysisCheckpointError,
  completeAnalysisBatch,
  computePlanIdentity,
  createAnalysisCheckpoint,
  nextAnalysisBatch,
  type AnalysisCheckpoint,
} from "../src/lib/analysis_checkpoint"
import {
  planExhaustiveAnalysisBatches,
  type ExhaustiveAnalysisPlan,
} from "../src/lib/analysis_coverage"
import type {
  CanonicalLatexManuscriptResult,
  LoaderDiagnostic,
  SourceSpan,
} from "../src/lib/latex_loader"

const FP = "a".repeat(64)
const VERSION = "openbanca-manuscript-v1"

function span(
  file: string,
  text: string,
  startLine = 1,
  endLine?: number,
): SourceSpan {
  return {
    file,
    startLine,
    endLine: endLine ?? startLine,
    text,
  }
}

function manuscript(
  orderedSources: SourceSpan[],
  opts?: {
    complete?: boolean
    fingerprint?: string | null
    diagnostics?: LoaderDiagnostic[]
  },
): CanonicalLatexManuscriptResult {
  const complete = opts?.complete ?? true
  const fingerprint =
    opts && "fingerprint" in opts
      ? opts.fingerprint!
      : complete
        ? FP
        : null
  return {
    rootFile: "main.tex",
    orderedSources,
    diagnostics: opts?.diagnostics ?? [],
    complete,
    fingerprint,
    fingerprintVersion: VERSION,
  }
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function threeBatchPlan(): ExhaustiveAnalysisPlan {
  // total 10 chars, budget 4 → batches of 4, 4, 2 (same fixture as coverage tests)
  return planExhaustiveAnalysisBatches(
    manuscript([
      span("one.tex", "abc"),
      span("two.tex", "defg"),
      span("three.tex", "hij"),
    ]),
    4,
  )
}

describe("createAnalysisCheckpoint", () => {
  test("multi-batch plan starts pending and next is index 0", () => {
    const plan = threeBatchPlan()
    expect(plan.batches).toHaveLength(3)

    const cp = createAnalysisCheckpoint(plan)

    expect(cp.version).toBe(ANALYSIS_CHECKPOINT_VERSION)
    expect(cp.state).toBe("pending")
    expect(cp.completedBatches).toBe(0)
    expect(cp.totalBatches).toBe(3)
    expect(cp.completedCharacters).toBe(0)
    expect(cp.totalCharacters).toBe(10)
    expect(cp.coveragePercent).toBe(0)
    expect(cp.fingerprint).toBe(FP)
    expect(cp.strategy).toBe("ordered-source-spans-exhaustive-v1")
    expect(cp.planId).toBe(computePlanIdentity(plan))

    const next = nextAnalysisBatch(plan, cp)
    expect(next).not.toBeNull()
    expect(next!.index).toBe(0)
    expect(next!.batchId).toBe(plan.batches[0].batchId)
  })

  test("blocked plan never yields an executable batch or full coverage appearance", () => {
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "partial")], {
        complete: false,
        fingerprint: null,
        diagnostics: [
          {
            code: "include_not_found",
            severity: "error",
            message: "missing",
          },
        ],
      }),
      4,
    )
    expect(plan.status).toBe("blocked")

    const cp = createAnalysisCheckpoint(plan)

    expect(cp.state).toBe("blocked")
    expect(cp.fingerprint).toBeNull()
    expect(cp.totalBatches).toBe(0)
    expect(cp.completedBatches).toBe(0)
    expect(cp.completedCharacters).toBe(0)
    expect(cp.coveragePercent).toBe(0)
    expect(nextAnalysisBatch(plan, cp)).toBeNull()
    expect(() =>
      completeAnalysisBatch(plan, cp, "any-id"),
    ).toThrow(AnalysisCheckpointError)
  })

  test("complete empty plan starts complete with 100% coverage", () => {
    const plan = planExhaustiveAnalysisBatches(manuscript([]), 1)
    expect(plan.status).toBe("complete")
    expect(plan.batches).toEqual([])

    const cp = createAnalysisCheckpoint(plan)

    expect(cp.state).toBe("complete")
    expect(cp.totalBatches).toBe(0)
    expect(cp.completedBatches).toBe(0)
    expect(cp.totalCharacters).toBe(0)
    expect(cp.completedCharacters).toBe(0)
    expect(cp.coveragePercent).toBe(100)
    expect(cp.fingerprint).toBe(FP)
    expect(nextAnalysisBatch(plan, cp)).toBeNull()
  })
})

describe("completeAnalysisBatch progression", () => {
  test("three-batch plan progresses fully to complete at 100%", () => {
    const plan = threeBatchPlan()
    let cp = createAnalysisCheckpoint(plan)

    expect(nextAnalysisBatch(plan, cp)?.batchId).toBe(plan.batches[0].batchId)

    cp = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)
    expect(cp.state).toBe("running")
    expect(cp.completedBatches).toBe(1)
    expect(cp.completedCharacters).toBe(plan.batches[0].characters)
    expect(cp.coveragePercent).toBe(40)
    expect(nextAnalysisBatch(plan, cp)?.batchId).toBe(plan.batches[1].batchId)

    cp = completeAnalysisBatch(plan, cp, plan.batches[1].batchId)
    expect(cp.state).toBe("running")
    expect(cp.completedBatches).toBe(2)
    expect(cp.completedCharacters).toBe(
      plan.batches[0].characters + plan.batches[1].characters,
    )
    expect(cp.coveragePercent).toBe(80)
    expect(nextAnalysisBatch(plan, cp)?.batchId).toBe(plan.batches[2].batchId)

    cp = completeAnalysisBatch(plan, cp, plan.batches[2].batchId)
    expect(cp.state).toBe("complete")
    expect(cp.completedBatches).toBe(3)
    expect(cp.completedCharacters).toBe(10)
    expect(cp.coveragePercent).toBe(100)
    expect(nextAnalysisBatch(plan, cp)).toBeNull()
  })

  test("JSON roundtrip preserves exact resume position", () => {
    const plan = threeBatchPlan()
    let cp = createAnalysisCheckpoint(plan)
    cp = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)

    const restored = JSON.parse(JSON.stringify(cp)) as AnalysisCheckpoint
    expect(restored).toEqual(cp)

    const nextBefore = nextAnalysisBatch(plan, cp)
    const nextAfter = nextAnalysisBatch(plan, restored)
    expect(nextAfter?.batchId).toBe(plan.batches[1].batchId)
    expect(nextAfter?.batchId).toBe(nextBefore?.batchId)
    expect(nextAfter?.index).toBe(1)

    const advanced = completeAnalysisBatch(
      plan,
      restored,
      plan.batches[1].batchId,
    )
    expect(advanced.completedBatches).toBe(2)
    expect(nextAnalysisBatch(plan, advanced)?.batchId).toBe(
      plan.batches[2].batchId,
    )
  })

  test("re-completing an already finished batch is idempotent", () => {
    const plan = threeBatchPlan()
    let cp = createAnalysisCheckpoint(plan)
    cp = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)
    const afterFirst = deepCloneJson(cp)

    const again = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)
    expect(again).toEqual(afterFirst)
    expect(again).not.toBe(cp)
    expect(cp).toEqual(afterFirst)

    // After full completion, re-completing any finished batch is still a no-op.
    cp = completeAnalysisBatch(plan, cp, plan.batches[1].batchId)
    cp = completeAnalysisBatch(plan, cp, plan.batches[2].batchId)
    expect(cp.state).toBe("complete")
    const snapshot = deepCloneJson(cp)
    const reCompleteLast = completeAnalysisBatch(
      plan,
      cp,
      plan.batches[2].batchId,
    )
    const reCompleteFirst = completeAnalysisBatch(
      plan,
      cp,
      plan.batches[0].batchId,
    )
    expect(reCompleteLast).toEqual(snapshot)
    expect(reCompleteFirst).toEqual(snapshot)
  })

  test("out-of-order future batch fails controlled and does not advance", () => {
    const plan = threeBatchPlan()
    const cp = createAnalysisCheckpoint(plan)
    const before = deepCloneJson(cp)

    expect(() =>
      completeAnalysisBatch(plan, cp, plan.batches[1].batchId),
    ).toThrow(AnalysisCheckpointError)
    expect(() =>
      completeAnalysisBatch(plan, cp, plan.batches[1].batchId),
    ).toThrow(/expected batch index 0/)

    expect(cp).toEqual(before)
    expect(nextAnalysisBatch(plan, cp)?.batchId).toBe(plan.batches[0].batchId)
  })

  test("unknown batchId fails controlled", () => {
    const plan = threeBatchPlan()
    const cp = createAnalysisCheckpoint(plan)

    expect(() =>
      completeAnalysisBatch(plan, cp, "not-a-real-batch-id"),
    ).toThrow(AnalysisCheckpointError)
    expect(() =>
      completeAnalysisBatch(plan, cp, "not-a-real-batch-id"),
    ).toThrow(/not part of the plan/)
  })
})

describe("checkpoint validation / fail-closed", () => {
  test("tampered version, counters, or percent are rejected", () => {
    const plan = threeBatchPlan()
    const base = createAnalysisCheckpoint(plan)

    const badVersion = { ...base, version: "analysis-checkpoint-v0" as const }
    expect(() =>
      nextAnalysisBatch(plan, badVersion as unknown as AnalysisCheckpoint),
    ).toThrow(AnalysisCheckpointError)
    expect(() =>
      nextAnalysisBatch(plan, badVersion as unknown as AnalysisCheckpoint),
    ).toThrow(/version/)

    const badCounters = { ...base, completedBatches: 1 }
    expect(() => nextAnalysisBatch(plan, badCounters)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => nextAnalysisBatch(plan, badCounters)).toThrow(
      /completedCharacters|state|tampered/i,
    )

    const badPercent = {
      ...base,
      completedBatches: 1,
      completedCharacters: plan.batches[0].characters,
      coveragePercent: 99.99,
      state: "running" as const,
    }
    expect(() => nextAnalysisBatch(plan, badPercent)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => nextAnalysisBatch(plan, badPercent)).toThrow(
      /coveragePercent/i,
    )

    const badPlanId = { ...base, planId: "0".repeat(64) }
    expect(() => nextAnalysisBatch(plan, badPlanId)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => nextAnalysisBatch(plan, badPlanId)).toThrow(/planId/)

    // completeAnalysisBatch also rejects tampered input without advancing.
    expect(() =>
      completeAnalysisBatch(
        plan,
        badPercent,
        plan.batches[1].batchId,
      ),
    ).toThrow(AnalysisCheckpointError)
  })

  test("same fingerprint with different budget/batch sequence is incompatible", () => {
    const ms = manuscript([
      span("one.tex", "abc"),
      span("two.tex", "defg"),
      span("three.tex", "hij"),
    ])
    const planA = planExhaustiveAnalysisBatches(ms, 4)
    const planB = planExhaustiveAnalysisBatches(ms, 3)

    expect(planA.fingerprint).toBe(planB.fingerprint)
    expect(planA.batches.map((b) => b.batchId)).not.toEqual(
      planB.batches.map((b) => b.batchId),
    )
    expect(computePlanIdentity(planA)).not.toBe(computePlanIdentity(planB))

    const cpA = createAnalysisCheckpoint(planA)
    expect(() => nextAnalysisBatch(planB, cpA)).toThrow(AnalysisCheckpointError)
    expect(() => nextAnalysisBatch(planB, cpA)).toThrow(/planId|incompatible/i)
    expect(() =>
      completeAnalysisBatch(planB, cpA, planB.batches[0].batchId),
    ).toThrow(AnalysisCheckpointError)
  })

  test("computePlanIdentity validates plan shape fail-closed", () => {
    expect(() =>
      computePlanIdentity(null as unknown as ExhaustiveAnalysisPlan),
    ).toThrow(AnalysisCheckpointError)
    expect(() =>
      computePlanIdentity({} as unknown as ExhaustiveAnalysisPlan),
    ).toThrow(AnalysisCheckpointError)
  })

  test("complete plan requires non-empty fingerprint; blocked requires null", () => {
    const complete = threeBatchPlan()
    const emptyFp = {
      ...complete,
      fingerprint: "",
    } as ExhaustiveAnalysisPlan
    expect(() => createAnalysisCheckpoint(emptyFp)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(emptyFp)).toThrow(
      /non-empty string fingerprint/,
    )
    expect(() => computePlanIdentity(emptyFp)).toThrow(AnalysisCheckpointError)

    const blocked = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "partial")], {
        complete: false,
        fingerprint: null,
        diagnostics: [
          {
            code: "include_not_found",
            severity: "error",
            message: "missing",
          },
        ],
      }),
      4,
    )
    const blockedWithFp = {
      ...blocked,
      fingerprint: FP,
    } as ExhaustiveAnalysisPlan
    expect(() => createAnalysisCheckpoint(blockedWithFp)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(blockedWithFp)).toThrow(
      /null fingerprint/,
    )
  })

  test("malformed plan.coverage counts and percent are rejected", () => {
    const plan = threeBatchPlan()
    const fractionalChars = {
      ...plan,
      coverage: { ...plan.coverage, totalCharacters: 10.5 },
    } as ExhaustiveAnalysisPlan
    expect(() => createAnalysisCheckpoint(fractionalChars)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(fractionalChars)).toThrow(
      /plan\.coverage/,
    )

    const badPercent = {
      ...plan,
      coverage: { ...plan.coverage, coveragePercent: 101 },
    } as ExhaustiveAnalysisPlan
    expect(() => createAnalysisCheckpoint(badPercent)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => computePlanIdentity(badPercent)).toThrow(
      AnalysisCheckpointError,
    )
  })

  test("checkpoint fingerprint and integer counters are validated", () => {
    const plan = threeBatchPlan()
    const base = createAnalysisCheckpoint(plan)

    const emptyFp = { ...base, fingerprint: "" }
    expect(() => nextAnalysisBatch(plan, emptyFp)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => nextAnalysisBatch(plan, emptyFp)).toThrow(
      /fingerprint must be a non-empty string or null/,
    )

    const fractionalChars = { ...base, totalCharacters: 10.5 }
    expect(() => nextAnalysisBatch(plan, fractionalChars)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => nextAnalysisBatch(plan, fractionalChars)).toThrow(
      /counters, strategy, or state are malformed/,
    )

    const percentOutOfRange = { ...base, coveragePercent: 101 }
    expect(() => nextAnalysisBatch(plan, percentOutOfRange)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => nextAnalysisBatch(plan, percentOutOfRange)).toThrow(
      /counters, strategy, or state are malformed/,
    )

    const negativePercent = { ...base, coveragePercent: -0.01 }
    expect(() => nextAnalysisBatch(plan, negativePercent)).toThrow(
      AnalysisCheckpointError,
    )
  })
})

describe("plan coherence / assertPlanShape", () => {
  const strategy = "ordered-source-spans-exhaustive-v1" as const

  function manualComplete(opts: {
    totalCharacters: number
    plannedCharacters: number
    coveragePercent: number
    batches: Array<{ batchId: string; characters: number }>
  }): ExhaustiveAnalysisPlan {
    return {
      status: "complete",
      fingerprint: FP,
      strategy,
      batches: opts.batches.map((b, index) => ({
        index,
        batchId: b.batchId,
        characters: b.characters,
        chunks: [],
      })),
      coverage: {
        totalCharacters: opts.totalCharacters,
        plannedCharacters: opts.plannedCharacters,
        coveragePercent: opts.coveragePercent,
        batchCount: opts.batches.length,
      },
      diagnostics: [],
    }
  }

  function manualBlocked(opts: {
    totalCharacters: number
    plannedCharacters: number
    coveragePercent: number
    batches: Array<{ batchId: string; characters: number }>
  }): ExhaustiveAnalysisPlan {
    return {
      status: "blocked",
      fingerprint: null,
      strategy,
      batches: opts.batches.map((b, index) => ({
        index,
        batchId: b.batchId,
        characters: b.characters,
        chunks: [],
      })),
      coverage: {
        totalCharacters: opts.totalCharacters,
        plannedCharacters: opts.plannedCharacters,
        coveragePercent: opts.coveragePercent,
        batchCount: opts.batches.length,
      },
      diagnostics: [],
    }
  }

  test("rejects complete with no batches but uncovered content", () => {
    const plan = manualComplete({
      totalCharacters: 10,
      plannedCharacters: 0,
      coveragePercent: 0,
      batches: [],
    })
    expect(() => createAnalysisCheckpoint(plan)).toThrow(AnalysisCheckpointError)
    expect(() => computePlanIdentity(plan)).toThrow(
      /plannedCharacters === totalCharacters|coveragePercent === 100/,
    )
  })

  test("rejects complete when batch character sum differs from planned or total", () => {
    const sumDiffersPlanned = manualComplete({
      totalCharacters: 6,
      plannedCharacters: 6,
      coveragePercent: 100,
      batches: [
        { batchId: "b0", characters: 4 },
        { batchId: "b1", characters: 1 },
      ],
    })
    expect(() => createAnalysisCheckpoint(sumDiffersPlanned)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(sumDiffersPlanned)).toThrow(
      /sum of plan\.batches/,
    )

    const plannedDiffersTotal = manualComplete({
      totalCharacters: 10,
      plannedCharacters: 6,
      coveragePercent: 100,
      batches: [
        { batchId: "b0", characters: 4 },
        { batchId: "b1", characters: 2 },
      ],
    })
    expect(() => createAnalysisCheckpoint(plannedDiffersTotal)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(plannedDiffersTotal)).toThrow(
      /plannedCharacters === totalCharacters/,
    )
  })

  test("rejects duplicate batchIds before create or identity", () => {
    const plan = manualComplete({
      totalCharacters: 6,
      plannedCharacters: 6,
      coveragePercent: 100,
      batches: [
        { batchId: "same-id", characters: 3 },
        { batchId: "same-id", characters: 3 },
      ],
    })
    expect(() => createAnalysisCheckpoint(plan)).toThrow(AnalysisCheckpointError)
    expect(() => createAnalysisCheckpoint(plan)).toThrow(/duplicate batchId/)
    expect(() => computePlanIdentity(plan)).toThrow(/duplicate batchId/)
  })

  test("rejects batch with zero characters", () => {
    const plan = manualComplete({
      totalCharacters: 4,
      plannedCharacters: 4,
      coveragePercent: 100,
      batches: [
        { batchId: "b0", characters: 4 },
        { batchId: "b1", characters: 0 },
      ],
    })
    // batchCount matches length but sum would be 4; zero-char batch is malformed.
    plan.coverage.plannedCharacters = 4
    plan.coverage.batchCount = 2
    expect(() => createAnalysisCheckpoint(plan)).toThrow(AnalysisCheckpointError)
    expect(() => createAnalysisCheckpoint(plan)).toThrow(/malformed/)
  })

  test("rejects blocked plan with batches or non-zero planned coverage", () => {
    const withBatch = manualBlocked({
      totalCharacters: 7,
      plannedCharacters: 3,
      coveragePercent: 0,
      batches: [{ batchId: "b0", characters: 3 }],
    })
    expect(() => createAnalysisCheckpoint(withBatch)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(withBatch)).toThrow(
      /blocked plan must have zero batches/,
    )

    const plannedNonZero = manualBlocked({
      totalCharacters: 7,
      plannedCharacters: 5,
      coveragePercent: 0,
      batches: [],
    })
    expect(() => createAnalysisCheckpoint(plannedNonZero)).toThrow(
      AnalysisCheckpointError,
    )
    expect(() => createAnalysisCheckpoint(plannedNonZero)).toThrow(
      /plannedCharacters === 0/,
    )
  })

  test("still accepts complete empty, real complete, and real blocked plans", () => {
    const empty = planExhaustiveAnalysisBatches(manuscript([]), 1)
    expect(empty.status).toBe("complete")
    expect(empty.batches).toEqual([])
    const emptyCp = createAnalysisCheckpoint(empty)
    expect(emptyCp.state).toBe("complete")
    expect(emptyCp.coveragePercent).toBe(100)
    expect(emptyCp.totalCharacters).toBe(0)

    const complete = threeBatchPlan()
    expect(complete.status).toBe("complete")
    const completeCp = createAnalysisCheckpoint(complete)
    expect(completeCp.state).toBe("pending")
    expect(completeCp.totalBatches).toBe(3)
    expect(computePlanIdentity(complete)).toMatch(/^[0-9a-f]{64}$/)

    const blocked = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "partial")], {
        complete: false,
        fingerprint: null,
        diagnostics: [
          {
            code: "include_not_found",
            severity: "error",
            message: "missing",
          },
        ],
      }),
      4,
    )
    expect(blocked.status).toBe("blocked")
    expect(blocked.coverage.totalCharacters).toBeGreaterThan(0)
    const blockedCp = createAnalysisCheckpoint(blocked)
    expect(blockedCp.state).toBe("blocked")
    expect(blockedCp.coveragePercent).toBe(0)
    expect(blockedCp.totalBatches).toBe(0)
  })
})

describe("plan identity determinism", () => {
  test("identity is deterministic and independent of progress", () => {
    const plan = threeBatchPlan()
    const a = computePlanIdentity(plan)
    const b = computePlanIdentity(plan)
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)

    const cp0 = createAnalysisCheckpoint(plan)
    const cp1 = completeAnalysisBatch(plan, cp0, plan.batches[0].batchId)
    expect(cp0.planId).toBe(a)
    expect(cp1.planId).toBe(a)

    // Rebuilt plan with same inputs yields the same identity.
    const plan2 = threeBatchPlan()
    expect(computePlanIdentity(plan2)).toBe(a)
    expect(createAnalysisCheckpoint(plan2).planId).toBe(a)
  })

  test("wire version is analysis-checkpoint-v2 after chunk-bound identity", () => {
    expect(ANALYSIS_CHECKPOINT_VERSION).toBe("analysis-checkpoint-v2")
    const plan = threeBatchPlan()
    expect(createAnalysisCheckpoint(plan).version).toBe(
      "analysis-checkpoint-v2",
    )
  })

  test("two-chunk batch content tamper changes planId (same characters sum)", () => {
    // Budget large enough that two short spans land in one batch.
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("a.tex", "abc"), span("b.tex", "def")]),
      100,
    )
    expect(plan.status).toBe("complete")
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].chunks.length).toBeGreaterThanOrEqual(2)

    const originalId = computePlanIdentity(plan)

    const tampered = deepCloneJson(plan)
    const batch = tampered.batches[0]
    const c0 = batch.chunks[0]
    const c1 = batch.chunks[1]
    // Shorten first chunk (3 → 1), lengthen second (3 → 5) keeping batch sum.
    c0.text = "a"
    c0.source.endOffset = c0.source.startOffset + 1
    c1.text = "XXXXX"
    c1.source.file = "forged.tex"
    c1.source.startLine = 99
    c1.source.endLine = 99
    c1.source.startOffset = 0
    c1.source.endOffset = 5
    batch.characters = c0.text.length + c1.text.length
    // Keep coverage totals consistent with batch sum (complete plan contract).
    tampered.coverage.plannedCharacters = batch.characters
    tampered.coverage.totalCharacters = batch.characters

    expect(batch.characters).toBe(plan.batches[0].characters)
    expect(computePlanIdentity(tampered)).not.toBe(originalId)
  })

  test("batchId-only change still changes identity", () => {
    const plan = threeBatchPlan()
    const base = computePlanIdentity(plan)
    const mutated = deepCloneJson(plan)
    mutated.batches[0].batchId = `${plan.batches[0].batchId}:mutated`
    expect(computePlanIdentity(mutated)).not.toBe(base)
  })

  test("blocked and empty complete plans still get deterministic identities", () => {
    const empty = planExhaustiveAnalysisBatches(manuscript([]), 1)
    expect(empty.status).toBe("complete")
    expect(empty.batches).toEqual([])
    const emptyId = computePlanIdentity(empty)
    expect(emptyId).toBe(computePlanIdentity(empty))
    expect(emptyId).toMatch(/^[0-9a-f]{64}$/)

    const blocked = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "partial")], {
        complete: false,
        fingerprint: null,
        diagnostics: [
          {
            code: "include_not_found",
            severity: "error",
            message: "missing",
          },
        ],
      }),
      4,
    )
    expect(blocked.status).toBe("blocked")
    const blockedId = computePlanIdentity(blocked)
    expect(blockedId).toBe(computePlanIdentity(blocked))
    expect(blockedId).toMatch(/^[0-9a-f]{64}$/)
    expect(blockedId).not.toBe(emptyId)
  })

  test("malformed chunk fails closed for identity", () => {
    const plan = threeBatchPlan()
    const bad = deepCloneJson(plan)
    bad.batches[0].chunks[0].text = ""
    bad.batches[0].chunks[0].source.endOffset =
      bad.batches[0].chunks[0].source.startOffset
    expect(() => computePlanIdentity(bad)).toThrow(AnalysisCheckpointError)
    expect(() => computePlanIdentity(bad)).toThrow(/invalid_plan|text/)
  })
})

describe("immutability", () => {
  test("create/next/complete never mutate plan or checkpoint inputs", () => {
    const plan = threeBatchPlan()
    const planBefore = deepCloneJson(plan)
    const cp = createAnalysisCheckpoint(plan)
    const cpBefore = deepCloneJson(cp)

    const next = nextAnalysisBatch(plan, cp)
    expect(next).not.toBeNull()
    expect(next!.batchId).toBe(plan.batches[0].batchId)
    expect(plan).toEqual(planBefore)
    expect(cp).toEqual(cpBefore)

    const advanced = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)
    expect(plan).toEqual(planBefore)
    expect(cp).toEqual(cpBefore)
    expect(advanced).not.toBe(cp)
    expect(advanced.completedBatches).toBe(1)

    const advancedBefore = deepCloneJson(advanced)
    // Out-of-order attempt also leaves inputs untouched.
    expect(() =>
      completeAnalysisBatch(plan, advanced, plan.batches[2].batchId),
    ).toThrow(AnalysisCheckpointError)
    expect(plan).toEqual(planBefore)
    expect(advanced).toEqual(advancedBefore)

    // Idempotent path returns a new object and still leaves the source alone.
    const again = completeAnalysisBatch(
      plan,
      advanced,
      plan.batches[0].batchId,
    )
    expect(again).toEqual(advanced)
    expect(again).not.toBe(advanced)
    expect(plan).toEqual(planBefore)
    expect(advanced).toEqual(advancedBefore)
  })
})
