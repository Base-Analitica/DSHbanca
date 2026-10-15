import { join } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { addSnapshot } from "../lib/state"
import { loadConfig } from "../lib/config"
import { ChapterDiscoveryError, resolveManuscriptPaths } from "../lib/paths"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  realWorkspaceRoot,
  resolveRealInsideRoot,
  sanitizeSnapshotLabel,
} from "../lib/safe_paths"
import { captureSnapshotFiles, logicalProjectRel, type SnapshotCaptureResult } from "../lib/snapshot"

export const bancaSnapshot = defineBancaTool({
  description: "Create targeted snapshot of manuscript files. Registers in state.json.",
  args: {
    label: z.string().optional().describe("Snapshot label"),
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const rawLabel = args.label || `pre-${Date.now()}`
    if (rawLabel.includes("..") || rawLabel.includes("/") || rawLabel.includes("\\")) {
      return `blocked: snapshot path escapes project root`
    }
    const label = sanitizeSnapshotLabel(rawLabel)
    const config = loadConfig(root)

    // Canonical preflight before any directory creation or copy: the state
    // file and the snapshots root must both resolve inside the workspace.
    let snapshotsDir: string
    try {
      realWorkspaceRoot(root)
      resolveRealInsideRoot(root, join(root, ".banca", "state.json"))
      snapshotsDir = ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      throw err
    }

    // Incomplete chapter discovery aborts the snapshot: a partial chapter list
    // would be stored as if it were the whole manuscript.
    let paths
    try {
      paths = resolveManuscriptPaths(root, config)
    } catch (err) {
      if (err instanceof ChapterDiscoveryError) {
        return `blocked: chapter discovery is incomplete — snapshot aborted to avoid omitting manuscript files`
      }
      throw err
    }

    // Logical identity: files are keyed by the configured project-relative
    // path, never by the canonical path a symlink may resolve to.
    let snapDir: string
    let captured: SnapshotCaptureResult
    try {
      const candidates = [
        { logical: logicalProjectRel(root, paths.main), abs: paths.main },
        { logical: logicalProjectRel(root, paths.bib), abs: paths.bib },
        ...paths.chapters.map((ch) => ({ logical: logicalProjectRel(root, ch), abs: ch })),
      ]
      snapDir = ensureRealDirInsideRoot(root, join(snapshotsDir, label))
      captured = captureSnapshotFiles({ root, snapshotsDir, snapDir, label, candidates })
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      throw err
    }

    addSnapshot(root, label, null)

    const lines = [`snapshot → ${snapDir}`, `Captured (content verified):`]
    lines.push(
      ...(captured.files.length > 0
        ? captured.files.map((f) => `- ${f.logical} (sha256: ${f.sha256.slice(0, 12)}…)`)
        : ["None"]),
    )
    const notCaptured = [
      ...captured.missing.map((m) => `${m} (not found)`),
      ...captured.skipped.map((s) => `${s.logical} (${s.reason})`),
    ]
    if (notCaptured.length > 0) {
      lines.push(`Not captured:`)
      lines.push(...notCaptured.map((n) => `- ${n}`))
    }
    return lines.join("\n")
  },
})
