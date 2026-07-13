import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  lstatSync,
  realpathSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  resolveChapterPatternMatches,
  resolveManuscriptPaths,
  isUnsafeChapterPattern,
  globToRegex,
  tryGlobToRegex,
  normalizePublicPath,
  isAbsoluteDriveOrUncForm,
  ChapterDiscoveryError,
} from "../src/lib/paths"
import type { ProjectConfig } from "../src/lib/config"

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
}

function baseConfig(chapters: string[]): ProjectConfig {
  return {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "refs.bib",
      chapters,
      outputDir: "trabalhos",
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

describe("resolveChapterPatternMatches", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ob-chapter-patterns-"))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test("empty pattern list yields zero matches and complete", () => {
    writeTree(root, { "sections/a.tex": "A\n", "main.tex": "M\n" })
    const r = resolveChapterPatternMatches(root, [])
    expect(r.matches).toEqual([])
    expect(r.complete).toBe(true)
    expect(r.diagnostics).toEqual([])
  })

  test("sections/*.tex works without a capitulos folder", () => {
    writeTree(root, {
      "main.tex": "main\n",
      "sections/b.tex": "B\n",
      "sections/a.tex": "A\n",
      "other/x.tex": "X\n",
    })
    const r = resolveChapterPatternMatches(root, ["sections/*.tex"])
    expect(r.complete).toBe(true)
    expect(r.matches).toEqual(["sections/a.tex", "sections/b.tex"])
  })

  test("matches within a pattern are sorted lexicographically by POSIX path", () => {
    writeTree(root, {
      "capitulos/z.tex": "Z\n",
      "capitulos/a.tex": "A\n",
      "capitulos/m.tex": "M\n",
    })
    expect(resolveChapterPatternMatches(root, ["capitulos/*.tex"]).matches).toEqual([
      "capitulos/a.tex",
      "capitulos/m.tex",
      "capitulos/z.tex",
    ])
  })

  test("two patterns preserve configuration order; first occurrence wins", () => {
    writeTree(root, {
      "a/one.tex": "1\n",
      "a/two.tex": "2\n",
      "b/shared.tex": "S\n",
      "a/shared.tex": "A-S\n",
      "b/extra.tex": "E\n",
    })
    expect(resolveChapterPatternMatches(root, ["b/*.tex", "a/*.tex"]).matches).toEqual([
      "b/extra.tex",
      "b/shared.tex",
      "a/one.tex",
      "a/shared.tex",
      "a/two.tex",
    ])

    writeTree(root, {
      "shared.tex": "S\n",
      "only-second.tex": "O\n",
    })
    expect(resolveChapterPatternMatches(root, ["shared.tex", "*.tex"]).matches).toEqual([
      "shared.tex",
      "only-second.tex",
    ])
  })

  test("pattern with no matches is not an error", () => {
    writeTree(root, { "main.tex": "M\n" })
    const r = resolveChapterPatternMatches(root, ["missing/*.tex", "also-missing.tex"])
    expect(r.matches).toEqual([])
    expect(r.complete).toBe(true)
  })

  test("absolute and traversal patterns are unsafe: incomplete + diagnostic, no matches from them", () => {
    writeTree(root, { "evil.tex": "E\n", "sub/x.tex": "X\n" })
    expect(isUnsafeChapterPattern("/etc/*.tex")).toBe(true)
    expect(isUnsafeChapterPattern("../outside/*.tex")).toBe(true)
    expect(isUnsafeChapterPattern("C:\\Windows\\*.tex")).toBe(true)

    const r = resolveChapterPatternMatches(root, [
      "/etc/passwd",
      "../outside/*.tex",
      "sub/*.tex",
    ])
    expect(r.matches).toEqual(["sub/x.tex"])
    expect(r.complete).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "unsafe_pattern")).toBe(true)
    for (const m of r.matches) {
      expect(path.isAbsolute(m)).toBe(false)
      expect(m.includes("..")).toBe(false)
    }
    // No absolute host path in diagnostics
    for (const d of r.diagnostics) {
      expect(d.message.includes(path.resolve(root))).toBe(false)
      if (d.pattern !== undefined) {
        expect(path.isAbsolute(d.pattern)).toBe(false)
      }
    }
  })

  test("glob treats regex metacharacters as literals; special filenames match", () => {
    const special = "file[1](x)+{y}^$|z?.tex"
    writeTree(root, {
      [special]: "SPECIAL\n",
      "plain.tex": "P\n",
    })
    // Exact pattern with metacharacters must match the literal filename.
    const exact = resolveChapterPatternMatches(root, [special])
    expect(exact.complete).toBe(true)
    expect(exact.matches).toEqual([special])

    // Wildcard still works; lex order among matches.
    const star = resolveChapterPatternMatches(root, ["*.tex"])
    expect(star.matches).toContain(special)
    expect(star.matches).toContain("plain.tex")

    // Former crash pattern no longer throws; compiles as a literal.
    expect(() => globToRegex("[.tex")).not.toThrow()
    expect(tryGlobToRegex("[.tex")).not.toBeNull()
  })

  test("non-string pattern is malformed: no throw, diagnostic, incomplete", () => {
    writeTree(root, { "a.tex": "A\n" })
    let threw = false
    let r
    try {
      r = resolveChapterPatternMatches(root, ["a.tex", 42 as unknown as string])
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(r!.complete).toBe(false)
    expect(r!.diagnostics.some((d) => d.code === "malformed_pattern")).toBe(true)
    expect(r!.matches).toEqual(["a.tex"])
  })

  test("discovery readdir failure yields incomplete + diagnostic", () => {
    writeTree(root, { "a.tex": "A\n" })
    const r = resolveChapterPatternMatches(root, ["*.tex"], {
      fs: {
        readdirSync: () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" })
        },
        lstatSync: (p) => lstatSync(p),
      },
    })
    expect(r.complete).toBe(false)
    expect(r.diagnostics.some((d) => d.code === "discovery_error")).toBe(true)
    expect(r.matches).toEqual([])
    for (const d of r.diagnostics) {
      expect(d.message.includes(path.resolve(root))).toBe(false)
    }
  })

  test("normalizePublicPath collapses ./ segments", () => {
    expect(normalizePublicPath("./manuscript/main.tex")).toBe("manuscript/main.tex")
    expect(normalizePublicPath("manuscript/./a.tex")).toBe("manuscript/a.tex")
    expect(normalizePublicPath("a//b/./c.tex")).toBe("a/b/c.tex")
  })

  test("isAbsoluteDriveOrUncForm detects raw absolute forms that normalize would collapse", () => {
    expect(isAbsoluteDriveOrUncForm("/etc")).toBe(true)
    expect(isAbsoluteDriveOrUncForm("//unc/share")).toBe(true)
    expect(isAbsoluteDriveOrUncForm("C:\\Users\\x")).toBe(true)
    expect(isAbsoluteDriveOrUncForm("D:/tmp")).toBe(true)
    expect(isAbsoluteDriveOrUncForm("./manuscript")).toBe(false)
    expect(isAbsoluteDriveOrUncForm("manuscript")).toBe(false)
    // normalizePublicPath alone would strip leading slash — callers must reject first
    expect(normalizePublicPath("/etc")).toBe("etc")
  })

  test("discovery does not follow symlink to a file outside the root when supported", () => {
    writeTree(root, { "inside.tex": "IN\n" })
    const outsideDir = mkdtempSync(path.join(tmpdir(), "ob-chapter-outside-"))
    try {
      const outsideFile = path.join(outsideDir, "secret.tex")
      writeFileSync(outsideFile, "SECRET\n", "utf8")
      const linkPath = path.join(root, "linked.tex")
      let symlinkSupported = true
      try {
        symlinkSync(outsideFile, linkPath)
        expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
      } catch {
        symlinkSupported = false
      }
      if (!symlinkSupported) {
        expect(resolveChapterPatternMatches(root, ["*.tex"]).matches).toEqual(["inside.tex"])
        return
      }
      const r = resolveChapterPatternMatches(root, ["*.tex"])
      expect(r.matches).toEqual(["inside.tex"])
      expect(r.matches).not.toContain("linked.tex")
      expect(r.matches.some((m) => m.includes("secret") || path.isAbsolute(m))).toBe(false)
      const outsideReal = realpathSync(outsideFile)
      expect(r.matches.some((m) => m.includes(outsideReal))).toBe(false)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  test("resolveManuscriptPaths uses config chapters instead of hardcoded capitulos-only scan", () => {
    writeTree(root, {
      "main.tex": "M\n",
      "refs.bib": "",
      "sections/z.tex": "Z\n",
      "sections/a.tex": "A\n",
    })
    const paths = resolveManuscriptPaths(root, baseConfig(["sections/*.tex"]))
    expect(paths.chapters.map((c) => path.basename(c)).sort()).toEqual(["a.tex", "z.tex"])
    expect(paths.chapters.map((c) => path.relative(root, c).split(path.sep).join("/"))).toEqual([
      "sections/a.tex",
      "sections/z.tex",
    ])
  })

  test("Windows drive and UNC patterns never appear in JSON diagnostics", () => {
    writeTree(root, { "a.tex": "A\n" })
    const win = "C:\\Users\\Pedro\\secret.tex"
    const unc = "\\\\server\\share\\secret.tex"
    const r = resolveChapterPatternMatches(root, [win, unc, "a.tex"])
    expect(r.complete).toBe(false)
    expect(r.matches).toEqual(["a.tex"])
    const blob = JSON.stringify(r)
    expect(blob.includes("C:")).toBe(false)
    expect(blob.includes("Users\\Pedro")).toBe(false)
    expect(blob.includes("Users/Pedro")).toBe(false)
    expect(blob.includes("secret.tex")).toBe(false)
    expect(blob.includes("server")).toBe(false)
    expect(blob.includes("share")).toBe(false)
    expect(blob.includes(win)).toBe(false)
    expect(blob.includes(unc)).toBe(false)
    // Relative-unsafe patterns may still be reported
    const rel = resolveChapterPatternMatches(root, ["../outside.tex"])
    expect(rel.complete).toBe(false)
    expect(rel.diagnostics.some((d) => d.pattern === "../outside.tex")).toBe(true)
  })

  test("non-array chapters is malformed incomplete discovery", () => {
    writeTree(root, { "a.tex": "A\n" })
    const r = resolveChapterPatternMatches(root, "sections/*.tex" as unknown)
    expect(r.complete).toBe(false)
    expect(r.matches).toEqual([])
    expect(r.diagnostics.some((d) => d.code === "malformed_pattern")).toBe(true)
    expect(JSON.stringify(r).includes("sections/*.tex")).toBe(false)
  })

  test("resolveManuscriptPaths throws ChapterDiscoveryError on incomplete discovery", () => {
    writeTree(root, {
      "main.tex": "M\n",
      "refs.bib": "",
      "ok.tex": "OK\n",
    })
    // Safe complete discovery still works
    const ok = resolveManuscriptPaths(root, baseConfig(["ok.tex"]))
    expect(ok.chapters.map((c) => path.basename(c))).toEqual(["ok.tex"])

    // Unsafe pattern → throw, no silent partial list
    let threw: unknown
    try {
      resolveManuscriptPaths(root, baseConfig(["../outside.tex", "ok.tex"]))
    } catch (e) {
      threw = e
    }
    expect(threw).toBeInstanceOf(ChapterDiscoveryError)
    const err = threw as InstanceType<typeof ChapterDiscoveryError>
    expect(err.message.toLowerCase()).toContain("incomplete")
    const errBlob = JSON.stringify({ message: err.message, diagnostics: err.diagnostics })
    expect(errBlob.includes(path.resolve(root))).toBe(false)

    // Injected readdir failure → throw
    // (via incomplete discovery from unsafe is enough; also non-array)
    let threw2: unknown
    try {
      resolveManuscriptPaths(root, {
        ...baseConfig([]),
        manuscript: {
          ...baseConfig([]).manuscript,
          chapters: "not-an-array" as unknown as string[],
        },
      })
    } catch (e) {
      threw2 = e
    }
    expect(threw2).toBeInstanceOf(ChapterDiscoveryError)
  })
})
