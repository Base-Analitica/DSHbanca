import type { AnalysisFinding } from "./analysis_findings"
import { isSynthesisFindingIdCited } from "./academic_synthesis_cited_finding_ids"
import { isSynthesisFilePathCited } from "./academic_synthesis_file_paths"
import { isSynthesisLineRangeCited } from "./academic_synthesis_line_citations"
import { isSynthesisSectionIdCited } from "./academic_synthesis_section_ids"

/**
 * Composes four existing lexical checks for the expected finding in one
 * caller-bounded synthesis window. The caller remains responsible for finding
 * validation, provenance, and window boundaries.
 *
 * Incidental co-occurrence of all four tokens can be a false positive; aliases
 * or unsupported citation forms can be false negatives. `true` is only a
 * lexical signal and proves neither semantic association, source support,
 * provenance, finding validity, nor scientific quality.
 */
export function hasSynthesisFindingCitationTokensInWindow(
  windowText: string,
  expected: Pick<
    AnalysisFinding,
    "findingId" | "file" | "startLine" | "endLine" | "sectionId"
  >,
): boolean {
  if (
    typeof windowText !== "string" ||
    windowText.trim().length === 0 ||
    expected == null ||
    typeof expected !== "object" ||
    Array.isArray(expected)
  ) {
    return false
  }

  const { findingId, file, startLine, endLine, sectionId } = expected
  if (
    typeof findingId !== "string" ||
    findingId.trim().length === 0 ||
    typeof file !== "string" ||
    file.trim().length === 0 ||
    typeof sectionId !== "string" ||
    sectionId.trim().length === 0 ||
    !Number.isSafeInteger(startLine) ||
    startLine <= 0 ||
    !Number.isSafeInteger(endLine) ||
    endLine < startLine
  ) {
    return false
  }

  return (
    isSynthesisFindingIdCited(windowText, findingId) &&
    isSynthesisFilePathCited(windowText, file) &&
    isSynthesisLineRangeCited(windowText, startLine, endLine) &&
    isSynthesisSectionIdCited(windowText, sectionId)
  )
}
