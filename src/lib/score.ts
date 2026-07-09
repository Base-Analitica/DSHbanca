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

export function calcularNotaFinal(scores: Omit<ScoreCard, "notaFinal" | "aprovado">): { notaFinal: number; aprovado: boolean } {
  const { abnt, citacoes, conteudo, estilo, travas, tetos } = scores
  const media = (abnt + citacoes + conteudo + estilo) / 4

  const menorTrava = travas.length > 0
    ? Math.min(...travas.map((t) => parseFloat(t)))
    : 10

  const notaFinal = Math.min(media, menorTrava)

  for (const teto of tetos) {
    const val = parseFloat(teto)
    if (media < val) notaFinal < val ? null : null // teto buffer
  }

  return { notaFinal, aprovado: notaFinal >= 9.0 }
}
