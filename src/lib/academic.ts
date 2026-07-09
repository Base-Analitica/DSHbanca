const CROSSREF_UA = "OpencodeBanca/0.1.0 (mailto:opencode-banca@local)"
const BASE = "https://api.crossref.org"
const SS_BASE = "https://api.semanticscholar.org/graph/v1"
const OA_BASE = "https://api.openalex.org"

export interface RefMetadata {
  key: string
  title?: string
  authors?: string[]
  year?: number
  doi?: string
  journal?: string
  volume?: string
  pages?: string
}

export interface ValidationResult {
  key: string
  found: boolean
  score: number
  status: "verificada" | "parcial" | "suspeita" | "nao_encontrada"
  matchedBy: "doi" | "title" | "none"
  metadata?: RefMetadata
  evidence?: string
  error?: string
}

function scoreFromMatch(matched: RefMetadata, original: RefMetadata): number {
  if (matched.doi && original.doi && matched.doi.toLowerCase() === original.doi.toLowerCase()) {
    return 95 + (matched.year === original.year ? 5 : 0)
  }

  let score = 0
  if (matched.title && original.title) {
    const t1 = matched.title.toLowerCase().replace(/[^a-z0-9]/g, "")
    const t2 = original.title.toLowerCase().replace(/[^a-z0-9]/g, "")
    const sim = similar(t1, t2)
    score += sim * 60
  }

  if (matched.year && original.year && matched.year === original.year) score += 15
  if (matched.authors && original.authors) {
    const shared = matched.authors.filter((a) =>
      original.authors!.some((oa) => a.toLowerCase().includes(oa.toLowerCase().split(" ").pop()!))
    ).length
    score += (shared / Math.max(matched.authors.length, original.authors.length)) * 15
  }

  return Math.round(Math.min(score, 100))
}

function similar(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  const dist = levenshtein(a, b)
  return 1 - dist / maxLen
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function classify(score: number): ValidationResult["status"] {
  if (score >= 90) return "verificada"
  if (score >= 70) return "parcial"
  if (score >= 50) return "suspeita"
  return "nao_encontrada"
}

export async function validateRef(ref: RefMetadata): Promise<ValidationResult> {
  const result: ValidationResult = {
    key: ref.key,
    found: false,
    score: 0,
    status: "nao_encontrada",
    matchedBy: "none",
  }

  try {
    // strategy 1: by DOI
    if (ref.doi) {
      const doi = ref.doi.replace(/^https?:\/\/doi\.org\//, "").trim()
      const res = await fetch(`${BASE}/works/${encodeURIComponent(doi)}`, {
        headers: { "User-Agent": CROSSREF_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const data: any = await res.json()
        const msg = data.message || {}
        const matched = crossrefToRef(msg, ref.key)
        const score = scoreFromMatch(matched, ref)
        return {
          key: ref.key, found: true, score, status: classify(score),
          matchedBy: "doi", metadata: matched,
          evidence: `DOI matched → ${matched.title} (${matched.authors?.join("; ")})`,
        }
      }
    }

    // strategy 2: by title search
    if (ref.title) {
      const query = [ref.title, ref.year, ref.authors?.[0]].filter(Boolean).join(" ")
      const res = await fetch(`${BASE}/works?query=${encodeURIComponent(query)}&rows=5&sort=relevance&order=desc`, {
        headers: { "User-Agent": CROSSREF_UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      })
      if (res.ok) {
        const data: any = await res.json()
        const items: any[] = data.message?.items || []
        if (items.length > 0) {
          const best = items[0]
          const matched = crossrefToRef(best, ref.key)
          const score = scoreFromMatch(matched, ref)
          return {
            key: ref.key, found: true, score, status: classify(score),
            matchedBy: "title", metadata: matched,
            evidence: `Title search → "${matched.title}" (score ${score})`,
          }
        }
      }
    }

    result.evidence = "not found in Crossref"
    return result
  } catch (err: any) {
    result.error = err.message
    result.evidence = `error: ${err.message}`
    return result
  }
}

export function crossrefToRef(item: any, key: string): RefMetadata {
  const dateParts = item.published?.dateParts || item.published?.["date-parts"] || [[]]
  const year = dateParts[0]?.[0]
  const authors = (item.author || []).map((a: any) => [a.given, a.family].filter(Boolean).join(" "))
  return {
    key,
    title: (item.title || [])[0],
    authors: authors.length > 0 ? authors : undefined,
    year: year || undefined,
    doi: item.DOI || item.doi,
    journal: (item["container-title"] || [])[0] || undefined,
  }
}

export async function searchPapersByTitle(query: string): Promise<RefMetadata[]> {
  const res = await fetch(`${BASE}/works?query=${encodeURIComponent(query)}&rows=10`, {
    headers: { "User-Agent": CROSSREF_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return []
  const data: any = await res.json()
  return (data.message?.items || []).map((i: any) => crossrefToRef(i, ""))
}
