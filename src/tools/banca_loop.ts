import { lstatSync, readFileSync, type Stats } from "node:fs"
import { join, resolve } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig, type ProjectConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { loadState, addIteration } from "../lib/state"
import { createSnapshot, SnapshotCaptureError, SnapshotConflictError } from "../lib/snapshot"
import { generateReport, saveReport } from "../lib/reports"
import { analyzeCitationDensity } from "../lib/citation"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  resolveInsideRoot,
  resolveRealInsideRoot,
} from "../lib/safe_paths"

/**
 * Fronteira de apresentação dos scores lidos do state compartilhado.
 *
 * `loadState` lê JSON sem validação runtime: `currentScore` e os `scoreAfter`
 * históricos podem ser qualquer valor JSON. Somente números finitos são
 * apresentados como score; ausência é `—`; qualquer outro valor é declarado
 * inválido sem ecoar o conteúdo, que poderia injetar headings, campos ou
 * declarações acadêmicas no retorno e no relatório persistido.
 *
 * Isto é apresentação apenas: o contrato numérico do state, a persistência
 * histórica e a lógica dos circuit breakers permanecem inalterados.
 */
function renderRecordedScore(score: unknown): string {
  if (typeof score === "number" && Number.isFinite(score)) return String(score)
  if (score === null || score === undefined) return "—"
  return "invalid or unavailable in shared state"
}

/**
 * Canonical read confinement for issue #163 (same containment class as the
 * #132 protection in `banca_checklist`).
 *
 * `resolveManuscriptPaths` is lexical: `existsSync`/`readFileSync` would follow
 * a symbolic link planted at the configured main file (or in an ancestor /
 * `manuscript.root`) and read bytes from outside the workspace. Before any
 * read, iteration, marker or report, the configured manuscript root and the
 * main destination are re-resolved with the existing canonical helper
 * `resolveRealInsideRoot`, rooted at the project workspace — never at the
 * configured root's own target, so a redirected root cannot become a new
 * implicitly authorized root.
 *
 * A legitimate absent main file keeps its historical `main file not found`
 * behavior. Broken links, escaping links, non-regular destinations and
 * destinations that cannot be inspected fail closed with a fixed sanitized
 * message that echoes no path, link target or file content.
 *
 * A residual TOCTOU window remains between the canonical inspection and the
 * read: the guarantee holds for a filesystem that is not concurrently mutated
 * by another process. This is a read-boundary check, not a sandbox, permission
 * engine or host trust-model change.
 */
const MAIN_MANUSCRIPT_ORIGIN_REFUSAL =
  "blocked: main manuscript origin is outside the workspace, follows an unsafe symbolic link, or is not a regular file; no score, iteration, marker or report was produced."

const MAIN_MANUSCRIPT_READ_REFUSAL =
  "blocked: main manuscript destination could not be read safely; no score, iteration, marker or report was produced."

/**
 * Filesystem errno values that are expected failures of reading an already
 * inspected destination. They become a controlled sanitized refusal; unexpected
 * errors (including programming defects) are rethrown unchanged.
 */
const EXPECTED_MAIN_READ_FAILURE_CODES = new Set([
  "EACCES",
  "EPERM",
  "ENOENT",
  "EISDIR",
  "ELOOP",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENAMETOOLONG",
  "ESTALE",
])

/**
 * Read the canonical main file. A verified-present regular file that can no
 * longer be read (for example EACCES, or ENOENT after a concurrent change) is a
 * controlled failure: it never leaks the raw system message/path and never
 * produces a partial score. No state mutation happens before this read
 * (circuit breakers return early), so the refusal stays effect-free.
 */
function readMainManuscript(canonicalPath: string): string {
  try {
    return readFileSync(canonicalPath, "utf-8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (typeof code === "string" && EXPECTED_MAIN_READ_FAILURE_CODES.has(code)) {
      throw new PathTraversalError("main manuscript destination could not be read")
    }
    throw err
  }
}

type MainManuscriptPreflight =
  | { status: "missing"; mainPath: string }
  | { status: "present"; canonicalPath: string }

/**
 * Validate the configured manuscript root physically before chapter discovery
 * touches the filesystem. A missing root keeps its existing discovery
 * behavior; a redirect outside the workspace fails closed.
 */
function assertManuscriptRootConfined(workspaceRoot: string, configuredRoot: string): void {
  let lexicalRoot: string
  try {
    lexicalRoot = resolveInsideRoot(workspaceRoot, configuredRoot)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw new PathTraversalError("manuscript root is not a safe workspace-relative path")
    }
    throw err
  }
  try {
    resolveRealInsideRoot(workspaceRoot, lexicalRoot)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw new PathTraversalError("manuscript root physical destination is outside the workspace")
    }
    throw err
  }
}

/**
 * Resolve the configured main file to its canonical destination and report
 * only whether it is a present regular file. Missing leaves stay missing
 * (legitimate absence); external, broken-link, ancestor-link and non-regular
 * destinations fail closed before `readFileSync`; a verified regular file that
 * can no longer be read is refused by {@link readMainManuscript} with a
 * sanitized diagnostic.
 */
function inspectMainManuscript(workspaceRoot: string, config: ProjectConfig): MainManuscriptPreflight {
  assertManuscriptRootConfined(workspaceRoot, config.manuscript.root)
  const paths = resolveManuscriptPaths(workspaceRoot, config)
  let canonicalPath: string
  try {
    canonicalPath = resolveRealInsideRoot(workspaceRoot, paths.main)
  } catch (err) {
    if (err instanceof PathTraversalError) {
      throw new PathTraversalError("main manuscript destination is outside the workspace")
    }
    throw err
  }
  let stat: Stats
  try {
    stat = lstatSync(canonicalPath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing", mainPath: paths.main }
    throw new PathTraversalError("main manuscript destination cannot be inspected")
  }
  // Directories, FIFOs, sockets and devices are never opened: a blocking read
  // on a FIFO would hang the tool, and only regular files have manuscript bytes.
  if (!stat.isFile()) {
    throw new PathTraversalError("main manuscript destination is not a regular file")
  }
  return { status: "present", canonicalPath }
}

export const bancaLoop = defineBancaTool({
  description: "Runs an assisted loop step (checks target, takes snapshot, audits citations, prepares next steps). Implementation is preparatory/assisted and does not run autonomous corrections.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    maxIterations: z.number().optional().describe("Max iterations (default: 3) (preparatory loop, compatibility only)"),
    targetScore: z.number().optional().describe("Target score (default: from config)"),
    phase: z.string().optional().describe("Start from specific phase (preparatory loop, compatibility only)"),
  },
  execute: async (args, ctx) => {
    // Normalize the workspace root once at the tool boundary (issue #147). The
    // marker vault is built as `ensureRealDirInsideRoot(root, join(root, ...))`:
    // with a relative root the root was applied twice, so the marker manifest
    // was written to the duplicated directory while the snapshot was registered
    // in the true state — an announced process milestone the canonical vault
    // cannot serve. This is a lexical normalization only; canonical confinement,
    // state origin checks, snapshot/marker semantics and registration are
    // unchanged.
    const root = resolve(args.projectRoot || ctx.directory)
    const config = loadConfig(root)
    let main: MainManuscriptPreflight
    try {
      // Canonical read boundary (issue #163): the configured manuscript root
      // and the main file are validated physically before any state read,
      // iteration, marker or report. Refusals are sanitized and effect-free.
      main = inspectMainManuscript(root, config)
    } catch (err) {
      if (err instanceof PathTraversalError) return MAIN_MANUSCRIPT_ORIGIN_REFUSAL
      throw err
    }
    const maxIter = args.maxIterations || config.targetScore >= 9 ? 5 : 3
    const target = args.targetScore ?? config.targetScore

    if (main.status === "missing") return `main file not found: ${main.mainPath}`

    const state = loadState(root)
    const lastN = state.iterations.filter((i) => i.action === "loop").slice(-3)

    // circuit breaker: same score 3x
    if (lastN.length >= 3) {
      const scores = lastN.map((i) => i.scoreAfter)
      if (new Set(scores).size === 1 && scores[0] !== null) {
        addIteration(root, "loop-circuit-break", state.currentScore, state.currentScore, "failed")
        return [
          `🔴 circuit breaker: last 3 loops same score (${renderRecordedScore(scores[0])}).`,
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
        const oscillationScores: unknown[] = [s0, s1, s2]
        const oscillationDetail = oscillationScores.every(
          (score) => typeof score === "number" && Number.isFinite(score),
        )
          ? `Score ${oscillationScores.join(" → ")}.`
          : "Historical scores are invalid or unavailable in shared state; values are not rendered."
        return [
          `🔴 circuit breaker: score oscillation. ${oscillationDetail}`,
          'Process interrupted with status "failed"; no manuscript restoration was executed and none should be inferred.',
          "Additional evaluation/intervention is required before continuing.",
        ].join("\n")
      }
    }

    const scoreBefore = state.currentScore

    // Phase: audit (canonical citation-density heuristic)
    let content: string
    try {
      content = readMainManuscript(main.canonicalPath)
    } catch (err) {
      if (err instanceof PathTraversalError) return MAIN_MANUSCRIPT_READ_REFUSAL
      throw err
    }
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
      `Previous recorded score: ${renderRecordedScore(scoreBefore)}`,
      "Source: shared project state; origin not established.",
      `Current heuristic citation score: ${currentScore}`,
      "Scope: main manuscript only; lexical citation-density heuristic.",
      `Local heuristic target: ${target}`,
      `Snapshot: ${loopSnapshotLabel}`,
      `Citations: ${citation.citedParagraphs}/${citation.totalParagraphs} (${(100 - citation.percentWithoutCitation).toFixed(1)}%)`,
      `Local heuristic gap: ${(target - currentScore).toFixed(1)} point(s) below the local heuristic target`,
      "Marker (process milestone): non-restorable; no manuscript files were captured; this is not a recovery snapshot and does not enable restore or rollback.",
      "Preparatory result: not a complete academic audit, grade or approval; bibliographic keys are not validated; integral coverage is not proven.",
      "Next steps: run banca_auditar for detailed findings; corrections require explicit authorization; re-audit after authorized corrections.",
    ]

    // save report
    const report = generateReport(`LOOP — ${loopSnapshotLabel}`, [
      {
        title: "Context",
        body: [
          `Previous recorded score: ${renderRecordedScore(scoreBefore)}`,
          "Source: shared project state; origin not established.",
          `Current heuristic citation score: ${currentScore}`,
          "Scope: main manuscript only (lexical citation-density heuristic).",
          `Local heuristic target: ${target}`,
          `Citations: ${citation.citedParagraphs}/${citation.totalParagraphs}`,
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
