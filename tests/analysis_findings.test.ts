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

/** Build multi-line SourceSpan text from real line breaks (planner uses `\n`). */
function linesText(lines: string[]): string {
  return lines.join("\n")
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
 * Multi-line spans with real newlines so planner-derived line ranges are meaningful.
 * chap.tex lines 1-5 (two contiguous source spans → union coverage in one batch),
 * other.tex lines 10-12. Large budget keeps everything in a single batch.
 */
function multiLinePlan(): ExhaustiveAnalysisPlan {
  return planExhaustiveAnalysisBatches(
    manuscript([
      span("chap.tex", linesText(["L1aaaa", "L2bbbb", "L3cccc"]), 1, 3),
      span("chap.tex", linesText(["L4dddd", "L5eeee"]), 4, 5),
      span("other.tex", linesText(["O10xx", "O11yy", "O12zz"]), 10, 12),
    ]),
    200,
  )
}

/**
 * Same file with a deliberate gap in coverage (lines 1-2 and 5-6, no 3-4).
 */
function gappedMultiLinePlan(): ExhaustiveAnalysisPlan {
  return planExhaustiveAnalysisBatches(
    manuscript([
      span("chap.tex", linesText(["L1aaaa", "L2bbbb"]), 1, 2),
      span("chap.tex", linesText(["L5eeee", "L6ffff"]), 5, 6),
    ]),
    200,
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

  test("rejects malformed plan via canonical assertPlanShape", () => {
    const plan = threeBatchPlan()
    const broken = deepCloneJson(plan) as ExhaustiveAnalysisPlan
    // Violate complete-plan invariant checked by analysis_checkpoint.assertPlanShape
    broken.coverage.coveragePercent = 50

    try {
      createAnalysisFinding(broken, baseInput(plan))
      expect.unreachable("expected invalid_plan")
    } catch (e) {
      expect(e).toBeInstanceOf(AnalysisFindingError)
      expect((e as AnalysisFindingError).code).toBe("invalid_plan")
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

  test("rejects malformed chunk provenance with invalid_plan (fail-closed)", () => {
    const plan = threeBatchPlan()
    const input = baseInput(plan)

    const expectInvalidPlan = (mutator: (p: ExhaustiveAnalysisPlan) => void) => {
      const tampered = deepCloneJson(plan) as ExhaustiveAnalysisPlan
      mutator(tampered)
      try {
        createAnalysisFinding(tampered, input)
        expect.unreachable("expected invalid_plan")
      } catch (e) {
        expect(e).toBeInstanceOf(AnalysisFindingError)
        expect((e as AnalysisFindingError).code).toBe("invalid_plan")
      }
    }

    // Bad line range on source
    expectInvalidPlan((p) => {
      p.batches[0].chunks[0].source.startLine = 0
    })

    // Missing text
    expectInvalidPlan((p) => {
      delete (p.batches[0].chunks[0] as { text?: string }).text
    })

    // Wrong endOffset vs text.length
    expectInvalidPlan((p) => {
      const c = p.batches[0].chunks[0]
      c.source.endOffset = c.source.startOffset + c.text.length + 1
    })

    // Wrong global chunk.index
    expectInvalidPlan((p) => {
      p.batches[0].chunks[0].index = 99
    })

    // batch.characters != sum of text lengths
    expectInvalidPlan((p) => {
      p.batches[0].characters = p.batches[0].characters + 1
    })

    // Invalid sourceSpanIndex
    expectInvalidPlan((p) => {
      p.batches[0].chunks[0].source.sourceSpanIndex = -1
    })

    // Invalid offsets (startOffset > endOffset)
    expectInvalidPlan((p) => {
      const c = p.batches[0].chunks[0]
      c.source.startOffset = 5
      c.source.endOffset = 2
      // keep characters consistent enough that only offset shape fails first
    })

    // Non-integer offsets
    expectInvalidPlan((p) => {
      p.batches[0].chunks[0].source.startOffset = 0.5 as unknown as number
    })
  })
})

describe("mid-line split provenance", () => {
  test("same physical line across batches allows findings on each fragment batch", () => {
    // Single line, 10 chars, budget 4 → three batches on the same line numbers.
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("line.tex", "0123456789", 1, 1)]),
      4,
    )
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBe(3)

    const b0 = plan.batches[0]
    const b1 = plan.batches[1]
    const c0 = b0.chunks[0]
    const c1 = b1.chunks[0]

    // Same line provenance, different character slices
    expect(c0.source.startLine).toBe(1)
    expect(c0.source.endLine).toBe(1)
    expect(c1.source.startLine).toBe(1)
    expect(c1.source.endLine).toBe(1)
    expect(c0.source.startOffset).toBe(0)
    expect(c0.source.endOffset).toBe(4)
    expect(c1.source.startOffset).toBe(4)
    expect(c1.source.endOffset).toBe(8)
    expect(c0.text).toBe("0123")
    expect(c1.text).toBe("4567")
    expect(c0.index).toBe(0)
    expect(c1.index).toBe(1)

    const onBatch0 = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: b0.batchId,
        file: "line.tex",
        startLine: 1,
        endLine: 1,
        claim: "finding on first mid-line fragment",
      }),
    )
    const onBatch1 = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: b1.batchId,
        file: "line.tex",
        startLine: 1,
        endLine: 1,
        claim: "finding on second mid-line fragment",
      }),
    )

    expect(onBatch0.batchId).toBe(b0.batchId)
    expect(onBatch1.batchId).toBe(b1.batchId)
    expect(onBatch0.startLine).toBe(1)
    expect(onBatch1.startLine).toBe(1)
    expect(onBatch0.findingId).not.toBe(onBatch1.findingId)
  })
})

describe("line-range coverage (real newlines)", () => {
  test("contiguous chunk union is accepted; partial outside is rejected", () => {
    const plan = multiLinePlan()
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBe(1)

    const batch = plan.batches[0]
    const chapChunks = batch.chunks.filter((c) => c.source.file === "chap.tex")
    expect(chapChunks.length).toBe(2)
    // Real newline spans: lines 1-3 and 4-5 → union 1-5
    expect(chapChunks[0].source.startLine).toBe(1)
    expect(chapChunks[0].source.endLine).toBe(3)
    expect(chapChunks[1].source.startLine).toBe(4)
    expect(chapChunks[1].source.endLine).toBe(5)

    const mk = (startLine: number, endLine: number) =>
      createAnalysisFinding(
        plan,
        baseInput(plan, {
          batchId: batch.batchId,
          file: "chap.tex",
          startLine,
          endLine,
          manuscriptFingerprint: plan.fingerprint!,
        }),
      )

    // Full contiguous union
    expect(mk(1, 5).file).toBe("chap.tex")
    // Single-chunk interiors
    expect(mk(1, 3).startLine).toBe(1)
    expect(mk(4, 5).endLine).toBe(5)
    // Single lines inside union
    expect(mk(2, 2).startLine).toBe(2)
    expect(mk(3, 4).startLine).toBe(3)

    // Before coverage
    expect(() => mk(0 as unknown as number, 1)).toThrow(AnalysisFindingError)
    // After coverage
    expect(() => mk(6, 7)).toThrow(AnalysisFindingError)
    // Partial outside (ends after union)
    expect(() => mk(1, 6)).toThrow(AnalysisFindingError)
    // Partial outside (starts before — invalid line also caught)
    expect(() => mk(1, 6)).toThrow(AnalysisFindingError)

    try {
      mk(5, 6)
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("line_range_not_covered")
    }
  })

  test("gap in coverage is rejected; each side of the gap is accepted", () => {
    const plan = gappedMultiLinePlan()
    expect(plan.batches.length).toBe(1)
    const batch = plan.batches[0]
    const chapChunks = batch.chunks.filter((c) => c.source.file === "chap.tex")
    expect(chapChunks.length).toBe(2)
    expect(chapChunks[0].source).toMatchObject({ startLine: 1, endLine: 2 })
    expect(chapChunks[1].source).toMatchObject({ startLine: 5, endLine: 6 })

    const mk = (startLine: number, endLine: number) =>
      createAnalysisFinding(
        plan,
        baseInput(plan, {
          batchId: batch.batchId,
          file: "chap.tex",
          startLine,
          endLine,
          manuscriptFingerprint: plan.fingerprint!,
        }),
      )

    expect(mk(1, 2).endLine).toBe(2)
    expect(mk(5, 6).startLine).toBe(5)
    // Gap lines 3-4 are not covered
    expect(() => mk(1, 5)).toThrow(AnalysisFindingError)
    expect(() => mk(2, 5)).toThrow(AnalysisFindingError)
    expect(() => mk(3, 4)).toThrow(AnalysisFindingError)
    expect(() => mk(4, 5)).toThrow(AnalysisFindingError)

    try {
      mk(1, 6)
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("line_range_not_covered")
    }
  })

  test("independent startLine/endLine changes alter findingId", () => {
    const plan = multiLinePlan()
    const batch = plan.batches[0]
    const base = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: batch.batchId,
        file: "chap.tex",
        startLine: 1,
        endLine: 5,
        manuscriptFingerprint: plan.fingerprint!,
      }),
    )
    const byStart = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: batch.batchId,
        file: "chap.tex",
        startLine: 2,
        endLine: 5,
        manuscriptFingerprint: plan.fingerprint!,
      }),
    )
    const byEnd = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: batch.batchId,
        file: "chap.tex",
        startLine: 1,
        endLine: 4,
        manuscriptFingerprint: plan.fingerprint!,
      }),
    )
    const single = createAnalysisFinding(
      plan,
      baseInput(plan, {
        batchId: batch.batchId,
        file: "chap.tex",
        startLine: 1,
        endLine: 1,
        manuscriptFingerprint: plan.fingerprint!,
      }),
    )

    expect(byStart.findingId).not.toBe(base.findingId)
    expect(byEnd.findingId).not.toBe(base.findingId)
    expect(single.findingId).not.toBe(base.findingId)
    expect(byStart.findingId).not.toBe(byEnd.findingId)
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

  test("rejects tampered payload whose findingId no longer matches", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const tampered: AnalysisFinding = {
      ...a,
      claim: "tampered claim with same id",
    }

    expect(() => mergeAnalysisFindings([a], [tampered])).toThrow(
      AnalysisFindingError,
    )

    try {
      mergeAnalysisFindings([a], [tampered])
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("finding_id_mismatch")
    }
  })

  test("rejects structurally invalid findings from existing", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))

    const cases: Array<{ label: string; finding: unknown; code: string }> = [
      {
        label: "missing category",
        finding: { ...a, category: "" },
        code: "invalid_finding",
      },
      {
        label: "whitespace claim",
        finding: { ...a, claim: "   " },
        code: "invalid_finding",
      },
      {
        label: "non-object",
        finding: null,
        code: "invalid_finding",
      },
      {
        label: "bad startLine",
        finding: { ...a, startLine: 0 },
        code: "invalid_finding",
      },
      {
        label: "inverted lines",
        finding: { ...a, startLine: 3, endLine: 1 },
        code: "invalid_finding",
      },
      {
        label: "empty file",
        finding: { ...a, file: "" },
        code: "invalid_finding",
      },
      {
        label: "empty planId",
        finding: { ...a, planId: "" },
        code: "invalid_finding",
      },
      {
        label: "empty batchId",
        finding: { ...a, batchId: "" },
        code: "invalid_finding",
      },
      {
        label: "empty fingerprint",
        finding: { ...a, manuscriptFingerprint: "" },
        code: "invalid_finding",
      },
      {
        label: "wrong version",
        finding: { ...a, version: "analysis-finding-v0" },
        code: "invalid_finding",
      },
    ]

    for (const c of cases) {
      try {
        mergeAnalysisFindings([c.finding as AnalysisFinding], [])
        expect.unreachable(`expected reject for ${c.label}`)
      } catch (e) {
        expect(e).toBeInstanceOf(AnalysisFindingError)
        expect((e as AnalysisFindingError).code).toBe(c.code)
      }
    }
  })

  test("rejects structurally invalid findings from incoming", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const bad = { ...a, severity: "" }

    try {
      mergeAnalysisFindings([a], [bad as AnalysisFinding])
      expect.unreachable("expected invalid_finding")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_finding")
    }
  })

  test("rejects findingId that does not match recomputed payload identity", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const mismatched: AnalysisFinding = {
      ...a,
      findingId: "f".repeat(64),
    }

    try {
      mergeAnalysisFindings([], [mismatched])
      expect.unreachable("expected finding_id_mismatch")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("finding_id_mismatch")
    }

    try {
      mergeAnalysisFindings([mismatched], [])
      expect.unreachable("expected finding_id_mismatch from existing")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("finding_id_mismatch")
    }
  })

  test("rejects wrong version even when findingId is recomputed for that version", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan))
    // Identity for a different version would differ; still reject on version gate.
    const wrongVersion = {
      ...a,
      version: "analysis-finding-v0" as typeof ANALYSIS_FINDING_VERSION,
      findingId: computeFindingIdentity({
        version: "analysis-finding-v0",
        planId: a.planId,
        manuscriptFingerprint: a.manuscriptFingerprint,
        batchId: a.batchId,
        category: a.category,
        severity: a.severity,
        claim: a.claim,
        evidence: a.evidence,
        file: a.file,
        startLine: a.startLine,
        endLine: a.endLine,
        sectionId: a.sectionId,
      }),
    }

    try {
      mergeAnalysisFindings([wrongVersion as AnalysisFinding], [])
      expect.unreachable("expected invalid_finding for wrong version")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_finding")
    }
  })

  test("rejects padded claim even when findingId is recomputed over padded value", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const paddedClaim = " A "
    const padded: AnalysisFinding = {
      ...a,
      claim: paddedClaim,
      findingId: computeFindingIdentity({
        version: a.version,
        planId: a.planId,
        manuscriptFingerprint: a.manuscriptFingerprint,
        batchId: a.batchId,
        category: a.category,
        severity: a.severity,
        claim: paddedClaim,
        evidence: a.evidence,
        file: a.file,
        startLine: a.startLine,
        endLine: a.endLine,
        sectionId: a.sectionId,
      }),
    }

    try {
      mergeAnalysisFindings([padded], [])
      expect.unreachable("expected invalid_finding for padded claim")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_finding")
    }

    // create still trims; resulting canonical finding merges
    const fromCreate = createAnalysisFinding(
      plan,
      baseInput(plan, { claim: "  padded-create  " }),
    )
    expect(fromCreate.claim).toBe("padded-create")
    const merged = mergeAnalysisFindings([fromCreate], [fromCreate])
    expect(merged).toHaveLength(1)
    expect(merged[0].claim).toBe("padded-create")
  })

  test("rejects unknown extra property even if findingId matches core fields", () => {
    const plan = threeBatchPlan()
    const a = createAnalysisFinding(plan, baseInput(plan, { claim: "A" }))
    const withExtra = { ...a, extra: 1 }

    try {
      mergeAnalysisFindings([withExtra as AnalysisFinding], [])
      expect.unreachable("expected invalid_finding for extra key")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_finding")
    }

    // Missing key also rejected
    const { evidence: _drop, ...missing } = a
    try {
      mergeAnalysisFindings([missing as AnalysisFinding], [])
      expect.unreachable("expected invalid_finding for missing key")
    } catch (e) {
      expect((e as AnalysisFindingError).code).toBe("invalid_finding")
    }
  })
})
