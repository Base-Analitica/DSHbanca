import { existsSync, readFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { loadState, addIteration, addSnapshot } from "../lib/state"
import { generateReport, saveReport } from "../lib/reports"
import { analyzeCitationDensity } from "../lib/citation"
const z = tool.schema

export const bancaLoop = tool({
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
        return `🔴 circuit breaker: last 3 loops same score (${scores[0]}). Manual intervention required.`
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
        addIteration(root, "loop-oscillation", state.currentScore, state.currentScore, "rollback")
        return `🔴 circuit breaker: score oscillation. Score ${s0} → ${s1} → ${s2}. Manual intervention required.`
      }
    }

    const scoreBefore = state.currentScore

    // Phase: audit (canonical citation-density heuristic)
    const content = readFileSync(paths.main, "utf-8")
    const citation = analyzeCitationDensity(content)
    const currentScore = citation.score

    // Phase: decide
    if (currentScore >= target) {
      addIteration(root, "loop-approve", scoreBefore, currentScore, "ok")
      return [
        `Score: ${currentScore} ≥ target ${target}`,
        "✓ Target reached. No corrections needed.",
      ].join("\n")
    }

    // Phase: snapshot
    const snapLabel = `loop-${Date.now()}`
    const snapDir = join(root, ".banca", "snapshots", snapLabel)
    mkdirSync(snapDir, { recursive: true })
    addSnapshot(root, snapLabel, scoreBefore)

    const results: string[] = [
      `Loop iteration`,
      `Score: ${scoreBefore ?? "—"} → target ${target}`,
      `Snapshot: ${snapLabel}`,
      `Citations: ${citation.citedParagraphs}/${citation.totalParagraphs} (${(100 - citation.percentWithoutCitation).toFixed(1)}%)`,
    ]

    if (currentScore < target) {
      results.push(`Need: ${(target - currentScore).toFixed(1)} more points`)
    }

    // save report
    const report = generateReport(`LOOP — ${snapLabel}`, [
      { title: "Context", body: `Score before: ${scoreBefore ?? "—"}\nTarget: ${target}\nCitations: ${citation.citedParagraphs}/${citation.totalParagraphs}` },
      { title: "Next Steps", body: "Run /banca:auditar for detailed findings, then /banca:corrigir with specific corrections." },
    ])
    saveReport(root, `loop-${snapLabel}.md`, report)

    addIteration(root, "loop", scoreBefore, currentScore, "ok")

    results.push(`Report: .banca/reports/loop-${snapLabel}.md`)

    return results.join("\n")
  },
})
