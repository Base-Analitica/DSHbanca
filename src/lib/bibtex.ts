import type { RefMetadata } from "./academic"

export interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
}

/**
 * Category of an identifiable {@link BibtexParseError}.
 *
 * - `malformed`: the input violates the supported BibTeX syntax (for example an
 *   unbalanced brace, an unterminated quote, a mismatched entry delimiter or a
 *   missing `=` in a field).
 * - `unsupported`: the construct is valid BibTeX that this deterministic parser
 *   deliberately does not implement (macros, `@string` definitions and `#`
 *   concatenation). Failing explicitly is preferable to silently producing
 *   truncated or invented metadata.
 */
export type BibtexErrorKind = "malformed" | "unsupported"

/**
 * Identifiable failure raised by {@link parseBibtex}.
 *
 * Parsing is all-or-nothing: a malformed or unsupported construct anywhere in
 * the file fails the whole parse instead of returning a partial entry list that
 * could be mistaken for a complete, validated bibliography.
 */
export class BibtexParseError extends Error {
  readonly kind: BibtexErrorKind
  /** 1-based line of the offending construct. */
  readonly line: number
  /** 1-based column of the offending construct. */
  readonly column: number
  /** 0-based character offset of the offending construct. */
  readonly offset: number

  constructor(kind: BibtexErrorKind, detail: string, content: string, offset: number) {
    const { line, column } = positionAt(content, offset)
    super(`${detail} (BibTeX ${kind}, line ${line}, column ${column})`)
    this.name = "BibtexParseError"
    this.kind = kind
    this.line = line
    this.column = column
    this.offset = offset
  }
}

function positionAt(content: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, content.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (content.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: clamped - lineStart + 1 }
}

const WHITESPACE = /[\s\uFEFF]/

function isWhitespace(ch: string): boolean {
  return WHITESPACE.test(ch)
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9"
}

function isIdentifierStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")
}

function isIdentifierPart(ch: string): boolean {
  return isIdentifierStart(ch) || isDigit(ch) || ch === "_" || ch === "-"
}

class Scanner {
  private index = 0

  constructor(private readonly content: string) {}

  get offset(): number {
    return this.index
  }

  eof(): boolean {
    return this.index >= this.content.length
  }

  peek(): string | undefined {
    return this.content[this.index]
  }

  advance(): string {
    const ch = this.content[this.index]
    this.index++
    return ch
  }

  skipWhitespace(): void {
    while (!this.eof() && isWhitespace(this.content[this.index])) this.index++
  }

  fail(kind: BibtexErrorKind, detail: string, offset = this.index): never {
    throw new BibtexParseError(kind, detail, this.content, offset)
  }
}

/**
 * Read a BibTeX identifier (entry type or field name). Identifiers start with an
 * ASCII letter and continue with letters, digits, `_` or `-`.
 */
function readIdentifier(scanner: Scanner): string {
  const first = scanner.peek()
  if (first === undefined || !isIdentifierStart(first)) return ""

  let out = scanner.advance()
  while (!scanner.eof()) {
    const ch = scanner.peek()!
    if (!isIdentifierPart(ch)) break
    out += scanner.advance()
  }
  return out
}

/**
 * Parse BibTeX content into ordered entries.
 *
 * Supported grammar (deliberately smaller than the full BibTeX language):
 * - entries `@type{...}` and `@type(...)` with coherent closing delimiters;
 * - a non-empty citation key followed by `,` and zero or more `name = value`
 *   fields separated by `,` (a trailing comma before the closing delimiter is
 *   accepted);
 * - field values as balanced `{...}` groups (nested braces and LaTeX commands
 *   are preserved verbatim, including escaped delimiters such as `\{`/`\}`),
 *   balanced `"..."` strings (embedded braces stay balanced; `\"` does not
 *   terminate the string), and bare non-negative integer literals;
 * - `@comment` and `@preamble` are recognized and deliberately skipped instead
 *   of being returned as bibliography entries;
 * - text outside entries is ignored, except that a top-level `@` must start a
 *   well-formed item.
 *
 * Not supported (rejected with `kind: "unsupported"` instead of guessing):
 * `@string` macro definitions, bare macro references as values, and `#`
 * concatenation. LaTeX content is never interpreted or rewritten.
 *
 * @throws {BibtexParseError} when the input is malformed or uses an unsupported
 * construct; never returns a silently truncated or partial entry list.
 */
export function parseBibtex(content: string): BibEntry[] {
  const scanner = new Scanner(content)
  const entries: BibEntry[] = []

  while (true) {
    scanner.skipWhitespace()
    if (scanner.eof()) break

    if (scanner.peek() !== "@") {
      // Text outside entries is ignored (BibTeX behavior).
      scanner.advance()
      continue
    }

    const atOffset = scanner.offset
    scanner.advance()
    scanner.skipWhitespace()

    const rawType = readIdentifier(scanner)
    if (rawType.length === 0) {
      scanner.fail("malformed", "expected an entry type after '@'", atOffset)
    }
    const type = rawType.toLowerCase()

    scanner.skipWhitespace()
    const delimiter = scanner.peek()
    let open: "{" | "("
    let close: "}" | ")"
    if (delimiter === "{") {
      open = "{"
      close = "}"
    } else if (delimiter === "(") {
      open = "("
      close = ")"
    } else {
      scanner.fail("malformed", `expected '{' or '(' after '@${rawType}'`, atOffset)
      return entries
    }
    scanner.advance()

    if (type === "comment" || type === "preamble") {
      skipBalancedDirective(scanner, type, open, close, atOffset)
      continue
    }
    if (type === "string") {
      scanner.fail("unsupported", "@string macro definitions are not supported", atOffset)
    }

    entries.push(parseEntry(scanner, type, open, close, atOffset))
  }

  return entries
}

/**
 * Skip the body of a recognized non-reference directive (`@comment`,
 * `@preamble`).
 *
 * The scan follows the protected contexts of the supported grammar so that the
 * directive's external delimiter is only honored when it is structural:
 * escapes consume the next character; braced literals and quoted literals may
 * contain the external delimiter, and quotes inside braces are literal content.
 * This prevents references written inside a directive body from leaking into
 * the entry list.
 *
 * `@preamble` follows the same brace-balanced fail-closed contract as field
 * values: a closing brace without a matching opening brace (inside a quoted
 * literal or at the top level of a parenthesized body) is malformed. `@comment`
 * stays deliberately opaque, so its discarded text is not syntax-checked.
 */
function skipBalancedDirective(
  scanner: Scanner,
  type: string,
  open: string,
  close: string,
  directiveOffset: number,
): void {
  const preamble = type === "preamble"
  let externalDepth = 1
  let braceDepth = 0
  let inQuote = false

  while (!scanner.eof()) {
    const ch = scanner.advance()
    const chOffset = scanner.offset - 1

    // Escapes are preserved by the supported grammar; the escaped character is
    // literal and never changes a structural depth.
    if (ch === "\\") {
      if (!scanner.eof()) scanner.advance()
      continue
    }

    if (inQuote) {
      if (ch === "{") {
        braceDepth++
      } else if (ch === "}") {
        if (braceDepth > 0) braceDepth--
        else if (preamble) {
          scanner.fail("malformed", "unexpected '}' in @preamble directive without a matching '{'", chOffset)
        }
        // For @comment an unmatched closing brace inside the quoted text is
        // discarded literal content.
      } else if (ch === '"' && braceDepth === 0) {
        inQuote = false
      }
      continue
    }

    if (braceDepth > 0) {
      // Inside a braced literal only braces are structural.
      if (ch === "{") braceDepth++
      else if (ch === "}") braceDepth--
      continue
    }

    if (ch === '"') {
      inQuote = true
      braceDepth = 0
      continue
    }
    if (ch === "{") {
      braceDepth = 1
      continue
    }
    if (open === "(") {
      if (ch === "(") {
        externalDepth++
      } else if (ch === ")") {
        externalDepth--
        if (externalDepth === 0) return
      } else if (ch === "}" && preamble) {
        scanner.fail("malformed", "unexpected '}' in @preamble directive without a matching '{'", chOffset)
      }
      continue
    }
    // Brace-delimited directive: only a top-level closing brace ends the body.
    if (ch === close) {
      externalDepth--
      if (externalDepth === 0) return
    }
  }

  scanner.fail("malformed", `unterminated @${type} directive`, directiveOffset)
}

function parseEntry(
  scanner: Scanner,
  type: string,
  open: string,
  close: string,
  entryOffset: number,
): BibEntry {
  // Citation key: read up to the first comma outside of any structured value.
  const keyOffset = scanner.offset
  let key = ""
  while (true) {
    if (scanner.eof()) {
      scanner.fail(
        "malformed",
        `unterminated @${type} entry: expected ',' after the citation key and a closing '${close}'`,
        entryOffset,
      )
    }
    const ch = scanner.peek()!
    if (ch === ",") {
      scanner.advance()
      break
    }
    if (ch === open || ch === close) {
      scanner.fail("malformed", `expected ',' after the citation key in @${type} entry`)
    }
    if (ch === "@") {
      scanner.fail("malformed", "unexpected '@' inside an entry")
    }
    key += scanner.advance()
  }

  key = key.trim()
  if (key.length === 0) {
    scanner.fail("malformed", `empty citation key in @${type} entry`)
  }

  // Minimal lexical validation, independent of the entry's outer delimiter: a
  // citation key cannot contain structural delimiters, quote characters or
  // internal whitespace. Surrounding whitespace was already trimmed.
  const invalidKeyChar = key.match(/[{}()"]/)?.[0]
  if (invalidKeyChar !== undefined) {
    scanner.fail("malformed", `invalid character '${invalidKeyChar}' in citation key of @${type} entry`, keyOffset)
  }
  if (/\s/.test(key)) {
    scanner.fail("malformed", `citation key must not contain internal whitespace in @${type} entry`, keyOffset)
  }

  const fields: Record<string, string> = {}

  while (true) {
    scanner.skipWhitespace()
    if (scanner.eof()) {
      scanner.fail("malformed", `unterminated @${type} entry: expected closing '${close}'`, entryOffset)
    }

    const ch = scanner.peek()!
    if (ch === close) {
      scanner.advance()
      return { type, key, fields }
    }
    if (ch === "@") {
      scanner.fail("malformed", "unexpected '@' inside an entry")
    }

    const nameOffset = scanner.offset
    const rawName = readIdentifier(scanner)
    if (rawName.length === 0) {
      scanner.fail("malformed", `expected a field name or closing '${close}' in @${type} entry`, nameOffset)
    }
    const fieldName = rawName.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
      // Duplicate fields make the metadata ambiguous; fail closed instead of
      // silently keeping one of the values.
      scanner.fail("malformed", `duplicate field '${fieldName}' in @${type} entry`, nameOffset)
    }

    scanner.skipWhitespace()
    if (scanner.peek() !== "=") {
      scanner.fail("malformed", `expected '=' after field '${fieldName}'`)
    }
    scanner.advance()
    scanner.skipWhitespace()

    fields[fieldName] = parseFieldValue(scanner, fieldName, type)

    scanner.skipWhitespace()
    if (scanner.eof()) {
      scanner.fail("malformed", `unterminated @${type} entry: expected ',' or '${close}'`, entryOffset)
    }
    const after = scanner.peek()!
    if (after === ",") {
      scanner.advance()
      continue
    }
    if (after === close) {
      scanner.advance()
      return { type, key, fields }
    }
    if (after === "#") {
      scanner.fail("unsupported", `BibTeX string concatenation with '#' is not supported (field '${fieldName}')`)
    }
    scanner.fail("malformed", `expected ',' or '${close}' after field '${fieldName}'`)
  }
}

function parseFieldValue(scanner: Scanner, fieldName: string, entryType: string): string {
  if (scanner.eof()) {
    scanner.fail("malformed", `missing value for field '${fieldName}' in @${entryType} entry`)
  }
  const ch = scanner.peek()!

  if (ch === "{") return parseBracedValue(scanner, fieldName)
  if (ch === '"') return parseQuotedValue(scanner, fieldName)
  if (isDigit(ch)) return parseBareNumber(scanner, fieldName)
  if (ch === "#") {
    scanner.fail("unsupported", `BibTeX string concatenation with '#' is not supported (field '${fieldName}')`)
  }
  if (isIdentifierStart(ch)) {
    const macro = readIdentifier(scanner)
    scanner.fail(
      "unsupported",
      `BibTeX macro value '${macro}' is not supported (field '${fieldName}'); use a braced or quoted literal`,
    )
  }
  scanner.fail("malformed", `unexpected character '${ch}' in value for field '${fieldName}'`)
}

function parseBareNumber(scanner: Scanner, fieldName: string): string {
  const offset = scanner.offset
  let digits = ""
  while (!scanner.eof() && isDigit(scanner.peek()!)) digits += scanner.advance()

  const next = scanner.peek()
  if (next !== undefined && (isIdentifierPart(next) || next === ".")) {
    scanner.fail(
      "malformed",
      `invalid bare value '${digits}${next}' for field '${fieldName}'; only integer literals are supported without delimiters`,
      offset,
    )
  }
  return digits
}

function parseBracedValue(scanner: Scanner, fieldName: string): string {
  const openOffset = scanner.offset
  scanner.advance() // consume '{'

  let depth = 1
  let out = ""
  while (!scanner.eof()) {
    const ch = scanner.peek()!
    // Escapes are preserved verbatim; escaped delimiters do not change nesting.
    if (ch === "\\") {
      out += scanner.advance()
      if (!scanner.eof()) out += scanner.advance()
      continue
    }
    if (ch === "{") {
      depth++
      out += scanner.advance()
      continue
    }
    if (ch === "}") {
      depth--
      if (depth === 0) {
        scanner.advance()
        return out.trim()
      }
      out += scanner.advance()
      continue
    }
    out += scanner.advance()
  }

  scanner.fail("malformed", `unbalanced '{' in value for field '${fieldName}'`, openOffset)
}

function parseQuotedValue(scanner: Scanner, fieldName: string): string {
  const openOffset = scanner.offset
  scanner.advance() // consume opening '"'

  let depth = 0
  let out = ""
  while (!scanner.eof()) {
    const ch = scanner.peek()!
    // Escapes are preserved verbatim; `\"` does not terminate the string.
    if (ch === "\\") {
      out += scanner.advance()
      if (!scanner.eof()) out += scanner.advance()
      continue
    }
    if (ch === "{") {
      depth++
      out += scanner.advance()
      continue
    }
    if (ch === "}") {
      if (depth === 0) {
        scanner.fail("malformed", `unexpected '}' in quoted value for field '${fieldName}'`)
      }
      depth--
      out += scanner.advance()
      continue
    }
    if (ch === '"' && depth === 0) {
      scanner.advance()
      return out.trim()
    }
    out += scanner.advance()
  }

  scanner.fail("malformed", `unterminated quoted value for field '${fieldName}'`, openOffset)
}

export function bibEntryToRef(entry: BibEntry): RefMetadata {
  const f = entry.fields

  // extract year from date field if present
  let year: number | undefined
  const dateStr = f.date || ""
  const yearMatch = dateStr.match(/\b(\d{4})\b/) || f.year?.match(/\b(\d{4})\b/)
  if (yearMatch) year = parseInt(yearMatch[1])

  // extract authors
  const authorStr = f.author || f.authors || ""
  const authors = authorStr.split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean)

  // normalize DOI
  let doi = f.doi || ""
  if (doi.startsWith("https://doi.org/")) doi = doi.replace("https://doi.org/", "")
  if (doi.startsWith("http://doi.org/")) doi = doi.replace("http://doi.org/", "")

  return {
    key: entry.key,
    title: f.title || f.titulo || "",
    authors: authors.length > 0 ? authors : undefined,
    year,
    doi: doi || undefined,
    journal: f.journal || f.journaltitle || f.booktitle || "",
    volume: f.volume || "",
    pages: f.pages || "",
  }
}
