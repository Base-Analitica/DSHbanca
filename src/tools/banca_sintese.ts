/**
 * Read-only adapter: load live plan + persisted checkpoint + findings store,
 * then return validated GlobalAnalysisSynthesisInputV1 via the shared primitive.
 *
 * Prepares data for an OpenCode agent. Does not call a model, produce semantic
 * synthesis, compute score, advance checkpoints, or write any files.
 *
 * Error text is fixed or taken from shared contracts. This tool never surfaces
 * raw host exception messages, absolute paths, claim, or evidence content.
 */

import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { loadCanonicalLatexManuscript } from "../lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../lib/analysis_coverage"
import {
  AnalysisCheckpointError,
  computePlanIdentity,
} from "../lib/analysis_checkpoint"
import {
  AnalysisSynthesisError,
  createGlobalAnalysisSynthesisInput,
} from "../lib/analysis_synthesis"
import {
  AnalysisFindingsStoreError,
  loadAnalysisCheckpoint,
  loadAnalysisFindings,
} from "../lib/state"


function formatError(code: string, message: string): string {
  return [
    "synthesis input error",
    `code=${code}`,
    `message=${message}`,
  ].join("\n")
}

export const bancaSintese = defineBancaTool({
  description:
    "Load the live exhaustive plan with the persisted complete checkpoint and " +
    "findings store, then return validated global analysis synthesis input JSON. " +
    "Read-only: does not score, synthesize, advance checkpoint, or run a model.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    // Fail closed: never read ctx.directory when ctx is omitted, and never
    // proceed with an unresolved/whitespace-only project root.
    const root = args.projectRoot || ctx?.directory
    if (typeof root !== "string" || root.trim().length === 0) {
      return formatError(
        "invalid_project_root",
        "project root could not be resolved from arguments or context",
      )
    }

    let plan
    try {
      const config = loadConfig(root)
      const manuscript = loadCanonicalLatexManuscript(root, config)
      plan = planExhaustiveAnalysisBatches(
        manuscript,
        config.analysis.maxCharactersPerBatch,
      )
    } catch {
      return formatError(
        "unexpected",
        "an unexpected manuscript planning error occurred",
      )
    }

    let planId: string
    try {
      planId = computePlanIdentity(plan)
    } catch (err) {
      if (err instanceof AnalysisCheckpointError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected plan identity error occurred",
      )
    }

    let checkpoint
    try {
      checkpoint = loadAnalysisCheckpoint(root, planId)
    } catch (err) {
      if (err instanceof AnalysisCheckpointError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected checkpoint load error occurred",
      )
    }

    if (checkpoint === null) {
      return formatError(
        "missing_checkpoint",
        "no persisted analysis checkpoint exists for the current plan",
      )
    }

    let store
    try {
      store = loadAnalysisFindings(root, planId)
    } catch (err) {
      if (err instanceof AnalysisFindingsStoreError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected findings store load error occurred",
      )
    }

    if (store === null) {
      return formatError(
        "missing_findings",
        "no persisted findings store exists for the current plan",
      )
    }

    // Primitive receives findings array only — confirm store envelope fingerprint
    // against the live plan before extracting. Do not re-validate individual
    // findings, coverage, counters, batches, or provenance here.
    if (store.manuscriptFingerprint !== plan.fingerprint) {
      return formatError(
        "incompatible_fingerprint",
        "findings store manuscriptFingerprint does not match the current plan fingerprint",
      )
    }

    try {
      const input = createGlobalAnalysisSynthesisInput(
        plan,
        checkpoint,
        store.findings,
      )
      return JSON.stringify(input)
    } catch (err) {
      if (err instanceof AnalysisSynthesisError) {
        return formatError(err.code, err.message)
      }
      if (err instanceof AnalysisCheckpointError) {
        return formatError(err.code, err.message)
      }
      if (err instanceof AnalysisFindingsStoreError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected synthesis input error occurred",
      )
    }
  },
})
