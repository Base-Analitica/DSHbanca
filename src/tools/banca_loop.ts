import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { loadState, addIteration } from "../lib/state"
import { createSnapshot, SnapshotCaptureError, SnapshotConflictError } from "../lib/snapshot"
import { generateReport, saveReport } from "../lib/reports"
import { analyzeCitationDensity } from "../lib/citation"
import { ensureRealDirInsideRoot, PathTraversalError, resolveRealInsideRoot } from "../lib/safe_paths"
export const bancaLoop = defineBancaTool({
  description: "Runs an assisted loop step (checks target, takes snapshot, audits citations, prepares next steps). Implementation is preparatory/assisted and does not run autonomous corrections.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    maxIterations: z.number().optional().describe("Max iterations (default: 3) (preparatory loop, compatibility only)"),
    targetScore: z.number().optional().describe("Target score (default: from config)"),
    phase: z.string().optional().describe("Start from specific phase (preparatory loop, compatibility only)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    const maxIter = args.maxIterations || config.targetScore >= 9 ? 5 : 3
    const target = args.targetScore ?? config.targetScore

    if (!existsSync(paths.main)) return `main file not found: ${paths.main}`

    const state = loadState(root)
    const lastN = state.iterations.filter((i) => i.action === "loop").slice(-3)

    // circuit breaker: same score 3x
    if (lastN.length >= 3) {
      const scores = lastN.map((i) => i.scoreAfter)
      if (new Set(scores).size === 1 && scores[0] !== null) {
        addIteration(root, "loop-circuit-break", state.currentScore, state.currentScore, "failed")
        return [
          `🔴 circuit breaker: last 3 loops same score (${scores[0]}).`,
          'Process interrupted with status "failed"; no manuscript restoration was executed. Manual intervention required.',
        ].join("\n")
      }
    }

    // circuit breaker: oscillation detected (real A-B-A pattern across the
    // last three loop iterations; equal consecutive scores are normal
    // progress, not oscillation)
    if (lastN.length >= 3) {
      const s0 = lastN[0].scoreAfter
      const s1 = lastN[1].scoreAfter
      const s2 = lastN[2].scoreAfter
      if (
        s0 !== null && s1 !== null && s2 !== null &&
        s0 === s2 && s0 !== s1
      ) {
        addIteration(root, "loop-oscillation", state.currentScore, state.currentScore, "failed")
        return [
          `🔴 circuit breaker: score oscillation. Score ${s0} → ${s1} → ${s2}.`,
          'Process interrupted with status "failed"; no manuscript restoration was executed and none should be inferred.',
          "Additional evaluation/intervention is required before continuing.",
        ].join("\n")
      }
    }

    const scoreBefore = state.currentScore

    // Phase: audit (canonical citation-density heuristic)
    const content = readFileSync(paths.main, "utf-8")
    const citation = analyzeCitationDensity(content)
    const currentScore = citation.score

    // Phase: decide
    if (currentScore >= target) {
      addIteration(root, "loop-heuristic-threshold", scoreBefore, currentScore, "ok")
      return [
        `Heuristic citation score: ${currentScore}`,
        `Local heuristic target: ${target}`,
        "✓ Local heuristic citation threshold reached.",
        "",
        "Scope: main manuscript only (lexical citation-density heuristic).",
        "This preparatory result is not a complete academic audit, not a grade and not an approval.",
        "Bibliographic keys are not validated; a citation threshold does not prove reference validity or integral manuscript coverage.",
        "Detailed audit (banca_auditar), findings and any authorized corrections remain necessary; this operation does not authorize corrections.",
      ].join("\n")
    }

    // Phase: snapshot. The central createSnapshot claims a collision-free
    // label (internal labels may collide within one millisecond) and registers
    // the recovery point only after the marker/manifest were completed. A loop
    // snapshot is an explicit `marker`: a process milestone without restorable
    // files, never presented as a manuscript recovery point.
    const snapLabel = `loop-${Date.now()}`
    let loopSnapshotLabel: string
    try {
      const snapshotsDir = ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))
      resolveRealInsideRoot(root, join(root, ".banca", "state.json"))
      loopSnapshotLabel = createSnapshot({
        root,
        snapshotsDir,
        label: snapLabel,
        candidates: [],
        labelPolicy: "unique",
        register: true,
        scoreBefore,
        kind: "marker",
      }).label
    } catch (err) {
      if (err instanceof PathTraversalError) return "blocked: workspace state paths escape project root"
      if (err instanceof SnapshotConflictError || err instanceof SnapshotCaptureError) {
        return "blocked: loop snapshot failed — iteration not recorded"
      }
      throw err
    }

    const results: string[] = [
      "Loop iteration",
      `Heuristic citation score before: ${scoreBefore ?? "—"} (local citation-density heuristic; main manuscript only)`,
      `Local heuristic target: ${target}`,
      `Snapshot: ${loopSnapshotLabel}`,
      `Citations: ${citation.citedParagraphs}/${citation.totalParagraphs} (${(100 - citation.percentWithoutCitation).toFixed(1)}%)`,
      `Local heuristic gap: ${(target - currentScore).toFixed(1)} point(s) below the local heuristic target`,
      "Marker (process milestone): non-restorable; no manuscript files were captured; this is not a recovery snapshot and does not enable restore or rollback.",
      "Scope: main manuscript only; lexical citation-density heuristic.",
      "Preparatory result: not a complete academic audit, grade or approval; bibliographic keys are not validated; integral coverage is not proven.",
      "Next steps: run banca_auditar for detailed findings; corrections require explicit authorization; re-audit after authorized corrections.",
    ]

    // save report
    const report = generateReport(`LOOP — ${loopSnapshotLabel}`, [
      {
        title: "Context",
        body: [
          `Heuristic citation score before: ${scoreBefore ?? "—"}`,
          `Local heuristic target: ${target}`,
          `Citations: ${citation.citedParagraphs}/${citation.totalParagraphs}`,
          "Scope: main manuscript only (lexical citation-density heuristic).",
          `Local heuristic gap: ${(target - currentScore).toFixed(1)} point(s) below the local heuristic target`,
        ].join("\n"),
      },
      {
        title: "Marker",
        body: [
          "Snapshot kind: marker (process milestone; non-restorable).",
          "Restorable content: none — no manuscript files were captured.",
          "This marker is not a recovery point and does not enable restore or rollback.",
        ].join("\n"),
      },
      {
        title: "Limitations",
        body: [
          "This preparatory result is not a complete academic audit, a grade or an approval.",
          "Bibliographic keys are not validated; citation presence does not prove reference validity.",
          "Integral manuscript coverage is not proven; chapters are not audited by this operation.",
          "This operation does not authorize corrections.",
        ].join("\n"),
      },
      {
        title: "Next Steps",
        body: "Run banca_auditar for detailed findings; corrections require explicit authorization; re-audit after authorized corrections.",
      },
    ])
    saveReport(root, `loop-${loopSnapshotLabel}.md`, report)

    addIteration(root, "loop", scoreBefore, currentScore, "ok")

    results.push(`Report: .banca/reports/loop-${loopSnapshotLabel}.md`)

    return results.join("\n")
  },
})
