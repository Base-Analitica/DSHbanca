import { existsSync, lstatSync, type Stats } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { ensureBancaDir, configPath, saveConfig } from "../lib/config"
import { getStatePath, loadState, saveState } from "../lib/state"
import { installAssets } from "../lib/install_assets"
import { PathTraversalError, resolveRealInsideRoot } from "../lib/safe_paths"
import type { ProjectConfig } from "../lib/config"

/**
 * Fixed, sanitized refusals for the initialization write-role conflict check.
 * They never embed host paths, link targets, file content or raw filesystem
 * messages.
 */
const INIT_CONFIG_STATE_COLLISION =
  "configuration and state must use distinct physical files"
const INIT_CONFIG_STATE_IDENTITY_REFUSED =
  "configuration and state identity could not be inspected safely"

function lstatIdentityOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new PathTraversalError(INIT_CONFIG_STATE_IDENTITY_REFUSED)
  }
}

/**
 * Local conflict check between the two destinations `banca_init` writes through
 * distinct roles: `.banca/project.json` (configuration) and `.banca/state.json`
 * (academic state). The canonical path policy already authorizes internal
 * symlinks, so two confined role names are not necessarily two files: an
 * internal alias could make the state preflight and the configuration write
 * share one destination, and `saveState` would then overwrite the configuration
 * just saved (issue #140 R1).
 *
 * The project root is normalized exactly once before the canonical resolution,
 * so a relative root is never applied twice. A collision is reported when the
 * resolved destinations are equal or when two existing regular files share
 * device/inode (hardlinks). A missing destination is legitimate absence;
 * inspection failures are controlled refusals and are never degraded to
 * "independent destinations". This is not a general file-identity API and does
 * not change any other read/write policy.
 */
function assertDistinctConfigurationAndState(projectRoot: string): void {
  const absoluteRoot = resolve(projectRoot)
  let configDestination: string
  let stateDestination: string
  try {
    configDestination = resolveRealInsideRoot(absoluteRoot, configPath(absoluteRoot))
    stateDestination = resolveRealInsideRoot(absoluteRoot, getStatePath(absoluteRoot))
  } catch (error) {
    if (error instanceof PathTraversalError) {
      throw new PathTraversalError(INIT_CONFIG_STATE_IDENTITY_REFUSED)
    }
    throw error
  }
  if (configDestination === stateDestination) {
    throw new PathTraversalError(INIT_CONFIG_STATE_COLLISION)
  }
  // Canonical names differ here, but hardlinks still share a physical file.
  const configStat = lstatIdentityOrNull(configDestination)
  const stateStat = lstatIdentityOrNull(stateDestination)
  if (
    configStat !== null &&
    stateStat !== null &&
    configStat.isFile() &&
    stateStat.isFile() &&
    configStat.dev === stateStat.dev &&
    configStat.ino === stateStat.ino
  ) {
    throw new PathTraversalError(INIT_CONFIG_STATE_COLLISION)
  }
}

export const bancaInit = defineBancaTool({
  description: "Initialize banca project. Creates .banca/ + .dsh/ assets + state.json.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    force: z.boolean().optional().describe("Overwrite existing config + assets"),
  },
  execute: async (args, ctx) => {
    // Normalize the workspace root once at the tool boundary (issue #143).
    // Downstream consumers build destinations with `join(root, ...)` and then
    // resolve them again against the same root; a relative root would be
    // applied twice, writing configuration/assets into a duplicated directory
    // while state and the preflights used the true root. This is a lexical
    // normalization only: the canonical confinement, symlink and physical
    // identity preflights below are unchanged.
    const root = resolve(args.projectRoot || ctx.directory)
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

    // The two initialization write roles must be physically independent before
    // anything is created or replaced. Canonical confinement alone allows an
    // internal symlink/hardlink alias between `.banca/project.json` and
    // `.banca/state.json`; in that case the state approved by the preflight
    // would overwrite the configuration just saved (issue #140 R1). Refusing
    // here happens before mkdir/config/state/assets and before any read of the
    // aliased shared file.
    try {
      assertDistinctConfigurationAndState(root)
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: ${err.message}`
      throw err
    }

    // Read the academic state through the canonical reader approved in #136
    // before any initialization effect. `loadState` decides origin safety,
    // regularity and readability, and only a legitimately absent state or
    // invalid JSON in an authorized internal file degrades to the historical
    // empty state. A known refusal must happen here, before directories,
    // configuration or assets are created or replaced (issue #140); its fixed
    // sanitized diagnostic is returned instead of the generic asset-path
    // message reserved for escaping destinations.
    let state: ReturnType<typeof loadState>
    try {
      state = loadState(root)
    } catch (err) {
      if (err instanceof PathTraversalError) return `blocked: ${err.message}`
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

      // Reuse the state approved by the preflight above instead of reading it
      // again after the side effects.
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
