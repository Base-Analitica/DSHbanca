import { existsSync, readFileSync, writeFileSync } from "node:fs"
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
  /** Number of occurrences the caller expects to replace. If provided and the
   * actual count differs, a warning is emitted so silent partial replacements
   * are surfaced. */
  expectedOccurrences: z.number().optional(),
})

export const bancaCorrigir = defineBancaTool({
  description: "Apply corrections with snapshot + immutableFacts guard + regression check + state tracking.",
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

    if (corrections.length === 0) return "no corrections provided"

    // Canonical preflight: resolve every destination to its real path before
    // any snapshot or write. Symlinks escaping the workspace block the batch.
    const prepared: Array<{ file: string; abs: string; relPath: string }> = []
    const logicals: string[] = []
    for (const c of corrections) {
      try {
        const abs = resolveRealInsideRoot(root, c.file)
        const relPath = toPosixPath(relative(realWorkspaceRoot(root), abs))
        prepared.push({ file: c.file, abs, relPath })
        const lexical = lexicalProjectPath(root, c.file)
        logicals.push(logicalProjectRel(root, lexical))
      } catch {
        return `blocked: ${c.file} escapes project root`
      }
    }

    if (args.skipSnapshot) {
      return "blocked: skipSnapshot is not permitted in public correction workflow"
    }

    // Physical destination identity preflight (P1 reversibility): verify the
    // entire batch for physical collisions (symlink aliases, hard links, duplicate
    // targets, or identity incompatibilities) before creating any snapshot or
    // mutating any file.
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

    // immutableFacts guard: block edits to immutable files
    for (let i = 0; i < corrections.length; i++) {
      const c = corrections[i]
      for (const fact of config.immutableFacts) {
        if (globToRegex(fact).test(prepared[i].relPath)) {
          return `blocked: ${c.file} is immutable (immutableFacts: "${fact}"). ${c.oldText.substring(0, 60)}...`
        }
      }
    }

    // snapshot: mandatory, registered in state.snapshots, declared partial
    const snapLabel = `pre-${Date.now()}`
    try {
      const snapshotsDir = ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))
      // Logical identity: the snapshot keys the correction target by its
      // project-declared path, not by the canonical path a symlink resolves to.
      const candidates = corrections.map((c) => {
        const lexical = lexicalProjectPath(root, c.file)
        return { logical: logicalProjectRel(root, lexical), abs: lexical }
      })
      // Internal labels may collide within one millisecond: the central
      // createSnapshot picks the first free `-N` suffix and never reuses an
      // existing snapshot directory or manifest. Pre-correction snapshots
      // are registered in state.snapshots (accessible via banca_restore) and are
      // declared `partial`: they capture only the files this correction will
      // touch, so they are never announced as full recovery points (the
      // physical destination policy still applies to their own contents).
      createSnapshot({
        root,
        snapshotsDir,
        label: snapLabel,
        candidates,
        labelPolicy: "unique",
        register: true,
        scoreBefore: args.previousScore ?? null,
        kind: "partial",
      })
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: workspace state paths escape project root`
      if (err instanceof SnapshotConflictError || err instanceof SnapshotCaptureError) {
        return `blocked: pre-correction snapshot failed — no manuscript file was modified`
      }
      throw err
    }

    const results: string[] = []
    for (let i = 0; i < corrections.length; i++) {
      const c = corrections[i]
      const p = prepared[i]
      let fp: string
      try {
        fp = resolveRealInsideRoot(root, p.abs)
      } catch {
        return `blocked: ${c.file} escapes project root`
      }
      if (!existsSync(fp)) { results.push(`✗ ${c.file}: not found`); continue }

      if (isPathProtected(p.relPath, config)) { results.push(`✗ ${c.file}: protected path`); continue }
      if (!isPathAllowed(p.relPath, config)) { results.push(`✗ ${c.file}: not in allowed paths`); continue }

      const content = readFileSync(fp, "utf-8")
      if (typeof c.oldText !== "string" || c.oldText.length === 0) {
        // Empty oldText would match anywhere and insert text at position 0.
        results.push(`✗ ${c.file}: empty oldText`)
        continue
      }

      // Count actual occurrences so we can warn on mismatch.
      let occurrenceCount = 0
      let searchStart = 0
      while (true) {
        const idx = content.indexOf(c.oldText, searchStart)
        if (idx === -1) break
        occurrenceCount++
        searchStart = idx + c.oldText.length
      }

      if (occurrenceCount === 0) {
        results.push(`✗ ${c.file}: oldText not found`)
        continue
      }

      // Check expectation before replacing, so a mismatch is surfaced even
      // when the replacement succeeds for a subset.
      if (
        typeof c.expectedOccurrences === "number" &&
        c.expectedOccurrences !== occurrenceCount
      ) {
        // Still apply the replacement — but warn so the caller knows the
        // count was off (partial replacement risk).
        results.push(
          `⚠ ${c.file}: expected ${c.expectedOccurrences} occurrences, found ${occurrenceCount}`,
        )
      }

      // Replace ALL occurrences (String.replace with string only replaces the
      // first one, which silently drops repeated corrections).
      const updated = content.replaceAll(c.oldText, c.newText)
      let target: string
      try {
        // re-resolve immediately before writing to narrow the TOCTOU window
        target = resolveRealInsideRoot(root, p.abs)
      } catch {
        return `blocked: ${c.file} escapes project root`
      }
      writeFileSync(target, updated, "utf-8")
      results.push(
        `✓ ${c.file} (${occurrenceCount} replacement${occurrenceCount > 1 ? "s" : ""})`,
      )
    }

    // regression score check (canonical citation-density heuristic)
    let curScore: number | null = null
    let regNote = ""
    if (args.previousScore !== undefined && existsSync(paths.main)) {
      const mainContent = readFileSync(paths.main, "utf-8")
      curScore = analyzeCitationDensity(mainContent).score
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
