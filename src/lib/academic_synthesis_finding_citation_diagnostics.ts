import type { AnalysisFinding } from "./analysis_findings"
import { isSynthesisFindingIdCited } from "./academic_synthesis_cited_finding_ids"
import { hasSynthesisFindingCitationInAnchoredWindows } from "./academic_synthesis_finding_anchored_windows"
import { findUnallowlistedSynthesisFindingIds } from "./academic_synthesis_finding_ids"

export interface SynthesisFindingCitationDiagnostics {
  citedFindingIds: string[]
  citedWithoutLocalTraceabilityFindingIds: string[]
  unexpectedFindingIdTokens: string[]
}

type ExpectedSynthesisFinding = Pick<
  AnalysisFinding,
  "findingId" | "file" | "startLine" | "endLine" | "sectionId"
>

function isCanonicalNonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0 &&
    value === value.trim()
  )
}

function isExpectedSynthesisFinding(value: unknown): value is ExpectedSynthesisFinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false

  const finding = value as Record<string, unknown>
  return (
    isCanonicalNonEmptyString(finding.findingId) &&
    isCanonicalNonEmptyString(finding.file) &&
    Number.isSafeInteger(finding.startLine) &&
    (finding.startLine as number) > 0 &&
    Number.isSafeInteger(finding.endLine) &&
    (finding.endLine as number) >= (finding.startLine as number) &&
    isCanonicalNonEmptyString(finding.sectionId)
  )
}

function findingIdComparisonKey(findingId: string): string {
  const lowerCaseId = findingId.toLowerCase()
  const upperCaseId = findingId.toUpperCase()

  // Reuse 07e's token rules to recognize complete case-insensitive SHA-256 IDs;
  // non-hash IDs remain exact and case-sensitive without duplicating its regex.
  if (
    isSynthesisFindingIdCited(lowerCaseId, findingId) &&
    isSynthesisFindingIdCited(upperCaseId, findingId)
  ) {
    return lowerCaseId
  }
  return findingId
}

/**
 * Composes the existing 07a, 07e, and 07g lexical signals for a list of
 * caller-validated expected findings. A cited ID means only that 07e found its
 * complete token; local traceability means only that 07g found the other three
 * expected tokens in the same bounded, anchored window. Expected IDs not cited
 * are not errors.
 *
 * This lexical-only diagnostic can flag incidental tokens or co-occurrence as
 * false positives, and miss aliases or unsupported citation forms as false
 * negatives. It does not establish finding provenance, source existence or
 * support, semantic association, claim validity, completeness, or scientific
 * quality. The caller remains responsible for finding validation.
 *
 * Invalid runtime inputs, malformed findings, noncanonical strings, unsafe or
 * reversed line ranges, and duplicate expected finding IDs return `null`.
 * Inputs are inspected but never normalized or mutated.
 */
export function inspectSynthesisFindingCitationSignals(
  text: string,
  expected: readonly ExpectedSynthesisFinding[],
  nonFindingIds: readonly string[] = [],
): SynthesisFindingCitationDiagnostics | null {
  try {
    if (typeof text !== "string" || !Array.isArray(expected)) return null
    if (!Array.isArray(nonFindingIds)) return null

    const expectedFindings: ExpectedSynthesisFinding[] = []
    const seenFindingIds = new Set<string>()
    for (const candidate of expected as readonly unknown[]) {
      if (!isExpectedSynthesisFinding(candidate)) return null

      const key = findingIdComparisonKey(candidate.findingId)
      if (seenFindingIds.has(key)) return null
      seenFindingIds.add(key)
      expectedFindings.push(candidate)
    }

    for (const nonFindingId of nonFindingIds as readonly unknown[]) {
      if (!isCanonicalNonEmptyString(nonFindingId)) return null
    }

    const citedFindingIds: string[] = []
    const citedWithoutLocalTraceabilityFindingIds: string[] = []
    for (const finding of expectedFindings) {
      if (!isSynthesisFindingIdCited(text, finding.findingId)) continue

      citedFindingIds.push(finding.findingId)
      if (!hasSynthesisFindingCitationInAnchoredWindows(text, finding)) {
        citedWithoutLocalTraceabilityFindingIds.push(finding.findingId)
      }
    }

    const unexpectedFindingIdTokens = findUnallowlistedSynthesisFindingIds(
      text,
      expectedFindings.map((finding) => finding.findingId),
      nonFindingIds,
    )

    return {
      citedFindingIds,
      citedWithoutLocalTraceabilityFindingIds,
      unexpectedFindingIdTokens,
    }
  } catch {
    return null
  }
}
