import { describe, test, expect } from "bun:test"
import { parseLatexIncludes } from "../src/lib/latex_parser"

describe("parseLatexIncludes", () => {
  const fileName = "main.tex"

  test("returns empty list for content without includes", () => {
    const content = `\\documentclass{article}
\\begin{document}
Hello World!
\\end{document}`
    expect(parseLatexIncludes(fileName, content)).toEqual([])
  })

  test("parses single \\input and single \\include", () => {
    const content = `\\input{chapter1}
\\include{chapter2}`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(2)

    expect(results[0]).toEqual({
      kind: "input",
      target: "chapter1",
      sourceFile: fileName,
      line: 1,
      order: 1
    })

    expect(results[1]).toEqual({
      kind: "include",
      target: "chapter2",
      sourceFile: fileName,
      line: 2,
      order: 2
    })
  })

  test("preserves order with multiple directives", () => {
    const content = `\\input{a}
\\input{b}
\\include{c}
\\input{d}`
    const results = parseLatexIncludes(fileName, content)
    expect(results.map(r => r.target)).toEqual(["a", "b", "c", "d"])
    expect(results.map(r => r.order)).toEqual([1, 2, 3, 4])
  })

  test("handles directives on the same line", () => {
    const content = `\\input{a} \\include{b}`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(2)
    expect(results[0].line).toBe(1)
    expect(results[1].line).toBe(1)
    expect(results[0].target).toBe("a")
    expect(results[1].target).toBe("b")
    expect(results[0].order).toBe(1)
    expect(results[1].order).toBe(2)
  })

  test("handles targets with and without .tex extension", () => {
    const content = `\\input{intro.tex}
\\include{conclusion}`
    const results = parseLatexIncludes(fileName, content)
    expect(results[0].target).toBe("intro.tex")
    expect(results[1].target).toBe("conclusion")
  })

  test("ignores commented out directives", () => {
    const content = `% \\input{ignored1}
\\input{active} % \\include{ignored2}`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(1)
    expect(results[0].target).toBe("active")
    expect(results[0].line).toBe(2)
  })

  test("handles escaped percent signs before a directive", () => {
    const content = `\\% \\input{active1}
\\\\% \\input{ignored}
\\\\\\% \\input{active2}`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(2)
    expect(results[0].target).toBe("active1")
    expect(results[1].target).toBe("active2")
  })

  test("trims spaces around the target", () => {
    const content = `\\input{  spaced_target  }`
    const results = parseLatexIncludes(fileName, content)
    expect(results[0].target).toBe("spaced_target")
  })

  test("handles whitespace between command and braces", () => {
    const content = `\\input  {spaced_command}
\\include\t{tab_command}`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(2)
    expect(results[0].target).toBe("spaced_command")
    expect(results[1].target).toBe("tab_command")
  })

  test("handles backslash parity for commands", () => {
    const content = `\\input{active1}
\\\\input{ignored1}
\\\\\\input{active2}
\\\\\\\\input{ignored2}`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(2)
    expect(results[0].target).toBe("active1")
    expect(results[1].target).toBe("active2")
  })

  test("correctly identifies line numbers in mixed content", () => {
    const content = `
\\documentclass{book}
% a comment
\\begin{document}

\\input{chapters/intro}

Some text here.

\\include{chapters/cap1}
\\end{document}
`
    const results = parseLatexIncludes(fileName, content)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ target: "chapters/intro", line: 6 })
    expect(results[1]).toMatchObject({ target: "chapters/cap1", line: 10 })
  })
})
