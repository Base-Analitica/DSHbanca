import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { ProjectConfig } from "./config"
import {
  isAbsoluteDriveOrUncForm,
  normalizePublicPath,
  resolveChapterPatternMatches,
  safePatternForDiagnostic,
  toPosixPath,
  type ChapterDiscoveryFs,
} from "./paths"
import { parseLatexIncludes } from "./latex_parser"
import { resolveLatexIncludePath } from "./latex_include_resolver"

/** Explicit fingerprint schema version; included in the hash input. */
export const MANUSCRIPT_FINGERPRINT_VERSION = "openbanca-manuscript-v1"

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
  | "chapter_pattern_rejected"
  | "chapter_pattern_malformed"
  | "chapter_discovery_error"

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
  /**
   * Injectable filesystem for chapter-pattern discovery (canonical load only).
   * Used to prove discovery I/O failures mark the result incomplete.
   */
  chapterDiscoveryFs?: ChapterDiscoveryFs
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

/** Public path: relative to projectRoot, POSIX separators, never absolute, normalized. */
function toPublicPath(resolvedRoot: string, absolutePath: string): string {
  const rel = path.relative(resolvedRoot, path.resolve(absolutePath))
  return normalizePublicPath(rel.split(path.sep).join("/"))
}

/** Empty visit marker so empty / include-only files participate in order and fingerprint. */
function emptyFileMarker(publicFile: string): SourceSpan {
  return { file: publicFile, startLine: 1, endLine: 1, text: "" }
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
    // Index where this file's expansion begins — used to place empty/include-only markers.
    const expansionStart = orderedSources.length

    if (directives.length === 0) {
      const span = spanForSlice(publicPath, content, lineStarts, 0, content.length)
      if (span) {
        orderedSources.push(span)
      } else {
        // Empty file (or zero-length content): still a visited source for order/fingerprint/dedup.
        orderedSources.push(emptyFileMarker(publicPath))
      }
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

    // Include-only (or otherwise text-free) shell: ensure this visit contributes a marker
    // at the start of the expansion so order/fingerprint/dedup see the file.
    const ownSpan = orderedSources
      .slice(expansionStart)
      .some((s) => s.file === publicPath)
    if (!ownSpan) {
      orderedSources.splice(expansionStart, 0, emptyFileMarker(publicPath))
    }
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

export interface CanonicalLatexManuscriptResult extends TraversalResult {
  fingerprint: string | null
  fingerprintVersion: string
}

/**
 * Join manuscript.root + a path relative to the manuscript root into a
 * project-root-relative POSIX path suitable for loadLatexManuscript.
 * Always normalized (no leading `./`, collapsed `.` segments).
 *
 * Returns null when root or relative part is absolute/UNC/drive or contains `..`
 * after normalization — never collapses `/etc` into a project-relative `etc/…`.
 */
function toProjectRelativePath(
  manuscriptRootConfig: string,
  relInsideManuscript: string,
): string | null {
  const rootRaw = String(manuscriptRootConfig ?? ".").trim() || "."
  const relRaw = String(relInsideManuscript ?? "").trim()

  // Reject absolute/drive/UNC on the RAW strings before normalizePublicPath.
  if (isAbsoluteDriveOrUncForm(rootRaw)) return null
  if (relRaw.length > 0 && isAbsoluteDriveOrUncForm(relRaw)) return null

  const mr = normalizePublicPath(rootRaw)
  const rel = normalizePublicPath(relRaw)
  if (mr.split("/").includes("..")) return null
  if (rel.split("/").includes("..")) return null

  if (!mr) return rel
  if (!rel) return mr
  return normalizePublicPath(`${mr}/${rel}`)
}

/**
 * SHA-256 over the canonical source representation.
 *
 * Framing (unambiguous, length-prefixed; no fragile separators):
 *   uint32be(versionLen) | versionUtf8
 *   for each SourceSpan in order:
 *     uint32be(pathLen) | pathUtf8 | uint32be(startLine) | uint32be(endLine)
 *     | uint32be(textLen) | textUtf8
 *
 * Empty spans (text length 0) still contribute path + line bounds so empty
 * and include-only visits alter the fingerprint.
 *
 * Does not include projectRoot, absolute paths, timestamps, or VM data.
 */
export function computeManuscriptFingerprint(
  orderedSources: SourceSpan[],
  version: string = MANUSCRIPT_FINGERPRINT_VERSION,
): string {
  const hash = createHash("sha256")
  const u32 = Buffer.allocUnsafe(4)

  const writeU32 = (n: number): void => {
    u32.writeUInt32BE(n >>> 0, 0)
    hash.update(u32)
  }

  const writeString = (str: string): void => {
    const len = Buffer.byteLength(str, "utf8")
    writeU32(len)
    if (len > 0) hash.update(str, "utf8")
  }

  writeString(version)

  for (const span of orderedSources) {
    writeString(span.file)
    writeU32(span.startLine)
    writeU32(span.endLine)
    writeString(span.text)
  }

  return hash.digest("hex")
}

function mapDiscoveryCode(
  code: "unsafe_pattern" | "malformed_pattern" | "discovery_error",
): LoaderDiagnosticCode {
  if (code === "unsafe_pattern") return "chapter_pattern_rejected"
  if (code === "malformed_pattern") return "chapter_pattern_malformed"
  return "chapter_discovery_error"
}

/**
 * Canonical manuscript representation: main-graph traversal from config,
 * then complementary chapters from `manuscript.chapters`, with complementary
 * deduplication only, plus a deterministic content+order fingerprint.
 *
 * Does not alter `loadLatexManuscript` include-expansion / cycle semantics
 * (repeated includes in the main graph still expand; cycles remain stack-based).
 * Empty and include-only files emit visit markers so they participate in order,
 * fingerprint, and complementary deduplication.
 */
export function loadCanonicalLatexManuscript(
  projectRoot: string,
  config: ProjectConfig,
  options?: LoadLatexOptions,
): CanonicalLatexManuscriptResult {
  const fingerprintVersion = MANUSCRIPT_FINGERPRINT_VERSION

  // Fail closed on absolute/UNC/drive manuscript.root or main BEFORE normalizePublicPath
  // can turn `/etc` into a project-relative `etc/...` shadow path.
  const mainRel = toProjectRelativePath(config.manuscript.root, config.manuscript.main)
  if (mainRel === null) {
    return {
      rootFile: SAFE_PUBLIC_ROOT,
      orderedSources: [],
      diagnostics: [
        {
          code: "chapter_pattern_rejected",
          severity: "error",
          message: "manuscript.root or manuscript.main is absolute, UNC, drive-absolute, or escapes the project root",
        },
      ],
      complete: false,
      fingerprint: null,
      fingerprintVersion,
    }
  }

  const mainResult = loadLatexManuscript(projectRoot, mainRel, options)

  const orderedSources: SourceSpan[] = mainResult.orderedSources.map((s) => ({
    ...s,
    file: normalizePublicPath(s.file),
  }))
  const diagnostics: LoaderDiagnostic[] = [...mainResult.diagnostics]
  let complete = mainResult.complete

  // Paths already present (normalized public POSIX), including empty visit markers.
  const present = new Set<string>(orderedSources.map((s) => s.file))
  if (mainResult.rootFile) {
    present.add(normalizePublicPath(mainResult.rootFile))
  }

  // Resolve chapter patterns under the manuscript root (absolute for FS walk).
  // Discovery only runs when manuscript.root is a safe relative path inside projectRoot.
  let complementRels: string[] = []
  const rootRaw = String(config.manuscript.root ?? ".").trim() || "."
  if (typeof projectRoot === "string" && projectRoot.trim().length > 0) {
    const resolvedProject = path.resolve(projectRoot.trim())
    // Absolute/UNC on RAW root (already rejected above via mainRel, but keep explicit).
    if (isAbsoluteDriveOrUncForm(rootRaw) || normalizePublicPath(rootRaw).split("/").includes("..")) {
      complete = false
      diagnostics.push({
        code: "chapter_pattern_rejected",
        severity: "error",
        message: "manuscript.root is absolute or escapes the project root",
      })
    } else {
      const mrNorm = normalizePublicPath(rootRaw)
      const manuscriptRootAbs = path.resolve(resolvedProject, mrNorm === "" ? "." : mrNorm)
      const relToProject = path.relative(resolvedProject, manuscriptRootAbs)
      const escapes =
        path.isAbsolute(relToProject) ||
        relToProject === ".." ||
        relToProject.startsWith(`..${path.sep}`)
      if (escapes) {
        complete = false
        diagnostics.push({
          code: "chapter_discovery_error",
          severity: "error",
          message: "manuscript.root escapes the project root",
        })
      } else {
        const discovery = resolveChapterPatternMatches(
          manuscriptRootAbs,
          config.manuscript.chapters ?? [],
          options?.chapterDiscoveryFs ? { fs: options.chapterDiscoveryFs } : undefined,
        )
        for (const d of discovery.diagnostics) {
          diagnostics.push({
            code: mapDiscoveryCode(d.code),
            severity: d.severity,
            // Re-apply redaction so absolute/drive/UNC never appear in target.
            target: safePatternForDiagnostic(d.pattern),
            message: d.message,
          })
        }
        if (!discovery.complete) {
          complete = false
        }
        complementRels = discovery.matches
      }
    }
  } else if ((config.manuscript.chapters ?? []).length > 0) {
    // Cannot discover complements without a valid project root.
    complete = false
    diagnostics.push({
      code: "chapter_discovery_error",
      severity: "error",
      message: "cannot discover chapter patterns without a valid project root",
    })
  }

  for (const relInsideManuscript of complementRels) {
    const complementPublic = toProjectRelativePath(config.manuscript.root, relInsideManuscript)
    if (complementPublic === null) {
      complete = false
      diagnostics.push({
        code: "chapter_pattern_rejected",
        severity: "error",
        message: "complementary chapter path is absolute or escapes the project root",
      })
      continue
    }

    // Skip complementary root already reached by the main graph (or earlier complements).
    if (present.has(complementPublic)) {
      continue
    }

    const snapshotPresent = new Set(present)
    const compResult = loadLatexManuscript(projectRoot, complementPublic, options)
    diagnostics.push(...compResult.diagnostics)
    if (!compResult.complete) {
      complete = false
    }

    // Merge: drop spans whose public path already existed before this complement;
    // preserve internal repeats of *new* files within this complement traversal.
    for (const span of compResult.orderedSources) {
      const file = normalizePublicPath(span.file)
      if (snapshotPresent.has(file)) continue
      orderedSources.push({ ...span, file })
      present.add(file)
    }
    if (compResult.rootFile) {
      present.add(normalizePublicPath(compResult.rootFile))
    }
  }

  const fingerprint = complete ? computeManuscriptFingerprint(orderedSources, fingerprintVersion) : null

  return {
    rootFile: normalizePublicPath(mainResult.rootFile),
    orderedSources,
    diagnostics,
    complete,
    fingerprint,
    fingerprintVersion,
  }
}
