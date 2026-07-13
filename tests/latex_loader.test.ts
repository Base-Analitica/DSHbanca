import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
  lstatSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  loadLatexManuscript,
  loadCanonicalLatexManuscript,
  computeManuscriptFingerprint,
  MANUSCRIPT_FINGERPRINT_VERSION,
  type TraversalResult,
  type LoaderDiagnostic,
  type CanonicalLatexManuscriptResult,
} from "../src/lib/latex_loader"
import type { ProjectConfig } from "../src/lib/config"

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

// ---------------------------------------------------------------------------
// Canonical manuscript: complementary chapters + deterministic fingerprint
// ---------------------------------------------------------------------------

function baseCanonicalConfig(overrides: Partial<ProjectConfig["manuscript"]> = {}): ProjectConfig {
  return {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "refs.bib",
      chapters: [],
      outputDir: "trabalhos",
      ...overrides,
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex"],
    protectedPaths: [],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9,
    providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
    mcp: { crossrefAcademicEnabled: false },
  }
}

function assertNoAbsoluteLeakCanonical(
  result: CanonicalLatexManuscriptResult,
  projectRoot: string,
): void {
  assertNoAbsoluteLeak(result, projectRoot)
  if (result.fingerprint !== null) {
    expect(result.fingerprint.includes(path.resolve(projectRoot))).toBe(false)
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  }
  expect(result.fingerprintVersion).toBe(MANUSCRIPT_FINGERPRINT_VERSION)
  expect(result.fingerprintVersion.includes(path.resolve(projectRoot))).toBe(false)
}

describe("loadCanonicalLatexManuscript", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "ob-canonical-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("1: project with sections/*.tex works without capitulos folder", () => {
    writeTree(projectRoot, {
      "main.tex": "MAIN\n",
      "sections/intro.tex": "INTRO\n",
      "sections/method.tex": "METHOD\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["sections/*.tex"] }),
    )
    expect(result.complete).toBe(true)
    expect(result.rootFile).toBe("main.tex")
    expect(publicPaths(result)).toEqual([
      "main.tex",
      "sections/intro.tex",
      "sections/method.tex",
    ])
    expect(result.orderedSources.map((s) => s.text)).toEqual(["MAIN\n", "INTRO\n", "METHOD\n"])
    expect(result.fingerprint).not.toBeNull()
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("2: empty complementary list keeps only main traversal", () => {
    writeTree(projectRoot, {
      "main.tex": "ONLY-MAIN\n",
      "orphan.tex": "ORPHAN\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: [] }),
    )
    expect(result.complete).toBe(true)
    expect(publicPaths(result)).toEqual(["main.tex"])
    expect(joinedTexts(result)).toBe("ONLY-MAIN\n")
    expect(result.fingerprint).not.toBeNull()
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("3: configured chapter not referenced in main.tex is appended", () => {
    writeTree(projectRoot, {
      "main.tex": "MAIN-BODY\n",
      "extra.tex": "EXTRA-CHAPTER\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["extra.tex"] }),
    )
    expect(result.complete).toBe(true)
    expect(publicPaths(result)).toEqual(["main.tex", "extra.tex"])
    expect(result.orderedSources[1].text).toBe("EXTRA-CHAPTER\n")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("4: chapter already included via \\input is not re-added as complement", () => {
    writeTree(projectRoot, {
      "main.tex": "before\n\\input{sections/metodo}\nafter\n",
      "sections/metodo.tex": "METODO\n",
      "sections/other.tex": "OTHER\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["sections/*.tex"] }),
    )
    expect(result.complete).toBe(true)
    // metodo appears only from main graph expansion, not as a complementary copy
    const metodoSpans = result.orderedSources.filter((s) => s.file === "sections/metodo.tex")
    expect(metodoSpans).toHaveLength(1)
    expect(metodoSpans[0].text).toBe("METODO\n")
    // other is complementary only
    const otherSpans = result.orderedSources.filter((s) => s.file === "sections/other.tex")
    expect(otherSpans).toHaveLength(1)
    expect(otherSpans[0].text).toBe("OTHER\n")
    // Order: main graph first (with metodo inside), then other complement
    const files = publicPaths(result)
    expect(files.filter((f) => f === "sections/metodo.tex").length).toBe(1)
    expect(files.indexOf("sections/other.tex")).toBeGreaterThan(files.indexOf("sections/metodo.tex"))
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("5: two patterns preserve configuration order", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "group-b/b1.tex": "B1\n",
      "group-a/a1.tex": "A1\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["group-b/*.tex", "group-a/*.tex"] }),
    )
    expect(result.complete).toBe(true)
    expect(publicPaths(result)).toEqual(["main.tex", "group-b/b1.tex", "group-a/a1.tex"])
    expect(result.orderedSources.map((s) => s.text)).toEqual(["M\n", "B1\n", "A1\n"])
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("6: multiple matches of the same pattern use lexical POSIX order", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "ch/z.tex": "Z\n",
      "ch/a.tex": "A\n",
      "ch/m.tex": "MCH\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["ch/*.tex"] }),
    )
    expect(publicPaths(result)).toEqual(["main.tex", "ch/a.tex", "ch/m.tex", "ch/z.tex"])
    expect(result.orderedSources.map((s) => s.text)).toEqual(["M\n", "A\n", "MCH\n", "Z\n"])
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("7: overlapping patterns do not duplicate files", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "shared.tex": "SHARED\n",
      "only.tex": "ONLY\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["shared.tex", "*.tex"] }),
    )
    expect(result.complete).toBe(true)
    const shared = result.orderedSources.filter((s) => s.file === "shared.tex")
    expect(shared).toHaveLength(1)
    expect(shared[0].text).toBe("SHARED\n")
    // main.tex matched by *.tex but already present as root — not re-added
    expect(result.orderedSources.filter((s) => s.file === "main.tex")).toHaveLength(1)
    expect(publicPaths(result)).toEqual(["main.tex", "shared.tex", "only.tex"])
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("8: documentary repeats inside the main graph remain preserved", () => {
    writeTree(projectRoot, {
      "main.tex": "\\input{shared}\n---\n\\input{shared}\n",
      "shared.tex": "SHARED\n",
      "extra.tex": "EXTRA\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["extra.tex", "shared.tex"] }),
    )
    expect(result.complete).toBe(true)
    const sharedSpans = result.orderedSources.filter((s) => s.file === "shared.tex")
    expect(sharedSpans).toHaveLength(2)
    expect(sharedSpans.every((s) => s.text === "SHARED\n")).toBe(true)
    // extra appended once; shared not added as complement
    expect(result.orderedSources.filter((s) => s.file === "extra.tex")).toHaveLength(1)
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("9: same content and order produce the same fingerprint", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "a.tex": "A\n",
    })
    const cfg = baseCanonicalConfig({ chapters: ["a.tex"] })
    const r1 = loadCanonicalLatexManuscript(projectRoot, cfg)
    const r2 = loadCanonicalLatexManuscript(projectRoot, cfg)
    expect(r1.complete).toBe(true)
    expect(r1.fingerprint).toBe(r2.fingerprint)
    expect(r1.fingerprint).toBe(
      computeManuscriptFingerprint(r1.orderedSources, MANUSCRIPT_FINGERPRINT_VERSION),
    )
    assertNoAbsoluteLeakCanonical(r1, projectRoot)
  })

  test("10: content change changes the fingerprint", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "a.tex": "A-ORIGINAL\n",
    })
    const cfg = baseCanonicalConfig({ chapters: ["a.tex"] })
    const before = loadCanonicalLatexManuscript(projectRoot, cfg)
    writeFileSync(path.join(projectRoot, "a.tex"), "A-CHANGED\n", "utf8")
    const after = loadCanonicalLatexManuscript(projectRoot, cfg)
    expect(before.fingerprint).not.toBeNull()
    expect(after.fingerprint).not.toBeNull()
    expect(before.fingerprint).not.toBe(after.fingerprint)
    expect(after.orderedSources.find((s) => s.file === "a.tex")!.text).toBe("A-CHANGED\n")
  })

  test("11: changing complement order changes the fingerprint", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "x.tex": "X\n",
      "y.tex": "Y\n",
    })
    const orderXY = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["x.tex", "y.tex"] }),
    )
    const orderYX = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["y.tex", "x.tex"] }),
    )
    expect(publicPaths(orderXY)).toEqual(["main.tex", "x.tex", "y.tex"])
    expect(publicPaths(orderYX)).toEqual(["main.tex", "y.tex", "x.tex"])
    expect(orderXY.fingerprint).not.toBe(orderYX.fingerprint)
  })

  test("12: different absolute roots with same relative tree yield the same fingerprint", () => {
    const tree = {
      "main.tex": "MAIN\n\\input{parts/a}\n",
      "parts/a.tex": "PART-A\n",
      "extra.tex": "EXTRA\n",
    }
    const rootA = mkdtempSync(path.join(tmpdir(), "ob-fp-a-"))
    const rootB = mkdtempSync(path.join(tmpdir(), "ob-fp-b-"))
    try {
      writeTree(rootA, tree)
      writeTree(rootB, tree)
      const cfg = baseCanonicalConfig({ chapters: ["extra.tex"] })
      const fa = loadCanonicalLatexManuscript(rootA, cfg)
      const fb = loadCanonicalLatexManuscript(rootB, cfg)
      expect(fa.complete).toBe(true)
      expect(fb.complete).toBe(true)
      expect(fa.fingerprint).toBe(fb.fingerprint)
      expect(publicPaths(fa)).toEqual(publicPaths(fb))
      expect(fa.orderedSources.map((s) => s.text)).toEqual(fb.orderedSources.map((s) => s.text))
      // Absolute roots differ
      expect(path.resolve(rootA)).not.toBe(path.resolve(rootB))
      assertNoAbsoluteLeakCanonical(fa, rootA)
      assertNoAbsoluteLeakCanonical(fb, rootB)
    } finally {
      rmSync(rootA, { recursive: true, force: true })
      rmSync(rootB, { recursive: true, force: true })
    }
  })

  test("13: failed complement leaves complete false and fingerprint null", () => {
    writeTree(projectRoot, {
      "main.tex": "MAIN-OK\n",
      "bad.tex": "will fail\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["bad.tex"] }),
      {
        readFile: (abs) => {
          if (path.basename(abs) === "bad.tex") {
            throw Object.assign(new Error("EIO simulated"), { code: "EIO" })
          }
          return defaultFsRead(abs)
        },
      },
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("read_error")
    // Main content still available for diagnosis
    expect(joinedTexts(result)).toContain("MAIN-OK")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("14: no result or diagnostic exposes the absolute temporary path", () => {
    writeTree(projectRoot, {
      "main.tex": "\\input{missing-include}\n",
      "ch.tex": "CH\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["ch.tex"] }),
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    const abs = path.resolve(projectRoot)
    const blob = JSON.stringify(result)
    expect(blob.includes(abs)).toBe(false)
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("15: absolute or .. pattern is not followed or read", () => {
    writeTree(projectRoot, {
      "main.tex": "SAFE\n",
      "legit.tex": "LEGIT\n",
    })
    const readCalls: string[] = []
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({
        chapters: ["/etc/passwd", "../outside.tex", "legit.tex"],
      }),
      {
        readFile: (abs) => {
          readCalls.push(abs)
          return defaultFsRead(abs)
        },
      },
    )
    // Unsafe patterns mark discovery incomplete (not silent success).
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_pattern_rejected")
    // Safe pattern still contributes content for diagnosis.
    expect(publicPaths(result)).toEqual(["main.tex", "legit.tex"])
    expect(readCalls.some((p) => p.includes("passwd") || p.includes("outside"))).toBe(false)
    for (const call of readCalls) {
      expect(call.startsWith(path.resolve(projectRoot))).toBe(true)
    }
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("16: discovery does not follow symlink outside root when supported", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "inside.tex": "INSIDE\n",
    })
    const outsideDir = mkdtempSync(path.join(tmpdir(), "ob-canon-outside-"))
    try {
      const outsideFile = path.join(outsideDir, "secret.tex")
      writeFileSync(outsideFile, "SECRET-OUTSIDE\n", "utf8")
      const linkPath = path.join(projectRoot, "linked.tex")
      let symlinkSupported = true
      try {
        symlinkSync(outsideFile, linkPath)
        if (!lstatSync(linkPath).isSymbolicLink()) symlinkSupported = false
      } catch {
        symlinkSupported = false
      }

      const readCalls: string[] = []
      const result = loadCanonicalLatexManuscript(
        projectRoot,
        baseCanonicalConfig({ chapters: ["*.tex"] }),
        {
          readFile: (abs) => {
            readCalls.push(abs)
            return defaultFsRead(abs)
          },
        },
      )

      if (!symlinkSupported) {
        // Environment cannot create symlinks; still verify normal discovery works.
        expect(result.complete).toBe(true)
        expect(publicPaths(result)).toContain("inside.tex")
        return
      }

      expect(result.complete).toBe(true)
      expect(publicPaths(result)).toEqual(["main.tex", "inside.tex"])
      expect(joinedTexts(result)).not.toContain("SECRET-OUTSIDE")
      expect(readCalls.some((p) => p.includes("secret") || p === outsideFile)).toBe(false)
      assertNoAbsoluteLeakCanonical(result, projectRoot)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  test("api smoke: fingerprintVersion present and fingerprint stable across two calls", () => {
    writeTree(projectRoot, {
      "main.tex": "smoke\n",
      "c.tex": "comp\n",
    })
    const cfg = baseCanonicalConfig({ chapters: ["c.tex"] })
    const a = loadCanonicalLatexManuscript(projectRoot, cfg)
    const b = loadCanonicalLatexManuscript(projectRoot, cfg)
    expect(a.fingerprintVersion).toBe(MANUSCRIPT_FINGERPRINT_VERSION)
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(publicPaths(a)).toEqual(["main.tex", "c.tex"])
  })

  test("incomplete main yields null fingerprint even with valid complements", () => {
    writeTree(projectRoot, {
      "main.tex": "\\input{missing}\n",
      "extra.tex": "E\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["extra.tex"] }),
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(joinedTexts(result)).toContain("E")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("complement with nested includes merges with dedup of already-present files", () => {
    writeTree(projectRoot, {
      "main.tex": "\\input{shared}\n",
      "shared.tex": "SHARED\n",
      "comp.tex": "C0\n\\input{shared}\nC1\n\\input{newborn}\nC2\n",
      "newborn.tex": "NEW\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["comp.tex"] }),
    )
    expect(result.complete).toBe(true)
    // shared from main once; when merging comp, shared spans dropped; newborn kept
    const shared = result.orderedSources.filter((s) => s.file === "shared.tex")
    expect(shared).toHaveLength(1)
    expect(shared[0].text).toBe("SHARED\n")
    expect(result.orderedSources.filter((s) => s.file === "newborn.tex").map((s) => s.text)).toEqual([
      "NEW\n",
    ])
    expect(result.orderedSources.some((s) => s.file === "comp.tex" && s.text.includes("C0"))).toBe(
      true,
    )
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })
})

// ---------------------------------------------------------------------------
// Integrity fixes from PR #59 review (empty files, discovery, path normalize)
// ---------------------------------------------------------------------------

describe("canonical integrity regressions (PR review)", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), "ob-canon-fix-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("empty chapter vs empty list: representation and fingerprint differ", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "empty.tex": "",
    })
    const without = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: [] }),
    )
    const withEmpty = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["empty.tex"] }),
    )
    expect(without.complete).toBe(true)
    expect(withEmpty.complete).toBe(true)
    expect(without.fingerprint).not.toBeNull()
    expect(withEmpty.fingerprint).not.toBeNull()
    expect(without.fingerprint).not.toBe(withEmpty.fingerprint)
    expect(publicPaths(withEmpty)).toContain("empty.tex")
    const emptySpan = withEmpty.orderedSources.find((s) => s.file === "empty.tex")!
    expect(emptySpan.text).toBe("")
    expect(publicPaths(without)).not.toContain("empty.tex")
  })

  test("reordering empty chapters changes fingerprint", () => {
    writeTree(projectRoot, {
      "main.tex": "M\n",
      "a.tex": "",
      "b.tex": "",
    })
    const ab = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["a.tex", "b.tex"] }),
    )
    const ba = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["b.tex", "a.tex"] }),
    )
    expect(ab.complete).toBe(true)
    expect(ba.complete).toBe(true)
    expect(publicPaths(ab)).toEqual(["main.tex", "a.tex", "b.tex"])
    expect(publicPaths(ba)).toEqual(["main.tex", "b.tex", "a.tex"])
    expect(ab.fingerprint).not.toBe(ba.fingerprint)
  })

  test("include-only file appears in manifesto and blocks complementary re-add", () => {
    writeTree(projectRoot, {
      // No trailing newline after the directive so shell has zero own text spans.
      "main.tex": "\\input{shell}",
      "shell.tex": "\\input{body}",
      "body.tex": "BODY\n",
    })
    // shell is include-only; must still appear as an empty visit marker.
    const mainOnly = loadLatexManuscript(projectRoot, "main.tex")
    expect(mainOnly.complete).toBe(true)
    expect(publicPaths(mainOnly)).toContain("shell.tex")
    expect(mainOnly.orderedSources.find((s) => s.file === "shell.tex")!.text).toBe("")
    // main itself is also include-only → empty marker before expansion
    expect(publicPaths(mainOnly)).toContain("main.tex")

    const canon = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["shell.tex", "body.tex"] }),
    )
    expect(canon.complete).toBe(true)
    // shell and body already in main graph — not re-added as complements
    expect(publicPaths(canon).filter((f) => f === "shell.tex")).toHaveLength(1)
    expect(publicPaths(canon).filter((f) => f === "body.tex")).toHaveLength(1)
  })

  test("unsafe chapter pattern: no throw, structured diagnostic, complete false, null fingerprint", () => {
    writeTree(projectRoot, { "main.tex": "SAFE\n" })
    let threw = false
    let result: CanonicalLatexManuscriptResult | undefined
    try {
      result = loadCanonicalLatexManuscript(
        projectRoot,
        baseCanonicalConfig({ chapters: ["../outside.tex"] }),
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(result!.complete).toBe(false)
    expect(result!.fingerprint).toBeNull()
    expect(diagCodes(result!)).toContain("chapter_pattern_rejected")
    assertNoAbsoluteLeakCanonical(result!, projectRoot)
  })

  test("malformed chapter pattern: no throw, diagnostic, complete false, null fingerprint", () => {
    writeTree(projectRoot, { "main.tex": "SAFE\n", "a.tex": "A\n" })
    let threw = false
    let result: CanonicalLatexManuscriptResult | undefined
    try {
      result = loadCanonicalLatexManuscript(projectRoot, {
        ...baseCanonicalConfig({ chapters: ["a.tex"] }),
        manuscript: {
          ...baseCanonicalConfig().manuscript,
          chapters: ["a.tex", { bad: true } as unknown as string],
        },
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(result!.complete).toBe(false)
    expect(result!.fingerprint).toBeNull()
    expect(diagCodes(result!)).toContain("chapter_pattern_malformed")
    assertNoAbsoluteLeakCanonical(result!, projectRoot)
  })

  test("injectable discovery readdir failure: incomplete, not partial-complete", () => {
    writeTree(projectRoot, { "main.tex": "M\n", "ch.tex": "C\n" })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: ["*.tex"] }),
      {
        chapterDiscoveryFs: {
          readdirSync: () => {
            throw Object.assign(new Error("EIO"), { code: "EIO" })
          },
          lstatSync: (p) => lstatSync(p),
        },
      },
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_discovery_error")
    // Main content may still be present for diagnosis
    expect(joinedTexts(result)).toContain("M")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("manuscript.root ./manuscript + chapters *.tex reads already-present main only once", () => {
    writeTree(projectRoot, {
      "manuscript/main.tex": "MAIN-BODY\n",
      "manuscript/extra.tex": "EXTRA\n",
    })
    const readCounts = new Map<string, number>()
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({
        root: "./manuscript",
        main: "main.tex",
        chapters: ["*.tex"],
      }),
      {
        readFile: (abs) => {
          const base = path.basename(abs)
          readCounts.set(base, (readCounts.get(base) ?? 0) + 1)
          return defaultFsRead(abs)
        },
      },
    )
    expect(result.complete).toBe(true)
    expect(result.rootFile).toBe("manuscript/main.tex")
    expect(publicPaths(result)).toEqual(["manuscript/main.tex", "manuscript/extra.tex"])
    // main.tex must be read exactly once (not again as complement)
    expect(readCounts.get("main.tex")).toBe(1)
    expect(readCounts.get("extra.tex")).toBe(1)
    expect(result.fingerprint).not.toBeNull()
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("empty root file still participates in fingerprint", () => {
    writeTree(projectRoot, { "main.tex": "" })
    const r = loadCanonicalLatexManuscript(projectRoot, baseCanonicalConfig({ chapters: [] }))
    expect(r.complete).toBe(true)
    expect(r.orderedSources).toEqual([
      { file: "main.tex", startLine: 1, endLine: 1, text: "" },
    ])
    expect(r.fingerprint).toBe(
      computeManuscriptFingerprint(r.orderedSources, MANUSCRIPT_FINGERPRINT_VERSION),
    )
  })

  test("absolute manuscript.root is rejected and does not shadow a relative subdir", () => {
    // If `/etc` were normalized to `etc`, this shadow tree would load as complete.
    writeTree(projectRoot, {
      "etc/main.tex": "SHADOW-CONTENT\n",
      "main.tex": "PROJECT-ROOT\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({
        root: "/etc",
        main: "main.tex",
        chapters: [],
      }),
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_pattern_rejected")
    expect(result.orderedSources).toEqual([])
    expect(joinedTexts(result)).not.toContain("SHADOW-CONTENT")
    expect(joinedTexts(result)).not.toContain("PROJECT-ROOT")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("UNC manuscript.root is rejected without reading project-relative shadow paths", () => {
    writeTree(projectRoot, {
      "unc/share/main.tex": "UNC-SHADOW\n",
      "main.tex": "OK\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({
        root: "//unc/share",
        main: "main.tex",
        chapters: ["*.tex"],
      }),
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_pattern_rejected")
    expect(joinedTexts(result)).not.toContain("UNC-SHADOW")
    expect(result.orderedSources).toEqual([])
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("Windows drive manuscript.root is rejected on the raw string", () => {
    writeTree(projectRoot, {
      "Users/x/main.tex": "DRIVE-SHADOW\n",
      "main.tex": "OK\n",
    })
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({
        root: "C:\\Users\\x",
        main: "main.tex",
        chapters: [],
      }),
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_pattern_rejected")
    expect(joinedTexts(result)).not.toContain("DRIVE-SHADOW")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("Windows/UNC chapter patterns: incomplete and no absolute form in full JSON", () => {
    writeTree(projectRoot, { "main.tex": "M\n", "a.tex": "A\n" })
    const win = "C:\\Users\\Pedro\\secret.tex"
    const unc = "\\\\server\\share\\secret.tex"
    const result = loadCanonicalLatexManuscript(
      projectRoot,
      baseCanonicalConfig({ chapters: [win, unc, "a.tex"] }),
    )
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_pattern_rejected")
    const blob = JSON.stringify(result)
    expect(blob.includes("C:")).toBe(false)
    expect(blob.includes("Users")).toBe(false)
    expect(blob.includes("secret.tex")).toBe(false)
    expect(blob.includes("server")).toBe(false)
    expect(blob.includes(win)).toBe(false)
    expect(blob.includes(unc)).toBe(false)
    // Safe chapter still merged for diagnosis
    expect(publicPaths(result)).toContain("a.tex")
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })

  test("non-array manuscript.chapters: incomplete, diagnostic, null fingerprint", () => {
    writeTree(projectRoot, { "main.tex": "M\n" })
    const result = loadCanonicalLatexManuscript(projectRoot, {
      ...baseCanonicalConfig({ chapters: [] }),
      manuscript: {
        ...baseCanonicalConfig().manuscript,
        chapters: "sections/*.tex" as unknown as string[],
      },
    })
    expect(result.complete).toBe(false)
    expect(result.fingerprint).toBeNull()
    expect(diagCodes(result)).toContain("chapter_pattern_malformed")
    const blob = JSON.stringify(result)
    // The string pattern itself is not echoed as a safe relative path field;
    // message is generic about array shape.
    expect(result.diagnostics.every((d) => d.target === undefined || !String(d.target).includes("sections"))).toBe(true)
    assertNoAbsoluteLeakCanonical(result, projectRoot)
  })
})
