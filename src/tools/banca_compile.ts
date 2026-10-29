import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { compileLatex, findLatexEngine, findBibEngine, validateEngine, validateBibEngine, buildCompileCommands, type LatexCommand } from "../lib/latex"
export const bancaCompile = defineBancaTool({
  description: "Compile LaTeX manuscript using configured engine.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    if (!config.compile.enabled) return "compilation disabled in config"

    const configCommands = config.compile.command
    for (const cmd of configCommands) {
      if (!validateEngine(cmd) && !validateBibEngine(cmd)) {
        return `invalid engine in compile.command: ${cmd}`
      }
    }

    const steps = buildCompileCommands(configCommands, paths.main, paths.root)

    const result = compileLatex(paths.root, paths.main, steps)

    return result.success
      ? `compilation OK (${result.elapsedMs}ms)`
      : `compilation FAILED (${result.errors.length} errors)\n${result.errors.slice(0, 5).join("\n")}`
  },
})
