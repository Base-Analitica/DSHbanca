import { describe, expect, test } from "bun:test";
import {
  findSynthesisInstitutionalTerms,
  type SynthesisInstitutionalTerm,
} from "../src/lib/academic_synthesis_language";

const isolatedExamples: Array<{
  category: SynthesisInstitutionalTerm;
  sample: string;
}> = [
  { category: "nota", sample: "nota" },
  { category: "score", sample: "score" },
  { category: "pontuação", sample: "pontuação" },
  { category: "aprovação", sample: "aprovação" },
  { category: "reprovação", sample: "reprovação" },
  { category: "aprovado", sample: "aprovado" },
  { category: "reprovado", sample: "reprovado" },
  { category: "conceito", sample: "conceito final" },
  { category: "média", sample: "média final" },
];

describe("findSynthesisInstitutionalTerms", () => {
  test("returns no categories for empty, whitespace-only, or unrelated text", () => {
    for (const text of ["", "   \n\t  ", "Uma análise descritiva das seções."]) {
      expect(findSynthesisInstitutionalTerms(text)).toEqual([]);
    }
  });

  for (const { category, sample } of isolatedExamples) {
    test(`detects the isolated ${category} category`, () => {
      expect(findSynthesisInstitutionalTerms(sample)).toEqual([category]);
    });
  }

  test("recognizes only the historical spelling and inflection variants", () => {
    const variants: Array<[string, SynthesisInstitutionalTerm]> = [
      ["notas", "nota"],
      ["NOTAS", "nota"],
      ["scores", "score"],
      ["SCORES", "score"],
      ["pontuacao", "pontuação"],
      ["pontuacão", "pontuação"],
      ["pontuaçao", "pontuação"],
      ["PONTUAÇÃO", "pontuação"],
      ["aprovacao", "aprovação"],
      ["aprovacão", "aprovação"],
      ["aprovaçao", "aprovação"],
      ["APROVAÇÃO", "aprovação"],
      ["reprovacao", "reprovação"],
      ["reprovacão", "reprovação"],
      ["reprovaçao", "reprovação"],
      ["REPROVAÇÃO", "reprovação"],
      ["aprovada", "aprovado"],
      ["aprovados", "aprovado"],
      ["aprovadas", "aprovado"],
      ["reprovada", "reprovado"],
      ["reprovados", "reprovado"],
      ["reprovadas", "reprovado"],
    ];

    for (const [text, expected] of variants) {
      expect(findSynthesisInstitutionalTerms(text)).toEqual([expected]);
    }
  });

  test("requires a listed contextual word after conceito", () => {
    for (const text of [
      "conceito final",
      "conceito global",
      "conceito geral",
      "CONCEITO GERAL",
    ]) {
      expect(findSynthesisInstitutionalTerms(text)).toEqual(["conceito"]);
    }
  });

  test("requires a listed contextual word after média or media", () => {
    for (const text of [
      "média final",
      "media global",
      "média geral",
      "media ponderada",
      "MÉDIA PONDERADA",
    ]) {
      expect(findSynthesisInstitutionalTerms(text)).toEqual(["média"]);
    }
  });

  test("accepts the historical whitespace between contextual phrase words", () => {
    expect(findSynthesisInstitutionalTerms("conceito\tgeral e média\nponderada"))
      .toEqual(["conceito", "média"]);
  });

  test("does not infer unlisted contexts or generalized plurals", () => {
    for (const text of [
      "conceito",
      "conceitos final",
      "conceito finais",
      "média",
      "médias finais",
      "media ponderadas",
      "médias ponderadas",
      "pontuàção",
    ]) {
      expect(findSynthesisInstitutionalTerms(text)).toEqual([]);
    }
  });

  test("uses whole-word boundaries rather than matching embedded terms", () => {
    for (const text of [
      "anotação",
      "scoresheet",
      "megapontuaçãox",
      "inaprovada",
      "irreprovação",
      "conceitual final",
    ]) {
      expect(findSynthesisInstitutionalTerms(text)).toEqual([]);
    }

    expect(findSynthesisInstitutionalTerms("(notas), [scores]"))
      .toEqual(["nota", "score"]);
  });

  test("returns categories once each in the declared order, regardless of text order", () => {
    const text =
      "média ponderada; conceito geral; reprovadas; aprovados; reprovação; " +
      "aprovacão; pontuacao; scores; notas; nota; NOTA";

    expect(findSynthesisInstitutionalTerms(text)).toEqual([
      "nota",
      "score",
      "pontuação",
      "aprovação",
      "reprovação",
      "aprovado",
      "reprovado",
      "conceito",
      "média",
    ]);
  });

  test("signals the synthetic institutional-language fixture lexically", () => {
    expect(
      findSynthesisInstitutionalTerms(
        "A nota final seria 7 e a aprovação institucional é recomendada.",
      ),
    ).toEqual(["nota", "aprovação"]);
  });

  test("signals a negated mention without deciding that it is a violation", () => {
    expect(findSynthesisInstitutionalTerms("Não atribuir nota")).toEqual(["nota"]);
  });

  test("signals quoted language without interpreting the quotation", () => {
    expect(
      findSynthesisInstitutionalTerms('A orientação citava “nota final” e “conceito global”.'),
    ).toEqual(["nota", "conceito"]);
  });

  test("handles a long input with separated matches", () => {
    const text = `${"texto neutro ".repeat(10_000)}aprovação${" neutro".repeat(10_000)} conceito global`;
    expect(findSynthesisInstitutionalTerms(text)).toEqual(["aprovação", "conceito"]);
  });

  test("can miss an unlisted paraphrase, which is not evidence of compliance", () => {
    expect(
      findSynthesisInstitutionalTerms(
        "O desempenho parece suficiente para receber parecer favorável da banca.",
      ),
    ).toEqual([]);
  });
});
