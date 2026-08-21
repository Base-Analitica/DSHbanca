/**
 * Canonical citation-density analysis over manuscript text.
 *
 * Single source of truth for the citation-based heuristic score used by
 * banca_loop and banca_corrigir (previously duplicated with divergent
 * formulas in each tool). This is a heuristic signal for citations only,
 * not a 4-eixos audit score, not academic proof.
 */

export interface CitationAnalysis {
  totalParagraphs: number
  citedParagraphs: number
  paragraphsWithoutCitation: number
  /** Percent of meaningful paragraphs without a citation, 0-100, unrounded. */
  percentWithoutCitation: number
  /** Heuristic citation score on the 0-10 rubric scale. */
  score: number
}

const PARAGRAPH_SPLIT_RE = /\n\s*\n/
const CITE_RE = /\\cite(?:online)?\{[^}]+\}/g

/**
 * Map percent of paragraphs without citations to the heuristic score.
 * > 30% → 4.0; > 20% → 6.0; otherwise 8.0.
 */
export function citationScore(percentWithoutCitation: number): number {
  if (percentWithoutCitation > 30) return 4.0
  if (percentWithoutCitation > 20) return 6.0
  return 8.0
}

/**
 * Analyze citation density of manuscript text. Meaningful paragraphs are
 * non-empty blocks with more than 20 trimmed characters, matching the
 * historical heuristic used by loop/correction flows.
 */
export function analyzeCitationDensity(content: string): CitationAnalysis {
  const paragraphs = content
    .split(PARAGRAPH_SPLIT_RE)
    .filter((p: string) => p.trim().length > 20)

  let citedParagraphs = 0
  for (const paragraph of paragraphs) {
    CITE_RE.lastIndex = 0
    if (CITE_RE.test(paragraph)) citedParagraphs++
  }

  const paragraphsWithoutCitation = paragraphs.length - citedParagraphs
  const percentWithoutCitation =
    paragraphs.length > 0
      ? (paragraphsWithoutCitation / paragraphs.length) * 100
      : 0

  return {
    totalParagraphs: paragraphs.length,
    citedParagraphs,
    paragraphsWithoutCitation,
    percentWithoutCitation,
    score: citationScore(percentWithoutCitation),
  }
}
