/** True only for a complete SHA-256 hexadecimal identifier. */
function isSha256HexId(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value)
}

function comparisonKey(id: string): string {
  return isSha256HexId(id) ? id.toLowerCase() : id
}

function createIdSet(ids: readonly string[]): Set<string> {
  return new Set(
    ids.filter((id) => id.length > 0).map((id) => comparisonKey(id)),
  )
}

function isBacktickedIdToken(value: string): boolean {
  // A hex-only token is a SHA-256 candidate only at its complete 64-character
  // length; don't reinterpret a truncated digest as an unrelated short ID.
  if (/^[a-f0-9]+$/i.test(value) && !isSha256HexId(value)) return false

  // Restrict inline-code matches to one identifier-like token. Explicit labels
  // are handled separately and may identify shorter values.
  return value.length >= 6 && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)
}

function isIdentifierContinuation(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_-]/.test(character)
}

/**
 * Finds distinct, lexically recognizable identifiers in synthesis prose that
 * are not present among previously validated findings.
 *
 * The caller must derive `allowedFindingIds` from validated finding data; this
 * function does not establish that an allowlist is trustworthy. `nonFindingIds`
 * suppresses incidental, unlabelled identifier tokens only and never makes a
 * `findingId=` or `findingId:` value valid. Neither a match nor an empty result
 * validates a claim, citation, source, line, section, or scientific conclusion.
 *
 * This deliberately lexical detector can flag ordinary inline code such as
 * `analysis` (false positive), and can miss an unlabelled non-hex ID that is
 * outside the recognized backticked-token form, or an ID-like claim with no
 * detectable token (false negative).
 */
export function findUnallowlistedSynthesisFindingIds(
  text: string,
  allowedFindingIds: readonly string[],
  nonFindingIds: readonly string[] = [],
): string[] {
  if (text.length === 0) return []

  const allowedFindings = createIdSet(allowedFindingIds)
  const allowedIncidentalIds = createIdSet(nonFindingIds)
  const candidates: Array<{ id: string; index: number; explicitlyLabeled: boolean }> = []

  // A dot can be part of an ID. Keep it during extraction, then treat trailing
  // unquoted periods as sentence punctuation; a closed quote preserves the exact
  // quoted token, including a terminal period if one is intentional.
  const labeledValuePattern = /\bfindingId\s*[=:]\s*([`"']?)([A-Za-z0-9_.-]+)\1?/gi
  for (const match of text.matchAll(labeledValuePattern)) {
    const quote = match[1]
    const rawId = match[2]
    if (rawId === undefined) continue

    const hasClosingQuote = quote !== undefined && quote.length > 0 && match[0].endsWith(quote)
    const id = hasClosingQuote ? rawId : rawId.replace(/\.+$/, "")
    if (id.length > 0) {
      candidates.push({ id, index: match.index ?? 0, explicitlyLabeled: true })
    }
  }

  const backtickedTokenPattern = /`([^`\r\n]+)`/g
  for (const match of text.matchAll(backtickedTokenPattern)) {
    const id = match[1]
    if (id !== undefined && isBacktickedIdToken(id)) {
      candidates.push({ id, index: match.index ?? 0, explicitlyLabeled: false })
    }
  }

  const sha256TokenPattern = /[a-f0-9]{64}/gi
  for (const match of text.matchAll(sha256TokenPattern)) {
    const id = match[0]
    const start = match.index ?? 0
    const end = start + id.length
    if (
      !isIdentifierContinuation(text[start - 1]) &&
      !isIdentifierContinuation(text[end])
    ) {
      candidates.push({ id, index: start, explicitlyLabeled: false })
    }
  }

  candidates.sort(
    (left, right) =>
      left.index - right.index ||
      Number(right.explicitlyLabeled) - Number(left.explicitlyLabeled),
  )

  const suspiciousIds: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = comparisonKey(candidate.id)
    const isAllowed = candidate.explicitlyLabeled
      ? allowedFindings.has(key)
      : allowedFindings.has(key) || allowedIncidentalIds.has(key)

    if (isAllowed || seen.has(key)) continue
    seen.add(key)
    suspiciousIds.push(candidate.id)
  }

  return suspiciousIds
}
