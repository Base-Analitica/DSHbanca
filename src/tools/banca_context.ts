import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { loadCanonicalLatexManuscript } from "../lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../lib/analysis_coverage"
import {
  createAnalysisCheckpoint,
  nextAnalysisBatch,
  type AnalysisCheckpoint,
} from "../lib/analysis_checkpoint"
const z = tool.schema

export const bancaContext = tool({
  description: "Build context pack from project state for agents.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const maxCharactersPerBatch = config.analysis.maxCharactersPerBatch

    const manuscript = loadCanonicalLatexManuscript(root, config)
    const plan = planExhaustiveAnalysisBatches(manuscript, maxCharactersPerBatch)
    // Shallow copy of canonical diagnostics — path safety belongs to the loader.
    const diagnostics = plan.diagnostics.map((d) => ({ ...d }))

    if (plan.status === "blocked") {
      const diagSummary = diagnostics
        .map((d) => `${d.code}: ${d.message}`)
        .join("; ")
      return [
        "context blocked: manuscript or exhaustive plan is incomplete",
        `status=${plan.status}`,
        `fingerprint=null`,
        `strategy=${plan.strategy}`,
        `batchCount=0`,
        `coveragePercent=0`,
        diagnostics.length > 0 ? `diagnostics: ${diagSummary}` : "diagnostics: (none)",
      ].join("\n")
    }

    // Complete plan (including empty document): in-memory checkpoint only — never persisted.
    const checkpoint: AnalysisCheckpoint = createAnalysisCheckpoint(plan)
    const firstBatch = nextAnalysisBatch(plan, checkpoint)

    const optionalParts: string[] = []
    for (const p of [join(root, ".banca", "scorecard.md"), join(root, ".banca", "knowledge.md")]) {
      if (existsSync(p)) optionalParts.push(`\n${readFileSync(p, "utf-8")}\n`)
    }

    const batchMeta =
      firstBatch === null
        ? {
            batchId: null as string | null,
            batchIndex: null as number | null,
            batchCharacters: 0,
            chunks: [] as Array<{
              index: number
              text: string
              source: {
                file: string
                startLine: number
                endLine: number
                sourceSpanIndex: number
                startOffset: number
                endOffset: number
              }
            }>,
          }
        : {
            batchId: firstBatch.batchId,
            batchIndex: firstBatch.index,
            batchCharacters: firstBatch.characters,
            chunks: firstBatch.chunks.map((c) => ({
              index: c.index,
              text: c.text,
              source: {
                file: c.source.file,
                startLine: c.source.startLine,
                endLine: c.source.endLine,
                sourceSpanIndex: c.source.sourceSpanIndex,
                startOffset: c.source.startOffset,
                endOffset: c.source.endOffset,
              },
            })),
          }

    const metadata = {
      kind: "openbanca-context-pack-v1",
      generatedAt: new Date().toISOString(),
      manuscript: {
        fingerprint: plan.fingerprint,
        complete: manuscript.complete,
        rootFile: manuscript.rootFile,
      },
      plan: {
        status: plan.status,
        strategy: plan.strategy,
        planId: checkpoint.planId,
        batchCount: plan.coverage.batchCount,
        totalCharacters: plan.coverage.totalCharacters,
        plannedCharacters: plan.coverage.plannedCharacters,
        coveragePercent: plan.coverage.coveragePercent,
      },
      checkpoint: {
        version: checkpoint.version,
        planId: checkpoint.planId,
        state: checkpoint.state,
        totalBatches: checkpoint.totalBatches,
        completedBatches: checkpoint.completedBatches,
        totalCharacters: checkpoint.totalCharacters,
        completedCharacters: checkpoint.completedCharacters,
        coveragePercent: checkpoint.coveragePercent,
      },
      batch: {
        batchId: batchMeta.batchId,
        index: batchMeta.batchIndex,
        totalBatches: plan.coverage.batchCount,
        characters: batchMeta.batchCharacters,
        // Initial coverage before any batch is marked complete.
        initialCoveragePercent: checkpoint.coveragePercent,
      },
      chunks: batchMeta.chunks.map((c) => ({
        index: c.index,
        file: c.source.file,
        startLine: c.source.startLine,
        endLine: c.source.endLine,
        sourceSpanIndex: c.source.sourceSpanIndex,
        startOffset: c.source.startOffset,
        endOffset: c.source.endOffset,
        characters: c.text.length,
      })),
      diagnostics,
      analysis: {
        coverageMode: config.analysis.coverageMode,
        maxCharactersPerBatch,
      },
    }

    const parts: string[] = [
      `# Context Pack — ${metadata.generatedAt}\n`,
      `## Canonical analysis metadata\n`,
      `\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n`,
    ]

    if (firstBatch !== null) {
      parts.push(`## First exhaustive batch (${firstBatch.batchId})\n`)
      for (const chunk of firstBatch.chunks) {
        parts.push(
          `### chunk ${chunk.index} — ${chunk.source.file}` +
            ` L${chunk.source.startLine}-${chunk.source.endLine}` +
            ` off ${chunk.source.startOffset}-${chunk.source.endOffset}\n\n` +
            `\`\`\`latex\n${chunk.text}\n\`\`\`\n`,
        )
      }
    } else {
      parts.push(
        `## First exhaustive batch\n\n` +
          `_Empty complete manuscript: zero batches, coverage 100%._\n`,
      )
    }

    // Optional project state; must not change batch identity or order.
    if (optionalParts.length > 0) {
      parts.push(`## Project state\n`)
      parts.push(...optionalParts)
    }

    const ctxDir = join(root, ".banca", "context")
    mkdirSync(ctxDir, { recursive: true })
    const out = join(ctxDir, `context-${Date.now()}.md`)
    writeFileSync(out, parts.join("\n"), "utf-8")
    return `context → ${out}`
  },
})
