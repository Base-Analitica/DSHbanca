import { describe, test, expect } from "bun:test"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint"
import {
  ANALYSIS_FINDING_VERSION,
  AnalysisFindingError,
  computeFindingIdentity,
  createAnalysisFinding,
  mergeAnalysisFindings,
  type AnalysisFinding,
  type AnalysisFindingInput,
} from "../src/lib/analysis_findings"
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

/**
 * Multi-line spans so line-range coverage can be tested meaningfully.
 * chap.tex lines 1-10 (content length padded), other.tex lines 20-25.
 * Budget large enough that each file can land in separate batches.
 */
function multiLinePlan(): ExhaustiveAnalysisPlan {
  // 40 chars on lines 1-10 of chap.tex, 20 chars on lines 20-25 of other.tex
  const chapText = "L".repeat(40)
  const otherText = "O".repeat(20)
  return planExhaustiveAnalysisBatches(
    manuscript([
      span("chap.tex", chapText, 1, 10),
      span("other.tex", otherText, 20, 25),
    ]),
    30,
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

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe("createAnalysisFinding — valid cases", () => {
  test("valid finding on first batch", () => {
    const plan = threeBatchPlan()
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBeGreaterThanOrEqual(1)

    const input = baseInput(plan)
    const finding = createAnalysisFinding(plan, input)

    expect(finding.version).toBe(ANALYSIS_FINDING_VERSION)
    expect(finding.planId).toBe(computePlanIdentity(plan))
    expect(finding.findingId).toMatch(/^[0-9a-f]{64}$/)
    expect(finding.batchId).toBe(plan.batches[0].batchId)
    expect(finding.manuscriptFingerprint).toBe(FP)
    expect(finding.category).toBe("structure")
    expect(finding.severity).toBe("warning")
    expect(finding.claim).toBe("Missing abstract section")
    expect(finding.evidence).toBe(
      "No abstract environment in the batch span",
    )
    expect(finding.file).toBe("one.tex")
    expect(finding.startLine).toBe(1)
    expect(finding.endLine).toBe(1)
    expect(finding.sectionId).toBe("sec:intro")
  })

  test("valid finding on intermediate batch", () => {
    const plan = threeBatchPlan()
    expect(plan.batches.length).toBe(3)
    const mid = plan.batches[1]
    const chunk = mid.chunks[0]

    const finding = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: mid.batchId,
        file: chunk.source.file,
        startLine: chunk.source.startLine,
        endLine: chunk.source.endLine,
        claim: "Claim in middle batch",
      }),
    )

    expect(finding.batchId).toBe(mid.batchId)
    expect(finding.file).toBe(chunk.source.file)
    expect(finding.claim).toBe("Claim in middle batch")
    expect(finding.planId).toBe(computePlanIdentity(plan))
    expect(finding.findingId).toHaveLength(64)
  })

  test("trim normalizes textual fields", () => {
    const plan = threeBatchPlan()
    const finding = createAnalysisFinding(
      plan,
      baseInput(plan, {
        category: "  structure  ",
        severity: "\twarning\n",
        claim: "  padded claim  ",
        evidence: "  padded evidence  ",
        sectionId: "  sec:intro  ",
      }),
    )

    expect(finding.category).toBe("structure")
    expect(finding.severity).toBe("warning")
    expect(finding.claim).toBe("padded claim")
    expect(finding.evidence).toBe("padded evidence")
    expect(finding.sectionId).toBe("sec:intro")
  })
})

describe("createAnalysisFinding — rejection", () => {
  test("rejects incompatible fingerprint", () => {
    const plan = threeBatchPlan()
    expect(() =>
      createAnalysisFinding(
        plan,
        baseInput(plan, { manuscriptFingerprint: "b".repeat(64) }),
      ),
    ).toThrow(AnalysisFindingError)

    try {
      createAnalysisFinding(
        plan,
        baseInput(plan, { manuscriptFingerprint: "b".repeat(64) }),
      )
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisFindingError)
      expect((e as AnalysisFindingError).code).toBe("fingerprint_mismatch")
    }
  })

  test("rejects unknown batchId", () => {
    const plan = threeBatchPlan()
    expect(() =>
      createAnalysisFinding(
        plan,
        baseInput(plan, { batchId: "does-not-exist" }),
      ),
    ).toThrow(AnalysisFindingError)

    try {
      createAnalysisFinding(
        plan,
        baseInput(plan, { batchId: "does-not-exist" }),
      )
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("unknown_batch")
    }
  })

  test("rejects blocked plan", () => {
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

    expect(() =>
      createAnalysisFinding(plan, {
        category: "x",
        severity: "y",
        claim: "c",
        evidence: "e",
        file: "main.tex",
        startLine: 1,
        endLine: 1,
        sectionId: "s",
        manuscriptFingerprint: "a".repeat(64),
        batchId: "any",
      }),
    ).toThrow(AnalysisFindingError)

    try {
      createAnalysisFinding(plan, {
        category: "x",
        severity: "y",
        claim: "c",
        evidence: "e",
        file: "main.tex",
        startLine: 1,
        endLine: 1,
        sectionId: "s",
        manuscriptFingerprint: "a".repeat(64),
        batchId: "any",
      })
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("blocked_plan")
    }
  })

  test("rejects file absent from batch", () => {
    const plan = threeBatchPlan()
    // first batch has one.tex and two.tex, not three.tex
    expect(plan.batches[0].chunks.some((c) => c.source.file === "three.tex")).toBe(
      false,
    )

    expect(() =>
      createAnalysisFinding(
        plan,
        baseInput(plan, { file: "three.tex" }),
      ),
    ).toThrow(AnalysisFindingError)

    try {
      createAnalysisFinding(plan, baseInput(plan, { file: "three.tex" }))
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("file_not_in_batch")
    }
  })

  test("rejects alternate path that is not the plan's exact public path", () => {
    const plan = threeBatchPlan()
    expect(() =>
      createAnalysisFinding(
        plan,
        baseInput(plan, { file: "./one.tex" }),
      ),
    ).toThrow(AnalysisFindingError)
  })

  test("rejects line range before, after, or partially outside batch coverage", () => {
    const plan = multiLinePlan()
    // Locate batch that covers chap.tex
    const chapBatch = plan.batches.find((b) =>
      b.chunks.some((c) => c.source.file === "chap.tex"),
    )
    expect(chapBatch).toBeDefined()
    const chapChunk = chapBatch!.chunks.find((c) => c.source.file === "chap.tex")!
    const coveredStart = chapChunk.source.startLine
    const coveredEnd = chapChunk.source.endLine

    const mk = (startLine: number, endLine: number) =>
      createAnalysisFinding(
        plan,
        baseInput(plan, {
          batchId: chapBatch!.batchId,
          file: "chap.tex",
          startLine,
          endLine,
          manuscriptFingerprint: plan.fingerprint!,
        }),
      )

    // Valid interior range
    expect(mk(coveredStart, coveredEnd).file).toBe("chap.tex")

    // Before coverage
    expect(() => mk(coveredStart - 5, coveredStart - 1)).toThrow(
      AnalysisFindingError,
    )
    // After coverage
    expect(() => mk(coveredEnd + 1, coveredEnd + 3)).toThrow(
      AnalysisFindingError,
    )
    // Partially outside (starts before)
    if (coveredStart > 1) {
      expect(() => mk(coveredStart - 1, coveredEnd)).toThrow(
        AnalysisFindingError,
      )
    } else {
      // force partial by extending past end
      expect(() => mk(coveredStart, coveredEnd + 1)).toThrow(
        AnalysisFindingError,
      )
    }
    // Partially outside (ends after)
    expect(() => mk(coveredStart, coveredEnd + 2)).toThrow(
      AnalysisFindingError,
    )

    try {
      mk(coveredEnd + 1, coveredEnd + 2)
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("line_range_not_covered")
    }
  })

  test("rejects invalid lines and inverted range", () => {
    const plan = threeBatchPlan()

    expect(() =>
      createAnalysisFinding(plan, baseInput(plan, { startLine: 0 })),
    ).toThrow(AnalysisFindingError)
    expect(() =>
      createAnalysisFinding(plan, baseInput(plan, { endLine: -1 })),
    ).toThrow(AnalysisFindingError)
    expect(() =>
      createAnalysisFinding(
        plan,
        baseInput(plan, { startLine: 1.5 as unknown as number }),
      ),
    ).toThrow(AnalysisFindingError)
    expect(() =>
      createAnalysisFinding(
        plan,
        baseInput(plan, { startLine: 5, endLine: 2 }),
      ),
    ).toThrow(AnalysisFindingError)

    try {
      createAnalysisFinding(plan, baseInput(plan, { startLine: 5, endLine: 2 }))
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_lines")
    }
  })

  test("rejects empty or whitespace-only textual fields", () => {
    const plan = threeBatchPlan()
    const fields = [
      "category",
      "severity",
      "claim",
      "evidence",
      "sectionId",
    ] as const

    for (const field of fields) {
      expect(() =>
        createAnalysisFinding(
          plan,
          baseInput(plan, { [field]: "   " }),
        ),
      ).toThrow(AnalysisFindingError)

      expect(() =>
        createAnalysisFinding(plan, baseInput(plan, { [field]: "" })),
      ).toThrow(AnalysisFindingError)
    }

    try {
      createAnalysisFinding(plan, baseInput(plan, { claim: "  " }))
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_field")
    }
  })
})

describe("finding identity determinism", () => {
  test("same payload produces the same findingId", () => {
    const plan = threeBatchPlan()
    const input = baseInput(plan)
    const a = createAnalysisFinding(plan, input)
    const b = createAnalysisFinding(plan, { ...input })
    expect(a.findingId).toBe(b.findingId)
    expect(a).toEqual(b)
  })

  test("changing each identity field changes the findingId", () => {
    const plan = threeBatchPlan()
    const base = createAnalysisFinding(plan, baseInput(plan))

    // category / severity / claim / evidence / sectionId via re-create
    const byCategory = createAnalysisFinding(
      plan,
      baseInput(plan, { category: "other-category" }),
    )
    expect(byCategory.findingId).not.toBe(base.findingId)

    const bySeverity = createAnalysisFinding(
      plan,
      baseInput(plan, { severity: "error" }),
    )
    expect(bySeverity.findingId).not.toBe(base.findingId)

    const byClaim = createAnalysisFinding(
      plan,
      baseInput(plan, { claim: "Different claim text" }),
    )
    expect(byClaim.findingId).not.toBe(base.findingId)

    const byEvidence = createAnalysisFinding(
      plan,
      baseInput(plan, { evidence: "Different evidence" }),
    )
    expect(byEvidence.findingId).not.toBe(base.findingId)

    const bySection = createAnalysisFinding(
      plan,
      baseInput(plan, { sectionId: "sec:other" }),
    )
    expect(bySection.findingId).not.toBe(base.findingId)

    // batchId: use intermediate batch if available
    if (plan.batches.length > 1) {
      const mid = plan.batches[1]
      const chunk = mid.chunks[0]
      const byBatch = createAnalysisFinding(
        plan,
        baseInput(plan, {
          batchId: mid.batchId,
          file: chunk.source.file,
          startLine: chunk.source.startLine,
          endLine: chunk.source.endLine,
        }),
      )
      expect(byBatch.findingId).not.toBe(base.findingId)
      expect(byBatch.batchId).not.toBe(base.batchId)
    }

    // start/end line on multi-line plan
    const ml = multiLinePlan()
    const chapBatch = ml.batches.find((b) =>
      b.chunks.some((c) => c.source.file === "chap.tex"),
    )!
    const chapChunk = chapBatch.chunks.find((c) => c.source.file === "chap.tex")!
    const s = chapChunk.source.startLine
    const e = chapChunk.source.endLine
    if (e > s) {
      const full = createAnalysisFinding(
        ml,
        baseInput(ml, {
          batchId: chapBatch.batchId,
          file: "chap.tex",
          startLine: s,
          endLine: e,
          manuscriptFingerprint: ml.fingerprint!,
        }),
      )
      const partial = createAnalysisFinding(
        ml,
        baseInput(ml, {
          batchId: chapBatch.batchId,
          file: "chap.tex",
          startLine: s,
          endLine: s,
          manuscriptFingerprint: ml.fingerprint!,
        }),
      )
      expect(full.findingId).not.toBe(partial.findingId)
    }

    // Direct identity helper: planId / version / fingerprint / file
    const idBase = computeFindingIdentity({
      version: ANALYSIS_FINDING_VERSION,
      planId: base.planId,
      manuscriptFingerprint: base.manuscriptFingerprint,
      batchId: base.batchId,
      category: base.category,
      severity: base.severity,
      claim: base.claim,
      evidence: base.evidence,
      file: base.file,
      startLine: base.startLine,
      endLine: base.endLine,
      sectionId: base.sectionId,
    })
    expect(idBase).toBe(base.findingId)

    expect(
      computeFindingIdentity({
        version: "analysis-finding-v0",
        planId: base.planId,
        manuscriptFingerprint: base.manuscriptFingerprint,
        batchId: base.batchId,
        category: base.category,
        severity: base.severity,
        claim: base.claim,
        evidence: base.evidence,
        file: base.file,
        startLine: base.startLine,
        endLine: base.endLine,
        sectionId: base.sectionId,
      }),
    ).not.toBe(base.findingId)

    expect(
      computeFindingIdentity({
        version: ANALYSIS_FINDING_VERSION,
        planId: "different-plan-id",
        manuscriptFingerprint: base.manuscriptFingerprint,
        batchId: base.batchId,
        category: base.category,
        severity: base.severity,
        claim: base.claim,
        evidence: base.evidence,
        file: base.file,
        startLine: base.startLine,
        endLine: base.endLine,
        sectionId: base.sectionId,
      }),
    ).not.toBe(base.findingId)

    expect(
      computeFindingIdentity({
        version: ANALYSIS_FINDING_VERSION,
        planId: base.planId,
        manuscriptFingerprint: "c".repeat(64),
        batchId: base.batchId,
        category: base.category,
        severity: base.severity,
        claim: base.claim,
        evidence: base.evidence,
        file: base.file,
        startLine: base.startLine,
        endLine: base.endLine,
        sectionId: base.sectionId,
      }),
    ).not.toBe(base.findingId)

    expect(
      computeFindingIdentity({
        version: ANALYSIS_FINDING_VERSION,
        planId: base.planId,
        manuscriptFingerprint: base.manuscriptFingerprint,
        batchId: base.batchId,
        category: base.category,
        severity: base.severity,
        claim: base.claim,
        evidence: base.evidence,
        file: "other.tex",
        startLine: base.startLine,
        endLine: base.endLine,
        sectionId: base.sectionId,
      }),
    ).not.toBe(base.findingId)
  })

  test("JSON roundtrip preserves findingId and data", () => {
    const plan = threeBatchPlan()
    const finding = createAnalysisFinding(plan, baseInput(plan))
    const restored = deepCloneJson(finding) as AnalysisFinding

    expect(restored).toEqual(finding)
    expect(restored.findingId).toBe(finding.findingId)

    // Recompute identity from restored payload
    const recomputed = computeFindingIdentity({
      version: restored.version,
      planId: restored.planId,
      manuscriptFingerprint: restored.manuscriptFingerprint,
      batchId: restored.batchId,
      category: restored.category,
      severity: restored.severity,
      claim: restored.claim,
      evidence: restored.evidence,
      file: restored.file,
      startLine: restored.startLine,
      endLine: restored.endLine,
      sectionId: restored.sectionId,
    })
    expect(recomputed).toBe(finding.findingId)
  })
})

describe("mergeAnalysisFindings", () => {
  test("removes exact duplicates and preserves first-occurrence order", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const b = createAnalysisFinding(plan, baseInput(plan, { claim: "B" }))
    const c = createAnalysisFinding(plan, baseInput(plan, { claim: "C" }))
    const aDup = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))

    const merged = mergeAnalysisFindings([a, b], [aDup, c, b])
    expect(merged.map((f) => f.claim)).toEqual(["A", "B", "C"])
    expect(merged).toHaveLength(3)
    expect(merged[0].findingId).toBe(a.findingId)
  })

  test("preserves different records", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "one" }))
    const b = createAnalysisFinding(plan, baseInput(plan, { claim: "two" }))
    const merged = mergeAnalysisFindings([a], [b])
    expect(merged).toHaveLength(2)
    expect(merged[0].claim).toBe("one")
    expect(merged[1].claim).toBe("two")
  })

  test("repeated merge is idempotent", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const b = createAnalysisFinding(plan, baseInput(plan, { claim: "B" }))
    const once = mergeAnalysisFindings([a], [b, a])
    const twice = mergeAnalysisFindings(once, once)
    const thrice = mergeAnalysisFindings(twice, [a, b])
    expect(twice).toEqual(once)
    expect(thrice).toEqual(once)
  })

  test("does not mutate inputs (arrays or objects)", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const b = createAnalysisFinding(plan, baseInput(plan, { claim: "B" }))
    const existing = [a]
    const incoming = [b, a]
    const existingSnap = deepCloneJson(existing)
    const incomingSnap = deepCloneJson(incoming)
    const aSnap = deepCloneJson(a)
    const planSnap = deepCloneJson(plan)

    const merged = mergeAnalysisFindings(existing, incoming)
    expect(merged).toHaveLength(2)

    expect(existing).toEqual(existingSnap)
    expect(incoming).toEqual(incomingSnap)
    expect(a).toEqual(aSnap)
    expect(plan).toEqual(planSnap)

    // Mutating result must not affect originals
    merged[0].claim = "mutated"
    expect(a.claim).toBe("A")
    expect(existing[0].claim).toBe("A")
  })

  test("createAnalysisFinding does not mutate plan or input", () => {
    const plan = threeBatchPlan()
    const input = baseInput(plan, {
      category: "  structure  ",
      claim: "  claim  ",
    })
    const planSnap = deepCloneJson(plan)
    const inputSnap = deepCloneJson(input)

    createAnalysisFinding(plan, input)

    expect(plan).toEqual(planSnap)
    expect(input).toEqual(inputSnap)
  })

  test("rejects same findingId with different payload", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const collision: AnalysisFinding = {
      ...a,
      claim: "tampered claim with same id",
    }

    expect(() => mergeAnalysisFindings([a], [collision])).toThrow(
      AnalysisFindingError,
    )

    try {
      mergeAnalysisFindings([a], [collision])
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("finding_id_collision")
    }
  })
})
