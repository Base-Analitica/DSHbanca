import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
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
import { addIteration } from "../lib/state"
import { checkScoreNotDecreased } from "../lib/guards"
import { analyzeCitationDensity } from "../lib/citation"

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
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    const corrections = args.corrections || []

    if (!Array.isArray(corrections) || corrections.length === 0) return "no corrections provided"

    // The public correction workflow always requires a real pre-correction
    // snapshot: a caller cannot opt out before any other validation runs.
    if (args.skipSnapshot) {
      return "blocked: skipSnapshot is not permitted in public correction workflow"
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
    // Phase 5 — success bookkeeping (same contracts as before).
    // -----------------------------------------------------------------------
    const results = planned.map(
      (p) => `✓ ${p.file} (${p.count} replacement${p.count > 1 ? "s" : ""})`,
    )

    // regression score check (canonical citation-density heuristic)
    let curScore: number | null = null
    let regNote = ""
    if (args.previousScore !== undefined) {
      let mainContent: string | null = null
      try {
        mainContent = readFileSync(paths.main, "utf-8")
      } catch {
        mainContent = null
      }
      if (mainContent !== null) {
        curScore = analyzeCitationDensity(mainContent).score
        const violation = checkScoreNotDecreased(args.previousScore, curScore)
        if (violation) {
          regNote = `\n⚠ ${violation.message}`
        }
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
