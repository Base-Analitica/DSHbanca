const TOKEN_CONTINUATION = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}\u002F]/u

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

function codePointAt(text: string, index: number): string | undefined {
  if (index >= text.length) return undefined
  const codePoint = text.codePointAt(index)
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint)
}

function isTokenContinuation(character: string | undefined): boolean {
  return character !== undefined && TOKEN_CONTINUATION.test(character)
}

function hasLeftTokenBoundary(text: string, index: number): boolean {
  const before = codePointBefore(text, index)
  if (before === ".") {
    // A dot attached to an identifier is not sentence punctuation.
    return !isTokenContinuation(codePointBefore(text, index - before.length))
  }
  return !isTokenContinuation(before)
}

function hasRightTokenBoundary(text: string, index: number): boolean {
  const after = codePointAt(text, index)
  if (after === ".") {
    // A dot run followed by an identifier character belongs to the token; a
    // terminal dot run remains punctuation.
    let nextIndex = index + after.length
    while (codePointAt(text, nextIndex) === ".") nextIndex += 1
    return !isTokenContinuation(codePointAt(text, nextIndex))
  }
  return !isTokenContinuation(after)
}

/**
 * Detects a literal, case-sensitive sectionId token in a caller-supplied prose
 * window. The caller supplies an already-validated ID; this helper performs no
 * file, manuscript, or semantic checks and does not normalize identifier text.
 *
 * Unrelated prose may contain the same exact token (a lexical false positive).
 * An alias or citation format without the literal ID may be missed (a lexical
 * false negative).
 */
export function isSynthesisSectionIdCited(
  windowText: string,
  sectionId: string,
): boolean {
  if (
    typeof windowText !== "string" ||
    windowText.length === 0 ||
    typeof sectionId !== "string" ||
    sectionId.length === 0 ||
    sectionId.trim().length === 0 ||
    sectionId !== sectionId.trim()
  ) {
    return false
  }

  let index = windowText.indexOf(sectionId)
  while (index !== -1) {
    const end = index + sectionId.length
    if (hasLeftTokenBoundary(windowText, index) && hasRightTokenBoundary(windowText, end)) {
      return true
    }
    index = windowText.indexOf(sectionId, index + 1)
  }

  return false
}
