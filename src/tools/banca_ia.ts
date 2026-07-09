import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { saveReport } from "../lib/reports"
const z = tool.schema

const PATTERNS: RegExp[] = [
  /(ademais|outrossim|destarte|sobremaneira|conquanto|tampouco)\b/gi,
  /(é imperativo|é crucial|é fundamental|é mister) que\b/gi,
  /(não apenas|mas também|não obstante|não só)\b/gi,
  /(torna-se evidente|vale ressaltar|convém salientar|importa notar)\b/gi,
  /(em outras palavras|ou seja|isto é|dito de outro modo)\b/gi,
  /(cabe destacar|faz-se necessário|haja vista|tendo em vista)\b/gi,
]

function hasPythonEnsemble(): boolean {
  try {
    const r = execSync("python3 -c \"import pt_ai_detector; print('ok')\"", { encoding: "utf-8", timeout: 5000, stdio: "pipe" })
    return r.trim() === "ok"
  } catch {
    return false
  }
}

function runPythonEnsemble(filePath: string): { risk: number; confidence: number } | null {
  try {
    const script = `
import sys, json
sys.path.insert(0, "${__dirname.replace(/\\/g, "\\\\/")}")
try:
    from pt_ai_detector import detect_text
    with open("${filePath.replace(/\\/g, "\\\\/")}", encoding="utf-8") as f:
        text = f.read()
    paragraphs = [p for p in text.split("\\n\\n") if len(p.strip()) > 20]
    scores = []
    for p in paragraphs[:50]:
        s = detect_text(p)
        scores.append(s.get("ai_score", 0))
    risk = sum(scores) / len(scores) if scores else 0
    print(json.dumps({"risk": round(risk, 4), "confidence": 0.85, "paragraphs_analyzed": len(scores)}))
except ImportError:
    print(json.dumps({"risk": 0, "confidence": 0, "error": "pt_ai_detector not available"}))
`
    const result = execSync("python3 -c " + JSON.stringify(script), { encoding: "utf-8", timeout: 60000, stdio: "pipe" })
    return JSON.parse(result.trim())
  } catch {
    return null
  }
}

export const bancaIa = tool({
  description: "Scan manuscript for AI-generated text risk. Uses Python ensemble if available, otherwise regex heuristic.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    forceRegex: z.boolean().optional().describe("Skip Python check, use regex only"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const paths = resolveManuscriptPaths(root, loadConfig(root))
    const files = [paths.main, ...paths.chapters].filter((f) => existsSync(f))

    if (files.length === 0) return "no manuscript files found"

    const pythonAvailable = !args.forceRegex && hasPythonEnsemble()

    const results: string[] = []
    const fileReports: Array<{ file: string; risk: string; details: string }> = []
    let totalRisk = 0
    let fileCount = 0

    for (const file of files) {
      const content = readFileSync(file, "utf-8")
      const name = file.replace(root, "").replace(/^\//, "")

      if (pythonAvailable) {
        const result = runPythonEnsemble(file)
        if (result && result.confidence > 0) {
          const riskLabel = result.risk > 0.5 ? "high" : result.risk > 0.2 ? "moderate" : "low"
          const confidence = result.confidence
          results.push(`${name}: risk=${riskLabel} score=${result.risk} confidence=${confidence}`)
          fileReports.push({ file: name, risk: riskLabel, details: JSON.stringify(result) })
          totalRisk += result.risk
          fileCount++
          continue
        }
      }

      // regex fallback
      let matches = 0
      const details: string[] = []
      const paragraphs = content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 20)
      for (const para of paragraphs) {
        let nM = 0
        for (const p of PATTERNS) {
          const m = para.match(p)
          if (m) nM += m.length
        }
        if (nM > 2) {
          matches += nM
          details.push(`${para.slice(0, 60)}... (${nM} matches)`)
        }
      }

      const risk = matches > 20 ? "high" : matches > 10 ? "moderate" : "low"
      results.push(`${name}: risk=${risk} patterns=${matches} ${details.length > 0 ? `(ex: "${details[0]}")` : ""}`)
      fileReports.push({ file: name, risk, details: `${matches} regex matches` })
      totalRisk += matches > 10 ? 1 : 0
      fileCount++
    }

    const globalRisk = totalRisk / fileCount
    const finalRisk = globalRisk > 0.5 ? "high" : globalRisk > 0.2 ? "moderate" : "low"

    const report = [
      "# IA Detection Report",
      pythonAvailable ? "**Método:** Python ensemble (pt-ai-detector)" : "**Método:** Regex heuristic (Python ensemble not available)",
      "**Risco final:** " + finalRisk,
      pythonAvailable ? "**Confiança:** alta" : "**Confiança:** baixa (regex apenas)",
      "",
      "## Por arquivo",
      ...results,
    ].join("\n")

    saveReport(root, `ia-${Date.now()}.md`, report)

    return report
  },
})
