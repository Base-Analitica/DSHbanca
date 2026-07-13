import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  loadLatexManuscript,
  type TraversalResult,
  type LoaderDiagnostic,
} from "../src/lib/latex_loader"

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
}

function joinedTexts(result: TraversalResult): string {
  return result.orderedSources.map((s) => s.text).join("")
}

function publicPaths(result: TraversalResult): string[] {
  return result.orderedSources.map((s) => s.file)
}

function diagCodes(result: TraversalResult): string[] {
  return result.diagnostics.map((d) => d.code)
}

function assertNoAbsoluteLeak(result: TraversalResult, projectRoot: string): void {
  const rootAbs = path.resolve(projectRoot)
  expect(result.rootFile.includes(rootAbs)).toBe(false)
  expect(path.isAbsolute(result.rootFile)).toBe(false)
  expect(result.rootFile.includes("\\")).toBe(false)

  for (const span of result.orderedSources) {
    expect(path.isAbsolute(span.file)).toBe(false)
    expect(span.file.includes(rootAbs)).toBe(false)
    expect(span.file.includes("\\")).toBe(false)
  }

  for (const d of result.diagnostics) {
    expect(d.message.includes(rootAbs)).toBe(false)
    if (d.file !== undefined) {
      expect(path.isAbsolute(d.file)).toBe(false)
      expect(d.file.includes(rootAbs)).toBe(false)
      expect(d.file.includes("\\")).toBe(false)
    }
  }
}

describe("loadLatexManuscript", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "ob-latex-loader-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("monolithic document yields full source and complete: true", () => {
    const body = `\\documentclass{article}
\\begin{document}
Hello monolithic world.
\\end{document}
`
    writeTree(projectRoot, { "main.tex": body })

    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.complete).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.rootFile).toBe("main.tex")
    expect(result.orderedSources).toHaveLength(1)
    expect(result.orderedSources[0]).toEqual({
      file: "main.tex",
      startLine: 1,
      endLine: 4,
      text: body,
    })
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("three includes preserve document order from main.tex", () => {
    writeTree(projectRoot, {
      "main.tex": `before
\\input{a}
mid1
\\include{b}
mid2
\\input{c}
after
`,
      "a.tex": "AAA\n",
      "b.tex": "BBB\n",
      "c.tex": "CCC\n",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.complete).toBe(true)
    // Document order: each directive is replaced in place; the newline after
    // the directive remains in main.tex, so files that end with \n produce a blank line.
    expect(joinedTexts(result)).toBe(`before
AAA

mid1
BBB

mid2
CCC

after
`)
    expect(publicPaths(result)).toEqual([
      "main.tex",
      "a.tex",
      "main.tex",
      "b.tex",
      "main.tex",
      "c.tex",
      "main.tex",
    ])
    // Order of include bodies follows main.tex directive order
    const includeBodies = result.orderedSources
      .filter((s) => s.file !== "main.tex")
      .map((s) => s.text)
    expect(includeBodies).toEqual(["AAA\n", "BBB\n", "CCC\n"])
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("nested include appears at the correct document position (integration)", () => {
    writeTree(projectRoot, {
      "main.tex": `start
\\input{chapters/outer}
end
`,
      "chapters/outer.tex": `outer-before
\\input{inner}
outer-after
`,
      "chapters/inner.tex": "INNER\n",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.complete).toBe(true)
    expect(joinedTexts(result)).toBe(`start
outer-before
INNER

outer-after

end
`)
    expect(publicPaths(result)).toEqual([
      "main.tex",
      "chapters/outer.tex",
      "chapters/inner.tex",
      "chapters/outer.tex",
      "main.tex",
    ])
    // Nested body sits between outer-before and outer-after in document order
    const texts = result.orderedSources.map((s) => s.text)
    const innerIdx = texts.indexOf("INNER\n")
    expect(innerIdx).toBeGreaterThan(0)
    expect(texts[innerIdx - 1]).toContain("outer-before")
    expect(texts[innerIdx + 1]).toContain("outer-after")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("direct cycle produces controlled diagnostic and incomplete result", () => {
    writeTree(projectRoot, {
      "a.tex": `head
\\input{a}
tail
`,
    })

    const result = loadLatexManuscript(projectRoot, "a.tex")
    expect(result.complete).toBe(false)
    expect(diagCodes(result)).toContain("include_cycle")
    const cycle = result.diagnostics.find((d) => d.code === "include_cycle") as LoaderDiagnostic
    expect(cycle.file).toBe("a.tex")
    expect(cycle.line).toBe(2)
    expect(cycle.target).toBe("a")
    expect(joinedTexts(result)).toContain("head")
    expect(joinedTexts(result)).toContain("tail")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("indirect cycle produces controlled diagnostic with caller file and line", () => {
    writeTree(projectRoot, {
      "a.tex": `A0
\\input{b}
A1
`,
      "b.tex": `B0
\\input{a}
B1
`,
    })

    const result = loadLatexManuscript(projectRoot, "a.tex")
    expect(result.complete).toBe(false)
    const cycle = result.diagnostics.find((d) => d.code === "include_cycle")
    expect(cycle).toBeDefined()
    expect(cycle!.file).toBe("b.tex")
    expect(cycle!.line).toBe(2)
    expect(cycle!.target).toBe("a")
    // Still expands non-cyclic fragments
    expect(joinedTexts(result)).toContain("A0")
    expect(joinedTexts(result)).toContain("B0")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("missing include records caller file and line and continues later includes", () => {
    writeTree(projectRoot, {
      "main.tex": `P
\\input{missing}
Q
\\input{present}
R
`,
      "present.tex": "PRESENT\n",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.complete).toBe(false)
    const missing = result.diagnostics.find((d) => d.code === "include_not_found")
    expect(missing).toBeDefined()
    expect(missing!.file).toBe("main.tex")
    expect(missing!.line).toBe(2)
    expect(missing!.target).toBe("missing")
    expect(joinedTexts(result)).toContain("PRESENT")
    expect(joinedTexts(result)).toContain("P")
    expect(joinedTexts(result)).toContain("Q")
    expect(joinedTexts(result)).toContain("R")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("rejected target is not read and traversal continues", () => {
    writeTree(projectRoot, {
      "main.tex": `X
\\input{/etc/passwd}
Y
\\input{ok}
Z
`,
      "ok.tex": "OK\n",
    })

    const readCalls: string[] = []
    const result = loadLatexManuscript(projectRoot, "main.tex", {
      readFile: (abs) => {
        readCalls.push(abs)
        return defaultFsRead(abs)
      },
    })

    expect(result.complete).toBe(false)
    const rejected = result.diagnostics.find((d) => d.code === "include_rejected")
    expect(rejected).toBeDefined()
    expect(rejected!.file).toBe("main.tex")
    expect(rejected!.line).toBe(2)
    expect(rejected!.target).toBe("/etc/passwd")
    expect(rejected!.message.toLowerCase()).toContain("absolute")

    // Reader must never be invoked for the absolute rejected path.
    expect(readCalls.some((p) => p.includes("passwd") || p === "/etc/passwd")).toBe(false)
    // ok.tex must still be loaded
    expect(joinedTexts(result)).toContain("OK")
    expect(joinedTexts(result)).toContain("X")
    expect(joinedTexts(result)).toContain("Y")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("repeated include without cycle expands at each occurrence", () => {
    writeTree(projectRoot, {
      "main.tex": `\\input{shared}
---
\\input{shared}
`,
      "shared.tex": "SHARED\n",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.complete).toBe(true)
    expect(result.diagnostics).toEqual([])
    const sharedSpans = result.orderedSources.filter((s) => s.file === "shared.tex")
    expect(sharedSpans).toHaveLength(2)
    expect(sharedSpans.every((s) => s.text === "SHARED\n")).toBe(true)
    // Two independent expansions of the same file (no global dedupe)
    expect(joinedTexts(result)).toBe(`SHARED

---
SHARED

`)
  })

  test("multiple includes on the same line preserve surrounding text", () => {
    writeTree(projectRoot, {
      "main.tex": "prefixo \\input{a} meio \\include{b} sufixo\n",
      "a.tex": "A",
      "b.tex": "B",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.complete).toBe(true)
    expect(joinedTexts(result)).toBe("prefixo A meio B sufixo\n")
    const texts = result.orderedSources.map((s) => s.text)
    expect(texts).toContain("prefixo ")
    expect(texts).toContain(" meio ")
    expect(texts).toContain(" sufixo\n")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("public paths are relative POSIX and do not leak project root", () => {
    writeTree(projectRoot, {
      "main.tex": "\\input{sub/x}\n",
      "sub/x.tex": "X\n",
    })
    const result = loadLatexManuscript(projectRoot, "main.tex")
    expect(result.rootFile).toBe("main.tex")
    expect(publicPaths(result)).toEqual(["sub/x.tex", "main.tex"])
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("root_not_found is structured and never throws", () => {
    let threw = false
    let result: TraversalResult | undefined
    try {
      result = loadLatexManuscript(projectRoot, "absent.tex")
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(result).toBeDefined()
    expect(result!.complete).toBe(false)
    expect(diagCodes(result!)).toContain("root_not_found")
    assertNoAbsoluteLeak(result!, projectRoot)
  })

  test("include read_error carries caller file, line, target and continues later includes", () => {
    writeTree(projectRoot, {
      "main.tex": `X
\\input{bad}
Y
\\input{ok}
Z
`,
      "bad.tex": "should not be returned",
      "ok.tex": "OK\n",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex", {
      readFile: (abs) => {
        if (abs.endsWith(`${path.sep}bad.tex`) || abs.endsWith("/bad.tex") || abs.endsWith("bad.tex")) {
          // Distinguish path ends with bad.tex without matching .../okbad.tex
          if (path.basename(abs) === "bad.tex") {
            const err = new Error("EIO simulated") as NodeJS.ErrnoException
            err.code = "EIO"
            throw err
          }
        }
        return defaultFsRead(abs)
      },
    })

    expect(result.complete).toBe(false)
    const errDiag = result.diagnostics.find((d) => d.code === "read_error")
    expect(errDiag).toBeDefined()
    expect(errDiag!.code).toBe("read_error")
    expect(errDiag!.file).toBe("main.tex")
    expect(errDiag!.line).toBe(2)
    expect(errDiag!.target).toBe("bad")
    expect(errDiag!.message.includes(path.resolve(projectRoot))).toBe(false)
    expect(path.isAbsolute(errDiag!.message)).toBe(false)
    // Later include still processed
    expect(joinedTexts(result)).toContain("OK")
    expect(joinedTexts(result)).toContain("X")
    expect(joinedTexts(result)).toContain("Y")
    expect(joinedTexts(result)).toContain("Z")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("include EACCES read_error keeps caller provenance", () => {
    writeTree(projectRoot, {
      "main.tex": `\\input{secret}
\\input{after}
`,
      "secret.tex": "secret",
      "after.tex": "AFTER\n",
    })

    const result = loadLatexManuscript(projectRoot, "main.tex", {
      readFile: (abs) => {
        if (path.basename(abs) === "secret.tex") {
          throw Object.assign(new Error("permission denied"), { code: "EACCES" })
        }
        return defaultFsRead(abs)
      },
    })

    expect(result.complete).toBe(false)
    const errDiag = result.diagnostics.find((d) => d.code === "read_error")!
    expect(errDiag.file).toBe("main.tex")
    expect(errDiag.line).toBe(1)
    expect(errDiag.target).toBe("secret")
    expect(joinedTexts(result)).toContain("AFTER")
    assertNoAbsoluteLeak(result, projectRoot)
  })

  test("invalid projectRoot and rootFile never throw, never read, return safe rootFile", () => {
    const readCalls: string[] = []
    const trackingReader = (abs: string): string => {
      readCalls.push(abs)
      return defaultFsRead(abs)
    }

    const cases: Array<{
      name: string
      root: unknown
      file: unknown
    }> = [
      { name: "empty projectRoot", root: "", file: "main.tex" },
      { name: "whitespace projectRoot", root: "   ", file: "main.tex" },
      { name: "non-string projectRoot", root: 42 as unknown, file: "main.tex" },
      { name: "null projectRoot", root: null as unknown, file: "main.tex" },
      { name: "empty rootFile", root: projectRoot, file: "" },
      { name: "non-string rootFile", root: projectRoot, file: { x: 1 } as unknown },
      { name: "null rootFile", root: projectRoot, file: null as unknown },
      { name: "POSIX absolute rootFile", root: projectRoot, file: "/etc/passwd" },
      { name: "Windows drive rootFile", root: projectRoot, file: "C:\\Users\\x\\evil.tex" },
      { name: "Windows drive slash rootFile", root: projectRoot, file: "D:/tmp/evil.tex" },
      { name: "UNC rootFile", root: projectRoot, file: "\\\\server\\share\\file.tex" },
      { name: "escaping rootFile", root: projectRoot, file: "../../outside.tex" },
    ]

    for (const c of cases) {
      readCalls.length = 0
      let threw = false
      let result: TraversalResult | undefined
      try {
        result = loadLatexManuscript(
          c.root as string,
          c.file as string,
          { readFile: trackingReader },
        )
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(result).toBeDefined()
      expect(result!.complete).toBe(false)
      expect(result!.diagnostics.length).toBeGreaterThan(0)
      expect(result!.diagnostics.every((d) => typeof d.message === "string" && d.message.length > 0)).toBe(true)
      // Safe public root: empty string, never absolute, never contains `..`
      expect(result!.rootFile).toBe("")
      expect(path.isAbsolute(result!.rootFile)).toBe(false)
      expect(result!.rootFile.includes("..")).toBe(false)
      expect(result!.rootFile.includes(path.resolve(projectRoot))).toBe(false)
      expect(readCalls).toEqual([])
      expect(result!.orderedSources).toEqual([])
    }
  })

  test("multi-line and CRLF content produce correct span line numbers", () => {
    // LF multi-line with two directives and surrounding text
    const lfBody = "line1\nline2\n\\input{a}\nline4\n\\include{b}\nline6\n"
    writeTree(projectRoot, {
      "main.tex": lfBody,
      "a.tex": "A-LINE1\nA-LINE2\n",
      "b.tex": "B-ONLY\n",
    })

    const lf = loadLatexManuscript(projectRoot, "main.tex")
    expect(lf.complete).toBe(true)
    const mainSpans = lf.orderedSources.filter((s) => s.file === "main.tex")
    // First main span: "line1\nline2\n" → lines 1-2
    expect(mainSpans[0].startLine).toBe(1)
    expect(mainSpans[0].endLine).toBe(2)
    expect(mainSpans[0].text).toBe("line1\nline2\n")
    // After \input{a}: "\nline4\n" → lines 3-4 (newline after directive is line 3)
    expect(mainSpans[1].startLine).toBe(3)
    expect(mainSpans[1].endLine).toBe(4)
    // After \include{b}: "\nline6\n" → lines 5-6
    expect(mainSpans[2].startLine).toBe(5)
    expect(mainSpans[2].endLine).toBe(6)

    const aSpan = lf.orderedSources.find((s) => s.file === "a.tex")!
    expect(aSpan.startLine).toBe(1)
    expect(aSpan.endLine).toBe(2)

    // CRLF manuscript: same structure, line numbers must match LF mapping
    const crlfRoot = mkdtempSync(path.join(tmpdir(), "ob-latex-crlf-"))
    try {
      const crlfBody = "line1\r\nline2\r\n\\input{a}\r\nline4\r\n\\include{b}\r\nline6\r\n"
      writeTree(crlfRoot, {
        "main.tex": crlfBody,
        "a.tex": "A-LINE1\r\nA-LINE2\r\n",
        "b.tex": "B-ONLY\r\n",
      })
      const crlf = loadLatexManuscript(crlfRoot, "main.tex")
      expect(crlf.complete).toBe(true)
      const crlfMain = crlf.orderedSources.filter((s) => s.file === "main.tex")
      expect(crlfMain[0].startLine).toBe(1)
      expect(crlfMain[0].endLine).toBe(2)
      expect(crlfMain[1].startLine).toBe(3)
      expect(crlfMain[1].endLine).toBe(4)
      expect(crlfMain[2].startLine).toBe(5)
      expect(crlfMain[2].endLine).toBe(6)
      const crlfA = crlf.orderedSources.find((s) => s.file === "a.tex")!
      expect(crlfA.startLine).toBe(1)
      expect(crlfA.endLine).toBe(2)
      assertNoAbsoluteLeak(crlf, crlfRoot)
    } finally {
      rmSync(crlfRoot, { recursive: true, force: true })
    }

    assertNoAbsoluteLeak(lf, projectRoot)
  })

  test("same-line multiple directives keep single-line span numbers", () => {
    writeTree(projectRoot, {
      "main.tex": "prefixo \\input{a} meio \\include{b} sufixo\n",
      "a.tex": "A",
      "b.tex": "B",
    })
    const result = loadLatexManuscript(projectRoot, "main.tex")
    const mainSpans = result.orderedSources.filter((s) => s.file === "main.tex")
    for (const span of mainSpans) {
      expect(span.startLine).toBe(1)
      expect(span.endLine).toBe(1)
    }
  })

  test("expected failures never throw uncaught exceptions", () => {
    writeTree(projectRoot, {
      "main.tex": `\\input{missing}
\\input{/abs}
\\input{self}
`,
      "self.tex": "\\input{self}\n",
    })

    const cases: Array<() => TraversalResult> = [
      () => loadLatexManuscript(projectRoot, "nope.tex"),
      () => loadLatexManuscript(projectRoot, "main.tex"),
      () => loadLatexManuscript(projectRoot, "self.tex"),
      () =>
        loadLatexManuscript(projectRoot, "main.tex", {
          readFile: () => {
            throw Object.assign(new Error("boom"), { code: "EACCES" })
          },
        }),
      () => loadLatexManuscript("" as string, "main.tex"),
      () => loadLatexManuscript(projectRoot, "/abs/main.tex"),
      () => loadLatexManuscript(projectRoot, "../../escape.tex"),
      () => loadLatexManuscript(null as unknown as string, "main.tex"),
      () => loadLatexManuscript(projectRoot, 99 as unknown as string),
    ]

    for (const run of cases) {
      let threw = false
      let result: TraversalResult | undefined
      try {
        result = run()
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(result).toBeDefined()
      expect(result!.complete).toBe(false)
    }
  })
})

function defaultFsRead(abs: string): string {
  return readFileSync(abs, "utf8")
}
