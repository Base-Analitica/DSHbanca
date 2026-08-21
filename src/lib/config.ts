import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export interface ProjectConfig {
  version: number
  manuscript: {
    format: "latex" | "markdown" | "docx"
    root: string
    main: string
    bib: string
    chapters: string[]
    outputDir: string
  }
  compile: {
    enabled: boolean
    command: string[]
  }
  allowedPaths: string[]
  protectedPaths: string[]
  immutableFacts: string[]
  externalDependencies: string[]
  rubricProfile: string
  targetScore: number
  providers: {
    references: {
      primary: string
      fallbacks: string[]
      timeoutMs: number
    }
  }
  mcp: {
    crossrefAcademicEnabled: boolean
  }
  analysis?: {
    coverageMode: "exhaustive"
    /** Limite de uma unidade de execução; o manuscrito completo pode gerar vários lotes. */
    maxCharactersPerBatch: number
  }
}

const DEFAULTS: ProjectConfig = {
  version: 1,
  manuscript: { format: "latex", root: ".", main: "main.tex", bib: "referencias.bib", chapters: ["capitulos/*.tex"], outputDir: "trabalhos" },
  compile: { enabled: true, command: ["lualatex", "bibtex", "lualatex", "lualatex"] },
  allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
  protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
  immutableFacts: [],
  externalDependencies: [],
  rubricProfile: "banca-rigorosa",
  targetScore: 9.0,
  providers: { references: { primary: "mcp:crossref-academic", fallbacks: ["rest:crossref", "cache"], timeoutMs: 20000 } },
  mcp: { crossrefAcademicEnabled: false },
  analysis: { coverageMode: "exhaustive", maxCharactersPerBatch: 50_000 },
} as Required<ProjectConfig>

export function getProjectDir(projectRoot: string): string {
  return join(projectRoot, ".banca")
}

export function configPath(projectRoot: string): string {
  return join(getProjectDir(projectRoot), "project.json")
}

function migrate(raw: any): any {
  if (raw.version === undefined || raw.version < 1) {
    if (raw.mcp?.referenceValidation) {
      raw.providers ??= {}
      raw.providers.references ??= {}
      raw.providers.references.primary ??= "mcp:crossref-academic"
      raw.providers.references.fallbacks ??= ["rest:crossref", "cache"]
      raw.providers.references.timeoutMs ??= 20000
    }
    raw.mcp ??= {}
    raw.mcp.crossrefAcademicEnabled ??= false
    raw.version = 1
  }
  return raw
}

function sanitizeAnalysis(rawAnalysis: any, defaults: Required<ProjectConfig>["analysis"]): Required<ProjectConfig>["analysis"] {
  if (typeof rawAnalysis !== "object" || rawAnalysis === null || Array.isArray(rawAnalysis)) return { ...defaults }
  const limit = rawAnalysis.maxCharactersPerBatch !== undefined
    ? rawAnalysis.maxCharactersPerBatch
    : rawAnalysis.budgetCharacters
  return {
    coverageMode: "exhaustive",
    maxCharactersPerBatch: typeof limit === "number" && Number.isFinite(limit) && Number.isInteger(limit) && limit > 0
      ? limit
      : defaults.maxCharactersPerBatch,
  }
}

export function loadConfig(projectRoot: string): Required<ProjectConfig> {
  const path = configPath(projectRoot)
  const defs = DEFAULTS as Required<ProjectConfig>
  if (!existsSync(path)) return { ...defs, manuscript: { ...defs.manuscript }, compile: { ...defs.compile }, allowedPaths: [...defs.allowedPaths], protectedPaths: [...defs.protectedPaths], immutableFacts: [...defs.immutableFacts], externalDependencies: [...defs.externalDependencies], providers: { references: { ...defs.providers.references } }, mcp: { ...defs.mcp }, analysis: { ...defs.analysis } }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"))
    const migrated = migrate(raw)
    return sanitizeConfig(migrated)
  } catch {
    return { ...defs, manuscript: { ...defs.manuscript }, compile: { ...defs.compile }, allowedPaths: [...defs.allowedPaths], protectedPaths: [...defs.protectedPaths], immutableFacts: [...defs.immutableFacts], externalDependencies: [...defs.externalDependencies], providers: { references: { ...defs.providers.references } }, mcp: { ...defs.mcp }, analysis: { ...defs.analysis } }
  }
}

function sanitizeConfig(raw: any): Required<ProjectConfig> {
  const defs = DEFAULTS as Required<ProjectConfig>
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    manuscript: raw.manuscript ? {
      format: ["latex", "markdown", "docx"].includes(raw.manuscript.format) ? raw.manuscript.format : "latex",
      root: raw.manuscript.root || ".",
      main: raw.manuscript.main || "main.tex",
      bib: raw.manuscript.bib || "referencias.bib",
      chapters: Array.isArray(raw.manuscript.chapters) ? raw.manuscript.chapters : ["capitulos/*.tex"],
      outputDir: raw.manuscript.outputDir || "trabalhos",
    } : { ...defs.manuscript },
    compile: raw.compile ? {
      enabled: raw.compile.enabled !== false,
      command: Array.isArray(raw.compile.command) ? raw.compile.command : ["lualatex", "bibtex", "lualatex", "lualatex"],
    } : { ...defs.compile },
    allowedPaths: Array.isArray(raw.allowedPaths) ? raw.allowedPaths : ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: Array.isArray(raw.protectedPaths) ? raw.protectedPaths : ["dados/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: Array.isArray(raw.immutableFacts) ? raw.immutableFacts : [],
    externalDependencies: Array.isArray(raw.externalDependencies) ? raw.externalDependencies : [],
    rubricProfile: raw.rubricProfile || "banca-rigorosa",
    targetScore: typeof raw.targetScore === "number" ? Math.min(Math.max(raw.targetScore, 0), 10) : 9.0,
    providers: raw.providers?.references ? {
      references: {
        primary: raw.providers.references.primary || "mcp:crossref-academic",
        fallbacks: Array.isArray(raw.providers.references.fallbacks) ? raw.providers.references.fallbacks : ["rest:crossref", "cache"],
        timeoutMs: typeof raw.providers.references.timeoutMs === "number" ? raw.providers.references.timeoutMs : 20000,
      },
    } : { references: { ...defs.providers.references } },
    mcp: raw.mcp ? {
      crossrefAcademicEnabled: raw.mcp.crossrefAcademicEnabled === true,
    } : { ...defs.mcp },
    analysis: sanitizeAnalysis(raw.analysis, defs.analysis),
  }
}

export function validateConfig(projectRoot: string): { valid: boolean; errors: string[] } {
  const path = configPath(projectRoot)
  if (!existsSync(path)) return { valid: false, errors: ["config not found"] }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"))
    const errs: string[] = []
    if (typeof raw.version !== "number" || raw.version < 1) errs.push("version must be >= 1")
    if (raw.manuscript?.format && !["latex", "markdown", "docx"].includes(raw.manuscript.format)) errs.push("manuscript.format must be latex|markdown|docx")
    if (raw.targetScore !== undefined && (typeof raw.targetScore !== "number" || raw.targetScore < 0 || raw.targetScore > 10)) errs.push("targetScore must be 0-10")
    if (raw.analysis !== undefined) {
      if (typeof raw.analysis !== "object" || raw.analysis === null || Array.isArray(raw.analysis)) {
        errs.push("analysis must be an object")
      } else {
        if (raw.analysis.coverageMode !== undefined && raw.analysis.coverageMode !== "exhaustive") {
          errs.push('analysis.coverageMode must be "exhaustive"')
        }
        if (raw.analysis.maxCharactersPerBatch !== undefined && raw.analysis.budgetCharacters !== undefined) {
          errs.push("analysis must not define both maxCharactersPerBatch and budgetCharacters")
        }
        const limit = raw.analysis.maxCharactersPerBatch !== undefined
          ? raw.analysis.maxCharactersPerBatch
          : raw.analysis.budgetCharacters
        if (limit !== undefined && (typeof limit !== "number" || !Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0)) {
          errs.push("analysis.maxCharactersPerBatch must be a finite integer > 0")
        }
      }
    }
    return { valid: errs.length === 0, errors: errs }
  } catch (err: any) {
    return { valid: false, errors: [err.message] }
  }
}

export function saveConfig(projectRoot: string, config: Required<ProjectConfig> | ProjectConfig): void {
  const defaults = DEFAULTS as Required<ProjectConfig>
  writeFileSync(configPath(projectRoot), JSON.stringify({ ...config, analysis: sanitizeAnalysis(config.analysis, defaults.analysis) }, null, 2), "utf-8")
}

export function ensureBancaDir(projectRoot: string): void {
  const d = getProjectDir(projectRoot)
  for (const sub of ["", "reports", "context", "snapshots", "cache"]) {
    const p = join(d, sub)
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  }
}

export function getMcpCommand(projectRoot: string): string[] | null {
  const config = loadConfig(projectRoot)
  if (!config.mcp.crossrefAcademicEnabled) return null
  if (process.env.OPENBANCA_ENABLE_CROSSREF_MCP !== "1") return null
  return ["uvx", "--from", "crossref-academic-mcp-server", "crossref-server"]
}
