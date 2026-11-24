import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths, isPathProtected, isPathAllowed, globToRegex, toPosixPath } from "../lib/paths"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  realWorkspaceRoot,
  resolveRealInsideRoot,
} from "../lib/safe_paths"
import {
  createSnapshot,
  destinationIdentityConflict,
  lexicalProjectPath,
  logicalProjectRel,
  sha256Of,
  SnapshotCaptureError,
  SnapshotConflictError,
} from "../lib/snapshot"
import { addIteration, loadState } from "../lib/state"
import { checkScoreNotDecreased } from "../lib/guards"
import { analyzeCitationDensity } from "../lib/citation"

/**
 * Issue #141 — controlled state-origin refusal for the correction preflight.
 *
 * The canonical state reader (#136) throws a sanitized `PathTraversalError`
 * whose message carries no host path, link target, external content or raw
 * filesystem message. Surfacing its fixed category keeps the diagnosis
 * faithful: a state directory/unreadable/non-regular origin is a STATE refusal,
 * distinct from the pre-existing workspace-path refusal, from a label conflict
 * and from an operational snapshot-capture failure.
 */
function formatStateOriginRefusal(err: PathTraversalError): string {
  const prefix = "state refused: "
  const detail = err.message.startsWith(prefix)
    ? err.message.slice(prefix.length)
    : "the state origin is not authorized"
  return `blocked: project state origin refused — ${detail} — no manuscript file was modified`
}

/**
 * Issue #167 — canonical origin of the main manuscript used by the requested
 * regression check.
 *
 * `resolveManuscriptPaths` is lexical, so before `previousScore` can be honored
 * the configured main file must be resolved physically and proven to be a
 * regular file inside the workspace. Only then may the mandatory pre-correction
 * snapshot, the state registration or the manuscript write happen: a regression
 * check that would read an external, broken, non-regular or unreadable origin
 * is refused before any mutation.
 *
 * The messages are fixed and sanitized: they never echo a host path, a link
 * target, external bytes or a raw filesystem message.
 */
const MAIN_MANUSCRIPT_ORIGIN_REFUSAL =
  "blocked: main manuscript origin is outside the workspace, follows an unsafe symbolic link, or is not a regular file — regression check requested but could not be verified; no snapshot, state entry or manuscript file was written"

const MAIN_MANUSCRIPT_ABSENT_REFUSAL =
  "blocked: main manuscript not found — regression check requested but could not be verified; no snapshot, state entry or manuscript file was written"

const MAIN_MANUSCRIPT_READ_REFUSAL =
  "blocked: main manuscript destination could not be inspected or read safely — regression check requested but could not be verified; no snapshot, state entry or manuscript file was written"

/**
 * Issue #168 — the requested regression check needs a measured denominator.
 *
 * A main manuscript without any eligible paragraph has no citation evidence
 * (0/0): the historical analyzer fabricated `8.0` and the correction could
 * mutate the workspace while announcing a verified (or improved) regression.
 * The refusal is fixed and sanitized (no path, link target, manuscript content
 * or raw filesystem message) and happens before the mandatory snapshot, the
 * state registration or any manuscript write.
 */
const MAIN_MANUSCRIPT_INSUFFICIENT_REFUSAL =
  "blocked: main manuscript has no eligible paragraph for the lexical citation-density heuristic — dados insuficientes (insufficient data; main-only, global coverage not proven); regression check requested but could not be verified; no snapshot, state entry or manuscript file was written"

/**
 * Expected read failures of an already inspected regular file. They become a
 * controlled sanitized refusal; unexpected errors (including programming
 * defects) are rethrown unchanged.
 */
const EXPECTED_MAIN_READ_FAILURE_CODES = new Set([
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

type MainManuscriptInspection =
  | { status: "absent" }
  | { status: "unreadable" }
  | {
      status: "present"
      /** Canonical (realpath) destination resolved from the configured path. */
      canonicalPath: string
      dev: number
      ino: number
      /** Bytes read from the canonical regular file. */
      bytes: Buffer
    }

/**
 * Resolve the configured main file to its canonical destination and report
 * whether it is a present regular file. The resolution is rooted at the project
 * workspace — never at the configured manuscript root's own target — so a
 * redirected root cannot become an implicitly authorized root.
 *
 * Missing stays missing (legitimate absence); escaping links, broken links,
 * ancestor links and non-regular destinations (directory, FIFO, socket, device)
 * throw {@link PathTraversalError} without opening the file, so a FIFO is never
 * opened for a blocking read.
 */
function inspectMainManuscript(root: string, lexicalMain: string): MainManuscriptInspection {
  let canonicalPath: string
  try {
    canonicalPath = resolveRealInsideRoot(root, lexicalMain)
  } catch (err) {
    if (err instanceof PathTraversalError) throw err
    throw new PathTraversalError("main manuscript destination cannot be inspected")
  }

  let stat
  try {
    stat = lstatSync(canonicalPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return { status: "absent" }
    throw new PathTraversalError("main manuscript destination cannot be inspected")
  }
  if (!stat.isFile()) {
    throw new PathTraversalError("main manuscript destination is not a regular file")
  }

  let bytes: Buffer
  try {
    bytes = readFileSync(canonicalPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (typeof code === "string" && EXPECTED_MAIN_READ_FAILURE_CODES.has(code)) {
      return { status: "unreadable" }
    }
    throw err
  }

  return {
    status: "present",
    canonicalPath,
    dev: stat.dev,
    ino: stat.ino,
    bytes,
  }
}

const CorrectionSchema = z.object({
  file: z.string(),
  oldText: z.string(),
  newText: z.string(),
  /**
   * Exact number of literal, non-overlapping occurrences of `oldText` the
   * caller authorizes replacing. When provided, it must be a positive safe
   * integer and match the real count exactly; otherwise the whole batch is
   * refused. When omitted, only a single occurrence is admissible — several
   * matches are ambiguous and are refused instead of silently replaced.
   */
  expectedOccurrences: z.number().int().positive().optional(),
})

/**
 * Literal, non-overlapping occurrence replacement.
 *
 * Counting and replacement share the same `indexOf` walk so the authorized
 * count can never diverge from what is actually written. `replacement` is
 * inserted verbatim: JavaScript replacement templates (`$&`, `$$`, `$'`,
 * backtick-dollar), regex syntax and LaTeX commands are not interpreted.
 */
export function literalReplaceAll(
  haystack: string,
  needle: string,
  replacement: string,
): { count: number; updated: string } {
  let count = 0
  let cursor = 0
  let updated = ""
  for (;;) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break
    updated += haystack.slice(cursor, index) + replacement
    cursor = index + needle.length
    count += 1
  }
  if (count === 0) return { count: 0, updated: haystack }
  return { count, updated: updated + haystack.slice(cursor) }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

/**
 * Strict UTF-8 decode: a file is only rewritten textually when the decoded
 * string re-encodes to the exact original bytes. Invalid sequences would be
 * silently replaced with U+FFFD by a lossy round-trip, so they are refused
 * instead of corrupting unselected bytes. A leading BOM is preserved.
 */
function decodeUtf8Strict(bytes: Buffer): string | null {
  const content = bytes.toString("utf-8")
  return Buffer.from(content, "utf-8").equals(bytes) ? content : null
}

/**
 * True only when the string contains no isolated UTF-16 surrogate code unit.
 *
 * JavaScript strings may carry lone surrogates; encoding them to UTF-8
 * silently substitutes U+FFFD. Such a substitution would change the text the
 * caller authorized, so arguments are validated as well-formed Unicode before
 * any snapshot is created. Valid surrogate pairs and non-BMP characters are
 * preserved as-is — no normalization is applied.
 */
function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1
      if (next < 0xdc00 || next > 0xdfff) return false
      i += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

interface PlannedCorrection {
  file: string
  /** Canonical destination resolved at preflight time. */
  abs: string
  /** Canonical project-relative POSIX path used by the existing guards. */
  relPath: string
  /** Project-declared logical identity used by the snapshot vault. */
  logical: string
  /** Device/inode identity captured at preflight time. */
  dev: number
  ino: number
  /** Bytes decoded from the destination at preflight time. */
  content: string
  count: number
  /** Fully materialized replacement: what the apply phase will write. */
  updated: string
}

function recoveryNote(label: string): string {
  return `pre-correction snapshot ${label} (partial) remains registered and can be inspected with banca_restore`
}

/**
 * Record a post-snapshot failure as `failed` in the academic state. Returns a
 * short note only when the state itself cannot be written: the caller must
 * never claim success or rollback it did not perform.
 */
function addFailedIteration(root: string, previousScore: number | null | undefined): string {
  try {
    addIteration(root, "correction", previousScore ?? null, null, "failed")
    return ""
  } catch {
    return " (the failure could not be recorded in state.json)"
  }
}

type FailedDestinationState =
  | { state: "unchanged"; sha256: string }
  | { state: "modified"; sha256: string; size: number }
  | { state: "indeterminate"; reason: string }

/**
 * Classify a destination after an I/O failure. `writeFileSync` may truncate or
 * write partially before throwing, so the in-flight destination is never
 * assumed intact: it is re-resolved, its physical identity is compared with the
 * preflight identity and its bytes are compared with the preflight bytes.
 * An unreadable or replaced destination is reported as indeterminate — never as
 * a preserved manuscript.
 */
function inspectFailedDestination(root: string, planned: PlannedCorrection): FailedDestinationState {
  try {
    const target = resolveRealInsideRoot(root, planned.abs)
    const st = lstatSync(target)
    if (!st.isFile() || st.dev !== planned.dev || st.ino !== planned.ino) {
      return { state: "indeterminate", reason: "destination identity could not be revalidated" }
    }
    const bytes = readFileSync(target)
    if (bytes.equals(Buffer.from(planned.content, "utf-8"))) {
      return { state: "unchanged", sha256: sha256Of(bytes) }
    }
    return { state: "modified", sha256: sha256Of(bytes), size: bytes.length }
  } catch {
    return { state: "indeterminate", reason: "destination bytes could not be re-read" }
  }
}

export const bancaCorrigir = defineBancaTool({
  description:
    "Apply corrections with snapshot + immutableFacts guard + regression check + state tracking. " +
    "The whole batch is validated in memory before snapshot or write: literal non-overlapping " +
    "occurrences are counted, expectedOccurrences (when given) must be a positive safe integer and " +
    "match exactly, an omitted count admits only a single occurrence, and any invalid correction " +
    "blocks the entire batch.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    corrections: z.array(CorrectionSchema).describe("Corrections array"),
    previousScore: z.number().optional().describe("Score before correction (regression check)"),
    skipSnapshot: z.boolean().optional().describe("Skip snapshot creation"),
  },
  execute: async (args, ctx) => {
    // Normalize the workspace root once at the tool boundary (issue #146). The
    // mandatory pre-correction snapshot was created through
    // `ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))`: with
    // a relative root the root was applied twice, so the manuscript was really
    // modified and the backup registered in the true state while its bytes were
    // stored in the duplicated directory — a recovery point the corrected
    // restore (#149) cannot reach. This is a lexical normalization only;
    // canonical confinement, destination identity, backup verification and
    // state registration are unchanged.
    const root = resolve(args.projectRoot || ctx.directory)
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    const corrections = args.corrections || []

    if (!Array.isArray(corrections) || corrections.length === 0) return "no corrections provided"

    // The public correction workflow always requires a real pre-correction
    // snapshot: a caller cannot opt out before any other validation runs.
    if (args.skipSnapshot) {
      return "blocked: skipSnapshot is not permitted in public correction workflow"
    }

    // Issue #167 — canonical main-manuscript preflight. When `previousScore`
    // asks for a regression check, the configured main file must be proven to
    // be a safe, readable regular file INSIDE the workspace before the
    // mandatory snapshot, the state registration or any write. An unsafe or
    // inaccessible origin is refused here, while the workspace is still
    // byte-identical. Without `previousScore` this read is not requested, so
    // the historical behavior is preserved untouched.
    let mainPreflight: Extract<MainManuscriptInspection, { status: "present" }> | null = null
    if (args.previousScore !== undefined) {
      try {
        const inspection = inspectMainManuscript(root, paths.main)
        if (inspection.status === "absent") return MAIN_MANUSCRIPT_ABSENT_REFUSAL
        if (inspection.status === "unreadable") return MAIN_MANUSCRIPT_READ_REFUSAL
        // Issue #168 — a verified regular main file with zero eligible
        // paragraphs provides no pre-correction citation evidence. The
        // regression check is refused here, still before snapshot/state/write.
        if (
          analyzeCitationDensity(inspection.bytes.toString("utf-8")).status ===
          "insufficient_data"
        ) {
          return MAIN_MANUSCRIPT_INSUFFICIENT_REFUSAL
        }
        mainPreflight = inspection
      } catch (err) {
        if (err instanceof PathTraversalError) return MAIN_MANUSCRIPT_ORIGIN_REFUSAL
        throw err
      }
    }

    // -----------------------------------------------------------------------
    // Phase 1 — validate every argument and every destination in memory.
    // Nothing in this phase may create a snapshot, write state or touch the
    // manuscript: one invalid correction must block the entire batch.
    // -----------------------------------------------------------------------
    for (const c of corrections) {
      if (typeof c?.file !== "string" || c.file.length === 0) {
        return "blocked: correction entry is missing a target file"
      }
      if (typeof c.oldText !== "string") {
        return `blocked: ${c.file}: oldText must be a string`
      }
      if (typeof c.newText !== "string") {
        return `blocked: ${c.file}: newText must be a string`
      }
      if (!isWellFormedUnicode(c.oldText)) {
        return `blocked: ${c.file}: oldText is not well-formed Unicode (isolated UTF-16 surrogate)`
      }
      if (!isWellFormedUnicode(c.newText)) {
        return `blocked: ${c.file}: newText is not well-formed Unicode (isolated UTF-16 surrogate)`
      }
      if (c.expectedOccurrences !== undefined && !isPositiveSafeInteger(c.expectedOccurrences)) {
        return `blocked: ${c.file}: expectedOccurrences must be a positive safe integer`
      }
    }

    // Canonical preflight: resolve every destination to its real path before
    // any snapshot or write. Symlinks escaping the workspace block the batch.
    const resolved: Array<{ file: string; abs: string; relPath: string; logical: string }> = []
    for (const c of corrections) {
      try {
        const abs = resolveRealInsideRoot(root, c.file)
        const relPath = toPosixPath(relative(realWorkspaceRoot(root), abs))
        const lexical = lexicalProjectPath(root, c.file)
        const logical = logicalProjectRel(root, lexical)
        resolved.push({ file: c.file, abs, relPath, logical })
      } catch {
        return `blocked: ${c.file} escapes project root`
      }
    }

    const logicals = resolved.map((r) => r.logical)

    // Physical destination identity preflight (P1 reversibility): verify the
    // entire batch for physical collisions (symlink aliases, hard links, duplicate
    // targets, or identity incompatibilities) before creating any snapshot or
    // mutating any file. Destinations are never deduplicated: two corrections
    // aimed at one physical file remain prohibited.
    const conflict = destinationIdentityConflict(root, logicals)
    if (conflict !== null) {
      return `blocked: ${conflict}`
    }

    // Workspace persistence paths this tool will touch must also be internal.
    try {
      resolveRealInsideRoot(root, join(root, ".banca", "state.json"))
      resolveRealInsideRoot(root, join(root, ".banca", "snapshots"))
    } catch {
      return `blocked: workspace state paths escape project root`
    }

    // Issue #141: authorize/read the state origin through the single secure
    // reader (#136) BEFORE the mandatory pre-correction snapshot creates the
    // vault. Otherwise a state directory/unreadable/non-regular origin is only
    // refused later inside createSnapshot, after `.banca/snapshots` exists, and
    // reported as a generic snapshot failure. This preflight is additive: the
    // snapshot creation and registration still perform their own effective
    // state read for label conflicts and registration.
    try {
      loadState(root)
    } catch (err) {
      if (err instanceof PathTraversalError) return formatStateOriginRefusal(err)
      throw err
    }

    // immutableFacts guard: block edits to immutable files (whole batch).
    for (let i = 0; i < corrections.length; i++) {
      const c = corrections[i]
      for (const fact of config.immutableFacts) {
        if (globToRegex(fact).test(resolved[i].relPath)) {
          return `blocked: ${c.file} is immutable (immutableFacts: "${fact}"). ${c.oldText.substring(0, 60)}...`
        }
      }
    }

    const planned: PlannedCorrection[] = []
    for (let i = 0; i < corrections.length; i++) {
      const c = corrections[i]
      const r = resolved[i]

      // Preserve the existing protection/allowlist guards on the canonical path.
      if (isPathProtected(r.relPath, config)) return `blocked: ${c.file}: protected path`
      if (!isPathAllowed(r.relPath, config)) return `blocked: ${c.file}: not in allowed paths`

      // Empty oldText would match anywhere and insert text at position 0.
      if (c.oldText.length === 0) return `blocked: ${c.file}: empty oldText`

      // Existence/type/alias preflight for every destination of the batch.
      let stat
      try {
        stat = lstatSync(r.abs)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return `blocked: ${c.file}: not found`
        }
        return `blocked: ${c.file}: destination is not accessible`
      }
      if (!stat.isFile()) return `blocked: ${c.file}: destination is not a regular file`
      // Hard link alias preflight: refuse regular files with nlink > 1.
      // If a destination shares its inode with other directory entries (whether
      // inside or outside the workspace), in-place modification would alter
      // unlisted/unauthorized files and break reversibility (restore by rename
      // detaches the inode, leaving aliases permanently corrupted).
      if (stat.nlink > 1) {
        return `blocked: ${c.file} has multiple hard links (nlink: ${stat.nlink}) — writing would alter uncontrolled aliases`
      }

      let bytes: Buffer
      try {
        bytes = readFileSync(r.abs)
      } catch {
        return `blocked: ${c.file}: not accessible`
      }
      const content = decodeUtf8Strict(bytes)
      if (content === null) {
        return `blocked: ${c.file}: content is not valid UTF-8 — refusing a lossy textual rewrite`
      }

      // Count and materialize the replacement with the same literal,
      // non-overlapping semantics; never interpret `$` templates or regex.
      const { count, updated } = literalReplaceAll(content, c.oldText, c.newText)

      // The planned result must be exactly representable in UTF-8: a lone
      // surrogate or any lossy round-trip is refused before the snapshot.
      if (!isWellFormedUnicode(updated) || Buffer.from(updated, "utf-8").toString("utf-8") !== updated) {
        return `blocked: ${c.file}: planned replacement is not exactly representable in UTF-8 — refusing a lossy rewrite`
      }

      if (count === 0) return `blocked: ${c.file}: oldText not found`

      if (c.expectedOccurrences !== undefined) {
        if (count !== c.expectedOccurrences) {
          // A mismatch is a deterministic preflight failure: the batch is
          // refused before snapshot, state or manuscript mutation.
          return `blocked: ${c.file} occurrence preflight failed: expected ${c.expectedOccurrences} (expectedOccurrences), found ${count} — batch rejected before snapshot; no manuscript file was modified`
        }
      } else if (count !== 1) {
        // Without an explicit count only an unambiguous single match is
        // admissible; the tool never infers authorization from the model text.
        return `blocked: ${c.file} occurrence preflight failed: expected exactly 1 (expectedOccurrences omitted), found ${count} — batch rejected before snapshot; no manuscript file was modified`
      }

      planned.push({
        file: c.file,
        abs: r.abs,
        relPath: r.relPath,
        logical: r.logical,
        dev: stat.dev,
        ino: stat.ino,
        content,
        count,
        updated,
      })
    }

    // -----------------------------------------------------------------------
    // Phase 2 — real partial pre-correction snapshot, only after the whole
    // batch passed preflight.
    // -----------------------------------------------------------------------
    let snapshotLabel: string
    try {
      const snapshotsDir = ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))
      // Logical identity: the snapshot keys the correction target by its
      // project-declared path, not by the canonical path a symlink resolves to.
      const candidates = planned.map((p) => ({
        logical: p.logical,
        abs: lexicalProjectPath(root, p.file),
      }))
      // Pre-correction snapshots are registered in state.snapshots (accessible
      // via banca_restore) and are declared `partial`: they capture only the
      // files this correction will touch, so they are never announced as full
      // recovery points.
      const created = createSnapshot({
        root,
        snapshotsDir,
        label: `pre-${Date.now()}`,
        candidates,
        labelPolicy: "unique",
        register: true,
        scoreBefore: args.previousScore ?? null,
        kind: "partial",
      })
      snapshotLabel = created.label

      // The recovery point announced to the caller must really cover every
      // planned target with the exact preflight bytes; otherwise no write is
      // allowed (a disappearance between preflight and capture is a race, not
      // a licensing event).
      const captured = new Map(created.files.map((f) => [f.logical, f]))
      for (const p of planned) {
        const entry = captured.get(p.logical)
        if (entry === undefined || entry.sha256 !== sha256Of(Buffer.from(p.content, "utf-8"))) {
          const recorded = addFailedIteration(root, args.previousScore)
          return `blocked: pre-correction snapshot ${snapshotLabel} does not cover ${p.file} — no manuscript file was modified; ${recoveryNote(snapshotLabel)}${recorded}`
        }
      }
    } catch (err) {
      if (
        err instanceof PathTraversalError ||
        err instanceof SnapshotConflictError ||
        err instanceof SnapshotCaptureError
      ) {
        // Snapshot creation is mandatory: no path guard or capture failure may
        // leave the manuscript writable without a real recovery point.
        return `blocked: pre-correction snapshot failed — no manuscript file was modified`
      }
      throw err
    }

    // -----------------------------------------------------------------------
    // Phase 3 — revalidate identity and content immediately before applying.
    // -----------------------------------------------------------------------
    const revalidationFailure = (reason: string): string => {
      const recorded = addFailedIteration(root, args.previousScore)
      return `blocked: ${reason} — no manuscript file was modified; ${recoveryNote(snapshotLabel)}${recorded}`
    }

    const identityConflict = destinationIdentityConflict(root, logicals)
    if (identityConflict !== null) {
      return revalidationFailure(identityConflict)
    }
    for (const p of planned) {
      try {
        const target = resolveRealInsideRoot(root, p.abs)
        const st = lstatSync(target)
        if (!st.isFile()) return revalidationFailure(`${p.file}: destination is no longer a regular file`)
        if (st.nlink > 1) {
          return revalidationFailure(
            `${p.file} has multiple hard links (nlink: ${st.nlink}) — writing would alter uncontrolled aliases`,
          )
        }
        if (st.dev !== p.dev || st.ino !== p.ino) {
          return revalidationFailure(`${p.file}: destination identity changed after preflight`)
        }
        const current = decodeUtf8Strict(readFileSync(target))
        if (current === null || current !== p.content) {
          return revalidationFailure(`${p.file}: content changed after preflight`)
        }
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return revalidationFailure(`${p.file} escapes project root`)
        }
        return revalidationFailure(`${p.file}: destination is not accessible`)
      }
    }

    // -----------------------------------------------------------------------
    // Phase 4 — apply only the planned substitutions, re-resolving each
    // destination immediately before its write (existing TOCTOU guard).
    // Multi-file I/O is not promised to be atomic: an operational failure
    // after the first write is reported honestly with the real snapshot kept.
    // -----------------------------------------------------------------------
    const applied: string[] = []
    for (let i = 0; i < planned.length; i++) {
      const p = planned[i]
      let writeStarted = false
      try {
        const target = resolveRealInsideRoot(root, p.abs)
        const st = lstatSync(target)
        if (!st.isFile()) throw new Error("destination is no longer a regular file")
        if (st.nlink > 1) throw new Error("destination gained hard links")
        if (st.dev !== p.dev || st.ino !== p.ino) throw new Error("destination identity changed before write")
        const current = decodeUtf8Strict(readFileSync(target))
        if (current === null || current !== p.content) throw new Error("content changed before write")
        // From this point on the file may be truncated/partially written even
        // when writeFileSync throws; the catch below verifies the real bytes.
        writeStarted = true
        writeFileSync(target, p.updated, "utf-8")
        applied.push(p.file)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        const detail = typeof code === "string" ? code : ((err as Error)?.message ?? "I/O error")
        const reason =
          err instanceof PathTraversalError
            ? `${p.file} escapes project root`
            : writeStarted
              ? `${p.file}: write failed (${detail})`
              : `${p.file}: pre-write revalidation failed (${detail})`

        const recorded = addFailedIteration(root, args.previousScore)
        const notProcessed = planned.slice(i + 1).map((rest) => rest.file)
        const outcome = inspectFailedDestination(root, p)
        const originalSha = sha256Of(Buffer.from(p.content, "utf-8"))

        const failedDestination =
          outcome.state === "modified"
            ? `partially modified: ${p.file} (sha256 ${originalSha} -> ${outcome.sha256}, ${outcome.size} bytes after the failure)`
            : outcome.state === "unchanged"
              ? `failed destination re-read and verified unchanged: ${p.file}`
              : `indeterminate/potentially modified: ${p.file} (${outcome.reason})`

        // Only a verified, byte-identical destination allows the claim that no
        // manuscript was modified. Any applied file, partial write or
        // unverifiable state is reported as a partial mutation with recovery.
        const anyMutation = applied.length > 0 || outcome.state !== "unchanged"
        const headline = anyMutation
          ? "No automatic rollback was performed"
          : "No manuscript file was modified"
        const lists =
          `applied: ${applied.length > 0 ? applied.join(", ") : "none"}; ` +
          `${failedDestination}; ` +
          `not processed: ${notProcessed.length > 0 ? notProcessed.join(", ") : "none"}`
        return `${anyMutation ? "partial" : "blocked"}: ${reason}. ${headline}; ${lists}; ${recoveryNote(snapshotLabel)} to recover the original bytes.${recorded}`
      }
    }

    // -----------------------------------------------------------------------
    // Phase 5 — success bookkeeping and regression verification.
    //
    // The regression source is re-resolved and re-inspected immediately before
    // the read (issue #167). A failure here happens after the writes, so it is
    // reported as an honest partial outcome with the real recovery point — it
    // never claims that the regression was verified nor that nothing changed.
    // -----------------------------------------------------------------------
    const unverifiedRegression = (reason: string): string => {
      const recorded = addFailedIteration(root, args.previousScore)
      return `partial: the requested correction was applied, but the regression check could not be verified — ${reason}; no automatic rollback was performed; ${recoveryNote(snapshotLabel)} to recover the original bytes.${recorded}`
    }

    const results = planned.map(
      (p) => `✓ ${p.file} (${p.count} replacement${p.count > 1 ? "s" : ""})`,
    )

    // regression score check (canonical citation-density heuristic)
    let curScore: number | null = null
    let regNote = ""
    if (args.previousScore !== undefined) {
      if (mainPreflight === null) {
        // Defensive invariant: the preflight above always runs when
        // `previousScore` is defined. Reaching this point is a programming
        // defect, never a user-facing condition.
        throw new Error("main manuscript preflight missing for the regression check")
      }
      let inspected: MainManuscriptInspection
      try {
        inspected = inspectMainManuscript(root, paths.main)
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return unverifiedRegression("main manuscript origin is no longer authorized")
        }
        throw err
      }
      if (inspected.status === "absent") {
        return unverifiedRegression("main manuscript is no longer present")
      }
      if (inspected.status === "unreadable") {
        return unverifiedRegression("main manuscript could not be read safely")
      }
      if (inspected.canonicalPath !== mainPreflight.canonicalPath) {
        return unverifiedRegression("main manuscript origin changed after the preflight")
      }
      if (inspected.dev !== mainPreflight.dev || inspected.ino !== mainPreflight.ino) {
        return unverifiedRegression("main manuscript destination changed after the preflight")
      }
      // A main file that is itself an authorized correction target changes
      // legitimately; every other main file must still match the preflight
      // bytes, otherwise the score would be computed over a source that changed
      // between the preflight and the read.
      const mainIsCorrected = planned.some((p) => p.abs === inspected.canonicalPath)
      if (!mainIsCorrected && sha256Of(inspected.bytes) !== sha256Of(mainPreflight.bytes)) {
        return unverifiedRegression("main manuscript content changed after the preflight")
      }
      const postAnalysis = analyzeCitationDensity(inspected.bytes.toString("utf-8"))
      if (postAnalysis.status === "insufficient_data") {
        // Issue #168 — the correction was already applied, but the
        // post-correction main file no longer has any eligible paragraph. The
        // regression is genuinely unavailable: report a partial outcome with
        // the real recovery point. The historical fabricated 8.0 is never
        // recorded as the new score, as a verified regression or as an
        // improvement, and no automatic rollback is claimed.
        //
        // The iteration is recorded through `addFailedIteration` because
        // `state.ts` (out of scope for #168) only defines ok/rollback/failed;
        // "failed" here follows the pre-existing `unverifiedRegression`
        // convention for "verification unavailable", not for "correction
        // failed". `scoreAfter` stays null, so `currentScore` is preserved.
        const recorded = addFailedIteration(root, args.previousScore)
        return [
          ...results,
          `partial: the requested correction was applied, but the regression check could not be verified — main manuscript has no eligible paragraph for the lexical citation-density heuristic after the correction (dados insuficientes / insufficient data; main-only, global coverage not proven); no automatic rollback was performed; ${recoveryNote(snapshotLabel)} to recover the original bytes.${recorded}`,
        ].join("\n")
      }
      curScore = postAnalysis.score
      const violation = checkScoreNotDecreased(args.previousScore, curScore)
      if (violation) {
        regNote = `\n⚠ ${violation.message}`
      }
    }

    // externalDependencies: add note in results
    if (config.externalDependencies.length > 0) {
      results.push(`\nnote: ${config.externalDependencies.length} external dependencies — not counted as failures`)
    }

    // state tracking. No actual rollback is performed here, so a regression
    // is recorded as failed, never as rollback.
    addIteration(root, "correction", args.previousScore ?? null, curScore, regNote ? "failed" : "ok")

    return results.join("\n") + regNote
  },
})
