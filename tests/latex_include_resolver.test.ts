import { describe, test, expect } from "bun:test"
import path from "node:path"
import {
  resolveLatexIncludePath,
  type IncludeResolution,
} from "../src/lib/latex_include_resolver"

/** Fixed POSIX-style absolute roots for deterministic tests on any host. */
const PROJECT_ROOT = path.resolve("/tmp/openbanca-fixtures/project")
const SIBLING_ROOT = path.resolve("/tmp/openbanca-fixtures/project-malicioso")

function expectOk(result: IncludeResolution): asserts result is { ok: true; path: string } {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`)
}

function expectFail(
  result: IncludeResolution,
  code: "absolute_path" | "outside_root" | "invalid_target",
): asserts result is { ok: false; code: typeof code; message: string } {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error(`expected failure ${code}, got ok path=${result.path}`)
  expect(result.code).toBe(code)
  expect(typeof result.message).toBe("string")
  expect(result.message.length).toBeGreaterThan(0)
}

describe("resolveLatexIncludePath", () => {
  test("resolves include in the same directory", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "intro.tex")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "intro.tex"))
  })

  test("resolves include in a subdirectory", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "capitulos/cap1.tex")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "capitulos", "cap1.tex"))
  })

  test("appends .tex when the target has no extension", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "intro")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "intro.tex"))
  })

  test("does not duplicate .tex when already present", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "intro.tex")
    expectOk(result)
    expect(result.path.endsWith("intro.tex")).toBe(true)
    expect(result.path.endsWith("intro.tex.tex")).toBe(false)
  })

  test("rejects POSIX absolute target", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "/etc/passwd")
    expectFail(result, "absolute_path")
  })

  test("rejects Windows drive-absolute target", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "C:\\Users\\x\\evil.tex")
    expectFail(result, "absolute_path")
  })

  test("rejects Windows drive with forward slashes", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "D:/tmp/evil.tex")
    expectFail(result, "absolute_path")
  })

  test("rejects UNC target", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "\\\\server\\share\\file.tex")
    expectFail(result, "absolute_path")
  })

  test("rejects Windows root-relative target", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "\\Windows\\system32\\evil.tex")
    expectFail(result, "absolute_path")
  })

  test("rejects ambiguous drive-relative target (C:foo)", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "C:foo")
    expectFail(result, "absolute_path")
  })

  test("rejects traversal that escapes the project root", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "../../outside.tex")
    expectFail(result, "outside_root")
  })

  test("accepts ../ when the result remains inside the project root", () => {
    const source = path.join(PROJECT_ROOT, "capitulos", "cap1.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "../shared/macros")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "shared", "macros.tex"))
  })

  test("rejects sourceFile outside the project root", () => {
    const source = path.join(SIBLING_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "intro.tex")
    expectFail(result, "outside_root")
  })

  test("resolves sourceFile relative to projectRoot", () => {
    const result = resolveLatexIncludePath(PROJECT_ROOT, "capitulos/cap1.tex", "sec1")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "capitulos", "sec1.tex"))
  })

  test("rejects empty target", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "")
    expectFail(result, "invalid_target")
  })

  test("rejects whitespace-only target", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "   \t  ")
    expectFail(result, "invalid_target")
  })

  test("rejects target containing NUL", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "evil\0.tex")
    expectFail(result, "invalid_target")
  })

  test("rejects target containing control characters", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "evil\n.tex")
    expectFail(result, "invalid_target")
  })

  test("invalid inputs return structured results and never throw", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const cases: Array<[string, string, string]> = [
      [PROJECT_ROOT, source, ""],
      [PROJECT_ROOT, source, "   "],
      [PROJECT_ROOT, source, "/abs"],
      [PROJECT_ROOT, source, "C:\\abs"],
      [PROJECT_ROOT, source, "\\\\unc\\share"],
      [PROJECT_ROOT, source, "../../escape"],
      [PROJECT_ROOT, path.join(SIBLING_ROOT, "x.tex"), "ok"],
      [PROJECT_ROOT, source, "bad\0name"],
    ]

    for (const [root, src, target] of cases) {
      let threw = false
      let result: IncludeResolution | undefined
      try {
        result = resolveLatexIncludePath(root, src, target)
      } catch {
        threw = true
      }
      expect(threw).toBe(false)
      expect(result).toBeDefined()
      expect(result!.ok).toBe(false)
    }
  })

  test("does not confuse a sibling directory with a similar prefix for the root", () => {
    // /.../project vs /.../project-malicioso — naive string prefix would be wrong
    const source = path.join(PROJECT_ROOT, "nested", "deep", "file.tex")
    const result = resolveLatexIncludePath(
      PROJECT_ROOT,
      source,
      "../../../project-malicioso/pwned",
    )
    expectFail(result, "outside_root")

    // Same-prefix sibling absolute target is still absolute_path
    const absSibling = path.join(SIBLING_ROOT, "pwned.tex")
    // On POSIX hosts absSibling starts with /; still rejected as absolute
    const absResult = resolveLatexIncludePath(PROJECT_ROOT, source, absSibling)
    expectFail(absResult, "absolute_path")
  })

  test("success path is absolute and host-normalized", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "././parts/a")
    expectOk(result)
    expect(path.isAbsolute(result.path)).toBe(true)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "parts", "a.tex"))
    // No lingering . or .. segments in the final path
    expect(result.path.split(path.sep).includes(".")).toBe(false)
    expect(result.path.split(path.sep).includes("..")).toBe(false)
  })

  test("failure messages do not embed the raw absolute project root path", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "../../escape")
    expectFail(result, "outside_root")
    expect(result.message.includes(PROJECT_ROOT)).toBe(false)
  })

  // --- Audit regressions (PR #57): untrusted separator policy + case-insensitive .tex ---

  test("rejects backslash traversal as outside_root (POSIX host must not treat \\ as literal name)", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    // Untrusted target using Windows-style separators that mean "escape root"
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "..\\..\\outside")
    expectFail(result, "outside_root")
  })

  test("rejects mixed-separator traversal that escapes the project root", () => {
    const source = path.join(PROJECT_ROOT, "nested", "deep", "file.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "../..\\../outside")
    expectFail(result, "outside_root")
  })

  test("policy: both / and \\ are directory separators on untrusted targets; in-root backslash path resolves inside root", () => {
    // Explicit policy: before resolve/relative, untrusted relative targets treat
    // both "/" and "\\" as separators (normalized), so "shared\\macros" is not a
    // single filename with backslashes. projectRoot keeps host path semantics.
    const source = path.join(PROJECT_ROOT, "capitulos", "cap1.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "..\\shared\\macros")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "shared", "macros.tex"))
    const segments = result.path.split(path.sep)
    expect(segments.includes(".")).toBe(false)
    expect(segments.includes("..")).toBe(false)
  })

  test("relative sourceFile with backslash separators is confined with the same untrusted policy", () => {
    const result = resolveLatexIncludePath(PROJECT_ROOT, "capitulos\\cap1.tex", "sec1")
    expectOk(result)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "capitulos", "sec1.tex"))
  })

  test("does not append .tex when target already ends with .TEX (case-insensitive; preserve casing)", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    const result = resolveLatexIncludePath(PROJECT_ROOT, source, "chapter.TEX")
    expectOk(result)
    expect(result.path.endsWith("chapter.TEX")).toBe(true)
    expect(result.path.endsWith("chapter.TEX.tex")).toBe(false)
    expect(result.path).toBe(path.resolve(PROJECT_ROOT, "chapter.TEX"))
  })

  test("absolute forms are still rejected before separator normalization", () => {
    const source = path.join(PROJECT_ROOT, "main.tex")
    // Drive/UNC/root-relative must remain absolute_path, not reclassified after \ → /
    expectFail(resolveLatexIncludePath(PROJECT_ROOT, source, "C:\\evil\\x.tex"), "absolute_path")
    expectFail(resolveLatexIncludePath(PROJECT_ROOT, source, "\\\\server\\share\\x.tex"), "absolute_path")
    expectFail(resolveLatexIncludePath(PROJECT_ROOT, source, "\\Windows\\evil.tex"), "absolute_path")
  })
})
