import { lstatSync, readFileSync, writeFileSync, type Stats } from "node:fs"
import { join } from "node:path"
import { ensureRealDirInsideRoot, PathTraversalError, prepareRealPathForWrite, resolveRealInsideRoot } from "./safe_paths"

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

/**
 * Fixed, sanitized refusals for a configuration whose physical origin cannot be
 * authorized or read. They never embed the host path, a link target, external
 * file content or a raw filesystem message.
 */
const CONFIG_ORIGIN_REFUSED_UNSAFE =
  "config refused: the configured origin is not a safe regular file inside the workspace"
const CONFIG_ORIGIN_REFUSED_INSPECTION =
  "config refused: the configured origin could not be inspected safely"
const CONFIG_ORIGIN_REFUSED_READ =
  "config refused: the present configuration could not be read"

/**
 * Expected failures of reading an already inspected regular file. They must
 * surface as a controlled refusal; they are never degraded to legitimate
 * absence or to defaults.
 */
const EXPECTED_CONFIG_READ_FAILURES = new Set([
  "EACCES",
  "EPERM",
  "EISDIR",
  "ELOOP",
  "ENOENT",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENAMETOOLONG",
  "ESTALE",
])

/** Independent deep copy of the legitimate defaults (as before this fix). */
function defaultConfig(): Required<ProjectConfig> {
  const defs = DEFAULTS as Required<ProjectConfig>
  return {
    ...defs,
    manuscript: { ...defs.manuscript },
    compile: { ...defs.compile },
    allowedPaths: [...defs.allowedPaths],
    protectedPaths: [...defs.protectedPaths],
    immutableFacts: [...defs.immutableFacts],
    externalDependencies: [...defs.externalDependencies],
    providers: { references: { ...defs.providers.references } },
    mcp: { ...defs.mcp },
    analysis: { ...defs.analysis },
  }
}

type ConfigOrigin = { status: "absent" } | { status: "present"; content: string }

/**
 * Canonical configuration preflight shared by `loadConfig` and
 * `validateConfig` (issue #134).
 *
 * The project workspace is the only authorized root. `.banca`, the target of a
 * link or a configured path is never promoted to a trusted root. The origin is
 * resolved with the existing canonical policy (`resolveRealInsideRoot`), the
 * approved destination is inspected with `lstatSync`, and only a regular file
 * is read — directories, FIFOs, sockets and devices are never opened.
 *
 * Categories are kept distinct: an internal regular file is read; a missing
 * `.banca/project.json` is legitimate absence; an escaping/broken link, a
 * non-directory ancestor, a non-regular destination or an inspection failure
 * are controlled refusals; a present file that cannot be read is a controlled
 * read refusal. A residual TOCTOU window remains between this inspection and
 * the read, so the guarantee covers a filesystem not concurrently mutated by
 * another process.
 */
function readConfigOrigin(projectRoot: string): ConfigOrigin {
  let canonicalPath: string
  try {
    canonicalPath = resolveRealInsideRoot(projectRoot, configPath(projectRoot))
  } catch (error) {
    if (error instanceof PathTraversalError) throw new PathTraversalError(CONFIG_ORIGIN_REFUSED_UNSAFE)
    throw error
  }
  let destination: Stats
  try {
    destination = lstatSync(canonicalPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { status: "absent" }
    if (typeof code === "string") throw new PathTraversalError(CONFIG_ORIGIN_REFUSED_INSPECTION)
    throw error
  }
  if (!destination.isFile()) throw new PathTraversalError(CONFIG_ORIGIN_REFUSED_UNSAFE)
  let content: string
  try {
    content = readFileSync(canonicalPath, "utf-8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (typeof code === "string" && EXPECTED_CONFIG_READ_FAILURES.has(code)) {
      throw new PathTraversalError(CONFIG_ORIGIN_REFUSED_READ)
    }
    throw error
  }
  return { status: "present", content }
}

export function loadConfig(projectRoot: string): Required<ProjectConfig> {
  const origin = readConfigOrigin(projectRoot)
  if (origin.status === "absent") return defaultConfig()
  try {
    const raw = JSON.parse(origin.content)
    const migrated = migrate(raw)
    return sanitizeConfig(migrated)
  } catch {
    // Historical contract: invalid JSON in an internal, authorized regular file
    // falls back to independent defaults. Origin and read refusals are decided
    // before this read and therefore never reach this catch.
    return defaultConfig()
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
  let origin: ConfigOrigin
  try {
    origin = readConfigOrigin(projectRoot)
  } catch (error) {
    // Public contract preserved: a present but unauthorized/unreadable origin
    // is reported through the structured `{ valid, errors }` result with a
    // fixed, sanitized diagnostic instead of a raw filesystem message.
    if (error instanceof PathTraversalError) return { valid: false, errors: [error.message] }
    throw error
  }
  if (origin.status === "absent") return { valid: false, errors: ["config not found"] }
  try {
    const raw = JSON.parse(origin.content)
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
  const target = prepareRealPathForWrite(projectRoot, configPath(projectRoot))
  writeFileSync(target, JSON.stringify({ ...config, analysis: sanitizeAnalysis(config.analysis, defaults.analysis) }, null, 2), "utf-8")
}

export function ensureBancaDir(projectRoot: string): void {
  const d = getProjectDir(projectRoot)
  for (const sub of ["", "reports", "context", "snapshots", "cache"]) {
    ensureRealDirInsideRoot(projectRoot, join(d, sub))
  }
}

export function getMcpCommand(projectRoot: string): string[] | null {
  const config = loadConfig(projectRoot)
  if (!config.mcp.crossrefAcademicEnabled) return null
  if (process.env.OPENBANCA_ENABLE_CROSSREF_MCP !== "1") return null
  return ["uvx", "--from", "crossref-academic-mcp-server", "crossref-server"]
}
