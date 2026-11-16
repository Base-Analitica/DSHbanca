import { lstatSync, readFileSync, writeFileSync, type Stats } from "node:fs"
import { join, resolve } from "node:path"
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
  AnalysisAuditConfirmationError,
  AnalysisFindingsStoreError,
  getAnalysisCheckpointRelativePath,
  loadAnalysisCheckpoint,
  loadAnalysisFindings,
  loadBatchAuditConfirmation,
  saveAnalysisCheckpoint,
} from "../lib/state"
import { verifyBatchConfirmationCoherence } from "../lib/analysis_audit_confirmation"

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

// ---------------------------------------------------------------------------
// Optional auxiliary project state (issue #154)
//
// `.banca/scorecard.md` and `.banca/knowledge.md` are optional data included in
// the context pack. They are read through the same canonical origin policy used
// by the configuration (#134) and state (#136) boundaries: the project root is
// normalized once, the destination is resolved with `resolveRealInsideRoot`,
// inspected with `lstatSync`, and only a regular file is opened. The preflight
// runs before the first checkpoint persistence/advance of a valid plan, so a
// refused origin cannot create or advance academic state or produce a pack.
//
// Categories stay distinct: a truly missing file is legitimate absence; an
// internal regular file (or an internal link allowed by the canonical policy)
// is read; an escaping/broken link, a non-directory ancestor, a non-regular
// destination or an inspection failure are controlled refusals; a present file
// that cannot be read is a controlled read refusal. Messages never embed the
// host path, a link target, external content or a raw filesystem diagnostic.
// ---------------------------------------------------------------------------

const OPTIONAL_STATE_FILES = ["scorecard.md", "knowledge.md"] as const

const OPTIONAL_STATE_ORIGIN_REFUSED_UNSAFE =
  "the auxiliary file origin is not an authorized regular file inside the workspace"
const OPTIONAL_STATE_ORIGIN_REFUSED_INSPECTION =
  "the auxiliary file origin could not be inspected safely"
const OPTIONAL_STATE_ORIGIN_REFUSED_READ =
  "the present auxiliary file could not be read"

/**
 * Expected failures of reading an already inspected regular file. They must
 * surface as a controlled refusal, never as legitimate absence.
 */
const EXPECTED_OPTIONAL_STATE_READ_FAILURES = new Set([
  "EACCES",
  "EPERM",
  "EISDIR",
  "ELOOP",
  "ENOENT",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENAMETOOLONG",
  "ESTALE",
])

type OptionalStateOriginCode =
  | "unsafe_origin"
  | "inspection_failed"
  | "unreadable_origin"

type OptionalStateFailure = {
  /** Public project-relative name; never an absolute host path. */
  file: string
  code: OptionalStateOriginCode
  reason: string
}

type OptionalStateOrigin =
  | { status: "absent" }
  | { status: "present"; content: string }
  | { status: "refused"; failure: OptionalStateFailure }

type OptionalStatePreflight =
  | { status: "ok"; parts: string[] }
  | { status: "refused"; failures: OptionalStateFailure[] }

/**
 * Inspect and read one optional auxiliary file.
 *
 * `absoluteRoot` is already normalized by the caller (`resolve`), so a relative
 * project root is never applied twice. The canonical destination is resolved by
 * the shared policy; a linked ancestor that stays inside the workspace is
 * allowed, while any link escaping it (or a broken/non-directory component) is
 * refused before a byte is read. Only a regular destination is opened:
 * directories, FIFOs, sockets and devices are never opened.
 *
 * Deterministic failures of the shared resolution (for example an unreadable or
 * non-directory `.banca` ancestor) surface as `unsafe_origin`, because
 * `resolveRealInsideRoot` wraps them in its own controlled error. The
 * `inspection_failed` category covers an `lstat` failure of the already
 * resolved destination, which is not deterministically reproducible without a
 * concurrent change.
 *
 * A residual TOCTOU window remains between this inspection and the read, so the
 * guarantee covers a filesystem not concurrently mutated by another process.
 * Hardlinks and sub-mounts are not distinguished beyond the regular-file check.
 */
function readOptionalStateOrigin(
  absoluteRoot: string,
  name: (typeof OPTIONAL_STATE_FILES)[number],
): OptionalStateOrigin {
  const publicFile = `.banca/${name}`
  const refused = (
    code: OptionalStateOriginCode,
    reason: string,
  ): OptionalStateOrigin => ({
    status: "refused",
    failure: { file: publicFile, code, reason },
  })

  let canonicalPath: string
  try {
    canonicalPath = resolveRealInsideRoot(
      absoluteRoot,
      join(absoluteRoot, ".banca", name),
    )
  } catch (error) {
    if (error instanceof PathTraversalError) {
      return refused("unsafe_origin", OPTIONAL_STATE_ORIGIN_REFUSED_UNSAFE)
    }
    throw error
  }

  let destination: Stats
  try {
    destination = lstatSync(canonicalPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { status: "absent" }
    if (typeof code === "string") {
      return refused(
        "inspection_failed",
        OPTIONAL_STATE_ORIGIN_REFUSED_INSPECTION,
      )
    }
    throw error
  }
  if (!destination.isFile()) {
    return refused("unsafe_origin", OPTIONAL_STATE_ORIGIN_REFUSED_UNSAFE)
  }

  let content: string
  try {
    content = readFileSync(canonicalPath, "utf-8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      typeof code === "string" &&
      EXPECTED_OPTIONAL_STATE_READ_FAILURES.has(code)
    ) {
      return refused("unreadable_origin", OPTIONAL_STATE_ORIGIN_REFUSED_READ)
    }
    throw error
  }
  return { status: "present", content }
}

/**
 * Preflight both optional files for a valid plan. Absence is omitted; any
 * refused origin produces a controlled refusal, even when the other file is
 * readable (its content is then not included anywhere).
 */
function preflightOptionalProjectState(
  absoluteRoot: string,
): OptionalStatePreflight {
  const parts: string[] = []
  const failures: OptionalStateFailure[] = []
  for (const name of OPTIONAL_STATE_FILES) {
    const origin = readOptionalStateOrigin(absoluteRoot, name)
    if (origin.status === "present") {
      parts.push(`\n${origin.content}\n`)
    } else if (origin.status === "refused") {
      failures.push(origin.failure)
    }
  }
  if (failures.length > 0) return { status: "refused", failures }
  return { status: "ok", parts }
}

/** Explicit, sanitized tool response for a refused optional origin. */
function formatOptionalStateRefusal(failures: OptionalStateFailure[]): string {
  const lines = [
    "context refused: auxiliary project state could not be read safely",
  ]
  for (const failure of failures) {
    lines.push(
      `file=${failure.file}`,
      `code=${failure.code}`,
      `reason=${failure.reason}`,
    )
  }
  return lines.join("\n")
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

    // Preflight the optional project state before the first checkpoint
    // persistence/advance of a valid plan (issue #154). A refused origin must
    // not create or advance academic state nor produce a context pack. The
    // blocked-plan path above keeps its existing precedence and result.
    //
    // For a valid plan this preflight intentionally precedes checkpoint loading
    // and validation: when an auxiliary refusal and a checkpoint/audit
    // diagnostic would both apply, the auxiliary refusal is reported first.
    // This is security-first and neither outcome changes persistent state.
    const absoluteRoot = resolve(root)
    const optionalState = preflightOptionalProjectState(absoluteRoot)
    if (optionalState.status === "refused") {
      return formatOptionalStateRefusal(optionalState.failures)
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
        const expectedNext = nextAnalysisBatch(plan, checkpoint)
        if (
          expectedNext !== null &&
          args.completedBatchId === expectedNext.batchId
        ) {
          let confirmation
          try {
            confirmation = loadBatchAuditConfirmation(
              root,
              checkpoint.planId,
              expectedNext.batchId,
            )
          } catch (err) {
            if (err instanceof AnalysisAuditConfirmationError) {
              throw new AnalysisCheckpointError(err.code, err.message)
            }
            throw err
          }
          if (confirmation === null) {
            throw new AnalysisCheckpointError(
              "missing_batch_audit",
              `cannot advance checkpoint: audit confirmation missing for batch ${expectedNext.batchId}`,
            )
          }
          if (
            confirmation.planId !== checkpoint.planId ||
            confirmation.manuscriptFingerprint !== plan.fingerprint ||
            confirmation.batchId !== expectedNext.batchId ||
            confirmation.batchIndex !== expectedNext.index
          ) {
            throw new AnalysisCheckpointError(
              "incompatible_batch_audit",
              `persisted audit confirmation for batch ${expectedNext.batchId} is incompatible with current plan`,
            )
          }

          let findingsStore
          try {
            findingsStore = loadAnalysisFindings(root, checkpoint.planId)
          } catch (err) {
            if (err instanceof AnalysisFindingsStoreError) {
              throw new AnalysisCheckpointError(err.code, err.message)
            }
            throw err
          }
          if (findingsStore === null) {
            throw new AnalysisCheckpointError(
              "missing_findings_store",
              `cannot advance checkpoint: findings store missing for plan ${checkpoint.planId}`,
            )
          }
          if (findingsStore.manuscriptFingerprint !== plan.fingerprint) {
            throw new AnalysisCheckpointError(
              "incompatible_fingerprint",
              "findings store manuscriptFingerprint does not match the current plan fingerprint",
            )
          }
          if (findingsStore.planId !== checkpoint.planId) {
            throw new AnalysisCheckpointError(
              "incompatible_plan",
              "findings store planId does not match the current plan identity",
            )
          }

          const batchFindings = findingsStore.findings.filter(
            (f) => f.batchId === expectedNext.batchId,
          )
          try {
            verifyBatchConfirmationCoherence(confirmation, batchFindings)
          } catch (err) {
            if (err instanceof AnalysisAuditConfirmationError) {
              throw new AnalysisCheckpointError(err.code, err.message)
            }
            throw err
          }
        }
        checkpoint = completeAnalysisBatch(
          plan,
          checkpoint,
          args.completedBatchId,
        )
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
    if (optionalState.parts.length > 0) {
      parts.push(`## Project state\n`)
      parts.push(...optionalState.parts)
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
