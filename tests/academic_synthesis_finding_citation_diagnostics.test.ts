import { describe, expect, test } from "bun:test"
import type { AnalysisFinding } from "../src/lib/analysis_findings"
import { findUnallowlistedSynthesisFindingIds } from "../src/lib/academic_synthesis_finding_ids"
import { inspectSynthesisFindingCitationSignals } from "../src/lib/academic_synthesis_finding_citation_diagnostics"

type ExpectedCitation = Pick<
  AnalysisFinding,
  "findingId" | "file" | "startLine" | "endLine" | "sectionId"
>

const fullHash = "0123456789abcdef".repeat(4)
const expected: ExpectedCitation = {
  findingId: fullHash,
  file: "chapters/methods.tex",
  startLine: 42,
  endLine: 48,
  sectionId: "sec-methods-1",
}

function citation(finding: ExpectedCitation): string {
  return `findingId=${finding.findingId}; arquivo ${finding.file}; linhas ${finding.startLine}-${finding.endLine}; seção ${finding.sectionId}.`
}

function findingIdOnly(findingId: string): string {
  return `findingId=${findingId}.`
}

function textWithOneSignalOutsideWindow(
  finding: ExpectedCitation,
  signal: "file" | "lines" | "section",
): string {
  const localSignals = [
    findingIdOnly(finding.findingId),
    ...(signal === "file" ? [] : [`arquivo ${finding.file}`]),
    ...(signal === "lines" ? [] : [`linhas ${finding.startLine}-${finding.endLine}`]),
    ...(signal === "section" ? [] : [`seção ${finding.sectionId}`]),
  ]
  const distantSignal = {
    file: `arquivo ${finding.file}`,
    lines: `linhas ${finding.startLine}-${finding.endLine}`,
    section: `seção ${finding.sectionId}`,
  }[signal]

  return `${localSignals.join("; ")}; ${"x".repeat(401)} ${distantSignal}`
}

function textWithTruncatedLeftPath(finding: ExpectedCitation): string {
  const idIndex = 300
  const pathPrefix = `old-${finding.file}`
  const beforePath = "x".repeat(idIndex - 220 - 4)
  const betweenLength = idIndex - beforePath.length - pathPrefix.length
  const betweenPathAndId = ` ${"y".repeat(betweenLength - 1)}`
  const restWithoutPath =
    `${findingIdOnly(finding.findingId)}; linhas ${finding.startLine}-${finding.endLine}; seção ${finding.sectionId}.`
  return `${beforePath}${pathPrefix}${betweenPathAndId}${restWithoutPath}`
}

function textWithTruncatedRightSection(finding: ExpectedCitation): string {
  const windowEnd = finding.findingId.length + 300
  const beforeSection = `${findingIdOnly(finding.findingId)}; arquivo ${finding.file}; linhas ${finding.startLine}-${finding.endLine}; seção `
  const padding = "x".repeat(windowEnd - finding.sectionId.length - beforeSection.length)
  return `${beforeSection}${padding}${finding.sectionId}a`
}

function textWithTruncatedRightLine(finding: ExpectedCitation): string {
  const windowEnd = finding.findingId.length + 300
  const beforeRange = `${findingIdOnly(finding.findingId)}; arquivo ${finding.file}; seção ${finding.sectionId}; linhas `
  const range = `${finding.startLine}-${finding.endLine}`
  const padding = "x".repeat(windowEnd - range.length - beforeRange.length)
  return `${beforeRange}${padding}${range}0`
}

/*
 * These diagnostics are lexical-only. Incidental co-occurrence or mentions can
 * be false positives; aliases and unsupported citation forms can be false
 * negatives. No result validates a finding's provenance, source, claim, or
 * scientific quality, and an absent expected ID is not automatically an error.
 */
describe("inspectSynthesisFindingCitationSignals", () => {
  test("separates cited IDs with and without local traceability, preserving expected order", () => {
    const citedButUntraceable = { ...expected, findingId: "fid-untraceable-2" }
    const citedAndTraceable = { ...expected, findingId: fullHash.toUpperCase() }
    const absent = { ...expected, findingId: "fid-absent-3" }
    const text = `${citation(citedAndTraceable)}\n${"x".repeat(230)}\n${findingIdOnly(citedButUntraceable.findingId)}`

    expect(
      inspectSynthesisFindingCitationSignals(text, [citedButUntraceable, citedAndTraceable, absent]),
    ).toEqual({
      citedFindingIds: [citedButUntraceable.findingId, citedAndTraceable.findingId],
      citedWithoutLocalTraceabilityFindingIds: [citedButUntraceable.findingId],
      unexpectedFindingIdTokens: [],
    })
  })

  test("accepts complete SHA-256 case-insensitively and non-hash IDs case-sensitively", () => {
    const hashFinding = { ...expected, findingId: fullHash }
    const literalFinding = { ...expected, findingId: "fid-Literal-4" }
    const text = `${citation({ ...hashFinding, findingId: fullHash.toUpperCase() })}; ${citation(literalFinding)}`

    expect(inspectSynthesisFindingCitationSignals(text, [hashFinding, literalFinding])).toEqual({
      citedFindingIds: [hashFinding.findingId, literalFinding.findingId],
      citedWithoutLocalTraceabilityFindingIds: [],
      unexpectedFindingIdTokens: [],
    })

    const wrongCase = { ...literalFinding, findingId: literalFinding.findingId.toLowerCase() }
    const wrongCaseToken = literalFinding.findingId.toUpperCase()
    const wrongCaseText = citation({ ...literalFinding, findingId: wrongCaseToken })
    expect(inspectSynthesisFindingCitationSignals(wrongCaseText, [wrongCase])).toEqual({
      citedFindingIds: [],
      citedWithoutLocalTraceabilityFindingIds: [],
      unexpectedFindingIdTokens: [wrongCaseToken],
    })
  })

  test("does not treat partial, extended, embedded, or Unicode-colliding IDs as complete tokens", () => {
    const id = "fid.lexical-5"
    const base = { ...expected, findingId: id }
    const invalidTokens = [
      id.slice(0, -1),
      `${id}x`,
      `x${id}`,
      `α${id}β`,
      `${id}\u0301`,
      `cafe\u0301-${id}`,
    ]

    for (const token of invalidTokens) {
      const result = inspectSynthesisFindingCitationSignals(
        `Mention ${token}; ${citation({ ...base, findingId: "fid-other-5" })}`,
        [base],
      )
      expect(result?.citedFindingIds).toEqual([])
      expect(result?.citedWithoutLocalTraceabilityFindingIds).toEqual([])
    }

    for (const hash of [fullHash.slice(0, 63), `${fullHash}a`]) {
      const hashExpected = { ...expected, findingId: fullHash }
      const result = inspectSynthesisFindingCitationSignals(findingIdOnly(hash), [hashExpected])
      expect(result?.citedFindingIds).toEqual([])
    }
  })

  test("requires file, section, and line signals within the same anchored window", () => {
    for (const signal of ["file", "lines", "section"] as const) {
      const result = inspectSynthesisFindingCitationSignals(
        textWithOneSignalOutsideWindow(expected, signal),
        [expected],
      )
      expect(result?.citedFindingIds).toEqual([expected.findingId])
      expect(result?.citedWithoutLocalTraceabilityFindingIds).toEqual([expected.findingId])
    }

    const splitAcrossWindows =
      `${findingIdOnly(expected.findingId)}; arquivo ${expected.file}; ${"x".repeat(500)}` +
      `linhas ${expected.startLine}-${expected.endLine}; seção ${expected.sectionId}`
    const result = inspectSynthesisFindingCitationSignals(splitAcrossWindows, [expected])
    expect(result?.citedFindingIds).toEqual([expected.findingId])
    expect(result?.citedWithoutLocalTraceabilityFindingIds).toEqual([expected.findingId])
  })

  test("preserves 07g full-text token boundaries at both anchored-window edges", () => {
    const leftTruncatedPath = textWithTruncatedLeftPath(expected)
    const rightTruncatedSection = textWithTruncatedRightSection(expected)
    const rightTruncatedLine = textWithTruncatedRightLine(expected)

    for (const text of [leftTruncatedPath, rightTruncatedSection, rightTruncatedLine]) {
      const result = inspectSynthesisFindingCitationSignals(text, [expected])
      expect(result?.citedFindingIds).toEqual([expected.findingId])
      expect(result?.citedWithoutLocalTraceabilityFindingIds).toEqual([expected.findingId])
    }
  })

  test("keeps unexpected-token detection in 07a order and never allowlists a labeled fingerprint", () => {
    const fingerprint = "d".repeat(64)
    const planId = "plan.synthetic-7"
    const invented = "fid-invented-7"
    const text = [
      `incidental fingerprint ${fingerprint}`,
      `incidental plan \`${planId}\``,
      `findingId=${fingerprint}`,
      `findingId=${invented}`,
    ].join("; ")
    const nonFindingIds = [fingerprint, planId]
    const expectedIds: ExpectedCitation[] = []
    const result = inspectSynthesisFindingCitationSignals(text, expectedIds, nonFindingIds)

    expect(result?.unexpectedFindingIdTokens).toEqual(
      findUnallowlistedSynthesisFindingIds(text, [], nonFindingIds),
    )
    expect(result?.unexpectedFindingIdTokens).toEqual([fingerprint, invented])
  })

  test("allows incidental known fingerprints, but not their explicit findingId labels", () => {
    const fingerprint = "e".repeat(64)
    const planId = "plan.synthetic-8"
    const allowedIncidental = `Fingerprint ${fingerprint}; plan \`${planId}\`.`
    const allowed = inspectSynthesisFindingCitationSignals(allowedIncidental, [], [fingerprint, planId])
    expect(allowed?.unexpectedFindingIdTokens).toEqual([])

    const mislabeled = inspectSynthesisFindingCitationSignals(
      `findingId=${fingerprint}`,
      [],
      [fingerprint],
    )
    expect(mislabeled?.unexpectedFindingIdTokens).toEqual([fingerprint])
  })

  test("accepts empty text and empty expected lists without imposing a citation requirement", () => {
    expect(inspectSynthesisFindingCitationSignals("", [])).toEqual({
      citedFindingIds: [],
      citedWithoutLocalTraceabilityFindingIds: [],
      unexpectedFindingIdTokens: [],
    })
    expect(
      inspectSynthesisFindingCitationSignals("Prosa sem IDs de findings.", [
        { ...expected, findingId: "fid-not-mentioned-9" },
      ]),
    ).toEqual({
      citedFindingIds: [],
      citedWithoutLocalTraceabilityFindingIds: [],
      unexpectedFindingIdTokens: [],
    })
    expect(inspectSynthesisFindingCitationSignals("findingId=fid-invented-9", [])?.unexpectedFindingIdTokens)
      .toEqual(["fid-invented-9"])
  })

  test("fails closed for malformed inputs, noncanonical fields, invalid lines, and duplicate IDs", () => {
    const inspect = inspectSynthesisFindingCitationSignals as (
      text: unknown,
      expected: unknown,
      nonFindingIds?: unknown,
    ) => unknown
    const invalidInputs: Array<[unknown, unknown, unknown?]> = [
      [null, []],
      [1, []],
      ["text", null],
      ["text", {}],
      ["text", [null]],
      ["text", ["finding"]],
      ["text", [{ ...expected, findingId: "" }]],
      ["text", [{ ...expected, findingId: " fid-padded" }]],
      ["text", [{ ...expected, file: " " }]],
      ["text", [{ ...expected, file: " chapters/file.tex" }]],
      ["text", [{ ...expected, sectionId: "sec-1 " }]],
      ["text", [{ ...expected, startLine: 0 }]],
      ["text", [{ ...expected, startLine: 1.5 }]],
      ["text", [{ ...expected, startLine: Number.MAX_SAFE_INTEGER + 1 }]],
      ["text", [{ ...expected, endLine: expected.startLine - 1 }]],
      ["text", [expected, { ...expected }]],
      ["text", [{ ...expected, findingId: fullHash }, { ...expected, findingId: fullHash.toUpperCase() }]],
      ["text", [], null],
      ["text", [], "not-an-array"],
      ["text", [], [""]],
      ["text", [], ["  "]],
      ["text", [], [" padded-id "]],
    ]

    for (const [text, findings, nonFindingIds] of invalidInputs) {
      expect(() => inspect(text, findings, nonFindingIds)).not.toThrow()
      expect(inspect(text, findings, nonFindingIds)).toBeNull()
    }

    const nonHashCaseDistinct = inspect("", [
      { ...expected, findingId: "fid.Case-10" },
      { ...expected, findingId: "fid.case-10" },
    ]) as { citedFindingIds: string[] } | null
    expect(nonHashCaseDistinct?.citedFindingIds).toEqual([])
  })

  test("does not mutate frozen inputs and handles many repeated occurrences", () => {
    const frozenFinding = Object.freeze({ ...expected, findingId: "fid-repeated-11" })
    const frozenExpected = Object.freeze([frozenFinding])
    const frozenNonFindingIds = Object.freeze(["d".repeat(64)])
    const text = `${(`Inventory: ${findingIdOnly(frozenFinding.findingId)}; ${"x".repeat(400)}\n`).repeat(300)}`

    expect(() =>
      inspectSynthesisFindingCitationSignals(text, frozenExpected, frozenNonFindingIds),
    ).not.toThrow()
    expect(inspectSynthesisFindingCitationSignals(text, frozenExpected, frozenNonFindingIds)).toEqual({
      citedFindingIds: [frozenFinding.findingId],
      citedWithoutLocalTraceabilityFindingIds: [frozenFinding.findingId],
      unexpectedFindingIdTokens: [],
    })
    expect(Object.isFrozen(frozenFinding)).toBe(true)
    expect(Object.isFrozen(frozenExpected)).toBe(true)
    expect(Object.isFrozen(frozenNonFindingIds)).toBe(true)
  })
})
