export interface LatexIncludeDirective {
  kind: "input" | "include"
  target: string
  sourceFile: string
  line: number
  order: number
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
 * Parses LaTeX source content for \input{...} and \include{...} directives.
 *
 * @param sourceFile The path or name of the source file being parsed.
 * @param content The string content of the LaTeX file.
 * @returns An array of detected include directives in order of appearance.
 */
export function parseLatexIncludes(sourceFile: string, content: string): LatexIncludeDirective[] {
  const directives: LatexIncludeDirective[] = []
  const lines = content.split(/\r?\n/)
  let globalOrder = 0

  // Regex to find \input{target} or \include{target}
  // Groups: 1: backslashes, 2: command, 3: target
  // We use \s* to allow spaces between command and brace.
  const directiveRegex = /(\\+)(input|include)\s*\{([^}]+)\}/g

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1
    const cleanLine = stripComments(lines[i])

    let match: RegExpExecArray | null
    directiveRegex.lastIndex = 0

    while ((match = directiveRegex.exec(cleanLine)) !== null) {
      const backslashes = match[1]
      // Only recognize the command if it's preceded by an odd number of backslashes.
      // e.g., \input is a command, \\input is an escaped backslash followed by text "input".
      if (backslashes.length % 2 === 0) continue

      const kind = match[2] as "input" | "include"
      const target = match[3].trim()

      directives.push({
        kind,
        target,
        sourceFile,
        line: lineNumber,
        order: ++globalOrder,
      })
    }
  }

  return directives
}
