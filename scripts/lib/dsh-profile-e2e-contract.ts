import { createHash } from "node:crypto"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export interface SelectedDshPackage {
  layout: "nested" | "sibling"
  packageRoot: string
  manifestPath: string
  entryPath: string
  dshVersion: string
  manifest: Record<string, unknown>
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isInsidePath(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
}

function readPackageManifest(path: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (isRecord(parsed)) return parsed
  } catch {
    // Report a stable, path-free contract error below.
  }
  throw new Error("selected DSH package metadata is invalid")
}

function validReleaseVersion(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
}

export function safeRuntimeVersion(value: unknown): string | null {
  return typeof value === "string" && /^v?\d+\.\d+\.\d+$/.test(value) ? value : null
}

export function declaredPackageVersionMatches(actualVersion: string, declaredRange: unknown): boolean {
  if (typeof declaredRange !== "string" || !validReleaseVersion(actualVersion)) return false
  if (declaredRange === actualVersion) return true
  const range = declaredRange.match(/^~(\d+)\.(\d+)\.(\d+)$/)
  const actual = actualVersion.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  return Boolean(range && actual && !actual[4] && Number(actual[1]) === Number(range[1]) &&
    Number(actual[2]) === Number(range[2]) && Number(actual[3]) >= Number(range[3]))
}

/** Verify that the executable is exactly the bin declared by its nearest DSH package. */
export function resolveSelectedDshPackageRoot(executable: string): string | null {
  let realExecutable: string
  try {
    realExecutable = realpathSync(executable)
  } catch {
    return null
  }
  let current = dirname(realExecutable)
  while (true) {
    const manifestPath = join(current, "package.json")
    if (existsSync(manifestPath)) {
      let manifest: Record<string, unknown> | undefined
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
        if (isRecord(parsed)) manifest = parsed
      } catch {
        manifest = undefined
      }
      if (manifest?.name === "@deepseek-ai/dsh") {
        const declaredBin = typeof manifest.bin === "string"
          ? manifest.bin
          : isRecord(manifest.bin) && typeof manifest.bin.dsh === "string"
            ? manifest.bin.dsh
            : undefined
        if (!validReleaseVersion(manifest.version) || !declaredBin || isAbsolute(declaredBin)) return null
        const binPath = resolve(current, declaredBin)
        if (!isInsidePath(current, binPath)) return null
        try {
          if (!statSync(binPath).isFile() || realpathSync(binPath) !== realExecutable) return null
          return current
        } catch {
          return null
        }
      }
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function selectedDshInstallRoot(dshRoot: string): string {
  let current = dirname(dshRoot)
  let nearestNodeModules: string | undefined
  let pnpmRoot: string | undefined
  while (current !== dirname(current)) {
    if (basename(current) === "node_modules") {
      nearestNodeModules ??= current
      if (isDirectory(join(current, ".pnpm"))) {
        pnpmRoot = current
        break
      }
    }
    current = dirname(current)
  }
  const root = pnpmRoot ?? nearestNodeModules
  if (!root) throw new Error("selected DSH package installation root is unavailable")
  try {
    return realpathSync(root)
  } catch {
    throw new Error("selected DSH package installation root is unavailable")
  }
}

function nodeImportExportConditions(nodeVersion: string): Set<string> {
  const version = nodeVersion.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!version) throw new Error("selected DSH Node version is invalid")
  const major = Number(version[1])
  const minor = Number(version[2])
  const patch = Number(version[3])
  if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error("selected DSH Node version is invalid")
  const supportsModuleSync = major >= 24 || (major === 23 && minor >= 4) ||
    (major === 22 && minor >= 10) || (major === 20 && minor >= 19)
  return new Set([
    "node-addons",
    "node",
    "import",
    ...(supportsModuleSync ? ["module-sync"] : []),
    "default",
  ])
}

function selectImportExportTarget(value: unknown, conditions: Set<string>): string | undefined {
  if (typeof value === "string") return value
  if (Array.isArray(value)) throw new Error("selected DSH package export map shape is unsupported")
  if (!isRecord(value)) return undefined
  for (const [condition, target] of Object.entries(value)) {
    if (!conditions.has(condition)) continue
    const selected = selectImportExportTarget(target, conditions)
    if (selected !== undefined) return selected
    if (!isRecord(target)) throw new Error("selected DSH package import condition is invalid")
  }
  return undefined
}

function validPackageExportTarget(target: string): boolean {
  if (!target.startsWith("./") || /[%\\?#*]/.test(target)) return false
  const segments = target.slice(2).split("/")
  return segments.length > 0 && segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." && segment.toLowerCase() !== "node_modules",
  )
}

function validPackageSubpathKey(key: string): boolean {
  if (key === ".") return true
  if (!key.startsWith("./") || key.length <= 2 || /[%\\?#]/.test(key)) return false
  const segments = key.slice(2).split("/")
  const wildcardCount = key.split("*").length - 1
  return wildcardCount <= 1 && segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".." && segment.toLowerCase() !== "node_modules",
  )
}

function publicPackageEntry(manifest: Record<string, unknown>, packageRoot: string, nodeVersion: string): string {
  const exports = manifest.exports
  const hasExportsMap = exports !== undefined
  const exportKeys = isRecord(exports) ? Object.keys(exports) : []
  const exportsHaveSubpaths = exportKeys.some((key) => key.startsWith("."))
  const exportsHaveConditions = exportKeys.some((key) => !key.startsWith("."))
  if (exportsHaveSubpaths && exportsHaveConditions) {
    throw new Error("selected DSH package exports cannot mix subpath and condition keys")
  }
  if (exportsHaveSubpaths && exportKeys.some((key) => !validPackageSubpathKey(key))) {
    throw new Error("selected DSH package subpath export key is invalid")
  }
  const rootExport = exportsHaveSubpaths ? (exports as Record<string, unknown>)["."] : exports
  const target = hasExportsMap
    ? selectImportExportTarget(rootExport, nodeImportExportConditions(nodeVersion))
    : typeof manifest.main === "string" ? manifest.main : undefined
  if (!target || isAbsolute(target) || (hasExportsMap && !validPackageExportTarget(target))) {
    throw new Error("selected DSH package public entrypoint is unavailable")
  }
  const entry = join(packageRoot, target)
  try {
    const realEntry = realpathSync(entry)
    if (!isInsidePath(packageRoot, realEntry) || !statSync(realEntry).isFile()) {
      throw new Error("selected DSH package public entrypoint is invalid")
    }
    return realEntry
  } catch {
    throw new Error("selected DSH package public entrypoint is unavailable")
  }
}

/**
 * Resolve only the selected DSH package's local or sibling dependency layout.
 * This deliberately avoids Node's parent/global module search so a missing
 * package cannot silently come from the checkout or another DSH installation.
 */
export function resolveSelectedDshPackage(dshRoot: string, packageName: string, nodeVersion: string): SelectedDshPackage {
  if (!/^@deepseek-ai\/[a-z0-9][a-z0-9-]*$/.test(packageName)) {
    throw new Error("selected DSH dependency name is invalid")
  }
  let realDshRoot: string
  try {
    realDshRoot = realpathSync(dshRoot)
  } catch {
    throw new Error("selected DSH package root is unavailable")
  }
  const dshManifest = readPackageManifest(join(realDshRoot, "package.json"))
  if (dshManifest.name !== "@deepseek-ai/dsh" || !validReleaseVersion(dshManifest.version)) {
    throw new Error("selected DSH package identity or version is invalid")
  }

  const nestedScope = join(realDshRoot, "node_modules", "@deepseek-ai")
  const siblingScope = dirname(realDshRoot)
  const siblingLayoutAvailable = basename(siblingScope) === "@deepseek-ai" &&
    basename(dirname(siblingScope)) === "node_modules" && isDirectory(siblingScope)
  const installRoot = selectedDshInstallRoot(realDshRoot)
  const roots: Array<{ layout: SelectedDshPackage["layout"]; scope: string }> = []
  if (isDirectory(nestedScope)) roots.push({ layout: "nested", scope: nestedScope })
  if (siblingLayoutAvailable) roots.push({ layout: "sibling", scope: siblingScope })

  const shortName = packageName.slice("@deepseek-ai/".length)
  let selected: { layout: SelectedDshPackage["layout"]; manifestPath: string } | undefined
  for (const candidate of roots) {
    const packageDirectory = join(candidate.scope, shortName)
    if (!existsSync(packageDirectory)) continue
    const manifestPath = join(packageDirectory, "package.json")
    if (!existsSync(manifestPath)) throw new Error("selected DSH dependency metadata is unavailable")
    selected = { layout: candidate.layout, manifestPath }
    break
  }
  if (!selected) throw new Error("selected DSH dependency is unavailable")

  let realManifestPath: string
  try {
    realManifestPath = realpathSync(selected.manifestPath)
  } catch {
    throw new Error("selected DSH dependency metadata is unavailable")
  }
  const packageRoot = dirname(realManifestPath)
  if (!isInsidePath(installRoot, packageRoot) && !isInsidePath(realDshRoot, packageRoot)) {
    throw new Error("selected DSH dependency resolves outside its installation")
  }
  const manifest = readPackageManifest(realManifestPath)
  if (manifest.name !== packageName || !validReleaseVersion(manifest.version)) {
    throw new Error("selected DSH dependency identity or version is invalid")
  }
  if (packageName.startsWith("@deepseek-ai/dsh-") && manifest.version !== dshManifest.version) {
    throw new Error("selected DSH dependency version does not match the selected DSH release")
  }
  const entryPath = publicPackageEntry(manifest, packageRoot, nodeVersion)
  return {
    layout: selected.layout,
    packageRoot,
    manifestPath: realManifestPath,
    entryPath,
    dshVersion: dshManifest.version,
    manifest,
  }
}

export interface SafeCommandResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  spawnObserved?: boolean
  exitObserved?: boolean
  closeObserved?: boolean
}

function boolLabel(value: unknown): string {
  return value === true ? "true" : value === false ? "false" : "unknown"
}

/** Keep useful process status while omitting all untrusted stdout/stderr. */
export function safeOutput(result: SafeCommandResult): string {
  const exitCode = Number.isInteger(result.exitCode) ? String(result.exitCode) : "unavailable"
  const signal = typeof result.signal === "string" && /^SIG[A-Z0-9]+$/.test(result.signal)
    ? result.signal
    : result.signal === null ? "none" : "other"
  const stdoutChars = typeof result.stdout === "string" ? result.stdout.length : 0
  const stderrChars = typeof result.stderr === "string" ? result.stderr.length : 0
  return `exitCode=${exitCode}, signal=${signal}, timedOut=${boolLabel(result.timedOut)}, spawnObserved=${boolLabel(result.spawnObserved)}, exitObserved=${boolLabel(result.exitObserved)}, closeObserved=${boolLabel(result.closeObserved)}, stdoutChars=${stdoutChars}, stderrChars=${stderrChars}`
}

function sanitizeDiagnosticText(value: string): string {
  let safe = value
    .replace(/(?:file|local|vscode-local|vscode-remote):(?:\/\/)?[^"'<>;,\r\n)\]}]+/gi, "<local-uri>")
    .replace(/(["'`])\/(?:[^\r\n]*?)\1/g, "<absolute-path>")
    .replace(/(^|[\s"'`=([{])\/(?:[^\r\n,;)}\]]+)/g, "$1<absolute-path>")
    .replace(/(^|[\s"'`=([{])[A-Za-z]:[\\/](?:[^\r\n,;)}\]]+)/g, "$1<absolute-path>")
    .replace(/(^|[\s"'`=([{])\\\\[^\r\n,;)}\]]+/g, "$1<absolute-path>")
    .replace(/(["']?(?:agent|session|request|event|call|process)[_-]?ids?["']?\s*[:=]\s*["']?)[^\s,"'{}\]]+["']?/gi, "$1<redacted-native-id>")
    .replace(/(["'`]?pid["']?\s*[:=]\s*["']?)[^\s,"'{}\]]+["']?/gi, "$1<redacted-native-id>")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "<redacted-native-id>")
    .replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<redacted-native-id>")
    .replace(/\b(?:agent|session|sess|request|req|event|evt|call|tool)[_-][A-Za-z0-9][A-Za-z0-9._-]{5,}\b/gi, "<redacted-native-id>")
    .replace(/(?:sk|api|key|token)[-_]?[A-Za-z0-9]{12,}/gi, "<redacted>")
  return safe.replace(/[\r\n\t]+/g, " ").trim()
}

function looksLikeLocalPathOrUri(value: string): boolean {
  const trimmed = value.trim()
  return /^(?:file|local|vscode-local|vscode-remote):/i.test(trimmed) ||
    trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")
}

const privateIdentityKey = /^(?:(?:agent|session|request|event|call|process)[_-]?ids?|pid)$/i
const pathValueKey = /(?:path|file|directory|dirname|cwd|root)$/i
// Preserve schema fields whose names overlap the free-text secret detector, only at their canonical paths.
// Values under these fields still pass through the ordinary recursive redaction rules.
const canonicalReportKeyPaths = new Set([
  JSON.stringify(["versions", "dshApiSessionController"]),
  JSON.stringify(["stages", "composedProfile", "containsAskUserToolEntry"]),
  JSON.stringify(["stages", "composedProfile", "askUserToolCount"]),
  JSON.stringify(["stages", "composedProfile", "askUserToolUnique"]),
  JSON.stringify(["stages", "composedProfile", "askUserToolPresent"]),
])

/** Redact all report strings at the persistence boundary, not only failures[]. */
export function sanitizeReport(value: unknown): unknown {
  const visit = (
    current: unknown,
    key = "",
    parentKey = "",
    path: readonly string[] = [],
    canonicalPathAllowed = true,
  ): unknown => {
    if (typeof current === "string") {
      if (privateIdentityKey.test(key) || key.toLowerCase() === "id" ||
          (key === "ids" && /(?:agent|session|request|event|call|process)/i.test(parentKey))) {
        return "<redacted-native-id>"
      }
      if (pathValueKey.test(key) && looksLikeLocalPathOrUri(current)) return "<redacted-local-path>"
      return sanitizeDiagnosticText(current)
    }
    if (Array.isArray(current)) return current.map((entry) => visit(entry, key, parentKey, path, false))
    if (isRecord(current)) {
      const entries = Object.entries(current)
      const canonicalAtPath = (childKey: string) => canonicalPathAllowed &&
        canonicalReportKeyPaths.has(JSON.stringify([...path, childKey]))
      const reservedCanonicalKeys = new Set(entries
        .map(([childKey]) => childKey)
        .filter(canonicalAtPath))
      const usedKeys = new Set(reservedCanonicalKeys)
      const safeEntries = Object.create(null) as Record<string, unknown>
      for (const [childKey, child] of entries) {
        const canonical = canonicalAtPath(childKey)
        const baseKey = canonical ? childKey : sanitizeDiagnosticText(childKey) || "<redacted-key>"
        let safeKey = baseKey
        if (!canonical) {
          let suffix = 1
          while (usedKeys.has(safeKey) || canonicalAtPath(safeKey)) {
            safeKey = `${baseKey}#${suffix++}`
          }
          usedKeys.add(safeKey)
        }
        Object.defineProperty(safeEntries, safeKey, {
          value: visit(child, childKey, key, [...path, childKey], canonicalPathAllowed),
          enumerable: true,
          configurable: true,
          writable: true,
        })
      }
      return safeEntries
    }
    return current
  }
  return visit(value)
}

/** A bounded failure diagnostic with an explicit stage, nature, and exit code. */
export function formatCommandFailure(stage: string, nature: string, result: SafeCommandResult): string {
  return `${sanitizeDiagnosticText(stage)}: ${sanitizeDiagnosticText(nature)}; ${safeOutput(result)}`
}

export const expectedTools = [
  "banca_init",
  "banca_status",
  "banca_context",
  "banca_auditar",
  "banca_sintese",
  "banca_corrigir",
  "banca_refs",
  "banca_ia",
  "banca_plagio",
  "banca_loop",
  "banca_snapshot",
  "banca_compile",
  "banca_checklist",
  "banca_restore",
  "banca_validate",
  "banca_contract",
] as const

export const expectedNativeSkills = [
  "banca-avaliacao",
  "banca-correcao",
  "banca-detector-ia",
  "banca-grille",
  "banca-plagio",
  "banca-planejador",
  "banca-referencias",
  "banca-revisor",
] as const

export type ExpectedNativeSkillName = typeof expectedNativeSkills[number]

export const expectedNativeSkillProvider = "dshbanca"

export interface CanonicalNativeSkillDefinition {
  sourcePath: string
  sourceSha256: string
  bodySha256: string
  bodyLength: number
}

export const canonicalNativeSkills: Record<ExpectedNativeSkillName, CanonicalNativeSkillDefinition> = {
  "banca-avaliacao": {
    sourcePath: "skills/banca-avaliacao/SKILL.md",
    sourceSha256: "60bdcd97061da7748f7d1f9d6d7999fd62afac9b1269bf089eb23da7aab7c85e",
    bodySha256: "840e88e69a1d816fb24514d92fe0f1dac43098d16a7517fffb1e62e08f0b7a47",
    bodyLength: 7589,
  },
  "banca-correcao": {
    sourcePath: "skills/banca-correcao/SKILL.md",
    sourceSha256: "d0a05d3feb78f5ef05615a48892b3c5cdc88fc589b3fc2100f2d78a0a32d45c7",
    bodySha256: "330b72a1154c2b0c2c4db9257817f8583c29e5d0e43d1442fe79eecfc3598bd3",
    bodyLength: 1924,
  },
  "banca-detector-ia": {
    sourcePath: "skills/banca-detector-ia/SKILL.md",
    sourceSha256: "db296d3e384e809847b2398638d55c2bcf62e092c2058943013a7523cb1b6a4b",
    bodySha256: "69be0b5a2debf9dc3b177e9a593928d82421caa4985e9d6b1ce6de8469fa8eb5",
    bodyLength: 1537,
  },
  "banca-grille": {
    sourcePath: "skills/banca-grille/SKILL.md",
    sourceSha256: "9a861c773444a1fc537619202bb0818936bafd313efdd9438d3eb1985d0fc6e6",
    bodySha256: "334cb1743f8542c1c05373361fe47d59ed94e47a39e10475105fecd7f8d443d3",
    bodyLength: 4835,
  },
  "banca-plagio": {
    sourcePath: "skills/banca-plagio/SKILL.md",
    sourceSha256: "1159f65153fad06086fa0debefe41a567cf895d251b1dd4f52a2849ae1146661",
    bodySha256: "c1131ca56ac512d4182db27b35845930bde9fc7a401707b6aa19acc1e0ce1a6c",
    bodyLength: 1913,
  },
  "banca-planejador": {
    sourcePath: "skills/banca-planejador/SKILL.md",
    sourceSha256: "d39405b0333e53eabd616104d4387dd0f77c26d505d63bed9094a8ae254eac64",
    bodySha256: "f5a9e935b54f027f9f82f936cd692ef6b952b4e583546169b85b2fd5fd00a20e",
    bodyLength: 1856,
  },
  "banca-referencias": {
    sourcePath: "skills/banca-referencias/SKILL.md",
    sourceSha256: "b5b73abbbae029adc82980b2045c705b091b1629a44d14efab92aa731008d36b",
    bodySha256: "d41cad0de66968a7fc1d74e0b8223326e6f6e73ac965c3b31f93d65c8e7c3ed8",
    bodyLength: 1702,
  },
  "banca-revisor": {
    sourcePath: "skills/banca-revisor/SKILL.md",
    sourceSha256: "deb90fe58a8d334bddd9f4dc66810cb5c57621cc63bad313c44c199c042de798",
    bodySha256: "126b884ba795ea9c66f50ba18a4a1a2dfe7382bfba00107db76114cb30242216",
    bodyLength: 2042,
  },
}

/** Pinned source identity for this no-content-change validation slice. */
export const canonicalAuditorMarkdownSha256 = "103cbdf191600d83a8becdb43ce89fc37aa0f5c532768238929524d0cbedaf7a"
export const canonicalAuditorMarkdownSha1 = "aedf761fe161b1befc61eaad15b6ec01cd11153c"

export type ProfileGateStatus = "PASS" | "FAIL" | "BLOCKED"

/** No pre-step means the Markdown lifecycle gate has not been proven; once observed, any missing or invalid projection is a material failure. */
export function classifyAuditorMarkdownStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.nativePreStepObserved !== true) return "BLOCKED"
  return validateAuditorMarkdownEvidence(value).length === 0 ? "PASS" : "FAIL"
}

/** Classify the native skills discovery/loading verification gate status. */
export function classifyNativeSkillsStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.hostApiAvailable !== true) return "BLOCKED"
  return validateNativeSkillsEvidence(value).length === 0 ? "PASS" : "FAIL"
}

/** Classify the native questions/approval verification gate status. */
export function classifyNativeQuestionsStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.hostApiAvailable !== true) return "BLOCKED"
  const errors = validateNativeQuestionsEvidence(value)
  if (errors.length > 0) return "FAIL"
  const approval = isRecord(value.independentApproval) ? value.independentApproval : undefined
  if (approval?.status === "BLOCKED") return "BLOCKED"
  return "PASS"
}

/** Classify the native academic decision verification gate status (#48). */
export function classifyAcademicDecisionStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.hostApiAvailable !== true) return "BLOCKED"
  return validateAcademicDecisionEvidence(value).length === 0 ? "PASS" : "FAIL"
}

/** Keep legacy gates visible while incorporating native skills, batch audit, native questions, academic decisions, and cross-process recovery. */
export function classifyProfileGateStatuses(
  issue2Status: ProfileGateStatus,
  auditorMarkdownStatus: ProfileGateStatus,
  nativeSkillsStatus?: ProfileGateStatus,
  batchAuditStatus?: ProfileGateStatus,
  nativeQuestionsStatus?: ProfileGateStatus,
  academicDecisionStatus?: ProfileGateStatus,
  crossProcessBatchAuditStatus?: ProfileGateStatus,
): {
  issue2Status: ProfileGateStatus
  auditorMarkdownStatus: ProfileGateStatus
  nativeSkillsStatus?: ProfileGateStatus
  batchAuditStatus?: ProfileGateStatus
  nativeQuestionsStatus?: ProfileGateStatus
  academicDecisionStatus?: ProfileGateStatus
  crossProcessBatchAuditStatus?: ProfileGateStatus
  overallStatus: ProfileGateStatus
  exitCode: number
} {
  const statuses = [issue2Status, auditorMarkdownStatus]
  if (nativeSkillsStatus !== undefined) statuses.push(nativeSkillsStatus)
  if (batchAuditStatus !== undefined) statuses.push(batchAuditStatus)
  if (nativeQuestionsStatus !== undefined) statuses.push(nativeQuestionsStatus)
  if (academicDecisionStatus !== undefined) statuses.push(academicDecisionStatus)
  if (crossProcessBatchAuditStatus !== undefined) statuses.push(crossProcessBatchAuditStatus)
  const overallStatus: ProfileGateStatus = statuses.includes("FAIL")
    ? "FAIL"
    : statuses.includes("BLOCKED") ? "BLOCKED" : "PASS"
  return {
    issue2Status,
    auditorMarkdownStatus,
    ...(nativeSkillsStatus !== undefined ? { nativeSkillsStatus } : {}),
    ...(batchAuditStatus !== undefined ? { batchAuditStatus } : {}),
    ...(nativeQuestionsStatus !== undefined ? { nativeQuestionsStatus } : {}),
    ...(academicDecisionStatus !== undefined ? { academicDecisionStatus } : {}),
    ...(crossProcessBatchAuditStatus !== undefined ? { crossProcessBatchAuditStatus } : {}),
    overallStatus,
    exitCode: overallStatus === "PASS" ? passExitCode() : overallStatus === "BLOCKED" ? missingHostExitCode() : failureExitCode(),
  }
}

export interface ProfileEvidence {
  profileManifestHasBundle?: boolean
  profileManifestHasObserver?: boolean
  composedEntry?: boolean
  entrypointResolved?: boolean
  presetRegistryEntry?: boolean
  auditorPresetEntry?: boolean
  controlPresetEntry?: boolean
  userQuestionsUnique?: boolean
  userApprovalUnique?: boolean
  askUserToolPresent?: boolean
}

export interface RuntimeEvidence {
  profileRuntime?: boolean
  lifecycle?: string
  toolNames?: unknown
  exactToolSet?: boolean
  skillFound?: boolean
  executedTools?: unknown
  statusSucceeded?: boolean
  statusReadOnly?: boolean
  workspaceInventoryBeforeStatus?: unknown
  workspaceInventoryAfterStatus?: unknown
  agentIdentity?: unknown
  auditorMutationAttempts?: unknown
  nativeGuardProbe?: unknown
  nativeRestoreGuardProbe?: unknown
  deniedWorkspaceInventoryBefore?: unknown
  deniedWorkspaceInventoryAfter?: unknown
  permittedStatus?: unknown
  unverifiedDelegation?: unknown
  agentTeardown?: unknown
  externalActivity?: unknown
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isGuardDenial(message: unknown, detail: string): boolean {
  return typeof message === "string" && message.includes("DSHbanca guard:") && message.includes(detail)
}

function inventoriesEqual(before: unknown, after: unknown): boolean {
  return isRecord(before) && isRecord(after) && JSON.stringify(before) === JSON.stringify(after)
}

function hasProtectedState(inventory: unknown): boolean {
  return isRecord(inventory) && typeof inventory["main.tex"] === "string" &&
    typeof inventory[".banca/state.json"] === "string"
}

export function validateProfileEvidence(evidence: ProfileEvidence): string[] {
  const errors: string[] = []
  if (evidence.profileManifestHasBundle !== true) errors.push("profile bundle entry missing")
  if (evidence.profileManifestHasObserver !== true) errors.push("observer bundle entry missing")
  if (evidence.composedEntry !== true) errors.push("Cordis composition entry missing")
  if (evidence.entrypointResolved !== true) errors.push("plugin entrypoint did not resolve in profile node_modules")
  if (evidence.presetRegistryEntry !== true) errors.push("DSH AgentPresetRegistry entry missing")
  if (evidence.auditorPresetEntry !== true) errors.push("banca-auditor DSH AgentPreset entry missing")
  if (evidence.controlPresetEntry !== true) errors.push("scratch control DSH AgentPreset entry missing")
  if (evidence.userQuestionsUnique === false) errors.push("user-questions plugin package has duplicate instances in composed profile")
  if (evidence.userApprovalUnique === false) errors.push("user-approval plugin package has duplicate instances in composed profile")
  if (evidence.askUserToolPresent === false) errors.push("tool-ask-user entry missing from composed profile")
  return errors
}

/** Ensure the required registry fallback resolves to exactly one declared preset. */
export function validatePresetReferences(defaultId: unknown, presetIds: unknown[]): string[] {
  const errors: string[] = []
  const ids = presetIds.filter((id): id is string => typeof id === "string")
  if (typeof defaultId !== "string" || !ids.includes(defaultId)) {
    errors.push("AgentPresetRegistry default does not resolve to a declared preset")
  }
  if (new Set(ids).size !== ids.length) errors.push("AgentPreset declarations contain duplicate IDs")
  return errors
}

/**
 * Known Cordis singleton service providers shipped with DSH.
 * Each of these packages registers a singleton service on Cordis ctx and cannot
 * be instantiated multiple times without throwing runtime registration conflicts.
 */
export const knownCordisSingletonPluginServices: Record<string, string> = {
  "@deepseek-ai/dsh-user-approval": "approval",
  "@deepseek-ai/dsh-user-questions": "userQuestions",
  "@deepseek-ai/dsh-agent-preset-registry": "agentPresets",
}

/**
 * Validates that a composed Cordis profile does not contain duplicate plugin package
 * instantiations or duplicate service registrations. Cordis enforces strict service
 * uniqueness; instantiating multiple rows of a plugin that calls ctx.provide()
 * (e.g., @deepseek-ai/dsh-user-approval for "approval") causes a fatal registration
 * error during host boot.
 *
 * This validator checks:
 * 1. Duplicate row IDs among active rows.
 * 2. Duplicate package instantiations for singleton service providers.
 * 3. Duplicate service registrations by provider/service identity, even if row IDs differ.
 */
export function validateComposedProfilePlugins(rows: unknown[]): string[] {
  const errors: string[] = []
  if (!Array.isArray(rows)) return ["composed profile rows must be an array"]

  const activeRowIds = new Map<string, number>()
  const packageInstances = new Map<string, string[]>()
  const serviceProviders = new Map<string, Array<{ rowId: string; packageName: string }>>()

  for (const rawRow of rows) {
    if (!isRecord(rawRow) || typeof rawRow.name !== "string") continue
    if (rawRow.disabled === true) continue

    const packageName = rawRow.name
    const rowId = typeof rawRow.id === "string" ? rawRow.id : "(anonymous)"

    // 1. Check row ID uniqueness
    if (typeof rawRow.id === "string") {
      const prevCount = activeRowIds.get(rawRow.id) ?? 0
      activeRowIds.set(rawRow.id, prevCount + 1)
    }

    // 2. Track package instances
    const existing = packageInstances.get(packageName) ?? []
    existing.push(rowId)
    packageInstances.set(packageName, existing)

    // 3. Track service provider identity
    const providedService = knownCordisSingletonPluginServices[packageName]
    if (providedService) {
      const providers = serviceProviders.get(providedService) ?? []
      providers.push({ rowId, packageName })
      serviceProviders.set(providedService, providers)
    }
  }

  // Report duplicate row IDs
  for (const [id, count] of activeRowIds.entries()) {
    if (count > 1) {
      errors.push(`duplicate row id "${id}" in composed profile (appeared ${count} times)`)
    }
  }

  // Report duplicate package instantiations for singleton providers
  for (const [pkgName, rowIds] of packageInstances.entries()) {
    if (pkgName in knownCordisSingletonPluginServices && rowIds.length > 1) {
      errors.push(
        `duplicate plugin package "${pkgName}" instantiated ${rowIds.length} times across rows (ids: ${rowIds.map((id) => `"${id}"`).join(", ")})`,
      )
    }
  }

  // Report duplicate service providers by service identity (even with different row IDs)
  for (const [serviceName, providers] of serviceProviders.entries()) {
    if (providers.length > 1) {
      const providerDesc = providers.map((p) => `id "${p.rowId}" (${p.packageName})`).join(", ")
      errors.push(
        `duplicate Cordis service "${serviceName}" provided by multiple rows: ${providerDesc}`,
      )
    }
  }

  return errors
}

/**
 * Validate proof that the canonical auditor Markdown was loaded by DSH and
 * bound to a live native Agent/Session. File presence and preset identity alone
 * are deliberately insufficient. This is a separate acceptance contract from
 * the existing identity/guard gate because the installed host cannot currently
 * expose this proof without entering its model-facing pre-step lifecycle.
 */
export function validateAuditorMarkdownEvidence(value: unknown): string[] {
  const evidence = isRecord(value) ? value : {}
  const errors: string[] = []

  if (
    evidence.sourcePath !== "assets/dsh/agents/banca-auditor.md" ||
    evidence.sourceSha256 !== canonicalAuditorMarkdownSha256 ||
    evidence.sourceSha1 !== canonicalAuditorMarkdownSha1
  ) {
    errors.push("canonical auditor Markdown is missing or altered")
  }
  if (
    evidence.installedPath !== ".dsh/agents/banca-auditor.md" ||
    evidence.installedSha256 !== evidence.sourceSha256 ||
    evidence.installedSha1 !== evidence.sourceSha1
  ) {
    errors.push("installed auditor Markdown differs from canonical source")
  }
  if (
    evidence.loaderCopyPath !== "banca-auditor.md" ||
    evidence.loaderCopySha256 !== evidence.sourceSha256 ||
    evidence.loaderCopySha1 !== evidence.sourceSha1
  ) {
    errors.push("loader-root auditor Markdown differs from canonical source")
  }
  if (evidence.hostDiscovered !== true) {
    errors.push("DSH did not discover auditor Markdown content")
  }
  if (
    evidence.presetId !== "banca-auditor" ||
    evidence.presetCompositionEmpty !== false ||
    evidence.presetCompositionHasInstructionLoader !== true
  ) {
    errors.push("banca-auditor preset does not mount native instruction content")
  }
  if (
    evidence.loadedSourceSha1 !== canonicalAuditorMarkdownSha1
  ) {
    errors.push("native DSH did not load Markdown into the agent session")
  }
  if (
    evidence.nativePreStepObserved !== true ||
    evidence.instructionContextMessageCount !== 1
  ) {
    errors.push("native pre-step instruction projection was not observed")
  }
  const preStepEvent = isRecord(evidence.preStepEvent) ? evidence.preStepEvent : undefined
  const eventIds = Array.isArray(evidence.preStepEventIds) ? evidence.preStepEventIds : []
  if (
    !preStepEvent ||
    typeof preStepEvent.id !== "string" || preStepEvent.id.length === 0 ||
    typeof preStepEvent.agentId !== "string" || preStepEvent.agentId.length === 0 ||
    preStepEvent.sessionId !== preStepEvent.agentId ||
    JSON.stringify(eventIds) !== JSON.stringify([preStepEvent.id]) ||
    preStepEvent.id === preStepEvent.agentId
  ) {
    errors.push("pre-step evidence lacks unique native event provenance")
  }
  if (
    evidence.instructionMessageRole !== "user" ||
    evidence.instructionMessageSourceKind !== "agent-instructions" ||
    evidence.instructionMessagePath !== "banca-auditor.md"
  ) {
    errors.push("native instruction projection is not a user message from the expected source")
  }
  if (evidence.controlInstructionMessageCount !== 0) {
    errors.push("control Agent received auditor-only instructions")
  }
  if (
    evidence.agentAndSessionIdMatch !== true ||
    evidence.agentRegistryContainsAgent !== true ||
    evidence.sessionStoreContainsSession !== true ||
    evidence.effectivePreset !== "banca-auditor" ||
    evidence.sessionProjectionPreset !== "banca-auditor"
  ) {
    errors.push("auditor instruction content is not bound to the live banca-auditor Agent and Session")
  }
  if (evidence.syntheticContext !== false || evidence.syntheticPresetFixture !== false) {
    errors.push("auditor Markdown evidence is synthetic rather than host-validated")
  }
  if (evidence.modelCalls !== 0 || evidence.credentialsUsed !== false) {
    errors.push("E2E used or did not rule out a model/credential call")
  }
  return errors
}

export interface NativeSkillItemEvidence {
  name: string
  provider: string | null
  sourcePath: string
  sourceSha256: string
  canonicalBodySha256: string
  discovered: boolean
  loaded: boolean
  contentSha256: string | null
  contentBytes: number | null
  integrityVerified: boolean
}

export interface NativeSkillsEvidence {
  hostApiAvailable: boolean
  catalogComplete: boolean
  totalSkillsObserved: number
  allDiscovered: boolean
  allLoaded: boolean
  allIntegrityVerified: boolean
  skills: Record<string, NativeSkillItemEvidence>
  aborted?: boolean
}

/**
 * Validate proof that all eight canonical academic skills are discovered and
 * loaded exclusively by DSH native skill services with full body integrity.
 */
export function validateNativeSkillsEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ["native skills evidence lacks required host verification"]
  }
  if (value.aborted === true) {
    errors.push("native skill discovery or loading operation was aborted")
  }
  if (value.hostApiAvailable !== true) {
    errors.push("native skills evidence lacks required host verification")
  }
  if (value.catalogComplete !== true) {
    errors.push("native skill catalog discovery was incomplete")
  }

  const skills = isRecord(value.skills) ? value.skills : {}
  for (const expectedName of expectedNativeSkills) {
    const canonical = canonicalNativeSkills[expectedName]
    const skill = isRecord(skills[expectedName]) ? (skills[expectedName] as Record<string, any>) : undefined
    if (!skill || skill.discovered !== true) {
      errors.push(`required skill "${expectedName}" was not discovered`)
      continue
    }
    if (skill.provider !== expectedNativeSkillProvider) {
      errors.push(`skill "${expectedName}" provider is "${skill.provider}", expected "${expectedNativeSkillProvider}"`)
    }
    if (skill.sourcePath !== canonical.sourcePath) {
      errors.push(`skill "${expectedName}" source path differs from canonical source`)
    }
    if (
      skill.sourceSha256 !== canonical.sourceSha256 ||
      skill.canonicalBodySha256 !== canonical.bodySha256
    ) {
      errors.push(`canonical source hash for "${expectedName}" is invalid`)
    }
    if (skill.loaded !== true) {
      errors.push(`skill "${expectedName}" was discovered but could not be loaded`)
      continue
    }
    if (skill.contentSha256 !== canonical.bodySha256 || skill.integrityVerified !== true) {
      errors.push(`skill "${expectedName}" loaded content does not match canonical source`)
    }
  }

  if (value.allDiscovered !== true && !errors.some((e) => e.includes("was not discovered"))) {
    errors.push("not all required native skills were discovered")
  }
  if (value.allLoaded !== true && !errors.some((e) => e.includes("could not be loaded"))) {
    errors.push("not all required native skills were loaded")
  }
  if (value.allIntegrityVerified !== true && !errors.some((e) => e.includes("does not match canonical source"))) {
    errors.push("not all required native skills had their integrity verified")
  }

  return errors
}

export interface SkillRegistryObserverLike {
  snapshot?: (options?: { cwd?: string; signal?: AbortSignal }) => Promise<unknown>
  list?: (options?: { cwd?: string; signal?: AbortSignal }) => Promise<unknown>
  get?: (name: string, options?: { cwd?: string; signal?: AbortSignal }) => Promise<unknown>
}

export interface SkillObserverContextLike {
  skills?: SkillRegistryObserverLike
}

/**
 * Capture native skills evidence from a live or synthetic DSH context fail-closed.
 * An explicit snapshot with complete === true must be observed to prove catalog completeness.
 * Missing snapshot, snapshot exceptions, malformed snapshot responses, and complete !== true
 * never produce catalogComplete === true.
 */
export async function captureNativeSkillsEvidence(
  ctx: SkillObserverContextLike,
  workspace: string,
  options?: { signal?: AbortSignal },
): Promise<NativeSkillsEvidence> {
  const signal = options?.signal ?? new AbortController().signal
  let observedCatalog: any[] = []
  let catalogSnapshotComplete = false
  const hostApiAvailable =
    typeof ctx.skills?.snapshot === "function" &&
    typeof ctx.skills?.list === "function" &&
    typeof ctx.skills?.get === "function"

  if (typeof ctx.skills?.snapshot === "function") {
    try {
      const snap = await ctx.skills.snapshot({ cwd: workspace, signal })
      if (isRecord(snap) && Array.isArray(snap.skills)) {
        observedCatalog = snap.skills
        catalogSnapshotComplete = snap.complete === true
      } else {
        observedCatalog = []
        catalogSnapshotComplete = false
      }
    } catch {
      observedCatalog = typeof ctx.skills?.list === "function"
        ? ((await ctx.skills.list({ cwd: workspace, signal }).catch(() => [])) as any[])
        : []
      catalogSnapshotComplete = false
    }
  } else if (typeof ctx.skills?.list === "function") {
    try {
      const list = await ctx.skills.list({ cwd: workspace, signal })
      observedCatalog = Array.isArray(list) ? list : []
    } catch {
      observedCatalog = []
    }
    catalogSnapshotComplete = false
  }

  const evidence: NativeSkillsEvidence = {
    hostApiAvailable,
    catalogComplete: catalogSnapshotComplete,
    totalSkillsObserved: observedCatalog.length,
    allDiscovered: false,
    allLoaded: false,
    allIntegrityVerified: false,
    skills: {},
  }

  if (evidence.hostApiAvailable) {
    let allDiscovered = true
    let allLoaded = true
    let allIntegrityVerified = true

    for (const skillName of expectedNativeSkills) {
      const canonical = canonicalNativeSkills[skillName]
      const winningSummary = observedCatalog.find((row) => isRecord(row) && row.name === skillName)
      const discovered = winningSummary !== undefined
      if (!discovered) allDiscovered = false

      let loaded = false
      let contentSha256: string | null = null
      let contentBytes: number | null = null
      let integrityVerified = false

      if (discovered && typeof ctx.skills?.get === "function") {
        try {
          const loadSignal = new AbortController().signal
          const loadedDef = await ctx.skills.get(skillName, { cwd: workspace, signal: loadSignal })
          if (isRecord(loadedDef) && typeof loadedDef.content === "string") {
            const content = loadedDef.content
            loaded = true
            contentBytes = Buffer.byteLength(content, "utf8")
            contentSha256 = createHash("sha256").update(content).digest("hex")
            integrityVerified = contentSha256 === canonical.bodySha256
          }
        } catch {
          loaded = false
        }
      }

      if (!loaded) allLoaded = false
      if (!integrityVerified) allIntegrityVerified = false

      evidence.skills[skillName] = {
        name: skillName,
        provider: typeof winningSummary?.provider === "string" ? winningSummary.provider : null,
        sourcePath: canonical.sourcePath,
        sourceSha256: canonical.sourceSha256,
        canonicalBodySha256: canonical.bodySha256,
        discovered,
        loaded,
        contentSha256,
        contentBytes,
        integrityVerified,
      }
    }

    evidence.allDiscovered = allDiscovered
    evidence.allLoaded = allLoaded
    evidence.allIntegrityVerified = allIntegrityVerified
  }

  return evidence
}

export function validateEvidence(evidence: RuntimeEvidence): string[] {
  const errors: string[] = []
  if (evidence.profileRuntime !== true) errors.push("profile runtime was not observed")
  if (typeof evidence.lifecycle !== "string" || !evidence.lifecycle.includes("Cordis apply")) errors.push("Cordis plugin lifecycle was not observed")
  const names = Array.isArray(evidence.toolNames) ? evidence.toolNames : []
  if (JSON.stringify([...names].sort()) !== JSON.stringify([...expectedTools].sort())) errors.push("tool discovery is incomplete or contains unexpected banca tools")
  if (evidence.exactToolSet !== true) errors.push("exact tool-set assertion did not pass")
  if (evidence.skillFound !== true) errors.push("banca-avaliacao skill was not discovered")
  const executed = Array.isArray(evidence.executedTools) ? evidence.executedTools : []
  if (!executed.includes("banca_init")) errors.push("banca_init did not execute through the profile runtime")
  if (!executed.includes("banca_status")) errors.push("banca_status did not execute through the profile runtime")
  if (evidence.statusSucceeded !== true) errors.push("banca_status did not succeed")
  if (evidence.statusReadOnly !== true) errors.push("banca_status modified synthetic workspace state")
  if (JSON.stringify(evidence.workspaceInventoryBeforeStatus) !== JSON.stringify(evidence.workspaceInventoryAfterStatus)) errors.push("filesystem inventory differs across banca_status")

  const identity = isRecord(evidence.agentIdentity) ? evidence.agentIdentity : undefined
  if (
    identity?.createdVia !== "ctx.agents.create" ||
    identity.agentRegistryContainsAgent !== true ||
    identity.sessionStoreContainsSession !== true ||
    identity.agentAndSessionIdMatch !== true ||
    identity.presetRegisteredByHost !== true ||
    identity.presetResolvedByHost !== true ||
    identity.effectivePreset !== "banca-auditor" ||
    identity.sessionProjectionPreset !== "banca-auditor" ||
    identity.syntheticContext !== false
  ) {
    errors.push("auditor identity is not a verified live DSH agent")
  }
  if (identity?.modelTurnEvents !== 0) errors.push("model-facing turns were observed in the real DSH session")

  const attempts = Array.isArray(evidence.auditorMutationAttempts) ? evidence.auditorMutationAttempts : []
  for (const toolName of ["banca_corrigir", "banca_restore"]) {
    const attempt = attempts.find((row) => isRecord(row) && row.toolName === toolName)
    if (!isRecord(attempt) || attempt.dispatchCount !== 1) {
      errors.push("auditor mutation was not dispatched through DSH ToolRuntime")
      continue
    }
    const detail = "read-only enforcement"
    if (
      attempt.argumentsValid !== true ||
      attempt.operationWouldMutate !== true ||
      attempt.isError !== true ||
      attempt.aborted !== false ||
      !isGuardDenial(attempt.message, detail)
    ) {
      errors.push("auditor mutation denial is not a valid non-aborted guard denial")
    }
  }
  if (attempts.length < 2) errors.push("auditor mutation attempts are incomplete")

  const nativeProbe = isRecord(evidence.nativeGuardProbe) ? evidence.nativeGuardProbe : undefined
  if (
    nativeProbe?.toolName !== "banca_corrigir" ||
    nativeProbe.dispatchCount !== 1 ||
    nativeProbe.isError !== true ||
    !isGuardDenial(nativeProbe.message, "read-only enforcement") ||
    nativeProbe.bodyInvocations !== 0 ||
    nativeProbe.bodyMarkerAbsent !== true
  ) {
    errors.push("native guard probe was not denied before body execution")
  }

  const nativeRestoreProbe = isRecord(evidence.nativeRestoreGuardProbe) ? evidence.nativeRestoreGuardProbe : undefined
  if (
    nativeRestoreProbe?.toolName !== "banca_restore" ||
    nativeRestoreProbe.dispatchCount !== 1 ||
    nativeRestoreProbe.isError !== true ||
    !isGuardDenial(nativeRestoreProbe.message, "read-only enforcement") ||
    nativeRestoreProbe.bodyInvocations !== 0 ||
    nativeRestoreProbe.bodyMarkerAbsent !== true
  ) {
    errors.push("native restore guard probe was not denied before body execution")
  }

  const beforeDenied = evidence.deniedWorkspaceInventoryBefore
  const afterDenied = evidence.deniedWorkspaceInventoryAfter
  if (
    !hasProtectedState(beforeDenied) ||
    !hasProtectedState(afterDenied) ||
    !inventoriesEqual(beforeDenied, afterDenied)
  ) {
    errors.push("synthetic workspace changed after a denial")
  }

  const permitted = isRecord(evidence.permittedStatus) ? evidence.permittedStatus : undefined
  if (
    permitted?.dispatched !== true ||
    permitted.isError !== false ||
    permitted.outputIncludesMain !== true ||
    !inventoriesEqual(permitted.inventoryBefore, permitted.inventoryAfter)
  ) {
    errors.push("banca_status did not succeed for the verified auditor")
  }

  const delegation = isRecord(evidence.unverifiedDelegation) ? evidence.unverifiedDelegation : undefined
  const delegatedAttempt = delegation && isRecord(delegation.attempt) ? delegation.attempt : undefined
  const delegatedPreset = delegation?.effectivePreset
  const hasCorrectorPreset = typeof delegatedPreset === "string" && delegatedPreset.startsWith("banca-corretor")
  if (
    delegation?.agentRegistryContainsAgent !== true ||
    delegation.sessionStoreContainsSession !== true ||
    delegation.agentAndSessionIdMatch !== true ||
    delegation.sessionOrigin !== "subagent" ||
    hasCorrectorPreset ||
    delegatedAttempt?.toolName !== "banca_corrigir" ||
    delegatedAttempt.dispatchCount !== 1 ||
    delegatedAttempt.argumentsValid !== true ||
    delegatedAttempt.isError !== true ||
    delegatedAttempt.aborted !== false ||
    delegatedAttempt.bodyInvocations !== 0 ||
    !isGuardDenial(delegatedAttempt.message, "without a verified banca-corretor preset") ||
    !hasProtectedState(delegation?.inventoryBefore) ||
    !hasProtectedState(delegation?.inventoryAfter) ||
    !inventoriesEqual(delegation?.inventoryBefore, delegation?.inventoryAfter)
  ) {
    errors.push("unverified delegation is not fail-closed")
  }
  if (delegation?.modelTurnEvents !== 0) errors.push("model-facing turns were observed in the unverified DSH session")

  const activity = isRecord(evidence.externalActivity) ? evidence.externalActivity : undefined
  if (
    activity?.modelCalls !== 0 ||
    activity.sessionPromptCalls !== 0 ||
    activity.agentSendCalls !== 2 ||
    activity.agentRequestEvents !== 0 ||
    activity.stepStartEvents !== 0 ||
    !Array.isArray(activity.forbiddenStoredEventTypes) ||
    JSON.stringify(activity.forbiddenStoredEventTypes) !== JSON.stringify(["step/start", "request/header", "agent/request", "assistant/message"]) ||
    !Array.isArray(activity.auditorStoredForbiddenEvents) || activity.auditorStoredForbiddenEvents.length !== 0 ||
    !Array.isArray(activity.controlStoredForbiddenEvents) || activity.controlStoredForbiddenEvents.length !== 0 ||
    activity.credentialsUsed !== false
  ) {
    errors.push("E2E did not stop both native pre-step probes before step/start and agent/request, or used a model/credential")
  }

  const teardown = isRecord(evidence.agentTeardown) ? evidence.agentTeardown : undefined
  if (teardown?.auditorAgentDisposed !== true || teardown.controlAgentDisposed !== true || teardown.unverifiedAgentDisposed !== true) {
    errors.push("real DSH Agent lifecycle teardown was not verified")
  }
  if (teardown?.auditorAgentUnregistered !== true || teardown.controlAgentUnregistered !== true) {
    errors.push("disposed auditor/control Agents remained in native registries")
  }
  return errors
}

export interface BatchAuditFindingProjectionEvidence {
  version: string
  findingId: string
  planId: string
  batchId: string
  manuscriptFingerprint: string
  provenanceSha256: string
  claimSha256: string
  evidenceSha256: string
}

export interface BatchAuditEvidenceGateEvidence {
  probeExecuted: boolean
  totalBatches: number
  completedBatches: number
  planId: string
  manuscriptFingerprint: string
  planBatchIds: string[]
  batchAudits: Array<{
    batchIndex: number
    batchId: string
    agentId: string
    acceptedCount: number
    receiptFindingCount: number
    persistedFindingCount: number
    findingId: string | null
  }>
  unverifiedAdvancesBlocked: number
  prematureSynthesisBlocked: number
  prematureSynthesisProbes: CrossProcessSynthesisProbeEvidence[]
  auditsCompletedWithZeroFindings: number
  auditToolDispatchCount: number
  orderlyAdvances: number
  resumesWithoutSpuriousAdvance: number
  invalidFinding: {
    rejected: boolean
    errorCode: string
    statePreserved: boolean
    stateBeforeSha256: string
    stateAfterSha256: string
  }
  auditorIdentity: {
    createdVia: string
    agentId: string
    sessionId: string
    agentAndSessionIdMatch: boolean
    agentRegistryContainsAgent: boolean
    sessionStoreContainsSession: boolean
    effectivePreset: string
    toolRuntime: string
    modelCalls: number
  }
  agentSessionResume: {
    probeExecuted: boolean
    executionMode: string
    syntheticAgentFixture: boolean
    sameProcess: boolean
    originalAgentId: string
    originalSessionId: string
    agentId: string
    sessionId: string
    createdVia: string
    identityDistinctFromOriginal: boolean
    agentAndSessionIdMatch: boolean
    agentRegistryContainsAgent: boolean
    sessionStoreContainsSession: boolean
    workspaceMatches: boolean
    presetSelectionResult: string
    effectivePreset: string
    sessionPresetProjection: string
    toolRuntime: string
    switchAfterCompletedBatches: number
    queryCompletedBatchIdProvided: boolean
    checkpointBeforeQuery: {
      planId: string
      manuscriptFingerprint: string
      totalBatches: number
      completedBatches: number
      completedCharacters: number
      totalCharacters: number
      coveragePercent: number
      nextBatchId: string
      nextBatchIndex: number
    }
    checkpointAfterQuery: {
      planId: string
      manuscriptFingerprint: string
      totalBatches: number
      completedBatches: number
      completedCharacters: number
      totalCharacters: number
      coveragePercent: number
      nextBatchId: string
      nextBatchIndex: number
    }
    analysisStores: {
      inventoryBeforeSha256: string
      inventoryAfterSha256: string
      checkpointBeforeSha256: string
      checkpointAfterSha256: string
      auditConfirmationsBeforeSha256: string
      auditConfirmationsAfterSha256: string
      findingsBeforeSha256: string
      findingsAfterSha256: string
    }
    receiptLedgerBeforeSha256: string
    receiptLedgerAfterSha256: string
    receiptLedgerUnchanged: boolean
    findingBeforeResume: {
      count: number
      projection: BatchAuditFindingProjectionEvidence
    }
    completedBatchIds: string[]
    completedBatchCount: number
    toolDispatchCount: number
    synthesisAgentId: string
    modelCalls: number
    teardown: {
      disposeCalled: boolean
      agentUnregistered: boolean
      sessionUnregistered: boolean
    }
  }
  nonEmptyFinding: {
    batchIndex: number
    acceptedCount: number
    receiptFindingCount: number
    persistedFindingCount: number
    synthesisFindingCount: number
    deterministicFindingId: boolean
    expected: BatchAuditFindingProjectionEvidence
    receipt: BatchAuditFindingProjectionEvidence
    persisted: BatchAuditFindingProjectionEvidence
    synthesis: BatchAuditFindingProjectionEvidence
  }
  synthesis: {
    version: string
    planId: string
    manuscriptFingerprint: string
    coverage: {
      state: string
      totalBatches: number
      completedBatches: number
      totalCharacters: number
      completedCharacters: number
      coveragePercent: number
      orderedBatchIds: string[]
    }
    findingsCount: number
  }
  synthesisReleased: boolean
  synthesisInputCoverageState: string
  manuscriptPreserved: boolean
}

const batchAuditFindingProjectionKeys = [
  "version",
  "findingId",
  "planId",
  "batchId",
  "manuscriptFingerprint",
  "provenanceSha256",
  "claimSha256",
  "evidenceSha256",
] as const

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
}

function isBatchAuditFindingProjection(value: unknown): value is BatchAuditFindingProjectionEvidence {
  return isRecord(value) &&
    value.version === "analysis-finding-v1" &&
    isSha256Digest(value.findingId) &&
    isSha256Digest(value.planId) &&
    typeof value.batchId === "string" && value.batchId.length > 0 &&
    isSha256Digest(value.manuscriptFingerprint) &&
    isSha256Digest(value.provenanceSha256) &&
    isSha256Digest(value.claimSha256) &&
    isSha256Digest(value.evidenceSha256)
}

function batchAuditFindingProjectionsEqual(
  left: BatchAuditFindingProjectionEvidence,
  right: BatchAuditFindingProjectionEvidence,
): boolean {
  return batchAuditFindingProjectionKeys.every((key) => left[key] === right[key])
}

/**
 * Validate proof that the native ToolRuntime accepted one non-empty finding,
 * persisted it once, and returned the same identity/provenance in completed synthesis input.
 */
export function validateBatchAuditEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ["batch audit evidence gate lacks required host verification"]
  }
  if (value.probeExecuted !== true) {
    errors.push("batch audit probe must have executed")
  }
  const totalBatches = Number.isInteger(value.totalBatches) ? value.totalBatches as number : 0
  if (totalBatches < 2) {
    errors.push("totalBatches must be at least 2")
  }
  if (value.completedBatches !== totalBatches) {
    errors.push("completedBatches must equal totalBatches")
  }
  if (!isSha256Digest(value.planId)) {
    errors.push("planId must be a SHA-256 identity")
  }
  if (!isSha256Digest(value.manuscriptFingerprint)) {
    errors.push("manuscriptFingerprint must be a SHA-256 digest")
  }
  const planBatchIds = Array.isArray(value.planBatchIds) ? value.planBatchIds : []
  if (
    planBatchIds.length !== totalBatches ||
    planBatchIds.some((batchId) => typeof batchId !== "string" || batchId.length === 0) ||
    new Set(planBatchIds).size !== planBatchIds.length
  ) {
    errors.push("plan batch IDs must be complete, non-empty, and unique")
  }
  if (value.unverifiedAdvancesBlocked !== totalBatches) {
    errors.push("all batches must reject advance without audit")
  }
  if (value.prematureSynthesisBlocked !== totalBatches) {
    errors.push("all incomplete batches must block synthesis")
  }
  const synthesisProbes = Array.isArray(value.prematureSynthesisProbes) ? value.prematureSynthesisProbes : []
  if (synthesisProbes.length !== totalBatches) {
    errors.push("each incomplete batch must record an exact synthesis refusal")
  }
  const expectedFinding = isRecord(value.nonEmptyFinding) && isBatchAuditFindingProjection(value.nonEmptyFinding.expected)
    ? [value.nonEmptyFinding.expected]
    : []
  for (let index = 0; index < totalBatches; index++) {
    const probe = synthesisProbes[index]
    const checkpoint = isRecord(probe) && isRecord(probe.checkpointBefore) ? probe.checkpointBefore : {}
    const completedCharacters = checkpoint.completedCharacters
    const checkpointCoverageMatches = Number.isInteger(completedCharacters) && completedCharacters >= 0 && completedCharacters <= 595 &&
      checkpoint.coveragePercent === Math.round((completedCharacters / 595) * 10_000) / 100
    const expectedProbeFindings = index === 0 ? [] : expectedFinding
    if (!checkpointCoverageMatches || !restartSynthesisProbeMatches(
      probe,
      {
        batchIndex: index,
        batchId: typeof planBatchIds[index] === "string" ? planBatchIds[index] : "",
        checkpoint,
        persistedReceiptCount: index + 1,
        persistedBatchIds: planBatchIds.slice(0, index + 1),
        findings: expectedProbeFindings,
      },
      value.planId,
      value.manuscriptFingerprint,
    )) errors.push(`incomplete batch ${index} must return the exact incomplete_coverage ToolRuntime value without mutation`)
  }
  if (value.auditsCompletedWithZeroFindings !== totalBatches - 1) {
    errors.push("exactly one batch must accept a non-empty finding; other batches must remain empty")
  }
  if (value.auditToolDispatchCount !== totalBatches + 1) {
    errors.push("ToolRuntime audit dispatch count must include one invalid probe and one audit per batch")
  }
  if (value.orderlyAdvances !== totalBatches) {
    errors.push("all batches must advance in order")
  }
  if (value.resumesWithoutSpuriousAdvance !== totalBatches) {
    errors.push("resume must not spuriously advance completedBatches")
  }

  const invalidFinding = isRecord(value.invalidFinding) ? value.invalidFinding : undefined
  if (invalidFinding?.rejected !== true || invalidFinding.errorCode !== "invalid_lines") {
    errors.push("invalid finding must be rejected before persistence")
  }
  if (
    invalidFinding?.statePreserved !== true ||
    !isSha256Digest(invalidFinding.stateBeforeSha256) ||
    !isSha256Digest(invalidFinding.stateAfterSha256) ||
    invalidFinding.stateBeforeSha256 !== invalidFinding.stateAfterSha256
  ) {
    errors.push("invalid finding rejection must leave persisted state unchanged")
  }

  const identity = isRecord(value.auditorIdentity) ? value.auditorIdentity : undefined
  if (
    identity?.createdVia !== "ctx.agents.create" ||
    !isSha256Digest(identity.agentId) ||
    !isSha256Digest(identity.sessionId) ||
    identity.agentId !== identity.sessionId ||
    identity.agentAndSessionIdMatch !== true ||
    identity.agentRegistryContainsAgent !== true ||
    identity.sessionStoreContainsSession !== true ||
    identity.effectivePreset !== "banca-auditor" ||
    identity.toolRuntime !== "ctx.tools.execute" ||
    identity.modelCalls !== 0
  ) {
    errors.push("auditor Agent/Session identity must be observed through DSH registries")
  }

  if (totalBatches !== 5) {
    errors.push("issue #98/#100 vertical probe must retain exactly five canonical batches")
  }

  const resume = isRecord(value.agentSessionResume) ? value.agentSessionResume : undefined
  const originalAgentId = identity?.agentId
  const originalSessionId = identity?.sessionId
  if (
    resume?.probeExecuted !== true ||
    resume.executionMode !== "same-process-native-dsh" ||
    resume.syntheticAgentFixture !== false ||
    resume.sameProcess !== true ||
    resume.createdVia !== "ctx.agents.create" ||
    !isSha256Digest(resume.agentId) ||
    !isSha256Digest(resume.sessionId) ||
    resume.agentId !== resume.sessionId ||
    resume.agentAndSessionIdMatch !== true ||
    resume.originalAgentId !== originalAgentId ||
    resume.originalSessionId !== originalSessionId ||
    resume.agentId === originalAgentId ||
    resume.sessionId === originalSessionId ||
    resume.identityDistinctFromOriginal !== true ||
    resume.agentRegistryContainsAgent !== true ||
    resume.sessionStoreContainsSession !== true ||
    resume.workspaceMatches !== true ||
    resume.presetSelectionResult !== "banca-auditor" ||
    resume.effectivePreset !== "banca-auditor" ||
    resume.sessionPresetProjection !== "banca-auditor" ||
    resume.toolRuntime !== "ctx.tools.execute" ||
    resume.modelCalls !== 0
  ) {
    errors.push("native Agent/Session handoff must use a distinct live banca-auditor identity in the same DSH process")
  }

  const checkpointBeforeQuery = isRecord(resume?.checkpointBeforeQuery)
    ? resume.checkpointBeforeQuery
    : undefined
  const checkpointAfterQuery = isRecord(resume?.checkpointAfterQuery)
    ? resume.checkpointAfterQuery
    : undefined
  const expectedResumeBatchId = Array.isArray(planBatchIds) ? planBatchIds[2] : undefined
  const checkpointSnapshotsMatch = [checkpointBeforeQuery, checkpointAfterQuery].every((snapshot) => {
    if (!snapshot) return false
    const totalCharacters = Number.isInteger(snapshot.totalCharacters) ? snapshot.totalCharacters as number : 0
    const completedCharacters = Number.isInteger(snapshot.completedCharacters) ? snapshot.completedCharacters as number : -1
    const expectedCoverage = totalCharacters > 0
      ? Math.round((completedCharacters / totalCharacters) * 10000) / 100
      : -1
    return snapshot.planId === value.planId &&
      snapshot.manuscriptFingerprint === value.manuscriptFingerprint &&
      snapshot.totalBatches === 5 &&
      snapshot.completedBatches === 2 &&
      completedCharacters >= 0 && completedCharacters <= totalCharacters &&
      totalCharacters === 595 &&
      snapshot.coveragePercent === expectedCoverage &&
      snapshot.nextBatchId === expectedResumeBatchId &&
      snapshot.nextBatchIndex === 2
  })
  if (
    resume?.switchAfterCompletedBatches !== 2 ||
    resume.queryCompletedBatchIdProvided !== false ||
    !checkpointBeforeQuery || !checkpointAfterQuery ||
    checkpointBeforeQuery.completedCharacters !== checkpointAfterQuery.completedCharacters ||
    checkpointBeforeQuery.coveragePercent !== checkpointAfterQuery.coveragePercent ||
    checkpointBeforeQuery.nextBatchId !== checkpointAfterQuery.nextBatchId ||
    checkpointBeforeQuery.nextBatchIndex !== checkpointAfterQuery.nextBatchIndex ||
    !checkpointSnapshotsMatch
  ) {
    errors.push("new Agent must recover the same plan and fingerprint at 2/5 without advancing or restarting the checkpoint")
  }

  const analysisStores = isRecord(resume?.analysisStores) ? resume.analysisStores : undefined
  const analysisDigestPairs = [
    [analysisStores?.inventoryBeforeSha256, analysisStores?.inventoryAfterSha256],
    [analysisStores?.checkpointBeforeSha256, analysisStores?.checkpointAfterSha256],
    [analysisStores?.auditConfirmationsBeforeSha256, analysisStores?.auditConfirmationsAfterSha256],
    [analysisStores?.findingsBeforeSha256, analysisStores?.findingsAfterSha256],
  ]
  if (!analysisDigestPairs.every(([before, after]) =>
    isSha256Digest(before) && isSha256Digest(after) && before === after
  )) {
    errors.push("resume-only context query must not mutate checkpoint, audit-confirmation, or findings state")
  }
  if (
    resume?.receiptLedgerUnchanged !== true ||
    !isSha256Digest(resume.receiptLedgerBeforeSha256) ||
    !isSha256Digest(resume.receiptLedgerAfterSha256) ||
    resume.receiptLedgerBeforeSha256 !== resume.receiptLedgerAfterSha256 ||
    resume.receiptLedgerBeforeSha256 !== analysisStores?.auditConfirmationsBeforeSha256 ||
    resume.receiptLedgerAfterSha256 !== analysisStores?.auditConfirmationsAfterSha256
  ) {
    errors.push("resume-only context query must preserve the validated audit receipt ledger")
  }

  const nonEmptyFinding = isRecord(value.nonEmptyFinding) ? value.nonEmptyFinding : undefined
  const recoveredFinding = isRecord(resume?.findingBeforeResume) ? resume.findingBeforeResume : undefined
  const recoveredProjection = recoveredFinding?.projection
  const expectedProjection = nonEmptyFinding?.expected
  if (
    recoveredFinding?.count !== 1 ||
    !isBatchAuditFindingProjection(recoveredProjection) ||
    !isBatchAuditFindingProjection(expectedProjection) ||
    !batchAuditFindingProjectionsEqual(
      recoveredProjection as BatchAuditFindingProjectionEvidence,
      expectedProjection as BatchAuditFindingProjectionEvidence,
    ) ||
    recoveredProjection.planId !== value.planId ||
    recoveredProjection.manuscriptFingerprint !== value.manuscriptFingerprint ||
    nonEmptyFinding?.batchIndex !== 1
  ) {
    errors.push("the original single persisted finding must remain present and unchanged across the Agent/Session handoff")
  }

  const resumedBatchIds = Array.isArray(resume?.completedBatchIds) ? resume.completedBatchIds : []
  const expectedResumedBatchIds = Array.isArray(planBatchIds) ? planBatchIds.slice(2) : []
  const expectedResumeDispatchCount = 1 + Math.max(totalBatches - 2, 0) * 5 + 1
  const resumeTeardown = isRecord(resume?.teardown) ? resume.teardown : undefined
  if (
    resume?.completedBatchCount !== totalBatches - 2 ||
    JSON.stringify(resumedBatchIds) !== JSON.stringify(expectedResumedBatchIds) ||
    !isSha256Digest(resume.synthesisAgentId) ||
    resume.toolDispatchCount !== expectedResumeDispatchCount ||
    resume.synthesisAgentId !== resume.agentId
  ) {
    errors.push("remaining batches and final synthesis must run through the new Agent/Session")
  }
  if (
    resumeTeardown?.disposeCalled !== true ||
    resumeTeardown.agentUnregistered !== true ||
    resumeTeardown.sessionUnregistered !== true
  ) {
    errors.push("resumed Agent and Session must be disposed and absent from native registries")
  }

  const finding = isRecord(value.nonEmptyFinding) ? value.nonEmptyFinding : undefined
  if (
    !finding ||
    !Number.isInteger(finding.batchIndex) || finding.batchIndex < 0 || finding.batchIndex >= totalBatches ||
    finding.acceptedCount !== 1 || finding.receiptFindingCount !== 1
  ) {
    errors.push("non-empty finding must be accepted exactly once")
  }
  if (finding?.persistedFindingCount !== 1) {
    errors.push("persisted findings store must contain exactly one non-empty finding")
  }
  if (finding?.synthesisFindingCount !== 1) {
    errors.push("synthesis input must contain exactly one finding")
  }
  if (finding?.deterministicFindingId !== true) {
    errors.push("findingId must match the deterministic identity calculated from the submitted finding")
  }

  const batchAudits = Array.isArray(value.batchAudits) ? value.batchAudits : []
  if (batchAudits.length !== totalBatches) {
    errors.push("batch audit receipts must cover every plan batch exactly once in plan order")
  } else {
    const findingBatchIndex = Number.isInteger(finding?.batchIndex) ? finding.batchIndex : -1
    const expectedFindingId = isRecord(finding?.expected) ? finding.expected.findingId : undefined
    let batchesInPlanOrder = true
    let oneExpectedFindingOnly = findingBatchIndex >= 0 && findingBatchIndex < totalBatches
    let persistedCountsInOrder = true
    let batchAgentOwnershipInOrder = true
    for (let index = 0; index < totalBatches; index++) {
      const audit = batchAudits[index]
      if (!isRecord(audit)) {
        batchesInPlanOrder = false
        oneExpectedFindingOnly = false
        persistedCountsInOrder = false
        continue
      }
      if (audit.batchIndex !== index || audit.batchId !== planBatchIds[index]) {
        batchesInPlanOrder = false
      }
      const expectedBatchAgentId = index < 2 ? originalAgentId : resume?.agentId
      if (!isSha256Digest(audit.agentId) || typeof expectedBatchAgentId !== "string" || audit.agentId !== expectedBatchAgentId) {
        batchAgentOwnershipInOrder = false
      }
      const isFindingBatch = index === findingBatchIndex
      if (isFindingBatch) {
        if (
          audit.acceptedCount !== 1 ||
          audit.receiptFindingCount !== 1 ||
          audit.findingId !== expectedFindingId
        ) oneExpectedFindingOnly = false
      } else if (
        audit.acceptedCount !== 0 ||
        audit.receiptFindingCount !== 0 ||
        audit.findingId !== null
      ) {
        oneExpectedFindingOnly = false
      }
      const expectedPersistedCount = findingBatchIndex >= 0 && index >= findingBatchIndex ? 1 : 0
      if (audit.persistedFindingCount !== expectedPersistedCount) {
        persistedCountsInOrder = false
      }
    }
    if (!batchesInPlanOrder) {
      errors.push("batch audit receipts must cover every plan batch exactly once in plan order")
    }
    if (!oneExpectedFindingOnly) {
      errors.push("exactly one batch audit must accept the expected finding; other batches must remain empty")
    }
    if (!persistedCountsInOrder) {
      errors.push("per-batch persisted finding counts must reflect the single ordered durable store")
    }
    if (!batchAgentOwnershipInOrder) {
      errors.push("the original Agent must audit batches 1-2 and the distinct resumed Agent batches 3-5")
    }
  }

  if (
    finding &&
    isSha256Digest(value.planId) &&
    isSha256Digest(value.manuscriptFingerprint) &&
    Array.isArray(planBatchIds) &&
    Number.isInteger(finding.batchIndex) &&
    finding.batchIndex >= 0 &&
    finding.batchIndex < planBatchIds.length
  ) {
    const expected = finding.expected
    const receipt = finding.receipt
    const persisted = finding.persisted
    const synthesized = finding.synthesis
    const projections = [expected, receipt, persisted, synthesized]
    const validProjections = projections.every(isBatchAuditFindingProjection)
    if (!validProjections) {
      errors.push("expected, receipt, stored, and synthesis finding identity/provenance must be valid")
    } else {
      const typedExpected = expected as BatchAuditFindingProjectionEvidence
      if (
        typedExpected.planId !== value.planId ||
        typedExpected.manuscriptFingerprint !== value.manuscriptFingerprint ||
        typedExpected.batchId !== planBatchIds[finding.batchIndex] ||
        !projections.slice(1).every((projection) =>
          batchAuditFindingProjectionsEqual(typedExpected, projection as BatchAuditFindingProjectionEvidence),
        )
      ) {
        errors.push("expected, receipt, stored, and synthesis finding identity/provenance must match")
      }
    }
  }

  const synthesis = isRecord(value.synthesis) ? value.synthesis : undefined
  const coverage = isRecord(synthesis?.coverage) ? synthesis.coverage : undefined
  if (synthesis?.version !== "global-analysis-synthesis-input-v1") {
    errors.push("synthesis must return global-analysis-synthesis-input-v1")
  }
  if (
    synthesis?.planId !== value.planId ||
    synthesis?.manuscriptFingerprint !== value.manuscriptFingerprint ||
    synthesis?.findingsCount !== 1
  ) {
    errors.push("synthesis input identity and finding count must match the completed plan")
  }
  if (
    coverage?.state !== "complete" ||
    coverage.totalBatches !== totalBatches ||
    coverage.completedBatches !== totalBatches ||
    !Number.isInteger(coverage.totalCharacters) ||
    coverage.totalCharacters !== 595 ||
    coverage.completedCharacters !== coverage.totalCharacters ||
    coverage.coveragePercent !== 100
  ) {
    errors.push("synthesis coverage totals and counts must agree with the complete plan")
  }
  if (
    !Array.isArray(coverage?.orderedBatchIds) ||
    coverage.orderedBatchIds.length !== totalBatches ||
    JSON.stringify(coverage.orderedBatchIds) !== JSON.stringify(planBatchIds)
  ) {
    errors.push("synthesis input must preserve the exact plan batch order")
  }
  if (value.synthesisReleased !== true) {
    errors.push("synthesis must be released upon full coverage")
  }
  if (value.synthesisInputCoverageState !== "complete") {
    errors.push("synthesis coverage state must be complete")
  }
  if (value.manuscriptPreserved !== true) {
    errors.push("synthetic manuscript was modified by analysis tools")
  }
  return errors
}

/** Classify the batch audit evidence gate status. */
export function classifyBatchAuditEvidenceStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.totalBatches === undefined) return "BLOCKED"
  return validateBatchAuditEvidence(value).length === 0 ? "PASS" : "FAIL"
}

export interface CrossProcessSynthesisProbeEvidence {
  batchIndex: number
  batchId: string
  toolRuntimeIsError: boolean | null
  toolResultValue: string | null
  toolMessage: string | null
  errorCode: string | null
  errorMessage: string | null
  rejectionObserved: boolean
  checkpointBefore: Record<string, unknown>
  checkpointAfter: Record<string, unknown>
  persistenceBefore: Record<string, unknown>
  persistenceAfter: Record<string, unknown>
  workspaceInventoryBeforeSha256: string
  workspaceInventoryAfterSha256: string
  persistedReceiptCountBefore: number
  persistedReceiptCountAfter: number
  persistedBatchIdsBefore: string[]
  persistedBatchIdsAfter: string[]
  findingCountBefore: number
  findingCountAfter: number
  findingsBefore: BatchAuditFindingProjectionEvidence[]
  findingsAfter: BatchAuditFindingProjectionEvidence[]
  persistentStateUnchanged: boolean
}

export interface CrossProcessBatchAuditEvidence {
  probeExecuted: boolean
  executionMode: string
  syntheticProcessFixture: boolean
  workspace: {
    sameWorkspace: boolean
    preservedBetweenProcesses: boolean
    resetBetweenProcesses: boolean
    identitySha256: string
    firstProcessEndFilesystemIdentitySha256: string
    secondProcessStartFilesystemIdentitySha256: string
    secondProcessEndFilesystemIdentitySha256: string
    firstProcessEndInventorySha256: string
    secondProcessStartInventorySha256: string
  }
  processBoundary: {
    observationSource: string
    first: {
      dshExecutableSha256: string
      profileIdentitySha256: string
      hostIdentitySha256: string
      observerIdentitySha256: string
      identityMatched: boolean
      spawnObserved: boolean
      kernelStartIdentityObserved: boolean
      exitObserved: boolean
      exitCode: number | null
      signal: string | null
      timedOut: boolean
      forcedTermination: boolean
      naturalBeforeExitObserved: boolean
      nativeTeardownMarkerObserved: boolean
    }
    second: {
      dshExecutableSha256: string
      profileIdentitySha256: string
      hostIdentitySha256: string
      observerIdentitySha256: string
      identityMatched: boolean
      spawnObserved: boolean
      kernelStartIdentityObserved: boolean
      exitObserved: boolean
      exitCode: number | null
      signal: string | null
      timedOut: boolean
      forcedTermination: boolean
      naturalBeforeExitObserved: boolean
      nativeTeardownMarkerObserved: boolean
    }
    secondStartedAfterFirstExit: boolean
    processesDidNotOverlap: boolean
  }
  totalBatches: number
  totalCharacters: number
  planId: string
  manuscriptFingerprint: string
  planBatchIds: string[]
  phaseOne: {
    checkpoint: Record<string, unknown>
    completedBatchIds: string[]
    batchAudits: Array<Record<string, unknown>>
    persistence: Record<string, unknown>
    persistedReceiptCount: number
    persistedBatchIds: string[]
    unverifiedAdvancesBlocked: number
    workspaceInventorySha256: string
    findingCount: number
    finding: BatchAuditFindingProjectionEvidence
    prematureSynthesisBlocked: boolean
    prematureSynthesisProbes: CrossProcessSynthesisProbeEvidence[]
    synthesisReleased: boolean
    agentIdentity: Record<string, unknown>
    teardown: Record<string, unknown>
  }
  phaseTwo: {
    resumeQuery: {
      completedBatchIdProvided: boolean
      checkpointBefore: Record<string, unknown>
      checkpointAfter: Record<string, unknown>
      persistenceBefore: Record<string, unknown>
      persistenceAfter: Record<string, unknown>
      recoveredFindingCount: number
      recoveredFinding: BatchAuditFindingProjectionEvidence
      persistedReceiptCount: number
      persistedBatchIds: string[]
    }
    workspaceInventoryBeforeResumeSha256: string
    workspaceInventoryAfterResumeQuerySha256: string
    agentIdentity: Record<string, unknown>
    completedBatchIds: string[]
    batchAudits: Array<Record<string, unknown>>
    unverifiedAdvancesBlocked: number
    unverifiedAdvanceProbes: Array<{
      batchIndex: number
      batchId: string
      toolRuntimeIsError: boolean | null
      toolResultValue: string | null
      errorCode: string | null
      rejectionObserved: boolean
      checkpointBefore: Record<string, unknown>
      checkpointAfter: Record<string, unknown>
      persistenceBefore: Record<string, unknown>
      persistenceAfter: Record<string, unknown>
      workspaceInventoryBeforeSha256: string
      workspaceInventoryAfterSha256: string
      persistedReceiptCountBefore: number
      persistedReceiptCountAfter: number
      persistedBatchIdsBefore: string[]
      persistedBatchIdsAfter: string[]
      findingCountBefore: number
      findingCountAfter: number
      findingsBefore: BatchAuditFindingProjectionEvidence[]
      findingsAfter: BatchAuditFindingProjectionEvidence[]
      persistentStateUnchanged: boolean
    }>
    prematureSynthesisBlocked: boolean
    prematureSynthesisProbes: CrossProcessSynthesisProbeEvidence[]
    persistedReceiptCount: number
    persistedBatchIds: string[]
    finalCheckpoint: Record<string, unknown>
    synthesis: {
      state: string
      totalBatches: number
      completedBatches: number
      totalCharacters: number
      completedCharacters: number
      coveragePercent: number
      orderedBatchIds: string[]
      findingsCount: number
      finding: BatchAuditFindingProjectionEvidence
    }
    manuscriptPreserved: boolean
    teardown: Record<string, unknown>
  }
}

// Inventory digests bind the exact serialized parent/observer inventory; equality
// below is structural, so object insertion order never creates a false mutation.
function sourceDriftInventoryHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex")
}

function sourceDriftInventoryValid(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.keys(value).length > 0 && Object.entries(value).every(([path, digest]) =>
    path.length > 0 && !/[:\\\\\x00-\x1f\x7f]/.test(path) &&
    path.split("/").every(segment => segment.length > 0 && segment !== "." && segment !== "..") &&
    isSha256Digest(digest),
  )
}

/** Source drift is a separate mandatory vertical, never an alias for #103. */
export function classifySourceDriftEvidenceStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.probeExecuted === undefined) return "BLOCKED"
  return validateSourceDriftEvidence(value).length === 0 ? "PASS" : "FAIL"
}

/** Validate recorded native observations; a hermetic fixture is not host proof. */
export function validateSourceDriftEvidence(value: unknown): string[] {
  if (!isRecord(value)) return ["source-drift evidence is missing"]
  const errors: string[] = []
  const require = (condition: boolean, message: string) => { if (!condition) errors.push(message) }
  require(value.probeExecuted === true && value.executionMode === "source-drift-native-dsh" && value.syntheticProcessFixture === false,
    "source drift requires two real native DSH processes")
  const one = isRecord(value.phaseOne) ? value.phaseOne : {}
  for (const error of validateCrossProcessPhaseOneEvidence(value.phaseOne)) errors.push(`phase-one evidence: ${error}`)
  require(isRecord(one.teardown) && one.teardown.teardownFailed === false, "phase one teardown must explicitly succeed")
  const boundary = isRecord(value.processBoundary) ? value.processBoundary : {}
  require(boundary.observationSource === "child_process.spawn+linux-procfs", "source drift requires native process-start observations")
  for (const label of ["first", "second"]) {
    const row = isRecord(boundary[label]) ? boundary[label] : {}
    require(["dshExecutableSha256", "profileIdentitySha256", "hostIdentitySha256", "observerIdentitySha256"].every(key => isSha256Digest(row[key])) &&
      row.hostIdentitySha256 === row.observerIdentitySha256 && row.identityMatched === true && row.spawnObserved === true && row.kernelStartIdentityObserved === true,
      `${label} source-drift process identity is not corroborated`)
    require(row.exitObserved === true && row.exitCode === 0 && row.signal === null && row.timedOut === false && row.forcedTermination === false &&
      row.naturalBeforeExitObserved === true && row.nativeTeardownMarkerObserved === true,
      `${label} source-drift process must exit naturally after native teardown`)
  }
  require(boundary.secondStartedAfterFirstExit === true && boundary.processesDidNotOverlap === true &&
    isRecord(boundary.first) && isRecord(boundary.second) && boundary.first.hostIdentitySha256 !== boundary.second.hostIdentitySha256 &&
    boundary.first.dshExecutableSha256 === boundary.second.dshExecutableSha256 && boundary.first.profileIdentitySha256 === boundary.second.profileIdentitySha256,
    "source drift requires distinct sequential process instances")
  const workspace = isRecord(value.workspace) ? value.workspace : {}
  require(isSha256Digest(one.workspaceIdentitySha256) && ["identitySha256", "firstProcessEndFilesystemIdentitySha256", "secondProcessStartFilesystemIdentitySha256", "secondProcessEndFilesystemIdentitySha256"].every(key => workspace[key] === one.workspaceIdentitySha256),
    "source drift must preserve the physical workspace identity")
  const before = isRecord(value.canonicalBefore) ? value.canonicalBefore : {}
  const after = isRecord(value.canonicalAfter) ? value.canonicalAfter : {}
  require(isSha256Digest(before.planId) && isSha256Digest(before.manuscriptFingerprint) && before.planId === one.planId && before.manuscriptFingerprint === one.manuscriptFingerprint && before.totalBatches === 5 && before.totalCharacters === 595,
    "pre-mutation canonical identity must match phase one")
  require(isSha256Digest(after.planId) && isSha256Digest(after.manuscriptFingerprint) && after.planId !== before.planId && after.manuscriptFingerprint !== before.manuscriptFingerprint && after.totalBatches === 5 && after.totalCharacters === 595 &&
    after.firstBatchId === `ordered-source-spans-exhaustive-v1:${after.manuscriptFingerprint}:120:0`,
    "same-length source drift must produce a distinct canonical plan and fingerprint")
  const oldBatchIds = Array.isArray(one.planBatchIdsPrefix) ? one.planBatchIdsPrefix : []
  require(!oldBatchIds.includes(after.firstBatchId), "new canonical batch must not reuse an old batch ID")
  const mutation = isRecord(value.mutation) ? value.mutation : {}
  require(mutation.file === "capitulos/lote2.tex" && mutation.afterFirstExit === true && Number.isSafeInteger(mutation.utf16LengthBefore) && mutation.utf16LengthBefore > 0 && mutation.utf16LengthBefore === mutation.utf16LengthAfter &&
    isSha256Digest(mutation.sha256Before) && isSha256Digest(mutation.sha256After) && mutation.sha256Before !== mutation.sha256After,
    "source drift must change only lote2 bytes at equal positive UTF-16 length after first exit")
  const two = isRecord(value.phaseTwo) ? value.phaseTwo : {}
  const maps = [mutation.inventoryBefore, mutation.inventoryAfter, two.inventoryBeforeContext, two.inventoryAfterContext, two.inventoryFinal, value.parentFinalInventory]
  require(maps.every(sourceDriftInventoryValid), "source drift requires complete safe relative-path SHA-256 inventories")
  if (maps.every(sourceDriftInventoryValid)) {
    const [pre, post, preContext, postContext, final, parent] = maps as Record<string, string>[]
    require(sourceDriftInventoryHash(pre) === one.workspaceInventorySha256, "mutation inventory must bind phase-one workspace digest")
    require(pre[mutation.file] === mutation.sha256Before && post[mutation.file] === mutation.sha256After && Object.keys(pre).length === Object.keys(post).length &&
      Object.keys(pre).every(path => Object.hasOwn(post, path) && (path === mutation.file || pre[path] === post[path])),
      "mutation must change exactly one existing manuscript file without additions or deletions")
    require(restartCheckpointEvidenceEqual(post, preContext), "second process must start with the mutated inventory")
    const additions = Object.keys(postContext).filter(path => !Object.hasOwn(preContext, path))
    const newCheckpointPath = `.banca/analysis/checkpoints/${after.planId}.json`
    require(Object.keys(preContext).every(path => preContext[path] === postContext[path]) && additions.length === 2 && additions.includes(newCheckpointPath) &&
      additions.filter(path => /^\.banca\/context\/context-\d+\.md$/.test(path)).length === 1,
      "fresh context may add only its new checkpoint and one context pack")
    // state.saveAnalysisCheckpoint writes these ten raw fields, in this order,
    // with JSON.stringify(checkpoint, null, 2), without the three context fields.
    const stored = isRecord(two.storedCheckpoint) ? two.storedCheckpoint : {}
    const rawCheckpoint = Object.fromEntries(["version", "planId", "fingerprint", "strategy", "totalBatches", "completedBatches", "totalCharacters", "completedCharacters", "coveragePercent", "state"].map(key => [key, stored[key]]))
    const checkpointDigest = createHash("sha256").update(JSON.stringify(rawCheckpoint, null, 2)).digest("hex")
    require(postContext[newCheckpointPath] === checkpointDigest, "new checkpoint inventory digest must bind the exact pending checkpoint JSON bytes")
    require(restartCheckpointEvidenceEqual(postContext, final) && restartCheckpointEvidenceEqual(final, parent), "refusals and parent observation must preserve the post-context inventory")
    const persistence = isRecord(one.persistence) ? one.persistence : {}
    require(persistence.analysisInventorySha256 === sourceDriftInventoryHash(Object.fromEntries(Object.entries(pre).filter(([path]) => path.startsWith(".banca/analysis/")))),
      "phase-one analysis inventory digest must bind all historical analysis files")
    for (const [directory, hash] of [["checkpoints", "checkpointSha256"], ["audit-confirmations", "auditConfirmationsSha256"], ["findings", "findingsSha256"]]) {
      const path = `.banca/analysis/${directory}/${one.planId}.json`
      require(maps.every(map => map[path] === persistence[hash]), `historical ${directory} file must remain byte-identical`)
    }
    require(maps.every(map => !Object.hasOwn(map, `.banca/analysis/findings/${after.planId}.json`) && !Object.hasOwn(map, `.banca/analysis/audit-confirmations/${after.planId}.json`)),
      "new plan must have no finding or confirmation store")
    const manuscriptPaths = ["main.tex", "referencias.bib", ...[1, 2, 3, 4, 5].map(index => `capitulos/lote${index}.tex`)]
    const hashes = one.manuscriptHashes
    require(sourceDriftInventoryValid(hashes) && Object.keys(hashes).length === 7 && manuscriptPaths.every(path => hashes[path] === pre[path]),
      "phase-one seven manuscript hashes must bind the pre-mutation inventory")
  }
  require(two.probeExecuted === true && two.workspaceIdentitySha256 === one.workspaceIdentitySha256 && two.planId === after.planId && two.manuscriptFingerprint === after.manuscriptFingerprint,
    "phase two must observe the new canonical plan in the same workspace")
  const expectedCheckpoint = { completedBatches: 0, completedCharacters: 0, state: "pending", nextBatchIndex: 0, nextBatchId: typeof after.firstBatchId === "string" ? after.firstBatchId : null }
  require(restartCheckpointProjectionMatches(two.checkpoint, expectedCheckpoint, after.planId, after.manuscriptFingerprint, 5, 595) && restartStoredCheckpointMatches(two.storedCheckpoint, expectedCheckpoint, after.planId, after.manuscriptFingerprint, 5, 595),
    "new context must remain pending at exactly 0/5 and 0/595 with its first canonical batch")
  require(two.findingsStore === null && two.auditStore === null, "new plan finding and confirmation stores must be absent")
  require(isBatchAuditFindingProjection(one.finding) && restartCheckpointEvidenceEqual(two.oldFindingBefore, one.finding) && restartCheckpointEvidenceEqual(two.oldFindingAfter, one.finding) &&
    Array.isArray(one.completedBatchIds) && restartCheckpointEvidenceEqual(two.oldReceiptIdsBefore, one.completedBatchIds) && restartCheckpointEvidenceEqual(two.oldReceiptIdsAfter, one.completedBatchIds),
    "historical finding and ordered receipt IDs must remain unchanged")
  require(restartAgentIdentityIsVerified(two.agentIdentity) && two.agentIdentity.agentId !== one.agentIdentity?.agentId,
    "phase two must use a distinct verified native auditor Agent/Session")
  require(restartTeardownIsVerified(two.teardown) && two.teardown.teardownFailed === false, "phase two Agent/Session teardown must explicitly succeed")
  require(two.modelCalls === 0 && two.credentialsUsed === false, "source drift must not use a model or credentials")
  const oldBatch = Array.isArray(one.completedBatchIds) ? one.completedBatchIds[1] : undefined
  const expectedRefusals = [
    ["stale-advance", "banca_context", "unknown_batch", "context checkpoint error", `batchId is not part of the plan: ${oldBatch}`],
    ["stale-fingerprint", "banca_auditar", "fingerprint_mismatch", "audit validation error", "manuscriptFingerprint does not match the current plan fingerprint"],
    ["stale-batch", "banca_auditar", "unknown_batch", "audit validation error", `batchId is not present in the plan: ${oldBatch}`],
    ["premature-synthesis", "banca_sintese", "missing_findings", "synthesis input error", "no persisted findings store exists for the current plan"],
  ]
  const expectedInputs = [
    { manuscriptFingerprint: null, batchId: oldBatch, findingId: null, findingsCount: 0 },
    { manuscriptFingerprint: one.manuscriptFingerprint, batchId: oldBatch, findingId: one.finding?.findingId, findingsCount: 1 },
    { manuscriptFingerprint: after.manuscriptFingerprint, batchId: oldBatch, findingId: one.finding?.findingId, findingsCount: 1 },
    { manuscriptFingerprint: null, batchId: null, findingId: null, findingsCount: 0 },
  ]
  const inventoryDigest = sourceDriftInventoryHash(two.inventoryAfterContext)
  require(Array.isArray(two.refusals) && two.refusals.length === 4 && expectedRefusals.every(([kind, toolName, errorCode, header, message], index) => {
    const row = two.refusals[index]
    const result = `${header}\ncode=${errorCode}\nmessage=${message}`
    return isRecord(row) && restartCheckpointEvidenceEqual(row.input, expectedInputs[index]) && row.kind === kind && row.toolName === toolName && row.errorCode === errorCode && row.toolRuntimeIsError === false && row.toolResultValue === result && row.toolMessage === result && row.inventoryBeforeSha256 === inventoryDigest && row.inventoryAfterSha256 === inventoryDigest
  }), "source drift requires four exact ordered non-mutating domain refusals, not ToolRuntime errors")
  return errors
}

const restartPersistenceKeys = [
  "analysisInventorySha256",
  "checkpointSha256",
  "auditConfirmationsSha256",
  "findingsSha256",
] as const

function restartPersistenceMatches(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && restartPersistenceKeys.every((key) =>
    isSha256Digest(left[key]) && left[key] === right[key],
  )
}

function restartCheckpointEvidenceEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => restartCheckpointEvidenceEqual(entry, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && restartCheckpointEvidenceEqual(left[key], right[key]),
  )
}

type RestartCheckpointState = "pending" | "running" | "complete"

function restartExpectedCheckpointState(completedBatches: number, totalBatches: number): RestartCheckpointState | null {
  if (!Number.isInteger(completedBatches) || !Number.isInteger(totalBatches) ||
      totalBatches < 0 || completedBatches < 0 || completedBatches > totalBatches) return null
  if (totalBatches === 0 || completedBatches === totalBatches) return "complete"
  if (completedBatches === 0) return "pending"
  return "running"
}

function incompleteCoverageMessage(state: "pending" | "running"): string {
  return `global synthesis requires checkpoint.state === "complete"; received "${state}"`
}

function incompleteCoverageValue(state: "pending" | "running"): string {
  return [
    "synthesis input error",
    "code=incomplete_coverage",
    `message=${incompleteCoverageMessage(state)}`,
  ].join("\n")
}

function restartSynthesisProbeMatches(
  value: unknown,
  expected: {
    batchIndex: number
    batchId: string
    checkpoint: Record<string, unknown>
    persistedReceiptCount: number
    persistedBatchIds: string[]
    findings: BatchAuditFindingProjectionEvidence[]
  },
  planId: string,
  fingerprint: string,
): boolean {
  if (!isRecord(value)) return false
  const checkpointState = restartExpectedCheckpointState(expected.batchIndex, 5)
  if (checkpointState === null || checkpointState === "complete" ||
      expected.checkpoint.completedBatches !== expected.batchIndex ||
      expected.checkpoint.totalBatches !== 5 || expected.checkpoint.state !== checkpointState) return false
  const expectedRefusalValue = incompleteCoverageValue(checkpointState)
  const expectedErrorMessage = incompleteCoverageMessage(checkpointState)
  const completedCharacters = expected.checkpoint.completedCharacters
  const expectedCheckpoint = {
    completedBatches: expected.batchIndex,
    completedCharacters: Number.isInteger(completedCharacters) ? completedCharacters as number : -1,
    state: checkpointState,
    nextBatchIndex: expected.batchIndex,
    nextBatchId: expected.batchId,
  }
  const beforeCheckpoint = value.checkpointBefore
  const afterCheckpoint = value.checkpointAfter
  const checkpointCoverage = Number.isInteger(completedCharacters)
    ? Math.round((completedCharacters as number / 595) * 10_000) / 100
    : -1
  return value.batchIndex === expected.batchIndex &&
    value.batchId === expected.batchId &&
    value.toolRuntimeIsError === false &&
    value.toolResultValue === expectedRefusalValue &&
    value.toolMessage === expectedRefusalValue &&
    value.errorCode === "incomplete_coverage" &&
    value.errorMessage === expectedErrorMessage &&
    value.rejectionObserved === true &&
    restartStoredCheckpointMatches(beforeCheckpoint, expectedCheckpoint, planId, fingerprint, 5, 595) &&
    restartStoredCheckpointMatches(afterCheckpoint, expectedCheckpoint, planId, fingerprint, 5, 595) &&
    isRecord(beforeCheckpoint) && isRecord(afterCheckpoint) &&
    beforeCheckpoint.coveragePercent === checkpointCoverage &&
    afterCheckpoint.coveragePercent === checkpointCoverage &&
    restartCheckpointEvidenceEqual(beforeCheckpoint, afterCheckpoint) &&
    restartPersistenceMatches(value.persistenceBefore, value.persistenceAfter) &&
    isSha256Digest(value.workspaceInventoryBeforeSha256) &&
    value.workspaceInventoryBeforeSha256 === value.workspaceInventoryAfterSha256 &&
    value.persistedReceiptCountBefore === expected.persistedReceiptCount &&
    value.persistedReceiptCountAfter === expected.persistedReceiptCount &&
    Array.isArray(value.persistedBatchIdsBefore) &&
    JSON.stringify(value.persistedBatchIdsBefore) === JSON.stringify(expected.persistedBatchIds) &&
    Array.isArray(value.persistedBatchIdsAfter) &&
    JSON.stringify(value.persistedBatchIdsAfter) === JSON.stringify(expected.persistedBatchIds) &&
    value.findingCountBefore === expected.findings.length &&
    value.findingCountAfter === expected.findings.length &&
    Array.isArray(value.findingsBefore) &&
    value.findingsBefore.every(isBatchAuditFindingProjection) &&
    JSON.stringify(value.findingsBefore) === JSON.stringify(expected.findings) &&
    Array.isArray(value.findingsAfter) &&
    value.findingsAfter.every(isBatchAuditFindingProjection) &&
    JSON.stringify(value.findingsAfter) === JSON.stringify(expected.findings) &&
    value.persistentStateUnchanged === true
}

// Exact shape of crossProcessCheckpointEvidence projections; property insertion order is irrelevant.
const restartCheckpointProjectionFields = [
  "planId",
  "manuscriptFingerprint",
  "totalBatches",
  "completedBatches",
  "completedCharacters",
  "totalCharacters",
  "coveragePercent",
  "state",
  "nextBatchIndex",
  "nextBatchId",
] as const

const restartStoredCheckpointEvidenceFields = [
  "version",
  "planId",
  "fingerprint",
  "strategy",
  "totalBatches",
  "completedBatches",
  "totalCharacters",
  "completedCharacters",
  "coveragePercent",
  "state",
  "manuscriptFingerprint",
  "nextBatchId",
  "nextBatchIndex",
] as const

function restartCheckpointProjectionMatches(
  value: unknown,
  expected: { completedBatches: number; completedCharacters: number; state: string; nextBatchIndex: number | null; nextBatchId: string | null },
  planId: string,
  fingerprint: string,
  totalBatches: number,
  totalCharacters: number,
): boolean {
  return isRecord(value) &&
    Object.keys(value).length === restartCheckpointProjectionFields.length &&
    restartCheckpointProjectionFields.every((field) => Object.prototype.hasOwnProperty.call(value, field)) &&
    restartCheckpointMatches(value, expected, planId, fingerprint, totalBatches, totalCharacters)
}

function restartStoredCheckpointMatches(
  value: unknown,
  expected: { completedBatches: number; completedCharacters: number; state: string; nextBatchIndex: number | null; nextBatchId: string | null },
  planId: string,
  fingerprint: string,
  totalBatches: number,
  totalCharacters: number,
): boolean {
  return isRecord(value) &&
    Object.keys(value).length === restartStoredCheckpointEvidenceFields.length &&
    restartStoredCheckpointEvidenceFields.every((field) => Object.prototype.hasOwnProperty.call(value, field)) &&
    value.version === "analysis-checkpoint-v2" &&
    value.fingerprint === fingerprint &&
    value.strategy === "ordered-source-spans-exhaustive-v1" &&
    restartCheckpointMatches(value, expected, planId, fingerprint, totalBatches, totalCharacters)
}

// Validate canonical progress values shared by context projections and persisted checkpoint evidence.
function restartCheckpointMatches(
  value: unknown,
  expected: { completedBatches: number; completedCharacters: number; state: string; nextBatchIndex: number | null; nextBatchId: string | null },
  planId: string,
  fingerprint: string,
  totalBatches: number,
  totalCharacters: number,
): boolean {
  const expectedState = restartExpectedCheckpointState(expected.completedBatches, totalBatches)
  const expectedCoveragePercent = Number.isInteger(expected.completedCharacters) &&
      expected.completedCharacters >= 0 && expected.completedCharacters <= totalCharacters && totalCharacters > 0
    ? Math.round((expected.completedCharacters / totalCharacters) * 10_000) / 100
    : -1
  return expectedState !== null && expected.state === expectedState &&
    isRecord(value) &&
    value.planId === planId &&
    value.manuscriptFingerprint === fingerprint &&
    value.totalBatches === totalBatches &&
    value.completedBatches === expected.completedBatches &&
    value.completedCharacters === expected.completedCharacters &&
    value.totalCharacters === totalCharacters &&
    value.coveragePercent === expectedCoveragePercent &&
    value.state === expectedState &&
    value.nextBatchIndex === expected.nextBatchIndex &&
    value.nextBatchId === expected.nextBatchId
}

function restartAgentIdentityIsVerified(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    value.createdVia === "ctx.agents.create" &&
    isSha256Digest(value.agentId) &&
    value.agentId === value.sessionId &&
    value.agentAndSessionIdMatch === true &&
    value.agentRegistryContainsAgent === true &&
    value.sessionStoreContainsSession === true &&
    value.effectivePreset === "banca-auditor" &&
    value.sessionPresetProjection === "banca-auditor" &&
    value.toolRuntime === "ctx.tools.execute" &&
    value.modelCalls === 0
}

function restartTeardownIsVerified(value: unknown): boolean {
  return isRecord(value) &&
    value.disposeCalled === true &&
    value.agentUnregistered === true &&
    value.sessionUnregistered === true &&
    value.teardownFailed !== true
}

/** Validate phase one before the runner is allowed to start a second DSH process. */
export function validateCrossProcessPhaseOneEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ["cross-process phase one evidence is missing"]
  if (value.probeExecuted !== true || value.executionMode !== "cross-process-native-dsh") {
    errors.push("phase one must execute the native DSH process-restart probe")
  }
  if (!isSha256Digest(value.workspaceIdentitySha256) || !isSha256Digest(value.workspaceInventorySha256)) {
    errors.push("phase one must bind the workspace identity and complete persisted inventory")
  }
  if (!isSha256Digest(value.planId) || !isSha256Digest(value.manuscriptFingerprint)) {
    errors.push("phase one plan identity must include SHA-256 plan and manuscript fingerprints")
  }
  if (value.totalBatches !== 5 || value.totalCharacters !== 595) {
    errors.push("phase one must use the canonical 595-character five-batch synthetic project")
  }
  const completedBatchIds = Array.isArray(value.completedBatchIds) ? value.completedBatchIds : []
  const planBatchIdsPrefix = Array.isArray(value.planBatchIdsPrefix) ? value.planBatchIdsPrefix : []
  const completedBatchCharacters = Array.isArray(value.completedBatchCharacters) ? value.completedBatchCharacters : []
  if (completedBatchIds.length !== 2 || completedBatchIds.some((batchId) => typeof batchId !== "string" || batchId.length === 0) || new Set(completedBatchIds).size !== 2) {
    errors.push("phase one must persist exactly two unique ordered batch IDs")
  }
  if (
    planBatchIdsPrefix.length !== 3 ||
    planBatchIdsPrefix.some((batchId) => typeof batchId !== "string" || batchId.length === 0) ||
    new Set(planBatchIdsPrefix).size !== 3 ||
    JSON.stringify(planBatchIdsPrefix.slice(0, 2)) !== JSON.stringify(completedBatchIds)
  ) {
    errors.push("phase one must capture the first three ordered canonical plan batch IDs from context probes")
  }
  if (completedBatchCharacters.length !== 2 || completedBatchCharacters.some((characters) => !Number.isInteger(characters) || (characters as number) <= 0 || (characters as number) > 120)) {
    errors.push("phase one must capture positive canonical character counts for both completed batches")
  }
  const validBatchCharacters = completedBatchCharacters.length === 2 && completedBatchCharacters.every((characters) => Number.isInteger(characters) && (characters as number) > 0 && (characters as number) <= 120)
  const expectedCompletedCharacters = validBatchCharacters
    ? completedBatchCharacters.reduce((sum: number, characters) => sum + (characters as number), 0)
    : -1
  const expectedFirstCoveragePercent = validBatchCharacters
    ? Math.round(((completedBatchCharacters[0] as number) / 595) * 10_000) / 100
    : -1
  const expectedCoveragePercent = validBatchCharacters
    ? Math.round((expectedCompletedCharacters / 595) * 10_000) / 100
    : -1
  const checkpointAfterFirstBatch = isRecord(value.checkpointAfterFirstBatch) ? value.checkpointAfterFirstBatch : undefined
  const checkpoint = isRecord(value.checkpoint) ? value.checkpoint : undefined
  if (
    !restartCheckpointProjectionMatches(checkpointAfterFirstBatch, {
      completedBatches: 1,
      completedCharacters: validBatchCharacters ? completedBatchCharacters[0] as number : -1,
      state: "running",
      nextBatchIndex: 1,
      nextBatchId: typeof planBatchIdsPrefix[1] === "string" ? planBatchIdsPrefix[1] : null,
    }, value.planId as string, value.manuscriptFingerprint as string, 5, 595) ||
    checkpointAfterFirstBatch?.coveragePercent !== expectedFirstCoveragePercent ||
    !restartCheckpointProjectionMatches(checkpoint, {
      completedBatches: 2,
      completedCharacters: expectedCompletedCharacters,
      state: "running",
      nextBatchIndex: 2,
      nextBatchId: typeof planBatchIdsPrefix[2] === "string" ? planBatchIdsPrefix[2] : null,
    }, value.planId as string, value.manuscriptFingerprint as string, 5, 595) ||
    checkpoint?.coveragePercent !== expectedCoveragePercent
  ) {
    errors.push("phase one must leave canonical 1/5 and 2/5 checkpoints matching observed batch characters, coverage, and next plan IDs")
  }
  if (!Array.isArray(value.batchAudits) || value.batchAudits.length !== 2 || value.batchAudits.some((audit, index) =>
    !isRecord(audit) || audit.batchIndex !== index || audit.batchId !== completedBatchIds[index] ||
    audit.acceptedCount !== (index === 1 ? 1 : 0) || audit.persistedFindingCount !== (index === 1 ? 1 : 0)
  )) {
    errors.push("phase one must persist two valid audit receipts with exactly one finding in batch two")
  }
  if (value.persistedReceiptCount !== 2 || !Array.isArray(value.persistedBatchIds) || JSON.stringify(value.persistedBatchIds) !== JSON.stringify(completedBatchIds)) {
    errors.push("phase one durable receipt store must contain exactly the first two ordered batches")
  }
  if (value.unverifiedAdvancesBlocked !== 2 || value.prematureSynthesisBlocked !== true || value.synthesisReleased !== false) {
    errors.push("phase one must fail closed on unaudited progress and incomplete synthesis")
  }
  const synthesisProbes = Array.isArray(value.prematureSynthesisProbes) ? value.prematureSynthesisProbes : []
  const synthesisFinding = value.finding
  const synthesisProbesMatch = synthesisProbes.length === 3 && [0, 1, 2].every((batchIndex) => {
    const batchId = planBatchIdsPrefix[batchIndex]
    const completedCharactersAtProbe = batchIndex === 0
      ? 0
      : validBatchCharacters
        ? completedBatchCharacters.slice(0, batchIndex).reduce((sum: number, characters) => sum + (characters as number), 0)
        : -1
    if (typeof batchId !== "string" || completedCharactersAtProbe < 0) return false
    const expectedCheckpoint = {
      planId: value.planId,
      manuscriptFingerprint: value.manuscriptFingerprint,
      totalBatches: 5,
      completedBatches: batchIndex,
      completedCharacters: completedCharactersAtProbe,
      totalCharacters: 595,
      coveragePercent: Math.round((completedCharactersAtProbe / 595) * 10_000) / 100,
      state: batchIndex === 0 ? "pending" : "running",
      nextBatchIndex: batchIndex,
      nextBatchId: batchId,
    }
    const receiptCount = Math.min(batchIndex + 1, 2)
    const expectedFindings = batchIndex === 0 || !isBatchAuditFindingProjection(synthesisFinding)
      ? []
      : [synthesisFinding]
    return restartSynthesisProbeMatches(synthesisProbes[batchIndex], {
      batchIndex,
      batchId,
      checkpoint: expectedCheckpoint,
      persistedReceiptCount: receiptCount,
      persistedBatchIds: completedBatchIds.slice(0, receiptCount),
      findings: expectedFindings,
    }, value.planId as string, value.manuscriptFingerprint as string)
  })
  if (!synthesisProbesMatch) {
    errors.push("phase one must observe exact incomplete_coverage domain refusals without persistent-state mutation")
  }
  const persistence = value.persistence
  if (!isRecord(persistence) || restartPersistenceKeys.some((key) => !isSha256Digest(persistence[key]))) {
    errors.push("phase one must capture durable checkpoint, audit, finding, and inventory hashes")
  }
  const finding = value.finding
  if (value.findingCount !== 1 || !isBatchAuditFindingProjection(finding) || finding.planId !== value.planId || finding.manuscriptFingerprint !== value.manuscriptFingerprint || finding.batchId !== completedBatchIds[1]) {
    errors.push("phase one must persist exactly one plan-backed finding in batch two")
  }
  if (!restartAgentIdentityIsVerified(value.agentIdentity)) errors.push("phase one must use a live native banca-auditor Agent/Session")
  if (!restartTeardownIsVerified(value.teardown)) errors.push("phase one Agent/Session must be disposed before its DSH process exits")
  return errors
}

/**
 * Validate the second, cross-process vertical without weakening #44/#98/#100's
 * existing same-process batch-audit contract. Host process identities are HMAC
 * digests computed from child_process.spawn PID plus Linux procfs start identity;
 * fixture values are never host observations.
 */
function validateCrossProcessBatchAuditEvidenceCore(value: unknown, firstProcessAbrupt = false): string[] {
  const errors: string[] = []
  if (!isRecord(value)) return ["cross-process batch audit evidence is missing"]
  const expectedExecutionMode = firstProcessAbrupt ? "abrupt-restart-native-dsh" : "cross-process-native-dsh"
  if (value.probeExecuted !== true || value.executionMode !== expectedExecutionMode) {
    errors.push(firstProcessAbrupt
      ? "abrupt restart must use the native DSH durable-checkpoint probe"
      : "cross-process batch audit probe must execute through two native DSH processes")
  }
  if (value.syntheticProcessFixture !== false) {
    errors.push("synthetic process fixtures are not sufficient host process evidence")
  }

  const workspace = isRecord(value.workspace) ? value.workspace : undefined
  if (
    workspace?.sameWorkspace !== true ||
    workspace.preservedBetweenProcesses !== true ||
    workspace.resetBetweenProcesses !== false ||
    !isSha256Digest(workspace.identitySha256) ||
    !isSha256Digest(workspace.firstProcessEndFilesystemIdentitySha256) ||
    workspace.firstProcessEndFilesystemIdentitySha256 !== workspace.identitySha256 ||
    !isSha256Digest(workspace.secondProcessStartFilesystemIdentitySha256) ||
    workspace.secondProcessStartFilesystemIdentitySha256 !== workspace.identitySha256 ||
    !isSha256Digest(workspace.secondProcessEndFilesystemIdentitySha256) ||
    workspace.secondProcessEndFilesystemIdentitySha256 !== workspace.identitySha256 ||
    !isSha256Digest(workspace.firstProcessEndInventorySha256) ||
    !isSha256Digest(workspace.secondProcessStartInventorySha256) ||
    workspace.firstProcessEndInventorySha256 !== workspace.secondProcessStartInventorySha256
  ) {
    errors.push("the same persisted synthetic workspace must be retained without reset between processes")
  }

  const processBoundary = isRecord(value.processBoundary) ? value.processBoundary : undefined
  if (processBoundary?.observationSource !== "child_process.spawn+linux-procfs") {
    errors.push("process identity must come from host spawn and kernel process-start observations")
  }
  const processRows = [processBoundary?.first, processBoundary?.second]
  for (const [index, row] of processRows.entries()) {
    const label = index === 0 ? "first" : "second"
    if (
      !isRecord(row) ||
      !isSha256Digest(row.dshExecutableSha256) ||
      !isSha256Digest(row.profileIdentitySha256) ||
      !isSha256Digest(row.hostIdentitySha256) ||
      !isSha256Digest(row.observerIdentitySha256) ||
      row.identityMatched !== true ||
      row.hostIdentitySha256 !== row.observerIdentitySha256 ||
      row.spawnObserved !== true ||
      row.kernelStartIdentityObserved !== true
    ) {
      errors.push(`${label} DSH process identity is not corroborated by host spawn and kernel observations`)
    }
    if (firstProcessAbrupt && index === 0) {
      if (
        !isRecord(row) ||
        row.exitObserved !== true ||
        row.exitCode !== null ||
        row.signal !== "SIGKILL" ||
        row.timedOut !== false ||
        row.forcedTermination !== true ||
        row.naturalBeforeExitObserved !== false ||
        row.nativeTeardownMarkerObserved !== false ||
        row.runnerOwnedChild !== true ||
        row.childIdentityRevalidatedBeforeSignal !== true ||
        row.parentBarrierArmed !== true ||
        row.killRequestedByParent !== true ||
        row.killSignalRequested !== "SIGKILL" ||
        row.targetAbsentAfterClose !== true ||
        row.processGroupAbsentAfterClose !== true ||
        Object.prototype.hasOwnProperty.call(row, "pid") ||
        Object.prototype.hasOwnProperty.call(row, "processId")
      ) {
        errors.push("first DSH process must wait behind the parent barrier and be directly SIGKILLed after identity revalidation, with no surviving target or runner-owned process group")
      }
    } else if (firstProcessAbrupt && index === 1) {
      if (
        !isRecord(row) ||
        row.runnerOwnedChild !== true ||
        row.controlCompleted !== true ||
        row.controlFailed !== false ||
        row.exitObserved !== true ||
        row.exitCode !== 0 ||
        row.signal !== null ||
        row.timedOut !== false ||
        row.forcedTermination !== false ||
        row.naturalBeforeExitObserved !== true ||
        row.nativeTeardownMarkerObserved !== true
      ) {
        errors.push("recovery DSH process must be an independently owned child with validated startup and timeout control")
      }
    } else if (
      !isRecord(row) ||
      row.exitObserved !== true ||
      row.exitCode !== 0 ||
      row.signal !== null ||
      row.timedOut !== false ||
      row.forcedTermination !== false ||
      row.naturalBeforeExitObserved !== true ||
      row.nativeTeardownMarkerObserved !== true
    ) {
      errors.push(`${label} DSH process did not complete graceful teardown with exit code zero`)
    }
  }
  if (
    processBoundary?.secondStartedAfterFirstExit !== true ||
    processBoundary.processesDidNotOverlap !== true ||
    !isRecord(processBoundary.first) ||
    !isRecord(processBoundary.second) ||
    processBoundary.first.hostIdentitySha256 === processBoundary.second.hostIdentitySha256 ||
    processBoundary.first.dshExecutableSha256 !== processBoundary.second.dshExecutableSha256 ||
    processBoundary.first.profileIdentitySha256 !== processBoundary.second.profileIdentitySha256
  ) {
    errors.push("two distinct sequential DSH process instances must be observed; a reused process is rejected")
  }

  const totalBatches = value.totalBatches === 5 ? 5 : 0
  const totalCharacters = value.totalCharacters === 595 ? 595 : 0
  if (totalBatches !== 5 || totalCharacters !== 595) {
    errors.push("cross-process recovery must use the canonical 595-character five-batch synthetic project")
  }
  if (!isSha256Digest(value.planId)) errors.push("cross-process planId must be a SHA-256 identity")
  if (!isSha256Digest(value.manuscriptFingerprint)) errors.push("cross-process manuscript fingerprint must be a SHA-256 digest")
  const planBatchIds = Array.isArray(value.planBatchIds) ? value.planBatchIds : []
  if (
    planBatchIds.length !== totalBatches ||
    planBatchIds.some((batchId) => typeof batchId !== "string" || batchId.length === 0) ||
    new Set(planBatchIds).size !== planBatchIds.length
  ) {
    errors.push("cross-process plan batch IDs must be complete, unique, and ordered")
  }

  const phaseOne = isRecord(value.phaseOne) ? value.phaseOne : undefined
  const phaseTwo = isRecord(value.phaseTwo) ? value.phaseTwo : undefined
  for (const phaseOneError of validateCrossProcessPhaseOneEvidence(phaseOne)) {
    errors.push(`phase-one evidence: ${phaseOneError}`)
  }
  const expectedPlanId = value.planId
  const expectedFingerprint = value.manuscriptFingerprint
  const firstNextBatchId = typeof planBatchIds[2] === "string" ? planBatchIds[2] : null
  const phaseOneCheckpoint = isRecord(phaseOne?.checkpoint) ? phaseOne.checkpoint : undefined
  const firstCompletedCharacters = phaseOneCheckpoint?.completedCharacters
  const firstCoveragePercent = Number.isInteger(firstCompletedCharacters)
    ? Math.round((firstCompletedCharacters / totalCharacters) * 10_000) / 100
    : -1
  if (
    !Number.isInteger(firstCompletedCharacters) ||
    firstCompletedCharacters <= 0 ||
    firstCompletedCharacters >= totalCharacters ||
    phaseOneCheckpoint?.coveragePercent !== firstCoveragePercent ||
    !restartCheckpointProjectionMatches(phaseOneCheckpoint, {
      completedBatches: 2,
      completedCharacters: Number.isInteger(firstCompletedCharacters) ? firstCompletedCharacters as number : -1,
      state: "running",
      nextBatchIndex: 2,
      nextBatchId: firstNextBatchId,
    }, expectedPlanId as string, expectedFingerprint as string, totalBatches, totalCharacters)
  ) {
    errors.push("first process must leave an unreset checkpoint at exactly 2/5 matching its canonical character coverage and next batch ID")
  }
  if (
    !Array.isArray(phaseOne?.completedBatchIds) ||
    JSON.stringify(phaseOne.completedBatchIds) !== JSON.stringify(planBatchIds.slice(0, 2))
  ) {
    errors.push("first process must complete exactly the first two plan batches")
  }
  if (!Array.isArray(phaseOne?.planBatchIdsPrefix) || JSON.stringify(phaseOne.planBatchIdsPrefix) !== JSON.stringify(planBatchIds.slice(0, 3))) {
    errors.push("first process observed plan prefix must match synthesis batch IDs across the restart boundary")
  }
  if (!Array.isArray(phaseOne?.batchAudits) || phaseOne.batchAudits.length !== 2 || phaseOne.batchAudits.some((audit, index) =>
    !isRecord(audit) ||
    audit.batchIndex !== index ||
    audit.batchId !== planBatchIds[index] ||
    audit.acceptedCount !== (index === 1 ? 1 : 0) ||
    audit.persistedFindingCount !== (index === 1 ? 1 : 0)
  )) {
    errors.push("first process receipts must preserve the single finding in batch 2 and no finding in batch 1")
  }
  if (
    phaseOne?.findingCount !== 1 ||
    phaseOne.prematureSynthesisBlocked !== true ||
    phaseOne.synthesisReleased !== false
  ) {
    errors.push("first process must preserve one finding and must not release incomplete synthesis")
  }
  if (
    phaseOne?.persistedReceiptCount !== 2 ||
    !Array.isArray(phaseOne?.persistedBatchIds) ||
    JSON.stringify(phaseOne.persistedBatchIds) !== JSON.stringify(planBatchIds.slice(0, 2))
  ) {
    errors.push("first process must durably persist exactly two ordered audit receipts")
  }
  if (phaseOne?.unverifiedAdvancesBlocked !== 2) {
    errors.push("first process must fail closed on both unaudited advancement attempts")
  }
  if (
    !isSha256Digest(phaseOne?.workspaceInventorySha256) ||
    phaseOne.workspaceInventorySha256 !== workspace?.firstProcessEndInventorySha256
  ) {
    errors.push("first-process synthetic workspace inventory must match the parent-observed post-exit workspace")
  }
  if (phaseOne?.workspaceIdentitySha256 !== workspace?.identitySha256) {
    errors.push("first process workspace identity must be bound to the same host-observed directory inode")
  }
  const phaseOnePersistence = phaseOne?.persistence
  if (
    !isRecord(phaseOnePersistence) ||
    restartPersistenceKeys.some((key) => !isSha256Digest(phaseOnePersistence[key]))
  ) {
    errors.push("first process must observe durable checkpoint, receipt, finding, and analysis inventory hashes")
  }

  if (!restartAgentIdentityIsVerified(phaseOne?.agentIdentity)) {
    errors.push("first process Agent/Session identity must be verified by DSH registries and banca-auditor projection")
  }
  if (!restartTeardownIsVerified(phaseOne?.teardown)) {
    errors.push("first process Agent and Session teardown must be complete before process exit")
  }

  const resumeQuery = isRecord(phaseTwo?.resumeQuery) ? phaseTwo.resumeQuery : undefined
  if (phaseTwo?.workspaceIdentitySha256 !== workspace?.identitySha256) {
    errors.push("second process must resume the same host-observed workspace directory inode")
  }
  if (resumeQuery?.completedBatchIdProvided !== false) {
    errors.push("second process must query banca_context without completedBatchId")
  }
  if (
    resumeQuery?.persistedReceiptCount !== 2 ||
    !Array.isArray(resumeQuery?.persistedBatchIds) ||
    JSON.stringify(resumeQuery.persistedBatchIds) !== JSON.stringify(planBatchIds.slice(0, 2))
  ) {
    errors.push("second process must recover the first two persisted audit receipts before advancing")
  }
  if (
    !isSha256Digest(phaseTwo?.workspaceInventoryBeforeResumeSha256) ||
    phaseTwo.workspaceInventoryBeforeResumeSha256 !== workspace?.secondProcessStartInventorySha256
  ) {
    errors.push("second-process workspace inventory must match the parent-observed restart boundary")
  }
  if (!isSha256Digest(phaseTwo?.workspaceInventoryAfterResumeQuerySha256)) {
    errors.push("second-process post-query workspace inventory must be captured before unaudited-advance probes")
  }
  if (!restartCheckpointProjectionMatches(resumeQuery?.checkpointBefore, {
    completedBatches: 2,
    completedCharacters: Number.isInteger(firstCompletedCharacters) ? firstCompletedCharacters as number : -1,
    state: "running",
    nextBatchIndex: 2,
    nextBatchId: firstNextBatchId,
  }, expectedPlanId as string, expectedFingerprint as string, totalBatches, totalCharacters)) {
    errors.push("second process must recover the exact 2/5 checkpoint and identical plan/fingerprint")
  }
  if (!restartCheckpointProjectionMatches(resumeQuery?.checkpointAfter, {
    completedBatches: 2,
    completedCharacters: Number.isInteger(firstCompletedCharacters) ? firstCompletedCharacters as number : -1,
    state: "running",
    nextBatchIndex: 2,
    nextBatchId: firstNextBatchId,
  }, expectedPlanId as string, expectedFingerprint as string, totalBatches, totalCharacters)) {
    errors.push("resume-only banca_context query must leave checkpoint and next batch unchanged")
  }
  if (
    !restartPersistenceMatches(phaseOnePersistence, resumeQuery?.persistenceBefore) ||
    !restartPersistenceMatches(resumeQuery?.persistenceBefore, resumeQuery?.persistenceAfter)
  ) {
    errors.push("cross-process persistent hashes must match and remain unchanged across resume-only context query")
  }

  const unverifiedAdvanceProbes = Array.isArray(phaseTwo?.unverifiedAdvanceProbes)
    ? phaseTwo.unverifiedAdvanceProbes
    : []
  if (phaseTwo?.unverifiedAdvancesBlocked !== 3 || unverifiedAdvanceProbes.length !== 3) {
    errors.push("second process must reject unaudited advancement for all three remaining batches before auditing")
  }
  let previousUnverifiedCheckpointCharacters = firstCompletedCharacters
  for (let probeIndex = 0; probeIndex < 3; probeIndex++) {
    const batchIndex = probeIndex + 2
    const expectedBatchId = planBatchIds[batchIndex]
    const probe = unverifiedAdvanceProbes[probeIndex]
    if (!isRecord(probe)) {
      errors.push(`second process must record a missing_batch_audit rejection before auditing batch ${batchIndex + 1}`)
      continue
    }
    const expectedRejectionValue = [
      "context checkpoint error",
      "code=missing_batch_audit",
      `message=cannot advance checkpoint: audit confirmation missing for batch ${expectedBatchId}`,
    ].join("\n")
    if (
      probe.batchIndex !== batchIndex ||
      probe.batchId !== expectedBatchId ||
      probe.toolRuntimeIsError !== false ||
      probe.toolResultValue !== expectedRejectionValue ||
      probe.errorCode !== "missing_batch_audit" ||
      probe.rejectionObserved !== true
    ) {
      errors.push(`second process must observe the exact missing_batch_audit application refusal in a successful ToolRuntime value for unaudited batch ${batchIndex + 1}`)
    }

    const checkpointBefore = isRecord(probe.checkpointBefore) ? probe.checkpointBefore : undefined
    const checkpointAfter = isRecord(probe.checkpointAfter) ? probe.checkpointAfter : undefined
    const completedCharacters = checkpointBefore?.completedCharacters
    const checkpointCoverage = Number.isInteger(completedCharacters)
      ? Math.round((completedCharacters as number / totalCharacters) * 10000) / 100
      : -1
    const checkpointExpected = {
      completedBatches: batchIndex,
      completedCharacters: Number.isInteger(completedCharacters) ? completedCharacters as number : -1,
      state: "running",
      nextBatchIndex: batchIndex,
      nextBatchId: expectedBatchId,
    }
    if (
      !restartStoredCheckpointMatches(checkpointBefore, checkpointExpected, expectedPlanId as string, expectedFingerprint as string, totalBatches, totalCharacters) ||
      checkpointBefore?.coveragePercent !== checkpointCoverage ||
      !restartStoredCheckpointMatches(checkpointAfter, checkpointExpected, expectedPlanId as string, expectedFingerprint as string, totalBatches, totalCharacters) ||
      checkpointAfter?.coveragePercent !== checkpointCoverage ||
      !restartCheckpointEvidenceEqual(checkpointBefore, checkpointAfter) ||
      !Number.isInteger(completedCharacters) ||
      (completedCharacters as number) < 0 ||
      (completedCharacters as number) >= totalCharacters ||
      (probeIndex === 0 && completedCharacters !== firstCompletedCharacters) ||
      (probeIndex > 0 && (completedCharacters as number) <= previousUnverifiedCheckpointCharacters)
    ) {
      errors.push(`unaudited advance probe for batch ${batchIndex + 1} must preserve the current ordered checkpoint`)
    }
    if (Number.isInteger(completedCharacters)) previousUnverifiedCheckpointCharacters = completedCharacters as number

    if (probeIndex === 0 && probe.workspaceInventoryBeforeSha256 !== phaseTwo?.workspaceInventoryAfterResumeQuerySha256) {
      errors.push("first unaudited-advance probe must start from the captured post-resume workspace inventory")
    }
    const expectedPriorBatchIds = planBatchIds.slice(0, batchIndex)
    if (
      !restartPersistenceMatches(probe.persistenceBefore, probe.persistenceAfter) ||
      (probeIndex === 0 && (
        !restartPersistenceMatches(phaseOnePersistence, probe.persistenceBefore) ||
        !restartPersistenceMatches(resumeQuery?.persistenceAfter, probe.persistenceBefore)
      )) ||
      !isSha256Digest(probe.workspaceInventoryBeforeSha256) ||
      probe.workspaceInventoryBeforeSha256 !== probe.workspaceInventoryAfterSha256 ||
      probe.persistedReceiptCountBefore !== batchIndex ||
      probe.persistedReceiptCountAfter !== batchIndex ||
      !Array.isArray(probe.persistedBatchIdsBefore) ||
      JSON.stringify(probe.persistedBatchIdsBefore) !== JSON.stringify(expectedPriorBatchIds) ||
      !Array.isArray(probe.persistedBatchIdsAfter) ||
      JSON.stringify(probe.persistedBatchIdsAfter) !== JSON.stringify(expectedPriorBatchIds) ||
      !Array.isArray(probe.findingsBefore) ||
      !probe.findingsBefore.every(isBatchAuditFindingProjection) ||
      probe.findingCountBefore !== 1 ||
      probe.findingCountAfter !== 1 ||
      !Array.isArray(probe.findingsAfter) ||
      !probe.findingsAfter.every(isBatchAuditFindingProjection) ||
      JSON.stringify(probe.findingsBefore) !== JSON.stringify(probe.findingsAfter) ||
      JSON.stringify(probe.findingsBefore) !== JSON.stringify([phaseOne?.finding]) ||
      probe.persistentStateUnchanged !== true
    ) {
      errors.push(`second process must prove batch ${batchIndex + 1} rejection left checkpoint, confirmations, findings, and inventory unchanged`)
    }
  }

  const synthesisProbes = Array.isArray(phaseTwo?.prematureSynthesisProbes) ? phaseTwo.prematureSynthesisProbes : []
  if (phaseTwo?.prematureSynthesisBlocked !== true || synthesisProbes.length !== 3) {
    errors.push("second process must reject incomplete synthesis for all three remaining batches")
  }
  let synthesisProbesMatch = synthesisProbes.length === 3
  for (let probeIndex = 0; probeIndex < 3; probeIndex++) {
    const batchIndex = probeIndex + 2
    const expectedBatchId = planBatchIds[batchIndex]
    const synthesisProbe = synthesisProbes[probeIndex]
    const advanceProbe = unverifiedAdvanceProbes[probeIndex]
    const expectedCheckpoint = isRecord(advanceProbe) && isRecord(advanceProbe.checkpointAfter)
      ? advanceProbe.checkpointAfter
      : {}
    const expectedFindings = isBatchAuditFindingProjection(phaseOne?.finding) ? [phaseOne.finding] : []
    // The synthesis probe validates the complete persisted checkpoint evidence against this advance snapshot.
    const matches = typeof expectedBatchId === "string" && isRecord(advanceProbe) &&
      restartSynthesisProbeMatches(synthesisProbe, {
        batchIndex,
        batchId: expectedBatchId,
        checkpoint: expectedCheckpoint,
        persistedReceiptCount: batchIndex,
        persistedBatchIds: planBatchIds.slice(0, batchIndex),
        findings: expectedFindings,
      }, expectedPlanId as string, expectedFingerprint as string) &&
      restartPersistenceMatches(advanceProbe.persistenceAfter, (synthesisProbe as Record<string, unknown> | undefined)?.persistenceBefore) &&
      advanceProbe.workspaceInventoryAfterSha256 === (synthesisProbe as Record<string, unknown> | undefined)?.workspaceInventoryBeforeSha256 &&
      JSON.stringify(advanceProbe.persistedBatchIdsAfter) === JSON.stringify((synthesisProbe as Record<string, unknown> | undefined)?.persistedBatchIdsBefore) &&
      JSON.stringify(advanceProbe.findingsAfter) === JSON.stringify((synthesisProbe as Record<string, unknown> | undefined)?.findingsBefore)
    if (!matches) synthesisProbesMatch = false
  }
  if (!synthesisProbesMatch) {
    errors.push("second process must observe exact incomplete_coverage domain refusals without persistent-state mutation")
  }

  if (!restartAgentIdentityIsVerified(phaseTwo?.agentIdentity)) {
    errors.push("second process must create and verify a new native banca-auditor Agent/Session")
  } else if (
    restartAgentIdentityIsVerified(phaseOne?.agentIdentity) &&
    phaseTwo.agentIdentity.agentId === phaseOne.agentIdentity.agentId
  ) {
    errors.push("second process must use an Agent/Session identity distinct from the first process")
  }
  if (!restartTeardownIsVerified(phaseTwo?.teardown)) {
    errors.push("second process Agent and Session teardown must complete without errors")
  }
  if (
    !Array.isArray(phaseTwo?.completedBatchIds) ||
    JSON.stringify(phaseTwo.completedBatchIds) !== JSON.stringify(planBatchIds.slice(2))
  ) {
    errors.push("second process must complete exactly the remaining three batches in plan order")
  }
  if (!Array.isArray(phaseTwo?.batchAudits) || phaseTwo.batchAudits.length !== 3 || phaseTwo.batchAudits.some((audit, index) =>
    !isRecord(audit) ||
    audit.batchIndex !== index + 2 ||
    audit.batchId !== planBatchIds[index + 2] ||
    audit.acceptedCount !== 0 ||
    audit.persistedFindingCount !== 1
  )) {
    errors.push("second process receipts must complete batches 3-5 without adding or duplicating findings")
  }
  if (
    phaseTwo?.persistedReceiptCount !== 5 ||
    !Array.isArray(phaseTwo?.persistedBatchIds) ||
    JSON.stringify(phaseTwo.persistedBatchIds) !== JSON.stringify(planBatchIds)
  ) {
    errors.push("final durable audit store must contain exactly one ordered receipt per canonical batch")
  }
  if (!restartCheckpointProjectionMatches(phaseTwo?.finalCheckpoint, {
    completedBatches: 5,
    completedCharacters: totalCharacters,
    state: "complete",
    nextBatchIndex: null,
    nextBatchId: null,
  }, expectedPlanId as string, expectedFingerprint as string, totalBatches, totalCharacters)) {
    errors.push("second process must finish the same plan at exactly 5/5 complete coverage")
  }
  const synthesis = isRecord(phaseTwo?.synthesis) ? phaseTwo.synthesis : undefined
  if (
    synthesis?.state !== "complete" ||
    synthesis.totalBatches !== totalBatches ||
    synthesis.completedBatches !== totalBatches ||
    synthesis.totalCharacters !== totalCharacters ||
    synthesis.completedCharacters !== totalCharacters ||
    synthesis.coveragePercent !== 100 ||
    synthesis.findingsCount !== 1 ||
    !Array.isArray(synthesis.orderedBatchIds) ||
    JSON.stringify(synthesis.orderedBatchIds) !== JSON.stringify(planBatchIds)
  ) {
    errors.push("final synthesis input must contain complete ordered coverage and exactly one finding")
  }
  if (phaseTwo?.manuscriptPreserved !== true) errors.push("cross-process analysis must preserve the synthetic manuscript")

  const firstFinding = phaseOne?.finding
  const recoveredFinding = resumeQuery?.recoveredFinding
  const synthesisFinding = synthesis?.finding
  const findingProjections = [firstFinding, recoveredFinding, synthesisFinding]
  if (
    phaseOne?.findingCount !== 1 ||
    resumeQuery?.recoveredFindingCount !== 1 ||
    synthesis?.findingsCount !== 1 ||
    !findingProjections.every(isBatchAuditFindingProjection)
  ) {
    errors.push("the original non-empty finding must remain present exactly once in storage and synthesis")
  } else {
    const expectedFinding = firstFinding as BatchAuditFindingProjectionEvidence
    if (
      expectedFinding.planId !== expectedPlanId ||
      expectedFinding.manuscriptFingerprint !== expectedFingerprint ||
      expectedFinding.batchId !== planBatchIds[1] ||
      !findingProjections.slice(1).every((finding) =>
        batchAuditFindingProjectionsEqual(expectedFinding, finding as BatchAuditFindingProjectionEvidence),
      )
    ) {
      errors.push("first-process finding identity and provenance must be unchanged after restart and in synthesis")
    }
  }
  return errors
}

export function validateCrossProcessBatchAuditEvidence(value: unknown): string[] {
  return validateCrossProcessBatchAuditEvidenceCore(value)
}

export function classifyCrossProcessBatchAuditEvidenceStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.probeExecuted === undefined) return "BLOCKED"
  return validateCrossProcessBatchAuditEvidence(value).length === 0 ? "PASS" : "FAIL"
}

/** Validate the distinct #107 abrupt-child boundary plus the full #103 recovery payload. */
export function validateAbruptRestartEvidence(value: unknown): string[] {
  const errors = validateCrossProcessBatchAuditEvidenceCore(value, true)
  if (!isRecord(value)) return errors
  const require = (condition: boolean, message: string) => { if (!condition) errors.push(message) }
  const phaseOne = isRecord(value.phaseOne) ? value.phaseOne : undefined
  const parent = isRecord(value.parentVerifiedPersistence) ? value.parentVerifiedPersistence : undefined
  const parentHashes = parent?.persistence
  require(
    parent?.source === "parent-read-persisted-files" &&
      parent.verifiedBeforeSignal === true &&
      parent.checkpointFileParsed === true &&
      parent.receiptFileParsed === true &&
      parent.findingFileParsed === true,
    "the parent must independently read and validate the persisted checkpoint, receipt, and finding files before signaling",
  )
  require(
    isSha256Digest(parent?.workspaceInventorySha256) &&
      parent.workspaceInventorySha256 === phaseOne?.workspaceInventorySha256 &&
      parent.workspaceInventorySha256 === (isRecord(value.workspace) ? value.workspace.firstProcessEndInventorySha256 : undefined),
    "parent-verified workspace inventory must match the durable phase-one boundary",
  )
  require(
    restartPersistenceMatches(parentHashes, phaseOne?.persistence),
    "parent-read checkpoint, receipt, finding, and analysis hashes must match phase one",
  )
  require(
    restartCheckpointEvidenceEqual(parent?.checkpoint, phaseOne?.checkpoint),
    "parent-parsed checkpoint must equal the exact phase-one 2/5 projection",
  )
  const receiptBatchIds = Array.isArray(parent?.receiptBatchIds) ? parent.receiptBatchIds : []
  require(
    parent?.receiptCount === 2 &&
      receiptBatchIds.length === 2 &&
      receiptBatchIds.every((batchId) => typeof batchId === "string" && batchId.length > 0) &&
      new Set(receiptBatchIds).size === 2 &&
      JSON.stringify(receiptBatchIds) === JSON.stringify(phaseOne?.persistedBatchIds),
    "parent-parsed receipts must contain exactly the two unique ordered phase-one batch IDs",
  )
  const parentFinding = parent?.finding
  const phaseOneFinding = phaseOne?.finding
  require(
    parent?.findingsCount === 1 &&
      isBatchAuditFindingProjection(parentFinding) &&
      isBatchAuditFindingProjection(phaseOneFinding) &&
      batchAuditFindingProjectionsEqual(parentFinding, phaseOneFinding),
    "parent-parsed findings must contain the original valid finding exactly once",
  )
  const teardown = isRecord(value.teardown) ? value.teardown : undefined
  require(
    teardown?.firstExitObserved === true &&
      teardown.firstCloseObserved === true &&
      teardown.firstTargetAbsentAfterClose === true &&
      teardown.firstProcessGroupAbsentAfterClose === true &&
      teardown.secondExitObserved === true &&
      teardown.secondCloseObserved === true &&
      teardown.secondAgentSessionDisposed === true &&
      teardown.teardownFailed === false,
    "abrupt DSH child and runner-owned process group, independent recovery child, Agent/Session, and teardown must all be observed without survivors",
  )
  return errors
}

export function classifyAbruptRestartEvidenceStatus(value: unknown): ProfileGateStatus {
  if (!isRecord(value) || value.probeExecuted !== true) return "BLOCKED"
  return validateAbruptRestartEvidence(value).length === 0 ? "PASS" : "FAIL"
}

export interface QuestionBehaviorEvidence {
  questionId: string
  prompt: string
  validOptions: string[]
  observedAnswer: {
    id: string
    selected: string[]
    custom?: string
  }
  isRecommendation?: boolean
  mutationAuthorized: boolean
}

export interface CustomQuestionBehaviorEvidence {
  questionId: string
  prompt: string
  validOptions?: string[]
  observedAnswer: {
    id: string
    selected?: string[]
    custom: string
  }
  mutationAuthorized: boolean
}

export interface ObservedApprovalDecision {
  requestId: string
  agentId: string
  sessionId: string
  toolName: string
  turnSeq: number
  askedSeq?: number
  decidedSeq?: number
  outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable"
  auditEvents: {
    askedEventLogged: boolean
    decidedEventLogged: boolean
  }
  turnBoundaries?: {
    turnStartSeq: number
    turnEndSeq: number
    isEnclosed: boolean
  }
  unansweredByProvider?: boolean
}

export interface ApprovalTurnIntegrityEvidence {
  singleTurnClosed: boolean
  turnStartSeq: number
  turnEndSeq: number
}

export interface SelectionMutationEvidence {
  nonMutatingProof?: boolean
  sessionAuditAvailable: boolean
  sessionEventsRead: number
  approvalEventsCount: number
  sessionAuditError?: string
  noApprovalEmitted: boolean
  mutationDispatched: boolean
  manuscriptPreserved: boolean
  auditorGuardUsedAsProof?: boolean
  attemptedTool?: string
}

export interface NativeQuestionsBehaviorsEvidence {
  selectRecommendation: QuestionBehaviorEvidence
  requestMoreEvidence: QuestionBehaviorEvidence
  deferDecision: QuestionBehaviorEvidence
  customResponse: CustomQuestionBehaviorEvidence
  cancelQuestion: {
    questionId: string
    prompt?: string
    cancelled: boolean
    errorCode: string
  }
  rejectIncompatibleAnswer: {
    rejected: boolean
    errorCode: string
  }
  delegatedAgentBlocked: {
    callingAgentOrigin?: string
    isOwnedByParent?: boolean
    notInRoots?: boolean
    blocked: boolean
    errorCode: string
    answererReached?: boolean
  }
  selectionDoesNotAuthorizeMutation: SelectionMutationEvidence
}

export interface IndependentApprovalEvidence {
  status: "PASS" | "BLOCKED" | "FAIL"
  openTurnRequiredObserved?: boolean
  openTurnErrorMessage?: string
  interactiveDecisionsStatus?: "BLOCKED" | "NOT_EVALUATED" | "PASS" | "FAIL"
  interactiveDecisionsBlocker?: string
  observedDecisions?: ObservedApprovalDecision[]
  allowedOnceIsSoleGrant?: boolean
  nonGrantsDeny?: {
    rejectedDenies: boolean
    cancelledDenies: boolean
    unavailableDenies: boolean
  }
  contractVerified?: boolean
  turnIntegrity?: ApprovalTurnIntegrityEvidence
  unavailableProvedByAbsenceOfProvider?: boolean
  syntheticAnswererInterceptedUnavailable?: boolean
}

export interface NativeQuestionsEvidence {
  hostApiAvailable: boolean
  userQuestionsServiceAvailable: boolean
  approvalServiceAvailable: boolean
  syntheticScenarioCompleted: boolean
  behaviors: NativeQuestionsBehaviorsEvidence
  independentApproval: IndependentApprovalEvidence
  uiWebDisclaimer: string
  modelExecutionUsed: boolean
}

/**
 * Validate proof that native DSH user-questions and independent approval contracts
 * were exercised, proving that option selection does not grant mutation authorization.
 */
export function validateNativeQuestionsEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ["native questions evidence gate lacks required host verification"]
  }
  if (value.hostApiAvailable !== true) {
    errors.push("native questions host API was not available")
  }
  if (value.userQuestionsServiceAvailable !== true) {
    errors.push("ctx.userQuestions service is unavailable on host")
  }
  if (value.approvalServiceAvailable !== true) {
    errors.push("ctx.approval service is unavailable on host")
  }
  if (value.syntheticScenarioCompleted !== true) {
    errors.push("synthetic academic question scenario was not completed")
  }

  const behaviors = isRecord(value.behaviors) ? value.behaviors : undefined
  if (!behaviors) {
    errors.push("native questions behaviors object is missing")
    return errors
  }

  // 1. selectRecommendation
  const b1 = isRecord(behaviors.selectRecommendation) ? behaviors.selectRecommendation : undefined
  if (!b1) {
    errors.push("selectRecommendation behavior is required and missing")
  } else {
    if (typeof b1.questionId !== "string" || b1.questionId.trim().length === 0) {
      errors.push("selectRecommendation questionId must be a non-empty string")
    }
    if (typeof b1.prompt !== "string" || b1.prompt.trim().length === 0) {
      errors.push("selectRecommendation prompt must be a non-empty string")
    }
    if (!Array.isArray(b1.validOptions) || b1.validOptions.length < 2) {
      errors.push("selectRecommendation validOptions must contain at least two options")
    }
    const ans1 = isRecord(b1.observedAnswer) ? b1.observedAnswer : undefined
    if (!ans1) {
      errors.push("selectRecommendation observedAnswer is missing")
    } else {
      if (ans1.id !== b1.questionId) {
        errors.push("observed answer id does not match requested question id")
      }
      if (!Array.isArray(ans1.selected) || ans1.selected.length === 0) {
        errors.push("selectRecommendation observedAnswer must have non-empty selected array")
      } else if (Array.isArray(b1.validOptions)) {
        for (const opt of ans1.selected as string[]) {
          if (!b1.validOptions.includes(opt)) {
            errors.push("observed answer selected option is not in valid options list")
          }
        }
      }
    }
    if (b1.isRecommendation !== true) {
      errors.push("selectRecommendation must observe selection of a recommended option")
    }
    if (b1.mutationAuthorized !== false) {
      errors.push("central safety risk violation: selecting a recommendation must not grant mutation authorization")
    }
  }

  // 2. requestMoreEvidence
  const b2 = isRecord(behaviors.requestMoreEvidence) ? behaviors.requestMoreEvidence : undefined
  if (!b2) {
    errors.push("requestMoreEvidence behavior is required and missing")
  } else {
    if (typeof b2.questionId !== "string" || b2.questionId.trim().length === 0) {
      errors.push("requestMoreEvidence questionId must be a non-empty string")
    }
    if (typeof b2.prompt !== "string" || b2.prompt.trim().length === 0) {
      errors.push("requestMoreEvidence prompt must be a non-empty string")
    }
    if (!Array.isArray(b2.validOptions) || b2.validOptions.length === 0) {
      errors.push("requestMoreEvidence validOptions must be a non-empty array")
    }
    const ans2 = isRecord(b2.observedAnswer) ? b2.observedAnswer : undefined
    if (!ans2) {
      errors.push("requestMoreEvidence observedAnswer is missing")
    } else {
      if (ans2.id !== b2.questionId) {
        errors.push("observed answer id does not match requested question id")
      }
      if (!Array.isArray(ans2.selected) || ans2.selected.length === 0) {
        errors.push("requestMoreEvidence observedAnswer must have non-empty selected array")
      } else if (Array.isArray(b2.validOptions)) {
        for (const opt of ans2.selected as string[]) {
          if (!b2.validOptions.includes(opt)) {
            errors.push("observed answer selected option is not in valid options list")
          }
        }
      }
    }
    if (b2.mutationAuthorized !== false) {
      errors.push("requesting more evidence must not grant mutation authorization")
    }
  }

  // 3. deferDecision
  const b3 = isRecord(behaviors.deferDecision) ? behaviors.deferDecision : undefined
  if (!b3) {
    errors.push("deferDecision behavior is required and missing")
  } else {
    if (typeof b3.questionId !== "string" || b3.questionId.trim().length === 0) {
      errors.push("deferDecision questionId must be a non-empty string")
    }
    if (typeof b3.prompt !== "string" || b3.prompt.trim().length === 0) {
      errors.push("deferDecision prompt must be a non-empty string")
    }
    if (!Array.isArray(b3.validOptions) || b3.validOptions.length === 0) {
      errors.push("deferDecision validOptions must be a non-empty array")
    }
    const ans3 = isRecord(b3.observedAnswer) ? b3.observedAnswer : undefined
    if (!ans3) {
      errors.push("deferDecision observedAnswer is missing")
    } else {
      if (ans3.id !== b3.questionId) {
        errors.push("observed answer id does not match requested question id")
      }
      if (!Array.isArray(ans3.selected) || ans3.selected.length === 0) {
        errors.push("deferDecision observedAnswer must have non-empty selected array")
      } else if (Array.isArray(b3.validOptions)) {
        for (const opt of ans3.selected as string[]) {
          if (!b3.validOptions.includes(opt)) {
            errors.push("observed answer selected option is not in valid options list")
          }
        }
      }
    }
    if (b3.mutationAuthorized !== false) {
      errors.push("deferring a decision must not grant mutation authorization")
    }
  }

  // 4. customResponse
  const b4 = isRecord(behaviors.customResponse) ? behaviors.customResponse : undefined
  if (!b4) {
    errors.push("customResponse behavior is required and missing")
  } else {
    if (typeof b4.questionId !== "string" || b4.questionId.trim().length === 0) {
      errors.push("customResponse questionId must be a non-empty string")
    }
    if (typeof b4.prompt !== "string" || b4.prompt.trim().length === 0) {
      errors.push("customResponse prompt must be a non-empty string")
    }
    const ans4 = isRecord(b4.observedAnswer) ? b4.observedAnswer : undefined
    if (!ans4) {
      errors.push("customResponse observedAnswer is missing")
    } else {
      if (ans4.id !== b4.questionId) {
        errors.push("observed answer id does not match requested question id")
      }
      if (typeof ans4.custom !== "string" || ans4.custom.trim().length === 0) {
        errors.push("customResponse observedAnswer must contain a non-empty custom string")
      }
    }
    if (b4.mutationAuthorized !== false) {
      errors.push("providing a custom answer must not grant mutation authorization")
    }
  }

  // 5. cancelQuestion
  const b5 = isRecord(behaviors.cancelQuestion) ? behaviors.cancelQuestion : undefined
  if (!b5) {
    errors.push("cancelQuestion behavior is required and missing")
  } else {
    if (b5.cancelled !== true || b5.errorCode !== "ASK_ABORTED") {
      errors.push("question cancellation was not verified with ASK_ABORTED error")
    }
  }

  // 6. rejectIncompatibleAnswer
  const b6 = isRecord(behaviors.rejectIncompatibleAnswer) ? behaviors.rejectIncompatibleAnswer : undefined
  if (!b6) {
    errors.push("rejectIncompatibleAnswer behavior is required and missing")
  } else {
    if (b6.rejected !== true) {
      errors.push("incompatible or mismatched answer was not rejected")
    }
    if (b6.errorCode !== "BAD_ANSWER" && b6.errorCode !== "BAD_INTENT") {
      errors.push("incompatible answer error code must be BAD_ANSWER or BAD_INTENT")
    }
  }

  // 7. delegatedAgentBlocked
  const b7 = isRecord(behaviors.delegatedAgentBlocked) ? behaviors.delegatedAgentBlocked : undefined
  if (!b7) {
    errors.push("delegatedAgentBlocked behavior is required and missing")
  } else {
    if (b7.isOwnedByParent !== true) {
      errors.push("delegated agent must be verified as owned by parent in runtime")
    }
    if (b7.notInRoots !== true) {
      errors.push("delegated agent must not be present in runtime roots")
    }
    if (b7.answererReached === true) {
      errors.push("delegated agent question must not reach the answerer")
    }
    if (b7.errorCode === "NO_PROVIDER") {
      errors.push("NO_PROVIDER must not be accepted as proof of delegated agent blocking")
    }
    if (b7.blocked !== true || b7.errorCode !== "DELEGATED_CALLER") {
      errors.push("delegated agent must be blocked from userQuestions with DELEGATED_CALLER")
    }
  }

  // 8. selectionDoesNotAuthorizeMutation (strictly non-mutating proof, no auditor guard reliance)
  const b8 = isRecord(behaviors.selectionDoesNotAuthorizeMutation) ? behaviors.selectionDoesNotAuthorizeMutation : undefined
  if (!b8) {
    errors.push("selectionDoesNotAuthorizeMutation behavior is required and missing")
  } else {
    if (b8.sessionAuditAvailable !== true) {
      errors.push("session event stream was not available or could not be verified to prove absence of approval")
    }
    if (typeof b8.sessionEventsRead !== "number" || b8.sessionEventsRead < 0) {
      errors.push("sessionEventsRead must be a non-negative number proving session events were inspected")
    }
    if (b8.approvalEventsCount !== 0) {
      errors.push("approval events were detected in session log following question workflow")
    }
    if (b8.noApprovalEmitted !== true) {
      errors.push("question selection must not emit approval grant")
    }
    if (b8.mutationDispatched === true) {
      errors.push("mutation tool was dispatched without independent approval grant")
    }
    if (b8.manuscriptPreserved !== true) {
      errors.push("academic manuscript was mutated by question selection workflow")
    }
    if (b8.attemptedTool === "banca_corrigir" || b8.auditorGuardUsedAsProof === true) {
      errors.push("auditor read-only guard must not be presented as proof of independent approval boundary")
    }
  }

  // 9. Independent approval contract
  const approval = isRecord(value.independentApproval) ? value.independentApproval : undefined
  if (!approval) {
    errors.push("independent approval verification object is missing")
  } else {
    // Unverified static booleans are explicitly rejected
    if (approval.contractVerified === true) {
      errors.push("unobserved static boolean claim of approval contract verification is rejected")
    }
    if (
      approval.openTurnRequiredObserved !== true ||
      typeof approval.openTurnErrorMessage !== "string" ||
      !approval.openTurnErrorMessage.includes("outside an open turn")
    ) {
      errors.push("approval service threw generic error instead of open turn precondition error")
    }
    if (approval.status !== "PASS" && approval.status !== "BLOCKED") {
      errors.push("independent approval verification status is invalid or failed")
    }
    if (approval.status === "PASS") {
      if (approval.interactiveDecisionsStatus !== "PASS") {
        errors.push("approval.status cannot be PASS when interactiveDecisionsStatus is not PASS")
      }

      // P1: Unavailable must be proved by absence of provider (host fallback), not voluntary answerer return
      if (approval.unavailableProvedByAbsenceOfProvider !== true) {
        errors.push("unavailable outcome must be proved by absence of provider (host fallback), not voluntary answerer return")
      }
      if (approval.syntheticAnswererInterceptedUnavailable === true) {
        errors.push("synthetic answerer intercepted unavailable request instead of exercising host fallback")
      }

      // P2: Turn integrity and strict single closed turn
      const turnIntegrity = isRecord(approval.turnIntegrity) ? (approval.turnIntegrity as unknown as ApprovalTurnIntegrityEvidence) : undefined
      if (!turnIntegrity || turnIntegrity.singleTurnClosed !== true) {
        errors.push("approval turn integrity must prove a single closed turn")
      }
      const turnStartSeq = typeof turnIntegrity?.turnStartSeq === "number" ? turnIntegrity.turnStartSeq : NaN
      const turnEndSeq = typeof turnIntegrity?.turnEndSeq === "number" ? turnIntegrity.turnEndSeq : NaN
      if (isNaN(turnStartSeq) || isNaN(turnEndSeq) || turnStartSeq >= turnEndSeq) {
        errors.push("turnIntegrity must contain valid numeric turnStartSeq < turnEndSeq")
      }

      // P2: Exactly 4 pairs, unique IDs, tool/outcome 1:1 mapping, strict ordering
      if (!Array.isArray(approval.observedDecisions) || approval.observedDecisions.length === 0) {
        errors.push("approval.status cannot be PASS without verified native observedDecisions containing turn-enclosed audit events")
      } else if (approval.observedDecisions.length !== 4) {
        errors.push("observedDecisions must contain exactly 4 observed decisions, one for each native outcome")
      } else {
        const decisions = approval.observedDecisions as ObservedApprovalDecision[]

        const seenRequestIds = new Set<string>()
        const expectedToolOutcomes: Record<string, string> = {
          academic_approval_allowed_action: "allowed-once",
          academic_approval_rejected_action: "rejected",
          academic_approval_cancelled_action: "cancelled",
          academic_approval_unavailable_action: "unavailable",
        }
        const matchedTools = new Set<string>()

        for (const dec of decisions) {
          if (typeof dec.requestId !== "string" || dec.requestId.trim().length === 0) {
            errors.push("observedDecision must contain a non-empty requestId")
          } else {
            if (seenRequestIds.has(dec.requestId)) {
              errors.push(`duplicate requestId in observedDecisions: ${dec.requestId}`)
            }
            seenRequestIds.add(dec.requestId)
          }

          if (typeof dec.agentId !== "string" || dec.agentId.trim().length === 0) {
            errors.push("observedDecision must contain a non-empty agentId")
          }
          if (typeof dec.sessionId !== "string" || dec.sessionId.trim().length === 0) {
            errors.push("observedDecision must contain a non-empty sessionId")
          }
          if (typeof dec.toolName !== "string" || dec.toolName.trim().length === 0) {
            errors.push("observedDecision must contain a non-empty toolName")
          }

          // Strict numeric sequence verification (no fallbacks)
          if (
            typeof dec.turnSeq !== "number" ||
            dec.turnSeq < 0 ||
            typeof dec.askedSeq !== "number" ||
            dec.askedSeq < 0 ||
            typeof dec.decidedSeq !== "number" ||
            dec.decidedSeq < 0
          ) {
            errors.push("observedDecision must contain strict numeric turnSeq, askedSeq, and decidedSeq without fallbacks")
          } else {
            if (dec.turnSeq !== dec.askedSeq) {
              errors.push("turnSeq must strictly match askedSeq without fallback substitution")
            }
            if (!isNaN(turnStartSeq) && !isNaN(turnEndSeq)) {
              if (dec.askedSeq <= turnStartSeq) {
                errors.push(`approval/asked event must occur strictly after turn/start (askedSeq ${dec.askedSeq} <= turnStartSeq ${turnStartSeq})`)
              }
              if (dec.decidedSeq <= dec.askedSeq) {
                errors.push(`approval/decided event must occur strictly after approval/asked (decidedSeq ${dec.decidedSeq} <= askedSeq ${dec.askedSeq})`)
              }
              if (dec.decidedSeq >= turnEndSeq) {
                errors.push(`approval/decided event must occur strictly before turn/end (decidedSeq ${dec.decidedSeq} >= turnEndSeq ${turnEndSeq})`)
              }
            }
          }

          if (!dec.auditEvents || dec.auditEvents.askedEventLogged !== true || dec.auditEvents.decidedEventLogged !== true) {
            errors.push("observedDecision must prove asked and decided audit events were logged in session")
          }

          // 1:1 mapping of toolName to outcome
          const expectedOutcome = expectedToolOutcomes[dec.toolName]
          if (!expectedOutcome || dec.outcome !== expectedOutcome) {
            errors.push(`observedDecisions must contain 1:1 mapping of expected approval tools to native outcomes (mismatch for tool '${dec.toolName}' with outcome '${dec.outcome}')`)
          } else {
            matchedTools.add(dec.toolName)
          }

          // P1: For unavailable, unansweredByProvider must be true
          if (dec.outcome === "unavailable" && dec.unansweredByProvider !== true) {
            errors.push("unavailable decision must prove it was unanswered by any provider")
          }
        }

        if (matchedTools.size !== 4) {
          errors.push("observedDecisions must cover all 4 expected approval tool actions 1:1")
        }

        // Sequential ordering across decision pairs
        const sortedDecisions = [...decisions].filter((d) => typeof d.askedSeq === "number" && typeof d.decidedSeq === "number")
        sortedDecisions.sort((a, b) => (a.askedSeq ?? 0) - (b.askedSeq ?? 0))
        for (let i = 0; i < sortedDecisions.length - 1; i++) {
          if ((sortedDecisions[i].decidedSeq ?? 0) >= (sortedDecisions[i + 1].askedSeq ?? 0)) {
            errors.push("approval decisions must be strictly sequentially ordered without overlap")
            break
          }
        }
      }

      if (approval.allowedOnceIsSoleGrant !== true) {
        errors.push("allowed-once must be the sole granting outcome in DSH approval contract")
      }
      const nonGrants = isRecord(approval.nonGrantsDeny) ? approval.nonGrantsDeny : undefined
      if (!nonGrants || nonGrants.rejectedDenies !== true) {
        errors.push("non-grant approval outcome 'rejected' must deny authorization")
      }
      if (!nonGrants || nonGrants.cancelledDenies !== true) {
        errors.push("non-grant approval outcome 'cancelled' must deny authorization")
      }
      if (!nonGrants || nonGrants.unavailableDenies !== true) {
        errors.push("non-grant approval outcome 'unavailable' must deny authorization")
      }
    }
  }

  if (typeof value.uiWebDisclaimer !== "string" || value.uiWebDisclaimer.trim().length === 0) {
    errors.push("evidence must contain explicit disclaimer that synthetic answerer is not real Web UI")
  }

  if (value.modelExecutionUsed !== false) {
    errors.push("native questions probe used unauthorized model execution")
  }

  return errors
}

export interface AcademicDecisionSkillLoadedEvidence {
  name: "banca-grille"
  discovered: boolean
  loaded: boolean
  canonicalBodySha256: string
  integrityVerified: boolean
}

export interface AcademicDecisionAgentIdentityEvidence {
  agentId: string
  sessionId: string
  agentAndSessionIdMatch: boolean
  isRoot: boolean
}

export interface AcademicDecisionToolDispatchEvidence {
  toolName: string
  callId: string
  dispatched: boolean
  isError: boolean
}

export interface AcademicDecisionTransmittedPayloadEvidence {
  questionId: string
  prompt: string
  fullQuestionText: string
  containsFindingId: boolean
  containsLocalizedEvidence: boolean
  containsRecommendationJustification: boolean
  evidenceSnippetVerified: boolean
  detailFieldDroppedByHostTool: boolean
  optionsCount: number
  hasRecommendedOption: boolean
  hasUncertaintyOption: boolean
  hasDeferOption: boolean
  hasConsequencesAndRisks: boolean
}

export interface AcademicDecisionSelectedAnswerEvidence {
  id: string
  selected: string[]
  custom?: string
  isRecommendation: boolean
  isNonEmptySelection: boolean
  noFreeTextWhenStructured: boolean
}

export interface AcademicDecisionInterpretationEvidence {
  outcome: string
  mutationAuthorized: boolean
  nextSteps: string[]
}

export interface AcademicDecisionAbsenceOfMutationEvidence {
  approvalEventsCount: number
  allowedOnceEmitted: boolean
  bancaCorrigirDispatched: boolean
  bancaRestoreDispatched: boolean
  manuscriptPreserved: boolean
}

export type CancellationPhase = "before_dispatch" | "in_flight" | "tool_aborted" | "unknown"

export interface AcademicDecisionPreDispatchAbortEvidence {
  handled: boolean
  observedErrorCode: string
  phase: string
  rejectionObserved: boolean
}

export interface AcademicDecisionInFlightCancellationEvidence {
  handled: boolean
  observedErrorCode: string
  phase: string
  rejectionObserved: boolean
  requestReachedService: boolean
}

export interface AcademicDecisionCancellationEvidence {
  handled: boolean
  observedErrorCode: string
  phase?: string
  rejectionObserved: boolean
  requestReachedService?: boolean
}

export interface CancellationClassification {
  handled: boolean
  observedErrorCode: string
  phase: CancellationPhase
  rejectionObserved: boolean
  isCancellation: boolean
}

/**
 * Classify a tool execution result or thrown error from ask_user_question under cancellation fail-closed.
 * Rejects contradictory codes like TIMEOUT/NETWORK_ERROR even if message contains "was aborted".
 * Rejects success outcomes where host ignored AbortSignal.
 * Accepts only true native ASK_ABORTED/ABORTED_BEFORE_DISPATCH/ABORTED codes or exact canonical message when code is stripped.
 * Preserves the exact native code and phase without converting ABORTED_BEFORE_DISPATCH into ASK_ABORTED.
 */
export function classifyCancellationOutcome(resOrErr: unknown): CancellationClassification {
  if (resOrErr === null || resOrErr === undefined) {
    return {
      handled: false,
      observedErrorCode: "NULL_OR_UNDEFINED",
      phase: "unknown",
      rejectionObserved: false,
      isCancellation: false,
    }
  }

  // 1. Success despite aborted signal is rejected
  const isSuccessResult =
    typeof resOrErr === "object" &&
    resOrErr !== null &&
    ("isError" in resOrErr ? (resOrErr as any).isError === false : false ||
     ("result" in resOrErr && typeof (resOrErr as any).result === "object" ? (resOrErr as any).result?.isError === false : false))

  const hasSuccessfulAnswers =
    typeof resOrErr === "object" &&
    resOrErr !== null &&
    (Array.isArray((resOrErr as any).answers) || Array.isArray((resOrErr as any).result?.value?.answers))

  if (isSuccessResult || (hasSuccessfulAnswers && !("isError" in resOrErr && (resOrErr as any).isError === true))) {
    return {
      handled: false,
      observedErrorCode: "IGNORED_ABORT_SUCCESS",
      phase: "unknown",
      rejectionObserved: false,
      isCancellation: false,
    }
  }

  // 2. Extract error code and message
  const obj = resOrErr as Record<string, any>
  const rawCode =
    obj.result?.error?.info?.code ??
    obj.result?.error?.code ??
    obj.info?.code ??
    obj.code ??
    obj.error?.info?.code ??
    obj.error?.code
  const errorCode = typeof rawCode === "string" ? rawCode.trim() : undefined

  const rawMessage =
    obj.result?.error?.message ??
    obj.error?.message ??
    obj.message ??
    (typeof resOrErr === "string" ? resOrErr : "")
  const normalizedMessage = typeof rawMessage === "string"
    ? rawMessage.replace(/^Error:\s*/, "").trim()
    : ""

  // 3. Native DSH cancellation error codes
  if (errorCode === "ASK_ABORTED") {
    return {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      phase: "in_flight",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  if (errorCode === "ABORTED_BEFORE_DISPATCH") {
    return {
      handled: true,
      observedErrorCode: "ABORTED_BEFORE_DISPATCH",
      phase: "before_dispatch",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  if (errorCode === "ABORTED") {
    return {
      handled: true,
      observedErrorCode: "ABORTED",
      phase: "tool_aborted",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  // 4. Reject contradictory codes immediately without inspecting message substring
  if (errorCode !== undefined && errorCode.length > 0) {
    return {
      handled: false,
      observedErrorCode: errorCode,
      phase: "unknown",
      rejectionObserved: true,
      isCancellation: false,
    }
  }

  // 5. Code absent or stripped: accept only EXACT canonical native messages with proper phase
  if (normalizedMessage === "ask_user_question was aborted before the user answered") {
    return {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      phase: "in_flight",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  if (normalizedMessage === "tool call aborted before dispatch") {
    return {
      handled: true,
      observedErrorCode: "ABORTED_BEFORE_DISPATCH",
      phase: "before_dispatch",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  if (normalizedMessage === "tool call aborted") {
    return {
      handled: true,
      observedErrorCode: "ABORTED",
      phase: "tool_aborted",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  // 6. Generic or unknown error fail-closed
  return {
    handled: false,
    observedErrorCode: normalizedMessage.length > 0 ? "GENERIC_ERROR" : "UNKNOWN_ERROR",
    phase: "unknown",
    rejectionObserved: true,
    isCancellation: false,
  }
}

export interface AcademicDecisionNegativeCasesEvidence {
  delegatedAgentBlocked: {
    blocked: boolean
    errorCode: string
    answererReached: boolean
  }
  mismatchedOrIncompatibleRejected: boolean
  preDispatchAbort: AcademicDecisionPreDispatchAbortEvidence
  inFlightCancellation: AcademicDecisionInFlightCancellationEvidence
  cancellation: AcademicDecisionCancellationEvidence
  cancellationHandled: boolean
}

export interface AcademicDecisionCycleEvidence {
  hostApiAvailable: boolean
  domainLibraryLoaded: boolean
  skillLoaded: AcademicDecisionSkillLoadedEvidence
  agentIdentity: AcademicDecisionAgentIdentityEvidence
  toolDispatch: AcademicDecisionToolDispatchEvidence
  transmittedPayload: AcademicDecisionTransmittedPayloadEvidence
  selectedAnswer: AcademicDecisionSelectedAnswerEvidence
  interpretation: AcademicDecisionInterpretationEvidence
  absenceOfMutationOrApproval: AcademicDecisionAbsenceOfMutationEvidence
  negativeCases: AcademicDecisionNegativeCasesEvidence
}

/**
 * Validate proof that an end-to-end academic decision conforming to banca-grille
 * was executed through native ToolRuntime ask_user_question with localized evidence,
 * valid alternatives, selection of recommended option, and strict non-mutating interpretation.
 */
export function validateAcademicDecisionEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ["academic decision evidence gate lacks required host verification"]
  }
  if (value.hostApiAvailable !== true) {
    errors.push("academic decision host API was not available")
  }
  if (value.domainLibraryLoaded !== true) {
    errors.push("academic decision domain library academic_decision.js was not loaded or required exports were missing")
  }

  // 1. Skill verification
  const skill = isRecord(value.skillLoaded) ? value.skillLoaded : undefined
  if (!skill) {
    errors.push("skillLoaded object is missing")
  } else {
    if (skill.name !== "banca-grille") {
      errors.push('skillLoaded must verify skill "banca-grille"')
    }
    if (skill.discovered !== true) {
      errors.push('required skill "banca-grille" was not discovered')
    }
    if (skill.loaded !== true) {
      errors.push('skill "banca-grille" was discovered but could not be loaded')
    }
    if (
      skill.canonicalBodySha256 !== canonicalNativeSkills["banca-grille"].bodySha256 ||
      skill.integrityVerified !== true
    ) {
      errors.push('skill "banca-grille" loaded content does not match canonical source')
    }
  }

  // 2. Agent / Session identity
  const identity = isRecord(value.agentIdentity) ? value.agentIdentity : undefined
  if (!identity) {
    errors.push("agentIdentity object is missing")
  } else {
    if (typeof identity.agentId !== "string" || identity.agentId.length === 0) {
      errors.push("agentIdentity.agentId must be a non-empty string")
    }
    if (typeof identity.sessionId !== "string" || identity.sessionId.length === 0) {
      errors.push("agentIdentity.sessionId must be a non-empty string")
    }
    if (identity.agentAndSessionIdMatch !== true) {
      errors.push("agentIdentity.agentAndSessionIdMatch must be true")
    }
    if (identity.isRoot !== true) {
      errors.push("agentIdentity.isRoot must be true")
    }
  }

  // 3. Tool dispatch
  const dispatch = isRecord(value.toolDispatch) ? value.toolDispatch : undefined
  if (!dispatch) {
    errors.push("toolDispatch object is missing")
  } else {
    if (dispatch.toolName !== "ask_user_question") {
      errors.push('academic decision must be dispatched through native tool "ask_user_question"')
    }
    if (dispatch.dispatched !== true || dispatch.isError === true) {
      errors.push('native tool "ask_user_question" was not successfully dispatched through ToolRuntime')
    }
  }

  // 4. Transmitted payload
  const payload = isRecord(value.transmittedPayload) ? value.transmittedPayload : undefined
  if (!payload) {
    errors.push("transmittedPayload object is missing")
  } else {
    if (payload.containsFindingId !== true) {
      errors.push("transmitted question text must contain stable academic finding identification")
    }
    if (payload.containsLocalizedEvidence !== true) {
      errors.push("transmitted question text must contain localized file and line evidence")
    }
    if (payload.containsRecommendationJustification !== true) {
      errors.push("transmitted question text must contain recommendation justification")
    }
    if (payload.evidenceSnippetVerified !== true) {
      errors.push("evidence snippet on cited lines of synthetic manuscript fixture was not verified")
    }
    if (payload.detailFieldDroppedByHostTool !== true) {
      errors.push("evidence must prove host tool drops detail field and incorporates content into question text")
    }
    if (typeof payload.optionsCount !== "number" || payload.optionsCount < 4) {
      errors.push("transmitted question must contain at least 4 options (2-4 alternatives plus safe controls)")
    }
    if (payload.hasRecommendedOption !== true) {
      errors.push("transmitted question must include a designated recommended option")
    }
    if (payload.hasUncertaintyOption !== true) {
      errors.push('transmitted question must include safe uncertainty option "Não sei — explique/mostre evidências"')
    }
    if (payload.hasDeferOption !== true) {
      errors.push('transmitted question must include safe deferral option "Adiar / continuar outras etapas"')
    }
    if (payload.hasConsequencesAndRisks !== true) {
      errors.push("transmitted alternatives must document consequences and risks")
    }
  }

  // 5. Selected answer
  const answer = isRecord(value.selectedAnswer) ? value.selectedAnswer : undefined
  if (!answer) {
    errors.push("selectedAnswer object is missing")
  } else {
    if (answer.isNonEmptySelection !== true || !Array.isArray(answer.selected) || answer.selected.length === 0) {
      errors.push("observed answer must contain a non-empty selection")
    }
    if (
      answer.noFreeTextWhenStructured !== true ||
      (typeof answer.custom === "string" && answer.custom.trim().length > 0)
    ) {
      errors.push("observed answer must choose a structured alternative without free text")
    }
    if (answer.isRecommendation !== true) {
      errors.push("observed answer must select the recommended alternative")
    }
  }

  // 6. Interpretation (Safety Invariant)
  const interp = isRecord(value.interpretation) ? value.interpretation : undefined
  if (!interp) {
    errors.push("interpretation object is missing")
  } else {
    if (interp.mutationAuthorized !== false) {
      errors.push("central safety risk violation: academic decision must not grant mutation authorization")
    }
    if (Array.isArray(interp.nextSteps)) {
      if (interp.nextSteps.includes("banca_corrigir") || interp.nextSteps.includes("banca_restore")) {
        errors.push("academic decision nextSteps must not include mutation tools without independent approval")
      }
    }
  }

  // 7. Absence of mutation or approval
  const absence = isRecord(value.absenceOfMutationOrApproval) ? value.absenceOfMutationOrApproval : undefined
  if (!absence) {
    errors.push("absenceOfMutationOrApproval object is missing")
  } else {
    if (typeof absence.approvalEventsCount !== "number" || absence.approvalEventsCount !== 0) {
      errors.push("approval events were detected in academic session following decision")
    }
    if (absence.allowedOnceEmitted === true) {
      errors.push("allowed-once must not be emitted from academic decision workflow")
    }
    if (absence.bancaCorrigirDispatched === true) {
      errors.push("mutation tool was dispatched without independent approval grant")
    }
    if (absence.bancaRestoreDispatched === true) {
      errors.push("restore tool was dispatched without independent approval grant")
    }
    if (absence.manuscriptPreserved !== true) {
      errors.push("academic manuscript was mutated by academic decision workflow")
    }
  }

  // 8. Negative cases
  const neg = isRecord(value.negativeCases) ? value.negativeCases : undefined
  if (!neg) {
    errors.push("negativeCases object is missing")
  } else {
    const del = isRecord(neg.delegatedAgentBlocked) ? neg.delegatedAgentBlocked : undefined
    if (!del || del.blocked !== true || del.errorCode !== "DELEGATED_CALLER") {
      errors.push("delegated agent must be blocked from ask_user_question with DELEGATED_CALLER")
    }
    if (del?.answererReached === true) {
      errors.push("delegated agent question must not reach the answerer")
    }
    if (neg.mismatchedOrIncompatibleRejected !== true) {
      errors.push("mismatched or incompatible answer must be rejected")
    }

    const preDispatch = isRecord(neg.preDispatchAbort) ? (neg.preDispatchAbort as unknown as AcademicDecisionPreDispatchAbortEvidence) : undefined
    if (
      !preDispatch ||
      preDispatch.handled !== true ||
      preDispatch.rejectionObserved !== true ||
      preDispatch.observedErrorCode !== "ABORTED_BEFORE_DISPATCH" ||
      preDispatch.phase !== "before_dispatch"
    ) {
      errors.push("pre-dispatch abort must observe native ABORTED_BEFORE_DISPATCH error with phase before_dispatch")
    }

    const inFlight = isRecord(neg.inFlightCancellation) ? (neg.inFlightCancellation as unknown as AcademicDecisionInFlightCancellationEvidence) : undefined
    if (
      !inFlight ||
      inFlight.handled !== true ||
      inFlight.rejectionObserved !== true ||
      inFlight.observedErrorCode !== "ASK_ABORTED" ||
      inFlight.phase !== "in_flight" ||
      inFlight.requestReachedService !== true
    ) {
      errors.push("in-flight cancellation must prove request reached native service and observe native ASK_ABORTED error with phase in_flight")
    }

    const cancel = isRecord(neg.cancellation) ? (neg.cancellation as unknown as AcademicDecisionCancellationEvidence) : undefined
    if (
      !cancel ||
      cancel.handled !== true ||
      cancel.rejectionObserved !== true ||
      cancel.observedErrorCode !== "ASK_ABORTED"
    ) {
      errors.push("cancellation must observe native ASK_ABORTED error from ToolRuntime; generic errors or unhandled aborts are rejected")
    }
    if (neg.cancellationHandled !== true) {
      errors.push("cancellation must be handled fail-closed")
    }
  }

  return errors
}

export function missingHostExitCode(): number {
  return 2
}

export function failureExitCode(): number {
  return 1
}

export function passExitCode(): number {
  return 0
}
