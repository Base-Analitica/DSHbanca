import { existsSync, cpSync, rmSync, mkdirSync } from "node:fs"
import { join, dirname, relative, isAbsolute } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadState, addSnapshot } from "../lib/state"
import { loadConfig } from "../lib/config"
import { resolveInsideRoot, sanitizeSnapshotLabel } from "../lib/safe_paths"
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

    const snapshotsDir = join(root, ".banca", "snapshots")
    const snapDir = join(snapshotsDir, snap.label)
    try {
      resolveInsideRoot(snapshotsDir, snap.label)
    } catch {
      return `blocked: snapshot path escapes project root`
    }
    if (!existsSync(snapDir)) return `snapshot directory not found: ${snapDir}`

    // Resolve manuscript paths against snapshot directory
    const snapPaths = resolveManuscriptPaths(snapDir, config)
    
    // Resolve manuscript paths against project root to check current files
    const currentPaths = resolveManuscriptPaths(root, config)

    // Gather files to restore from snapshot
    const filesToRestore: string[] = []
    if (existsSync(snapPaths.main)) filesToRestore.push(snapPaths.main)
    if (existsSync(snapPaths.bib)) filesToRestore.push(snapPaths.bib)
    for (const ch of snapPaths.chapters) {
      if (existsSync(ch)) filesToRestore.push(ch)
    }

    const restorePairs = filesToRestore.map((snapFile) => {
      const rel = relative(snapDir, snapFile)
      const dst = resolveInsideRoot(root, rel)
      return { src: snapFile, dst, rel }
    })

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
    const backupDir = join(snapshotsDir, backupLabel)
    try {
      resolveInsideRoot(snapshotsDir, backupLabel)
    } catch {
      return `blocked: snapshot path escapes project root`
    }
    mkdirSync(backupDir, { recursive: true })

    // Copy current manuscript files to safety backup
    const copyFileToBackup = (srcPath: string) => {
      if (!srcPath || !existsSync(srcPath)) return
      const relPath = relative(root, srcPath)
      if (relPath.startsWith("..") || isAbsolute(relPath)) {
        throw new Error(`File escapes project root: ${srcPath}`)
      }
      const destPath = resolveInsideRoot(backupDir, relPath)
      const destParent = dirname(destPath)
      if (!existsSync(destParent)) {
        mkdirSync(destParent, { recursive: true })
      }
      cpSync(srcPath, destPath, { recursive: true })
    }

    try {
      copyFileToBackup(currentPaths.main)
      copyFileToBackup(currentPaths.bib)
      for (const ch of currentPaths.chapters) {
        copyFileToBackup(ch)
      }
      addSnapshot(root, backupLabel, state.currentScore)
    } catch (err: any) {
      return `failed to create pre-restore backup: ${err.message}`
    }

    // Now perform the actual restore safely
    const restoredFiles: string[] = []
    for (const pair of restorePairs) {
      // Validate dst is inside root
      try {
        resolveInsideRoot(root, pair.rel)
      } catch {
        return `blocked: restore path escapes project root: ${pair.rel}`
      }
      
      // Delete existing destination file if present
      if (existsSync(pair.dst)) {
        rmSync(pair.dst, { recursive: true, force: true })
      }
      
      const dstParent = dirname(pair.dst)
      if (!existsSync(dstParent)) {
        mkdirSync(dstParent, { recursive: true })
      }
      
      cpSync(pair.src, pair.dst, { recursive: true })
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
