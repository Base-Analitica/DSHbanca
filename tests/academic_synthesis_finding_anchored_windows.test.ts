import { describe, expect, test } from "bun:test"
import type { AnalysisFinding } from "../src/lib/analysis_findings"
import { hasSynthesisFindingCitationInAnchoredWindows } from "../src/lib/academic_synthesis_finding_anchored_windows"

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

function citation(finding: ExpectedCitation = expected): string {
  return `ID ${finding.findingId}; arquivo ${finding.file}; linhas ${finding.startLine}-${finding.endLine}; seção ${finding.sectionId}.`
}

function utf16Filler(length: number): string {
  return "😀".repeat(Math.floor(length / 2)) + (length % 2 === 1 ? "x" : "")
}

function citationWithFieldOutsideWindow(
  field: "file" | "range" | "section",
): string {
  const localSignals = [
    `ID ${expected.findingId}`,
    ...(field === "file" ? [] : [`arquivo ${expected.file}`]),
    ...(field === "range" ? [] : [`linhas ${expected.startLine}-${expected.endLine}`]),
    ...(field === "section" ? [] : [`seção ${expected.sectionId}`]),
  ]
  const distantSignal = {
    file: `arquivo ${expected.file}`,
    range: `linhas ${expected.startLine}-${expected.endLine}`,
    section: `seção ${expected.sectionId}`,
  }[field]

  return `${localSignals.join("; ")}; ${"x".repeat(301)} ${distantSignal}`
}

describe("hasSynthesisFindingCitationInAnchoredWindows", () => {
  test("composes all four signals in an anchored window for SHA-256 and literal IDs", () => {
    expect(
      hasSynthesisFindingCitationInAnchoredWindows(
        `Linha ${expected.endLine}: ${citation({ ...expected, findingId: sha256FindingId.toUpperCase() })}`,
        expected,
      ),
    ).toBe(true)

    const nonHashExpected = { ...expected, findingId: "fid.methods-1" }
    expect(
      hasSynthesisFindingCitationInAnchoredWindows(citation(nonHashExpected), nonHashExpected),
    ).toBe(true)
    expect(
      hasSynthesisFindingCitationInAnchoredWindows(
        citation({ ...nonHashExpected, findingId: nonHashExpected.findingId.toUpperCase() }),
        nonHashExpected,
      ),
    ).toBe(false)
  })

  test("checks later complete occurrences when the first occurrence is incomplete", () => {
    const first = `ID ${expected.findingId}; arquivo ${expected.file}; linhas 42-48.`
    const later = citation(expected)

    expect(
      hasSynthesisFindingCitationInAnchoredWindows(`${first}${"x".repeat(400)}${later}`, expected),
    ).toBe(true)
  })

  test("rejects absent, partial, extended, embedded, and different IDs", () => {
    const nonHashExpected = { ...expected, findingId: "fid.methods-1" }
    const otherFinding = { ...expected, findingId: "fid.methods-2" }
    const cases: Array<[string, ExpectedCitation]> = [
      [citation({ ...expected, findingId: "unrelated-id" }), expected],
      [citation({ ...expected, findingId: sha256FindingId.slice(0, 63) }), expected],
      [citation({ ...expected, findingId: `${sha256FindingId}a` }), expected],
      [`x${nonHashExpected.findingId}; ${citation({ ...expected, findingId: "different-id" })}`, nonHashExpected],
      [`${nonHashExpected.findingId}0; ${citation({ ...expected, findingId: "different-id" })}`, nonHashExpected],
      [`path/${nonHashExpected.findingId}; ${citation({ ...expected, findingId: "different-id" })}`, nonHashExpected],
      [`α${nonHashExpected.findingId}β; ${citation({ ...expected, findingId: "different-id" })}`, nonHashExpected],
      [citation(otherFinding), expected],
      [`${citation({ ...expected, findingId: nonHashExpected.findingId.toUpperCase() })}`, nonHashExpected],
      [citation({ ...expected, findingId: "a".repeat(63) }), { ...expected, findingId: "a".repeat(63) }],
      [citation({ ...expected, findingId: "f".repeat(65) }), { ...expected, findingId: "f".repeat(65) }],
    ]

    for (const [text, finding] of cases) {
      expect(hasSynthesisFindingCitationInAnchoredWindows(text, finding)).toBe(false)
    }
  })

  test("does not borrow a file, line range, or section from outside the anchor window", () => {
    for (const field of ["file", "range", "section"] as const) {
      const text = citationWithFieldOutsideWindow(field)
      expect(text).toContain(expected.findingId)
      expect(text).toContain(expected.file)
      expect(text).toContain(`${expected.startLine}-${expected.endLine}`)
      expect(text).toContain(expected.sectionId)
      expect(hasSynthesisFindingCitationInAnchoredWindows(text, expected)).toBe(false)
    }
  })

  test("includes a signal starting exactly 220 UTF-16 code units before the ID", () => {
    const anchor = 300
    const fileStart = anchor - 220
    const before =
      `${"x".repeat(fileStart - 1)} ${expected.file}` +
      utf16Filler(anchor - fileStart - expected.file.length)
    const text = `${before}${expected.findingId}; linhas 42-48; seção ${expected.sectionId}.`

    expect(text.indexOf(expected.findingId)).toBe(anchor)
    expect(hasSynthesisFindingCitationInAnchoredWindows(text, expected)).toBe(true)
  })

  test("excludes a signal whose first code unit is 221 units before the ID", () => {
    const anchor = 300
    const fileStart = anchor - 221
    const before =
      `${"x".repeat(fileStart - 1)} ${expected.file}` +
      utf16Filler(anchor - fileStart - expected.file.length)
    const text = `${before}${expected.findingId}; linhas 42-48; seção ${expected.sectionId}.`

    expect(text.indexOf(expected.findingId)).toBe(anchor)
    expect(hasSynthesisFindingCitationInAnchoredWindows(text, expected)).toBe(false)
  })

  test("includes the last code unit before the exclusive 300-unit end boundary", () => {
    const before = `arquivo ${expected.file}; `
    const afterId = `; linhas 42-48; seção `
    const padding = " ".repeat(300 - afterId.length - expected.sectionId.length)
    const text = `${before}${expected.findingId}${afterId}${padding}${expected.sectionId}`
    const anchor = before.length

    expect(text.length).toBe(anchor + expected.findingId.length + 300)
    expect(hasSynthesisFindingCitationInAnchoredWindows(text, expected)).toBe(true)
  })

  test("does not include a signal extending one code unit past the exclusive end boundary", () => {
    const before = `arquivo ${expected.file}; `
    const afterId = `; linhas 42-48; seção `
    const padding = " ".repeat(301 - afterId.length - expected.sectionId.length)
    const text = `${before}${expected.findingId}${afterId}${padding}${expected.sectionId}`

    expect(text.length).toBe(before.length + expected.findingId.length + 301)
    expect(hasSynthesisFindingCitationInAnchoredWindows(text, expected)).toBe(false)
  })

  test("rejects a section ID extended beyond the exclusive right edge", () => {
    const afterId = `; arquivo ${expected.file}; linhas 42-48; seção `
    const rightPadding = " ".repeat(300 - afterId.length - expected.sectionId.length)
    const extendedSection =
      `${expected.findingId}${afterId}${rightPadding}${expected.sectionId}a`

    expect(extendedSection.length).toBe(expected.findingId.length + 301)
    expect(hasSynthesisFindingCitationInAnchoredWindows(extendedSection, expected)).toBe(false)
  })

  test("rejects a file path whose prefix begins before the inclusive left edge", () => {
    const anchor = 300
    const windowStart = anchor - 220
    const extendedPathPrefix = `${"x".repeat(windowStart - 4)}old-${expected.file}`
    const beforeAnchor =
      `${extendedPathPrefix}${" ".repeat(anchor - extendedPathPrefix.length)}`
    const extendedFile =
      `${beforeAnchor}${expected.findingId}; linhas 42-48; seção ${expected.sectionId}.`

    expect(extendedFile.indexOf(expected.file)).toBe(windowStart)
    expect(extendedFile.indexOf(expected.findingId)).toBe(anchor)
    expect(hasSynthesisFindingCitationInAnchoredWindows(extendedFile, expected)).toBe(false)
  })

  test("rejects a line range extended beyond the exclusive right edge", () => {
    const afterIdWithLinePrefix =
      `; arquivo ${expected.file}; seção ${expected.sectionId}; linhas 42-`
    const linePadding = " ".repeat(300 - afterIdWithLinePrefix.length - 2)
    const extendedLineRange =
      `${expected.findingId}${afterIdWithLinePrefix}${linePadding}48` + "0"

    expect(extendedLineRange.length).toBe(expected.findingId.length + 301)
    expect(hasSynthesisFindingCitationInAnchoredWindows(extendedLineRange, expected)).toBe(false)
  })

  test("preserves file-path and section-ID backslash boundaries", () => {
    const pathContinuation =
      `${citation(expected).replace(`${expected.file};`, `${expected.file}\\child;`)}`
    expect(hasSynthesisFindingCitationInAnchoredWindows(pathContinuation, expected)).toBe(false)

    const sectionBoundary = citation(expected).replace(
      `${expected.sectionId}.`,
      `${expected.sectionId}\\child.`,
    )
    expect(hasSynthesisFindingCitationInAnchoredWindows(sectionBoundary, expected)).toBe(true)
  })

  test("checks line-label context at the inclusive left edge", () => {
    const anchor = 300
    const windowStart = anchor - 220
    const textWithPrefix = (leftFill: "x" | " "): string => {
      const beforeAnchor =
        `${leftFill.repeat(windowStart)}linhas 42-48; arquivo ${expected.file}; seção ${expected.sectionId}; `
      return `${beforeAnchor}${" ".repeat(anchor - beforeAnchor.length)}${expected.findingId}`
    }

    const embeddedLine = textWithPrefix("x")
    expect(embeddedLine.indexOf("linhas 42-48")).toBe(windowStart)
    expect(embeddedLine.indexOf(expected.findingId)).toBe(anchor)
    expect(hasSynthesisFindingCitationInAnchoredWindows(embeddedLine, expected)).toBe(false)

    const boundaryLine = textWithPrefix(" ")
    expect(hasSynthesisFindingCitationInAnchoredWindows(boundaryLine, expected)).toBe(true)
  })

  test("preserves exact single-line edges but rejects a clipped range continuation", () => {
    const singleLineExpected = { ...expected, endLine: expected.startLine }
    const beforeLine =
      `; arquivo ${expected.file}; seção ${expected.sectionId}; linhas `
    const linePadding = " ".repeat(300 - beforeLine.length - String(expected.startLine).length)
    const windowEndText =
      `${expected.findingId}${beforeLine}${linePadding}${expected.startLine}`
    const end = expected.findingId.length + 300

    expect(windowEndText.length).toBe(end)
    expect(
      hasSynthesisFindingCitationInAnchoredWindows(`${windowEndText};`, singleLineExpected),
    ).toBe(true)
    expect(
      hasSynthesisFindingCitationInAnchoredWindows(`${windowEndText} - 48`, singleLineExpected),
    ).toBe(false)
  })

  test("handles IDs at text edges and repeated occurrences without merging windows", () => {
    const atStart = `${expected.findingId}; arquivo ${expected.file}; linhas 42-48; seção ${expected.sectionId}.`
    const atEnd = `arquivo ${expected.file}; linhas 42-48; seção ${expected.sectionId}; ID ${expected.findingId}`
    expect(hasSynthesisFindingCitationInAnchoredWindows(atStart, expected)).toBe(true)
    expect(hasSynthesisFindingCitationInAnchoredWindows(atEnd, expected)).toBe(true)

    const separatedSignals =
      `ID ${expected.findingId}; arquivo ${expected.file}${"x".repeat(700)}` +
      `linhas 42-48; seção ${expected.sectionId}; ID ${expected.findingId}`
    expect(hasSynthesisFindingCitationInAnchoredWindows(separatedSignals, expected)).toBe(false)
  })

  test("fails closed for invalid values and reversed or missing fields", () => {
    const isCited = hasSynthesisFindingCitationInAnchoredWindows as (
      text: unknown,
      expected: unknown,
    ) => boolean
    const invalid: Array<[unknown, unknown]> = [
      ["", expected],
      [" \t\n ", expected],
      [null, expected],
      [42, expected],
      [citation(), null],
      [citation(), undefined],
      [citation(), "not-an-object"],
      [citation(), []],
      [citation(), { ...expected, findingId: "" }],
      [citation(), { ...expected, findingId: " fid " }],
      [citation(), { ...expected, file: "" }],
      [citation(), { ...expected, file: undefined }],
      [citation(), { ...expected, sectionId: null }],
      [citation(), { ...expected, startLine: 0 }],
      [citation(), { ...expected, startLine: 48, endLine: 42 }],
      [citation(), { ...expected, startLine: 42.5 }],
      [citation(), { ...expected, endLine: Number.MAX_SAFE_INTEGER + 1 }],
      [citation(), { findingId: expected.findingId, file: expected.file, startLine: 42, endLine: 48 }],
    ]

    for (const [text, finding] of invalid) {
      expect(() => isCited(text, finding)).not.toThrow()
      expect(isCited(text, finding)).toBe(false)
    }
  })

  test("does not mutate the expected object and scans many candidate occurrences", () => {
    const actual = { ...expected }
    const before = { ...actual }
    const invalidOccurrences = (`x${expected.findingId} `).repeat(500)
    const text = `${invalidOccurrences}${citation(expected)}`

    expect(hasSynthesisFindingCitationInAnchoredWindows(text, actual)).toBe(true)
    expect(actual).toEqual(before)
  })

  test("documents incidental lexical false positives and alias false negatives", () => {
    expect(
      hasSynthesisFindingCitationInAnchoredWindows(
        `Unrelated inventory: ${citation(expected)}`,
        expected,
      ),
    ).toBe(true)

    const alias = `methods finding; arquivo ${expected.file}; line 42-48; seção ${expected.sectionId}.`
    expect(hasSynthesisFindingCitationInAnchoredWindows(alias, expected)).toBe(false)
  })
})
