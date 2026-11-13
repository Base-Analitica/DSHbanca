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

// ---------------------------------------------------------------------------
// Issue #112 — lexical recognition of real LaTeX citation commands.
//
// The recognizer is lexical: it understands comments, escapes, optional
// arguments and balanced required groups for an explicit allowlist of citation
// commands (abntex2cite/BibLaTeX), but it does not expand macros, interpret
// packages or parse full TeX. All fixtures below are synthetic.
// ---------------------------------------------------------------------------

/** Wrap a citation candidate in one meaningful paragraph (> 20 trimmed chars). */
function citationParagraph(snippet: string): string {
  return `Este parágrafo suficientemente longo contém ${snippet} no meio do texto.`
}

function paragraphIsCited(paragraph: string): boolean {
  const result = analyzeCitationDensity(paragraph)
  expect(result.totalParagraphs).toBe(1)
  return result.citedParagraphs === 1
}

const positiveCitationCases: Array<[string, string]> = [
  ["compatibilidade com \\cite", String.raw`\cite{autor2020}`],
  ["compatibilidade com \\citeonline", String.raw`\citeonline{autor2020}`],
  ["\\citeauthor", String.raw`\citeauthor{autor2020}`],
  ["\\apud com dois argumentos obrigatórios", String.raw`\apud{autorOriginal}{autorConsultado}`],
  ["\\apud com opcional (assinatura abntex2cite)", String.raw`\apud[p.~2--3]{autorOriginal}{autorConsultado}`],
  ["\\apudonline documentado no abntex2cite", String.raw`\apudonline[p.~3]{autorOriginal}{autorConsultado}`],
  ["\\apudonline sem opcional", String.raw`\apudonline{autorOriginal}{autorConsultado}`],
  ["\\parencite", String.raw`\parencite{autor2020}`],
  ["\\textcite", String.raw`\textcite{autor2020}`],
  ["opcional simples em \\cite", String.raw`\cite[p.~42]{autor2020}`],
  ["opcional simples em \\citeonline", String.raw`\citeonline[p.~5]{autor2020}`],
  ["opcional simples em \\textcite", String.raw`\textcite[p.~9]{autor2020}`],
  ["múltiplos opcionais em \\parencite", String.raw`\parencite[ver][p.~12]{autor2020}`],
  ["dois opcionais em \\cite", String.raw`\cite[p.~1][cap.~2]{autor2020}`],
  ["opcional com grupo balanceado", String.raw`\cite[p.~{42}]{autor2020}`],
  ["múltiplas chaves", String.raw`\cite{autor2020,autor2021}`],
  ["grupo aninhado no argumento", String.raw`\cite{autor{2020}}`],
  ["macro de acento no argumento", String.raw`\cite{autor{\c{c}}ao2020}`],
  ["chaves escapadas no argumento", String.raw`\cite{autor\{2020\}}`],
  ["espaços entre comando e argumentos", String.raw`\cite [p.~10] {autor2020}`],
  ["quebra de linha entre os argumentos", "\\parencite\n[ver]\n[p.~12]\n{autor2020}"],
  ["quebra de linha depois do comando", "\\textcite\n{autor2020}"],
  ["comando válido após linha comentada", "% \\cite{ignorada}\nAgora a citação real \\parencite{autor2020} aparece."],
  ["percentual escapado antes da citação", "50\\% \\cite{autor2020}"],
  ["barra dupla antes de citação válida (quebra de linha)", String.raw`\\\cite{autor2020}`],
]

describe("citation command recognition (issue #112) — positives", () => {
  test.each(positiveCitationCases)("recognizes %s", (_label: string, snippet: string) => {
    expect(paragraphIsCited(citationParagraph(snippet))).toBe(true)
  })
})

const negativeCitationCases: Array<[string, string]> = [
  ["citação apenas em comentário", "% \\cite{autor2020}"],
  ["citação em linha comentada", "Linha comentada % \\cite{autor2020}\nresto do parágrafo sem citação."],
  ["comando escapado com duas barras", String.raw`\\cite{autor2020}`],
  ["comando escapado com quatro barras", String.raw`\\\\cite{autor2020}`],
  ["percentual duplo escapado seguido de citação comentada", String.raw`\\% \cite{autor2020}`],
  ["nome semelhante: \\citetext", String.raw`\citetext{autor2020}`],
  ["nome semelhante: \\citep", String.raw`\citep{autor2020}`],
  ["nome semelhante: \\citeyear", String.raw`\citeyear{autor2020}`],
  ["nome semelhante: \\nocite", String.raw`\nocite{autor2020}`],
  ["nome semelhante: \\Cite", String.raw`\Cite{autor2020}`],
  ["prefixo estendido: \\citeauthorx", String.raw`\citeauthorx{autor2020}`],
  ["variante estrelada: \\citeauthor*", String.raw`\citeauthor*{autor2020}`],
  ["grupo obrigatório ausente", String.raw`\parencite[p.~12]`],
  ["grupo obrigatório vazio", String.raw`\cite{}`],
  ["grupo obrigatório só com espaços", String.raw`\cite{ }`],
  ["grupo obrigatório só com separadores", String.raw`\cite{,}`],
  ["grupo obrigatório só com comentário", "\\cite{% somente comentário\n}"],
  ["grupo obrigatório desbalanceado", String.raw`\cite{{autor2020}`],
  ["argumento opcional incompleto", String.raw`\cite[p.~42{autor2020}`],
  ["\\apud com apenas um argumento obrigatório", String.raw`\apud{autorOriginal}`],
  ["\\apud com primeiro argumento vazio", String.raw`\apud{}{autorConsultado}`],
  ["\\apud com segundo argumento vazio", String.raw`\apud{autorOriginal}{}`],
  ["\\apud com dois opcionais (assinatura aceita um)", String.raw`\apud[original][consultado]{autorOriginal}{autorConsultado}`],
  ["\\apudonline com apenas um argumento obrigatório", String.raw`\apudonline{autorOriginal}`],
  ["\\citeonline com dois opcionais (assinatura aceita um)", String.raw`\citeonline[a][b]{autor2020}`],
  ["comando truncado no fim do conteúdo", String.raw`\textcite{autor2020`],
  ["comando sem argumentos no fim do conteúdo", String.raw`\parencite`],
]

describe("citation command recognition (issue #112) — negatives", () => {
  test.each(negativeCitationCases)("does not recognize %s", (_label: string, snippet: string) => {
    expect(paragraphIsCited(citationParagraph(snippet))).toBe(false)
  })
})

describe("citation-density contract preserved (issue #112)", () => {
  function corpus(total: number, cited: number): string {
    const paragraphs: string[] = []
    for (let index = 0; index < total; index += 1) {
      paragraphs.push(
        index < cited
          ? `Parágrafo ${index} suficientemente longo com citação \\parencite{ref${index}} no meio.`
          : `Parágrafo ${index} suficientemente longo porém sem nenhuma citação no meio.`,
      )
    }
    return paragraphs.join("\n\n")
  }

  test("exactly 20% without citation keeps score 8.0", () => {
    const result = analyzeCitationDensity(corpus(10, 8))
    expect(result.totalParagraphs).toBe(10)
    expect(result.citedParagraphs).toBe(8)
    expect(result.paragraphsWithoutCitation).toBe(2)
    expect(result.percentWithoutCitation).toBe(20)
    expect(result.score).toBe(8.0)
  })

  test("exactly 30% without citation keeps score 6.0", () => {
    const result = analyzeCitationDensity(corpus(10, 7))
    expect(result.percentWithoutCitation).toBe(30)
    expect(result.score).toBe(6.0)
  })

  test("above 30% without citation maps to 4.0", () => {
    const result = analyzeCitationDensity(corpus(10, 6))
    expect(result.percentWithoutCitation).toBeCloseTo(40, 10)
    expect(result.score).toBe(4.0)
  })

  test("25% without citation maps to 6.0", () => {
    const result = analyzeCitationDensity(corpus(4, 3))
    expect(result.percentWithoutCitation).toBeCloseTo(25, 10)
    expect(result.score).toBe(6.0)
  })

  test("percentWithoutCitation stays unrounded", () => {
    const result = analyzeCitationDensity(corpus(3, 2))
    expect(result.percentWithoutCitation).toBeCloseTo(33.333, 2)
    expect(result.score).toBe(4.0)
  })

  test("multiple supported citations in one paragraph count once", () => {
    const result = analyzeCitationDensity(
      "Um parágrafo suficientemente longo com \\parencite{a} e \\textcite{b} juntos.",
    )
    expect(result.totalParagraphs).toBe(1)
    expect(result.citedParagraphs).toBe(1)
  })

  test("short paragraphs stay out of the denominator", () => {
    const result = analyzeCitationDensity(
      [
        "Parágrafo suficientemente longo com \\parencite{autor2020} no meio.",
        "Curto.",
        "Parágrafo suficientemente longo sem nenhuma citação no meio do texto.",
      ].join("\n\n"),
    )
    expect(result.totalParagraphs).toBe(2)
    expect(result.citedParagraphs).toBe(1)
    expect(result.paragraphsWithoutCitation).toBe(1)
    expect(result.percentWithoutCitation).toBe(50)
    expect(result.score).toBe(4.0)
  })

  test("does not join citation commands across paragraph boundaries", () => {
    const result = analyzeCitationDensity(
      [
        "Um parágrafo suficientemente longo que termina com \\parencite",
        "{autor2020} e continua em outro parágrafo suficientemente longo.",
      ].join("\n\n"),
    )
    expect(result.totalParagraphs).toBe(2)
    expect(result.citedParagraphs).toBe(0)
  })
})
