export interface ScoreCard {
  abnt: number
  citacoes: number
  conteudo: number
  estilo: number
  integrador: number
  notasIndividuais: Record<string, number>
  travas: string[]
  tetos: string[]
  notaFinal: number
  aprovado: boolean
}

/**
 * Parse a numeric cap ("travas"/"tetos" entries). Non-finite or malformed
 * values are ignored so a single bad entry cannot poison the final grade.
 */
function parseCap(raw: string): number {
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : Number.NaN
}

export function calcularNotaFinal(scores: Omit<ScoreCard, "notaFinal" | "aprovado">): { notaFinal: number; aprovado: boolean } {
  const { abnt, citacoes, conteudo, estilo, travas, tetos } = scores
  const media = (abnt + citacoes + conteudo + estilo) / 4

  // Both travas (hard locks) and tetos (ceilings) cap the final grade:
  // notaFinal can never exceed the lowest applicable cap.
  const caps: number[] = [media]
  for (const raw of [...travas, ...tetos]) {
    const value = parseCap(raw)
    if (Number.isFinite(value)) caps.push(value)
  }

  const notaFinal = Math.min(...caps)

  return { notaFinal, aprovado: notaFinal >= 9.0 }
}
