export interface LatexIncludeDirective {
  kind: "input" | "include"
  target: string
  sourceFile: string
  line: number
  order: number
  /** Zero-based index of the first character of the directive in the full content. */
  startOffset: number
  /** Zero-based exclusive end index of the directive in the full content. */
  endOffset: number
}

/**
 * Removes LaTeX comments from a line.
 * A comment starts with an unescaped % and goes to the end of the line.
 * A % is escaped if it is preceded by an odd number of backslashes.
 */
function stripComments(line: string): string {
  let backslashCount = 0
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === "\\") {
      backslashCount++
    } else if (char === "%") {
      if (backslashCount % 2 === 0) {
        return line.substring(0, i)
      }
      backslashCount = 0
    } else {
      backslashCount = 0
    }
  }
  return line
}

/**
 * Split content into lines while preserving each line's absolute start offset
 * in the original string (so \r\n and \n both map correctly).
 */
function linesWithOffsets(content: string): Array<{ text: string; start: number; lineNumber: number }> {
  const result: Array<{ text: string; start: number; lineNumber: number }> = []
  let start = 0
  let lineNumber = 1
  const newlineRe = /\r?\n/g
  let match: RegExpExecArray | null
  while ((match = newlineRe.exec(content)) !== null) {
    result.push({ text: content.slice(start, match.index), start, lineNumber })
    start = match.index + match[0].length
    lineNumber++
  }
  result.push({ text: content.slice(start), start, lineNumber })
  return result
}

/**
 * Parses LaTeX source content for \input{...} and \include{...} directives.
 *
 * @param sourceFile The path or name of the source file being parsed.
 * @param content The string content of the LaTeX file.
 * @returns An array of detected include directives in order of appearance.
 */
export function parseLatexIncludes(sourceFile: string, content: string): LatexIncludeDirective[] {
  const directives: LatexIncludeDirective[] = []
  const lines = linesWithOffsets(content)
  let globalOrder = 0

  // Regex to find \input{target} or \include{target}
  // Groups: 1: backslashes, 2: command, 3: target
  // We use \s* to allow spaces between command and brace.
  const directiveRegex = /(\\+)(input|include)\s*\{([^}]+)\}/g

  for (const { text: line, start: lineStart, lineNumber } of lines) {
    const cleanLine = stripComments(line)

    let match: RegExpExecArray | null
    directiveRegex.lastIndex = 0

    while ((match = directiveRegex.exec(cleanLine)) !== null) {
      const backslashes = match[1]
      // Only recognize the command if it's preceded by an odd number of backslashes.
      // e.g., \input is a command, \\input is an escaped backslash followed by text "input".
      if (backslashes.length % 2 === 0) continue

      const kind = match[2] as "input" | "include"
      const target = match[3].trim()

      // The last backslash is the command introducer; any preceding even pair is text.
      const commandStartInLine = match.index + backslashes.length - 1
      const commandEndInLine = match.index + match[0].length

      directives.push({
        kind,
        target,
        sourceFile,
        line: lineNumber,
        order: ++globalOrder,
        startOffset: lineStart + commandStartInLine,
        endOffset: lineStart + commandEndInLine,
      })
    }
  }

  return directives
}
