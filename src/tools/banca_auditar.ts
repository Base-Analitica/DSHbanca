/**
 * Adapter: validate and persist findings for one exhaustive canonical analysis batch.
 *
 * Loads the canonical manuscript + exhaustive plan, checks fingerprint and
 * batchId against the live plan, validates each finding exclusively via
 * `createAnalysisFinding`, merges with the plan-scoped store via
 * `mergeAnalysisFindings`, and persists under `.banca/analysis/findings/<planId>.json`.
 *
 * Never advances checkpoint, scores, synthesizes the manuscript, or runs a model.
 *
 * Error text is fixed or taken from shared contracts. This tool does not
 * re-sanitize diagnostics or publish raw exception messages.
 */

import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { loadCanonicalLatexManuscript } from "../lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../lib/analysis_coverage"
import { computePlanIdentity } from "../lib/analysis_checkpoint"
import {
  AnalysisFindingError,
  createAnalysisFinding,
  mergeAnalysisFindings,
  validateAnalysisFindingsForPlan,
  type AnalysisFinding,
} from "../lib/analysis_findings"
import {
  ANALYSIS_FINDINGS_STORE_VERSION,
  AnalysisFindingsStoreError,
  getAnalysisFindingsRelativePath,
  loadAnalysisFindings,
  saveAnalysisFindings,
  type AnalysisFindingsStoreV1,
} from "../lib/state"

const z = tool.schema

/** Stable receipt kind/version for successful batch finding validation + persistence. */
export const AUDIT_RECEIPT_KIND = "openbanca-audit-receipt-v2" as const

/**
 * Explicit disclaimer: structural validation + persistence is not academic proof.
 * Included on every successful receipt (including zero findings).
 */
export const AUDIT_RECEIPT_DISCLAIMER =
  "Persistence stores validated findings for one canonical exhaustive plan batch. " +
  "It does not prove model execution, advance checkpoint, prove completed " +
  "manuscript coverage, or represent a grade, approval, or academic quality."

export interface AuditFindingArg {
  category: string
  severity: string
  claim: string
  evidence: string
  file: string
  startLine: number
  endLine: number
  sectionId: string
}

export interface AuditReceiptPersistence {
  version: typeof ANALYSIS_FINDINGS_STORE_VERSION
  path: string
  previousCount: number
  addedCount: number
  duplicateCount: number
  totalCount: number
}

export interface AuditReceipt {
  kind: typeof AUDIT_RECEIPT_KIND
  planId: string
  manuscriptFingerprint: string
  batchId: string
  batchIndex: number
  acceptedCount: number
  findings: AnalysisFinding[]
  persistence: AuditReceiptPersistence
  disclaimer: typeof AUDIT_RECEIPT_DISCLAIMER
}

const FindingArgSchema = z.object({
  category: z.string().describe("Finding category"),
  severity: z.string().describe("Finding severity"),
  claim: z.string().describe("Claim text"),
  evidence: z.string().describe("Evidence text"),
  file: z.string().describe("Public POSIX path of the source file in the batch"),
  startLine: z.number().describe("Inclusive start line (1-based)"),
  endLine: z.number().describe("Inclusive end line (1-based)"),
  sectionId: z.string().describe("Section identifier"),
})

function formatError(code: string, message: string): string {
  return [
    "audit validation error",
    `code=${code}`,
    `message=${message}`,
  ].join("\n")
}

export const bancaAuditar = tool({
  description:
    "Validate and persist findings for one exhaustive canonical analysis batch. " +
    "Returns a structured receipt; does not score, advance checkpoint, or run a model.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    manuscriptFingerprint: z
      .string()
      .describe("Exact manuscript fingerprint of the current canonical plan"),
    batchId: z
      .string()
      .describe("Exact batchId present in the current exhaustive plan"),
    findings: z
      .array(FindingArgSchema)
      .describe(
        "Findings for this batch (category, severity, claim, evidence, file, lines, sectionId)",
      ),
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
      const maxCharactersPerBatch = config.analysis.maxCharactersPerBatch
      const manuscript = loadCanonicalLatexManuscript(root, config)
      plan = planExhaustiveAnalysisBatches(manuscript, maxCharactersPerBatch)
    } catch {
      return formatError(
        "unexpected",
        "an unexpected manuscript planning error occurred",
      )
    }

    if (plan.status === "blocked") {
      const diagSummary =
        plan.diagnostics.length > 0
          ? plan.diagnostics
              .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
              .join("; ")
          : "(none)"
      return formatError(
        "blocked_plan",
        `manuscript or exhaustive plan is incomplete; diagnostics: ${diagSummary}`,
      )
    }

    // Fingerprint must match exactly — no normalization or silent substitution.
    if (
      typeof args.manuscriptFingerprint !== "string" ||
      args.manuscriptFingerprint !== plan.fingerprint
    ) {
      return formatError(
        "fingerprint_mismatch",
        "manuscriptFingerprint does not match the current plan fingerprint",
      )
    }

    if (typeof args.batchId !== "string" || args.batchId.length === 0) {
      return formatError(
        "unknown_batch",
        "batchId must be a non-empty string present in the plan",
      )
    }

    const batch = plan.batches.find((b) => b.batchId === args.batchId)
    if (batch == null) {
      return formatError(
        "unknown_batch",
        `batchId is not present in the plan: ${args.batchId}`,
      )
    }

    if (!Array.isArray(args.findings)) {
      return formatError("invalid_input", "findings must be an array")
    }

    // Canonical plan identity from the shared checkpoint API (not recomputed ad hoc).
    let planId: string
    try {
      planId = computePlanIdentity(plan)
    } catch {
      return formatError(
        "invalid_plan",
        "the canonical plan identity could not be computed",
      )
    }

    // Atomic validation: any single invalid item fails the whole call (no write).
    const validated: AnalysisFinding[] = []
    for (let i = 0; i < args.findings.length; i++) {
      const item = args.findings[i] as AuditFindingArg
      try {
        const finding = createAnalysisFinding(plan, {
          category: item.category,
          severity: item.severity,
          claim: item.claim,
          evidence: item.evidence,
          file: item.file,
          startLine: item.startLine,
          endLine: item.endLine,
          sectionId: item.sectionId,
          manuscriptFingerprint: args.manuscriptFingerprint,
          batchId: args.batchId,
        })
        validated.push(finding)
      } catch (err) {
        if (err instanceof AnalysisFindingError) {
          return formatError(err.code, `findings[${i}]: ${err.message}`)
        }
        return formatError(
          "unexpected",
          `findings[${i}]: an unexpected finding validation error occurred`,
        )
      }
    }

    // Load existing store (or empty in memory). Fail closed without overwrite.
    let existingFindings: AnalysisFinding[] = []
    let previousCount = 0
    let relativePath: string
    try {
      relativePath = getAnalysisFindingsRelativePath(planId)
    } catch (err) {
      if (err instanceof AnalysisFindingsStoreError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected findings storage path error occurred",
      )
    }

    try {
      const loaded = loadAnalysisFindings(root, planId)
      if (loaded !== null) {
        if (loaded.manuscriptFingerprint !== plan.fingerprint) {
          return formatError(
            "incompatible_fingerprint",
            "existing findings store manuscriptFingerprint does not match the current plan fingerprint",
          )
        }
        if (loaded.planId !== planId) {
          return formatError(
            "incompatible_plan",
            "existing findings store planId does not match the current plan identity",
          )
        }

        // Revalidate every stored finding against the LIVE plan before merge.
        // Structural load is not sufficient: batch/file/line coverage can diverge
        // while findingId still matches the stored payload identity.
        try {
          existingFindings = validateAnalysisFindingsForPlan(
            plan,
            loaded.findings,
          )
        } catch {
          // Controlled message only — do not surface AnalysisFindingError text
          // or mutate the store file.
          return formatError(
            "invalid_stored_finding",
            "existing findings store is not valid against the current plan",
          )
        }
        previousCount = loaded.findings.length
      }
    } catch (err) {
      if (err instanceof AnalysisFindingsStoreError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected findings store load error occurred",
      )
    }

    // Exact merge: first-occurrence order, drop only identical duplicates.
    let merged: AnalysisFinding[]
    try {
      merged = mergeAnalysisFindings(existingFindings, validated)
    } catch (err) {
      if (err instanceof AnalysisFindingError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected findings merge error occurred",
      )
    }

    const acceptedCount = validated.length
    const totalCount = merged.length
    const addedCount = totalCount - previousCount
    const duplicateCount = acceptedCount - addedCount

    const store: AnalysisFindingsStoreV1 = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings: merged,
    }

    try {
      saveAnalysisFindings(root, store)
    } catch (err) {
      if (err instanceof AnalysisFindingsStoreError) {
        return formatError(err.code, err.message)
      }
      return formatError(
        "unexpected",
        "an unexpected findings store save error occurred",
      )
    }

    const receipt: AuditReceipt = {
      kind: AUDIT_RECEIPT_KIND,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      batchId: batch.batchId,
      batchIndex: batch.index,
      acceptedCount,
      findings: validated,
      persistence: {
        version: ANALYSIS_FINDINGS_STORE_VERSION,
        path: relativePath,
        previousCount,
        addedCount,
        duplicateCount,
        totalCount,
      },
      disclaimer: AUDIT_RECEIPT_DISCLAIMER,
    }

    // Stable structured JSON (no absolute paths, no score/approval wording).
    return JSON.stringify(receipt)
  },
})
