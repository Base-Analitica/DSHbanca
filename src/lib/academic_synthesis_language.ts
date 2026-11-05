export type SynthesisInstitutionalTerm =
  | "nota"
  | "score"
  | "pontuação"
  | "aprovação"
  | "reprovação"
  | "aprovado"
  | "reprovado"
  | "conceito"
  | "média";

type LexicalRule = readonly [SynthesisInstitutionalTerm, RegExp];

const SYNTHESIS_LANGUAGE_RULES: readonly LexicalRule[] = [
  ["nota", /\bnotas?\b/i],
  ["score", /\bscores?\b/i],
  ["pontuação", /\bpontua[cç][aã]o\b/i],
  ["aprovação", /\baprova[cç][aã]o\b/i],
  ["reprovação", /\breprova[cç][aã]o\b/i],
  ["aprovado", /\baprovad[oa]s?\b/i],
  ["reprovado", /\breprovad[oa]s?\b/i],
  ["conceito", /\bconceito\s+(final|global|geral)\b/i],
  ["média", /\bm[eé]dia\s+(final|global|geral|ponderada)\b/i],
];

/**
 * Reports only whether a listed lexical pattern occurs in the supplied text.
 * It does not interpret negation, quotation, authorship, institutional policy,
 * or the academic meaning of a match or its absence.
 */
export function findSynthesisInstitutionalTerms(
  text: string,
): SynthesisInstitutionalTerm[] {
  const found = new Set<SynthesisInstitutionalTerm>();

  for (const [term, pattern] of SYNTHESIS_LANGUAGE_RULES) {
    if (pattern.test(text)) found.add(term);
  }

  return [...found];
}
