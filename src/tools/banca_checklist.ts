import { lstatSync, readFileSync, type Stats } from "node:fs"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig, type ProjectConfig } from "../lib/config"
import { resolveManuscriptPaths, type ResolvedPaths } from "../lib/paths"
import { PathTraversalError, resolveInsideRoot, resolveRealInsideRoot } from "../lib/safe_paths"

/**
 * Lexical observation of one fixed structural LaTeX marker in the configured
 * main file (issue #169). Recognition is intentionally shallow: it only
 * distinguishes real control words outside unescaped `%` comments from
 * look-alikes such as commented commands or longer command names with the same
 * prefix. It does not expand macros, interpret verbatim/literal environments or
 * custom catcodes, follow includes, or validate the manuscript structure.
 *
 * `line` is the 1-based line of the first genuine occurrence actually found in
 * the scanned text (computed from the real offset, never invented); it is null
 * when the marker was not observed. A non-observation is scoped to the main
 * file: it does not establish absence from the whole work, because includes,
 * macros and other files are not read.
 */
interface StructuralMarkerObservation {
  observed: boolean
  line: number | null
}

interface StructuralMarkers {
  documentclass: StructuralMarkerObservation
  /** `\begin{abstract}` (with normal TeX trivia before the argument) or `\resumo`. */
  abstract: StructuralMarkerObservation
  tableofcontents: StructuralMarkerObservation
}

/** Fixed marker presentation order: evidence key plus the historical label. */
const MARKER_ENTRIES: ReadonlyArray<{ key: keyof StructuralMarkers; label: string }> = [
  { key: "documentclass", label: "documentclass" },
  { key: "abstract", label: "abstract/resumo" },
  { key: "tableofcontents", label: "toc" },
]

/** ASCII letters, the characters a TeX control word is made of. */
function isControlWordLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z")
}

/** Unescaped TeX whitespace, including the line breaks TeX skips after a control word. */
function isTexWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f" ||
    char === "\v"
  )
}

/**
 * Skip normal TeX trivia between a control word and its argument: whitespace
 * and unescaped `%` comments, which end at the line break. Escaped `\%` is not
 * trivia and is left for the caller, because the backslash pair is consumed
 * while scanning.
 */
function skipTrivia(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (isTexWhitespace(char)) {
      index += 1
      continue
    }
    if (char === "%") {
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }
    break
  }
  return index
}

/** 1-based line of a real offset in the scanned text (`\n` delimits; CR is trivia). */
function lineAtOffset(text: string, offset: number): number {
  let line = 1
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === "\n") line += 1
  }
  return line
}

/**
 * Record the first genuine occurrence of a marker together with the line where
 * it really appears in the scanned text. Later occurrences never overwrite the
 * provenance of the first one.
 */
function observeMarker(
  markers: StructuralMarkers,
  key: keyof StructuralMarkers,
  text: string,
  offset: number,
): void {
  if (markers[key].observed) return
  markers[key] = { observed: true, line: lineAtOffset(text, offset) }
}

function notObserved(): StructuralMarkerObservation {
  return { observed: false, line: null }
}

/**
 * Scan LaTeX source for the three structural markers, single-pass and lexical.
 *
 * The scan honors the normal lexical role of a backslash: it starts either a
 * control word (a maximal run of ASCII letters) or a control symbol (exactly one
 * following character). That makes `\%` a literal percent sign instead of a
 * comment, `\\` a line break instead of a dangling command introducer, and
 * `\tableofcontentsFake` a different control word from `\tableofcontents`.
 * An unescaped `%` starts a comment up to the end of the line, so a command
 * written inside a comment is not a marker. CRLF line endings need no special
 * case: `\r` is skipped as trivia and the comment ends at `\n`.
 *
 * Deliberately unsupported: macro expansion, `\input`/`\include` following,
 * verbatim/literal environments, custom catcodes, conditionals, and any
 * syntactic validation beyond these lexical forms.
 */
function scanStructuralMarkers(text: string): StructuralMarkers {
  const markers: StructuralMarkers = {
    documentclass: notObserved(),
    abstract: notObserved(),
    tableofcontents: notObserved(),
  }

  let index = 0
  while (index < text.length) {
    const char = text[index]

    if (char === "%") {
      // Unescaped percent: the comment runs to the end of the line.
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }

    if (char !== "\\") {
      index += 1
      continue
    }

    const next = index + 1
    if (next >= text.length) break

    // Control symbol (`\%`, `\\`, `\{`, `\ `...): the backslash consumes
    // exactly one following character, never a command name.
    if (!isControlWordLetter(text[next])) {
      index = next + 1
      continue
    }

    // Control word: maximal run of ASCII letters.
    let wordEnd = next
    while (wordEnd < text.length && isControlWordLetter(text[wordEnd])) wordEnd += 1
    const name = text.slice(next, wordEnd)

    if (name === "documentclass") {
      observeMarker(markers, "documentclass", text, index)
    } else if (name === "tableofcontents") {
      observeMarker(markers, "tableofcontents", text, index)
    } else if (name === "resumo") {
      observeMarker(markers, "abstract", text, index)
    } else if (name === "begin" && !markers.abstract.observed) {
      // `\begin{abstract}` is the environment alternative of the abstract
      // check. The environment name is matched exactly as `{abstract}`; normal
      // trivia (spaces/comments) may separate the command from its argument.
      const argument = skipTrivia(text, wordEnd)
      if (text.startsWith("{abstract}", argument)) observeMarker(markers, "abstract", text, index)
    }

    index = wordEnd
  }

  return markers
}

/**
 * Canonical read confinement for issue #132.
 *
 * `resolveManuscriptPaths` is lexical: `existsSync`/`readFileSync` would follow
 * a symbolic link planted at the configured main/bibliographic path (or in an
 * ancestor directory) and read bytes from outside the workspace. Before any
 * existence signal or read, every configured destination is re-resolved with
 * the existing canonical helper `resolveRealInsideRoot`, rooted at the project
 * workspace — never at the configured root's own target, so a redirected
 * `manuscript.root` cannot become a new implicitly authorized root.
 *
 * A residual TOCTOU window remains between the canonical inspection and the
 * read: the guarantee holds for a filesystem that is not concurrently mutated
 * by another process. This is a read-boundary check on the configured paths,
 * not a sandbox, permission engine or host trust-model change.
 *
 * Diagnostics are sanitized too (issue #132 R1): the lexical refusals that the
 * shared resolver raises with raw configured values, and the expected
 * filesystem failures of the real read, are rethrown as fixed controlled
 * messages without the absolute path, raw system message or cause.
 */
type ConfiguredFileInspection =
  | { status: "present"; canonicalPath: string }
  | { status: "missing" }

function blockedDestination(label: string, detail: string): PathTraversalError {
  // Fixed, sanitized messages: never echo the configured value, an absolute
  // host path or any external content.
  return new PathTraversalError(`banca_checklist refused the configured ${label}: ${detail}`)
}

/**
 * Normalize the lexical refusals of `resolveManuscriptPaths` that propagate the
 * raw configured value (absolute paths and `..` segments in main/bib/outputDir).
 * The shared resolver is not modified: only its controlled PathTraversalError is
 * rethrown with a fixed sanitized message. Every other error keeps its own
 * contract — notably ChapterDiscoveryError and its safe diagnostics.
 */
function resolveManuscriptPathsSanitized(projectRoot: string, config: ProjectConfig): ResolvedPaths {
  try {
    return resolveManuscriptPaths(projectRoot, config)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw blockedDestination(
        "manuscript paths",
        "a configured manuscript path is not a safe workspace-relative path",
      )
    }
    throw err
  }
}

/**
 * Filesystem errno values that are expected failures of reading an already
 * inspected destination. They become a controlled sanitized refusal; unexpected
 * errors (including programming defects) are rethrown unchanged.
 */
const EXPECTED_READ_FAILURE_CODES = new Set([
  "EACCES",
  "EPERM",
  "ENOENT",
  "EISDIR",
  "ELOOP",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENAMETOOLONG",
  "ESTALE",
])

/**
 * Read the canonical main file. A verified-present regular file that can no
 * longer be read (for example EACCES, or ENOENT after a concurrent change) is a
 * controlled failure: it is never reported as absent, as a partial checklist or
 * as success, and the raw system message/path is not exposed.
 */
function readConfiguredMainFile(canonicalPath: string): string {
  try {
    return readFileSync(canonicalPath, "utf-8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (typeof code === "string" && EXPECTED_READ_FAILURE_CODES.has(code)) {
      throw blockedDestination("main file", "the verified destination could not be read")
    }
    throw err
  }
}

/**
 * Validate the configured manuscript root physically before chapter discovery
 * touches the filesystem. Missing roots keep their existing discovery
 * behavior; redirects outside the workspace fail closed.
 */
function assertManuscriptRootConfined(workspaceRoot: string, configuredRoot: string): void {
  let lexicalRoot: string
  try {
    lexicalRoot = resolveInsideRoot(workspaceRoot, configuredRoot)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw blockedDestination("manuscript root", "the configured path is not a safe workspace-relative path")
    }
    throw err
  }
  try {
    resolveRealInsideRoot(workspaceRoot, lexicalRoot)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw blockedDestination(
        "manuscript root",
        "the physical destination is outside the workspace or follows an unsafe link",
      )
    }
    throw err
  }
}

/**
 * Resolve one configured manuscript file to its canonical destination and
 * report only whether it is a present regular file. Missing leaves stay
 * missing (legitimate absent file); external, broken-link, ancestor-link,
 * unreadable and non-regular destinations fail closed before `readFileSync`.
 */
function inspectConfiguredFile(
  workspaceRoot: string,
  configuredPath: string,
  label: string,
): ConfiguredFileInspection {
  let canonicalPath: string
  try {
    canonicalPath = resolveRealInsideRoot(workspaceRoot, configuredPath)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw blockedDestination(
        label,
        "the physical destination is outside the workspace or follows an unsafe link",
      )
    }
    throw err
  }
  let stat: Stats
  try {
    stat = lstatSync(canonicalPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing" }
    throw blockedDestination(label, "the destination cannot be inspected")
  }
  // Directories, FIFOs, sockets and devices are never opened: a blocking read
  // on a FIFO would hang the tool, and only regular files have manuscript bytes.
  if (!stat.isFile()) {
    throw blockedDestination(label, "the destination is not a regular file")
  }
  return { status: "present", canonicalPath }
}

export const bancaChecklist = defineBancaTool({
  description: "Verify delivery checklist.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    // Canonical boundary first: a redirected manuscript root must not become an
    // implicitly authorized root for discovery or reads.
    assertManuscriptRootConfined(root, config.manuscript.root)
    const paths = resolveManuscriptPathsSanitized(root, config)
    // Inspect both configured destinations before reading the main file or
    // emitting any existence/main-content signal.
    const main = inspectConfiguredFile(root, paths.main, "main file")
    const bib = inspectConfiguredFile(root, paths.bib, "bibliography file")

    const fileChecks: Array<{ item: string; ok: boolean }> = [
      { item: "Main file", ok: main.status === "present" },
      { item: "Bib file", ok: bib.status === "present" },
      { item: "Chapters", ok: paths.chapters.length > 0 },
    ]

    // Structural evidence is main-only by design (issue #169): includes are not
    // followed, macros are not expanded, and files discovered by
    // `paths.chapters` are not read as structural evidence.
    const markers: StructuralMarkers | null =
      main.status === "present"
        ? scanStructuralMarkers(readConfiguredMainFile(main.canonicalPath))
        : null

    const markerChecks: Array<{ item: string; ok: boolean }> = markers
      ? MARKER_ENTRIES.map(entry => ({ item: entry.label, ok: markers[entry.key].observed }))
      : []
    const checks = [...fileChecks, ...markerChecks]
    const ok = checks.filter(c => c.ok).length
    const failedFileChecks = fileChecks.filter(c => !c.ok)

    const lines = [
      `Checklist: ${ok}/${checks.length}`,
      // The historical `Checklist: N/M` header is preserved for consumers, but
      // the count is declared immediately as local checks so it cannot be read
      // as a score, approval or coverage of the whole work (issue #169).
      `Local checks only: ${ok}/${checks.length} local checks satisfied = 3 configured-file/chapter-discovery checks + ${markers ? "3" : "0"} lexical marker observations in the configured main file${markers ? "" : " (main file missing: markers not evaluated)"}; this count is not a score, approval, institutional compliance, or coverage of the whole work.`,
      // Objective failures of the configured files/discovery keep the
      // historical `  ✗ ` presentation, separate from lexical observations.
      ...failedFileChecks.map(c => `  ✗ ${c.item}`),
    ]

    if (markers) {
      lines.push(
        "LaTeX markers (lexical scan of the configured main file only; includes, macros and other files are not read or expanded):",
      )
      for (const entry of MARKER_ENTRIES) {
        const observation = markers[entry.key]
        if (observation.observed) {
          // Provenance is the configured main file plus the real occurrence
          // line; no absolute path and no manuscript content is echoed.
          lines.push(
            `  ✓ ${entry.label}: lexical presence observed in the configured main file (line ${observation.line}).`,
          )
        } else {
          // Non-observation is scoped: it must never become a global absence
          // claim about the whole work.
          lines.push(
            `  – ${entry.label}: not observed in the configured main file; presence in the whole work is indeterminate/not evaluated.`,
          )
        }
      }
      lines.push(
        "  Marker note: lexical recognition does not imply LaTeX execution, macro expansion, or presence/absence in other files or includes.",
      )
    } else {
      // A missing main file is an objective absence of the configured file and
      // an impossibility to evaluate its markers; neither is a structural claim.
      lines.push(
        "LaTeX markers not evaluated: documentclass, abstract/resumo, toc (main file missing). Their presence in the whole work is unknown; absence was not established.",
      )
    }

    lines.push(
      "Scope: structural lexical checklist of configured manuscript files and fixed LaTeX markers in the main file only; chapter discovery counts matched files and does not prove LaTeX inclusion or execution; no macro expansion, verbatim environments, includes, or full TeX interpretation.",
      "Limits: not LaTeX compilation, not an exhaustive manuscript audit, not ABNT compliance, and not approval, institutional delivery, or scientific quality.",
    )
    return lines.join("\n")
  },
})
