import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig, validateConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { loadState } from "../lib/state"

/**
 * Exact historical message for a project whose configuration is truly absent.
 * It must never be emitted for a present but unauthorized/unreadable origin
 * (issue #137).
 */
const NOT_INITIALIZED = "not initialized — run /banca:init first"

/** Structured categories of the canonical configuration contract (#134). */
const CONFIG_NOT_FOUND = "config not found"
const CONFIG_REFUSED_PREFIX = "config refused:"
const BLOCKED_PREFIX = "blocked: "

/**
 * Classify the configuration origin through the canonical read contract
 * already exposed by `validateConfig` (issue #134) instead of probing the
 * filesystem here.
 *
 * The public result keeps three categories distinct:
 * - `config not found` is legitimate absence (historical message);
 * - `config refused: ...` is a fixed, sanitized origin/read refusal — a broken
 *   or escaping link, a broken/non-directory ancestor, a non-regular
 *   destination or a present file that cannot be read;
 * - any other validation error belongs to the content of an authorized
 *   internal regular file. It is not an origin refusal: the historical
 *   `loadConfig` contract (sanitization/defaults) still governs the status.
 *
 * Reusing this contract avoids `existsSync`/`lstat`/`realpath` duplication in
 * the tool and keeps the single canonical path policy in `src/lib/config.ts`.
 * Unexpected exceptions are not classified: they propagate as before.
 */
function configOriginDiagnostic(root: string): string | null {
  const validation = validateConfig(root)
  if (validation.errors.length === 1 && validation.errors[0] === CONFIG_NOT_FOUND) {
    return NOT_INITIALIZED
  }
  const refusal = validation.errors.find((error) => error.startsWith(CONFIG_REFUSED_PREFIX))
  if (refusal) return `${BLOCKED_PREFIX}${refusal}`
  return null
}

export const bancaStatus = defineBancaTool({
  description: "Show banca project status from config + state.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory

    // Resolve the configuration origin before loading state, resolving
    // manuscript paths or inspecting reports. An insecure origin must never
    // be reported as absence or as a partial status.
    const configDiagnostic = configOriginDiagnostic(root)
    if (configDiagnostic !== null) return configDiagnostic

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
