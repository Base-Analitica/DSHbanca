import { describe, expect, test } from "bun:test"
import { isSynthesisLineRangeCited } from "../src/lib/academic_synthesis_line_citations"

/*
 * This is a lexical signal, not a source or claim validator.
 * False positive: unrelated prose may explicitly mention the same line.
 * False negative: equivalent forms such as English "line 42" are unsupported.
 */
describe("isSynthesisLineRangeCited", () => {
  test("recognizes explicit single-line citations with exact token boundaries", () => {
    expect(isSynthesisLineRangeCited("A evidência está na linha 42.", 42, 42)).toBe(true)
    expect(isSynthesisLineRangeCited("Trecho: L42", 42, 42)).toBe(true)
    expect(isSynthesisLineRangeCited("Referência em LINHA\t42, ao final", 42, 42)).toBe(true)
    expect(isSynthesisLineRangeCited("Fonte indicada como L 42]", 42, 42)).toBe(true)
  })

  test("does not mistake incidental numbers, sections, or partial tokens for a line citation", () => {
    for (const text of [
      "A evidência está na linha 142.",
      "O achado aponta o número 42.",
      "A seção 42 apresenta o método.",
      "L142",
      "AL42",
      "linha 42a",
      "linha 42-48",
      "linha 42 a48",
      "linhas 42 a 48",
    ]) {
      expect(isSynthesisLineRangeCited(text, 42, 42)).toBe(false)
    }
  })

  test("recognizes exact multiline ranges using a hyphen, en dash, or Portuguese 'a'", () => {
    expect(isSynthesisLineRangeCited("Ver linhas 42-48.", 42, 48)).toBe(true)
    expect(isSynthesisLineRangeCited("Conforme LINHAS 42 – 48,", 42, 48)).toBe(true)
    expect(isSynthesisLineRangeCited("evidência: linhas 42 a 48]", 42, 48)).toBe(true)
    expect(isSynthesisLineRangeCited("na linha 42–48.", 42, 48)).toBe(true)
    expect(isSynthesisLineRangeCited("trecho nas linhas 42–48", 42, 48)).toBe(true)
  })

  test("requires both exact endpoints in one explicit range", () => {
    for (const text of [
      "A evidência está na linha 42.",
      "A evidência está na linha 48.",
      "O início é linha 42 e o fim é linha 48.",
      "linhas 42-49",
      "linhas 41-48",
      "linhas 142-148",
      "linhas 42-148",
      "linhas 42-48a",
      "linhas 48-42",
      "42-48",
      "linhas 42 e 48",
      "linhas 42 48",
    ]) {
      expect(isSynthesisLineRangeCited(text, 42, 48)).toBe(false)
    }
  })

  test("treats invalid ranges and runtime-invalid arguments as not cited", () => {
    const isCited = isSynthesisLineRangeCited as (
      text: unknown,
      start: unknown,
      end: unknown,
    ) => boolean

    expect(isCited("linha 42", 0, 0)).toBe(false)
    expect(isCited("linha 42", -1, -1)).toBe(false)
    expect(isCited("linha 42", 42.5, 42.5)).toBe(false)
    expect(isCited("linha 42", Number.NaN, 42)).toBe(false)
    expect(isCited("linha 42", 42, Number.POSITIVE_INFINITY)).toBe(false)
    expect(isCited("linhas 42-48", 48, 42)).toBe(false)
    expect(isCited("linha 9007199254740992", Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isCited("linha 42", "42", 42)).toBe(false)
    expect(isCited(null, 42, 42)).toBe(false)
  })

  test("documents lexical false-positive and false-negative cases", () => {
    // Same line token is present, but this unrelated list does not cite the finding.
    expect(isSynthesisLineRangeCited("A pauta da reunião menciona a linha 42 do roteiro.", 42, 42)).toBe(true)
    // An English citation is meaningful but outside the deliberately narrow vocabulary.
    expect(isSynthesisLineRangeCited("The evidence is on line 42.", 42, 42)).toBe(false)
  })
})
