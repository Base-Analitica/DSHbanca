import { describe, test, expect } from "bun:test"
import {
  planAnalysisCoverage,
  planExhaustiveAnalysisBatches,
  type AnalysisCoveragePlan,
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
    rootFile?: string
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
    rootFile: opts?.rootFile ?? "main.tex",
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

describe("planAnalysisCoverage", () => {
  test("document smaller than budget → complete", () => {
    const ms = manuscript([span("main.tex", "hello")])
    const plan = planAnalysisCoverage(ms, 100)

    expect(plan.coverage.status).toBe("complete")
    expect(plan.coverage.strategy).toBe("ordered-source-spans-prefix-v1")
    expect(plan.coverage.budgetCharacters).toBe(100)
    expect(plan.coverage.totalCharacters).toBe(5)
    expect(plan.coverage.includedCharacters).toBe(5)
    expect(plan.coverage.coveragePercent).toBe(100)
    expect(plan.coverage.includedSpans).toEqual([
      { file: "main.tex", startLine: 1, endLine: 1, characters: 5 },
    ])
    expect(plan.coverage.omittedSpans).toEqual([])
    expect(plan.chunks).toEqual([
      {
        index: 0,
        text: "hello",
        source: { file: "main.tex", startLine: 1, endLine: 1, characters: 5 },
      },
    ])
    expect(plan.fingerprint).toBe(FP)
    expect(plan.diagnostics).toEqual([])
  })

  test("document exactly at budget → complete", () => {
    const ms = manuscript([
      span("a.tex", "ab"),
      span("b.tex", "cd"),
    ])
    const plan = planAnalysisCoverage(ms, 4)

    expect(plan.coverage.status).toBe("complete")
    expect(plan.coverage.totalCharacters).toBe(4)
    expect(plan.coverage.includedCharacters).toBe(4)
    expect(plan.coverage.coveragePercent).toBe(100)
    expect(plan.coverage.omittedSpans).toEqual([])
    expect(plan.chunks.map((c) => c.text)).toEqual(["ab", "cd"])
    expect(plan.chunks.map((c) => c.index)).toEqual([0, 1])
  })

  test("document one character over budget → partial", () => {
    const ms = manuscript([
      span("a.tex", "ab"),
      span("b.tex", "cd"),
    ])
    // total 4; budget 3 → first span (2) fits, second (2) exceeds remaining 1
    const plan = planAnalysisCoverage(ms, 3)

    expect(plan.coverage.status).toBe("partial")
    expect(plan.coverage.totalCharacters).toBe(4)
    expect(plan.coverage.includedCharacters).toBe(2)
    expect(plan.coverage.coveragePercent).toBe(50)
    expect(plan.chunks).toEqual([
      {
        index: 0,
        text: "ab",
        source: { file: "a.tex", startLine: 1, endLine: 1, characters: 2 },
      },
    ])
    expect(plan.coverage.includedSpans).toEqual([
      { file: "a.tex", startLine: 1, endLine: 1, characters: 2 },
    ])
    expect(plan.coverage.omittedSpans).toEqual([
      {
        file: "b.tex",
        startLine: 1,
        endLine: 1,
        characters: 2,
        reason: "budget_exceeded",
      },
    ])
    // Omitted spans must not embed the full text
    for (const o of plan.coverage.omittedSpans) {
      expect("text" in o).toBe(false)
    }
  })

  test("first span larger than budget → zero chunks and explicit omission, no mid-cut", () => {
    const big = "ABCDEFGHIJ" // 10
    const ms = manuscript([span("main.tex", big, 1, 3)])
    const plan = planAnalysisCoverage(ms, 5)

    expect(plan.coverage.status).toBe("partial")
    expect(plan.chunks).toEqual([])
    expect(plan.coverage.includedCharacters).toBe(0)
    expect(plan.coverage.includedSpans).toEqual([])
    expect(plan.coverage.omittedSpans).toEqual([
      {
        file: "main.tex",
        startLine: 1,
        endLine: 3,
        characters: 10,
        reason: "budget_exceeded",
      },
    ])
    expect(plan.coverage.coveragePercent).toBe(0)
    // No truncated fragment of the span text appears as a chunk
    expect(plan.chunks.every((c) => c.text === big || c.text.length === 0)).toBe(
      true,
    )
  })

  test("multiple spans preserve order and provenance", () => {
    const ms = manuscript([
      span("ch1.tex", "one", 1, 1),
      span("ch2.tex", "two!", 2, 4),
      span("ch3.tex", "three", 10, 12),
    ])
    const plan = planAnalysisCoverage(ms, 1000)

    expect(plan.coverage.status).toBe("complete")
    expect(plan.chunks).toEqual([
      {
        index: 0,
        text: "one",
        source: { file: "ch1.tex", startLine: 1, endLine: 1, characters: 3 },
      },
      {
        index: 1,
        text: "two!",
        source: { file: "ch2.tex", startLine: 2, endLine: 4, characters: 4 },
      },
      {
        index: 2,
        text: "three",
        source: { file: "ch3.tex", startLine: 10, endLine: 12, characters: 5 },
      },
    ])
    expect(plan.coverage.includedSpans.map((s) => s.file)).toEqual([
      "ch1.tex",
      "ch2.tex",
      "ch3.tex",
    ])
  })

  test("after first omitted span, smaller later spans are also omitted (no backfill)", () => {
    const ms = manuscript([
      span("a.tex", "AAAA"), // 4
      span("b.tex", "BBBBBB"), // 6 — exceeds remaining when budget is 5 after a
      span("c.tex", "C"), // 1 — would fit residual 1, but must be omitted
    ])
    // budget 5: include AAAA (4), remaining 1; BBBBBB (6) exceeds → omit B and C
    const plan = planAnalysisCoverage(ms, 5)

    expect(plan.coverage.status).toBe("partial")
    expect(plan.chunks.map((c) => c.text)).toEqual(["AAAA"])
    expect(plan.coverage.includedCharacters).toBe(4)
    expect(plan.coverage.omittedSpans).toEqual([
      {
        file: "b.tex",
        startLine: 1,
        endLine: 1,
        characters: 6,
        reason: "budget_exceeded",
      },
      {
        file: "c.tex",
        startLine: 1,
        endLine: 1,
        characters: 1,
        reason: "budget_exceeded",
      },
    ])
    expect(plan.coverage.totalCharacters).toBe(11)
    // 4/11 * 100 = 36.3636... → 36.36
    expect(plan.coverage.coveragePercent).toBe(36.36)
  })

  test("empty markers before the cut are preserved", () => {
    const ms = manuscript([
      span("main.tex", ""),
      span("intro.tex", "hello"), // 5
      span("empty2.tex", ""),
      span("body.tex", "world!!!"), // 8
    ])
    // budget 5: empty + hello (0+5) fit; empty2 after cut? wait:
    // remaining after hello = 0; empty2 has len 0, 0 > remaining 0 is false, so empty fits
    // Actually 0 > 0 is false, so empty markers with length 0 always fit while not omitting.
    // Policy: include while sum does not exceed budget; 0-length never exceeds.
    // body (8) exceeds remaining 0 → omit body only? empty2 before body:
    // after hello remaining 0; empty2 len 0, 0 > 0 false → include empty2; remaining still 0
    // body 8 > 0 → omit body
    const plan = planAnalysisCoverage(ms, 5)

    expect(plan.coverage.status).toBe("partial")
    expect(plan.chunks.map((c) => ({ file: c.source.file, text: c.text }))).toEqual([
      { file: "main.tex", text: "" },
      { file: "intro.tex", text: "hello" },
      { file: "empty2.tex", text: "" },
    ])
    expect(plan.coverage.omittedSpans).toEqual([
      {
        file: "body.tex",
        startLine: 1,
        endLine: 1,
        characters: 8,
        reason: "budget_exceeded",
      },
    ])
  })

  test("document of only empty spans → complete and 100%", () => {
    const ms = manuscript([
      span("a.tex", ""),
      span("b.tex", ""),
    ])
    const plan = planAnalysisCoverage(ms, 0)

    expect(plan.coverage.status).toBe("complete")
    expect(plan.coverage.totalCharacters).toBe(0)
    expect(plan.coverage.includedCharacters).toBe(0)
    expect(plan.coverage.coveragePercent).toBe(100)
    expect(plan.chunks).toHaveLength(2)
    expect(plan.coverage.omittedSpans).toEqual([])
    expect(plan.fingerprint).toBe(FP)
  })

  test("incomplete manuscript → blocked, zero chunks, null fingerprint", () => {
    const diags: LoaderDiagnostic[] = [
      {
        code: "include_not_found",
        severity: "error",
        file: "main.tex",
        message: "missing include",
      },
    ]
    const ms = manuscript(
      [span("main.tex", "partial content"), span("ch.tex", "more")],
      { complete: false, fingerprint: null, diagnostics: diags },
    )
    const plan = planAnalysisCoverage(ms, 10_000)

    expect(plan.coverage.status).toBe("blocked")
    expect(plan.chunks).toEqual([])
    expect(plan.coverage.includedCharacters).toBe(0)
    expect(plan.coverage.coveragePercent).toBe(0)
    expect(plan.coverage.includedSpans).toEqual([])
    expect(plan.coverage.totalCharacters).toBe(
      "partial content".length + "more".length,
    )
    expect(plan.coverage.omittedSpans).toEqual([
      {
        file: "main.tex",
        startLine: 1,
        endLine: 1,
        characters: "partial content".length,
        reason: "manuscript_incomplete",
      },
      {
        file: "ch.tex",
        startLine: 1,
        endLine: 1,
        characters: 4,
        reason: "manuscript_incomplete",
      },
    ])
    expect(plan.fingerprint).toBeNull()
    expect(plan.diagnostics).toEqual(diags)
    // Diagnostics are a copy, not the same array reference
    expect(plan.diagnostics).not.toBe(ms.diagnostics)
  })

  test("complete false alone or null fingerprint alone both block", () => {
    const a = planAnalysisCoverage(
      manuscript([span("a.tex", "x")], { complete: false, fingerprint: FP }),
      10,
    )
    expect(a.coverage.status).toBe("blocked")
    expect(a.chunks).toEqual([])
    expect(a.fingerprint).toBeNull()

    const b = planAnalysisCoverage(
      manuscript([span("a.tex", "x")], { complete: true, fingerprint: null }),
      10,
    )
    expect(b.coverage.status).toBe("blocked")
    expect(b.chunks).toEqual([])
    expect(b.fingerprint).toBeNull()
  })

  test("canonical fingerprint is propagated when coverage is partial", () => {
    const fp = "deadbeef".repeat(8)
    const ms = manuscript(
      [span("a.tex", "hello"), span("b.tex", "world-extra")],
      { fingerprint: fp },
    )
    const plan = planAnalysisCoverage(ms, 5)

    expect(plan.coverage.status).toBe("partial")
    expect(plan.fingerprint).toBe(fp)
    expect(plan.chunks).toHaveLength(1)
    expect(plan.chunks[0].text).toBe("hello")
  })

  test("budget zero omits all non-empty spans", () => {
    const ms = manuscript([
      span("a.tex", "x"),
      span("b.tex", "yy"),
    ])
    const plan = planAnalysisCoverage(ms, 0)

    expect(plan.coverage.status).toBe("partial")
    expect(plan.chunks).toEqual([])
    expect(plan.coverage.includedCharacters).toBe(0)
    expect(plan.coverage.coveragePercent).toBe(0)
    expect(plan.coverage.omittedSpans).toEqual([
      {
        file: "a.tex",
        startLine: 1,
        endLine: 1,
        characters: 1,
        reason: "budget_exceeded",
      },
      {
        file: "b.tex",
        startLine: 1,
        endLine: 1,
        characters: 2,
        reason: "budget_exceeded",
      },
    ])
  })

  test("negative, fractional, NaN, and infinite budgets throw RangeError", () => {
    const ms = manuscript([span("a.tex", "x")])

    for (const bad of [-1, -0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => planAnalysisCoverage(ms, bad)).toThrow(RangeError)
    }
  })

  test("same input and budget produce deeply identical objects", () => {
    const ms = manuscript([
      span("a.tex", "ab"),
      span("b.tex", "cdef"),
    ])
    const a = planAnalysisCoverage(ms, 3)
    const b = planAnalysisCoverage(ms, 3)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  test("input manuscript objects are not mutated", () => {
    const sources = [
      span("a.tex", "hello"),
      span("b.tex", "world"),
    ]
    const diags: LoaderDiagnostic[] = [
      {
        code: "read_error",
        severity: "warning",
        message: "note",
      },
    ]
    const ms = manuscript(sources, { diagnostics: diags })
    const before = deepCloneJson(ms)

    planAnalysisCoverage(ms, 3)
    planAnalysisCoverage(ms, 0)
    planAnalysisCoverage(ms, 100)

    expect(ms).toEqual(before)
    expect(ms.orderedSources[0].text).toBe("hello")
    expect(ms.diagnostics).toBe(diags)
  })

  test("coverage percent is never NaN, infinite, or outside 0–100", () => {
    const cases: Array<{ ms: CanonicalLatexManuscriptResult; budget: number }> = [
      { ms: manuscript([]), budget: 0 },
      { ms: manuscript([span("a.tex", "")]), budget: 0 },
      {
        ms: manuscript([span("a.tex", "x")], {
          complete: false,
          fingerprint: null,
        }),
        budget: 0,
      },
      {
        ms: manuscript([span("a.tex", "abcdefghij"), span("b.tex", "k")]),
        budget: 3,
      },
      {
        ms: manuscript([span("a.tex", "ab"), span("b.tex", "c")]),
        budget: 2,
      },
    ]

    for (const { ms, budget } of cases) {
      const plan = planAnalysisCoverage(ms, budget)
      const p = plan.coverage.coveragePercent
      expect(Number.isFinite(p)).toBe(true)
      expect(Number.isNaN(p)).toBe(false)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThanOrEqual(100)
    }
  })

  test("UTF-16 code units: surrogate pair counts as length 2", () => {
    // U+1F600 😀 is one code point, two UTF-16 code units
    const emoji = "😀"
    expect(emoji.length).toBe(2)
    const ms = manuscript([span("a.tex", emoji)])
    const plan = planAnalysisCoverage(ms, 2)
    expect(plan.coverage.status).toBe("complete")
    expect(plan.coverage.totalCharacters).toBe(2)
    expect(plan.coverage.includedCharacters).toBe(2)

    const partial = planAnalysisCoverage(ms, 1)
    expect(partial.coverage.status).toBe("partial")
    expect(partial.chunks).toEqual([])
    expect(partial.coverage.omittedSpans[0].characters).toBe(2)
  })

  test("plan structure always carries strategy and budgetCharacters", () => {
    const plan: AnalysisCoveragePlan = planAnalysisCoverage(
      manuscript([span("a.tex", "z")]),
      1,
    )
    expect(plan.coverage.strategy).toBe("ordered-source-spans-prefix-v1")
    expect(plan.coverage.budgetCharacters).toBe(1)
  })

  test("null or undefined manuscript throws TypeError", () => {
    expect(() =>
      planAnalysisCoverage(null as unknown as CanonicalLatexManuscriptResult, 10),
    ).toThrow(TypeError)
    expect(() =>
      planAnalysisCoverage(
        undefined as unknown as CanonicalLatexManuscriptResult,
        10,
      ),
    ).toThrow(TypeError)
    // Budget is still validated first for invalid budgets
    expect(() =>
      planAnalysisCoverage(null as unknown as CanonicalLatexManuscriptResult, -1),
    ).toThrow(RangeError)
  })

  test("missing orderedSources throws TypeError (never complete/100%)", () => {
    const partial = {
      rootFile: "main.tex",
      complete: true,
      fingerprint: FP,
      fingerprintVersion: VERSION,
      diagnostics: [],
    } as unknown as CanonicalLatexManuscriptResult

    expect(() => planAnalysisCoverage(partial, 10)).toThrow(TypeError)
    expect(() => planAnalysisCoverage(partial, 10)).toThrow(
      /orderedSources must be an array/,
    )
  })

  test("non-array orderedSources throws TypeError", () => {
    const partial = {
      rootFile: "main.tex",
      orderedSources: "not-an-array",
      diagnostics: [],
      complete: true,
      fingerprint: FP,
      fingerprintVersion: VERSION,
    } as unknown as CanonicalLatexManuscriptResult

    expect(() => planAnalysisCoverage(partial, 10)).toThrow(TypeError)
  })

  test("missing diagnostics throws TypeError", () => {
    const partial = {
      rootFile: "main.tex",
      orderedSources: [span("a.tex", "x")],
      complete: true,
      fingerprint: FP,
      fingerprintVersion: VERSION,
    } as unknown as CanonicalLatexManuscriptResult

    expect(() => planAnalysisCoverage(partial, 10)).toThrow(TypeError)
    expect(() => planAnalysisCoverage(partial, 10)).toThrow(
      /diagnostics must be an array/,
    )
  })

  test("missing span.text throws TypeError (never silent empty chunk)", () => {
    const brokenSpan = {
      file: "a.tex",
      startLine: 1,
      endLine: 1,
    } as unknown as SourceSpan
    const ms = manuscript([brokenSpan, span("b.tex", "hi")])

    expect(() => planAnalysisCoverage(ms, 10)).toThrow(TypeError)
    expect(() => planAnalysisCoverage(ms, 10)).toThrow(/text must be a string/)
  })

  test("span with invalid provenance throws TypeError", () => {
    const badFile = {
      file: 123,
      startLine: 1,
      endLine: 1,
      text: "x",
    } as unknown as SourceSpan
    expect(() => planAnalysisCoverage(manuscript([badFile]), 10)).toThrow(
      TypeError,
    )

    const badLines = {
      file: "a.tex",
      startLine: 5,
      endLine: 2,
      text: "x",
    } as unknown as SourceSpan
    expect(() => planAnalysisCoverage(manuscript([badLines]), 10)).toThrow(
      TypeError,
    )
  })

  test("undefined complete with fingerprint throws TypeError (not analyzable)", () => {
    const ms = {
      rootFile: "main.tex",
      orderedSources: [span("a.tex", "x")],
      diagnostics: [],
      fingerprint: FP,
      fingerprintVersion: VERSION,
    } as unknown as CanonicalLatexManuscriptResult

    expect(() => planAnalysisCoverage(ms, 100)).toThrow(TypeError)
    expect(() => planAnalysisCoverage(ms, 100)).toThrow(/complete must be true/)
  })

  test("absent fingerprint throws TypeError (never complete with undefined fp)", () => {
    const ms = {
      rootFile: "main.tex",
      orderedSources: [span("a.tex", "hello")],
      diagnostics: [],
      complete: true,
      fingerprintVersion: VERSION,
    } as unknown as CanonicalLatexManuscriptResult

    expect(() => planAnalysisCoverage(ms, 100)).toThrow(TypeError)
    expect(() => planAnalysisCoverage(ms, 100)).toThrow(
      /fingerprint must be a non-empty string/,
    )
  })

  test("undefined fingerprint with complete true throws TypeError", () => {
    const ms = manuscript([span("a.tex", "x")], {
      complete: true,
      fingerprint: undefined as unknown as null,
    })
    // Force undefined rather than null
    const raw = {
      ...ms,
      fingerprint: undefined,
    } as unknown as CanonicalLatexManuscriptResult

    expect(() => planAnalysisCoverage(raw, 10)).toThrow(TypeError)
  })

  test("empty string fingerprint throws TypeError", () => {
    const ms = manuscript([span("a.tex", "x")], {
      complete: true,
      fingerprint: "",
    })
    expect(() => planAnalysisCoverage(ms, 10)).toThrow(TypeError)
    expect(() => planAnalysisCoverage(ms, 10)).toThrow(
      /fingerprint must be a non-empty string/,
    )
  })

  test("loader-shaped incomplete remains blocked not TypeError", () => {
    const ms = manuscript([span("a.tex", "partial")], {
      complete: false,
      fingerprint: null,
    })
    const plan = planAnalysisCoverage(ms, 1000)
    expect(plan.coverage.status).toBe("blocked")
    expect(plan.chunks).toEqual([])
    expect(plan.fingerprint).toBeNull()
    expect(plan.coverage.coveragePercent).toBe(0)
    expect(plan.coverage.omittedSpans[0].reason).toBe("manuscript_incomplete")
  })

  test("complete true with fingerprint null is blocked", () => {
    const ms = manuscript([span("a.tex", "x")], {
      complete: true,
      fingerprint: null,
    })
    const plan = planAnalysisCoverage(ms, 10)
    expect(plan.coverage.status).toBe("blocked")
    expect(plan.chunks).toEqual([])
    expect(plan.fingerprint).toBeNull()
  })

  test("one-step percent rounding still yields 36.36 for 4/11", () => {
    const ms = manuscript([
      span("a.tex", "AAAA"),
      span("b.tex", "BBBBBB"),
      span("c.tex", "C"),
    ])
    const plan = planAnalysisCoverage(ms, 5)
    expect(plan.coverage.includedCharacters).toBe(4)
    expect(plan.coverage.totalCharacters).toBe(11)
    expect(plan.coverage.coveragePercent).toBe(36.36)
    expect(plan.coverage.status).toBe("partial")
  })

  test("empty orderedSources array with valid complete+fingerprint is complete 100%", () => {
    // Explicit empty array is valid (zero-span document), unlike missing property.
    const ms = manuscript([])
    const plan = planAnalysisCoverage(ms, 0)
    expect(plan.coverage.status).toBe("complete")
    expect(plan.coverage.coveragePercent).toBe(100)
    expect(plan.chunks).toEqual([])
    expect(plan.fingerprint).toBe(FP)
  })
})

describe("planExhaustiveAnalysisBatches", () => {
  test("covers every ordered span across first, middle, and last batches", () => {
    const ms = manuscript([
      span("one.tex", "abc", 1, 1),
      span("two.tex", "defg", 2, 2),
      span("three.tex", "hij", 4, 4),
    ])

    const plan = planExhaustiveAnalysisBatches(ms, 4)

    expect(plan.status).toBe("complete")
    expect(plan.fingerprint).toBe(FP)
    expect(plan.strategy).toBe("ordered-source-spans-exhaustive-v1")
    expect(plan.coverage).toEqual({
      totalCharacters: 10,
      plannedCharacters: 10,
      coveragePercent: 100,
      batchCount: 3,
    })
    expect(plan.batches.map((batch) => batch.characters)).toEqual([4, 4, 2])
    expect(plan.batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.text)).join(""))
      .toBe("abcdefghij")
    expect(plan.batches.flatMap((batch) => batch.chunks.map((chunk) => chunk.source))).toEqual([
      { file: "one.tex", startLine: 1, endLine: 1, sourceSpanIndex: 0, startOffset: 0, endOffset: 3 },
      { file: "two.tex", startLine: 2, endLine: 2, sourceSpanIndex: 1, startOffset: 0, endOffset: 1 },
      { file: "two.tex", startLine: 2, endLine: 2, sourceSpanIndex: 1, startOffset: 1, endOffset: 4 },
      { file: "three.tex", startLine: 4, endLine: 4, sourceSpanIndex: 2, startOffset: 0, endOffset: 1 },
      { file: "three.tex", startLine: 4, endLine: 4, sourceSpanIndex: 2, startOffset: 1, endOffset: 3 },
    ])
  })

  test("keeps an exactly fitting document in one batch", () => {
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "abcd")]),
      4,
    )

    expect(plan.status).toBe("complete")
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].characters).toBe(4)
    expect(plan.batches[0].chunks[0].source).toMatchObject({
      sourceSpanIndex: 0,
      startOffset: 0,
      endOffset: 4,
    })
  })

  test("splits a monolithic span across as many batches as required with contiguous offsets", () => {
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "abcdefghij", 8, 8)]),
      3,
    )

    expect(plan.batches.map((batch) => batch.characters)).toEqual([3, 3, 3, 1])
    expect(plan.batches.every((batch) => batch.characters > 0 && batch.characters <= 3)).toBe(true)
    const chunks = plan.batches.flatMap((batch) => batch.chunks)
    expect(chunks.map((chunk) => chunk.text).join("")).toBe("abcdefghij")
    expect(chunks.map((chunk) => [chunk.source.startOffset, chunk.source.endOffset])).toEqual([
      [0, 3], [3, 6], [6, 9], [9, 10],
    ])
    expect(chunks.every((chunk) => chunk.source.sourceSpanIndex === 0)).toBe(true)
  })

  test("splits long single lines and never divides a UTF-16 surrogate pair", () => {
    const text = "ab😀cdef"
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("line.tex", text, 42, 42)]),
      3,
    )

    const chunks = plan.batches.flatMap((batch) => batch.chunks)
    expect(chunks.map((chunk) => chunk.text)).toEqual(["ab", "😀c", "def"])
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text)
    expect(plan.batches.every((batch) => batch.characters <= 3)).toBe(true)
    expect(chunks.every((chunk) => chunk.text.length <= 3)).toBe(true)
    expect(chunks.map((chunk) => [chunk.source.startOffset, chunk.source.endOffset])).toEqual([
      [0, 2], [2, 5], [5, 8],
    ])
  })

  test("rejects a budget that cannot contain an astral UTF-16 scalar", () => {
    expect(() => planExhaustiveAnalysisBatches(
      manuscript([span("line.tex", "😀x")]),
      1,
    )).toThrow(RangeError)
  })

  test("includes the batch budget in deterministic batch identity", () => {
    const ms = manuscript([span("main.tex", "abcdef")])

    const three = planExhaustiveAnalysisBatches(ms, 3)
    const four = planExhaustiveAnalysisBatches(ms, 4)

    expect(three.batches[0].batchId).not.toBe(four.batches[0].batchId)
  })

  test("derives fragment line ranges from multiline source offsets", () => {
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("main.tex", "ab\ncd\nef", 10, 12)]),
      3,
    )

    expect(plan.batches.flatMap((batch) => batch.chunks.map((chunk) => ({
      text: chunk.text,
      startLine: chunk.source.startLine,
      endLine: chunk.source.endLine,
    })))).toEqual([
      { text: "ab\n", startLine: 10, endLine: 10 },
      { text: "cd\n", startLine: 11, endLine: 11 },
      { text: "ef", startLine: 12, endLine: 12 },
    ])
  })

  test("large multiline span with unit batches keeps linear line provenance", () => {
    // Structural regression for O(n²) lineAtOffset rescans: many chunks over one
    // span must still yield offset-derived lines matching loader `\n` semantics
    // (newline stays on the terminating line; endOffset exclusive). Avoids
    // timing assertions — correctness of every unit chunk proves the precomputed
    // index path is used for all offsets.
    const lineBodies = Array.from({ length: 2500 }, (_, i) => `L${String(i).padStart(4, "0")}`)
    const text = lineBodies.join("\n")
    const baseLine = 7
    const plan = planExhaustiveAnalysisBatches(
      manuscript([span("big.tex", text, baseLine, baseLine + lineBodies.length - 1)]),
      1,
    )

    const chunks = plan.batches.flatMap((batch) => batch.chunks)
    expect(chunks).toHaveLength(text.length)
    expect(plan.coverage.plannedCharacters).toBe(text.length)
    expect(chunks.map((chunk) => chunk.text).join("")).toBe(text)

    let expectedLine = baseLine
    for (let offset = 0; offset < text.length; offset++) {
      const chunk = chunks[offset]!
      expect(chunk.text).toBe(text[offset]!)
      expect(chunk.source).toEqual({
        file: "big.tex",
        startLine: expectedLine,
        endLine: expectedLine,
        sourceSpanIndex: 0,
        startOffset: offset,
        endOffset: offset + 1,
      })
      if (text.charCodeAt(offset) === 0x0a) expectedLine += 1
    }
    expect(expectedLine).toBe(baseLine + lineBodies.length - 1)
  })

  test("uses stable unique IDs and does not mutate complete input", () => {
    const ms = manuscript([
      span("a.tex", "abc"),
      span("b.tex", "defgh"),
    ])
    const before = deepCloneJson(ms)
    const first = planExhaustiveAnalysisBatches(ms, 3)
    const second = planExhaustiveAnalysisBatches(ms, 3)
    const ids = first.batches.map((batch) => batch.batchId)

    expect(first).toEqual(second)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ms).toEqual(before)
  })

  test("blocks incomplete manuscripts with copied diagnostics", () => {
    const diagnostics: LoaderDiagnostic[] = [{
      code: "include_not_found",
      severity: "error",
      message: "missing",
    }]
    const ms = manuscript([span("main.tex", "partial")], {
      complete: false,
      fingerprint: null,
      diagnostics,
    })

    const plan = planExhaustiveAnalysisBatches(ms, 2)

    expect(plan.status).toBe("blocked")
    expect(plan.fingerprint).toBeNull()
    expect(plan.batches).toEqual([])
    expect(plan.diagnostics).toEqual(diagnostics)
    expect(plan.diagnostics).not.toBe(diagnostics)
  })

  test("rejects invalid structures and non-positive exhaustive budgets", () => {
    const valid = manuscript([span("main.tex", "x")])
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => planExhaustiveAnalysisBatches(valid, bad)).toThrow(RangeError)
    }
    expect(() => planExhaustiveAnalysisBatches(
      { ...valid, orderedSources: "no" } as unknown as CanonicalLatexManuscriptResult,
      1,
    )).toThrow(TypeError)
    expect(() => planExhaustiveAnalysisBatches(
      manuscript([{ file: "a.tex", startLine: 1, endLine: 1 } as SourceSpan]),
      1,
    )).toThrow(TypeError)
  })

  test("returns full coverage with no batches for a complete empty manuscript", () => {
    const plan = planExhaustiveAnalysisBatches(manuscript([]), 1)

    expect(plan.status).toBe("complete")
    expect(plan.fingerprint).toBe(FP)
    expect(plan.batches).toEqual([])
    expect(plan.coverage).toEqual({
      totalCharacters: 0,
      plannedCharacters: 0,
      coveragePercent: 100,
      batchCount: 0,
    })
  })
})
