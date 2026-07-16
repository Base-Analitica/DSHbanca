/**
 * Pure unit tests for global synthesis input gated on complete coverage.
 * Exercises shipped functions only — no mock of the unit under test.
 */
import { describe, test, expect } from "bun:test"
import {
  completeAnalysisBatch,
  createAnalysisCheckpoint,
  computePlanIdentity,
  type AnalysisCheckpoint,
} from "../src/lib/analysis_checkpoint"
import {
  planExhaustiveAnalysisBatches,
  type ExhaustiveAnalysisPlan,
} from "../src/lib/analysis_coverage"
import {
  computeFindingIdentity,
  createAnalysisFinding,
  type AnalysisFinding,
  type AnalysisFindingInput,
} from "../src/lib/analysis_findings"
import {
  AnalysisSynthesisError,
  GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION,
  createGlobalAnalysisSynthesisInput,
} from "../src/lib/analysis_synthesis"
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

/** total 10 chars, budget 4 → three batches (4, 4, 2). */
function threeBatchPlan(): ExhaustiveAnalysisPlan {
  return planExhaustiveAnalysisBatches(
    manuscript([
      span("one.tex", "abc"),
      span("two.tex", "defg"),
      span("three.tex", "hij"),
    ]),
    4,
  )
}

function emptyCompletePlan(): ExhaustiveAnalysisPlan {
  return planExhaustiveAnalysisBatches(manuscript([]), 4)
}

function blockedPlan(): ExhaustiveAnalysisPlan {
  return planExhaustiveAnalysisBatches(
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
}

function baseInput(
  plan: ExhaustiveAnalysisPlan,
  overrides: Partial<AnalysisFindingInput> = {},
): AnalysisFindingInput {
  const batch = plan.batches[0]
  const chunk = batch.chunks[0]
  return {
    category: "structure",
    severity: "warning",
    claim: "Missing abstract section",
    evidence: "No abstract environment in the batch span",
    file: chunk.source.file,
    startLine: chunk.source.startLine,
    endLine: chunk.source.endLine,
    sectionId: "sec:intro",
    manuscriptFingerprint: plan.fingerprint!,
    batchId: batch.batchId,
    ...overrides,
  }
}

function findingOnBatch(
  plan: ExhaustiveAnalysisPlan,
  batchIndex: number,
  claim: string,
): AnalysisFinding {
  const batch = plan.batches[batchIndex]
  const chunk = batch.chunks[0]
  return createAnalysisFinding(
    plan,
    baseInput(plan, {
      batchId: batch.batchId,
      file: chunk.source.file,
      startLine: chunk.source.startLine,
      endLine: chunk.source.endLine,
      claim,
    }),
  )
}

/** Advance checkpoint through every batch → state complete. */
function completeCheckpoint(plan: ExhaustiveAnalysisPlan): AnalysisCheckpoint {
  let cp = createAnalysisCheckpoint(plan)
  for (const batch of plan.batches) {
    cp = completeAnalysisBatch(plan, cp, batch.batchId)
  }
  return cp
}

function expectSynthesisError(
  fn: () => unknown,
  code: string,
  forbiddenSubstrings: string[] = [],
): void {
  try {
    fn()
    expect.unreachable("expected AnalysisSynthesisError")
  } catch (e) {
    expect(e).toBeInstanceOf(AnalysisSynthesisError)
    const err = e as AnalysisSynthesisError
    expect(err.code).toBe(code)
    for (const s of forbiddenSubstrings) {
      expect(err.message).not.toContain(s)
    }
  }
}

describe("createGlobalAnalysisSynthesisInput — acceptance", () => {
  test("complete compatible checkpoint yields versioned input with 100% coverage", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    expect(cp.state).toBe("complete")
    expect(cp.coveragePercent).toBe(100)

    const f0 = findingOnBatch(plan, 0, "claim first")
    const f1 = findingOnBatch(plan, 1, "claim middle")
    const f2 = findingOnBatch(plan, 2, "claim last")

    const input = createGlobalAnalysisSynthesisInput(plan, cp, [f0, f1, f2])

    expect(input.version).toBe(GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION)
    expect(input.version).toBe("global-analysis-synthesis-input-v1")
    expect(input.planId).toBe(computePlanIdentity(plan))
    expect(input.manuscriptFingerprint).toBe(FP)
    expect(input.coverage.state).toBe("complete")
    expect(input.coverage.coveragePercent).toBe(100)
    expect(input.coverage.totalBatches).toBe(3)
    expect(input.coverage.completedBatches).toBe(3)
    expect(input.coverage.totalCharacters).toBe(10)
    expect(input.coverage.completedCharacters).toBe(10)
    expect(input.coverage.orderedBatchIds).toEqual(
      plan.batches.map((b) => b.batchId),
    )
    expect(input.findings).toHaveLength(3)
    expect(input.findings.map((f) => f.claim)).toEqual([
      "claim first",
      "claim middle",
      "claim last",
    ])
    expect(input.findings.map((f) => f.batchId)).toEqual(
      plan.batches.map((b) => b.batchId),
    )

    // No forbidden fields on the wire object
    const json = JSON.stringify(input)
    expect(json).not.toMatch(/timestamp|session|model|score|approval/i)
    expect(json).not.toContain("/home/")
    expect(json).not.toContain("parecer")
  })

  test("empty complete plan with zero batches and zero findings succeeds", () => {
    const plan = emptyCompletePlan()
    expect(plan.status).toBe("complete")
    expect(plan.batches).toHaveLength(0)

    const cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("complete")
    expect(cp.coveragePercent).toBe(100)

    const input = createGlobalAnalysisSynthesisInput(plan, cp, [])
    expect(input.version).toBe(GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION)
    expect(input.coverage.state).toBe("complete")
    expect(input.coverage.coveragePercent).toBe(100)
    expect(input.coverage.totalBatches).toBe(0)
    expect(input.coverage.completedBatches).toBe(0)
    expect(input.coverage.orderedBatchIds).toEqual([])
    expect(input.findings).toEqual([])
    expect(input.planId).toBe(computePlanIdentity(plan))
    expect(input.manuscriptFingerprint).toBe(FP)
  })

  test("complete coverage with zero findings succeeds", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const input = createGlobalAnalysisSynthesisInput(plan, cp, [])
    expect(input.findings).toEqual([])
    expect(input.coverage.coveragePercent).toBe(100)
    expect(input.coverage.state).toBe("complete")
  })

  test("findings from first, middle, and last batch preserve storage order", () => {
    const plan = threeBatchPlan()
    expect(plan.batches.length).toBe(3)
    const cp = completeCheckpoint(plan)

    // Intentionally non-batch order of insertion into the findings array:
    // storage order is the array order (first-occurrence).
    const mid = findingOnBatch(plan, 1, "middle first in store")
    const first = findingOnBatch(plan, 0, "first later in store")
    const last = findingOnBatch(plan, 2, "last in store")

    const input = createGlobalAnalysisSynthesisInput(plan, cp, [
      mid,
      first,
      last,
    ])
    expect(input.findings.map((f) => f.claim)).toEqual([
      "middle first in store",
      "first later in store",
      "last in store",
    ])
  })

  test("exact duplicate findings are deduplicated; order kept", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const a = findingOnBatch(plan, 0, "dup claim")
    const b = deepCloneJson(a)
    const c = findingOnBatch(plan, 1, "unique claim")

    const input = createGlobalAnalysisSynthesisInput(plan, cp, [a, b, c])
    expect(input.findings).toHaveLength(2)
    expect(input.findings[0].claim).toBe("dup claim")
    expect(input.findings[1].claim).toBe("unique claim")
  })

  test("deterministic serialization for equivalent inputs; no mutation", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const findings = [
      findingOnBatch(plan, 0, "a"),
      findingOnBatch(plan, 2, "c"),
    ]
    const planSnap = deepCloneJson(plan)
    const cpSnap = deepCloneJson(cp)
    const findingsSnap = deepCloneJson(findings)

    const first = createGlobalAnalysisSynthesisInput(plan, cp, findings)
    const second = createGlobalAnalysisSynthesisInput(plan, cp, findings)

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(plan).toEqual(planSnap)
    expect(cp).toEqual(cpSnap)
    expect(findings).toEqual(findingsSnap)

    // Returned findings are clones
    expect(first.findings[0]).not.toBe(findings[0])
    expect(first.findings[0]).toEqual(findings[0])
  })
})

describe("createGlobalAnalysisSynthesisInput — coverage gate", () => {
  test("rejects blocked plan", () => {
    const plan = blockedPlan()
    const cp = createAnalysisCheckpoint(plan)
    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, []),
      "blocked_plan",
    )
  })

  test("rejects pending checkpoint", () => {
    const plan = threeBatchPlan()
    const cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("pending")
    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, []),
      "incomplete_coverage",
    )
  })

  test("rejects running checkpoint", () => {
    const plan = threeBatchPlan()
    let cp = createAnalysisCheckpoint(plan)
    cp = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)
    expect(cp.state).toBe("running")
    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, []),
      "incomplete_coverage",
    )
  })

  test("rejects blocked checkpoint state", () => {
    const plan = blockedPlan()
    const cp = createAnalysisCheckpoint(plan)
    expect(cp.state).toBe("blocked")
    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, []),
      "blocked_plan",
    )
  })

  test("rejects tampered checkpoint counters", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const tampered = deepCloneJson(cp)
    tampered.completedCharacters = cp.completedCharacters - 1

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, tampered, []),
      "tampered_checkpoint",
    )
  })

  test("rejects tampered checkpoint state while counters look complete", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const tampered = deepCloneJson(cp)
    tampered.state = "running"

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, tampered, []),
      "tampered_checkpoint",
    )
  })

  test("rejects checkpoint with incompatible planId", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const tampered = deepCloneJson(cp)
    tampered.planId = "b".repeat(64)

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, tampered, []),
      "incompatible_plan",
    )
  })

  test("rejects checkpoint with incompatible fingerprint", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const tampered = deepCloneJson(cp)
    tampered.fingerprint = "b".repeat(64)

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, tampered, []),
      "incompatible_plan",
    )
  })

  test("rejects checkpoint belonging to another plan", () => {
    const planA = threeBatchPlan()
    const planB = planExhaustiveAnalysisBatches(
      manuscript([
        span("x.tex", "abcd"),
        span("y.tex", "efgh"),
        span("z.tex", "ijkl"),
      ]),
      4,
    )
    const cpB = completeCheckpoint(planB)
    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(planA, cpB, []),
      "incompatible_plan",
    )
  })
})

describe("createGlobalAnalysisSynthesisInput — findings validation", () => {
  test("rejects adulterated finding (claim changed, findingId stale)", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "original")
    const bad = deepCloneJson(good)
    bad.claim = "tampered claim without new findingId"

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [bad]),
      "invalid_findings",
      ["tampered claim without new findingId"],
    )
  })

  test("rejects finding from unknown batch", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "ok")
    const bad = deepCloneJson(good)
    // Rebuild with a foreign batchId while keeping structural findingId shape:
    // create a finding for batch 0 then force batchId to a fake id and recompute
    // findingId so structural check passes but plan revalidation fails.
    const forged = createAnalysisFinding(
      plan,
      baseInput(plan, { claim: "forged batch" }),
    )
    const foreign = deepCloneJson(forged)
    foreign.batchId = "batch-does-not-exist"
    // Recompute identity so assertValidStoredFinding accepts the record shape.
    foreign.findingId = computeFindingIdentity({
      version: foreign.version,
      planId: foreign.planId,
      manuscriptFingerprint: foreign.manuscriptFingerprint,
      batchId: foreign.batchId,
      category: foreign.category,
      severity: foreign.severity,
      claim: foreign.claim,
      evidence: foreign.evidence,
      file: foreign.file,
      startLine: foreign.startLine,
      endLine: foreign.endLine,
      sectionId: foreign.sectionId,
    })

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [foreign]),
      "invalid_findings",
      ["batch-does-not-exist"],
    )
  })

  test("rejects finding with incompatible fingerprint", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "fp case")
    const bad = deepCloneJson(good)
    bad.manuscriptFingerprint = "b".repeat(64)
    bad.findingId = computeFindingIdentity({
      version: bad.version,
      planId: bad.planId,
      manuscriptFingerprint: bad.manuscriptFingerprint,
      batchId: bad.batchId,
      category: bad.category,
      severity: bad.severity,
      claim: bad.claim,
      evidence: bad.evidence,
      file: bad.file,
      startLine: bad.startLine,
      endLine: bad.endLine,
      sectionId: bad.sectionId,
    })

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [bad]),
      "invalid_findings",
    )
  })

  test("rejects finding with incompatible planId that still matches payload id", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "planId case")
    const bad = deepCloneJson(good)
    bad.planId = "c".repeat(64)
    bad.findingId = computeFindingIdentity({
      version: bad.version,
      planId: bad.planId,
      manuscriptFingerprint: bad.manuscriptFingerprint,
      batchId: bad.batchId,
      category: bad.category,
      severity: bad.severity,
      claim: bad.claim,
      evidence: bad.evidence,
      file: bad.file,
      startLine: bad.startLine,
      endLine: bad.endLine,
      sectionId: bad.sectionId,
    })

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [bad]),
      "invalid_findings",
    )
  })

  test("rejects finding with file not in batch", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "file case")
    // first batch has one.tex/two.tex; three.tex is only in last batch
    const bad = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: plan.batches[2].batchId,
        file: "three.tex",
        claim: "valid on last",
      }),
    )
    // Forge: claim last-batch file but first-batch id with re-hashed identity.
    const forged = deepCloneJson(bad)
    forged.batchId = plan.batches[0].batchId
    forged.findingId = computeFindingIdentity({
      version: forged.version,
      planId: forged.planId,
      manuscriptFingerprint: forged.manuscriptFingerprint,
      batchId: forged.batchId,
      category: forged.category,
      severity: forged.severity,
      claim: forged.claim,
      evidence: forged.evidence,
      file: forged.file,
      startLine: forged.startLine,
      endLine: forged.endLine,
      sectionId: forged.sectionId,
    })

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [forged]),
      "invalid_findings",
      ["three.tex"],
    )
  })

  test("rejects objects with extra keys", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "extra keys")
    const bad = { ...good, extra: "nope" } as AnalysisFinding

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [bad]),
      "invalid_findings",
      ["nope", "extra"],
    )
  })

  test("rejects findingId collision with divergent payload", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const a = findingOnBatch(plan, 0, "collision-a")
    const b = findingOnBatch(plan, 0, "collision-b")
    // Force same findingId while keeping different claims.
    const collision = deepCloneJson(b)
    collision.findingId = a.findingId

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [a, collision]),
      "invalid_findings",
    )
  })

  test("path-like strings in claim/evidence never appear in controlled errors", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const secretPath = "/home/secret/user/thesis.tex"
    const good = findingOnBatch(plan, 0, secretPath)
    const bad = deepCloneJson(good)
    bad.evidence = `see also ${secretPath} and /var/lib/private`
    // Keep findingId matching original claim identity so structural id check
    // fails on evidence mismatch after recompute, or fails on id mismatch.
    // Use stale findingId after evidence change:
    // assertValidStoredFinding recomputes id from payload → finding_id_mismatch.

    expectSynthesisError(
      () => createGlobalAnalysisSynthesisInput(plan, cp, [bad]),
      "invalid_findings",
      [secretPath, "/home/", "/var/lib/private"],
    )
  })

  test("AnalysisFindingError is converted to invalid_findings with fixed message", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const good = findingOnBatch(plan, 0, "original claim text")
    const bad = deepCloneJson(good)
    bad.claim = "mutated claim that must not leak"
    // stale findingId → AnalysisFindingError from structural revalidation

    try {
      createGlobalAnalysisSynthesisInput(plan, cp, [bad])
      expect.unreachable("expected AnalysisSynthesisError")
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisSynthesisError)
      const err = e as AnalysisSynthesisError
      expect(err.code).toBe("invalid_findings")
      expect(err.message).toBe(
        "findings are invalid or incompatible with the live plan",
      )
      expect(err.message).not.toContain("mutated claim that must not leak")
      expect(err.message).not.toContain("original claim text")
    }
  })

  test("unexpected TypeError during findings access is not masked as invalid_findings", () => {
    const plan = threeBatchPlan()
    const cp = completeCheckpoint(plan)
    const boom = new TypeError("synthetic unexpected findings access failure")
    const findings = new Proxy([] as AnalysisFinding[], {
      get(target, prop, receiver) {
        if (prop === "length") return 1
        if (prop === "0" || prop === 0) throw boom
        return Reflect.get(target, prop, receiver)
      },
    })

    try {
      createGlobalAnalysisSynthesisInput(plan, cp, findings)
      expect.unreachable("expected TypeError to propagate")
    } catch (e) {
      expect(e).toBe(boom)
      expect(e).toBeInstanceOf(TypeError)
      expect(e).not.toBeInstanceOf(AnalysisSynthesisError)
    }
  })
})
