import { readFileSync, existsSync, writeFileSync } from "node:fs"
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
  mcp: { crossrefAcademicEnabled: true },
}

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
    raw.mcp.crossrefAcademicEnabled ??= true
    raw.version = 1
  }
  return raw
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const path = configPath(projectRoot)
  if (!existsSync(path)) return { ...DEFAULTS, manuscript: { ...DEFAULTS.manuscript }, compile: { ...DEFAULTS.compile }, allowedPaths: [...DEFAULTS.allowedPaths], protectedPaths: [...DEFAULTS.protectedPaths], immutableFacts: [...DEFAULTS.immutableFacts], externalDependencies: [...DEFAULTS.externalDependencies], providers: { references: { ...DEFAULTS.providers.references } }, mcp: { ...DEFAULTS.mcp } }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"))
    const migrated = migrate(raw)
    return sanitizeConfig(migrated)
  } catch {
    return { ...DEFAULTS }
  }
}

function sanitizeConfig(raw: any): ProjectConfig {
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    manuscript: raw.manuscript ? {
      format: ["latex", "markdown", "docx"].includes(raw.manuscript.format) ? raw.manuscript.format : "latex",
      root: raw.manuscript.root || ".",
      main: raw.manuscript.main || "main.tex",
      bib: raw.manuscript.bib || "referencias.bib",
      chapters: Array.isArray(raw.manuscript.chapters) ? raw.manuscript.chapters : ["capitulos/*.tex"],
      outputDir: raw.manuscript.outputDir || "trabalhos",
    } : { ...DEFAULTS.manuscript },
    compile: raw.compile ? {
      enabled: raw.compile.enabled !== false,
      command: Array.isArray(raw.compile.command) ? raw.compile.command : ["lualatex", "bibtex", "lualatex", "lualatex"],
    } : { ...DEFAULTS.compile },
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
    } : { references: { ...DEFAULTS.providers.references } },
    mcp: raw.mcp ? {
      crossrefAcademicEnabled: raw.mcp.crossrefAcademicEnabled !== false,
    } : { ...DEFAULTS.mcp },
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
    return { valid: errs.length === 0, errors: errs }
  } catch (err: any) {
    return { valid: false, errors: [err.message] }
  }
}

export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  writeFileSync(configPath(projectRoot), JSON.stringify(config, null, 2), "utf-8")
}

export function ensureBancaDir(projectRoot: string): void {
  const d = getProjectDir(projectRoot)
  for (const sub of ["", "reports", "context", "snapshots", "cache"]) {
    const p = join(d, sub)
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  }
}
import { mkdirSync } from "node:fs"

export function getMcpCommand(projectRoot: string): string[] | null {
  const config = loadConfig(projectRoot)
  if (!config.mcp.crossrefAcademicEnabled) return null
  return ["uvx", "--from", "crossref-academic-mcp-server", "crossref-server"]
}
