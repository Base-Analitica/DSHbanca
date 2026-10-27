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
  _mcpCmd?: string[],
): Promise<ProviderResult> {
  const cache = new RefCache(projectRoot)

  // 1. try cache
  const cached = cache.get(ref)
  if (cached && cached.found) {
    return { result: cached, provider: "cache" }
  }

  // 2. In DSHbanca (DSH-only architecture), the plugin does not start standalone
  // MCP child processes or make direct REST fetch calls to external services.
  // External providers and network transport are governed by the DSH host.
  // Because DSH 0.2.0-rc.2 does not provide a native reference provider service,
  // uncached references fail closed with explicit BLOCKED status without
  // calling fetch or child_process.spawn.
  const blockedResult: ValidationResult = {
    key: ref.key,
    found: false,
    score: 0,
    status: "nao_encontrada",
    matchedBy: "none",
    evidence: "external reference lookup blocked — no native DSH provider available",
    error: "external_transport_blocked",
  }

  return { result: blockedResult, provider: "none" }
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
