const TOKEN_START = String.raw`(?<![\p{L}\p{N}_.-])`
const TOKEN_END = String.raw`(?![\p{L}\p{N}_-])(?![.,][\p{L}\p{N}_])`
const HSPACE = String.raw`[\t \u00a0]`
const LINE_LABEL = String.raw`(?:linha|linhas)(?:${HSPACE}+|${HSPACE}*:${HSPACE}*)`
const SINGLE_RANGE_CONTINUATION =
  String.raw`(?!${HSPACE}*[-–—]${HSPACE}*\d)(?!${HSPACE}+a${HSPACE}*\d)`

function isValidLineNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function hasSingleLineCitation(text: string, line: string): boolean {
  const portugueseLine = new RegExp(
    `${TOKEN_START}${LINE_LABEL}${line}${TOKEN_END}${SINGLE_RANGE_CONTINUATION}`,
    "iu",
  )
  const abbreviatedLine = new RegExp(
    `${TOKEN_START}L${HSPACE}*${line}${TOKEN_END}${SINGLE_RANGE_CONTINUATION}`,
    "iu",
  )
  return portugueseLine.test(text) || abbreviatedLine.test(text)
}

function hasLineRangeCitation(
  text: string,
  startLine: string,
  endLine: string,
): boolean {
  const rangeSeparator = String.raw`(?:${HSPACE}*[-–—]${HSPACE}*|${HSPACE}+a${HSPACE}+)`
  const range = new RegExp(
    `${TOKEN_START}${LINE_LABEL}${startLine}${rangeSeparator}${endLine}${TOKEN_END}`,
    "iu",
  )
  return range.test(text)
}

/**
 * Detects only explicit lexical references to the exact validated line or range
 * in a caller-supplied prose window. It does not open source files or validate
 * that the cited lines exist or support a claim.
 *
 * Lexical false positive: unrelated prose can mention the same exact line.
 * Lexical false negative: alternate forms such as English "line 42" are not
 * recognized, even if they refer to the correct source line.
 */
export function isSynthesisLineRangeCited(
  windowText: string,
  startLine: number,
  endLine: number,
): boolean {
  if (
    typeof windowText !== "string" ||
    !isValidLineNumber(startLine) ||
    !isValidLineNumber(endLine) ||
    endLine < startLine
  ) {
    return false
  }

  const start = String(startLine)
  const end = String(endLine)

  return startLine === endLine
    ? hasSingleLineCitation(windowText, start)
    : hasLineRangeCitation(windowText, start, end)
}
