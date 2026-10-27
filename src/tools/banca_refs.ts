import { existsSync, lstatSync, readFileSync } from "node:fs"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { parseBibtex, bibEntryToRef } from "../lib/bibtex"
import { resolveRef } from "../lib/provider_chain"
import { RefCache } from "../lib/cache"
import { saveReport } from "../lib/reports"
import { PathTraversalError, resolveRealInsideRoot } from "../lib/safe_paths"
export const bancaRefs = defineBancaTool({
  description: "Validate references via local cache and verified DSH providers. External network and standalone MCP are blocked in DSH-only architecture.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    let bibStat = null
    try {
      bibStat = lstatSync(paths.bib)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new PathTraversalError("failed to inspect a workspace path component")
      }
    }

    if (!bibStat) return `bib not found: ${paths.bib}`

    const canonicalBib = resolveRealInsideRoot(root, paths.bib)
    if (!existsSync(canonicalBib) || !lstatSync(canonicalBib).isFile()) {
      return `bib not found: ${paths.bib}`
    }

    const content = readFileSync(canonicalBib, "utf-8")
    const entries = parseBibtex(content)

    if (entries.length === 0) return "no entries found in bib file"

    const cache = new RefCache(root)
    const results: Array<{ key: string; score: number; status: string; provider: string; evidence: string }> = []

    for (const entry of entries) {
      const ref = bibEntryToRef(entry)

      // try provider chain: cache-first / fail-closed if no host provider
      const { result, provider } = await resolveRef(ref, root)
      const statusIcon =
        result.status === "verificada" ? "✓" :
        result.status === "parcial" ? "~" :
        result.status === "suspeita" ? "?" : "✗"

      results.push({
        key: ref.key,
        score: result.score,
        status: `${statusIcon} ${result.status}`,
        provider,
        evidence: result.evidence || result.error || "",
      })
    }

    const totalScore = results.reduce((s, r) => s + r.score, 0)
    const avgScore = results.length > 0 ? Math.round(totalScore / results.length) : 0
    const verified = results.filter((r) => r.status.startsWith("✓")).length
    const notFound = results.filter((r) => r.status.startsWith("✗")).length
    const blockedCount = results.filter((r) => r.evidence.includes("blocked")).length

    const providerCounts: Record<string, number> = {}
    for (const r of results) {
      providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1
    }

    const lines = [
      `# Reference Validation — ${new Date().toISOString()}`,
      `Total: ${entries.length}  |  Avg Score: ${avgScore}/100`,
      `Verified: ${verified}  |  Not found: ${notFound}  |  Blocked (no DSH provider): ${blockedCount}`,
      "",
      `## Providers Used`,
      ...Object.entries(providerCounts).map(([p, c]) => `- ${p}: ${c} refs`),
      "",
      `## Results`,
      "| Key | Score | Status | Provider | Evidence |",
      "|-----|-------|--------|----------|----------|",
      ...results.map((r) => `| ${r.key} | ${r.score} | ${r.status} | ${r.provider} | ${r.evidence.slice(0, 80)} |`),
      "",
      avgScore >= 90 ? "**All references verified.**" :
      avgScore >= 70 ? "**Most references verified. Review partial matches.**" :
      avgScore >= 50 ? "**Several references need attention.**" :
      "**Many references could not be verified.**",
      blockedCount > 0 ? `\n⚠ ${blockedCount} refs blocked — external reference lookup requires a native DSH provider, which is not available in DSH 0.2.0-rc.2.` : "",
    ]

    const reportPath = saveReport(root, `refs-${Date.now()}.md`, lines.filter(Boolean).join("\n"))

    const baseMessage = [
      `References: ${entries.length}`,
      `Avg Score: ${avgScore}/100`,
      `Verified: ${verified}`,
      notFound > 0 ? `Not found: ${notFound}` : null,
      blockedCount > 0 ? `Blocked (external provider unavailable): ${blockedCount}` : null,
      `Provider breakdown: ${Object.entries(providerCounts).map(([p, c]) => `${p}=${c}`).join(", ")}`,
      `Report: ${reportPath}`,
    ].filter(Boolean).join("\n")

    if (blockedCount > 0) {
      return `blocked: external reference provider is not available in DSH — external validation blocked; only local cache was checked.\n${baseMessage}`
    }
    return baseMessage
  },
})
