import { resolve, relative, sep, isAbsolute } from "node:path"

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
