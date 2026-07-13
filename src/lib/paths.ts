import { resolve, relative, sep, isAbsolute } from "node:path"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  type Dirent,
  type Stats,
} from "node:fs"
import type { ProjectConfig } from "./config"
import { resolveInsideRoot } from "./safe_paths"

export interface ResolvedPaths {
  root: string
  main: string
  bib: string
  chapters: string[]
  outputDir: string
}

export type ChapterDiscoveryDiagnosticCode =
  | "unsafe_pattern"
  | "malformed_pattern"
  | "discovery_error"

export interface ChapterDiscoveryDiagnostic {
  code: ChapterDiscoveryDiagnosticCode
  severity: "error" | "warning"
  /**
   * Pattern from config when applicable.
   * Never an absolute, drive-absolute, or UNC form (redacted on the raw string).
   */
  pattern?: string
  message: string
}

export interface ChapterDiscoveryResult {
  /** Relative POSIX paths from manuscriptRoot (never absolute). */
  matches: string[]
  diagnostics: ChapterDiscoveryDiagnostic[]
  /** False when any pattern was unsafe/malformed or filesystem discovery failed. */
  complete: boolean
}

/**
 * Thrown by {@link resolveManuscriptPaths} when chapter discovery is incomplete
 * so tools cannot treat a partial chapter list as authoritative.
 */
export class ChapterDiscoveryError extends Error {
  readonly diagnostics: ChapterDiscoveryDiagnostic[]

  constructor(message: string, diagnostics: ChapterDiscoveryDiagnostic[] = []) {
    super(message)
    this.name = "ChapterDiscoveryError"
    this.diagnostics = diagnostics
  }
}

/**
 * Echo a chapter pattern into diagnostics only when it is safe to report.
 * Absolute / drive / UNC forms are omitted entirely (checked on the RAW string).
 * Relative-unsafe forms such as `../outside.tex` may still be reported.
 */
export function safePatternForDiagnostic(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  if (isAbsoluteDriveOrUncForm(trimmed)) return undefined
  return trimmed
}

/** Injectable FS surface for discovery (tests inject failures without chmod races). */
export interface ChapterDiscoveryFs {
  readdirSync: (path: string, options: { withFileTypes: true }) => Dirent[]
  lstatSync: (path: string) => Stats
}

const defaultDiscoveryFs: ChapterDiscoveryFs = {
  readdirSync: (p, o) => readdirSync(p, o),
  lstatSync: (p) => lstatSync(p),
}

/**
 * True when the raw path string is absolute, drive-absolute, or UNC.
 * MUST be checked on the original config string BEFORE normalizePublicPath,
 * which collapses leading `/` and `//` and would turn `/etc` into `etc`.
 */
export function isAbsoluteDriveOrUncForm(raw: string): boolean {
  if (typeof raw !== "string") return true
  const trimmed = raw.trim()
  if (trimmed.length === 0) return false
  if (isAbsolute(trimmed)) return true
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return true
  if (/^[A-Za-z]:/.test(trimmed)) return true
  if (trimmed.startsWith("//") || trimmed.startsWith("\\\\")) return true
  return false
}

/**
 * Normalize a project-relative public path to a single POSIX form:
 * collapses `.`, empty segments, and redundant separators; does not resolve
 * against the filesystem. `..` segments are preserved so callers can reject them.
 *
 * Do not use this to "sanitize" absolute/UNC inputs — call
 * {@link isAbsoluteDriveOrUncForm} first and reject those.
 */
export function normalizePublicPath(p: string): string {
  if (typeof p !== "string" || p.length === 0) return ""
  const raw = toPosixPath(p).replace(/\\/g, "/")
  const parts: string[] = []
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop()
      } else {
        parts.push("..")
      }
      continue
    }
    parts.push(seg)
  }
  return parts.join("/")
}

/**
 * True when a chapter pattern must not be used for discovery.
 * Absolute paths and `..` segments are rejected; such patterns never cause reads.
 */
export function isUnsafeChapterPattern(pattern: string): boolean {
  if (typeof pattern !== "string" || pattern.trim().length === 0) return true
  const trimmed = pattern.trim()
  // Absolute / drive / UNC on the RAW string (before any normalize that strips `/`).
  if (isAbsoluteDriveOrUncForm(trimmed)) return true
  const segments = trimmed.split(/[/\\]/)
  if (segments.includes("..")) return true
  // Control characters / NUL are not valid relative patterns.
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/**
 * Collect relative POSIX paths of regular `.tex` files under `manuscriptRoot`.
 * Does not follow symbolic links (directories or files).
 * On readdir/lstat failure, records a diagnostic and marks incomplete.
 */
function collectRegularTexRelativePaths(
  manuscriptRoot: string,
  fsApi: ChapterDiscoveryFs,
  diagnostics: ChapterDiscoveryDiagnostic[],
): { files: string[]; complete: boolean } {
  const out: string[] = []
  let complete = true
  const resolvedRoot = resolve(manuscriptRoot)

  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = fsApi.readdirSync(dir, { withFileTypes: true })
    } catch {
      complete = false
      diagnostics.push({
        code: "discovery_error",
        severity: "error",
        message: "failed to read a directory while discovering chapter patterns",
      })
      return
    }
    for (const ent of entries) {
      // Prefer Dirent type bits (no extra lstat). Fall back to lstat when the
      // platform leaves type unknown (e.g. some network FS), still skipping symlinks.
      let isLink = ent.isSymbolicLink()
      let isDir = ent.isDirectory()
      let isFile = ent.isFile()
      if (!isLink && !isDir && !isFile) {
        const absUnknown = resolve(dir, ent.name)
        try {
          const st = fsApi.lstatSync(absUnknown)
          isLink = st.isSymbolicLink()
          isDir = st.isDirectory()
          isFile = st.isFile()
        } catch {
          complete = false
          diagnostics.push({
            code: "discovery_error",
            severity: "error",
            message: "failed to stat an entry while discovering chapter patterns",
          })
          continue
        }
      }
      if (isLink) continue
      const abs = resolve(dir, ent.name)
      if (isDir) {
        walk(abs)
        continue
      }
      if (!isFile) continue
      if (!ent.name.endsWith(".tex")) continue
      const rel = relative(resolvedRoot, abs)
      if (!rel || isAbsolute(rel) || rel.split(sep).includes("..")) continue
      const posix = normalizePublicPath(rel.split(sep).join("/"))
      if (posix.length === 0) continue
      out.push(posix)
    }
  }

  let rootStat: Stats
  try {
    rootStat = fsApi.lstatSync(resolvedRoot)
  } catch {
    diagnostics.push({
      code: "discovery_error",
      severity: "error",
      message: "failed to access manuscript root while discovering chapter patterns",
    })
    return { files: out, complete: false }
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    // Not an error for a missing-style root: treat as zero matches, complete.
    // (resolveManuscriptPaths historically returned [] when chapters dir absent.)
    // If root exists but is not a directory, discovery cannot proceed fully.
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      diagnostics.push({
        code: "discovery_error",
        severity: "error",
        message: "manuscript root is not a regular directory for chapter discovery",
      })
      return { files: out, complete: false }
    }
  }
  walk(resolvedRoot)
  return { files: out, complete }
}

/**
 * Resolve `manuscript.chapters` patterns under the manuscript root.
 *
 * Policy:
 * 1. Patterns processed in configuration order.
 * 2. Matches for each pattern sorted lexicographically by relative POSIX path.
 * 3. First occurrence wins across patterns.
 * 4. Empty pattern list → zero results, complete.
 * 5. Pattern with no matches is not an error.
 * 6. Only regular `.tex` files.
 * 7. Symlinks (files or dirs) are not followed.
 * 8. Absolute / traversal patterns are rejected with diagnostics (never read).
 * 9. Malformed patterns / non-array config / discovery I/O failures → complete: false.
 *
 * Returns relative POSIX paths from `manuscriptRoot` (never absolute).
 * Diagnostics never echo absolute/drive/UNC pattern forms.
 */
export function resolveChapterPatternMatches(
  manuscriptRoot: string,
  patterns: unknown,
  options?: { fs?: ChapterDiscoveryFs },
): ChapterDiscoveryResult {
  const diagnostics: ChapterDiscoveryDiagnostic[] = []

  // Non-array chapters is malformed config, not a successful empty discovery.
  if (patterns === undefined || patterns === null) {
    // Treat missing as empty list (callers that omit chapters intentionally).
    return { matches: [], diagnostics, complete: true }
  }
  if (!Array.isArray(patterns)) {
    return {
      matches: [],
      diagnostics: [
        {
          code: "malformed_pattern",
          severity: "error",
          message: "manuscript.chapters must be an array of pattern strings",
        },
      ],
      complete: false,
    }
  }
  if (patterns.length === 0) {
    return { matches: [], diagnostics, complete: true }
  }

  const fsApi = options?.fs ?? defaultDiscoveryFs
  const collected = collectRegularTexRelativePaths(manuscriptRoot, fsApi, diagnostics)
  let complete = collected.complete
  const allTex = collected.files
  const seen = new Set<string>()
  const ordered: string[] = []

  for (const raw of patterns) {
    if (typeof raw !== "string") {
      complete = false
      diagnostics.push({
        code: "malformed_pattern",
        severity: "error",
        message: "chapter pattern must be a string",
      })
      continue
    }
    if (isUnsafeChapterPattern(raw)) {
      complete = false
      diagnostics.push({
        code: "unsafe_pattern",
        severity: "error",
        // Never echo absolute/drive/UNC forms (use platform-independent detector).
        pattern: safePatternForDiagnostic(raw),
        message: "chapter pattern is absolute, empty, contains traversal, or control characters",
      })
      continue
    }
    const pattern = raw.trim().replace(/\\/g, "/")
    const re = tryGlobToRegex(pattern)
    if (!re) {
      complete = false
      diagnostics.push({
        code: "malformed_pattern",
        severity: "error",
        pattern: safePatternForDiagnostic(pattern),
        message: "chapter pattern could not be compiled as a glob",
      })
      continue
    }
    const matches = allTex
      .filter((rel) => re.test(rel))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    for (const rel of matches) {
      if (seen.has(rel)) continue
      seen.add(rel)
      ordered.push(rel)
    }
  }

  return { matches: ordered, diagnostics, complete }
}

/**
 * Resolve manuscript paths for tools.
 * On incomplete chapter discovery (unsafe/malformed patterns, I/O failure),
 * throws {@link ChapterDiscoveryError} instead of returning a partial chapter
 * list that could be saved as authoritative context.
 */
export function resolveManuscriptPaths(projectRoot: string, config: ProjectConfig): ResolvedPaths {
  const root = resolveInsideRoot(projectRoot, config.manuscript.root)
  const main = resolveInsideRoot(root, config.manuscript.main)
  const bib = resolveInsideRoot(root, config.manuscript.bib)
  const discovery = resolveChapterPatternMatches(root, config.manuscript.chapters)
  if (!discovery.complete) {
    throw new ChapterDiscoveryError(
      "chapter pattern discovery is incomplete; refusing partial chapter list",
      discovery.diagnostics,
    )
  }
  const chapters = discovery.matches.map((rel) => resolveInsideRoot(root, rel))
  const outputDir = resolveInsideRoot(projectRoot, config.manuscript.outputDir)
  return { root, main, bib, chapters, outputDir }
}

/**
 * Compile a glob pattern to a RegExp.
 * Only `*` and `**` are wildcards; all other characters (including regex
 * metacharacters) are matched literally.
 * Returns null when the pattern cannot be compiled (should be rare after escaping).
 */
export function tryGlobToRegex(pattern: string): RegExp | null {
  try {
    return globToRegex(pattern)
  } catch {
    return null
  }
}

export function globToRegex(pattern: string): RegExp {
  let s = "^"
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
      s += "(.*/)?"
      i += 3
    } else if (c === "*" && pattern[i + 1] === "*") {
      s += ".*"
      i += 2
    } else if (c === "*") {
      s += "[^/]*"
      i += 1
    } else {
      // Literal character: escape regex metacharacters so names like
      // `file[1].tex` or `a+b.tex` match as plain strings.
      if (/[\\^$+.()|[\]{}?]/.test(c)) {
        s += "\\" + c
      } else {
        s += c
      }
      i += 1
    }
  }
  s += "$"
  return new RegExp(s)
}

export function toPosixPath(p: string): string {
  return p.replace(/[/\\]+/g, "/")
}

export function isPathProtected(filePath: string, config: ProjectConfig): boolean {
  const normalized = toPosixPath(filePath)
  for (const pattern of config.protectedPaths) {
    const re = tryGlobToRegex(pattern)
    if (re && re.test(normalized)) return true
  }
  return false
}

export function isPathAllowed(filePath: string, config: ProjectConfig): boolean {
  const normalized = toPosixPath(filePath)
  for (const pattern of config.allowedPaths) {
    const re = tryGlobToRegex(pattern)
    if (re && re.test(normalized)) return true
  }
  return false
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
