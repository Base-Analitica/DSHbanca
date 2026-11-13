/**
 * Canonical citation-density analysis over manuscript text.
 *
 * Single source of truth for the citation-based heuristic score used by
 * banca_loop and banca_corrigir (previously duplicated with divergent
 * formulas in each tool). This is a heuristic signal for citations only,
 * not a 4-eixos audit score, not academic proof.
 *
 * The recognizer is lexical and deterministic: it scans LaTeX text for an
 * explicit allowlist of citation commands, skipping unescaped `%` comments and
 * honoring backslash escapes, optional `[...]` notes and brace-balanced
 * mandatory `{...}` arguments. It does not expand macros, interpret packages,
 * parse verbatim/literal environments or validate bibliographic keys. See
 * docs/citation-recognition.md for the supported grammar and its limits.
 */

export interface CitationAnalysis {
  totalParagraphs: number
  citedParagraphs: number
  paragraphsWithoutCitation: number
  /** Percent of meaningful paragraphs without a citation, 0-100, unrounded. */
  percentWithoutCitation: number
  /** Heuristic citation score on the 0-10 rubric scale. */
  score: number
}

const PARAGRAPH_SPLIT_RE = /\n\s*\n/

/**
 * Citation commands explicitly recognized by the scanner. The allowlist is
 * exact: a command is a citation only when its full control-word name matches
 * an entry, so `\citetext`, `\citeauthorx` or `\nocite` are never inferred
 * from a `cite` prefix.
 *
 * Signatures are the union accepted by abntex2cite 1.9.7 and BibLaTeX 3.22a:
 * optional `[...]` notes come before the mandatory reference keys, and
 * `\apud`/`\apudonline` take two mandatory arguments (original and consulted
 * work). The optional maximum of each command follows the documented package
 * signature; see docs/citation-recognition.md.
 */
interface CitationSignature {
  /** Maximum number of optional `[...]` arguments accepted. */
  readonly maxOptionalArgs: number
  /** Exact number of mandatory `{...}` arguments required. */
  readonly requiredArgs: number
}

const CITATION_COMMANDS: ReadonlyMap<string, CitationSignature> = new Map([
  ["cite", { maxOptionalArgs: 2, requiredArgs: 1 }],
  ["citeonline", { maxOptionalArgs: 1, requiredArgs: 1 }],
  ["citeauthor", { maxOptionalArgs: 2, requiredArgs: 1 }],
  ["parencite", { maxOptionalArgs: 2, requiredArgs: 1 }],
  ["textcite", { maxOptionalArgs: 2, requiredArgs: 1 }],
  ["apud", { maxOptionalArgs: 1, requiredArgs: 2 }],
  // Real abntex2cite macro documented as `[optional]{original}{consulted}`.
  // It extends the issue's minimum allowlist and is covered by dedicated
  // tests; it is not an open-ended `cite*` grammar.
  ["apudonline", { maxOptionalArgs: 1, requiredArgs: 2 }],
])

/**
 * Defensive work budget, in scanned characters, for one paragraph:
 * `factor * length + base`. Well-formed input stays far below it, while
 * pathological input (for example many unterminated optionals) cannot turn the
 * scan quadratic. Exhausting the budget makes the paragraph count as not cited
 * — never as a citation.
 */
const SCAN_WORK_LIMIT_FACTOR = 8
const SCAN_WORK_LIMIT_BASE = 1024

interface ScanBudget {
  remaining: number
}

function isWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f" ||
    char === "\v"
  )
}

function isAsciiLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z")
}

/**
 * Skip an unescaped `%` comment up to the end of its line. `start` must point
 * at the percent sign; the returned index is the line break (or end of text),
 * where normal scanning resumes.
 */
function skipComment(text: string, start: number, budget: ScanBudget): number {
  let index = start + 1
  while (index < text.length && text[index] !== "\n") index += 1
  budget.remaining -= index - start
  return index
}

/**
 * Skip spaces, line breaks and unescaped `%` comments between a command name
 * and its arguments. A single line break is still the same paragraph.
 */
function skipTrivia(text: string, start: number, budget: ScanBudget): number {
  let index = start
  while (index < text.length) {
    if (isWhitespace(text[index])) {
      index += 1
      budget.remaining -= 1
      continue
    }
    if (text[index] === "%") {
      index = skipComment(text, index, budget)
      continue
    }
    break
  }
  return index
}

/**
 * Read a brace-balanced mandatory `{...}` argument starting at `start`.
 * Escaped braces (`\{`, `\}`) never change the balance, and characters inside
 * an unescaped `%` comment are ignored. Returns the index right after the
 * closing brace, or -1 when the argument is not balanced.
 */
function readRequiredArgument(text: string, start: number, budget: ScanBudget): number {
  let depth = 0
  let index = start
  while (index < text.length) {
    if (budget.remaining <= 0) return -1
    const char = text[index]
    if (char === "\\") {
      index += 2
      budget.remaining -= 2
      continue
    }
    if (char === "%") {
      index = skipComment(text, index, budget)
      continue
    }
    if (char === "{") {
      depth += 1
      index += 1
      budget.remaining -= 1
      continue
    }
    if (char === "}") {
      depth -= 1
      index += 1
      budget.remaining -= 1
      if (depth === 0) return index
      if (depth < 0) return -1
      continue
    }
    index += 1
    budget.remaining -= 1
  }
  return -1
}

/**
 * Read a balanced optional `[...]` argument starting at `start`. Braces inside
 * the note are tracked so a `]` protected by `{}` does not close it early, and
 * escaped brackets never close it either. The note ends at the first
 * unprotected `]`, matching the delimited-argument reading of LaTeX.
 *
 * Brace balance is checked as a prefix property: an unescaped `}` without a
 * corresponding `{` rejects the argument immediately, so a later opening brace
 * can never compensate a negative depth. Comments and escapes never change the
 * depth. Returns the index right after the closing bracket, or -1 when the
 * argument is incomplete or malformed.
 */
function readOptionalArgument(text: string, start: number, budget: ScanBudget): number {
  let braceDepth = 0
  let index = start + 1
  while (index < text.length) {
    if (budget.remaining <= 0) return -1
    const char = text[index]
    if (char === "\\") {
      index += 2
      budget.remaining -= 2
      continue
    }
    if (char === "%") {
      index = skipComment(text, index, budget)
      continue
    }
    if (char === "{") {
      braceDepth += 1
      index += 1
      budget.remaining -= 1
      continue
    }
    if (char === "}") {
      // Prefix balance: a closing brace without a matching opening brace makes
      // the whole optional argument invalid; a later `{` must not compensate it.
      if (braceDepth === 0) return -1
      braceDepth -= 1
      index += 1
      budget.remaining -= 1
      continue
    }
    if (char === "]" && braceDepth === 0) return index + 1
    index += 1
    budget.remaining -= 1
  }
  return -1
}

/**
 * True when a mandatory argument carries at least one reference key.
 *
 * Content is "structurally empty" — and therefore not a citation — when it
 * only has comments, whitespace, the `,` key separator and the `{`/`}`
 * delimiters of nested groups: `\cite{{}}` and `\cite{{,}}` have no key even
 * though their braces are balanced. An escape (`\{`, `\%`, `\c{c}`...) is
 * literal argument material and counts as content. Nested groups with real
 * content (`\cite{autor{2020}}`, `\cite{autor{\c{c}}ao2020}`) stay valid. No
 * bibliographic key validation is performed.
 */
function hasReferenceKey(text: string, from: number, to: number): boolean {
  let index = from
  while (index < to) {
    const char = text[index]
    if (char === "\\") {
      // Escaped content is literal argument material (for example `\{`).
      return true
    }
    if (char === "%") {
      while (index < to && text[index] !== "\n") index += 1
      continue
    }
    // Structural delimiters of nested groups do not demonstrate key content by
    // themselves; only a non-structural character does.
    if (char === "{" || char === "}") {
      index += 1
      continue
    }
    if (!isWhitespace(char) && char !== ",") return true
    index += 1
  }
  return false
}

/**
 * Parse the argument list of a recognized citation command, starting right
 * after its control word. Returns the index after the last accepted argument,
 * or -1 when the declared signature is not satisfied: missing, empty,
 * truncated or unbalanced mandatory arguments, incomplete optional notes, or
 * more optional notes than the command documents. Optional notes after the
 * mandatory keys are not part of the signature.
 */
function readCitationArguments(
  text: string,
  start: number,
  signature: CitationSignature,
  budget: ScanBudget,
): number {
  let index = skipTrivia(text, start, budget)

  let optionalArgs = 0
  while (
    optionalArgs < signature.maxOptionalArgs &&
    index < text.length &&
    text[index] === "["
  ) {
    const optionalEnd = readOptionalArgument(text, index, budget)
    if (optionalEnd < 0) return -1
    index = skipTrivia(text, optionalEnd, budget)
    optionalArgs += 1
  }

  for (let requiredArg = 0; requiredArg < signature.requiredArgs; requiredArg += 1) {
    if (index >= text.length || text[index] !== "{") return -1
    const requiredEnd = readRequiredArgument(text, index, budget)
    if (requiredEnd < 0) return -1
    if (!hasReferenceKey(text, index + 1, requiredEnd - 1)) return -1
    index = skipTrivia(text, requiredEnd, budget)
  }

  return index
}

/**
 * True when one paragraph contains at least one successfully parsed supported
 * citation command outside comments. The scan is lexical and single-pass over
 * the paragraph; it never joins text across paragraph boundaries because
 * callers pass one paragraph at a time.
 */
function paragraphHasCitation(paragraph: string): boolean {
  const budget: ScanBudget = {
    remaining: paragraph.length * SCAN_WORK_LIMIT_FACTOR + SCAN_WORK_LIMIT_BASE,
  }

  let index = 0
  while (index < paragraph.length) {
    if (budget.remaining <= 0) return false

    const char = paragraph[index]
    if (char === "%") {
      index = skipComment(paragraph, index, budget)
      continue
    }
    if (char !== "\\") {
      index += 1
      budget.remaining -= 1
      continue
    }

    // A backslash starts either a control word (`\cite`, letters only) or a
    // control symbol (`\%`, `\\`, `\{`). Only exact control words from the
    // allowlist can be citations; an escaped or nonexistent command cannot.
    let wordEnd = index + 1
    if (wordEnd < paragraph.length && isAsciiLetter(paragraph[wordEnd])) {
      while (wordEnd < paragraph.length && isAsciiLetter(paragraph[wordEnd])) {
        wordEnd += 1
      }
      const signature = CITATION_COMMANDS.get(paragraph.slice(index + 1, wordEnd))
      budget.remaining -= wordEnd - index
      index = wordEnd
      if (
        signature !== undefined &&
        readCitationArguments(paragraph, index, signature, budget) >= 0
      ) {
        return true
      }
      continue
    }

    // Control symbol: the backslash consumes exactly one following character,
    // which is why `\%` is a literal percent sign and `\\` is a line break.
    index += 2
    budget.remaining -= 2
  }

  return false
}

/**
 * Map percent of paragraphs without citations to the heuristic score.
 * > 30% → 4.0; > 20% → 6.0; otherwise 8.0.
 */
export function citationScore(percentWithoutCitation: number): number {
  if (percentWithoutCitation > 30) return 4.0
  if (percentWithoutCitation > 20) return 6.0
  return 8.0
}

/**
 * Analyze citation density of manuscript text. Meaningful paragraphs are
 * non-empty blocks with more than 20 trimmed characters, matching the
 * historical heuristic used by loop/correction flows.
 */
export function analyzeCitationDensity(content: string): CitationAnalysis {
  const paragraphs = content
    .split(PARAGRAPH_SPLIT_RE)
    .filter((p: string) => p.trim().length > 20)

  let citedParagraphs = 0
  for (const paragraph of paragraphs) {
    if (paragraphHasCitation(paragraph)) citedParagraphs++
  }

  const paragraphsWithoutCitation = paragraphs.length - citedParagraphs
  const percentWithoutCitation =
    paragraphs.length > 0
      ? (paragraphsWithoutCitation / paragraphs.length) * 100
      : 0

  return {
    totalParagraphs: paragraphs.length,
    citedParagraphs,
    paragraphsWithoutCitation,
    percentWithoutCitation,
    score: citationScore(percentWithoutCitation),
  }
}
