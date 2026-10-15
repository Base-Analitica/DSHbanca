import { existsSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { ensureBancaDir, configPath, saveConfig } from "../lib/config"
import { loadState, saveState } from "../lib/state"
import { installAssets } from "../lib/install_assets"
import { PathTraversalError, resolveRealInsideRoot } from "../lib/safe_paths"
import type { ProjectConfig } from "../lib/config"
export const bancaInit = defineBancaTool({
  description: "Initialize banca project. Creates .banca/ + .dsh/ assets + state.json.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    force: z.boolean().optional().describe("Overwrite existing config + assets"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const cfgPath = configPath(root)
    if (existsSync(cfgPath) && !args.force) return "skipped — .banca/project.json exists. use --force."

    // Preflight every destination this tool creates or writes. A symlink
    // escaping the workspace blocks initialization before any partial change.
    try {
      for (const parts of [
        [".banca"],
        [".banca", "reports"],
        [".banca", "context"],
        [".banca", "snapshots"],
        [".banca", "cache"],
        [".banca", "project.json"],
        [".banca", "state.json"],
        [".dsh"],
        [".dsh", "agents"],
        [".dsh", "skills"],
        [".dsh", "commands"],
      ]) {
        resolveRealInsideRoot(root, join(root, ...parts))
      }
    } catch (err) {
      if (err instanceof PathTraversalError) return "blocked: project asset paths escape the workspace root"
      throw err
    }

    try {
      ensureBancaDir(root)

      const config: ProjectConfig = {
        version: 1,
        manuscript: { format: "latex", root: ".", main: "main.tex", bib: "referencias.bib", chapters: ["capitulos/*.tex"], outputDir: "trabalhos" },
        compile: { enabled: true, command: ["lualatex", "bibtex", "lualatex", "lualatex"] },
        allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
        protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
        immutableFacts: [], externalDependencies: [],
        rubricProfile: "banca-rigorosa", targetScore: 9.0,
        providers: { references: { primary: "mcp:crossref-academic", fallbacks: ["rest:crossref", "cache"], timeoutMs: 20000 } },
        mcp: { crossrefAcademicEnabled: false },
      }

      for (const cmd of ["lualatex", "xelatex", "pdflatex"]) {
        try { const r = spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 10000 }); if (r.status === 0) { config.compile.command[0] = cmd; break } } catch { }
      }

      saveConfig(root, config)

      const state = loadState(root)
      saveState(root, state)

      const installed = installAssets(root, !!args.force)

      const lines = [`✓ .banca/ + config + state`]
      lines.push(`✓ ${installed.length} assets installed`)

      return lines.join("\n")
    } catch (err) {
      if (err instanceof PathTraversalError) return "blocked: project asset paths escape the workspace root"
      throw err
    }
  },
})
