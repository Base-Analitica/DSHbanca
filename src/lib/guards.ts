import { readFileSync, existsSync } from "node:fs"

export interface GuardViolation {
  rule: string
  severity: "error" | "warning"
  message: string
  file?: string
}

export function checkSnapshotExists(snapshotDir: string): GuardViolation | null {
  if (!existsSync(snapshotDir)) {
    return {
      rule: "snapshot-required",
      severity: "error",
      message: `snapshot not found at ${snapshotDir}. create before editing.`,
    }
  }
  return null
}

export function checkScoreNotDecreased(oldScore: number, newScore: number): GuardViolation | null {
  if (newScore < oldScore) {
    return {
      rule: "no-regression",
      severity: "error",
      message: `score dropped from ${oldScore.toFixed(1)} to ${newScore.toFixed(1)}. rollback recommended.`,
    }
  }
  return null
}

export function countRemovedLines(oldContent: string, newContent: string): number {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")
  const newSet = new Set(newLines.map((l) => l.trim()).filter(Boolean))
  return oldLines.filter((l) => l.trim() && !newSet.has(l.trim())).length
}

export function checkFileDiff(fileA: string, fileB: string): GuardViolation[] {
  const violations: GuardViolation[] = []
  if (!existsSync(fileA) || !existsSync(fileB)) return violations

  const oldContent = readFileSync(fileA, "utf-8")
  const newContent = readFileSync(fileB, "utf-8")
  const removals = countRemovedLines(oldContent, newContent)

  if (removals > 20) {
    violations.push({
      rule: "large-removal",
      severity: "warning",
      message: `${removals} lines removed — verify no data loss`,
    })
  }

  return violations
}
