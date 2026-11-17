import { lstatSync, readFileSync, writeFileSync, type Stats } from "node:fs"
import { join, resolve } from "node:path"
import { PathTraversalError, prepareRealPathForWrite, resolveRealInsideRoot } from "./safe_paths"
import type { RefMetadata, ValidationResult } from "./academic"

interface CacheEntry {
  key: string
  doi?: string
  result: ValidationResult
  cachedAt: string
}

/**
 * Fixed, sanitized refusals for a reference cache whose physical origin cannot
 * be authorized or read (issue #165). They never embed the host path, a link
 * target, external file content or a raw filesystem message.
 */
const REF_CACHE_ORIGIN_REFUSED_UNSAFE =
  "reference cache refused: the cache origin is not a safe regular file inside the workspace"
const REF_CACHE_ORIGIN_REFUSED_INSPECTION =
  "reference cache refused: the cache origin could not be inspected safely"
const REF_CACHE_ORIGIN_REFUSED_READ =
  "reference cache refused: the present reference cache could not be read"

/**
 * Expected failures of reading an already inspected regular file. They must
 * surface as a controlled refusal; they are never degraded to a legitimate
 * empty cache or to a false "no cached match".
 */
const EXPECTED_REF_CACHE_READ_FAILURES = new Set([
  "EACCES",
  "EPERM",
  "EISDIR",
  "ELOOP",
  "ENOENT",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENAMETOOLONG",
  "ESTALE",
])

type RefCacheOrigin = { status: "absent" } | { status: "present"; content: string }

/**
 * Canonical read preflight for `.banca/cache/refs.json` (issue #165).
 *
 * The project workspace is the only authorized root. `.banca`, the cache
 * directory, the target of a link or the cache file's own target is never
 * promoted to a trusted root. The origin is resolved with the existing
 * canonical policy (`resolveRealInsideRoot`, the same containment contract as
 * #134/#136), the approved destination is inspected with `lstatSync`, and only
 * a regular file is read — directories, FIFOs, sockets and devices are never
 * opened, so a blocking read cannot hang the caller.
 *
 * Categories stay distinct: an internal regular file is read; a truly missing
 * `refs.json` is legitimate absence (empty cache); an escaping or broken link,
 * a non-directory ancestor, a non-regular destination or an inspection failure
 * are controlled refusals; a present file that cannot be read is a controlled
 * read refusal. A residual TOCTOU window remains between this inspection and
 * the read, so the guarantee covers a filesystem not concurrently mutated by
 * another process.
 */
function readRefCacheOrigin(absoluteRoot: string): RefCacheOrigin {
  // `absoluteRoot` is already normalized by the constructor (exactly once).
  const cachePath = join(absoluteRoot, ".banca", "cache", "refs.json")
  let canonicalPath: string
  try {
    canonicalPath = resolveRealInsideRoot(absoluteRoot, cachePath)
  } catch (error) {
    if (error instanceof PathTraversalError) throw new PathTraversalError(REF_CACHE_ORIGIN_REFUSED_UNSAFE)
    throw error
  }
  let destination: Stats
  try {
    destination = lstatSync(canonicalPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { status: "absent" }
    if (typeof code === "string") throw new PathTraversalError(REF_CACHE_ORIGIN_REFUSED_INSPECTION)
    throw error
  }
  if (!destination.isFile()) throw new PathTraversalError(REF_CACHE_ORIGIN_REFUSED_UNSAFE)
  let content: string
  try {
    content = readFileSync(canonicalPath, "utf-8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (typeof code === "string" && EXPECTED_REF_CACHE_READ_FAILURES.has(code)) {
      throw new PathTraversalError(REF_CACHE_ORIGIN_REFUSED_READ)
    }
    throw error
  }
  return { status: "present", content }
}

export class RefCache {
  private path: string
  private root: string
  private data: CacheEntry[] = []

  constructor(projectRoot: string) {
    // Normalize the root exactly once; the cache destination is built from
    // this normalized root (issue #165), so a relative root is never applied
    // twice by the canonical helper.
    this.root = resolve(projectRoot)
    this.path = join(this.root, ".banca", "cache", "refs.json")
    this.load()
  }

  private load(): void {
    const origin = readRefCacheOrigin(this.root)
    if (origin.status === "absent") {
      this.data = []
      return
    }
    try {
      this.data = JSON.parse(origin.content)
    } catch {
      // Historical contract: invalid JSON in an internal, authorized regular
      // file falls back to an empty cache. Origin and read refusals are decided
      // before this parse and therefore never reach this catch.
      this.data = []
    }
  }

  private save(): void {
    const target = prepareRealPathForWrite(this.root, this.path)
    writeFileSync(target, JSON.stringify(this.data, null, 2), "utf-8")
  }

  get(ref: RefMetadata): ValidationResult | null {
    // exact match by key
    const byKey = this.data.find((e) => e.key === ref.key)
    if (byKey) return byKey.result

    // match by DOI
    if (ref.doi) {
      const byDoi = this.data.find((e) => e.doi && e.doi.toLowerCase() === ref.doi!.toLowerCase())
      if (byDoi) return byDoi.result
    }

    return null
  }

  set(key: string, doi: string | undefined, result: ValidationResult): void {
    const idx = this.data.findIndex((e) => e.key === key)
    const entry: CacheEntry = { key, doi, result, cachedAt: new Date().toISOString() }
    if (idx >= 0) this.data[idx] = entry
    else this.data.push(entry)
    this.save()
  }

  summary(): { total: number; verified: number; pending: number } {
    const total = this.data.length
    const verified = this.data.filter((e) => e.result.found).length
    const pending = this.data.filter((e) => e.result.status === "nao_encontrada" && !e.result.error?.includes("network")).length
    return { total, verified, pending }
  }

  /** Mark refs that could not be validated (network unavailable) */
  markPending(refs: RefMetadata[]): void {
    for (const ref of refs) {
      if (!this.get(ref)) {
        this.set(ref.key, ref.doi, {
          key: ref.key,
          found: false,
          score: 0,
          status: "nao_encontrada",
          matchedBy: "none",
          evidence: "network unavailable — pending validation",
          error: "network_unavailable",
        })
      }
    }
  }
}
