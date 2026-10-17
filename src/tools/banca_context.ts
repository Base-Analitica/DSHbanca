import { readFileSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { ensureRealDirInsideRoot, PathTraversalError, resolveRealInsideRoot } from "../lib/safe_paths"
import { loadCanonicalLatexManuscript } from "../lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../lib/analysis_coverage"
import {
  AnalysisCheckpointError,
  createAnalysisCheckpoint,
  completeAnalysisBatch,
  nextAnalysisBatch,
  type AnalysisCheckpoint,
} from "../lib/analysis_checkpoint"
import {
  getAnalysisCheckpointRelativePath,
  loadAnalysisCheckpoint,
  saveAnalysisCheckpoint,
} from "../lib/state"

/**
 * Format checkpoint errors for the tool surface.
 * AnalysisCheckpointError messages are assumed safe at source (no absolute paths).
 * Unexpected errors never surface raw host exception messages.
 */
function formatCheckpointError(err: unknown): string {
  if (err instanceof AnalysisCheckpointError) {
    return [
      "context checkpoint error",
      `code=${err.code}`,
      `message=${err.message}`,
    ].join("\n")
  }
  return [
    "context checkpoint error",
    `code=unexpected`,
    `message=an unexpected checkpoint error occurred`,
  ].join("\n")
}

export const bancaContext = defineBancaTool({
  description:
    "Build context pack from the canonical manuscript plan and the persisted exhaustive-analysis checkpoint. Progress advances only when completedBatchId is supplied.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    completedBatchId: z
      .string()
      .optional()
      .describe(
        "Optional batchId to mark complete before selecting the next batch. Omit to resume without advancing.",
      ),
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
      // Blocked plan: do not create or modify any checkpoint file.
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

    let checkpoint: AnalysisCheckpoint
    let checkpointRelPath: string
    try {
      // Identity for storage key comes from the canonical initial checkpoint.
      const initial = createAnalysisCheckpoint(plan)
      checkpointRelPath = getAnalysisCheckpointRelativePath(initial.planId)

      const loaded = loadAnalysisCheckpoint(root, initial.planId)
      if (loaded === null) {
        checkpoint = initial
        saveAnalysisCheckpoint(root, checkpoint)
      } else {
        checkpoint = loaded
      }

      // Validate loaded/created checkpoint against the plan via public APIs.
      // completeAnalysisBatch / nextAnalysisBatch both assert compatibility.
      // When completedBatchId is present (including empty string), always route
      // through completeAnalysisBatch so invalid_batch_id is returned for "".
      // Only true omission/undefined resumes without advancing.
      if (args.completedBatchId !== undefined) {
        checkpoint = completeAnalysisBatch(plan, checkpoint, args.completedBatchId)
        saveAnalysisCheckpoint(root, checkpoint)
      } else {
        // Resume-only: force validation without advancing.
        nextAnalysisBatch(plan, checkpoint)
      }
    } catch (err) {
      return formatCheckpointError(err)
    }

    // Next batch after optional advance (null when complete / empty).
    let nextBatch
    try {
      nextBatch = nextAnalysisBatch(plan, checkpoint)
    } catch (err) {
      return formatCheckpointError(err)
    }

    const optionalParts: string[] = []
    for (const p of [join(root, ".banca", "scorecard.md"), join(root, ".banca", "knowledge.md")]) {
      if (existsSync(p)) optionalParts.push(`\n${readFileSync(p, "utf-8")}\n`)
    }

    const batchMeta =
      nextBatch === null
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
            batchId: nextBatch.batchId,
            batchIndex: nextBatch.index,
            batchCharacters: nextBatch.characters,
            chunks: nextBatch.chunks.map((c) => ({
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
        // Public project-relative path only (never absolute).
        path: checkpointRelPath,
        persisted: true,
      },
      batch: {
        batchId: batchMeta.batchId,
        index: batchMeta.batchIndex,
        totalBatches: plan.coverage.batchCount,
        characters: batchMeta.batchCharacters,
        // Coverage of the persisted checkpoint (progress so far), not a claim of academic quality.
        coveragePercent: checkpoint.coveragePercent,
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

    const coverageDisclaimer =
      "This reports checkpoint/coverage progress only; it does not prove model run, findings, or academic analysis."

    if (nextBatch !== null) {
      parts.push(
        `## Next exhaustive batch (${nextBatch.batchId})\n`,
        `_Checkpoint ${checkpoint.state}: completed ${checkpoint.completedBatches}/${checkpoint.totalBatches} batches, coverage ${checkpoint.coveragePercent}%. Persisted at \`${checkpointRelPath}\`. ${coverageDisclaimer}_\n`,
      )
      for (const chunk of nextBatch.chunks) {
        parts.push(
          `### chunk ${chunk.index} — ${chunk.source.file}` +
            ` L${chunk.source.startLine}-${chunk.source.endLine}` +
            ` off ${chunk.source.startOffset}-${chunk.source.endOffset}\n\n` +
            `\`\`\`latex\n${chunk.text}\n\`\`\`\n`,
        )
      }
    } else if (checkpoint.state === "complete" && checkpoint.totalBatches === 0) {
      parts.push(
        `## Checkpoint coverage complete\n\n` +
          `_Empty complete manuscript: zero batches, coverage 100%. Checkpoint persisted at \`${checkpointRelPath}\`. ${coverageDisclaimer}_\n`,
      )
    } else {
      parts.push(
        `## Checkpoint coverage complete\n\n` +
          `_All ${checkpoint.totalBatches} batches completed in the checkpoint; coverage ${checkpoint.coveragePercent}%. Checkpoint persisted at \`${checkpointRelPath}\`. No next batch. ${coverageDisclaimer}_\n`,
      )
    }

    // Optional project state; must not change batch identity or order.
    if (optionalParts.length > 0) {
      parts.push(`## Project state\n`)
      parts.push(...optionalParts)
    }

    let out = ""
    try {
      const ctxDir = ensureRealDirInsideRoot(root, join(root, ".banca", "context"))
      out = resolveRealInsideRoot(root, join(ctxDir, `context-${Date.now()}.md`))
      writeFileSync(out, parts.join("\n"), "utf-8")
    } catch (err) {
      if (err instanceof PathTraversalError) return "context blocked: context pack path escapes workspace root"
      throw err
    }
    return `context → ${out}`
  },
})
