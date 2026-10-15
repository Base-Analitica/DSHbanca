import { join } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { ChapterDiscoveryError, resolveManuscriptPaths } from "../lib/paths"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  realWorkspaceRoot,
  resolveRealInsideRoot,
  sanitizeSnapshotLabel,
} from "../lib/safe_paths"
import {
  createSnapshot,
  logicalProjectRel,
  SnapshotCaptureError,
  SnapshotConflictError,
  type CreatedSnapshot,
} from "../lib/snapshot"

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
    // path, never by the canonical path a symlink may resolve to. The central
    // createSnapshot refuses any label that already holds snapshot data and
    // never truncates an existing snapshot, directory or manifest.
    let created: CreatedSnapshot
    try {
      const candidates = [
        { logical: logicalProjectRel(root, paths.main), abs: paths.main },
        { logical: logicalProjectRel(root, paths.bib), abs: paths.bib },
        ...paths.chapters.map((ch) => ({ logical: logicalProjectRel(root, ch), abs: ch })),
      ]
      created = createSnapshot({
        root,
        snapshotsDir,
        label,
        candidates,
        labelPolicy: "strict",
        register: true,
        scoreBefore: null,
      })
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      if (err instanceof SnapshotConflictError) {
        return `blocked: snapshot label "${label}" is not available (${err.reason}) — existing snapshot data was left untouched`
      }
      if (err instanceof SnapshotCaptureError) {
        return `blocked: snapshot capture failed — no snapshot was registered`
      }
      throw err
    }

    const lines = [`snapshot → ${created.snapDir}`, `Captured (content verified):`]
    lines.push(
      ...(created.files.length > 0
        ? created.files.map((f) => `- ${f.logical} (sha256: ${f.sha256.slice(0, 12)}…)`)
        : ["None"]),
    )
    const notCaptured = [
      ...created.missing.map((m) => `${m} (not found)`),
      ...created.skipped.map((s) => `${s.logical} (${s.reason})`),
    ]
    if (notCaptured.length > 0) {
      lines.push(`Not captured:`)
      lines.push(...notCaptured.map((n) => `- ${n}`))
    }
    return lines.join("\n")
  },
})
