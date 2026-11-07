import { describe, expect, test } from "bun:test"
import type { AnalysisFinding } from "../src/lib/analysis_findings"
import { hasSynthesisFindingCitationTokensInWindow } from "../src/lib/academic_synthesis_finding_citation_signals"

type ExpectedCitation = Pick<
  AnalysisFinding,
  "findingId" | "file" | "startLine" | "endLine" | "sectionId"
>

const sha256FindingId = "0123456789abcdef".repeat(4)
const expected = {
  findingId: sha256FindingId,
  file: "chapters/methods.tex",
  startLine: 42,
  endLine: 48,
  sectionId: "sec-methods-1",
} satisfies ExpectedCitation

function citationWindow(finding: ExpectedCitation): string {
  return `ID ${finding.findingId}; path ${finding.file}; linhas ${finding.startLine}-${finding.endLine}; section ${finding.sectionId}.`
}

/*
 * This function composes lexical signals only. Exact incidental co-occurrence
 * can be a false positive; aliases or unrecognized citation forms can be false
 * negatives. Neither result establishes provenance, semantic association,
 * source support, finding validity, or scientific quality.
 */
describe("hasSynthesisFindingCitationTokensInWindow", () => {
  test("requires the complete SHA-256 ID and all expected signals in one window", () => {
    expect(hasSynthesisFindingCitationTokensInWindow(citationWindow(expected), expected)).toBe(true)
  })

  test("accepts an exact non-hash finding ID with the other expected signals", () => {
    const nonHashExpected = { ...expected, findingId: "fid-methods-1" }
    expect(
      hasSynthesisFindingCitationTokensInWindow(
        citationWindow(nonHashExpected),
        nonHashExpected,
      ),
    ).toBe(true)
  })

  test("returns false when any one of the four expected signals is absent", () => {
    const windowsWithoutOneSignal = [
      `path ${expected.file}; linhas 42-48; section ${expected.sectionId}.`,
      `ID ${expected.findingId}; linhas 42-48; section ${expected.sectionId}.`,
      `ID ${expected.findingId}; path ${expected.file}; section ${expected.sectionId}.`,
      `ID ${expected.findingId}; path ${expected.file}; linhas 42-48.`,
    ]

    for (const windowText of windowsWithoutOneSignal) {
      expect(hasSynthesisFindingCitationTokensInWindow(windowText, expected)).toBe(false)
    }
  })

  test("requires the expected finding ID rather than a distinct ID", () => {
    const otherFinding = { ...expected, findingId: "fid-methods-other" }
    expect(hasSynthesisFindingCitationTokensInWindow(citationWindow(otherFinding), expected)).toBe(false)
  })

  test("does not accept truncated or extended hexadecimal finding IDs", () => {
    for (const findingId of [sha256FindingId.slice(0, 63), `${sha256FindingId}a`]) {
      const incompleteExpected = { ...expected, findingId }
      expect(
        hasSynthesisFindingCitationTokensInWindow(
          citationWindow(incompleteExpected),
          incompleteExpected,
        ),
      ).toBe(false)
    }
  })

  test("rejects partial, homonymous, extended, or alternate file paths", () => {
    for (const file of [
      "methods.tex",
      "appendix/methods.tex",
      "chapters/methods.tex/child.tex",
      "chapters/methods.tex.bak",
      "chapters\\methods.tex",
    ]) {
      const pathExpected = { ...expected, file }
      expect(
        hasSynthesisFindingCitationTokensInWindow(
          citationWindow(pathExpected),
          expected,
        ),
      ).toBe(false)
    }
  })

  test("rejects partial or extended section identifiers", () => {
    for (const sectionId of [
      "methods-1",
      "sec-methods-10",
      "xsec-methods-1",
      "sec-methods-1-extra",
    ]) {
      const sectionExpected = { ...expected, sectionId }
      expect(
        hasSynthesisFindingCitationTokensInWindow(
          citationWindow(sectionExpected),
          expected,
        ),
      ).toBe(false)
    }
  })

  test("requires the exact expected range in a supported line-citation form", () => {
    for (const rangeText of [
      "linhas 42-49",
      "linhas 43-48",
      "linhas 48-42",
      "linhas 42 e 48",
      "linha 42",
      "linhas 42-48a",
      "line 42-48",
    ]) {
      const windowText =
        `ID ${expected.findingId}; path ${expected.file}; ${rangeText}; section ${expected.sectionId}.`
      expect(hasSynthesisFindingCitationTokensInWindow(windowText, expected)).toBe(false)
    }
  })

  test("does not aggregate signals distributed across separately supplied windows", () => {
    const firstWindow = `ID ${expected.findingId}; path ${expected.file}.`
    const secondWindow = `linhas 42-48; section ${expected.sectionId}.`

    expect(hasSynthesisFindingCitationTokensInWindow(firstWindow, expected)).toBe(false)
    expect(hasSynthesisFindingCitationTokensInWindow(secondWindow, expected)).toBe(false)
  })

  test("does not borrow the complete signals of other findings", () => {
    const otherFindings = [
      {
        ...expected,
        findingId: "fid-other-a",
        file: "chapters/other-a.tex",
        startLine: 11,
        endLine: 12,
        sectionId: "sec-other-a",
      },
      {
        ...expected,
        findingId: "fid-other-b",
        file: "chapters/other-b.tex",
        startLine: 21,
        endLine: 24,
        sectionId: "sec-other-b",
      },
    ]
    const windowText = otherFindings.map(citationWindow).join(" ")

    expect(hasSynthesisFindingCitationTokensInWindow(windowText, expected)).toBe(false)
  })

  test("fails closed for empty windows, absent objects, and invalid runtime types", () => {
    const isCited = hasSynthesisFindingCitationTokensInWindow as (
      windowText: unknown,
      expected: unknown,
    ) => boolean

    for (const [windowText, expectedFinding] of [
      ["", expected],
      [" \t\n ", expected],
      [null, expected],
      [1, expected],
      [citationWindow(expected), null],
      [citationWindow(expected), undefined],
      [citationWindow(expected), "not-an-object"],
      [citationWindow(expected), []],
    ] as const) {
      expect(() => isCited(windowText, expectedFinding)).not.toThrow()
      expect(isCited(windowText, expectedFinding)).toBe(false)
    }
  })

  test("fails closed for empty fields and invalid or reversed line ranges", () => {
    const isCited = hasSynthesisFindingCitationTokensInWindow as (
      windowText: unknown,
      expected: unknown,
    ) => boolean
    const invalidFindings: unknown[] = [
      { ...expected, findingId: "" },
      { ...expected, findingId: " \t\n " },
      { ...expected, findingId: 42 },
      { file: expected.file, startLine: expected.startLine, endLine: expected.endLine, sectionId: expected.sectionId },
      { ...expected, file: "" },
      { ...expected, file: " \t\n " },
      { ...expected, file: null },
      { findingId: expected.findingId, startLine: expected.startLine, endLine: expected.endLine, sectionId: expected.sectionId },
      { ...expected, sectionId: "" },
      { ...expected, sectionId: " \t\n " },
      { ...expected, sectionId: 42 },
      { findingId: expected.findingId, file: expected.file, startLine: expected.startLine, endLine: expected.endLine },
      { findingId: expected.findingId, file: expected.file, endLine: expected.endLine, sectionId: expected.sectionId },
      { findingId: expected.findingId, file: expected.file, startLine: expected.startLine, sectionId: expected.sectionId },
      { ...expected, startLine: "42" },
      { ...expected, startLine: 0 },
      { ...expected, startLine: -1 },
      { ...expected, startLine: 42.5 },
      { ...expected, startLine: Number.NaN },
      { ...expected, startLine: Number.MAX_SAFE_INTEGER + 1 },
      { ...expected, endLine: Number.POSITIVE_INFINITY },
      { ...expected, endLine: "48" },
      { ...expected, startLine: 48, endLine: 42 },
    ]

    for (const invalidFinding of invalidFindings) {
      expect(() => isCited(citationWindow(expected), invalidFinding)).not.toThrow()
      expect(isCited(citationWindow(expected), invalidFinding)).toBe(false)
    }
  })

  test("does not mutate the expected finding fields", () => {
    const actual = { ...expected }
    const before = { ...actual }

    expect(hasSynthesisFindingCitationTokensInWindow(citationWindow(actual), actual)).toBe(true)
    expect(actual).toEqual(before)
  })

  test("documents incidental co-occurrence false positives and lexical false negatives", () => {
    // These exact tokens are in an unrelated inventory, but co-occurrence is still true.
    expect(
      hasSynthesisFindingCitationTokensInWindow(
        `Unrelated inventory: ${citationWindow(expected)}`,
        expected,
      ),
    ).toBe(true)

    // A semantic alias and unsupported English line form are not inferred.
    const aliasWindow =
      `methods finding; path ${expected.file}; line 42-48; section ${expected.sectionId}.`
    expect(hasSynthesisFindingCitationTokensInWindow(aliasWindow, expected)).toBe(false)
  })
})
