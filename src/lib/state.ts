import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { resolveInsideRoot } from "./safe_paths"

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
  const dir = p.replace(/\/[^/]+$/, "")
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
