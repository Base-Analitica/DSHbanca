import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { prepareRealPathForWrite } from "./safe_paths"
import type { RefMetadata, ValidationResult } from "./academic"

interface CacheEntry {
  key: string
  doi?: string
  result: ValidationResult
  cachedAt: string
}

export class RefCache {
  private path: string
  private root: string
  private data: CacheEntry[] = []

  constructor(projectRoot: string) {
    this.root = projectRoot
    this.path = join(projectRoot, ".banca", "cache", "refs.json")
    this.load()
  }

  private load(): void {
    if (existsSync(this.path)) {
      try { this.data = JSON.parse(readFileSync(this.path, "utf-8")) } catch { this.data = [] }
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
