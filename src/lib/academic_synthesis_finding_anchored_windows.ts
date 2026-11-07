import type { AnalysisFinding } from "./analysis_findings"
import {
  findSynthesisCitationTokenOccurrences,
  findSynthesisFindingIdOccurrences,
} from "./academic_synthesis_cited_finding_ids"
import { isSynthesisLineRangeCited } from "./academic_synthesis_line_citations"
import { hasSynthesisFindingCitationTokensInWindow } from "./academic_synthesis_finding_citation_signals"

/**
 * Checks each complete lexical occurrence of the expected findingId in the
 * synthesis text. For an occurrence at UTF-16 offset `i`, the bounded window is
 * `text.slice(Math.max(0, i - 220), Math.min(text.length, i + findingId.length + 300))`.
 * The 220/300 limits reproduce the historical lexical window; they are not a
 * scientific rubric or semantic validation. A single window must satisfy all
 * four existing citation-token checks; signals from separate windows are never
 * combined. Literal file/section occurrences and line-token boundaries are then
 * checked against the original text so a slice edge cannot create a boundary.
 *
 * Incidental co-occurrence can be a false positive, while aliases and unsupported
 * citation forms can be false negatives. `true` is only a located lexical signal:
 * this function does not validate the finding, source, claim, provenance, or
 * scientific quality and performs no I/O or mutation.
 */
const LINE_TOKEN_START_CONTINUATION = /[\p{L}\p{N}_.-]/u
const LINE_TOKEN_CONTINUATION = /[\p{L}\p{N}_-]/u
const LINE_TOKEN_PUNCTUATION = /[.,]/u
const LINE_TOKEN_AFTER_PUNCTUATION = /[\p{L}\p{N}_]/u
const SINGLE_LINE_RANGE_CONTINUATION =
  /^[\t \u00a0]*[-–—][\t \u00a0]*\d|^[\t \u00a0]+a[\t \u00a0]+\d/iu

function codePointBefore(text: string, index: number): string | undefined {
  if (index <= 0) return undefined

  let start = index - 1
  const trailingCodeUnit = text.charCodeAt(start)
  if (trailingCodeUnit >= 0xdc00 && trailingCodeUnit <= 0xdfff && start > 0) {
    const leadingCodeUnit = text.charCodeAt(start - 1)
    if (leadingCodeUnit >= 0xd800 && leadingCodeUnit <= 0xdbff) start -= 1
  }
  return text.slice(start, index)
}

function lineCitationLeftBoundaryGuard(text: string, start: number): string {
  const before = codePointBefore(text, start)
  return before !== undefined && LINE_TOKEN_START_CONTINUATION.test(before) ? "x" : "!"
}

function codePointAt(text: string, index: number): string | undefined {
  if (index >= text.length) return undefined
  const codePoint = text.codePointAt(index)
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint)
}

function isLineTokenContinued(text: string, index: number): boolean {
  const after = codePointAt(text, index)
  if (after === undefined) return false
  if (LINE_TOKEN_CONTINUATION.test(after)) return true
  if (!LINE_TOKEN_PUNCTUATION.test(after)) return false
  const afterPunctuation = codePointAt(text, index + after.length)
  return afterPunctuation !== undefined && LINE_TOKEN_AFTER_PUNCTUATION.test(afterPunctuation)
}

function hasSingleLineRangeContinuation(text: string, index: number): boolean {
  return SINGLE_LINE_RANGE_CONTINUATION.test(text.slice(index))
}

function hasCitationTokenInsideWindow(
  occurrences: readonly number[],
  tokenLength: number,
  start: number,
  end: number,
): boolean {
  let low = 0
  let high = occurrences.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (occurrences[middle] < start) low = middle + 1
    else high = middle
  }
  return low < occurrences.length && occurrences[low] + tokenLength <= end
}

/**
 * The composer must see the exact slice. Recheck line citations whose boundary
 * may be changed by that slice, masking only affected trailing line numbers so
 * another complete citation inside the same slice can still satisfy the signal.
 */
function hasLineCitationWithOriginalRightBoundary(
  text: string,
  windowText: string,
  start: number,
  end: number,
  startLine: number,
  endLine: number,
): boolean {
  const leftGuard = lineCitationLeftBoundaryGuard(text, start)
  if (!isSynthesisLineRangeCited(`${leftGuard}${windowText}`, startLine, endLine)) return false
  if (end === text.length) return true

  const expectedTrailingLine = String(endLine)
  const maskedRanges: Array<{ start: number; end: number }> = []
  let index = windowText.indexOf(expectedTrailingLine)

  while (index !== -1) {
    const localEnd = index + expectedTrailingLine.length
    const absoluteEnd = start + localEnd
    const tokenBoundaryChanged =
      isLineTokenContinued(text, absoluteEnd) &&
      !isLineTokenContinued(windowText, localEnd)
    const singleRangeBoundaryChanged =
      startLine === endLine &&
      hasSingleLineRangeContinuation(text, absoluteEnd) &&
      !hasSingleLineRangeContinuation(windowText, localEnd)

    if (tokenBoundaryChanged || singleRangeBoundaryChanged) {
      maskedRanges.push({ start: index, end: localEnd })
    }
    index = windowText.indexOf(expectedTrailingLine, index + 1)
  }

  if (maskedRanges.length === 0) return true

  let boundaryCheckedWindow = windowText
  for (let rangeIndex = maskedRanges.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
    const range = maskedRanges[rangeIndex]
    boundaryCheckedWindow =
      boundaryCheckedWindow.slice(0, range.start) +
      "\u0000".repeat(range.end - range.start) +
      boundaryCheckedWindow.slice(range.end)
  }
  return isSynthesisLineRangeCited(
    `${leftGuard}${boundaryCheckedWindow}`,
    startLine,
    endLine,
  )
}

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

  const filePathOccurrences = Array.from(
    findSynthesisCitationTokenOccurrences(text, expected.file, "filePath"),
  )
  const sectionIdOccurrences = Array.from(
    findSynthesisCitationTokenOccurrences(text, expected.sectionId, "sectionId"),
  )

  for (const index of findSynthesisFindingIdOccurrences(text, findingId)) {
    const start = Math.max(0, index - 220)
    const end = Math.min(text.length, index + findingId.length + 300)
    const windowText = text.slice(start, end)
    if (!hasSynthesisFindingCitationTokensInWindow(windowText, expected)) continue
    if (!hasCitationTokenInsideWindow(filePathOccurrences, expected.file.length, start, end)) {
      continue
    }
    if (!hasCitationTokenInsideWindow(sectionIdOccurrences, expected.sectionId.length, start, end)) {
      continue
    }
    if (
      !hasLineCitationWithOriginalRightBoundary(
        text,
        windowText,
        start,
        end,
        expected.startLine,
        expected.endLine,
      )
    ) {
      continue
    }
    return true
  }

  return false
}
