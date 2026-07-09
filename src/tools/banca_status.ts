import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { loadState } from "../lib/state"
const z = tool.schema

export const bancaStatus = tool({
  description: "Show banca project status from config + state.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const cfgPath = join(root, ".banca", "project.json")
    if (!existsSync(cfgPath)) return "not initialized — run /banca:init first"

    const config = loadConfig(root)
    const state = loadState(root)
    const paths = resolveManuscriptPaths(root, config)

    const reportsDir = join(root, ".banca", "reports")
    const reports = existsSync(reportsDir) ? readdirSync(reportsDir) : []

    return [
      `Score: ${state.currentScore ?? "—"} / ${config.targetScore}`,
      `Main:  ${paths.main} ${existsSync(paths.main) ? "✓" : "✗"}`,
      `Bib:   ${paths.bib} ${existsSync(paths.bib) ? "✓" : "✗"}`,
      `Chapters: ${paths.chapters.length}`,
      `Reports: ${reports.length}`,
      `Compile: ${config.compile.enabled ? config.compile.command[0] : "off"}`,
      `Iterations: ${state.iterations.length}`,
      `Last audit: ${state.lastAudit ? new Date(state.lastAudit).toLocaleDateString() : "—"}`,
    ].join("\n")
  },
})
