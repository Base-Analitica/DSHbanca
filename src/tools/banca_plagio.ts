import { existsSync, lstatSync, readFileSync } from "node:fs"
import { join, isAbsolute, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { resolveRealInsideRoot } from "../lib/safe_paths"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { saveReport } from "../lib/reports"
interface CopySpiderRow {
  source: string
  sg: number
  si: number
  terms: string[]
}

function parseHtmlTable(html: string): CopySpiderRow[] {
  const rows: CopySpiderRow[] = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m: RegExpExecArray | null
  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1].trim())
    if (cells.length < 4) continue
    const sg = parseFloat(cells[1]?.replace(",", ".").replace(/[^0-9.]/g, ""))
    const si = parseFloat(cells[2]?.replace(",", ".").replace(/[^0-9.]/g, ""))
    if (isNaN(sg) || isNaN(si)) continue
    const terms = (cells[3] || "").split(/[,;]/).map((t) => t.trim()).filter(Boolean)
    rows.push({ source: cells[0], sg, si, terms })
  }
  return rows
}

function parsePdfViaPdftotext(pdfPath: string): CopySpiderRow[] {
  const result = spawnSync("pdftotext", [pdfPath, "-"], { encoding: "utf-8", timeout: 30000 })
  if (result.status !== 0) {
    throw new Error(`pdftotext failed: ${result.stderr || result.error}`)
  }
  const text = result.stdout || ""
  const rows: CopySpiderRow[] = []
  const lines = text.split("\n")
  for (const line of lines) {
    const parts = line.split(/\s{2,}/).filter(Boolean)
    if (parts.length >= 3) {
      const sg = parseFloat(parts[1]?.replace(",", ".").replace(/[^0-9.]/g, ""))
      const si = parseFloat(parts[2]?.replace(",", ".").replace(/[^0-9.]/g, ""))
      if (!isNaN(sg) && !isNaN(si)) {
        rows.push({ source: parts[0], sg, si, terms: parts.slice(3) })
      }
    }
  }
  return rows
}

function classify(si: number): string {
  if (si >= 70) return "ENTREVISTAR"
  if (si >= 30) return "REESCREVER"
  return "PULAR"
}

export const bancaPlagio = defineBancaTool({
  description: "Parse CopySpider report, classify similarity by severity, map to manuscript.",
  args: {
    reportPath: z.string().describe("Path to CopySpider report (HTML or PDF). If relative, resolved inside projectRoot. If absolute, validated to ensure it resides inside projectRoot."),
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    
    const finalReportPath = resolveRealInsideRoot(root, args.reportPath)

    if (!existsSync(finalReportPath) || !lstatSync(finalReportPath).isFile()) return "report not found"

    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    const ext = finalReportPath.toLowerCase()

    let rows: CopySpiderRow[]
    if (ext.endsWith(".pdf")) {
      const testRun = spawnSync("pdftotext", ["-v"], { encoding: "utf-8" })
      if (testRun.error) {
        return "pdftotext not available. Install poppler-utils or use HTML report."
      }
      rows = parsePdfViaPdftotext(finalReportPath)
    } else {
      const html = readFileSync(finalReportPath, "utf-8")
      rows = parseHtmlTable(html)
    }

    if (rows.length === 0) return "no similarity data found in report"

    const pular = rows.filter((r) => classify(r.si) === "PULAR")
    const reescrever = rows.filter((r) => classify(r.si) === "REESCREVER")
    const entrevistar = rows.filter((r) => classify(r.si) === "ENTREVISTAR")

    const sections = [
      { title: "ENTREVISTAR", body: entrevistar.map((r) => `- ${r.source}: Si=${r.si}% ${r.terms.length > 0 ? `(${r.terms.slice(0, 3).join(", ")})` : ""}`).join("\n") || "—" },
      { title: "REESCREVER", body: reescrever.map((r) => `- ${r.source}: Si=${r.si}% ${r.terms.length > 0 ? `(${r.terms.slice(0, 3).join(", ")})` : ""}`).join("\n") || "—" },
      { title: "PULAR", body: pular.map((r) => `- ${r.source}: Si=${r.si}%`).join("\n") || "—" },
    ]

    // map sources to manuscript files
    const mapped: string[] = []
    for (const file of [paths.main, ...paths.chapters]) {
      const name = file.replace(root, "").replace(/^\//, "")
      const matched = rows.filter((r) => r.source.toLowerCase().includes(name.toLowerCase().replace(".tex", "")))
      if (matched.length > 0) mapped.push(`${name}: ${matched.length} matches, max Si=${Math.max(...matched.map((r) => r.si)).toFixed(1)}%`)
    }

    const report = [
      "# Plágio — Report",
      `**Arquivo:** ${args.reportPath}`,
      `**Total de registros:** ${rows.length}`,
      `**ENTREVISTAR:** ${entrevistar.length} | **REESCREVER:** ${reescrever.length} | **PULAR:** ${pular.length}`,
      rows.length > 0 ? `**Média Sg:** ${(rows.reduce((a, r) => a + r.sg, 0) / rows.length).toFixed(1)}%` : "",
      "",
      "## Mapeamento para manuscrito",
      mapped.length > 0 ? mapped.join("\n") : "Nenhum mapeamento direto encontrado",
      "",
      "## Detalhamento",
      ...sections.map((s) => `## ${s.title}\n${s.body}`),
    ].join("\n")

    saveReport(root, `plagio-${Date.now()}.md`, report)
    return report
  },
})
