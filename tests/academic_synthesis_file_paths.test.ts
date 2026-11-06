import { describe, expect, test } from "bun:test"
import { isSynthesisFilePathCited } from "../src/lib/academic_synthesis_file_paths"

/*
 * This is a lexical signal only. An incidental mention of the exact path can
 * be a false positive; aliases, encoded paths, or other equivalent forms can
 * be false negatives. A match does not prove a file exists or supports a claim.
 */
describe("isSynthesisFilePathCited", () => {
  test("recognizes an exact relative path in plain, quoted, and delimited prose", () => {
    const filePath = "capitulos/metodo.tex"

    for (const windowText of [
      "arquivo: capitulos/metodo.tex",
      "`capitulos/metodo.tex`",
      '"capitulos/metodo.tex"',
      "'capitulos/metodo.tex'",
      "(capitulos/metodo.tex)",
    ]) {
      expect(isSynthesisFilePathCited(windowText, filePath)).toBe(true)
    }
  })

  test("recognizes the complete path at the start and end of a window", () => {
    expect(
      isSynthesisFilePathCited(
        "capitulos/metodo.tex — referência",
        "capitulos/metodo.tex",
      ),
    ).toBe(true)
    expect(
      isSynthesisFilePathCited(
        "referência: capitulos/metodo.tex",
        "capitulos/metodo.tex",
      ),
    ).toBe(true)
  })

  test("recognizes a root file, punctuation, and exact Unicode and punctuated paths", () => {
    expect(isSynthesisFilePathCited("main.tex", "main.tex")).toBe(true)
    expect(
      isSynthesisFilePathCited(
        "Conforme capitulos/metodo.tex.",
        "capitulos/metodo.tex",
      ),
    ).toBe(true)
    expect(
      isSynthesisFilePathCited(
        "Referência: capítulos-avançados/dados_resultado-β.tex",
        "capítulos-avançados/dados_resultado-β.tex",
      ),
    ).toBe(true)
  })

  test("rejects basenames, sibling paths, prefixes, and incomplete path components", () => {
    const filePath = "capitulos/metodo.tex"

    for (const windowText of [
      "metodo.tex",
      "outro/metodo.tex",
      "outro/capitulos/metodo.tex",
      "prefixocapitulos/metodo.tex",
      "capitulos/metodo.tex.bak",
      "capitulos/metodo.tex2",
      "capitulos/metodo.tex/filha",
      "capitulos/metodo.tex\\filha",
      "capitulos//metodo.tex",
      "CAPITULOS/metodo.tex",
      "capitulos\\metodo.tex",
    ]) {
      expect(isSynthesisFilePathCited(windowText, filePath)).toBe(false)
    }
  })

  test("rejects a basename when it is only a suffix of a longer path", () => {
    expect(isSynthesisFilePathCited("capitulos/metodo.tex", "metodo.tex")).toBe(false)
  })

  test("handles repeated-dot collisions as token content but accepts terminal punctuation", () => {
    const filePath = "capitulos/metodo.tex"

    expect(isSynthesisFilePathCited("prefix..capitulos/metodo.tex", filePath)).toBe(false)
    expect(isSynthesisFilePathCited("...capitulos/metodo.tex", filePath)).toBe(true)
    expect(isSynthesisFilePathCited("capitulos/metodo.tex..backup", filePath)).toBe(false)
    expect(isSynthesisFilePathCited("capitulos/metodo.tex...", filePath)).toBe(true)
  })

  test("recognizes two distinct present paths and does not infer a third", () => {
    const prose =
      "Evidências em capitulos/metodo.tex e figuras/resultado_final-β.tex; apêndice não citado."

    expect(isSynthesisFilePathCited(prose, "capitulos/metodo.tex")).toBe(true)
    expect(isSynthesisFilePathCited(prose, "figuras/resultado_final-β.tex")).toBe(true)
    expect(isSynthesisFilePathCited(prose, "anexos/tabelas.tex")).toBe(false)
  })

  test("does not normalize case or alternate slash forms", () => {
    expect(
      isSynthesisFilePathCited("Capitulos/metodo.tex", "capitulos/metodo.tex"),
    ).toBe(false)
    expect(
      isSynthesisFilePathCited("capitulos\\metodo.tex", "capitulos/metodo.tex"),
    ).toBe(false)
  })

  test("returns false for empty values and runtime-invalid arguments", () => {
    const isCited = isSynthesisFilePathCited as (
      windowText: unknown,
      filePath: unknown,
    ) => boolean

    expect(isCited("", "main.tex")).toBe(false)
    expect(isCited("main.tex", "")).toBe(false)
    expect(isCited("main.tex", " \t\n ")).toBe(false)
    expect(isCited(null, "main.tex")).toBe(false)
    expect(isCited(undefined, "main.tex")).toBe(false)
    expect(isCited(1, "main.tex")).toBe(false)
    expect(isCited("main.tex", null)).toBe(false)
    expect(isCited("main.tex", undefined)).toBe(false)
    expect(isCited("main.tex", 1)).toBe(false)
  })

  test("documents lexical false-positive and false-negative cases", () => {
    // An exact path can be incidental and unrelated to the finding.
    expect(
      isSynthesisFilePathCited(
        "Arquivo citado em uma lista: capitulos/metodo.tex",
        "capitulos/metodo.tex",
      ),
    ).toBe(true)
    // A basename alias is not guessed as an equivalent citation.
    expect(
      isSynthesisFilePathCited(
        "O método está documentado em metodo.tex",
        "capitulos/metodo.tex",
      ),
    ).toBe(false)
  })
})
