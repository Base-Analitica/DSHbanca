import { existsSync, readFileSync, writeFileSync, cpSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths, isPathProtected, isPathAllowed, globToRegex, toPosixPath } from "../lib/paths"
import { resolveInsideRoot, relativeInsideRoot, PathTraversalError } from "../lib/safe_paths"
import { loadState, saveState, addIteration } from "../lib/state"
const z = tool.schema

const CorrectionSchema = z.object({
  file: z.string(),
  oldText: z.string(),
  newText: z.string(),
})

export const bancaCorrigir = tool({
  description: "Apply corrections with snapshot + immutableFacts guard + regression check + state tracking.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    corrections: z.array(CorrectionSchema).describe("Corrections array"),
    previousScore: z.number().optional().describe("Score before correction (regression check)"),
    skipSnapshot: z.boolean().optional().describe("Skip snapshot creation"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    const corrections = args.corrections || []

    if (corrections.length === 0) return "no corrections provided"

    for (const c of corrections) {
      try {
        resolveInsideRoot(root, c.file)
      } catch {
        return `blocked: ${c.file} escapes project root`
      }
    }

    // immutableFacts guard: block edits to immutable files
    for (const c of corrections) {
      const relPath = toPosixPath(relativeInsideRoot(root, c.file))
      for (const fact of config.immutableFacts) {
        if (globToRegex(fact).test(relPath)) {
          return `blocked: ${c.file} is immutable (immutableFacts: "${fact}"). ${c.oldText.substring(0, 60)}...`
        }
      }
    }

    // snapshot
    if (!args.skipSnapshot) {
      const snapLabel = `pre-${Date.now()}`
      const snapDir = join(root, ".banca", "snapshots", snapLabel)
      resolveInsideRoot(join(root, ".banca", "snapshots"), snapLabel)
      mkdirSync(snapDir, { recursive: true })
      for (const c of corrections) {
        const fp = resolveInsideRoot(root, c.file)
        if (existsSync(fp)) {
          const rel = relativeInsideRoot(root, c.file)
          const dest = resolveInsideRoot(snapDir, rel)
          mkdirSync(dirname(dest), { recursive: true })
          cpSync(fp, dest)
        }
      }
    }

    const results: string[] = []
    for (const c of corrections) {
      const fp = resolveInsideRoot(root, c.file)
      if (!existsSync(fp)) { results.push(`✗ ${c.file}: not found`); continue }

      const canonizedRelPath = toPosixPath(relativeInsideRoot(root, c.file))
      if (isPathProtected(canonizedRelPath, config)) { results.push(`✗ ${c.file}: protected path`); continue }
      if (!isPathAllowed(canonizedRelPath, config)) { results.push(`✗ ${c.file}: not in allowed paths`); continue }

      const content = readFileSync(fp, "utf-8")
      if (!content.includes(c.oldText)) { results.push(`✗ ${c.file}: oldText not found`); continue }

      writeFileSync(fp, content.replace(c.oldText, c.newText), "utf-8")
      results.push(`✓ ${c.file}`)
    }

    // regression score check
    let curScore: number | null = null
    let regNote = ""
    if (args.previousScore !== undefined && existsSync(paths.main)) {
      const mainContent = readFileSync(paths.main, "utf-8")
      const paragraphs = mainContent.split(/\n\s*\n/).filter((p: string) => p.trim().length > 20)
      const citeRe = /\\cite(?:online)?\{[^}]+\}/g
      const withCit = paragraphs.filter((p: string) => { citeRe.lastIndex = 0; return citeRe.test(p) }).length
      const pct = paragraphs.length > 0 ? ((paragraphs.length - withCit) / paragraphs.length) * 100 : 0
      curScore = pct > 30 ? 4.0 : 8.0
      if (curScore < args.previousScore) {
        regNote = `\n⚠ Score dropped: ${args.previousScore} → ${curScore}`
      }
    }

    // externalDependencies: add note in results
    if (config.externalDependencies.length > 0) {
      results.push(`\nnote: ${config.externalDependencies.length} external dependencies — not counted as failures`)
    }

    // state tracking
    addIteration(root, "correction", args.previousScore ?? null, curScore, regNote ? "rollback" : "ok")

    return results.join("\n") + regNote
  },
})
