import { describe, test, expect } from "bun:test"
import { calcularNotaFinal, type ScoreCard } from "../src/lib/score"

function baseScores(overrides: Partial<Omit<ScoreCard, "notaFinal" | "aprovado">> = {}) {
  return {
    abnt: 8,
    citacoes: 8,
    conteudo: 8,
    estilo: 8,
    integrador: 8,
    notasIndividuais: {},
    travas: [],
    tetos: [],
    ...overrides,
  }
}

describe("calcularNotaFinal", () => {
  test("plain average when no caps", () => {
    const r = calcularNotaFinal(baseScores())
    expect(r.notaFinal).toBe(8)
    expect(r.aprovado).toBe(false)
  })

  test("trava caps the final grade", () => {
    const r = calcularNotaFinal(baseScores({ travas: ["6.5"] }))
    expect(r.notaFinal).toBe(6.5)
  })

  test("teto caps the final grade (previously dead code)", () => {
    const r = calcularNotaFinal(baseScores({ tetos: ["7.0"] }))
    expect(r.notaFinal).toBe(7.0)
  })

  test("lowest cap wins across travas and tetos", () => {
    const r = calcularNotaFinal(
      baseScores({ travas: ["6.5"], tetos: ["8.5"] }),
    )
    expect(r.notaFinal).toBe(6.5)
  })

  test("malformed cap values do not poison the grade", () => {
    const r = calcularNotaFinal(
      baseScores({ abnt: 9.5, citacoes: 9.5, conteudo: 9.5, estilo: 9.5, travas: ["abc", "9.0"], tetos: ["n/a"] }),
    )
    expect(r.notaFinal).toBe(9.0)
    expect(Number.isNaN(r.notaFinal)).toBe(false)
  })

  test("all-malformed caps fall back to the average", () => {
    const r = calcularNotaFinal(
      baseScores({ travas: ["abc"], tetos: ["xyz"] }),
    )
    expect(r.notaFinal).toBe(8)
  })

  test("approval threshold at 9.0", () => {
    const below = calcularNotaFinal(baseScores({ abnt: 9.5, citacoes: 9.5, conteudo: 9.5, estilo: 9.5, travas: ["8.9"] }))
    expect(below.aprovado).toBe(false)
    const at = calcularNotaFinal(baseScores({ abnt: 9.5, citacoes: 9.5, conteudo: 9.5, estilo: 9.5, travas: ["9.0"] }))
    expect(at.aprovado).toBe(true)
  })
})
