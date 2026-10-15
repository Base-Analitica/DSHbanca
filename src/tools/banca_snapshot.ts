import { existsSync, mkdirSync, cpSync } from "node:fs"
import { join, dirname, relative, isAbsolute } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { addSnapshot } from "../lib/state"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { sanitizeSnapshotLabel, resolveInsideRoot } from "../lib/safe_paths"
function copyFileToSnapshot(srcPath: string, projectRoot: string, snapDir: string) {
  if (!srcPath || !existsSync(srcPath)) return
  const relPath = relative(projectRoot, srcPath)
  if (relPath.startsWith("..") || isAbsolute(relPath)) {
    throw new Error(`File escapes project root: ${srcPath}`)
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
  const destPath = resolveInsideRoot(snapDir, relPath)
  const destParent = dirname(destPath)
  if (!existsSync(destParent)) {
    mkdirSync(destParent, { recursive: true })
  }
  cpSync(srcPath, destPath, { recursive: true })
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
    const snapshotsDir = join(root, ".banca", "snapshots")
    const snapDir = join(snapshotsDir, label)
    try { resolveInsideRoot(snapshotsDir, label) } catch { return `blocked: snapshot path escapes project root` }
    mkdirSync(snapDir, { recursive: true })

    const paths = resolveManuscriptPaths(root, config)

    try {
      copyFileToSnapshot(paths.main, root, snapDir)
      copyFileToSnapshot(paths.bib, root, snapDir)
      for (const ch of paths.chapters) {
        copyFileToSnapshot(ch, root, snapDir)
      }
    } catch (err: any) {
      return `blocked: snapshot path escapes project root`
    }

    addSnapshot(root, label, null)

    return `snapshot → ${snapDir}`
  },
})

