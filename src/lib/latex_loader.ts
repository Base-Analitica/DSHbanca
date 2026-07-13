import { readFileSync } from "node:fs"
import path from "node:path"
import { parseLatexIncludes } from "./latex_parser"
import { resolveLatexIncludePath } from "./latex_include_resolver"

export interface SourceSpan {
  file: string
  startLine: number
  endLine: number
  text: string
}

export type LoaderDiagnosticCode =
  | "root_not_found"
  | "include_not_found"
  | "include_cycle"
  | "include_rejected"
  | "read_error"

export interface LoaderDiagnostic {
  code: LoaderDiagnosticCode
  severity: "warning" | "error"
  file?: string
  line?: number
  target?: string
  message: string
}

export interface TraversalResult {
  rootFile: string
  orderedSources: SourceSpan[]
  diagnostics: LoaderDiagnostic[]
  complete: boolean
}

export interface LoadLatexOptions {
  /**
   * Injectable file reader. Receives an absolute host path.
   * Defaults to UTF-8 filesystem read. Used to prove rejected targets are never read.
   */
  readFile?: (absolutePath: string) => string
}

/** Safe public root when input is invalid — never absolute, never contains `..`. */
const SAFE_PUBLIC_ROOT = ""

function isLexicallyInsideRoot(resolvedRoot: string, candidate: string): boolean {
  const resolvedCandidate = path.resolve(candidate)
  const rel = path.relative(resolvedRoot, resolvedCandidate)
  if (rel === "") return true
  if (path.isAbsolute(rel)) return false
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) return false
  return true
}

/** Public path: relative to projectRoot, POSIX separators, never absolute. */
function toPublicPath(resolvedRoot: string, absolutePath: string): string {
  const rel = path.relative(resolvedRoot, path.resolve(absolutePath))
  return rel.split(path.sep).join("/")
}

/**
 * Absolute target / drive / UNC / root-relative forms on the untrusted string
 * (same policy surface as the include resolver, applied before normalization).
 */
function isAbsoluteOrDriveTarget(target: string): boolean {
  if (path.posix.isAbsolute(target)) return true
  if (path.win32.isAbsolute(target)) return true
  if (/^[A-Za-z]:/.test(target)) return true
  return false
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * Build once-per-content array of character offsets where each line starts.
 * lineStarts[0] === 0; line n (1-based) starts at lineStarts[n - 1].
 */
function buildLineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      starts.push(i + 1)
    }
  }
  return starts
}

/**
 * Map a character offset to a 1-based line number using precomputed line starts.
 * Binary search: largest lineStarts[i] <= offset.
 */
function offsetToLine(lineStarts: number[], offset: number): number {
  if (offset <= 0) return 1
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lineStarts[mid] <= offset) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // hi is the last index with lineStarts[hi] <= offset
  return hi + 1
}

function spanForSlice(
  publicFile: string,
  content: string,
  lineStarts: number[],
  start: number,
  end: number,
): SourceSpan | null {
  if (end <= start) return null
  const text = content.slice(start, end)
  if (text.length === 0) return null
  const startLine = offsetToLine(lineStarts, start)
  // Last character of the slice determines endLine.
  const endLine = offsetToLine(lineStarts, end - 1)
  return { file: publicFile, startLine, endLine, text }
}

function defaultReadFile(absolutePath: string): string {
  return readFileSync(absolutePath, "utf8")
}

function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: string }).code
    return code === "ENOENT" || code === "ENOTDIR"
  }
  return false
}

function incompleteRootResult(
  diagnostics: LoaderDiagnostic[],
  message: string,
  code: LoaderDiagnosticCode = "root_not_found",
): TraversalResult {
  return {
    rootFile: SAFE_PUBLIC_ROOT,
    orderedSources: [],
    diagnostics: [
      ...diagnostics,
      {
        code,
        severity: "error",
        message,
      },
    ],
    complete: false,
  }
}

/**
 * Traverse a LaTeX manuscript from the root file, expanding \input/\include
 * in document order via the shared parser and include-path resolver.
 *
 * Public paths are always relative to projectRoot with POSIX separators.
 * Cycle detection uses the active recursion stack (not a global visited set),
 * so repeated includes without a cycle expand at each occurrence.
 */
export function loadLatexManuscript(
  projectRoot: string,
  rootFile: string,
  options?: LoadLatexOptions,
): TraversalResult {
  const readFile = options?.readFile ?? defaultReadFile
  const orderedSources: SourceSpan[] = []
  const diagnostics: LoaderDiagnostic[] = []
  let complete = true

  const markIncomplete = (): void => {
    complete = false
  }

  // --- Validate projectRoot before any resolve / normalize / read ---
  if (typeof projectRoot !== "string" || projectRoot.trim().length === 0 || hasControlChars(projectRoot)) {
    return incompleteRootResult(
      diagnostics,
      "project root is empty or invalid",
    )
  }

  // --- Validate rootFile before any resolve / split / read ---
  if (typeof rootFile !== "string" || rootFile.trim().length === 0 || hasControlChars(rootFile)) {
    return incompleteRootResult(
      diagnostics,
      "root file path is empty or invalid",
    )
  }

  const trimmedRoot = rootFile.trim()
  // Reject absolute / drive / UNC forms before separator normalization.
  if (isAbsoluteOrDriveTarget(trimmedRoot)) {
    return incompleteRootResult(
      diagnostics,
      "root file must be a path relative to the project root",
    )
  }

  const resolvedRoot = path.resolve(projectRoot.trim())
  const normalizedRootRel = trimmedRoot.replace(/\\/g, "/")
  const rootAbs = path.resolve(resolvedRoot, normalizedRootRel)

  if (!isLexicallyInsideRoot(resolvedRoot, rootAbs)) {
    return incompleteRootResult(
      diagnostics,
      "root file path escapes the project root",
    )
  }

  const rootPublic = toPublicPath(resolvedRoot, rootAbs)
  // Defensive: public path must never be absolute or contain `..` segments.
  if (
    rootPublic.length === 0 ||
    path.posix.isAbsolute(rootPublic) ||
    path.win32.isAbsolute(rootPublic) ||
    rootPublic.split("/").includes("..")
  ) {
    return incompleteRootResult(
      diagnostics,
      "root file path escapes the project root",
    )
  }

  // Active recursion stack keyed by absolute path identity (for cycles only).
  const activeStack = new Set<string>()

  /**
   * Read and expand one file. Propagates all read failures (including ENOENT
   * and I/O errors) so the single classification layer at the call site can
   * attach root vs include-caller provenance.
   */
  const processFile = (absolutePath: string, publicPath: string): void => {
    const content = readFile(absolutePath)
    const lineStarts = buildLineStarts(content)
    const directives = parseLatexIncludes(publicPath, content)

    if (directives.length === 0) {
      const span = spanForSlice(publicPath, content, lineStarts, 0, content.length)
      if (span) orderedSources.push(span)
      return
    }

    let cursor = 0
    for (const directive of directives) {
      const before = spanForSlice(publicPath, content, lineStarts, cursor, directive.startOffset)
      if (before) orderedSources.push(before)

      const resolution = resolveLatexIncludePath(resolvedRoot, absolutePath, directive.target)
      if (!resolution.ok) {
        markIncomplete()
        diagnostics.push({
          code: "include_rejected",
          severity: "error",
          file: publicPath,
          line: directive.line,
          target: directive.target,
          message: `include target rejected (${resolution.code}): ${resolution.message}`,
        })
        cursor = directive.endOffset
        continue
      }

      const childAbs = resolution.path
      const childPublic = toPublicPath(resolvedRoot, childAbs)

      if (activeStack.has(childAbs)) {
        markIncomplete()
        diagnostics.push({
          code: "include_cycle",
          severity: "error",
          file: publicPath,
          line: directive.line,
          target: directive.target,
          message: `include cycle detected while expanding '${directive.target}'`,
        })
        cursor = directive.endOffset
        continue
      }

      activeStack.add(childAbs)
      try {
        try {
          processFile(childAbs, childPublic)
        } catch (err) {
          // Single classification layer for include reads: attach caller provenance.
          if (isNotFoundError(err)) {
            markIncomplete()
            diagnostics.push({
              code: "include_not_found",
              severity: "error",
              file: publicPath,
              line: directive.line,
              target: directive.target,
              message: `include file not found: ${directive.target}`,
            })
          } else {
            markIncomplete()
            diagnostics.push({
              code: "read_error",
              severity: "error",
              file: publicPath,
              line: directive.line,
              target: directive.target,
              message: "failed to read included LaTeX source file",
            })
          }
          // Continue remaining includes when safe.
        }
      } finally {
        activeStack.delete(childAbs)
      }

      cursor = directive.endOffset
    }

    const after = spanForSlice(publicPath, content, lineStarts, cursor, content.length)
    if (after) orderedSources.push(after)
  }

  activeStack.add(rootAbs)
  try {
    try {
      processFile(rootAbs, rootPublic)
    } catch (err) {
      // Single classification layer for the root file.
      if (isNotFoundError(err)) {
        markIncomplete()
        diagnostics.push({
          code: "root_not_found",
          severity: "error",
          file: rootPublic,
          message: "root LaTeX file not found",
        })
      } else {
        markIncomplete()
        diagnostics.push({
          code: "read_error",
          severity: "error",
          file: rootPublic,
          message: "failed to read root LaTeX source file",
        })
      }
    }
  } finally {
    activeStack.delete(rootAbs)
  }

  return {
    rootFile: rootPublic,
    orderedSources,
    diagnostics,
    complete,
  }
}
