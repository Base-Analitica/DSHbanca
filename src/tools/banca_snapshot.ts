import { mkdirSync, cpSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { addSnapshot } from "../lib/state"
import { loadConfig } from "../lib/config"
import { sanitizeSnapshotLabel, resolveInsideRoot, PathTraversalError } from "../lib/safe_paths"
const z = tool.schema

export const bancaSnapshot = tool({
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

    const keepDirs = new Set([
      ...config.manuscript.chapters.map((c) => join(root, c.replace("/*.tex", ""))),
      root,
    ])

    cpSync(root, snapDir, {
      recursive: true,
      filter: (s: string) => {
        const rel = s.replace(root, "").replace(/^\//, "")
        if (!rel) return true
        if (rel.startsWith(".banca/snapshots") || rel.startsWith("node_modules") || rel.startsWith(".git") || rel.startsWith("dist")) return false
        return true
      },
    })

    addSnapshot(root, label, null)

    return `snapshot → ${snapDir}`
  },
})
