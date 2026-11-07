const TOKEN_CONTINUATION = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}/\\]/u
const SECTION_TOKEN_CONTINUATION = /[\p{L}\p{M}\p{N}\p{Pc}\p{Pd}/]/u

type TokenBoundaryKind = "findingId" | "filePath" | "sectionId"

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

function isTokenContinuation(
  character: string | undefined,
  boundaryKind: TokenBoundaryKind,
): boolean {
  if (character === undefined) return false
  return (boundaryKind === "sectionId"
    ? SECTION_TOKEN_CONTINUATION
    : TOKEN_CONTINUATION
  ).test(character)
}

function hasLeftTokenBoundary(
  text: string,
  index: number,
  boundaryKind: TokenBoundaryKind = "findingId",
): boolean {
  const before = codePointBefore(text, index)
  if (before === ".") {
    // A complete dot run attached to an identifier is token content, not a boundary.
    let previousIndex = index - before.length
    while (codePointBefore(text, previousIndex) === ".") previousIndex -= 1
    return !isTokenContinuation(codePointBefore(text, previousIndex), boundaryKind)
  }
  return !isTokenContinuation(before, boundaryKind)
}

function hasRightTokenBoundary(
  text: string,
  index: number,
  boundaryKind: TokenBoundaryKind = "findingId",
): boolean {
  const after = codePointAt(text, index)
  if (after === ".") {
    // A dot run followed by an identifier extends the token; a terminal run is punctuation.
    let nextIndex = index + after.length
    while (codePointAt(text, nextIndex) === ".") nextIndex += 1
    return !isTokenContinuation(codePointAt(text, nextIndex), boundaryKind)
  }
  return !isTokenContinuation(after, boundaryKind)
}

/**
 * Yields every complete, case-sensitive lexical occurrence of a file path or
 * section ID using the same Unicode and dot-run boundary rules as its existing
 * citation helper. Section IDs retain their narrower backslash boundary rule.
 */
export function* findSynthesisCitationTokenOccurrences(
  text: string,
  token: string,
  boundaryKind: "filePath" | "sectionId",
): Generator<number, void, void> {
  if (
    typeof text !== "string" ||
    typeof token !== "string" ||
    token.length === 0 ||
    token.trim().length === 0 ||
    (boundaryKind === "sectionId" && token !== token.trim())
  ) {
    return
  }

  let index = text.indexOf(token)
  while (index !== -1) {
    const end = index + token.length
    if (
      hasLeftTokenBoundary(text, index, boundaryKind) &&
      hasRightTokenBoundary(text, end, boundaryKind)
    ) {
      yield index
    }
    index = text.indexOf(token, index + 1)
  }
}

/**
 * Yields every occurrence of the expected ID that is a complete lexical token.
 * The existing citation predicate and anchored-window search share this one
 * boundary implementation so their SHA-256, literal-ID, and Unicode rules stay
 * identical.
 */
export function* findSynthesisFindingIdOccurrences(
  text: string,
  findingId: string,
): Generator<number, void, void> {
  if (
    typeof text !== "string" ||
    typeof findingId !== "string" ||
    findingId.length === 0 ||
    findingId.trim().length === 0 ||
    findingId !== findingId.trim()
  ) {
    return
  }

  const hexOnly = /^[a-f0-9]+$/i.test(findingId)
  if (hexOnly && !isSha256Id(findingId)) {
    // Hex-only IDs are SHA-256 candidates, not non-hash IDs, unless exactly 64 chars.
    return
  }

  if (hexOnly) {
    // findingId is restricted to hex here, so the case-insensitive pattern is literal.
    const candidates = new RegExp(findingId, "gi")
    for (const match of text.matchAll(candidates)) {
      const index = match.index
      const end = index + findingId.length
      if (hasLeftTokenBoundary(text, index) && hasRightTokenBoundary(text, end)) {
        yield index
      }
    }
    return
  }

  let index = text.indexOf(findingId)
  while (index !== -1) {
    const end = index + findingId.length
    if (hasLeftTokenBoundary(text, index) && hasRightTokenBoundary(text, end)) {
      yield index
    }
    index = text.indexOf(findingId, index + 1)
  }
}

function hasExactToken(text: string, findingId: string): boolean {
  for (const _index of findSynthesisFindingIdOccurrences(text, findingId)) {
    return true
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
