import type { AnalysisFinding } from "./analysis_findings"
import { findSynthesisFindingIdOccurrences } from "./academic_synthesis_cited_finding_ids"
import { hasSynthesisFindingCitationTokensInWindow } from "./academic_synthesis_finding_citation_signals"

/**
 * Checks each complete lexical occurrence of the expected findingId in the
 * synthesis text. For an occurrence at UTF-16 offset `i`, the bounded window is
 * `text.slice(Math.max(0, i - 220), Math.min(text.length, i + findingId.length + 300))`.
 * The 220/300 limits reproduce the historical lexical window; they are not a
 * scientific rubric or semantic validation. A single window must satisfy all
 * four existing citation-token checks; signals from separate windows are never
 * combined.
 *
 * Incidental co-occurrence can be a false positive, while aliases and unsupported
 * citation forms can be false negatives. `true` is only a located lexical signal:
 * this function does not validate the finding, source, claim, provenance, or
 * scientific quality and performs no I/O or mutation.
 */
export function hasSynthesisFindingCitationInAnchoredWindows(
  text: string,
  expected: Pick<
    AnalysisFinding,
    "findingId" | "file" | "startLine" | "endLine" | "sectionId"
  >,
): boolean {
  if (
    typeof text !== "string" ||
    text.trim().length === 0 ||
    expected == null ||
    typeof expected !== "object" ||
    Array.isArray(expected)
  ) {
    return false
  }

  const { findingId } = expected
  if (
    typeof findingId !== "string" ||
    findingId.length === 0 ||
    findingId.trim().length === 0 ||
    findingId !== findingId.trim()
  ) {
    return false
  }

  for (const index of findSynthesisFindingIdOccurrences(text, findingId)) {
    const start = Math.max(0, index - 220)
    const end = Math.min(text.length, index + findingId.length + 300)
    if (hasSynthesisFindingCitationTokensInWindow(text.slice(start, end), expected)) {
      return true
    }
  }

  return false
}
