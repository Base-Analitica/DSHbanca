import path from "node:path"

/**
 * Structured result of resolving a LaTeX \input/\include target.
 * Success yields an absolute, host-normalized path inside projectRoot.
 * Failures never throw for expected invalid inputs.
 */
export type IncludeResolution =
  | {
      ok: true
      path: string
    }
  | {
      ok: false
      code: "absolute_path" | "outside_root" | "invalid_target"
      message: string
    }

/**
 * Detect absolute / drive-prefixed / UNC / root-relative targets in a
 * host-independent way (POSIX and Win32 rules, plus ambiguous drive forms).
 * Must run on the untrusted string *before* separator normalization.
 */
function isAbsoluteOrDriveTarget(target: string): boolean {
  if (path.posix.isAbsolute(target)) return true
  if (path.win32.isAbsolute(target)) return true
  // Ambiguous or host-dependent drive prefix: "C:foo", "D:bar\baz"
  if (/^[A-Za-z]:/.test(target)) return true
  return false
}

/**
 * Untrusted path policy: treat both `/` and `\` as directory separators.
 * Applied only to untrusted relative inputs (include target, relative sourceFile).
 * Never applied to host projectRoot (that would corrupt valid Windows roots).
 */
function normalizeUntrustedSeparators(p: string): string {
  return p.replace(/\\/g, "/")
}

/** True if s contains NUL or other C0/DEL control characters. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * Ensure candidate is inside root using segment-aware relative(), not a
 * naive string prefix (which confuses /project with /project-malicioso).
 */
function isLexicallyInsideRoot(resolvedRoot: string, candidate: string): boolean {
  const resolvedCandidate = path.resolve(candidate)
  const rel = path.relative(resolvedRoot, resolvedCandidate)
  if (rel === "") return true
  if (path.isAbsolute(rel)) return false
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) return false
  return true
}

/** Append .tex only when missing; match is case-insensitive and preserves caller spelling. */
function ensureTexExtension(target: string): string {
  if (/\.tex$/i.test(target)) return target
  return `${target}.tex`
}

/**
 * Resolve a LaTeX include target relative to the calling source file,
 * confined lexically to projectRoot. Does not read the filesystem.
 *
 * - target is resolved against dirname(sourceFile), never process.cwd()
 * - .tex is appended when missing (case-insensitive); existing extension text is preserved
 * - absolute POSIX/Win32/UNC/drive forms are rejected before separator normalization
 * - untrusted relative paths treat both `/` and `\` as separators
 * - .. is allowed only when the final path remains inside projectRoot
 * - sourceFile may be absolute (host path, must stay inside root) or relative to projectRoot
 */
export function resolveLatexIncludePath(
  projectRoot: string,
  sourceFile: string,
  target: string,
): IncludeResolution {
  if (typeof target !== "string" || hasControlChars(target)) {
    return {
      ok: false,
      code: "invalid_target",
      message: "include target is empty or invalid",
    }
  }

  const trimmedTarget = target.trim()
  if (trimmedTarget.length === 0) {
    return {
      ok: false,
      code: "invalid_target",
      message: "include target is empty or invalid",
    }
  }

  // Absolute / drive / UNC / root-relative: classify on the raw untrusted string
  // before any separator normalization that could re-shape the form.
  if (isAbsoluteOrDriveTarget(trimmedTarget)) {
    return {
      ok: false,
      code: "absolute_path",
      message: "include target must be a relative path",
    }
  }

  if (typeof projectRoot !== "string" || projectRoot.trim().length === 0) {
    return {
      ok: false,
      code: "invalid_target",
      message: "project root is empty or invalid",
    }
  }

  if (typeof sourceFile !== "string" || sourceFile.trim().length === 0 || hasControlChars(sourceFile)) {
    return {
      ok: false,
      code: "invalid_target",
      message: "source file path is empty or invalid",
    }
  }

  // Host path semantics for the trusted root — do not rewrite `\` on projectRoot.
  const resolvedRoot = path.resolve(projectRoot)

  const trimmedSource = sourceFile.trim()
  let resolvedSource: string

  if (path.isAbsolute(trimmedSource)) {
    // Absolute sourceFile is a host path; resolve without untrusted \ rewriting.
    resolvedSource = path.resolve(trimmedSource)
  } else {
    // Relative sourceFile is untrusted input: same separator policy as target.
    if (isAbsoluteOrDriveTarget(trimmedSource)) {
      return {
        ok: false,
        code: "absolute_path",
        message: "source file path must not be an absolute or drive path",
      }
    }
    const normalizedSource = normalizeUntrustedSeparators(trimmedSource)
    resolvedSource = path.resolve(resolvedRoot, normalizedSource)
  }

  if (!isLexicallyInsideRoot(resolvedRoot, resolvedSource)) {
    return {
      ok: false,
      code: "outside_root",
      message: "source file is outside the project root",
    }
  }

  const sourceDir = path.dirname(resolvedSource)
  const normalizedTarget = normalizeUntrustedSeparators(trimmedTarget)
  const withExt = ensureTexExtension(normalizedTarget)
  const candidate = path.resolve(sourceDir, withExt)

  if (!isLexicallyInsideRoot(resolvedRoot, candidate)) {
    return {
      ok: false,
      code: "outside_root",
      message: "resolved include path escapes the project root",
    }
  }

  return {
    ok: true,
    path: candidate,
  }
}
