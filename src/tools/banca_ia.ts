import { existsSync, lstatSync, readFileSync } from "node:fs"
import { isAbsolute, relative, sep } from "node:path"
import { spawnSync } from "node:child_process"
import type { SpawnSyncReturns } from "node:child_process"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"
import { saveReport } from "../lib/reports"
import { PathTraversalError, realWorkspaceRoot, resolveRealInsideRoot } from "../lib/safe_paths"

const PATTERNS: RegExp[] = [
  /(ademais|outrossim|destarte|sobremaneira|conquanto|tampouco)\b/gi,
  /(é imperativo|é crucial|é fundamental|é mister) que\b/gi,
  /(não apenas|mas também|não obstante|não só)\b/gi,
  /(torna-se evidente|vale ressaltar|convém salientar|importa notar)\b/gi,
  /(em outras palavras|ou seja|isto é|dito de outro modo)\b/gi,
  /(cabe destacar|faz-se necessário|haja vista|tendo em vista)\b/gi,
]

/** Limite histórico de parágrafos por arquivo no caminho Python. Não expandir aqui. */
const PYTHON_PARAGRAPH_LIMIT = 50

/**
 * Constantes internas usadas pelos subprocessos de sonda/análise Python.
 * É um seam de teste: o código de produção não expõe estes valores na API da
 * ferramenta e os testes restauram os valores originais ao final.
 */
export const bancaIaInternals = {
  probeTimeoutMs: 5000,
  analysisTimeoutMs: 60000,
}

type Method = "python" | "regex" | "none"

type ReasonCode =
  | "python-ok"
  | "force-regex"
  | "python-unavailable"
  | "python-start-failed"
  | "python-timeout"
  | "python-signal"
  | "python-exit-code"
  | "python-invalid-json"
  | "python-detector-error"
  | "python-schema-invalid"
  | "python-invalid-score"
  | "python-inconsistent-counts"
  | "no-eligible-content"
  | "file-unreadable"

const REASON_LABELS: Record<ReasonCode, string> = {
  "python-ok": "execução Python válida",
  "force-regex": "forceRegex ativo: caminho Python desativado",
  "python-unavailable": "Python/pt_ai_detector indisponível",
  "python-start-failed": "falha ao iniciar o subprocesso Python",
  "python-timeout": "timeout na execução Python",
  "python-signal": "execução Python encerrada por sinal",
  "python-exit-code": "execução Python com exit code diferente de zero",
  "python-invalid-json": "resposta Python ausente ou JSON inválido",
  "python-detector-error": "erro explícito retornado pelo detector",
  "python-schema-invalid": "campos obrigatórios ausentes ou malformados",
  "python-invalid-score": "score não finito ou fora do domínio [0,1]",
  "python-inconsistent-counts": "contagens incompatíveis com elegíveis ou limite 50",
  "no-eligible-content": "nenhum parágrafo elegível",
  "file-unreadable": "arquivo não pôde ser lido (I/O)",
}

type Segmentation = "python" | "regex" | "none"

type ProbeOutcome = { available: boolean; code: string }

type PythonAnalysis =
  | { ok: true; risk: number; paragraphsTotal: number; paragraphsAnalyzed: number }
  | { ok: false; reason: ReasonCode }

type RegexAnalysis = { matches: number; firstExcerpt: string | null; riskLabel: "low" | "moderate" | "high" }

type FileResult = {
  file: string
  method: Method
  reason: ReasonCode
  segmentation: Segmentation
  pythonEligible: number
  regexEligible: number
  eligible: number
  analyzed: number
  omitted: number
  truncated: boolean
  indicator: string
  excerpt: string | null
  fallback: string
  pythonRisk: number | null
}

// ---------------------------------------------------------------------------
// Caminho Python: sonda de disponibilidade e análise com validação estrita.
// A disponibilidade do módulo é apenas uma sonda; nunca é prova de execução.
// ---------------------------------------------------------------------------

const PROBE_CODE = "import pt_ai_detector; print('ok')"

const PYTHON_ANALYSIS_SCRIPT = `
import sys, json

def fail(code, stage, cls=""):
    print(json.dumps({"ok": False, "error_code": code, "error_stage": stage, "error_class": cls}))
    sys.exit(1)

if len(sys.argv) < 3:
    fail("missing_arguments", "arguments")
module_dir = sys.argv[1]
file_path = sys.argv[2]
sys.path.insert(0, module_dir)
try:
    from pt_ai_detector import detect_text
except ImportError as exc:
    fail("pt_ai_detector_not_available", "import", type(exc).__name__)
except Exception as exc:
    fail("detector_import_error", "import", type(exc).__name__)
try:
    with open(file_path, encoding="utf-8") as handle:
        text = handle.read()
except OSError as exc:
    fail("file_read_error", "read", type(exc).__name__)
paragraphs = [p for p in text.split("\\n\\n") if len(p.strip()) > 20]
limit = ${PYTHON_PARAGRAPH_LIMIT}
scores = []
for paragraph in paragraphs[:limit]:
    try:
        result = detect_text(paragraph)
    except Exception as exc:
        fail("detector_error", "paragraph-analysis", type(exc).__name__)
    if not isinstance(result, dict):
        fail("invalid_paragraph_result", "paragraph-analysis", "non_dict")
    if result.get("error"):
        fail("detector_error", "paragraph-analysis", "reported_error")
    value = result.get("ai_score")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        fail("invalid_paragraph_result", "paragraph-analysis", "invalid_ai_score")
    value = float(value)
    if value != value or value in (float("inf"), float("-inf")) or value < 0.0 or value > 1.0:
        fail("invalid_paragraph_result", "paragraph-analysis", "out_of_domain")
    scores.append(value)
risk = sum(scores) / len(scores) if scores else 0.0
print(json.dumps({"ok": True, "risk": round(risk, 4), "paragraphs_total": len(paragraphs), "paragraphs_analyzed": len(scores)}))
`

function probePythonEnsemble(): ProbeOutcome {
  try {
    const result = spawnSync("python3", ["-c", PROBE_CODE], {
      encoding: "utf-8",
      timeout: bancaIaInternals.probeTimeoutMs,
    })
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code
      return { available: false, code: code === "ETIMEDOUT" ? "probe-timeout" : "python-missing" }
    }
    if (result.signal) return { available: false, code: "probe-signal" }
    if (result.status !== 0) return { available: false, code: "probe-exit-code" }
    if ((result.stdout || "").trim() !== "ok") return { available: false, code: "probe-invalid-output" }
    return { available: true, code: "probe-ok" }
  } catch {
    return { available: false, code: "python-missing" }
  }
}

/**
 * Executa e valida a resposta do subprocesso Python.
 * Resultados ausentes, inválidos, incoerentes ou não finitos NUNCA são
 * convertidos em score zero: retornam uma falha explícita por arquivo.
 */
function analyzePython(filePath: string, moduleDir: string, pythonEligible: number): PythonAnalysis {
  let result: SpawnSyncReturns<string>
  try {
    result = spawnSync("python3", ["-c", PYTHON_ANALYSIS_SCRIPT, moduleDir, filePath], {
      encoding: "utf-8",
      timeout: bancaIaInternals.analysisTimeoutMs,
    })
  } catch {
    return { ok: false, reason: "python-start-failed" }
  }

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    return { ok: false, reason: code === "ETIMEDOUT" ? "python-timeout" : "python-start-failed" }
  }
  if (result.signal) {
    return { ok: false, reason: "python-signal" }
  }

  const stdout = (result.stdout || "").trim()
  const exitCode = result.status
  let parsed: unknown
  let jsonValid = false
  if (stdout.length > 0) {
    try {
      parsed = JSON.parse(stdout)
      jsonValid = true
    } catch {
      jsonValid = false
    }
  }
  if (!jsonValid) {
    return { ok: false, reason: exitCode !== 0 ? "python-exit-code" : "python-invalid-json" }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: exitCode !== 0 ? "python-exit-code" : "python-schema-invalid" }
  }
  const payload = parsed as Record<string, unknown>
  if (payload.ok === false) {
    const errorCode = typeof payload.error_code === "string" ? payload.error_code : ""
    if (errorCode === "pt_ai_detector_not_available") {
      return { ok: false, reason: "python-unavailable" }
    }
    return { ok: false, reason: "python-detector-error" }
  }
  if (payload.ok !== true) {
    return { ok: false, reason: exitCode !== 0 ? "python-exit-code" : "python-schema-invalid" }
  }
  if (exitCode !== 0) {
    return { ok: false, reason: "python-exit-code" }
  }
  if (typeof payload.error === "string" && payload.error.trim() !== "") {
    return { ok: false, reason: "python-detector-error" }
  }

  const risk = payload.risk
  const total = payload.paragraphs_total
  const analyzed = payload.paragraphs_analyzed
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    return { ok: false, reason: "python-schema-invalid" }
  }
  if (typeof analyzed !== "number" || !Number.isInteger(analyzed) || analyzed < 0) {
    return { ok: false, reason: "python-schema-invalid" }
  }
  if (typeof risk !== "number" || !Number.isFinite(risk) || risk < 0 || risk > 1) {
    return { ok: false, reason: "python-invalid-score" }
  }
  const expectedTotal = pythonEligible
  const expectedAnalyzed = Math.min(pythonEligible, PYTHON_PARAGRAPH_LIMIT)
  if (total !== expectedTotal || analyzed !== expectedAnalyzed) {
    return { ok: false, reason: "python-inconsistent-counts" }
  }
  return { ok: true, risk, paragraphsTotal: total, paragraphsAnalyzed: analyzed }
}

// ---------------------------------------------------------------------------
// Heurística regex existente (padrões, fórmulas e thresholds preservados).
// ---------------------------------------------------------------------------

function countPythonEligible(content: string): number {
  return content.split("\n\n").filter((p) => p.trim().length > 20).length
}

function countRegexEligible(content: string): number {
  return content.split(/\n\s*\n/).filter((p) => p.trim().length > 20).length
}

function analyzeRegex(content: string): RegexAnalysis {
  let matches = 0
  let firstExcerpt: string | null = null
  const paragraphs = content.split(/\n\s*\n/).filter((p: string) => p.trim().length > 20)
  for (const para of paragraphs) {
    let nM = 0
    for (const pattern of PATTERNS) {
      const found = para.match(pattern)
      if (found) nM += found.length
    }
    if (nM > 2) {
      matches += nM
      if (firstExcerpt === null) firstExcerpt = `${sanitizeExcerpt(para)}... (${nM} matches)`
    }
  }
  const riskLabel = matches > 20 ? "high" : matches > 10 ? "moderate" : "low"
  return { matches, firstExcerpt, riskLabel }
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

function sanitizeExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 60)
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function relativeSafe(root: string, canonical: string): string {
  const rel = relative(realWorkspaceRoot(root), canonical)
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathTraversalError("path escapes workspace root")
  }
  return rel.split(sep).join("/")
}

function segmentationLabel(segmentation: Segmentation): string {
  if (segmentation === "python") return "Python (`\\n\\n`, parágrafo >20 caracteres)"
  if (segmentation === "regex") return "Regex (`\\n\\s*\\n`, parágrafo >20 caracteres)"
  return "N/A"
}

function pythonRiskLabel(risk: number): "low" | "moderate" | "high" {
  return risk > 0.5 ? "high" : risk > 0.2 ? "moderate" : "low"
}

function pythonResult(
  file: string,
  analysis: { risk: number; paragraphsTotal: number; paragraphsAnalyzed: number },
  pythonEligible: number,
  regexEligible: number,
): FileResult {
  const omitted = analysis.paragraphsTotal - analysis.paragraphsAnalyzed
  return {
    file,
    method: "python",
    reason: "python-ok",
    segmentation: "python",
    pythonEligible,
    regexEligible,
    eligible: analysis.paragraphsTotal,
    analyzed: analysis.paragraphsAnalyzed,
    omitted,
    truncated: omitted > 0,
    indicator: `risk=${pythonRiskLabel(analysis.risk)} score=${analysis.risk} (score Python não calibrado; thresholds locais preservados)`,
    excerpt: null,
    fallback: "não aplicável (execução Python válida)",
    pythonRisk: analysis.risk,
  }
}

function regexResult(
  file: string,
  reason: ReasonCode,
  analysis: RegexAnalysis,
  pythonEligible: number,
  regexEligible: number,
): FileResult {
  const fallback =
    reason === "force-regex"
      ? "não aplicável (forceRegex solicitado explicitamente)"
      : reason === "python-unavailable"
        ? "regex aplicada porque Python está indisponível (python-unavailable)"
        : `regex aplicada após falha do caminho Python (${reason}); diagnóstico sanitizado, sem stderr`
  return {
    file,
    method: "regex",
    reason,
    segmentation: "regex",
    pythonEligible,
    regexEligible,
    eligible: regexEligible,
    analyzed: regexEligible,
    omitted: 0,
    truncated: false,
    indicator: `risk=${analysis.riskLabel} patterns=${analysis.matches} (indicador binário heurístico; matches>20 high, matches>10 moderate; não comparável ao score Python)`,
    excerpt: analysis.firstExcerpt,
    fallback,
    pythonRisk: null,
  }
}

function notAnalysedResult(
  file: string,
  reason: ReasonCode,
  segmentation: Segmentation,
  pythonEligible: number,
  regexEligible: number,
  fallback: string,
): FileResult {
  const eligible =
    segmentation === "python" ? pythonEligible : segmentation === "regex" ? regexEligible : 0
  return {
    file,
    method: "none",
    reason,
    segmentation,
    pythonEligible,
    regexEligible,
    eligible,
    analyzed: 0,
    omitted: eligible,
    truncated: false,
    indicator: "não produzido (nenhum parágrafo analisado)",
    excerpt: null,
    fallback,
    pythonRisk: null,
  }
}

function methodLabel(method: Method): string {
  return method === "python" ? "python" : method === "regex" ? "regex" : "none"
}

function globalMethodLabel(pythonFiles: number, regexFiles: number): string {
  if (pythonFiles > 0 && regexFiles > 0) return "Métodos mistos (Python + Regex heuristic)"
  if (pythonFiles > 0) return "Python (pt_ai_detector)"
  if (regexFiles > 0) return "Regex heuristic"
  return "Nenhum (nada analisado)"
}

function probeSummary(forceRegex: boolean, probe: ProbeOutcome | null): string {
  if (forceRegex) return "não executada (forceRegex)"
  if (!probe) return "não executada"
  return probe.available ? "disponível" : `indisponível (diagnóstico: ${probe.code})`
}

function buildReport(
  forceRegex: boolean,
  probe: ProbeOutcome | null,
  configuredMissing: number,
  results: FileResult[],
): string {
  const analyzedResults = results.filter((r) => r.method !== "none")
  const pythonFiles = results.filter((r) => r.method === "python")
  const regexFiles = results.filter((r) => r.method === "regex")

  const pythonEligibleTotal = results.reduce((sum, r) => sum + r.pythonEligible, 0)
  const pythonAnalyzedTotal = pythonFiles.reduce((sum, r) => sum + r.analyzed, 0)
  const pythonOmittedTotal = pythonFiles.reduce((sum, r) => sum + r.omitted, 0)
  const pythonCoveredEligible = pythonFiles.reduce((sum, r) => sum + r.eligible, 0)
  const regexEligibleTotal = results.reduce((sum, r) => sum + r.regexEligible, 0)
  const regexAnalyzedTotal = regexFiles.reduce((sum, r) => sum + r.analyzed, 0)
  const regexCoveredEligible = regexFiles.reduce((sum, r) => sum + r.eligible, 0)
  const regexFlagged = regexFiles.filter((r) => r.indicator.startsWith("risk=moderate") || r.indicator.startsWith("risk=high")).length
  const pythonRiskTotal = pythonFiles.reduce((sum, r) => sum + (r.pythonRisk ?? 0), 0)
  const truncatedFiles = results.filter((r) => r.truncated)
  const truncatedParagraphs = truncatedFiles.reduce((sum, r) => sum + r.omitted, 0)

  const state = analyzedResults.length > 0 ? "analise-concluida" : "ausencia-de-evidencia"
  const truncationLine = truncatedFiles.length > 0
    ? `sim — ${truncatedFiles.length} arquivo(s), ${truncatedParagraphs} parágrafo(s) omitido(s) por limite`
    : "não"

  const pythonAggregate = pythonFiles.length > 0
    ? `média ${round4(pythonFiles.length === 0 ? 0 : pythonRiskTotal / pythonFiles.length)} em ${pythonFiles.length} arquivo(s); ${pythonAnalyzedTotal} parágrafo(s) analisado(s); cobertura ${pythonAnalyzedTotal}/${pythonCoveredEligible} elegíveis (${pythonOmittedTotal} omitido(s) por limite)`
    : "não aplicável (nenhum arquivo analisado por Python)"

  const regexAggregate = regexFiles.length > 0
    ? `${regexFlagged} de ${regexFiles.length} arquivo(s) com indicador acionado (matches>10); ${regexAnalyzedTotal} parágrafo(s) analisado(s); cobertura ${regexAnalyzedTotal}/${regexCoveredEligible} elegíveis`
    : "não aplicável (nenhum arquivo analisado por regex)"

  const lines: string[] = [
    "# IA Detection Report",
    "",
    `**Gerado em:** ${new Date().toISOString()}`,
    "**Ferramenta:** `banca_ia` — triagem heurística local (sinal não conclusivo)",
    `**Método global efetivo:** ${globalMethodLabel(pythonFiles.length, regexFiles.length)}`,
    `**Estado:** ${state}`,
    `**Sonda Python:** ${probeSummary(forceRegex, probe)}`,
    "**Escopo:** sinais heurísticos locais; não comprova autoria, fraude ou nota; não substitui a auditoria integral do manuscrito.",
    "",
    "## Resumo de cobertura",
    `- Arquivos descobertos: ${results.length}`,
    `- Arquivos configurados ausentes ou inválidos: ${configuredMissing}`,
    `- Arquivos efetivamente analisados: ${analyzedResults.length}`,
    `- Arquivos não analisados: ${results.length - analyzedResults.length}`,
    `- Parágrafos elegíveis (segmentação Python): ${pythonEligibleTotal}`,
    `- Parágrafos analisados por Python: ${pythonAnalyzedTotal}`,
    `- Parágrafos omitidos por limite Python (50/arquivo): ${pythonOmittedTotal}`,
    `- Parágrafos elegíveis (segmentação regex): ${regexEligibleTotal}`,
    `- Parágrafos analisados por regex: ${regexAnalyzedTotal}`,
    `- Truncamento: ${truncationLine}`,
  ]
  if (analyzedResults.length === 0 && results.length > 0) {
    lines.push(
      "- Ausência de evidência: nenhum parágrafo elegível foi analisado; isto não é classificação de risco baixo nem evidência de autoria.",
    )
  }
  lines.push(
    "",
    "## Cobertura por arquivo",
    "| Arquivo | Método efetivo | Motivo | Elegíveis | Analisados | Omitidos | Truncado |",
    "|---|---|---|---|---|---|---|",
  )
  for (const r of results) {
    lines.push(
      `| \`${escapeTableCell(r.file)}\` | \`${methodLabel(r.method)}\` | \`${r.reason}\` | ${r.eligible} | ${r.analyzed} | ${r.omitted} | ${r.truncated ? "sim" : "não"} |`,
    )
  }
  lines.push("", "## Resultados por arquivo")
  for (const r of results) {
    lines.push(
      "",
      `### \`${escapeTableCell(r.file)}\``,
      `- Método efetivo: \`${methodLabel(r.method)}\``,
      `- Motivo: \`${r.reason}\` — ${REASON_LABELS[r.reason]}`,
      `- Segmentação: ${segmentationLabel(r.segmentation)}`,
      `- Elegíveis (método): ${r.eligible}`,
      `- Analisados: ${r.analyzed}`,
      `- Omitidos: ${r.omitted}`,
      `- Truncamento: ${r.truncated ? "sim" : "não"}`,
      `- Contagem de elegíveis por segmentação: Python=${r.pythonEligible}; Regex=${r.regexEligible}`,
      `- Indicador heurístico: ${r.indicator}`,
    )
    if (r.method !== "python" && r.pythonEligible > 0) {
      lines.push(`- Parágrafos Python não analisados (falha, indisponibilidade ou desativação): ${r.pythonEligible}`)
    }
    if (r.excerpt !== null) {
      lines.push(`- Trecho sinalizado (primeiro): "${r.excerpt}"`)
    }
    lines.push(`- Fallback: ${r.fallback}`)
  }
  lines.push(
    "",
    "## Agregados heurísticos por método",
    `- Python (score heurístico não calibrado): ${pythonAggregate}`,
    `- Regex heuristic (indicador binário heurístico não calibrado): ${regexAggregate}`,
    "- Média combinada Python+regex: não calculada; os métodos produzem medidas diferentes e não comparáveis.",
    "",
    "## Limitações metodológicas",
    '- A ferramenta produz sinais heurísticos, não provas de autoria; escrita acadêmica legítima — por exemplo, com conectivos como "ademais", "outrossim", "não obstante", "ou seja" e "vale ressaltar" — pode gerar os mesmos sinais.',
    "- O caminho Python apenas executa o detector externo `pt_ai_detector` quando ele já está instalado no ambiente; a sonda de disponibilidade não comprova execução bem-sucedida. A confiança fixa histórica de 0.85 não é calibrada e não é apresentada como probabilidade de autoria.",
    "- O caminho regex conta padrões lexicais existentes e produz indicador binário; matches não são comparáveis ao score Python nem constituem confiança calibrada.",
    "- As segmentações diferem: Python divide por linha em branco dupla (`\\n\\n`) e a regex por linha em branco com espaços (`\\n\\s*\\n`), ambas com parágrafo >20 caracteres; por isso as contagens de elegíveis podem divergir entre os métodos.",
    "- O caminho Python analisa no máximo 50 parágrafos elegíveis por arquivo; a cobertura informada é local à ferramenta e não equivale à cobertura integral do manuscrito nem ao plano canônico de auditoria, checkpoints ou síntese acadêmica do DSHbanca.",
    "- Este relatório não constitui nota acadêmica, parecer conclusivo ou recomendação de penalidade e não demonstra fraude.",
  )
  return lines.join("\n")
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function buildAbsentReport(configuredMissing: number): string {
  return [
    "# IA Detection Report",
    "",
    "**Estado:** ausencia-de-manuscrito",
    "**Ferramenta:** `banca_ia` — triagem heurística local (sinal não conclusivo)",
    "**Método global efetivo:** Nenhum (nada analisado)",
    `**Arquivos configurados ausentes ou inválidos:** ${configuredMissing}`,
    "**Escopo:** sinais heurísticos locais; não comprova autoria, fraude ou nota; não substitui a auditoria integral do manuscrito.",
    "",
    "Nenhum arquivo de manuscrito foi encontrado para análise. Ausência de arquivo não constitui evidência de risco baixo, de autoria humana ou artificial, nem substitui a auditoria integral do manuscrito. Nenhum relatório foi persistido porque não houve análise.",
  ].join("\n")
}

export const bancaIa = defineBancaTool({
  description: "Scan manuscript for AI-generated text risk. Uses Python ensemble if available, otherwise regex heuristic.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
    forceRegex: z.boolean().optional().describe("Skip Python check, use regex only"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const paths = resolveManuscriptPaths(root, loadConfig(root))
    const rawFiles = [paths.main, ...paths.chapters]
    const files: Array<{ file: string; canonical: string }> = []
    let configuredMissing = 0

    for (const file of rawFiles) {
      try {
        lstatSync(file)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          configuredMissing++
          continue
        }
        throw new PathTraversalError("failed to inspect a workspace path component")
      }
      const canonical = resolveRealInsideRoot(root, file)
      if (!existsSync(canonical) || !lstatSync(canonical).isFile()) {
        configuredMissing++
        continue
      }
      files.push({ file, canonical })
    }

    if (files.length === 0) {
      return buildAbsentReport(configuredMissing)
    }

    const forceRegex = args.forceRegex === true
    const probe = forceRegex ? null : probePythonEnsemble()
    const results: FileResult[] = []

    for (const { canonical } of files) {
      const name = relativeSafe(root, canonical)
      let content: string
      try {
        content = readFileSync(canonical, "utf-8")
      } catch {
        results.push(
          notAnalysedResult(
            name,
            "file-unreadable",
            "none",
            0,
            0,
            "sem fallback: arquivo ilegível; nenhuma classificação é produzida",
          ),
        )
        continue
      }

      const pythonEligible = countPythonEligible(content)
      const regexEligible = countRegexEligible(content)

      if (forceRegex) {
        if (regexEligible === 0) {
          results.push(
            notAnalysedResult(
              name,
              "no-eligible-content",
              "regex",
              pythonEligible,
              regexEligible,
              "não aplicável (nenhum parágrafo elegível)",
            ),
          )
        } else {
          results.push(regexResult(name, "force-regex", analyzeRegex(content), pythonEligible, regexEligible))
        }
        continue
      }

      if (!probe || !probe.available) {
        if (regexEligible === 0) {
          results.push(
            notAnalysedResult(
              name,
              "no-eligible-content",
              "regex",
              pythonEligible,
              regexEligible,
              "sem fallback útil: Python indisponível (python-unavailable) e a regex não tem parágrafos elegíveis",
            ),
          )
        } else {
          results.push(regexResult(name, "python-unavailable", analyzeRegex(content), pythonEligible, regexEligible))
        }
        continue
      }

      if (pythonEligible === 0) {
        results.push(
          notAnalysedResult(
            name,
            "no-eligible-content",
            "python",
            pythonEligible,
            regexEligible,
            "não aplicável (nenhum parágrafo elegível)",
          ),
        )
        continue
      }

      const analysis = analyzePython(canonical, __dirname, pythonEligible)
      if (analysis.ok) {
        results.push(pythonResult(name, analysis, pythonEligible, regexEligible))
        continue
      }

      if (regexEligible === 0) {
        results.push(
          notAnalysedResult(
            name,
            "no-eligible-content",
            "regex",
            pythonEligible,
            regexEligible,
            `sem fallback útil: Python falhou (${analysis.reason}) e a regex não tem parágrafos elegíveis`,
          ),
        )
      } else {
        results.push(regexResult(name, analysis.reason, analyzeRegex(content), pythonEligible, regexEligible))
      }
    }

    const report = buildReport(forceRegex, probe, configuredMissing, results)
    saveReport(root, `ia-${Date.now()}.md`, report)
    return report
  },
})
