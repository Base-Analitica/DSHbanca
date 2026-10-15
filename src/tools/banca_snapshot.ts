import { existsSync, cpSync } from "node:fs"
import { join, relative, isAbsolute } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { addSnapshot } from "../lib/state"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  prepareRealPathForWrite,
  realWorkspaceRoot,
  resolveRealInsideRoot,
  sanitizeSnapshotLabel,
} from "../lib/safe_paths"

function copyFileToSnapshot(srcPath: string, root: string, canonicalRoot: string, snapDir: string) {
  if (!srcPath || !existsSync(srcPath)) return
  const srcCanonical = resolveRealInsideRoot(root, srcPath)
  const relPath = relative(canonicalRoot, srcCanonical)
  if (relPath.startsWith("..") || isAbsolute(relPath)) {
    throw new PathTraversalError("file escapes workspace root")
  }
  const posixRel = relPath.replace(/[/\\]+/g, "/")
  if (
    posixRel === ".env" ||
    posixRel.startsWith(".env.") ||
    posixRel.startsWith(".dsh/") ||
    posixRel.startsWith(".banca/cache/") ||
    posixRel.startsWith(".banca/reports/") ||
    posixRel.startsWith(".git/") ||
    posixRel.startsWith("node_modules/") ||
    posixRel.startsWith("dist/")
  ) {
    return
  }
  const destPath = prepareRealPathForWrite(root, join(snapDir, relPath))
  cpSync(srcCanonical, destPath, { recursive: true })
}

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
    // file, the snapshots root and the snapshot destination must all resolve
    // inside the workspace.
    let canonicalRoot: string
    let snapDir: string
    try {
      canonicalRoot = realWorkspaceRoot(root)
      resolveRealInsideRoot(root, join(root, ".banca", "state.json"))
      const snapshotsDir = ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))
      snapDir = ensureRealDirInsideRoot(root, join(snapshotsDir, label))
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      throw err
    }

    const paths = resolveManuscriptPaths(root, config)

    try {
      copyFileToSnapshot(paths.main, root, canonicalRoot, snapDir)
      copyFileToSnapshot(paths.bib, root, canonicalRoot, snapDir)
      for (const ch of paths.chapters) {
        copyFileToSnapshot(ch, root, canonicalRoot, snapDir)
      }
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: snapshot path escapes project root`
      throw err
    }

    addSnapshot(root, label, null)

    return `snapshot → ${snapDir}`
  },
})
