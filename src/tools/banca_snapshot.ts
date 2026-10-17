import { existsSync } from "node:fs"
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
  SnapshotNotRestorableError,
  snapshotRestorePolicyError,
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
    // createSnapshot refuses any label that already holds snapshot data, never
    // truncates an existing snapshot, and — before registering anything —
    // applies the same physical destination policy restore enforces: a project
    // whose configured paths collide on one file (or whose main is absent,
    // broken, external or redirected into a protected namespace) is refused
    // here instead of being announced as a recovery point that cannot be used.
    let created: CreatedSnapshot
    const mainLogical = logicalProjectRel(root, paths.main)
    try {
      const candidates = [
        { logical: mainLogical, abs: paths.main },
        { logical: logicalProjectRel(root, paths.bib), abs: paths.bib },
        ...paths.chapters.map((ch) => ({ logical: logicalProjectRel(root, ch), abs: ch })),
      ]
      for (const candidate of candidates) {
        // Missing optional files are not captured and therefore cannot make
        // the resulting recovery point immediately unrestorable.
        if (!existsSync(candidate.abs)) continue
        const policyError = snapshotRestorePolicyError(root, config, candidate.logical)
        if (policyError) {
          return `blocked: snapshot is not restorable — ${policyError.replace(/^blocked: /, "")} — nothing was registered and no partial snapshot was left behind`
        }
      }
      created = createSnapshot({
        root,
        snapshotsDir,
        label,
        candidates,
        labelPolicy: "strict",
        register: true,
        scoreBefore: null,
        kind: "restorable",
        requiredLogical: mainLogical,
      })
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      if (err instanceof SnapshotConflictError) {
        return `blocked: snapshot label "${label}" is not available (${err.reason}) — existing snapshot data was left untouched`
      }
      if (err instanceof SnapshotNotRestorableError) {
        return `blocked: snapshot is not restorable — ${err.reason} — nothing was registered and no partial snapshot was left behind`
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
    lines.push(
      `Recovery point verified: restorable (${mainLogical} captured, no destination collisions)`,
    )
    return lines.join("\n")
  },
})
