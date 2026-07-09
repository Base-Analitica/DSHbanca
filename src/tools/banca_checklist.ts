import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
const z = tool.schema

export const bancaChecklist = tool({
  description: "Verify delivery checklist.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    const checks: Array<{ item: string; ok: boolean }> = [
      { item: "Main file", ok: existsSync(paths.main) },
      { item: "Bib file", ok: existsSync(paths.bib) },
      { item: "Chapters", ok: paths.chapters.length > 0 },
    ]

    if (existsSync(paths.main)) {
      const c = readFileSync(paths.main, "utf-8")
      checks.push({ item: "documentclass", ok: c.includes("\\documentclass") })
      checks.push({ item: "abstract/resumo", ok: c.includes("\\begin{abstract}") || c.includes("\\resumo") })
      checks.push({ item: "toc", ok: c.includes("\\tableofcontents") })
    }

    const ok = checks.filter(c => c.ok).length
    const fail = checks.filter(c => !c.ok)
    return [`Checklist: ${ok}/${checks.length}`, ...fail.map(c => `  ✗ ${c.item}`)].join("\n")
  },
})
