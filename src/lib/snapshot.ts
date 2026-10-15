/**
 * Snapshot capture and manifest — the single identity policy for manuscript
 * files stored inside a snapshot vault.
 *
 * Identity policy (P1-A fix):
 * - Every captured file is stored under its *logical* project-relative path
 *   (POSIX): the path the manuscript configuration uses for main/bib/chapters
 *   (and, for corrections, the declared target path). The physical/canonical
 *   path is used only to validate that the read stays inside the workspace
 *   (external and broken symlinks are refused).
 * - Distinct logical paths are distinct snapshot entries even when they
 *   resolve to the same physical file (the vault mirrors the logical project
 *   tree). Duplicated logical keys are captured once; the first occurrence
 *   wins (main, then bib, then chapters).
 *
 * A manifest (`<label>.manifest.json`, sibling of the snapshot directory)
 * records the captured logical paths with sha256 hashes so restore can prove a
 * snapshot is complete and uncorrupted before touching the manuscript.
 * Snapshots without a manifest (created before this policy, or markers like
 * the loop tool) are handled by the legacy fallback in `banca_restore`; they
 * are never guessed at silently.
 */
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import {
  PathTraversalError,
  prepareRealPathForWrite,
  realWorkspaceRoot,
  resolveInsideRoot,
  resolveRealInsideRoot,
} from "./safe_paths"
import { isAbsoluteDriveOrUncForm, normalizePublicPath, toPosixPath } from "./paths"

export const SNAPSHOT_MANIFEST_VERSION = 1
export const SNAPSHOT_MANIFEST_SUFFIX = ".manifest.json"

export interface SnapshotFileEntry {
  /** Project-relative logical path (POSIX) — the manuscript identity. */
  logical: string
  /** Hex sha256 of the captured content. */
  sha256: string
  size: number
}

export interface SnapshotManifest {
  version: number
  label: string
  createdAt: string
  files: SnapshotFileEntry[]
  /** Expected logical paths (main/bib) that did not exist at capture time. */
  missing: string[]
  /** Candidates deliberately not captured, with the policy reason. */
  skipped: Array<{ logical: string; reason: string }>
}

export type SnapshotManifestState =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "valid"; manifest: SnapshotManifest }

export interface SnapshotCandidate {
  /** Project-relative logical path (POSIX). */
  logical: string
  /** Lexical absolute path inside the project. */
  abs: string
}

export interface SnapshotCaptureResult {
  files: SnapshotFileEntry[]
  missing: string[]
  skipped: Array<{ logical: string; reason: string }>
  manifestPath: string
}

export function sha256Of(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

/**
 * True when a path is a well-formed project-relative POSIX path: non-empty,
 * not absolute/drive/UNC, already normalized (no `.`/`..`/empty segments).
 */
export function isSafeLogicalRel(logical: string): boolean {
  if (typeof logical !== "string" || logical.length === 0) return false
  if (isAbsoluteDriveOrUncForm(logical)) return false
  const normalized = normalizePublicPath(logical)
  if (!normalized || normalized !== logical) return false
  if (normalized.split("/").includes("..")) return false
  return true
}

export function assertSafeLogicalRel(logical: string): void {
  if (!isSafeLogicalRel(logical)) {
    // Never echo the raw value: it may embed host paths.
    throw new PathTraversalError("snapshot entry is not a safe project-relative path")
  }
}

/**
 * Lexical (symlink-preserving) absolute path for a project input path, whether
 * it is relative or absolute. Used to keep the logical identity of correction
 * targets that reach the tools in either form.
 */
export function lexicalProjectPath(projectRoot: string, input: string): string {
  if (isAbsolute(input)) {
    const abs = resolve(input)
    const rel = relative(resolve(projectRoot), abs)
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
      throw new PathTraversalError("path escapes project root")
    }
    return abs
  }
  return resolveInsideRoot(projectRoot, input)
}

/** Project-relative POSIX logical path for an already-contained absolute path. */
export function logicalProjectRel(projectRoot: string, absPath: string): string {
  const rootAbs = resolve(projectRoot)
  const abs = resolve(absPath)
  const rel = relative(rootAbs, abs)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathTraversalError("path escapes project root")
  }
  const logical = normalizePublicPath(rel)
  assertSafeLogicalRel(logical)
  return logical
}

/**
 * Files that must never enter a snapshot vault: secrets, host configuration,
 * internal banca state and build output. Applied to both the logical identity
 * and the canonical physical path, so an internal symlink cannot smuggle a
 * forbidden file into a snapshot under a friendly logical name.
 */
export function snapshotExclusionReason(posixRel: string): string | null {
  if (posixRel === ".env" || posixRel.startsWith(".env.")) return "secrets policy (.env)"
  if (posixRel.startsWith(".dsh/")) return "host configuration (.dsh)"
  if (posixRel.startsWith(".banca/")) return "internal banca state (.banca)"
  if (posixRel.startsWith(".git/")) return "git metadata (.git)"
  if (posixRel.startsWith("node_modules/")) return "dependencies (node_modules)"
  if (posixRel.startsWith("dist/")) return "build output (dist)"
  return null
}

function lstatOrNull(path: string) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * Capture manuscript files into the snapshot vault, preserving logical
 * identity. Reads are validated canonically (external/broken symlinks raise
 * {@link PathTraversalError}); writes go to `snapDir/<logical>` through
 * {@link prepareRealPathForWrite}. Every stored file is re-read and hashed so
 * the manifest hash matches exactly what is on disk in the vault.
 */
export function captureSnapshotFiles(input: {
  root: string
  snapshotsDir: string
  snapDir: string
  label: string
  candidates: SnapshotCandidate[]
}): SnapshotCaptureResult {
  const { root, snapDir, label } = input
  const canonicalRoot = realWorkspaceRoot(root)

  const files: SnapshotFileEntry[] = []
  const missing: string[] = []
  const skipped: Array<{ logical: string; reason: string }> = []
  const seen = new Set<string>()

  for (const candidate of input.candidates) {
    assertSafeLogicalRel(candidate.logical)
    if (seen.has(candidate.logical)) continue
    seen.add(candidate.logical)

    const logicalExclusion = snapshotExclusionReason(candidate.logical)
    if (logicalExclusion) {
      skipped.push({ logical: candidate.logical, reason: logicalExclusion })
      continue
    }

    const lexicalStat = lstatOrNull(candidate.abs)
    if (lexicalStat === null) {
      missing.push(candidate.logical)
      continue
    }
    if (lexicalStat.isSymbolicLink() && !existsSync(candidate.abs)) {
      skipped.push({ logical: candidate.logical, reason: "broken symbolic link" })
      continue
    }

    // Reading is always validated canonically: escaping or broken components
    // are refused instead of being followed.
    const source = resolveRealInsideRoot(root, candidate.abs)

    const physicalRel = toPosixPath(relative(canonicalRoot, source))
    if (!physicalRel || physicalRel.startsWith("..") || isAbsolute(physicalRel)) {
      throw new PathTraversalError("snapshot source escapes project root")
    }
    const physicalExclusion = snapshotExclusionReason(physicalRel)
    if (physicalExclusion) {
      skipped.push({ logical: candidate.logical, reason: physicalExclusion })
      continue
    }

    const sourceStat = lstatOrNull(source)
    if (!sourceStat || !sourceStat.isFile()) {
      skipped.push({ logical: candidate.logical, reason: "not a regular file" })
      continue
    }

    const bytes = readFileSync(source)
    const digest = sha256Of(bytes)

    // The vault keeps the logical identity, never the canonical path.
    const dest = prepareRealPathForWrite(root, join(snapDir, candidate.logical))
    writeFileSync(dest, bytes)

    const written = readFileSync(dest)
    if (written.length !== bytes.length || sha256Of(written) !== digest) {
      throw new Error("snapshot write verification failed")
    }
    files.push({ logical: candidate.logical, sha256: digest, size: bytes.length })
  }

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_MANIFEST_VERSION,
    label,
    createdAt: new Date().toISOString(),
    files,
    missing,
    skipped,
  }
  const manifestPath = prepareRealPathForWrite(
    root,
    join(input.snapshotsDir, `${label}${SNAPSHOT_MANIFEST_SUFFIX}`),
  )
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")

  return { files, missing, skipped, manifestPath }
}

function validateManifest(raw: unknown): SnapshotManifest | null {
  if (typeof raw !== "object" || raw === null) return null
  const m = raw as Record<string, unknown>
  if (m.version !== SNAPSHOT_MANIFEST_VERSION) return null
  if (typeof m.label !== "string") return null
  if (typeof m.createdAt !== "string") return null
  if (!Array.isArray(m.files)) return null
  const files: SnapshotFileEntry[] = []
  for (const entry of m.files) {
    if (typeof entry !== "object" || entry === null) return null
    const e = entry as Record<string, unknown>
    if (typeof e.logical !== "string" || !isSafeLogicalRel(e.logical)) return null
    if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) return null
    if (typeof e.size !== "number" || !Number.isInteger(e.size) || e.size < 0) return null
    files.push({ logical: e.logical, sha256: e.sha256, size: e.size })
  }
  const missing: string[] = []
  if (m.missing !== undefined) {
    if (!Array.isArray(m.missing)) return null
    for (const item of m.missing) {
      if (typeof item !== "string" || !isSafeLogicalRel(item)) return null
      missing.push(item)
    }
  }
  const skipped: Array<{ logical: string; reason: string }> = []
  if (m.skipped !== undefined) {
    if (!Array.isArray(m.skipped)) return null
    for (const item of m.skipped) {
      if (typeof item !== "object" || item === null) return null
      const s = item as Record<string, unknown>
      if (typeof s.logical !== "string" || !isSafeLogicalRel(s.logical)) return null
      if (typeof s.reason !== "string") return null
      skipped.push({ logical: s.logical, reason: s.reason })
    }
  }
  return {
    version: SNAPSHOT_MANIFEST_VERSION,
    label: m.label,
    createdAt: m.createdAt,
    files,
    missing,
    skipped,
  }
}

/**
 * Read and strictly validate the manifest of a snapshot. A symlinked or
 * malformed manifest is reported as invalid (never followed, never guessed).
 */
export function loadSnapshotManifest(snapshotsDir: string, label: string): SnapshotManifestState {
  const manifestPath = join(snapshotsDir, `${label}${SNAPSHOT_MANIFEST_SUFFIX}`)
  let st
  try {
    st = lstatSync(manifestPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" }
    return { kind: "invalid", reason: "manifest is not readable" }
  }
  if (st.isSymbolicLink() || !st.isFile()) {
    return { kind: "invalid", reason: "manifest is not a regular file" }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch {
    return { kind: "invalid", reason: "manifest is not valid JSON" }
  }
  const manifest = validateManifest(parsed)
  if (!manifest) return { kind: "invalid", reason: "manifest structure is invalid" }
  return { kind: "valid", manifest }
}
