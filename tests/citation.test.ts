import { describe, test, expect } from "bun:test"
import {
  analyzeCitationDensity,
  citationScore,
} from "../src/lib/citation"

describe("analyzeCitationDensity", () => {
  test("counts cited paragraphs and percent without citations", () => {
    const result = analyzeCitationDensity(
      [
        "Paragraph without any citation marker.",
        "Paragraph with a citation \\cite{autor2020} inside.",
        "Another paragraph with nothing.",
      ].join("\n\n"),
    )
    expect(result.totalParagraphs).toBe(3)
    expect(result.citedParagraphs).toBe(1)
    expect(result.paragraphsWithoutCitation).toBe(2)
    expect(result.percentWithoutCitation).toBeCloseTo(66.666, 2)
  })

  test("filters out short paragraphs (<= 20 trimmed chars)", () => {
    const result = analyzeCitationDensity(
      [
        "Short.",
        "A real paragraph long enough to count with citation \\cite{a}.",
      ].join("\n\n"),
    )
    expect(result.totalParagraphs).toBe(1)
    expect(result.citedParagraphs).toBe(1)
    expect(result.percentWithoutCitation).toBe(0)
  })

  test("empty content yields zero paragraphs and no NaN", () => {
    const result = analyzeCitationDensity("")
    expect(result.totalParagraphs).toBe(0)
    expect(result.citedParagraphs).toBe(0)
    expect(result.percentWithoutCitation).toBe(0)
    expect(Number.isNaN(result.score)).toBe(false)
  })

  test("handles \\citeonline variants", () => {
    const result = analyzeCitationDensity(
      "A paragraph that cites \\citeonline{autor2021} inline.",
    )
    expect(result.citedParagraphs).toBe(1)
  })

  test("multiple citations in one paragraph count once", () => {
    const result = analyzeCitationDensity(
      "A paragraph citing \\cite{a} and \\cite{b} together.",
    )
    expect(result.citedParagraphs).toBe(1)
    expect(result.paragraphsWithoutCitation).toBe(0)
  })
})

describe("citationScore", () => {
  test(">30% without citation maps to 4.0", () => {
    expect(citationScore(30.01)).toBe(4.0)
    expect(citationScore(100)).toBe(4.0)
  })

  test(">20% and <=30% maps to 6.0", () => {
    expect(citationScore(20.01)).toBe(6.0)
    expect(citationScore(30)).toBe(6.0)
  })

  test("<=20% maps to 8.0", () => {
    expect(citationScore(0)).toBe(8.0)
    expect(citationScore(20)).toBe(8.0)
  })
})
