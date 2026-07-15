import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  lstatSync,
  type Stats,
} from "node:fs"
import { join, dirname, resolve } from "node:path"
import { resolveInsideRoot } from "./safe_paths"
import {
  AnalysisCheckpointError,
  type AnalysisCheckpoint,
} from "./analysis_checkpoint"

export interface ProjectState {
  currentScore: number | null
  lastAudit: string | null
  lastLoop: string | null
  snapshots: Array<{
    id: string
    label: string
    createdAt: string
    scoreBefore: number | null
  }>
  iterations: Array<{
    date: string
    action: string
    scoreBefore: number | null
    scoreAfter: number | null
    status: "ok" | "rollback" | "failed"
  }>
}

export function getStatePath(projectRoot: string): string {
  return resolveInsideRoot(projectRoot, join(".banca", "state.json"))
}

export function loadState(projectRoot: string): ProjectState {
  const p = getStatePath(projectRoot)
  if (!existsSync(p)) return { currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] }
  try {
    return JSON.parse(readFileSync(p, "utf-8"))
  } catch {
    return { currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] }
  }
}

export function saveState(projectRoot: string, state: ProjectState): void {
  const p = getStatePath(projectRoot)
  const dir = dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(state, null, 2), "utf-8")
}

export function addIteration(
  projectRoot: string,
  action: string,
  scoreBefore: number | null,
  scoreAfter: number | null,
  status: "ok" | "rollback" | "failed",
): void {
  const state = loadState(projectRoot)
  state.iterations.push({ date: new Date().toISOString(), action, scoreBefore, scoreAfter, status })
  state.currentScore = scoreAfter ?? state.currentScore
  saveState(projectRoot, state)
}

export function addSnapshot(projectRoot: string, label: string, scoreBefore: number | null): string {
  const state = loadState(projectRoot)
  const id = `snap-${Date.now()}`
  state.snapshots.push({ id, label, createdAt: new Date().toISOString(), scoreBefore })
  saveState(projectRoot, state)
  return id
}

// ---------------------------------------------------------------------------
// AnalysisCheckpoint persistence (dedicated; not part of ProjectState)
// Path: .banca/analysis/checkpoints/<planId>.json
// ---------------------------------------------------------------------------

/** SHA-256 hex plan identity (64 lowercase hex chars). */
const PLAN_ID_HEX_RE = /^[a-f0-9]{64}$/

const CHECKPOINT_DIR_PARTS = [".banca", "analysis", "checkpoints"] as const

/**
 * Public relative path of a plan checkpoint (POSIX-style, project-relative).
 * Validates planId as SHA-256 hex before use.
 */
export function getAnalysisCheckpointRelativePath(planId: string): string {
  assertValidPlanId(planId)
  return `.banca/analysis/checkpoints/${planId}.json`
}

function assertValidPlanId(planId: string): void {
  if (typeof planId !== "string" || !PLAN_ID_HEX_RE.test(planId)) {
    throw new AnalysisCheckpointError(
      "invalid_plan_id",
      "planId must be a 64-character lowercase hex SHA-256 digest",
    )
  }
}

/**
 * Resolve absolute checkpoint path inside projectRoot.
 * planId is validated as hex; path is constrained by resolveInsideRoot.
 */
function resolveCheckpointAbsPath(projectRoot: string, planId: string): string {
  assertValidPlanId(planId)
  return resolveInsideRoot(
    projectRoot,
    join(".banca", "analysis", "checkpoints", `${planId}.json`),
  )
}

/**
 * lstat without following links. Returns null on ENOENT.
 * Broken symlinks still yield Stats with isSymbolicLink() === true
 * (unlike existsSync, which is false for dangling links).
 */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") return null
    // Generic message only — never leak absolute paths or host err.message.
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "failed to lstat checkpoint path",
    )
  }
}

function refuseSymlink(part: string): never {
  throw new AnalysisCheckpointError(
    "symlink_refused",
    `refusing symbolic link in checkpoint storage path: ${part}`,
  )
}

/**
 * Walk storage directory components under projectRoot.
 * Refuse any symlink component (live or broken).
 * Creates missing intermediate directories one level at a time (no symlink follow).
 */
function ensureCheckpointDirNoSymlinks(projectRoot: string): string {
  let current = resolve(projectRoot)
  for (const part of CHECKPOINT_DIR_PARTS) {
    current = join(current, part)
    const st = lstatOrNull(current)
    if (st === null) {
      mkdirSync(current, { recursive: false })
      continue
    }
    if (st.isSymbolicLink()) {
      refuseSymlink(part)
    }
    if (!st.isDirectory()) {
      throw new AnalysisCheckpointError(
        "invalid_checkpoint_storage",
        `checkpoint storage path component is not a directory: ${part}`,
      )
    }
  }
  return current
}

/**
 * Assert that every existing segment of the checkpoint relative path is not a symlink
 * (including broken symlinks, which lstat sees but existsSync does not).
 * Does not create directories.
 * @returns absolute path of the checkpoint file and lstat of the final segment (or null if absent)
 */
function inspectCheckpointPath(
  projectRoot: string,
  planId: string,
): { absPath: string; finalStat: Stats | null } {
  assertValidPlanId(planId)
  let current = resolve(projectRoot)
  const parts = [...CHECKPOINT_DIR_PARTS, `${planId}.json`]
  let finalStat: Stats | null = null
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    current = join(current, part)
    const st = lstatOrNull(current)
    if (st === null) {
      // Segment absent: no further components can exist as links on this path.
      finalStat = null
      break
    }
    if (st.isSymbolicLink()) {
      refuseSymlink(part)
    }
    if (i < parts.length - 1 && !st.isDirectory()) {
      throw new AnalysisCheckpointError(
        "invalid_checkpoint_storage",
        `checkpoint storage path component is not a directory: ${part}`,
      )
    }
    if (i === parts.length - 1) {
      finalStat = st
    }
  }
  return {
    absPath: resolveCheckpointAbsPath(projectRoot, planId),
    finalStat,
  }
}

/**
 * Load the AnalysisCheckpoint for `planId`, or null when the file is absent.
 * Fail-closed on symlink storage (including broken links), malformed JSON, or planId mismatch.
 * Does not invent an empty checkpoint on parse failure.
 */
export function loadAnalysisCheckpoint(
  projectRoot: string,
  planId: string,
): AnalysisCheckpoint | null {
  assertValidPlanId(planId)
  const { absPath, finalStat } = inspectCheckpointPath(projectRoot, planId)
  if (finalStat === null) {
    return null
  }
  // Symlinks already refused in inspectCheckpointPath; still require a regular file.
  if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
    if (finalStat.isSymbolicLink()) {
      throw new AnalysisCheckpointError(
        "symlink_refused",
        "refusing to load checkpoint through a symbolic link",
      )
    }
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "checkpoint path exists but is not a regular file",
    )
  }

  let raw: string
  try {
    raw = readFileSync(absPath, "utf-8")
  } catch {
    // Generic message only — never leak absolute paths or host err.message.
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "failed to read checkpoint file",
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint file contains malformed JSON",
    )
  }

  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint file must contain a JSON object",
    )
  }

  const obj = parsed as Record<string, unknown>
  if (obj.planId !== planId) {
    throw new AnalysisCheckpointError(
      "incompatible_plan",
      "checkpoint.planId does not match the requested plan identity",
    )
  }

  // Return the parsed object; full structural/compatibility checks run via
  // analysis_checkpoint public APIs (next/complete/create) in the tool.
  return parsed as AnalysisCheckpoint
}

/**
 * Persist `checkpoint` under `.banca/analysis/checkpoints/<planId>.json`.
 * Uses a same-directory temp file + atomic rename. Refuses symlink components
 * and symlink targets (including broken links). Removes the temp file on failure.
 * Never writes absolute paths into the JSON (checkpoint fields are plan-relative / numeric only).
 */
export function saveAnalysisCheckpoint(
  projectRoot: string,
  checkpoint: AnalysisCheckpoint,
): void {
  if (checkpoint == null || typeof checkpoint !== "object") {
    throw new AnalysisCheckpointError(
      "invalid_checkpoint",
      "checkpoint must be an AnalysisCheckpoint object",
    )
  }
  assertValidPlanId(checkpoint.planId)

  const dir = ensureCheckpointDirNoSymlinks(projectRoot)
  const absPath = resolveCheckpointAbsPath(projectRoot, checkpoint.planId)

  // Detect live and broken symlink targets via lstat (existsSync misses dangling links).
  const targetStat = lstatOrNull(absPath)
  if (targetStat !== null && targetStat.isSymbolicLink()) {
    throw new AnalysisCheckpointError(
      "symlink_refused",
      "refusing to overwrite a checkpoint symbolic link",
    )
  }

  // Same-directory temp for atomic rename on the same filesystem.
  const tmpName = `.${checkpoint.planId}.${process.pid}.${Date.now()}.tmp`
  const tmpPath = join(dir, tmpName)
  // Containment: temp must stay under the checkpoint directory inside the project.
  resolveInsideRoot(projectRoot, join(".banca", "analysis", "checkpoints", tmpName))

  const body = JSON.stringify(checkpoint, null, 2)

  try {
    writeFileSync(tmpPath, body, { encoding: "utf-8", flag: "wx" })
    renameSync(tmpPath, absPath)
  } catch (err) {
    try {
      const tmpStat = lstatOrNull(tmpPath)
      if (tmpStat !== null && !tmpStat.isSymbolicLink()) {
        unlinkSync(tmpPath)
      }
    } catch {
      // Best-effort temp cleanup; original error is rethrown.
    }
    if (err instanceof AnalysisCheckpointError) throw err
    // Generic message only — never leak absolute paths or host err.message.
    throw new AnalysisCheckpointError(
      "invalid_checkpoint_storage",
      "failed to persist checkpoint",
    )
  }
}
