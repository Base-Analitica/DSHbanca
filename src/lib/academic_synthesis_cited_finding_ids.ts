const TOKEN_CONTINUATION = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}/\\]/u

function isSha256Id(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

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
    // A dot run followed by an identifier extends the token; a terminal run is punctuation.
    let nextIndex = index + after.length
    while (codePointAt(text, nextIndex) === ".") nextIndex += 1
    return !isTokenContinuation(codePointAt(text, nextIndex))
  }
  return !isTokenContinuation(after)
}

function hasExactToken(text: string, findingId: string): boolean {
  const hexOnly = /^[a-f0-9]+$/i.test(findingId)
  if (hexOnly && !isSha256Id(findingId)) {
    // Hex-only IDs are SHA-256 candidates, not non-hash IDs, unless exactly 64 chars.
    return false
  }

  if (hexOnly) {
    // findingId is restricted to hex here, so the case-insensitive pattern is literal.
    const candidates = new RegExp(findingId, "gi")
    for (const match of text.matchAll(candidates)) {
      const index = match.index
      const end = index + findingId.length
      if (hasLeftTokenBoundary(text, index) && hasRightTokenBoundary(text, end)) {
        return true
      }
    }
    return false
  }

  let index = text.indexOf(findingId)
  while (index !== -1) {
    const end = index + findingId.length
    if (hasLeftTokenBoundary(text, index) && hasRightTokenBoundary(text, end)) {
      return true
    }
    index = text.indexOf(findingId, index + 1)
  }
  return false
}

/**
 * Detects only the exact expected findingId as a complete lexical token inside
 * a caller-bounded synthesis window. The caller supplies an already-validated
 * ID; this helper does not normalize it, access a manuscript, or validate
 * provenance, evidence, claims, or academic conclusions.
 *
 * An incidental mention of the same token is a possible false positive. An
 * alias or reference expressed without the literal ID is a possible false
 * negative. A positive result is a lexical signal, not semantic validation.
 */
export function isSynthesisFindingIdCited(
  windowText: string,
  findingId: string,
): boolean {
  if (
    typeof windowText !== "string" ||
    windowText.trim().length === 0 ||
    typeof findingId !== "string" ||
    findingId.length === 0 ||
    findingId.trim().length === 0 ||
    findingId !== findingId.trim()
  ) {
    return false
  }

  return hasExactToken(windowText, findingId)
}
