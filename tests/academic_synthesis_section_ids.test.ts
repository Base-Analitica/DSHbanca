import { describe, expect, test } from "bun:test"
import { isSynthesisSectionIdCited } from "../src/lib/academic_synthesis_section_ids"

/*
 * This is a lexical signal only. Mentioning the exact ID in unrelated prose is
 * a possible false positive; a valid alias without the ID is a possible false
 * negative. Neither result verifies a section, source location, or claim.
 */
describe("isSynthesisSectionIdCited", () => {
  test("recognizes the complete ID at window edges and between delimiters", () => {
    expect(isSynthesisSectionIdCited("sec-1", "sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("sec-1 is discussed", "sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("The finding cites sec-1", "sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("sectionId: (sec-1), in this paragraph.", "sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("‘sec-1’; additional context", "sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("sectionId: sec-1.", "sec-1")).toBe(true)
  })

  test("distinguishes a terminal period from a repeated-dot identifier", () => {
    expect(isSynthesisSectionIdCited("sec-1.", "sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("sec-1..2", "sec-1")).toBe(false)
    expect(isSynthesisSectionIdCited("sec-1..2", "sec-1..2")).toBe(true)
  })

  test("considers the full run of dots before an identifier", () => {
    expect(isSynthesisSectionIdCited("prefix..sec-1", "sec-1")).toBe(false)
    expect(isSynthesisSectionIdCited("prefix..sec-1", "prefix..sec-1")).toBe(true)
    expect(isSynthesisSectionIdCited("...sec-1", "sec-1")).toBe(true)
  })

  test("rejects prefix and suffix collisions for sec-1", () => {
    for (const text of [
      "sec-10",
      "sec-11",
      "xsec-1",
      "sec-1a",
      "sec-1_extra",
      "sec-1/filha",
      "sec-1.2",
    ]) {
      expect(isSynthesisSectionIdCited(text, "sec-1")).toBe(false)
    }
  })

  test("recognizes only the exact one among distinct section identifiers", () => {
    const prose = "sec-10 appears first; then sec-11."
    expect(isSynthesisSectionIdCited(prose, "sec-1")).toBe(false)
    expect(isSynthesisSectionIdCited(prose, "sec-10")).toBe(true)
    expect(isSynthesisSectionIdCited(prose, "sec-11")).toBe(true)
    expect(isSynthesisSectionIdCited(prose, "sec-12")).toBe(false)
  })

  test("supports exact identifiers with hyphens, underscores, dots, and Unicode", () => {
    const samples = [
      ["sec-alpha-7", "(sec-alpha-7)"],
      ["sec_alpha_7", "[sec_alpha_7]"],
      ["sec.alpha.7", "sec.alpha.7,"],
      ["seção-β_一.7", "Referência: seção-β_一.7!"],
      ["sec.[α]+(1)", "(sec.[α]+(1));"],
    ] as const

    for (const [sectionId, text] of samples) {
      expect(isSynthesisSectionIdCited(text, sectionId)).toBe(true)
    }
  })

  test("treats identifier punctuation as part of the exact token", () => {
    expect(isSynthesisSectionIdCited("sec-1.2", "sec-1.2")).toBe(true)
    expect(isSynthesisSectionIdCited("xsec-1.2", "sec-1.2")).toBe(false)
    expect(isSynthesisSectionIdCited("sec-1.2a", "sec-1.2")).toBe(false)
  })

  test("does not normalize case, Unicode composition, or surrounding whitespace", () => {
    expect(isSynthesisSectionIdCited("SEC-1", "sec-1")).toBe(false)
    expect(isSynthesisSectionIdCited("seção-1", "seção-1")).toBe(false)
    expect(isSynthesisSectionIdCited("sec-1", " sec-1 ")).toBe(false)
  })

  test("returns false for empty and runtime-invalid inputs", () => {
    const isCited = isSynthesisSectionIdCited as (text: unknown, id: unknown) => boolean

    expect(isCited("", "sec-1")).toBe(false)
    expect(isCited("sec-1", "")).toBe(false)
    expect(isCited("sec-1", " \t\n ")).toBe(false)
    expect(isCited(null, "sec-1")).toBe(false)
    expect(isCited("sec-1", null)).toBe(false)
    expect(isCited(undefined, "sec-1")).toBe(false)
    expect(isCited("sec-1", 1)).toBe(false)
  })

  test("documents possible lexical false-positive and false-negative cases", () => {
    // The matching ID is present, but its appearance in an unrelated list is incidental.
    expect(isSynthesisSectionIdCited("Appendix inventory: sec-1", "sec-1")).toBe(true)
    // An alias can refer to a section without containing its validated ID.
    expect(isSynthesisSectionIdCited("the opening section", "sec-1")).toBe(false)
  })
})
