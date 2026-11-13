/**
 * Focal tests for issue #113 — `banca_ia` method/coverage report contract.
 *
 * Contract of record: /tmp/dshbanca-113-contract.md (22 scenarios in §9,
 * exact report markers in §8, reason codes in §6/§7, hermetic rules in §10).
 *
 * Hermetic by construction:
 * - every scenario uses a synthetic workspace created with `mkdtempSync(tmpdir())`;
 * - `python3` is resolved from an isolated PATH whose first entry is an executable
 *   shell stub written inside the temporary base directory. The real
 *   `pt_ai_detector` package is never imported, no network is used and no
 *   external manuscript is touched;
 * - `process.env.PATH`, the stub env vars and the `bancaIaInternals` seam are
 *   captured once at module scope and fully restored in `afterEach`;
 * - the timeout scenario only mutates `bancaIaInternals.analysisTimeoutMs` to
 *   300ms and the seam is restored afterwards.
 *
 * RED tolerance: the seam `bancaIaInternals` does not exist in the historical
 * implementation. The tests that need it fail with an explicit message instead
 * of hanging on the historical hard-coded timeout; all other scenarios fail
 * because the historical report does not expose the new method/coverage/reason
 * contract at all (no syntax or import error is involved).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

// ---------------------------------------------------------------------------
// Test seam (§2): save the original `bancaIaInternals` values exactly once.
// The seam is optional so the RED phase fails with a clear message instead of
// crashing at module load; the GREEN phase restores it in afterEach.
// ---------------------------------------------------------------------------
let initialModule: any = null
try {
  initialModule = await import("../src/tools/banca_ia")
} catch {
  initialModule = null
}

const ORIGINAL_INTERNALS = {
  probeTimeoutMs: initialModule?.bancaIaInternals?.probeTimeoutMs as number | undefined,
  analysisTimeoutMs: initialModule?.bancaIaInternals?.analysisTimeoutMs as number | undefined,
}

let loadedInternals: any = null

async function importBancaIa(): Promise<any> {
  const mod: any = await import("../src/tools/banca_ia")
  if (!loadedInternals && mod?.bancaIaInternals && typeof mod.bancaIaInternals === "object") {
    loadedInternals = mod.bancaIaInternals
  }
  return mod
}

function requireInternals(mod: any): { probeTimeoutMs: number; analysisTimeoutMs: number } {
  const internals = mod?.bancaIaInternals
  if (!internals || typeof internals !== "object") {
    throw new Error(
      "Contrato #113 §2 não implementado: `bancaIaInternals` está ausente em src/tools/banca_ia; " +
        "o cenário de timeout do caminho Python não pode ser exercitado (RED).",
    )
  }
  if (typeof internals.probeTimeoutMs !== "number" || typeof internals.analysisTimeoutMs !== "number") {
    throw new Error(
      "Contrato #113 §2: `bancaIaInternals` deve expor `probeTimeoutMs` e `analysisTimeoutMs` numéricos.",
    )
  }
  return internals
}

// ---------------------------------------------------------------------------
// Hermetic `python3` stub. Invocation shapes (contract §2):
//   probe   → 2 arguments after the binary ("-c", <code>)
//   analysis→ 4 arguments after the binary ("-c", <script>, <moduleDir>, <filePath>)
// Behaviour is driven by files inside $BANCA_IA_STUB_CONTROL. Invocations are
// recorded in $BANCA_IA_STUB_MARKER so tests can prove when no subprocess ran.
// The stub never reads the analysis script, the module dir or the detector.
// ---------------------------------------------------------------------------
const STUB_STDERR_SECRET = "stub-stderr-must-not-be-echoed"

const PYTHON_STUB_SCRIPT = `#!/bin/sh
# Hermetic python3 stub for tests/banca_ia_method_coverage.test.ts (issue #113).
# Never imports pt_ai_detector, never uses the network.
CONTROL="$BANCA_IA_STUB_CONTROL"
MARKER="$BANCA_IA_STUB_MARKER"
if [ -z "$CONTROL" ]; then
  printf 'stub: missing BANCA_IA_STUB_CONTROL\\n' >&2
  exit 97
fi

record() {
  if [ -n "$MARKER" ]; then
    printf '%s\\n' "$1" >> "$MARKER"
  fi
}

read_first_line() {
  _file="$1"
  if [ ! -f "$_file" ]; then
    return 0
  fi
  _line=""
  IFS= read -r _line < "$_file" || true
  printf '%s' "$_line"
}

if [ "$#" -eq 2 ]; then
  record "probe"
  _mode=$(read_first_line "$CONTROL/probe.mode")
  [ -n "$_mode" ] || _mode="ok"
  case "$_mode" in
    ok)
      printf 'ok\\n'
      exit 0
      ;;
    invalid-output)
      printf 'not-ok\\n'
      exit 0
      ;;
    sleep)
      _secs=$(read_first_line "$CONTROL/probe.sleepSeconds")
      [ -n "$_secs" ] || _secs=5
      exec sleep "$_secs"
      ;;
    signal)
      kill -TERM $$
      exit 0
      ;;
    *)
      printf 'Traceback: ModuleNotFoundError: No module named pt_ai_detector\\n' >&2
      exit 1
      ;;
  esac
fi

if [ "$#" -eq 4 ]; then
  _base=$(basename "$4")
  record "analysis $_base"
  printf '%s %s\\n' "${STUB_STDERR_SECRET}" "$_base" >&2
  _mode=$(read_first_line "$CONTROL/analysis.$_base.mode")
  [ -n "$_mode" ] || _mode=$(read_first_line "$CONTROL/analysis.mode")
  [ -n "$_mode" ] || _mode="normal"
  case "$_mode" in
    sleep)
      _secs=$(read_first_line "$CONTROL/analysis.$_base.sleepSeconds")
      [ -n "$_secs" ] || _secs=$(read_first_line "$CONTROL/analysis.sleepSeconds")
      [ -n "$_secs" ] || _secs=5
      exec sleep "$_secs"
      ;;
    signal)
      kill -TERM $$
      exit 0
      ;;
    *)
      _stdout="$CONTROL/analysis.$_base.stdout"
      [ -f "$_stdout" ] || _stdout="$CONTROL/analysis.stdout"
      if [ -f "$_stdout" ]; then
        while IFS= read -r _line || [ -n "$_line" ]; do
          printf '%s\\n' "$_line"
        done < "$_stdout"
      fi
      _exit=$(read_first_line "$CONTROL/analysis.$_base.exit")
      [ -n "$_exit" ] || _exit=$(read_first_line "$CONTROL/analysis.exit")
      [ -n "$_exit" ] || _exit=0
      exit "$_exit"
      ;;
  esac
fi

record "unexpected-arguments $#"
printf 'stub: unexpected invocation shape\\n' >&2
exit 64
`

// Environment captured once at module scope and restored in afterEach.
const FALLBACK_SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin"
const ORIGINAL_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  BANCA_IA_STUB_CONTROL: process.env.BANCA_IA_STUB_CONTROL,
  BANCA_IA_STUB_MARKER: process.env.BANCA_IA_STUB_MARKER,
}

const symlinksSupported = (() => {
  try {
    const probe = join(tmpdir(), `banca-ia-113-link-probe-${process.pid}-${Date.now()}`)
    symlinkSync(tmpdir(), probe)
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
})()
const symlinkTest = symlinksSupported ? test : test.skip

// Root never sees chmod-based read denials, so the TOCTOU read-failure
// scenario is only exercised for an unprivileged uid.
const canSimulateUnreadableFile =
  typeof process.getuid !== "function" || process.getuid() !== 0
const unreadableFileTest = canSimulateUnreadableFile ? test : test.skip

// ---------------------------------------------------------------------------
// Per-test fixture
// ---------------------------------------------------------------------------
let base: string
let project: string
let stubDir: string
let controlDir: string
let markerPath: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "banca-ia-113-"))
  project = join(base, "project")
  stubDir = join(base, "stub-bin")
  controlDir = join(base, "stub-control")
  markerPath = join(controlDir, "invocations.log")
  mkdirSync(project, { recursive: true })
  mkdirSync(join(project, ".banca"), { recursive: true })
  mkdirSync(stubDir, { recursive: true })
  mkdirSync(controlDir, { recursive: true })
  writeFileSync(join(stubDir, "python3"), PYTHON_STUB_SCRIPT, "utf-8")
  chmodSync(join(stubDir, "python3"), 0o755)
  const systemPath = ORIGINAL_ENV.PATH ?? FALLBACK_SYSTEM_PATH
  process.env.PATH = `${stubDir}:${systemPath}`
  process.env.BANCA_IA_STUB_CONTROL = controlDir
  process.env.BANCA_IA_STUB_MARKER = markerPath
})

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (loadedInternals) {
    if (typeof ORIGINAL_INTERNALS.probeTimeoutMs === "number") {
      loadedInternals.probeTimeoutMs = ORIGINAL_INTERNALS.probeTimeoutMs
    }
    if (typeof ORIGINAL_INTERNALS.analysisTimeoutMs === "number") {
      loadedInternals.analysisTimeoutMs = ORIGINAL_INTERNALS.analysisTimeoutMs
    }
  }
  if (base) rmSync(base, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Fixture helpers: project config, manuscripts and stub control
// ---------------------------------------------------------------------------
function writeProjectJson(
  manuscript: Partial<{ root: string; main: string; chapters: string[] }> = {},
): void {
  const config = {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "refs.bib",
      chapters: ["capitulos/*.tex"],
      outputDir: "trabalhos",
      ...manuscript,
    },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9.0,
    providers: {
      references: {
        primary: "mcp:crossref-academic",
        fallbacks: ["rest:crossref", "cache"],
        timeoutMs: 20000,
      },
    },
    mcp: { crossrefAcademicEnabled: true },
  }
  writeFileSync(join(project, ".banca", "project.json"), JSON.stringify(config), "utf-8")
}

/** Synthetic academic paragraph full of legitimate connectives (contract §9.1). */
const CONNECTIVE_SENTENCE =
  "Ademais, é imperativo que consideremos esta questão, não obstante as críticas, sobremaneira."

function paragraphs(count: number): string {
  const out: string[] = []
  for (let index = 1; index <= count; index++) {
    out.push(`${CONNECTIVE_SENTENCE} Parágrafo ${index} do manuscrito sintético.`)
  }
  return out.join("\n\n")
}

function pythonEligibleOf(content: string): number {
  return content.split("\n\n").filter((paragraph) => paragraph.trim().length > 20).length
}

function regexEligibleOf(content: string): number {
  return content.split(/\n\s*\n/).filter((paragraph) => paragraph.trim().length > 20).length
}

function writeFileAt(relativePath: string, content: string): string {
  const absolute = join(project, relativePath)
  if (relativePath.includes("/")) mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, "utf-8")
  return absolute
}

function writeMain(content: string): string {
  const mainPath = join(project, "main.tex")
  writeFileSync(mainPath, content, "utf-8")
  return mainPath
}

function writeControl(name: string, value: string): void {
  writeFileSync(join(controlDir, name), value, "utf-8")
}

function configureProbe(mode: "ok" | "fail" | "invalid-output" | "sleep" | "signal"): void {
  writeControl("probe.mode", mode)
}

function configureAnalysis(
  options: {
    basename?: string
    stdout?: string
    exit?: number
    mode?: "normal" | "sleep" | "signal"
    sleepSeconds?: number
  } = {},
): void {
  const prefix = options.basename ? `analysis.${options.basename}` : "analysis"
  if (options.stdout !== undefined) writeControl(`${prefix}.stdout`, options.stdout)
  if (options.exit !== undefined) writeControl(`${prefix}.exit`, String(options.exit))
  if (options.mode !== undefined) writeControl(`${prefix}.mode`, options.mode)
  if (options.sleepSeconds !== undefined) writeControl(`${prefix}.sleepSeconds`, String(options.sleepSeconds))
}

function okJson(total: number, risk: number, analyzed?: number): string {
  return JSON.stringify({
    ok: true,
    risk,
    paragraphs_total: total,
    paragraphs_analyzed: analyzed ?? Math.min(total, 50),
  })
}

function stubInvocations(): string[] {
  if (!existsSync(markerPath)) return []
  return readFileSync(markerPath, "utf-8").split("\n").filter((line) => line.trim().length > 0)
}

function probeInvocations(): number {
  return stubInvocations().filter((line) => line === "probe").length
}

function analysisInvocations(): number {
  return stubInvocations().filter((line) => line.startsWith("analysis ")).length
}

// ---------------------------------------------------------------------------
// Report parsing helpers (contract §8 markers only — no implementation details)
// ---------------------------------------------------------------------------
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function headerField(report: string, name: string): string | null {
  const match = report.match(new RegExp(`^\\*\\*${escapeRegExp(name)}:\\*\\* (.*)$`, "m"))
  return match ? match[1].trim() : null
}

function bulletField(report: string, name: string): string | null {
  const match = report.match(new RegExp(`^- ${escapeRegExp(name)}: (.*)$`, "m"))
  return match ? match[1].trim() : null
}

function summaryNumber(report: string, name: string): number {
  const value = bulletField(report, name)
  expect(value).not.toBeNull()
  return Number.parseInt(String(value), 10)
}

function stripCode(value: string | undefined | null): string {
  return (value ?? "").replace(/`/g, "").trim()
}

/** Per-file blocks of "## Resultados por arquivo", keyed by project-relative path. */
function fileBlocks(report: string): Map<string, Record<string, string>> {
  const blocks = new Map<string, Record<string, string>>()
  let current: Record<string, string> | null = null
  for (const line of report.split("\n")) {
    const header = line.match(/^### `([^`]+)`$/)
    if (header) {
      current = {}
      blocks.set(header[1], current)
      continue
    }
    if (line.startsWith("## ")) {
      current = null
      continue
    }
    const field = line.match(/^- ([^:]+): (.*)$/)
    if (current && field) current[field[1]] = field[2].trim()
  }
  return blocks
}

function reasonCodeOf(block: Record<string, string> | undefined): string | null {
  const raw = block?.["Motivo"] ?? ""
  const match = raw.match(/`([^`]+)`/)
  return match ? match[1] : null
}

function expectFileCoverage(
  report: string,
  file: string,
  expected: {
    method: "python" | "regex" | "none"
    reason?: string
    eligible?: number
    analyzed?: number
    omitted?: number
    truncated?: boolean
  },
): Record<string, string> | undefined {
  const block = fileBlocks(report).get(file)
  expect(block).toBeDefined()
  if (!block) return undefined
  expect(stripCode(block["Método efetivo"])).toBe(expected.method)
  if (expected.reason !== undefined) expect(reasonCodeOf(block)).toBe(expected.reason)
  if (expected.eligible !== undefined) {
    expect(Number.parseInt(block["Elegíveis (método)"] ?? "", 10)).toBe(expected.eligible)
  }
  if (expected.analyzed !== undefined) {
    expect(Number.parseInt(block["Analisados"] ?? "", 10)).toBe(expected.analyzed)
  }
  if (expected.omitted !== undefined) {
    expect(Number.parseInt(block["Omitidos"] ?? "", 10)).toBe(expected.omitted)
  }
  if (expected.truncated !== undefined) {
    expect(block["Truncamento"]).toBe(expected.truncated ? "sim" : "não")
  }
  return block
}

function expectCoverageRow(report: string, file: string, method: string, reason: string): void {
  const pattern = new RegExp(
    "\\|\\s*`" +
      escapeRegExp(file) +
      "`\\s*\\|\\s*`" +
      escapeRegExp(method) +
      "`\\s*\\|\\s*`" +
      escapeRegExp(reason) +
      "`\\s*\\|",
  )
  expect(report).toMatch(pattern)
}

function aggregateLine(report: string, prefix: string): string | undefined {
  return report.split("\n").find((line) => line.startsWith(prefix))
}

function expectCoreReportMarkers(report: string): void {
  expect(report.startsWith("# IA Detection Report")).toBe(true)
  expect(report).toContain("**Método global efetivo:**")
  expect(report).toContain("**Estado:**")
  expect(report).toContain("**Sonda Python:**")
  expect(report).toContain("**Gerado em:**")
  expect(report).toContain("## Resumo de cobertura")
  expect(report).toContain("## Cobertura por arquivo")
  expect(report).toContain("## Resultados por arquivo")
  expect(report).toContain("## Agregados heurísticos por método")
  expect(report).toContain("## Limitações metodológicas")
  expect(report).toContain("**Escopo:** sinais heurísticos locais")
  expect(report).toContain("não comprova autoria")
  expect(report).toContain("não substitui a auditoria integral do manuscrito")
}

/** Common shape for a per-file regex fallback caused by a Python failure. */
function expectRegexFallbackReport(
  report: string,
  reason: string,
  expectedEligible: number,
  probeLine = "disponível",
): Record<string, string> | undefined {
  expect(headerField(report, "Método global efetivo")).toBe("Regex heuristic")
  expect(headerField(report, "Estado")).toBe("analise-concluida")
  expect(headerField(report, "Sonda Python")).toBe(probeLine)
  const block = expectFileCoverage(report, "main.tex", {
    method: "regex",
    reason,
    eligible: expectedEligible,
    analyzed: expectedEligible,
    omitted: 0,
    truncated: false,
  })
  expect(reasonCodeOf(block)).toBe(reason)
  expect(block?.["Fallback"]).toContain(`(${reason})`)
  // A failed Python result must never be promoted to a Python score.
  expect(block?.["Indicador heurístico"]).not.toContain("score=")
  expect(report).not.toContain("Risco final")
  expect(report).not.toContain("**Confiança:**")
  return block
}

async function runBancaIa(
  args: { forceRegex?: boolean } = {},
): Promise<string> {
  const mod: any = await importBancaIa()
  expect(typeof mod?.bancaIa?.execute).toBe("function")
  const result = await mod.bancaIa.execute(
    { projectRoot: project, forceRegex: args.forceRegex },
    { directory: project } as any,
  )
  expect(typeof result).toBe("string")
  return String(result)
}

// ===========================================================================
// §9.1 + §9.2 + §9.18 + §9.22 — report surface and forceRegex
// ===========================================================================
describe("banca_ia — relatório heurístico e forceRegex", () => {
  test("1. texto humano com conectivos legítimos produz disclaimers, não conclusão de autoria", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))

    const report = await runBancaIa({ forceRegex: true })
    expectCoreReportMarkers(report)
    expect(headerField(report, "Método global efetivo")).toBe("Regex heuristic")
    expect(headerField(report, "Estado")).toBe("analise-concluida")
    expect(headerField(report, "Sonda Python")).toBe("não executada (forceRegex)")

    // Explicit non-conclusions required by the contract (§8 limitações).
    expect(report).toContain("sinais heurísticos")
    expect(report).toContain("não provas de autoria")
    expect(report).toContain("não constitui nota acadêmica, parecer conclusivo ou recomendação de penalidade")
    expect(report).toContain("não calibrad")
    expect(report).toContain('conectivos como "ademais", "outrossim", "não obstante", "ou seja" e "vale ressaltar"')
    expect(report).toContain("não substitui a auditoria integral do manuscrito")

    // Legacy conclusion markers must be gone.
    expect(report).not.toContain("Risco final:")
    expect(report).not.toContain("**Confiança:**")
    expect(report).not.toContain("confidence=")
    expect(report).not.toContain("terminal")
    expect(report.toLowerCase()).not.toContain("risco baixo")

    const block = expectFileCoverage(report, "main.tex", {
      method: "regex",
      reason: "force-regex",
      eligible: 2,
      analyzed: 2,
      omitted: 0,
      truncated: false,
    })
    expect(block?.["Indicador heurístico"]).toMatch(/risk=(low|moderate|high) patterns=\d+/)
  })

  test("2. forceRegex não inicia sonda nem análise Python (nenhum subprocesso)", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))

    const report = await runBancaIa({ forceRegex: true })
    expect(headerField(report, "Método global efetivo")).toBe("Regex heuristic")
    expect(headerField(report, "Sonda Python")).toBe("não executada (forceRegex)")

    const block = expectFileCoverage(report, "main.tex", { method: "regex", reason: "force-regex" })
    expect(block?.["Fallback"]).toBe("não aplicável (forceRegex solicitado explicitamente)")
    expectCoverageRow(report, "main.tex", "regex", "force-regex")

    // Marker file is the proof that no python3 probe/analysis was spawned.
    expect(existsSync(markerPath)).toBe(false)
    expect(stubInvocations()).toEqual([])
  })

  test("18. relatório retornado é idêntico ao persistido em .banca/reports/ia-*.md", async () => {
    writeProjectJson()
    writeMain(paragraphs(3))

    const result = await runBancaIa({ forceRegex: true })
    const reportsDir = join(project, ".banca", "reports")
    expect(existsSync(reportsDir)).toBe(true)
    const mdFiles = readdirSync(reportsDir).filter((file) => file.startsWith("ia-") && file.endsWith(".md"))
    expect(mdFiles).toHaveLength(1)

    const persisted = readFileSync(join(reportsDir, mdFiles[0]), "utf-8")
    expect(persisted).toBe(result)
    for (const marker of [
      "**Método global efetivo:**",
      "## Resumo de cobertura",
      "## Resultados por arquivo",
      "## Limitações metodológicas",
    ]) {
      expect(result).toContain(marker)
      expect(persisted).toContain(marker)
    }
  })

  test("22. relatório usa caminhos relativos e não expõe caminho absoluto do tmp", async () => {
    writeProjectJson()
    const content = paragraphs(3)
    writeMain(content)
    configureAnalysis({ stdout: okJson(pythonEligibleOf(content), 0.3) })

    const report = await runBancaIa()
    expectCoreReportMarkers(report)
    expect(report).toContain("main.tex")
    expect(report).toContain("`main.tex`")
    expect(report).not.toContain(project)
    expect(report).not.toContain(base)
    expect(report).not.toContain(stubDir)
    expect(report).not.toContain(tmpdir())
  })
})

// ===========================================================================
// §9.4 + §9.5 + §9.6 — valid Python path and the 50-paragraph limit
// ===========================================================================
describe("banca_ia — caminho Python válido e limite de 50 parágrafos", () => {
  test("4. Python válido com menos de 50 elegíveis: 3/3/0 e agregado Python", async () => {
    writeProjectJson()
    const content = paragraphs(3)
    writeMain(content)
    configureAnalysis({ stdout: okJson(3, 0.3) })

    const report = await runBancaIa()
    expectCoreReportMarkers(report)
    expect(headerField(report, "Método global efetivo")).toBe("Python (pt_ai_detector)")
    expect(headerField(report, "Estado")).toBe("analise-concluida")
    expect(headerField(report, "Sonda Python")).toBe("disponível")

    const block = expectFileCoverage(report, "main.tex", {
      method: "python",
      reason: "python-ok",
      eligible: 3,
      analyzed: 3,
      omitted: 0,
      truncated: false,
    })
    expect(block?.["Contagem de elegíveis por segmentação"]).toBe("Python=3; Regex=3")
    expect(block?.["Indicador heurístico"]).toContain("score=0.3")
    expect(block?.["Indicador heurístico"]).toContain("não calibrad")
    expect(block?.["Fallback"]).toBe("não aplicável (execução Python válida)")
    expectCoverageRow(report, "main.tex", "python", "python-ok")

    expect(summaryNumber(report, "Arquivos descobertos")).toBe(1)
    expect(summaryNumber(report, "Arquivos configurados ausentes ou inválidos")).toBe(0)
    expect(summaryNumber(report, "Arquivos efetivamente analisados")).toBe(1)
    expect(summaryNumber(report, "Arquivos não analisados")).toBe(0)
    expect(summaryNumber(report, "Parágrafos elegíveis (segmentação Python)")).toBe(3)
    expect(summaryNumber(report, "Parágrafos analisados por Python")).toBe(3)
    expect(summaryNumber(report, "Parágrafos omitidos por limite Python (50/arquivo)")).toBe(0)
    expect(bulletField(report, "Truncamento")).toBe("não")

    const pythonAggregate = aggregateLine(report, "- Python (score heurístico não calibrado):")
    expect(pythonAggregate).toBeDefined()
    expect(pythonAggregate).not.toContain("não aplicável")
    expect(
      aggregateLine(report, "- Regex heuristic (indicador binário heurístico não calibrado):"),
    ).toContain("não aplicável (nenhum arquivo analisado por regex)")
    expect(report).toContain("Média combinada Python+regex: não calculada")

    expect(probeInvocations()).toBe(1)
    expect(analysisInvocations()).toBe(1)
  })

  test("5. exatamente 50 elegíveis: 50/50/0 e sem truncamento", async () => {
    writeProjectJson()
    const content = paragraphs(50)
    writeMain(content)
    configureAnalysis({ stdout: okJson(50, 0.45) })

    const report = await runBancaIa()
    expect(headerField(report, "Método global efetivo")).toBe("Python (pt_ai_detector)")

    const block = expectFileCoverage(report, "main.tex", {
      method: "python",
      reason: "python-ok",
      eligible: 50,
      analyzed: 50,
      omitted: 0,
      truncated: false,
    })
    expect(block?.["Contagem de elegíveis por segmentação"]).toBe("Python=50; Regex=50")
    expect(summaryNumber(report, "Parágrafos elegíveis (segmentação Python)")).toBe(50)
    expect(summaryNumber(report, "Parágrafos analisados por Python")).toBe(50)
    expect(summaryNumber(report, "Parágrafos omitidos por limite Python (50/arquivo)")).toBe(0)
    expect(bulletField(report, "Truncamento")).toBe("não")
    expect(analysisInvocations()).toBe(1)
  })

  test("6. mais de 50 elegíveis (55): 50 analisados, 5 omitidos e truncamento explícito", async () => {
    writeProjectJson()
    const content = paragraphs(55)
    writeMain(content)
    configureAnalysis({ stdout: okJson(55, 0.1) })

    const report = await runBancaIa()
    expect(headerField(report, "Método global efetivo")).toBe("Python (pt_ai_detector)")

    const block = expectFileCoverage(report, "main.tex", {
      method: "python",
      reason: "python-ok",
      eligible: 55,
      analyzed: 50,
      omitted: 5,
      truncated: true,
    })
    expect(block?.["Truncamento"]).toBe("sim")
    expect(block?.["Contagem de elegíveis por segmentação"]).toBe("Python=55; Regex=55")

    const truncation = bulletField(report, "Truncamento")
    expect(truncation).not.toBeNull()
    expect(String(truncation).startsWith("sim")).toBe(true)
    expect(String(truncation)).toContain("1 arquivo(s)")
    expect(String(truncation)).toContain("5 parágrafo(s) omitido(s) por limite")
    expect(summaryNumber(report, "Parágrafos elegíveis (segmentação Python)")).toBe(55)
    expect(summaryNumber(report, "Parágrafos analisados por Python")).toBe(50)
    expect(summaryNumber(report, "Parágrafos omitidos por limite Python (50/arquivo)")).toBe(5)
  })
})

// ===========================================================================
// §9.3 + §9.7 — probe availability and absence of evidence
// ===========================================================================
describe("banca_ia — sonda Python e ausência de evidência", () => {
  test("3. Python indisponível na sonda: regex/python-unavailable com 1 sonda e 0 análises", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureProbe("fail")

    const report = await runBancaIa()
    expectRegexFallbackReport(
      report,
      "python-unavailable",
      2,
      "indisponível (diagnóstico: probe-exit-code)",
    )
    expect(headerField(report, "Sonda Python")).toBe("indisponível (diagnóstico: probe-exit-code)")

    const block = expectFileCoverage(report, "main.tex", { method: "regex", reason: "python-unavailable" })
    expect(block?.["Fallback"]).toBe(
      "regex aplicada porque Python está indisponível (python-unavailable)",
    )

    expect(probeInvocations()).toBe(1)
    expect(analysisInvocations()).toBe(0)
  })

  test("sonda com python3 ausente do PATH: diagnóstico python-missing", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    const emptyBinDir = join(base, "empty-bin")
    mkdirSync(emptyBinDir)
    process.env.PATH = emptyBinDir

    const report = await runBancaIa()
    expect(headerField(report, "Sonda Python")).toBe("indisponível (diagnóstico: python-missing)")
    expect(headerField(report, "Método global efetivo")).toBe("Regex heuristic")
    expectFileCoverage(report, "main.tex", { method: "regex", reason: "python-unavailable" })
    expect(analysisInvocations()).toBe(0)
  })

  test("7. zero parágrafos elegíveis: ausência de evidência, não classificação de risco baixo", async () => {
    writeProjectJson()
    writeMain("Curto.\n\nTambém curto.\n\nPequeno.")

    const report = await runBancaIa()
    expectCoreReportMarkers(report)
    expect(headerField(report, "Estado")).toBe("ausencia-de-evidencia")
    expect(headerField(report, "Método global efetivo")).toBe("Nenhum (nada analisado)")

    const block = expectFileCoverage(report, "main.tex", {
      method: "none",
      reason: "no-eligible-content",
      eligible: 0,
      analyzed: 0,
      omitted: 0,
      truncated: false,
    })
    expect(block?.["Indicador heurístico"]).toBe("não produzido (nenhum parágrafo analisado)")
    expect(report).toContain(
      "Ausência de evidência: nenhum parágrafo elegível foi analisado",
    )
    expect(report).not.toContain("risk=low")
    expect(report).not.toContain("Risco final")
    expect(report).not.toContain("**Confiança:**")
    expect(summaryNumber(report, "Arquivos efetivamente analisados")).toBe(0)
    expect(summaryNumber(report, "Arquivos não analisados")).toBe(1)

    // §6: zero Python-eligible paragraphs must not invoke the analysis script.
    expect(probeInvocations()).toBe(1)
    expect(analysisInvocations()).toBe(0)
  })
})

// ===========================================================================
// §9.9 – §9.16 — Python failure modes fall back to regex with a reason code
// ===========================================================================
describe("banca_ia — falhas do caminho Python e fallback regex", () => {
  test("9. timeout na análise Python: python-timeout com diagnóstico sanitizado", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({ mode: "sleep", sleepSeconds: 5 })

    const mod = await importBancaIa()
    const internals = requireInternals(mod)
    internals.analysisTimeoutMs = 300

    const result = await mod.bancaIa.execute({ projectRoot: project }, { directory: project } as any)
    const report = String(result)
    expectCoreReportMarkers(report)

    const block = expectFileCoverage(report, "main.tex", {
      method: "regex",
      reason: "python-timeout",
      eligible: 2,
      analyzed: 2,
      omitted: 0,
      truncated: false,
    })
    expect(block?.["Fallback"]).toBe(
      "regex aplicada após falha do caminho Python (python-timeout); diagnóstico sanitizado, sem stderr",
    )
    expect(report).toContain("Sonda Python:** disponível")
    expect(report).not.toContain(STUB_STDERR_SECRET)
    expect(report).not.toContain("Traceback")
    expect(report).not.toContain(project)
    expect(probeInvocations()).toBe(1)
    expect(analysisInvocations()).toBe(1)
  })

  test("10. análise Python encerrada por sinal: python-signal + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({ mode: "signal" })

    const report = await runBancaIa()
    expectRegexFallbackReport(report, "python-signal", 2)
    expect(report).not.toContain(STUB_STDERR_SECRET)
  })

  test("11. exit code diferente de zero sem JSON: python-exit-code + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({ exit: 1 })

    const report = await runBancaIa()
    const block = expectRegexFallbackReport(report, "python-exit-code", 2)
    expect(block?.["Fallback"]).toContain("diagnóstico sanitizado, sem stderr")
    expect(report).not.toContain(STUB_STDERR_SECRET)
  })

  test("12. JSON inválido com exit 0: python-invalid-json, nenhum score promovido", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({ stdout: "{ isto não é json", exit: 0 })

    const report = await runBancaIa()
    const block = expectRegexFallbackReport(report, "python-invalid-json", 2)
    expect(block?.["Indicador heurístico"]).not.toContain("score=0")
    expect(block?.["Indicador heurístico"]).not.toContain("score=")
  })

  test("13. erro explícito do detector: python-detector-error + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({
      stdout: JSON.stringify({
        ok: false,
        error_code: "detector_error",
        error_stage: "paragraph-analysis",
        error_class: "ValueError",
      }),
      exit: 1,
    })

    const report = await runBancaIa()
    expectRegexFallbackReport(report, "python-detector-error", 2)
    expect(report).not.toContain("ValueError")
  })

  test("14. schema incompleto (sem paragraphs_total): python-schema-invalid + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({
      stdout: JSON.stringify({ ok: true, risk: 0.2, paragraphs_analyzed: 2 }),
      exit: 0,
    })

    const report = await runBancaIa()
    expectRegexFallbackReport(report, "python-schema-invalid", 2)
  })

  test("15a. score Python não finito (1e400 → Infinity): python-invalid-score + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({
      stdout: '{"ok":true,"risk":1e400,"paragraphs_total":2,"paragraphs_analyzed":2}',
      exit: 0,
    })

    const report = await runBancaIa()
    const block = expectRegexFallbackReport(report, "python-invalid-score", 2)
    expect(block?.["Indicador heurístico"]).not.toContain("score=")
  })

  test("15b. score Python fora de [0,1] (risk=1.5): python-invalid-score + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({
      stdout: JSON.stringify({ ok: true, risk: 1.5, paragraphs_total: 2, paragraphs_analyzed: 2 }),
      exit: 0,
    })

    const report = await runBancaIa()
    const block = expectRegexFallbackReport(report, "python-invalid-score", 2)
    expect(block?.["Indicador heurístico"]).not.toContain("score=")
  })

  test("16a. paragraphs_total incoerente com os elegíveis: python-inconsistent-counts + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(3))
    configureAnalysis({
      stdout: JSON.stringify({ ok: true, risk: 0.2, paragraphs_total: 4, paragraphs_analyzed: 3 }),
      exit: 0,
    })

    const report = await runBancaIa()
    expectRegexFallbackReport(report, "python-inconsistent-counts", 3)
  })

  test("16b. paragraphs_analyzed acima do limite/total: python-inconsistent-counts + fallback", async () => {
    writeProjectJson()
    writeMain(paragraphs(2))
    configureAnalysis({
      stdout: JSON.stringify({ ok: true, risk: 0.2, paragraphs_total: 2, paragraphs_analyzed: 3 }),
      exit: 0,
    })

    const report = await runBancaIa()
    expectRegexFallbackReport(report, "python-inconsistent-counts", 2)
  })
})

// ===========================================================================
// §9.8 + §9.17 — mixed methods and absent manuscript
// ===========================================================================
describe("banca_ia — métodos mistos e manuscrito ausente", () => {
  test("8. métodos mistos: python em ok.tex e regex em falha.tex, agregados separados", async () => {
    writeProjectJson({ main: "ok.tex", chapters: ["falha.tex"] })
    const okContent = paragraphs(3)
    const failContent = paragraphs(2)
    writeFileAt("ok.tex", okContent)
    writeFileAt("falha.tex", failContent)
    configureAnalysis({ basename: "ok.tex", stdout: okJson(3, 0.6) })
    configureAnalysis({ basename: "falha.tex", exit: 1 })

    const report = await runBancaIa()
    expectCoreReportMarkers(report)
    expect(headerField(report, "Método global efetivo")).toBe(
      "Métodos mistos (Python + Regex heuristic)",
    )
    expect(headerField(report, "Estado")).toBe("analise-concluida")

    const okBlock = expectFileCoverage(report, "ok.tex", {
      method: "python",
      reason: "python-ok",
      eligible: 3,
      analyzed: 3,
      omitted: 0,
      truncated: false,
    })
    expect(okBlock?.["Indicador heurístico"]).toContain("score=0.6")
    expectCoverageRow(report, "ok.tex", "python", "python-ok")

    const failBlock = expectFileCoverage(report, "falha.tex", {
      method: "regex",
      reason: "python-exit-code",
      eligible: 2,
      analyzed: 2,
      omitted: 0,
      truncated: false,
    })
    expect(failBlock?.["Fallback"]).toContain("(python-exit-code)")
    expectCoverageRow(report, "falha.tex", "regex", "python-exit-code")

    // Aggregates stay separated per method; no combined average is produced.
    const pythonAggregate = aggregateLine(report, "- Python (score heurístico não calibrado):")
    expect(pythonAggregate).toBeDefined()
    expect(pythonAggregate).not.toContain("não aplicável")
    const regexAggregate = aggregateLine(
      report,
      "- Regex heuristic (indicador binário heurístico não calibrado):",
    )
    expect(regexAggregate).toBeDefined()
    expect(regexAggregate).toMatch(
      /:\s*\d+ de 1 arquivo\(s\) com indicador acionado \(matches>10\)/,
    )
    expect(report).toContain("Média combinada Python+regex: não calculada")

    expect(probeInvocations()).toBe(1)
    expect(analysisInvocations()).toBe(2)
  })

  test("17. manuscrito ausente: ausencia-de-manuscrito, sem classificação e sem relatório persistido", async () => {
    writeProjectJson()

    const report = await runBancaIa()
    expect(report.startsWith("# IA Detection Report")).toBe(true)
    expect(headerField(report, "Estado")).toBe("ausencia-de-manuscrito")
    expect(headerField(report, "Método global efetivo")).toBe("Nenhum (nada analisado)")
    expect(headerField(report, "Arquivos configurados ausentes ou inválidos")).toBe("1")
    expect(report).toContain("Nenhum arquivo de manuscrito foi encontrado para análise")
    expect(report).toContain("Nenhum relatório foi persistido porque não houve análise")
    expect(report).toContain("não constitui evidência de risco baixo")
    expect(report).not.toContain("Risco final")
    expect(report).not.toContain("**Confiança:**")
    expect(report).not.toContain("risk=")
    expect(report).not.toContain("## Resultados por arquivo")
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })
})

// ===========================================================================
// §9.19 + §9.20 + §9.21 — integrity, confinement and unreadable/invalid files
// ===========================================================================
describe("banca_ia — integridade, confinamento e arquivos inválidos", () => {
  test("19. arquivo original permanece inalterado após a análise", async () => {
    writeProjectJson()
    const content = paragraphs(2)
    const mainPath = writeMain(content)
    const before = readFileSync(mainPath, "utf-8")
    const sizeBefore = lstatSync(mainPath).size

    const report = await runBancaIa({ forceRegex: true })
    expect(report).toContain("# IA Detection Report")
    expect(readFileSync(mainPath, "utf-8")).toBe(before)
    expect(lstatSync(mainPath).size).toBe(sizeBefore)
  })

  symlinkTest("20. symlink externo para main.tex é rejeitado antes da leitura", async () => {
    writeProjectJson()
    const external = join(base, "external")
    mkdirSync(external)
    const secretContent =
      "Ademais, é imperativo que o segredo externo permaneça confidencial sobremaneira."
    writeFileSync(join(external, "outside_main.tex"), secretContent, "utf-8")
    symlinkSync(join(external, "outside_main.tex"), join(project, "main.tex"), "file")

    const mod: any = await importBancaIa()
    const { PathTraversalError } = await import("../src/lib/safe_paths")

    let error: unknown = null
    try {
      await mod.bancaIa.execute(
        { projectRoot: project, forceRegex: true },
        { directory: project } as any,
      )
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(PathTraversalError)
    const message = String((error as Error)?.message ?? "")
    expect(message).not.toContain(external)
    expect(message).not.toContain(secretContent)
    expect(message).not.toContain(base)
    expect(readFileSync(join(external, "outside_main.tex"), "utf-8")).toBe(secretContent)
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  test("21a. arquivo configurado que não é arquivo regular conta como ausente/inválido (§3)", async () => {
    writeProjectJson()
    mkdirSync(join(project, "main.tex"))

    const report = await runBancaIa({ forceRegex: true })
    expect(headerField(report, "Estado")).toBe("ausencia-de-manuscrito")
    expect(headerField(report, "Arquivos configurados ausentes ou inválidos")).toBe("1")
    expect(report).not.toContain("Risco final")
    expect(existsSync(join(project, ".banca", "reports"))).toBe(false)
  })

  unreadableFileTest(
    "21b. arquivo ilegível após a descoberta: método none / file-unreadable, sem classificação",
    async () => {
      writeProjectJson({ chapters: ["capitulos/legivel.tex"] })
      const unreadablePath = join(project, "main.tex")
      writeFileSync(unreadablePath, paragraphs(1), "utf-8")
      chmodSync(unreadablePath, 0o000)
      mkdirSync(join(project, "capitulos"), { recursive: true })
      writeFileSync(join(project, "capitulos", "legivel.tex"), paragraphs(2), "utf-8")

      try {
        const report = await runBancaIa({ forceRegex: true })
        const block = expectFileCoverage(report, "main.tex", {
          method: "none",
          reason: "file-unreadable",
          eligible: 0,
          analyzed: 0,
          omitted: 0,
          truncated: false,
        })
        expect(block?.["Indicador heurístico"]).toBe(
          "não produzido (nenhum parágrafo analisado)",
        )
        expect(report).not.toContain("Risco final")
        expect(report).not.toContain("**Confiança:**")

        // §8: an unreadable file must not stop the analysis of the other files.
        expectFileCoverage(report, "capitulos/legivel.tex", {
          method: "regex",
          reason: "force-regex",
          eligible: 2,
        })
        expect(headerField(report, "Método global efetivo")).toBe("Regex heuristic")
      } finally {
        chmodSync(unreadablePath, 0o644)
      }
    },
  )
})
