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
 * Immutability policy (P1-B fix): {@link createSnapshot} is the single entry
 * point that claims a label and writes a snapshot. A label is refused when it
 * is already registered in `state.json`, when the snapshot directory exists
 * (any type: directory, symlink, file) or when the manifest path exists. The
 * claim is an exclusive non-recursive `mkdir`, capture runs behind a
 * `.capture-incomplete` marker, captured files and the manifest are written
 * with exclusive-create (`wx`) so nothing can be truncated, and any failure
 * removes the half-written snapshot. Registration happens only after the
 * manifest exists; on failure nothing is registered. Internal producers that
 * cannot ask the user for another label (pre-correction snapshot, pre-restore
 * backup, loop marker) use the `unique` policy: the first free `-N` suffix.
 *
 * A manifest (`<label>.manifest.json`, sibling of the snapshot directory)
 * records the captured logical paths with sha256 hashes so restore can prove a
 * snapshot is complete and uncorrupted before touching the manuscript.
 * Snapshots without a manifest (created before this policy, or markers like
 * the loop tool) are handled by the legacy fallback in `banca_restore`; they
 * are never guessed at silently.
 */
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { addSnapshot, loadState } from "./state"
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
/** Sibling marker written while a capture is in flight. */
export const SNAPSHOT_INCOMPLETE_MARKER = ".capture-incomplete"

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

    // The vault keeps the logical identity, never the canonical path. Capture
    // never overwrites: exclusive-create inside the freshly claimed directory.
    const dest = prepareRealPathForWrite(root, join(snapDir, candidate.logical))
    writeFileSync(dest, bytes, { flag: "wx" })

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
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" })

  return { files, missing, skipped, manifestPath }
}

/** A snapshot label cannot be used because existing data occupies it. */
export class SnapshotConflictError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(`snapshot label is not available: ${reason}`)
    this.name = "SnapshotConflictError"
    this.reason = reason
  }
}

/** The capture did not complete; nothing was registered and nothing remains. */
export class SnapshotCaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SnapshotCaptureError"
  }
}

export type SnapshotLabelPolicy = "strict" | "unique"

export interface CreatedSnapshot {
  /** Final label (may carry a `-N` suffix under the `unique` policy). */
  label: string
  /** Claimed snapshot directory (canonical, inside the workspace). */
  snapDir: string
  /** Registry id, or null when the snapshot is intentionally unregistered. */
  id: string | null
  files: SnapshotFileEntry[]
  missing: string[]
  skipped: Array<{ logical: string; reason: string }>
  manifestPath: string
}

/**
 * Deterministic availability check for a snapshot label. Checked in a fixed
 * order (state registry, then directory, then manifest) so the refusal reason
 * is stable. A symlink or unexpected file type anywhere in the label namespace
 * is a conflict, never something to write through.
 */
function labelConflictReason(root: string, snapshotsDir: string, label: string): string | null {
  const state = loadState(root)
  if (state.snapshots.some((s) => s.label === label)) return "already registered in state.json"

  const dirStat = lstatOrNull(join(snapshotsDir, label))
  if (dirStat !== null) {
    if (dirStat.isSymbolicLink()) return "snapshot directory is a symbolic link"
    if (!dirStat.isDirectory()) return "snapshot path exists and is not a directory"
    return "snapshot directory already exists"
  }

  const manifestStat = lstatOrNull(join(snapshotsDir, `${label}${SNAPSHOT_MANIFEST_SUFFIX}`))
  if (manifestStat !== null) {
    if (manifestStat.isSymbolicLink()) return "snapshot manifest is a symbolic link"
    if (!manifestStat.isFile()) return "snapshot manifest path is not a regular file"
    return "snapshot manifest already exists"
  }
  return null
}

/**
 * Create a snapshot with the full label-claim → capture → manifest →
 * (optional) registration sequence. This is the single point that guarantees
 * snapshot immutability: an existing snapshot is never truncated, a failed
 * capture never leaves a partial vault or a dangling registry record, and the
 * `.capture-incomplete` marker makes an interrupted capture detectable by
 * restore.
 */
export function createSnapshot(input: {
  root: string
  snapshotsDir: string
  label: string
  candidates: SnapshotCandidate[]
  labelPolicy: SnapshotLabelPolicy
  register: boolean
  scoreBefore?: number | null
}): CreatedSnapshot {
  const { root, snapshotsDir, candidates } = input
  let label = input.label

  if (input.labelPolicy === "unique") {
    // Internal producers (pre-restore backup, pre-correction snapshot, loop
    // marker) cannot invent a new user-facing label: pick the first free `-N`.
    let available: string | null = null
    for (let n = 1; n <= 1000; n++) {
      const candidateLabel = n === 1 ? input.label : `${input.label}-${n}`
      if (labelConflictReason(root, snapshotsDir, candidateLabel) === null) {
        available = candidateLabel
        break
      }
    }
    if (available === null) throw new SnapshotConflictError("no unique snapshot label is available")
    label = available
  } else {
    const reason = labelConflictReason(root, snapshotsDir, label)
    if (reason !== null) throw new SnapshotConflictError(reason)
  }

  // Exclusive claim: non-recursive mkdir fails if anything occupies the path.
  const snapDir = join(snapshotsDir, label)
  try {
    mkdirSync(snapDir, { recursive: false })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new SnapshotConflictError(
        labelConflictReason(root, snapshotsDir, label) ?? "snapshot directory already exists",
      )
    }
    throw new SnapshotCaptureError("could not create the snapshot directory")
  }
  const claimed = lstatOrNull(snapDir)
  if (claimed === null || claimed.isSymbolicLink() || !claimed.isDirectory()) {
    throw new SnapshotCaptureError("snapshot directory is not usable")
  }

  const markerPath = join(snapDir, SNAPSHOT_INCOMPLETE_MARKER)
  let manifestPath = join(snapshotsDir, `${label}${SNAPSHOT_MANIFEST_SUFFIX}`)
  let manifestCreated = false
  try {
    writeFileSync(markerPath, `${label}\n`, { encoding: "utf8" })
    const captured = captureSnapshotFiles({ root, snapshotsDir, snapDir, label, candidates })
    manifestPath = captured.manifestPath
    manifestCreated = true
    unlinkSync(markerPath)
    const id = input.register ? addSnapshot(root, label, input.scoreBefore ?? null) : null
    return {
      label,
      snapDir,
      id,
      files: captured.files,
      missing: captured.missing,
      skipped: captured.skipped,
      manifestPath,
    }
  } catch (err) {
    // Full cleanup on any failure: the marker, the manifest this call created
    // and the claimed directory are removed, so no half snapshot survives.
    // If registration itself failed after writing state.json, the vault is
    // kept instead (state and vault stay consistent).
    try {
      if (existsSync(markerPath)) unlinkSync(markerPath)
    } catch {
      /* best-effort marker cleanup */
    }
    let registered = false
    if (input.register) {
      try {
        registered = loadState(root).snapshots.some((s) => s.label === label)
      } catch {
        registered = false
      }
    }
    if (!registered) {
      try {
        if (manifestCreated && existsSync(manifestPath)) unlinkSync(manifestPath)
      } catch {
        /* best-effort manifest cleanup */
      }
      try {
        rmSync(snapDir, { recursive: true, force: true })
      } catch {
        /* best-effort directory cleanup */
      }
    }
    if (
      err instanceof PathTraversalError ||
      err instanceof SnapshotConflictError ||
      err instanceof SnapshotCaptureError
    ) {
      throw err
    }
    throw new SnapshotCaptureError("snapshot capture failed")
  }
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
