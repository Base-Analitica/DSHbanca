import { existsSync } from "node:fs"
import { join } from "node:path"
import { McpClient } from "./mcp_client"
import { RefCache } from "./cache"
import { validateRef, type RefMetadata, type ValidationResult } from "./academic"
import { loadConfig } from "./config"

export interface ProviderResult {
  result: ValidationResult
  provider: string
}

// ---------------------------------------------------------------------------
// Typed MCP result shapes (replaces untyped `any` parsing).
// crossref-academic MCP returns nested JSON; these interfaces model the
// fields we actually read. Unknown shapes fall through to "no results".
// ---------------------------------------------------------------------------

/** A single search result item from the MCP. */
interface McpResultItem {
  title?: string
  authors?: unknown
  year?: unknown
  doi?: string
  journal?: unknown
}

/** Paper details response (get_paper_details). */
interface McpPaperDetails {
  title?: string
  authors?: unknown
  year?: unknown
  doi?: string
  journal?: unknown
}

/** Top-level MCP response envelope (both endpoints). */
interface McpResponse {
  crossref?: {
    title?: string
    authors?: unknown
    year?: unknown
    doi?: string
    journal?: unknown
    results?: McpResultItem[]
  }
  openalex?: {
    results?: McpResultItem[]
  }
  content?: Array<{ text?: string }>
  // Some MCP servers return results at the top level
  results?: McpResultItem[]
  title?: string
  authors?: unknown
  year?: unknown
  doi?: string
  journal?: unknown
}

export async function resolveRef(
  ref: RefMetadata,
  projectRoot: string,
  mcpCmd?: string[],
): Promise<ProviderResult> {
  const cache = new RefCache(projectRoot)

  // 1. try cache
  const cached = cache.get(ref)
  if (cached && cached.found) {
    return { result: cached, provider: "cache" }
  }

  let mcpError: string | undefined

  // 2. try MCP (if command configured)
  if (mcpCmd && mcpCmd.length > 0) {
    const client = new McpClient(mcpCmd, 20000)
    try {
      await client.start()

      let mcpResult: unknown
      if (ref.doi) {
        mcpResult = await client.callTool("get_paper_details", { doi: ref.doi })
      } else if (ref.title) {
        mcpResult = await client.callTool("search_papers", { query: [ref.title, ref.year, ref.authors?.[0]].filter(Boolean).join(" "), limit: 3 })
      }

      if (mcpResult) {
        const parsed = parseMcpResult(mcpResult, ref)
        cache.set(ref.key, ref.doi, parsed)
        return { result: parsed, provider: "mcp:crossref-academic" }
      }
    } catch (err: any) {
      mcpError = `MCP fallback (${err.message ? String(err.message).slice(0, 50) : "unknown"})`
    } finally {
      await client.close().catch(() => {})
    }
  }

  // 3. fallback: REST API
  try {
    const restResult = await validateRef(ref)
    if (mcpError) {
      restResult.evidence = restResult.evidence ? `${restResult.evidence} | ${mcpError}` : mcpError
    }
    cache.set(ref.key, ref.doi, restResult)
    return { result: restResult, provider: restResult.found ? "rest:crossref" : "rest:crossref" }
  } catch (err: any) {
    // 4. last resort: cache even if not found
    const cached = cache.get(ref)
    if (cached) {
      if (mcpError) {
        cached.evidence = cached.evidence ? `${cached.evidence} | ${mcpError}` : mcpError
      }
      return { result: cached, provider: "cache" }
    }

    // 5. mark pending
    cache.markPending([ref])
    const pending: ValidationResult = {
      key: ref.key,
      found: false,
      score: 0,
      status: "nao_encontrada",
      matchedBy: "none",
      evidence: [mcpError, "all providers failed — pending retry"].filter(Boolean).join(" | "),
      error: "network_unavailable",
    }
    return { result: pending, provider: "none" }
  }
}

/**
 * Parse the MCP tool result into a ValidationResult.
 * Accepts nested envelopes (crossref/openalex/content) and flat shapes.
 * Unknown or malformed shapes return "nao_encontrada" — never throw.
 */
function parseMcpResult(mcpResult: unknown, ref: RefMetadata): ValidationResult {
  // Unwrap content[] text if present (some MCP servers wrap JSON in text).
  let parsed: McpResponse | null = null

  if (typeof mcpResult === "string") {
    try {
      parsed = JSON.parse(mcpResult) as McpResponse
    } catch {
      parsed = null
    }
  } else if (mcpResult !== null && typeof mcpResult === "object") {
    const raw = mcpResult as McpResponse
    // If content[].text holds JSON, unwrap it.
    if (raw.content?.[0]?.text && typeof raw.content[0].text === "string") {
      try {
        parsed = JSON.parse(raw.content[0].text) as McpResponse
      } catch {
        parsed = raw
      }
    } else {
      parsed = raw
    }
  }

  if (parsed === null) {
    return {
      key: ref.key,
      found: false,
      score: 0,
      status: "nao_encontrada",
      matchedBy: "none",
      evidence: "MCP returned no parseable result",
    }
  }

  // get_paper_details: title present → direct match
  const detailsSource: McpPaperDetails | null =
    parsed.crossref?.title ? parsed.crossref :
    parsed.title ? parsed :
    null

  if (detailsSource && detailsSource.title) {
    const score = detailsSource.doi?.toLowerCase() === ref.doi?.toLowerCase() ? 95 : 70
    return {
      key: ref.key,
      found: true,
      score,
      status: score >= 90 ? "verificada" : "parcial",
      matchedBy: "doi",
      metadata: {
        key: ref.key,
        title: detailsSource.title,
        authors: asStringArray(detailsSource.authors),
        year: asNumber(detailsSource.year),
        doi: detailsSource.doi,
        journal: asString(detailsSource.journal),
      },
      evidence: `MCP matched → ${detailsSource.title} (score ${score})`,
    }
  }

  // search_papers: list of results
  const items: McpResultItem[] =
    parsed.crossref?.results ?? parsed.openalex?.results ?? parsed.results ?? []

  if (items.length > 0 && items[0].title) {
    const best = items[0]
    const score = 70
    return {
      key: ref.key,
      found: true,
      score,
      status: "parcial",
      matchedBy: "title",
      metadata: {
        key: ref.key,
        title: best.title,
        authors: asStringArray(best.authors),
        year: asNumber(best.year),
        doi: best.doi,
        journal: asString(best.journal),
      },
      evidence: `MCP search → "${best.title}" (score ${score})`,
    }
  }

  return {
    key: ref.key,
    found: false,
    score: 0,
    status: "nao_encontrada",
    matchedBy: "none",
    evidence: "MCP returned no results",
  }
}

// ---------------------------------------------------------------------------
// Safe coercion helpers: coerce unknown MCP fields to RefMetadata-compatible
// types without crashing on unexpected shapes.
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const strs = v.filter((e): e is string => typeof e === "string")
  return strs.length > 0 ? strs : undefined
}
