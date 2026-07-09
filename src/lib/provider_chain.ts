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

      let mcpResult: any
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

function parseMcpResult(mcpResult: any, ref: RefMetadata): ValidationResult {
  // crossref-academic MCP returns nested structures
  const cr = mcpResult?.crossref || mcpResult?.content?.[0]?.text
  let parsed: any

  if (typeof cr === "string") {
    try { parsed = JSON.parse(cr) } catch { parsed = null }
  } else {
    parsed = cr
  }

  // MCP search_papers returns { crossref: { count, results }, openalex: { count, results } }
  const items = parsed?.results || (parsed?.crossref?.results) || (parsed?.openalex?.results) || []

  // get_paper_details returns { crossref: { title, authors, ... }, semantic_scholar: {...} }
  if (parsed?.title || parsed?.crossref?.title) {
    const meta = parsed.crossref || parsed
    const score = meta.doi?.toLowerCase() === ref.doi?.toLowerCase() ? 95 : 70
    return {
      key: ref.key,
      found: true,
      score,
      status: score >= 90 ? "verificada" : "parcial",
      matchedBy: "doi",
      metadata: {
        key: ref.key,
        title: meta.title,
        authors: meta.authors,
        year: meta.year,
        doi: meta.doi,
        journal: meta.journal,
      },
      evidence: `MCP matched → ${meta.title} (score ${score})`,
    }
  }

  // search results
  if (items.length > 0) {
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
        authors: best.authors,
        year: best.year,
        doi: best.doi,
        journal: best.journal,
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
