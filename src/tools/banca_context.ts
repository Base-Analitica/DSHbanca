import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
const z = tool.schema

export const bancaContext = tool({
  description: "Build context pack from project state for agents.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    const parts: string[] = [
      `# Context Pack — ${new Date().toISOString()}\n`,
      `\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n`,
    ]

    for (const p of [join(root, ".banca", "scorecard.md"), join(root, ".banca", "knowledge.md")]) {
      if (existsSync(p)) parts.push(`\n${readFileSync(p, "utf-8")}\n`)
    }

    for (const ch of paths.chapters) {
      parts.push(`\n### ${ch}\n\n\`\`\`latex\n${readFileSync(ch, "utf-8").slice(0, 1500)}\n\`\`\`\n`)
    }

    const ctxDir = join(root, ".banca", "context")
    mkdirSync(ctxDir, { recursive: true })
    const out = join(ctxDir, `context-${Date.now()}.md`)
    writeFileSync(out, parts.join("\n"), "utf-8")
    return `context → ${out}`
  },
})
