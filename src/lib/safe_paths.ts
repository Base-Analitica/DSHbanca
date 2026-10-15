import { resolve, relative, sep, isAbsolute, join, dirname } from "node:path"
import { lstatSync, mkdirSync, realpathSync } from "node:fs"

export class PathTraversalError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = "PathTraversalError"
  }
}

export function resolveInsideRoot(root: string, userPath: string): string {
  // Reject absolute paths from input
  if (isAbsolute(userPath)) {
    throw new PathTraversalError(`absolute paths are not allowed: ${userPath}`)
  }
  // Reject any '..' segment
  const segments = userPath.split(/[/\\]/)
  if (segments.includes("..")) {
    throw new PathTraversalError(`path traversal segments ('..') are not allowed: ${userPath}`)
  }

  const candidate = resolve(root, userPath)
  const resolvedRoot = resolve(root)
  
  // Ensure the candidate path starts with resolvedRoot + separator
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  if (candidate !== resolvedRoot && !candidate.startsWith(prefix)) {
    throw new PathTraversalError(`path escapes root: ${userPath}`)
  }
  return candidate
}

export function relativeInsideRoot(root: string, userPath: string): string {
  const abs = resolveInsideRoot(root, userPath)
  return relative(root, abs)
}

export function sanitizeSnapshotLabel(label: string): string {
  if (!label) return `safe-${Date.now()}`
  let safe = label.replace(/[^a-zA-Z0-9._-]/g, "_")
  // Replace sequence of dots or traversal
  while (safe.includes("..")) {
    safe = safe.replace(/\.\./g, "__")
  }
  if (safe === "." || safe === "" || safe === "..") {
    safe = `safe-${Date.now()}`
  }
  return safe
}

export function assertInsideRoot(root: string, candidate: string): void {
  const abs = resolve(root, candidate)
  const resolvedRoot = resolve(root)
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  if (abs !== resolvedRoot && !abs.startsWith(prefix)) {
    throw new PathTraversalError(`path escapes root: ${candidate}`)
  }
}

// ---------------------------------------------------------------------------
// Canonical (symlink-aware) containment for internal destinations.
//
// The lexical helpers above only compare normalized path strings; a symlink
// planted inside the workspace can still redirect a write outside the root.
// These helpers resolve the real destination with lstat/realpath and refuse
// any component whose canonical target leaves the workspace. Messages never
// echo host paths.
// ---------------------------------------------------------------------------

/**
 * Canonical (realpath) form of a workspace root. A root that does not exist
 * yet is returned in its lexical form (it will be created by the caller, as
 * before); other failures raise a controlled error.
 */
export function realWorkspaceRoot(root: string): string {
  const resolved = resolve(root)
  try {
    return realpathSync(resolved)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return resolved
    }
    throw new PathTraversalError("workspace root is not accessible")
  }
}

function isStrictlyInside(resolvedRoot: string, candidate: string): boolean {
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep
  return candidate !== resolvedRoot && candidate.startsWith(prefix)
}

/**
 * Resolve the real destination of a path that must stay inside `root`.
 *
 * Lexical phase: relative inputs containing `..` and absolute inputs outside
 * the root are rejected (same contract as `resolveInsideRoot`). Absolute
 * inputs may be given under either the lexical root or its canonical form.
 *
 * Canonical phase: every existing component is inspected with lstat; a
 * symbolic link is resolved with realpath and its target must stay inside the
 * canonical root (links entirely inside the workspace are allowed). Broken
 * links, escaping links, non-directory ancestors and unreadable components
 * raise {@link PathTraversalError}. Missing components are returned literally;
 * their creation is handled by {@link ensureRealDirInsideRoot}.
 *
 * A residual TOCTOU window remains between this check and the caller's
 * operation, so callers re-resolve immediately before writing.
 */
export function resolveRealInsideRoot(root: string, userPath: string): string {
  const resolvedRoot = resolve(root)
  const canonicalRoot = realWorkspaceRoot(resolvedRoot)

  let lexical: string
  if (isAbsolute(userPath)) {
    lexical = resolve(userPath)
  } else {
    lexical = resolveInsideRoot(resolvedRoot, userPath)
  }

  let rel = relative(resolvedRoot, lexical)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    // Absolute input expressed in canonical form (e.g. a revalidation call).
    rel = relative(canonicalRoot, lexical)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new PathTraversalError("absolute path escapes workspace root")
    }
  }

  const parts = rel.split(sep).filter((p) => p !== "" && p !== ".")
  let current = canonicalRoot
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i])
    let st
    try {
      st = lstatSync(current)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return join(current, ...parts.slice(i + 1))
      }
      throw new PathTraversalError("failed to inspect a workspace path component")
    }
    if (st.isSymbolicLink()) {
      let real: string
      try {
        real = realpathSync(current)
      } catch {
        throw new PathTraversalError("refusing to follow a broken symbolic link inside the workspace")
      }
      if (real !== canonicalRoot && !isStrictlyInside(canonicalRoot, real)) {
        throw new PathTraversalError("path escapes workspace root through a symbolic link")
      }
      current = real
      continue
    }
    if (i < parts.length - 1 && !st.isDirectory()) {
      throw new PathTraversalError("path component is not a directory")
    }
  }
  if (current !== canonicalRoot && !isStrictlyInside(canonicalRoot, current)) {
    throw new PathTraversalError("path escapes workspace root")
  }
  return current
}

/**
 * Resolve and create a destination directory inside the workspace root.
 * Missing directories are created one level at a time; existing components
 * must be real directories and are revalidated immediately before use.
 */
export function ensureRealDirInsideRoot(root: string, target: string): string {
  const canonicalRoot = realWorkspaceRoot(root)
  // The workspace root itself may not exist yet (fresh project): create it,
  // but never through a symbolic link.
  let rootStat = null
  try {
    rootStat = lstatSync(canonicalRoot)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new PathTraversalError("workspace root is not accessible")
    }
  }
  if (rootStat === null) {
    try {
      mkdirSync(canonicalRoot, { recursive: true })
    } catch {
      throw new PathTraversalError("failed to create the workspace root")
    }
  } else if (rootStat.isSymbolicLink()) {
    throw new PathTraversalError("workspace root is not accessible")
  }
  const canonical = resolveRealInsideRoot(root, target)
  if (canonical === canonicalRoot) return canonical
  const rel = relative(canonicalRoot, canonical)
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathTraversalError("path escapes workspace root")
  }
  let current = canonicalRoot
  for (const part of rel.split(sep).filter((p) => p !== "" && p !== ".")) {
    current = join(current, part)
    let st = null
    try {
      st = lstatSync(current)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new PathTraversalError("failed to inspect a workspace path component")
      }
    }
    if (st === null) {
      try {
        mkdirSync(current, { recursive: false })
      } catch {
        throw new PathTraversalError("failed to create a workspace directory")
      }
      continue
    }
    if (st.isSymbolicLink() || !st.isDirectory()) {
      throw new PathTraversalError("refusing to use a symbolic link or non-directory inside the workspace")
    }
  }
  return current
}

/**
 * Prepare an internal write destination: canonicalize the target, create
 * missing parent directories safely, then re-resolve the final path right
 * before the caller performs the write.
 */
export function prepareRealPathForWrite(root: string, target: string): string {
  const resolved = resolveRealInsideRoot(root, target)
  if (resolved !== realWorkspaceRoot(root)) {
    ensureRealDirInsideRoot(root, dirname(resolved))
  }
  return resolveRealInsideRoot(root, resolved)
}
