import { existsSync, cpSync, rmSync } from "node:fs"
import { join, dirname, relative, isAbsolute } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadState, addSnapshot } from "../lib/state"
import { loadConfig } from "../lib/config"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  prepareRealPathForWrite,
  realWorkspaceRoot,
  resolveInsideRoot,
  resolveRealInsideRoot,
  sanitizeSnapshotLabel,
} from "../lib/safe_paths"
import { resolveManuscriptPaths } from "../lib/paths"
export const bancaRestore = defineBancaTool({
  description: "Restore project from a snapshot safely.",
  args: {
    snapshotId: z.string().optional().describe("Snapshot ID or label to restore from"),
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    confirm: z.boolean().optional().describe("Confirm restore (default: false, runs dry-run)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const state = loadState(root)
    const config = loadConfig(root)

    // list snapshots
    if (!args.snapshotId) {
      if (state.snapshots.length === 0) return "no snapshots available"
      return state.snapshots.map((s) => `  ${s.id} — ${s.label} (${new Date(s.createdAt).toLocaleDateString()})`).join("\n")
    }

    const snap = state.snapshots.find((s) => s.id === args.snapshotId || s.label === args.snapshotId)
    if (!snap) return `snapshot not found: ${args.snapshotId}`

    // Canonical preflight: snapshots root, snapshot directory and every
    // restore destination must resolve inside the workspace before any change.
    let canonicalRoot: string
    let snapshotsDir: string
    let snapDir: string
    try {
      canonicalRoot = realWorkspaceRoot(root)
      snapshotsDir = resolveRealInsideRoot(root, join(root, ".banca", "snapshots"))
      const lexicalSnapDir = resolveInsideRoot(snapshotsDir, snap.label)
      snapDir = resolveRealInsideRoot(root, lexicalSnapDir)
    } catch {
      return `blocked: snapshot path escapes project root`
    }
    if (!existsSync(snapDir)) return `snapshot directory not found: ${snapDir}`

    // Resolve manuscript paths against snapshot directory
    const snapPaths = resolveManuscriptPaths(snapDir, config)

    // Resolve manuscript paths against project root to check current files
    const currentPaths = resolveManuscriptPaths(root, config)

    // Gather files to restore from snapshot with canonical containment
    const restorePairs: Array<{ src: string; dst: string; rel: string }> = []
    try {
      const snapFiles: string[] = []
      if (existsSync(snapPaths.main)) snapFiles.push(snapPaths.main)
      if (existsSync(snapPaths.bib)) snapFiles.push(snapPaths.bib)
      for (const ch of snapPaths.chapters) {
        if (existsSync(ch)) snapFiles.push(ch)
      }
      for (const snapFile of snapFiles) {
        const src = resolveRealInsideRoot(root, snapFile)
        const rel = relative(snapDir, src)
        if (rel.startsWith("..") || isAbsolute(rel)) {
          throw new PathTraversalError("restore source escapes snapshot directory")
        }
        const dst = resolveRealInsideRoot(root, rel)
        restorePairs.push({ src, dst, rel })
      }
      // state persistence must stay inside the workspace
      resolveRealInsideRoot(root, join(root, ".banca", "state.json"))
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: restore path escapes project root`
      throw err
    }

    if (!args.confirm) {
      const affected = restorePairs.map(p => `- ${p.rel}`).join("\n")
      return [
        `### Restore Dry-Run for Snapshot: ${snap.label}`,
        `To apply this restore, run with 'confirm: true'.`,
        `Files to be restored:`,
        affected || "None"
      ].join("\n")
    }

    // CREATE PRE-RESTORE SNAPSHOT (SAFETY BACKUP)
    const backupLabel = sanitizeSnapshotLabel(`pre-restore-${Date.now()}`)
    let backupDir: string
    try {
      backupDir = ensureRealDirInsideRoot(root, join(snapshotsDir, backupLabel))
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      throw err
    }

    // Copy current manuscript files to safety backup
    const copyFileToBackup = (srcPath: string) => {
      if (!srcPath || !existsSync(srcPath)) return
      const src = resolveRealInsideRoot(root, srcPath)
      const relPath = relative(canonicalRoot, src)
      if (relPath.startsWith("..") || isAbsolute(relPath)) {
        throw new PathTraversalError("file escapes workspace root")
      }
      const destPath = prepareRealPathForWrite(root, join(backupDir, relPath))
      cpSync(src, destPath, { recursive: true })
    }

    try {
      copyFileToBackup(currentPaths.main)
      copyFileToBackup(currentPaths.bib)
      for (const ch of currentPaths.chapters) {
        copyFileToBackup(ch)
      }
      addSnapshot(root, backupLabel, state.currentScore)
    } catch (err: any) {
      if (err instanceof PathTraversalError) return `blocked: restore path escapes project root`
      return `failed to create pre-restore backup: ${err.message}`
    }

    // Now perform the actual restore safely
    const restoredFiles: string[] = []
    for (const pair of restorePairs) {
      let dstNow: string
      try {
        dstNow = resolveRealInsideRoot(root, pair.rel)
      } catch {
        return `blocked: restore path escapes project root: ${pair.rel}`
      }

      // Delete existing destination file if present
      if (existsSync(dstNow)) {
        rmSync(dstNow, { recursive: true, force: true })
      }

      try {
        ensureRealDirInsideRoot(root, dirname(dstNow))
      } catch {
        return `blocked: restore path escapes project root: ${pair.rel}`
      }

      let dstFinal: string
      try {
        // re-resolve immediately before copying
        dstFinal = resolveRealInsideRoot(root, pair.rel)
      } catch {
        return `blocked: restore path escapes project root: ${pair.rel}`
      }

      cpSync(pair.src, dstFinal, { recursive: true })
      restoredFiles.push(pair.rel)
    }

    return [
      `restored from ${snap.label}`,
      `Safety backup created: ${backupLabel}`,
      `Restored files:`,
      restoredFiles.map((f) => `- ${f}`).join("\n") || "None"
    ].join("\n")
  },
})
