import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig, getMcpCommand } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { parseBibtex, bibEntryToRef } from "../lib/bibtex"
import { resolveRef } from "../lib/provider_chain"
import { RefCache } from "../lib/cache"
export const bancaRefs = defineBancaTool({
  description: "Validate references via MCP (primary) → REST → cache chain. Reports provider used per reference.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    if (!existsSync(paths.bib)) return `bib not found: ${paths.bib}`

    const content = readFileSync(paths.bib, "utf-8")
    const entries = parseBibtex(content)

    if (entries.length === 0) return "no entries found in bib file"

    const mcpCmd = getMcpCommand(root)
    const cache = new RefCache(root)
    const results: Array<{ key: string; score: number; status: string; provider: string; evidence: string }> = []

    for (const entry of entries) {
      const ref = bibEntryToRef(entry)

      // try provider chain: MCP → REST → cache
      const { result, provider } = await resolveRef(ref, root, mcpCmd ?? undefined)
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
    const networkPending = results.filter((r) => r.evidence.includes("network_unavailable")).length

    const providerCounts: Record<string, number> = {}
    for (const r of results) {
      providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1
    }

    const lines = [
      `# Reference Validation — ${new Date().toISOString()}`,
      `Total: ${entries.length}  |  Avg Score: ${avgScore}/100`,
      `Verified: ${verified}  |  Not found: ${notFound}  |  Pending (network): ${networkPending}`,
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
      networkPending > 0 ? `\n⚠ ${networkPending} refs pending — network was unavailable during validation. Run \`/banca:refs\` again with network access.` : "",
    ]

    const reportDir = join(root, ".banca", "reports")
    mkdirSync(reportDir, { recursive: true })
    const reportPath = join(reportDir, `refs-${Date.now()}.md`)
    writeFileSync(reportPath, lines.filter(Boolean).join("\n"), "utf-8")

    const baseMessage = [
      `References: ${entries.length}`,
      `Avg Score: ${avgScore}/100`,
      `Verified: ${verified}`,
      notFound > 0 ? `Not found: ${notFound}` : null,
      networkPending > 0 ? `Pending: ${networkPending} (no network)` : null,
      `Provider breakdown: ${Object.entries(providerCounts).map(([p, c]) => `${p}=${c}`).join(", ")}`,
      `Report: ${reportPath}`,
    ].filter(Boolean).join("\n")

    if (mcpCmd === null) {
      return `MCP não habilitado, validação segue por fallback.\n${baseMessage}`
    }
    return baseMessage
  },
})
