import { existsSync, lstatSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadState } from "../lib/state"
import { loadConfig, type ProjectConfig } from "../lib/config"
import {
  ensureRealDirInsideRoot,
  PathTraversalError,
  prepareRealPathForWrite,
  realWorkspaceRoot,
  resolveInsideRoot,
  resolveRealInsideRoot,
  sanitizeSnapshotLabel,
} from "../lib/safe_paths"
import { resolveManuscriptPaths, toPosixPath } from "../lib/paths"
import {
  createSnapshot,
  loadSnapshotManifest,
  logicalProjectRel,
  sha256Of,
  SNAPSHOT_INCOMPLETE_MARKER,
  snapshotExclusionReason,
  type CreatedSnapshot,
  type SnapshotFileEntry,
} from "../lib/snapshot"

interface PlannedRestore {
  /** Project-relative logical path; the file is restored at this identity. */
  logical: string
  /** Verified vault file (canonical path inside the workspace). */
  source: string
  sha256: string
  size: number
  /** True when the vault stored this file under a legacy canonical key. */
  legacy: boolean
}

interface RestorePlan {
  planned: PlannedRestore[]
  notInSnapshot: string[]
}

function logicalManuscriptRel(root: string, config: ProjectConfig, which: "main" | "bib"): string {
  const manuscriptRoot = resolveInsideRoot(root, config.manuscript.root)
  const abs = resolveInsideRoot(manuscriptRoot, config.manuscript[which])
  return logicalProjectRel(root, abs)
}

/**
 * Canonical storage key a pre-fix (pre-manifest) snapshot could have used for
 * a symlinked main/bib: the physical project-relative path of the current
 * resolution. Returns null when the current path is not a symlink (legacy key
 * equals the logical key) or cannot be resolved safely.
 */
function legacyCanonicalKey(root: string, logical: string): string | null {
  try {
    const canonicalRoot = realWorkspaceRoot(root)
    const target = resolveRealInsideRoot(root, logical)
    const rel = toPosixPath(relative(canonicalRoot, target))
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null
    return rel === logical ? null : rel
  } catch {
    return null
  }
}

type VaultRead =
  | { source: string; sha256: string; size: number }
  | "corrupted"
  | "escapes"

/** Read a vault file with canonical containment; never follows escaping links. */
function readVaultFile(root: string, snapDir: string, rel: string): VaultRead {
  let source: string
  try {
    source = resolveRealInsideRoot(root, join(snapDir, rel))
  } catch {
    return "escapes"
  }
  let st
  try {
    st = lstatSync(source)
  } catch {
    return "corrupted"
  }
  if (!st.isFile()) return "corrupted"
  let bytes: Buffer
  try {
    bytes = readFileSync(source)
  } catch {
    return "corrupted"
  }
  return { source, sha256: sha256Of(bytes), size: bytes.length }
}

type DestinationInspection =
  | { ok: true; target: string; identityKey: string; canonicalRel: string }
  | { ok: false; blocked: string }

/**
 * Resolve one planned restore destination to its canonical location and
 * identify the physical file it will occupy (P1-A). Existing files are keyed
 * by device+inode, so two distinct logical paths resolving to the same file
 * are detectable before any write; missing destinations are keyed by their
 * canonical project-relative path. Destinations resolving into a protected
 * namespace (secrets, internal banca state, host/build dirs) are refused, so a
 * planted internal symlink cannot redirect a restore into `.banca/state.json`
 * or `.env`. Read-only: touches nothing.
 */
function inspectRestoreDestination(root: string, logical: string): DestinationInspection {
  let target: string
  try {
    target = resolveRealInsideRoot(root, logical)
  } catch {
    return { ok: false, blocked: `blocked: restore path escapes project root: ${logical}` }
  }
  const canonicalRoot = realWorkspaceRoot(root)
  const canonicalRel = toPosixPath(relative(canonicalRoot, target))
  if (canonicalRel && canonicalRel !== ".." && !canonicalRel.startsWith("../")) {
    const exclusion = snapshotExclusionReason(canonicalRel)
    if (exclusion) {
      return {
        ok: false,
        blocked: `blocked: restore destination for ${logical} resolves into a protected namespace (${exclusion})`,
      }
    }
  }
  let st
  try {
    st = lstatSync(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, blocked: `blocked: destination for ${logical} is not accessible` }
    }
    return { ok: true, target, identityKey: `path:${canonicalRel}`, canonicalRel }
  }
  if (!st.isFile()) return { ok: false, blocked: `blocked: destination for ${logical} is not a regular file` }
  return { ok: true, target, identityKey: `${st.dev}:${st.ino}`, canonicalRel }
}

/**
 * Build the logical → physical identity map for every planned destination.
 * Returns the colliding pair description when two logical paths would write to
 * the same physical file; the check is order-independent (any collision refuses
 * the whole restore, regardless of which path is processed first).
 */
function destinationPlanError(root: string, logicals: string[]): string | null {
  const identities = new Map<string, string>()
  for (const logical of logicals) {
    const inspection = inspectRestoreDestination(root, logical)
    if (!inspection.ok) return inspection.blocked
    const existing = identities.get(inspection.identityKey)
    if (existing !== undefined) {
      return `blocked: restore destinations collide: ${existing}, ${logical} resolve to the same file (${inspection.canonicalRel})`
    }
    identities.set(inspection.identityKey, logical)
  }
  return null
}

/**
 * Plan a restore from a manifest snapshot: the manifest is authoritative.
 * Every listed file must exist in the vault with the recorded size and hash,
 * and main must be present, otherwise the restore is refused (never a partial
 * success). Read-only: touches nothing outside the vault.
 */
function planManifestRestore(
  root: string,
  snapDir: string,
  files: SnapshotFileEntry[],
  manifest: { missing: string[]; skipped: Array<{ logical: string; reason: string }> },
  expectedMain: string,
): RestorePlan | string {
  const planned: PlannedRestore[] = []
  const seen = new Set<string>()
  for (const entry of files) {
    if (seen.has(entry.logical)) continue
    seen.add(entry.logical)
    const exclusion = snapshotExclusionReason(entry.logical)
    if (exclusion) {
      return `blocked: snapshot entry ${entry.logical} is not a restorable manuscript file (${exclusion})`
    }
    const read = readVaultFile(root, snapDir, entry.logical)
    if (read === "escapes") return `blocked: restore path escapes project root`
    if (read === "corrupted" || read.size !== entry.size || read.sha256 !== entry.sha256) {
      return `blocked: snapshot content for ${entry.logical} is missing or corrupted`
    }
    planned.push({
      logical: entry.logical,
      source: read.source,
      sha256: entry.sha256,
      size: entry.size,
      legacy: false,
    })
  }
  if (!planned.some((p) => p.logical === expectedMain)) {
    return `blocked: snapshot does not include ${expectedMain} — refusing an incomplete restore`
  }
  const notInSnapshot: string[] = []
  for (const rel of [...manifest.missing, ...manifest.skipped.map((s) => s.logical)]) {
    if (!planned.some((p) => p.logical === rel) && !notInSnapshot.includes(rel)) notInSnapshot.push(rel)
  }
  return { planned, notInSnapshot }
}

/**
 * Plan a restore from a legacy snapshot (no manifest). Keys are derived from
 * the project configuration; a symlinked main/bib is additionally looked up
 * under the canonical key the pre-fix code would have used, but only when the
 * mapping is unambiguous — if both copies exist the restore is refused.
 * Chapters are discovered in the vault mirror. Read-only.
 */
function planLegacyRestore(
  root: string,
  snapDir: string,
  config: ProjectConfig,
  expectedMain: string,
): RestorePlan | string {
  let expectedBib: string
  try {
    expectedBib = logicalManuscriptRel(root, config, "bib")
  } catch {
    return `blocked: restore path escapes project root`
  }

  const planned: PlannedRestore[] = []
  const notInSnapshot: string[] = []
  const seenLogical = new Set<string>()
  const seenKey = new Set<string>()

  const existsInVault = (key: string): boolean => {
    const read = readVaultFile(root, snapDir, key)
    return read !== "escapes" && read !== "corrupted"
  }
  const pick = (logical: string, key: string): void => {
    if (seenKey.has(key) || seenLogical.has(logical)) return
    const read = readVaultFile(root, snapDir, key)
    if (read === "escapes" || read === "corrupted") return
    seenKey.add(key)
    seenLogical.add(logical)
    planned.push({
      logical,
      source: read.source,
      sha256: read.sha256,
      size: read.size,
      legacy: key !== logical,
    })
  }

  // main: logical key preferred; the canonical key of the current resolution is
  // the deterministic fallback for pre-fix snapshots. Both present = ambiguous.
  const legacyMainKey = legacyCanonicalKey(root, expectedMain)
  const mainLogicalExists = existsInVault(expectedMain)
  const mainLegacyExists = legacyMainKey !== null && existsInVault(legacyMainKey)
  if (mainLogicalExists && mainLegacyExists) {
    return `blocked: snapshot is ambiguous for ${expectedMain}: logical and legacy canonical copies both exist`
  }
  if (mainLogicalExists) pick(expectedMain, expectedMain)
  else if (mainLegacyExists && legacyMainKey !== null) pick(expectedMain, legacyMainKey)
  else return `blocked: snapshot does not include ${expectedMain} — refusing an incomplete restore`

  // bib: not required; absence is reported explicitly, never guessed.
  const legacyBibKey = legacyCanonicalKey(root, expectedBib)
  const bibLogicalExists = existsInVault(expectedBib)
  const bibLegacyExists = legacyBibKey !== null && existsInVault(legacyBibKey)
  if (bibLogicalExists && bibLegacyExists) {
    return `blocked: snapshot is ambiguous for ${expectedBib}: logical and legacy canonical copies both exist`
  }
  if (bibLogicalExists) pick(expectedBib, expectedBib)
  else if (bibLegacyExists && legacyBibKey !== null) pick(expectedBib, legacyBibKey)
  else notInSnapshot.push(expectedBib)

  // chapters: discovered in the vault mirror; their logical path is the
  // discovered relative path (discovery never follows symlinks).
  let snapPaths
  try {
    snapPaths = resolveManuscriptPaths(snapDir, config)
  } catch {
    return `blocked: chapter discovery is incomplete in this snapshot — refusing an incomplete restore`
  }
  for (const ch of snapPaths.chapters) {
    const rel = toPosixPath(relative(snapDir, ch))
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) continue
    pick(rel, rel)
  }

  return { planned, notInSnapshot }
}

export const bancaRestore = defineBancaTool({
  description: "Restore project from a snapshot safely.",
  args: {
    snapshotId: z.string().optional().describe("Snapshot ID or label to restore from"),
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    confirm: z.boolean().optional().describe("Confirm restore (default: false, runs dry-run)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const state = loadState(root)
    const config = loadConfig(root)

    // list snapshots
    if (!args.snapshotId) {
      if (state.snapshots.length === 0) return "no snapshots available"
      return state.snapshots.map((s) => `  ${s.id} — ${s.label} (${new Date(s.createdAt).toLocaleDateString()})`).join("\n")
    }

    const snap = state.snapshots.find((s) => s.id === args.snapshotId || s.label === args.snapshotId)
    if (!snap) return `snapshot not found: ${args.snapshotId}`

    // ---------- Phase 1: canonical containment of every vault/state path ----------
    let snapshotsDir: string
    let snapDir: string
    try {
      realWorkspaceRoot(root)
      snapshotsDir = resolveRealInsideRoot(root, join(root, ".banca", "snapshots"))
      const lexicalSnapDir = resolveInsideRoot(snapshotsDir, snap.label)
      snapDir = resolveRealInsideRoot(root, lexicalSnapDir)
      resolveRealInsideRoot(root, join(root, ".banca", "state.json"))
    } catch {
      return `blocked: snapshot path escapes project root`
    }
    if (!existsSync(snapDir)) return `snapshot directory not found: ${snapDir}`

    // A snapshot whose capture never finished is refused: its manifest may be
    // missing or its files may be a partial copy, so it is not a recovery
    // point (P1-B). Any entry at the marker path (even a symlink) blocks.
    let captureIncomplete = false
    try {
      lstatSync(join(snapDir, SNAPSHOT_INCOMPLETE_MARKER))
      captureIncomplete = true
    } catch {
      /* no marker: capture finished (or legacy snapshot without marker) */
    }
    if (captureIncomplete) {
      return `blocked: snapshot is incomplete (capture did not finish) — refusing the restore`
    }

    // ---------- Phase 2: read-only planning (no manuscript change) ----------
    let expectedMain: string
    try {
      expectedMain = logicalManuscriptRel(root, config, "main")
    } catch {
      return `blocked: restore path escapes project root`
    }

    const manifestState = loadSnapshotManifest(snapshotsDir, snap.label)
    if (manifestState.kind === "invalid") {
      return `blocked: snapshot manifest is invalid or inconsistent`
    }
    const plan =
      manifestState.kind === "valid"
        ? planManifestRestore(root, snapDir, manifestState.manifest.files, manifestState.manifest, expectedMain)
        : planLegacyRestore(root, snapDir, config, expectedMain)
    if (typeof plan === "string") return plan

    if (!args.confirm) {
      const lines = [
        `### Restore Dry-Run for Snapshot: ${snap.label}`,
        `To apply this restore, run with 'confirm: true'.`,
        `Files to be restored:`,
        ...plan.planned.map((p) => `- ${p.logical}${p.legacy ? " (legacy canonical key)" : ""}`),
      ]
      if (plan.notInSnapshot.length > 0) {
        lines.push(`Not in snapshot (left unchanged):`)
        lines.push(...plan.notInSnapshot.map((f) => `- ${f}`))
      }
      return lines.join("\n")
    }

    // ---------- Phase 3: validate every destination before any change ----------
    // Identity-level validation (P1-A): every planned logical destination is
    // resolved to its canonical location and its physical identity (dev:inode
    // for existing files) is mapped. Two logical paths resolving to the same
    // physical file refuse the restore integrally — fail-closed even when the
    // contents coincide, never a silent winner chosen by write order.
    const planError = destinationPlanError(
      root,
      plan.planned.map((p) => p.logical),
    )
    if (planError) return planError

    // ---------- Phase 4: stage the verified vault content inside the workspace ----------
    const stagingLabel = `.restore-staging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let stagingDir: string
    try {
      stagingDir = ensureRealDirInsideRoot(root, join(snapshotsDir, stagingLabel))
    } catch {
      return `blocked: could not create a staging area inside the workspace`
    }

    try {
      for (const p of plan.planned) {
        let bytes: Buffer
        try {
          bytes = readFileSync(p.source)
        } catch {
          return `blocked: could not stage snapshot content for ${p.logical} — no manuscript file was modified`
        }
        if (bytes.length !== p.size || sha256Of(bytes) !== p.sha256) {
          return `blocked: snapshot content for ${p.logical} changed during restore — no manuscript file was modified`
        }
        try {
          const staged = prepareRealPathForWrite(root, join(stagingDir, p.logical))
          writeFileSync(staged, bytes)
          const written = readFileSync(staged)
          if (written.length !== bytes.length || sha256Of(written) !== p.sha256) {
            throw new Error("staging verification failed")
          }
        } catch {
          return `blocked: could not stage snapshot content for ${p.logical} — no manuscript file was modified`
        }
      }

      // ---------- Phase 5: real backup of the pre-restore state ----------
      // The backup is a full snapshot created through the central, immutable
      // snapshot path: the label is unique, never overwrites an existing
      // recovery point and is registered only after the manifest exists.
      let backup: CreatedSnapshot
      try {
        const candidates = plan.planned.map((p) => ({
          logical: p.logical,
          abs: resolveInsideRoot(root, p.logical),
        }))
        backup = createSnapshot({
          root,
          snapshotsDir,
          label: sanitizeSnapshotLabel(`pre-restore-${Date.now()}`),
          candidates,
          labelPolicy: "unique",
          register: true,
          scoreBefore: state.currentScore,
        })
      } catch (err) {
        if (err instanceof PathTraversalError) {
          return `blocked: pre-restore backup path escapes project root — no manuscript file was modified`
        }
        return `blocked: pre-restore backup failed — no manuscript file was modified (${(err as Error).message})`
      }
      const backupLabel = backup.label
      const backupDir = backup.snapDir

      // ---------- Phase 5b: revalidate the plan immediately before writing ----------
      // The destination identities validated in phase 3 are re-checked after
      // staging/backup, narrowing the window for a destination that changed
      // (e.g. became a symlink) between planning and substitution. Any change
      // aborts with zero manuscript writes; the safety backup is kept.
      const revalidationError = destinationPlanError(
        root,
        plan.planned.map((p) => p.logical),
      )
      if (revalidationError) {
        return [
          `blocked: restore aborted before writing — ${revalidationError.replace(/^blocked: /, "")}`,
          `Safety backup created: ${backupLabel}`,
        ].join("\n")
      }

      // ---------- Phase 6: controlled replacement with rollback ----------
      interface Applied {
        logical: string
        target: string
        created: boolean
        backupRel: string | null
      }
      const applied: Applied[] = []
      let failure: { logical: string; reason: string } | null = null

      for (const p of plan.planned) {
        let target: string
        try {
          // re-resolve immediately before writing to narrow the TOCTOU window
          target = resolveRealInsideRoot(root, p.logical)
        } catch {
          failure = { logical: p.logical, reason: "path containment changed during restore" }
          break
        }
        const created = !existsSync(target)
        const parent = dirname(target)
        try {
          ensureRealDirInsideRoot(root, parent)
        } catch {
          failure = { logical: p.logical, reason: "destination parent is not usable" }
          break
        }
        const tmp = join(
          parent,
          `.dshbanca.restore.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`,
        )
        try {
          const bytes = readFileSync(join(stagingDir, p.logical))
          if (bytes.length !== p.size || sha256Of(bytes) !== p.sha256) {
            throw new Error("staged content mismatch")
          }
          writeFileSync(tmp, bytes)
          // Atomic replace: the destination is never deleted beforehand, so a
          // failure can never leave the manuscript without its content.
          renameSync(tmp, target)
          applied.push({ logical: p.logical, target, created, backupRel: created ? null : p.logical })
          const written = readFileSync(target)
          if (written.length !== bytes.length || sha256Of(written) !== p.sha256) {
            throw new Error("restored content verification failed")
          }
        } catch (err) {
          try {
            if (existsSync(tmp)) {
              const st = lstatSync(tmp)
              if (st.isFile()) unlinkSync(tmp)
            }
          } catch {
            /* best effort cleanup of our own temp file */
          }
          failure = { logical: p.logical, reason: (err as Error).message || "write failed" }
          break
        }
      }

      // ---------- Phase 6b: verify the complete final inventory ----------
      // Individual writes were verified while they happened, but a later
      // substitution (or an external actor) can invalidate an earlier file.
      // Success is only allowed when every planned logical path still resolves
      // inside the workspace and carries exactly the snapshot content; any
      // mismatch goes through the same rollback path as a write failure, so a
      // false `restored from` is impossible.
      if (!failure) {
        for (const p of plan.planned) {
          try {
            const target = resolveRealInsideRoot(root, p.logical)
            const bytes = readFileSync(target)
            if (bytes.length !== p.size || sha256Of(bytes) !== p.sha256) {
              failure = { logical: p.logical, reason: "final content verification failed" }
              break
            }
          } catch {
            failure = { logical: p.logical, reason: "final content verification failed" }
            break
          }
        }
      }

      if (failure) {
        const rollbackFailures: string[] = []
        let rolledBack = 0
        for (const rec of [...applied].reverse()) {
          try {
            const target = resolveRealInsideRoot(root, rec.logical)
            if (rec.created) {
              if (!existsSync(target)) {
                rolledBack++
              } else {
                const st = lstatSync(target)
                if (!st.isFile()) {
                  rollbackFailures.push(rec.logical)
                } else {
                  unlinkSync(target)
                  rolledBack++
                }
              }
            } else if (rec.backupRel) {
              const backupPath = join(backupDir, rec.backupRel)
              if (!existsSync(backupPath)) {
                rollbackFailures.push(rec.logical)
                continue
              }
              const bytes = readFileSync(backupPath)
              const parent = dirname(target)
              ensureRealDirInsideRoot(root, parent)
              const tmp = join(
                parent,
                `.dshbanca.rollback.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`,
              )
              writeFileSync(tmp, bytes)
              renameSync(tmp, target)
              const written = readFileSync(target)
              if (written.length !== bytes.length || sha256Of(written) !== sha256Of(bytes)) {
                rollbackFailures.push(rec.logical)
                continue
              }
              rolledBack++
            } else {
              rollbackFailures.push(rec.logical)
            }
          } catch {
            rollbackFailures.push(rec.logical)
          }
        }
        if (rollbackFailures.length > 0) {
          return [
            `partial: restore aborted at ${failure.logical} (${failure.reason})`,
            `Rollback failed for: ${rollbackFailures.join(", ")}`,
            `Safety backup kept: ${backupLabel}`,
          ].join("\n")
        }
        return [
          `failed: restore aborted at ${failure.logical} (${failure.reason})`,
          `Rollback restored the pre-restore content of ${rolledBack} file(s).`,
          `Safety backup created: ${backupLabel}`,
        ].join("\n")
      }

      // ---------- Success ----------
      const legacyUsed = plan.planned.filter((p) => p.legacy).map((p) => p.logical)
      const lines = [
        `restored from ${snap.label}`,
        `Safety backup created: ${backupLabel}`,
        `Restored files (content verified):`,
        ...plan.planned.map((p) => `- ${p.logical}`),
      ]
      if (legacyUsed.length > 0) {
        lines.push(`Legacy canonical keys used for: ${legacyUsed.join(", ")}`)
      }
      if (plan.notInSnapshot.length > 0) {
        lines.push(`Not in snapshot (left unchanged):`)
        lines.push(...plan.notInSnapshot.map((f) => `- ${f}`))
      }
      return lines.join("\n")
    } finally {
      try {
        rmSync(stagingDir, { recursive: true, force: true })
      } catch {
        /* best effort cleanup of our own staging directory */
      }
    }
  },
})
