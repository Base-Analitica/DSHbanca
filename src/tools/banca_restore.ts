import { existsSync, cpSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadState } from "../lib/state"
import { loadConfig } from "../lib/config"
const z = tool.schema

export const bancaRestore = tool({
  description: "Restore project from a snapshot. Lists snapshots if no ID given.",
  args: {
    snapshotId: z.string().optional().describe("Snapshot ID or label to restore from"),
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    dryRun: z.boolean().optional().describe("List files without restoring"),
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

    const snapDir = join(root, ".banca", "snapshots", snap.label)
    if (!existsSync(snapDir)) return `snapshot directory not found: ${snapDir}`

    if (args.dryRun) {
      return `would restore from ${snapDir}`
    }

    for (const entry of ["capitulos", "preambulo.tex", "referencias.bib", "main.tex"]) {
      const src = join(snapDir, entry)
      const dst = join(root, entry)
      if (existsSync(src)) {
        if (existsSync(dst)) rmSync(dst, { recursive: true })
        cpSync(src, dst, { recursive: true })
      }
    }

    return `restored from ${snap.label}`
  },
})
