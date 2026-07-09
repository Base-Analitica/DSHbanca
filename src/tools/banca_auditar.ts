import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tool } from "@opencode-ai/plugin"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { generateReport, saveReport } from "../lib/reports"
import { loadState, saveState } from "../lib/state"
const z = tool.schema

interface AxisResult {
  score: number
  tetos: string[]
  findings: string[]
}

function auditFichamento(projectRoot: string, config: any, paths: any): AxisResult {
  const findings: string[] = []
  if (!existsSync(paths.main)) return { score: 5, tetos: ["main.tex not found"], findings: ["main.tex not found"] }

  const content = readFileSync(paths.main, "utf-8")
  const tetos: string[] = []

  // ficha catalográfica
  if (content.includes("ficha catalográfica") || content.includes("Ficha catalográfica")) {
    if (content.includes("CRB") && !content.includes("000")) tetos.push("ficha_caseira_6.0")
  }

  // conclusão vs considerações finais
  if (content.includes("\\chapter*{CONCLUSÃO}") || content.includes("\\chapter*{CONCLUSÕES}")) {
    tetos.push("conclusao_vs_consideracoes_finais_6.0")
  }

  // sumário
  if (!content.includes("\\tableofcontents")) findings.push("✗ missing \\tableofcontents")

  // abstract / resumo
  if (!content.includes("\\begin{abstract}") && !content.includes("resumo")) {
    findings.push("✗ missing abstract/resumo section")
  }

  // listas
  if (content.includes("\\listoffigures") || content.includes("\\listoftables")) {
    findings.push("has lists (ok)")
  }

  const score = tetos.length > 0 ? Math.min(5.5, 10 - tetos.length) : 7.0

  return { score, tetos, findings }
}

function auditCitacoes(projectRoot: string, config: any, paths: any): AxisResult {
  const findings: string[] = []
  if (!existsSync(paths.main)) return { score: 5, tetos: [], findings: ["main.tex not found"] }

  const content = readFileSync(paths.main, "utf-8")
  const citeRe = /\\cite(?:online)?\{[^}]+\}/g
  const paragraphs = content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 20)
  const withCit = paragraphs.filter((p: string) => { citeRe.lastIndex = 0; return citeRe.test(p) }).length

  const pctSemCit = paragraphs.length > 0 ? ((paragraphs.length - withCit) / paragraphs.length) * 100 : 0
  const pctComCit = 100 - pctSemCit

  findings.push(`paragraphs: ${paragraphs.length}, with citation: ${withCit} (${pctComCit.toFixed(1)}%)`)

  const tetos: string[] = []
  let score = 8.0

  if (pctSemCit > 30) {
    tetos.push(">30%_paragrafos_sem_citacao_4.0")
    score = 6.0
  } else if (pctSemCit > 20) {
    score = 6.0
  } else {
    score = 8.0
  }

  if (pctSemCit > 30) findings.push(`⚠ Critical: ${pctSemCit.toFixed(1)}% paragraphs without citation`)
  else if (pctSemCit > 20) findings.push(`⚠ Warning: ${pctSemCit.toFixed(1)}% paragraphs without citation`)

  // check if conclusion has citations
  if (content.includes("\\chapter*{CONSIDERAÇÕES FINAIS}") || content.includes("\\chapter*{CONCLUSÃO}")) {
    const conclusionMatch = content.match(/\\chapter\*\{CONSIDERAÇÕES FINAIS\}[\s\S]*$/)
    if (conclusionMatch) {
      const conclusionText = conclusionMatch[0]
      citeRe.lastIndex = 0
      if (!citeRe.test(conclusionText)) findings.push("⚠ conclusion has no citations")
    }
  }

  // external dependencies
  if (config.externalDependencies?.length > 0) {
    findings.push(`ℹ ${config.externalDependencies.length} external dependencies — not counted as failures`)
  }

  return { score, tetos, findings }
}

function auditConteudo(projectRoot: string, config: any, paths: any): AxisResult {
  const findings: string[] = []
  if (!existsSync(paths.main)) return { score: 5, tetos: [], findings: ["main.tex not found"] }

  const content = readFileSync(paths.main, "utf-8")
  const tetos: string[] = []

  // tabelas têm fonte?
  const tables = content.match(/\\begin\{table\}[\s\S]*?\\end\{table\}/g) || []
  let semFonte = 0
  for (const t of tables) {
    if (!t.match(/Fonte|fonte/)) semFonte++
  }
  if (semFonte > 0) findings.push(`⚠ ${semFonte}/${tables.length} tables without Fonte`)

  // benchmark sem fonte
  if (content.includes("56-58") || content.includes("56%") || content.includes("58%")) {
    if (!content.includes("\\cite")) {
      tetos.push("benchmark_sem_fonte_6.0")
      findings.push("⚠ benchmark 56-58% without citation")
    }
  }

  // objetivos
  if (!content.includes("objetivo") && !content.includes("Objetivo")) findings.push("✗ missing objective")
  if (!content.includes("metodologia") && !content.includes("Metodologia") && !content.includes("material e métodos") && !content.includes("MATERIAL E MÉTODOS")) {
    findings.push("✗ missing methodology section")
  }
  if (!content.includes("resultado") && !content.includes("Resultado")) findings.push("✗ missing results section")
  if (!content.includes("conclusão") && !content.includes("Conclusão") && !content.includes("CONSIDERAÇÕES FINAIS")) {
    findings.push("✗ missing conclusion")
  }

  const score = tetos.length > 0 ? 6.0 : 8.0

  return { score, tetos, findings }
}

function auditEstilo(projectRoot: string, config: any, paths: any): AxisResult {
  const findings: string[] = []
  if (!existsSync(paths.main)) return { score: 5, tetos: [], findings: ["main.tex not found"] }

  const content = readFileSync(paths.main, "utf-8")
  const tetos: string[] = []

  // em dashes
  const emdashCount = (content.match(/---/g) || []).length
  if (emdashCount > 0) findings.push(`⚠ ${emdashCount} em dashes (---) — prefer commas`)

  // "tcc" mention
  const tccCount = (content.match(/\bTCC\b/gi) || []).length
  if (tccCount > 0) findings.push(`ℹ "${tccCount}x TCC" found — consider alternative terms`)

  // pseudoreplication repetition
  let pseudoCount = 0
  const lowerContent = content.toLowerCase()
  let idx = -1
  while ((idx = lowerContent.indexOf("pseudoreplicação", idx + 1)) !== -1) pseudoCount++
  if (pseudoCount > 3) tetos.push(`pseudoreplicação_repetida_${pseudoCount}x_6.0`)

  // repeated "Em que:"
  const emQue = (content.match(/Em que:/g) || []).length
  if (emQue > 3) findings.push(`⚠ "Em que:" repeated ${emQue}x`)

  // subseção redundante
  if (content.includes("\\subsection{4.4}") || content.includes("\\subsection*{4.4}")) {
    findings.push("⚠ subseção 4.4 may be redundant")
  }

  const score = tetos.length > 0 ? 6.0 : 7.5

  return { score, tetos, findings }
}

export const bancaAuditar = tool({
  description: "Run 4-axis audit (ABNT, Citações, Conteúdo, Estilo) + integrated score.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    save: z.boolean().optional().describe("Save report to .banca/reports/"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)
    if (!existsSync(paths.main)) return `main file not found: ${paths.main}`

    const axes: Record<string, AxisResult> = {
      abnt: auditFichamento(root, config, paths),
      citacoes: auditCitacoes(root, config, paths),
      conteudo: auditConteudo(root, config, paths),
      estilo: auditEstilo(root, config, paths),
    }

    // collect all tetos as travas
    const allTetos = Object.values(axes).flatMap((a) => a.tetos)
    const allFindings = Object.values(axes).flatMap((a) => a.findings)

    // integrador
    const media = (axes.abnt.score + axes.citacoes.score + axes.conteudo.score + axes.estilo.score) / 4

    const travadoPor = allTetos.length > 0
      ? Math.min(...allTetos.map((t) => {
          const m = t.match(/([\d.]+)$/)
          return m ? parseFloat(m[1]) : 10
        }))
      : 10

    const notaFinal = Math.min(media, travadoPor)
    const aprovado = notaFinal >= config.targetScore

    // save state
    const state = loadState(root)
    state.currentScore = notaFinal
    state.lastAudit = new Date().toISOString()
    saveState(root, state)

    // report
    const sections = [
      { title: "ABNT / Estrutura", body: `Score: ${axes.abnt.score}\n\n${axes.abnt.findings.join("\n")}` },
      { title: "Citações / Fontes", body: `Score: ${axes.citacoes.score}\n\n${axes.citacoes.findings.join("\n")}` },
      { title: "Conteúdo / Lógica", body: `Score: ${axes.conteudo.score}\n\n${axes.conteudo.findings.join("\n")}` },
      { title: "Estilo Acadêmico", body: `Score: ${axes.estilo.score}\n\n${axes.estilo.findings.join("\n")}` },
    ]

    const report = generateReport(`AUDIT — ${config.targetScore} alvo`, [
      ...sections,
      { title: "Integrador", body: `Média: ${media.toFixed(2)}\nTrava(s): ${allTetos.join(", ") || "—"}\n**Final: ${notaFinal.toFixed(1)}**\n${aprovado ? "✓ Aprovado" : "✗ Reprovado"}` },
    ])

    if (args.save) saveReport(root, `audit-${Date.now()}.md`, report)

    return [
      "## AUDIT RESULT",
      `ABNT:       ${axes.abnt.score.toFixed(1)}  (${axes.abnt.findings.length} findings)`,
      `Citações:   ${axes.citacoes.score.toFixed(1)}  (${axes.citacoes.findings.length} findings)`,
      `Conteúdo:   ${axes.conteudo.score.toFixed(1)}  (${axes.conteudo.findings.length} findings)`,
      `Estilo:     ${axes.estilo.score.toFixed(1)}  (${axes.estilo.findings.length} findings)`,
      `---`,
      `Média: ${media.toFixed(2)}`,
      allTetos.length > 0 ? `Trava(s): ${allTetos.join(", ")}` : "",
      `**Final: ${notaFinal.toFixed(1)}**`,
      aprovado ? "✓ APROVADO" : "✗ REPROVADO",
    ].filter(Boolean).join("\n")
  },
})
