const TOKEN_CONTINUATION = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}/\\]/u

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
    // A complete dot run attached to an identifier is token content, not a boundary.
    let previousIndex = index - before.length
    while (codePointBefore(text, previousIndex) === ".") previousIndex -= 1
    return !isTokenContinuation(codePointBefore(text, previousIndex))
  }
  return !isTokenContinuation(before)
}

function hasRightTokenBoundary(text: string, index: number): boolean {
  const after = codePointAt(text, index)
  if (after === ".") {
    // A dot run followed by an identifier is token content; a terminal run is punctuation.
    let nextIndex = index + after.length
    while (codePointAt(text, nextIndex) === ".") nextIndex += 1
    return !isTokenContinuation(codePointAt(text, nextIndex))
  }
  return !isTokenContinuation(after)
}

/**
 * Detects a literal, case-sensitive POSIX-relative file-path token in a
 * caller-bounded synthesis window. The caller supplies a path from a validated finding;
 * this function neither validates nor normalizes paths, and performs no I/O.
 *
 * Unrelated prose can mention the exact path (a lexical false positive). An alias,
 * encoded reference, or alternate path spelling without the literal token can be
 * missed (a lexical false negative). A match proves neither file existence nor
 * that the file supports any academic claim.
 */
export function isSynthesisFilePathCited(
  windowText: string,
  filePath: string,
): boolean {
  if (
    typeof windowText !== "string" ||
    windowText.length === 0 ||
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.trim().length === 0
  ) {
    return false
  }

  let index = windowText.indexOf(filePath)
  while (index !== -1) {
    const end = index + filePath.length
    if (
      hasLeftTokenBoundary(windowText, index) &&
      hasRightTokenBoundary(windowText, end)
    ) {
      return true
    }
    index = windowText.indexOf(filePath, index + 1)
  }

  return false
}
