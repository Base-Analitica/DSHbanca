import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { compileLatex, findLatexEngine, findBibEngine } from "../lib/latex"
const z = tool.schema

export const bancaCompile = tool({
  description: "Compile LaTeX manuscript using configured engine.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    if (!config.compile.enabled) return "compilation disabled in config"
    const engine = findLatexEngine()
    if (!engine) return "no LaTeX engine found (install TeX Live)"

    const mainFile = paths.main
    const mainBase = mainFile.replace(/\.tex$/, "")
    const bibEngine = findBibEngine() || "bibtex"

    // build proper commands with file arguments
    const cmds: string[] = [
      `${engine} -interaction=nonstopmode "${mainBase}"`,
      `${bibEngine} "${mainBase}"`,
      `${engine} -interaction=nonstopmode "${mainBase}"`,
      `${engine} -interaction=nonstopmode "${mainBase}"`,
    ]

    const result = compileLatex(paths.root, paths.main, cmds)

    return result.success
      ? `compilation OK (${result.elapsedMs}ms)`
      : `compilation FAILED (${result.errors.length} errors)\n${result.errors.slice(0, 5).join("\n")}`
  },
})
