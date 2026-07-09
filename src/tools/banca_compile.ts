import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { compileLatex, findLatexEngine, findBibEngine, validateEngine, validateBibEngine, type LatexCommand } from "../lib/latex"
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
    if (!validateEngine(engine)) return `invalid LaTeX engine: ${engine}`

    const mainFile = paths.main
    const mainBase = mainFile.replace(/\.tex$/, "")
    const bibEngine = findBibEngine() || "bibtex"
    if (!validateBibEngine(bibEngine)) return `invalid bibliography engine: ${bibEngine}`

    const steps: LatexCommand[] = [
      { command: engine, args: ["-interaction=nonstopmode", mainBase], label: "latex pass 1" },
      { command: bibEngine, args: [mainBase], label: "bibliography" },
      { command: engine, args: ["-interaction=nonstopmode", mainBase], label: "latex pass 2" },
      { command: engine, args: ["-interaction=nonstopmode", mainBase], label: "latex pass 3" },
    ]

    const result = compileLatex(paths.root, paths.main, steps)

    return result.success
      ? `compilation OK (${result.elapsedMs}ms)`
      : `compilation FAILED (${result.errors.length} errors)\n${result.errors.slice(0, 5).join("\n")}`
  },
})
