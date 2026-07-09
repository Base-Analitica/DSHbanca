import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths, isPathProtected, globToRegex, toPosixPath } from "../lib/paths"
import { loadState } from "../lib/state"
import { saveReport } from "../lib/reports"
const z = tool.schema

export const bancaContract = tool({
  description: "Generate correction contract: diff summary, immutable facts check, score impact.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    corrections: z.array(z.object({
      file: z.string(),
      oldText: z.string(),
      newText: z.string(),
    })).describe("Applied corrections to audit"),
    save: z.boolean().optional().describe("Save contract to .banca/reports/"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    const corrections = args.corrections || []

    const files: string[] = []
    let immutableBlocked = false

    for (const c of corrections) {
      const abs = join(root, c.file)
      if (!files.includes(c.file)) files.push(c.file)

      // check immutable facts (relative path)
      const relPath = toPosixPath(c.file)
      for (const fact of config.immutableFacts) {
        if (globToRegex(fact).test(relPath)) {
          immutableBlocked = true
        }
      }
    }

    const state = loadState(root)

    const contract = {
      timestamp: new Date().toISOString(),
      scoreBefore: state.currentScore,
      files: files.map((f) => ({
        path: f,
        protected: isPathProtected(toPosixPath(f), config),
        immutable: false,
      })),
      corrections: corrections.length,
      immutableBlocked,
      externalDependencies: config.externalDependencies,
      scorecard: state.currentScore !== null ? `pre-correction score: ${state.currentScore}` : "no previous score",
    }

    const text = [
      "# Correction Contract",
      `**Date:** ${contract.timestamp}`,
      `**Files:** ${contract.files.length}`,
      `**Corrections:** ${contract.corrections}`,
      `**Immutable blocked:** ${contract.immutableBlocked}`,
      `**Score before:** ${contract.scoreBefore ?? "—"}`,
      `**External deps:** ${contract.externalDependencies.length > 0 ? contract.externalDependencies.join(", ") : "—"}`,
      "",
      immutableBlocked ? "⚠ Some corrections target immutable facts — review required" : "",
    ].filter(Boolean).join("\n")

    if (args.save) saveReport(root, `contract-${Date.now()}.md`, text)

    return text
  },
})
