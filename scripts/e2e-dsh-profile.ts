import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  fsyncSync,
  writeFileSync,
} from "node:fs"
import { createHash, createHmac, randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse as parseYaml } from "yaml"
import { loadConfig } from "../src/lib/config.js"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader.js"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage.js"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint.js"
import { computeAuditSubmissionId, computeBatchFindingsDigest } from "../src/lib/analysis_audit_confirmation.js"
import { buildSdkPresetOverlayPatch, e2eControlPresetId } from "./lib/dsh-profile-e2e-presets.js"
import { renderControlPresetSelector } from "./lib/dsh-profile-e2e-observer-control.js"
import { copyRequiredAcademicDecisionModule } from "./lib/dsh-profile-observer-package.js"
import {
  canonicalAuditorMarkdownSha256,
  expectedTools,
  formatCommandFailure,
  declaredPackageVersionMatches,
  resolveSelectedDshPackage,
  resolveSelectedDshPackageRoot,
  safeRuntimeVersion,
  sanitizeReport,
  expectedNativeSkills,
  expectedNativeSkillProvider,
  canonicalNativeSkills,
  missingHostExitCode,
  passExitCode,
  failureExitCode,
  classifyAuditorMarkdownStatus,
  classifyNativeSkillsStatus,
  classifyBatchAuditEvidenceStatus,
  classifyNativeQuestionsStatus,
  classifyAcademicDecisionStatus,
  classifyCrossProcessBatchAuditEvidenceStatus,
  classifyProfileGateStatuses,
  captureNativeSkillsEvidence,
  validateAuditorMarkdownEvidence,
  validateNativeSkillsEvidence,
  validateBatchAuditEvidence,
  validateNativeQuestionsEvidence,
  validateAcademicDecisionEvidence,
  validateCrossProcessPhaseOneEvidence,
  validateCrossProcessBatchAuditEvidence,
  validateAbruptRestartEvidence,
  classifyAbruptRestartEvidenceStatus,
  validateSourceDriftEvidence,
  classifySourceDriftEvidenceStatus,
  validateEvidence,
  validateProfileEvidence,
  validatePresetReferences,
  validateComposedProfilePlugins,
} from "./lib/dsh-profile-e2e-contract.js"
import {
  buildScratchPnpmBundleInstallEnv,
  buildPnpmCommand,
  findPnpmCli,
  isOfflineMissingPnpmError,
  renderPnpmWrapper,
  shellQuote,
} from "./lib/dsh-profile-e2e-pnpm.js"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configuredReportPath = process.env.DSHBANCA_DSH_PROFILE_REPORT_PATH
const abruptRestartReportPath = process.env.DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_REPORT_PATH
const abruptRestartRequestVariables = [
  "DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_AUTHORIZED",
  "DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SHA256",
  "DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SCENARIO",
  "DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_ENVIRONMENT",
  "DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_REPORT_PATH",
] as const
const abruptRestartRequested = abruptRestartRequestVariables.some((key) => (process.env[key] ?? "").trim() !== "")
const reportPersistencePlan = createReportPersistencePlan({
  abruptRestartRequested,
  configuredReportPath,
  abruptReportPath: abruptRestartReportPath,
  repositoryRoot,
  temporaryRoot: tmpdir(),
  defaultReportPath: "docs/evidence/dsh-profile-e2e.latest.json",
})
const reportPathLabel = reportPersistencePlan.mode === "abrupt"
  ? "<approved isolated report path>"
  : configuredReportPath?.trim() ? "<configured report path>" : "docs/evidence/dsh-profile-e2e.latest.json"
const timeoutMs = 120_000
const bootTimeoutMs = 30_000
const controlledTeardownGraceMs = 5_000
const controlledCloseGraceMs = 5_000
const maxOutputBytes = 8_000_000
const defaultRunDependencies: RunDependencies = { spawn, setTimeout, clearTimeout }
const profileName = `dshbanca-e2e-${process.pid}-${Date.now()}`
const observerName = "dshbanca-e2e-observer"

interface CommandResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
  spawnObserved?: boolean
  exitObserved?: boolean
  closeObserved?: boolean
  hostProcessIdentitySha256?: string | null
  controlCompleted?: boolean
  controlFailed?: boolean
  timeoutContainmentSignalsRequested?: Array<"SIGTERM" | "SIGKILL">
}

type ControlledProcessStart = (
  child: ReturnType<typeof spawn>,
  hostProcessIdentitySha256: string | null,
  signal: AbortSignal,
  mayContinue: () => boolean,
) => Promise<void>
type ControlTimeoutHandler = (
  child: ReturnType<typeof spawn>,
  hostProcessIdentitySha256: string | null,
  maySignal: () => boolean,
) => "SIGTERM" | null
type ControlHardTimeoutHandler = (
  child: ReturnType<typeof spawn>,
  hostProcessIdentitySha256: string | null,
  maySignal: () => boolean,
) => "SIGKILL" | null

interface RunOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  stdin?: "ignore" | "pipe"
  processIdentityKey?: Buffer
  controlledTeardownGraceMs?: number
  controlledCloseGraceMs?: number
  onSpawn?: ControlledProcessStart
  onControlTimeout?: ControlTimeoutHandler
  onControlHardTimeout?: ControlHardTimeoutHandler
}

interface RunDependencies {
  spawn: typeof spawn
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

export interface ReportPersistencePlan {
  readonly mode: "legacy" | "abrupt"
  readonly authorized: boolean
  readonly path?: string
  readonly reason?: string
  readonly canonicalParent?: string
  readonly parentDevice?: number
  readonly parentInode?: number
}

export interface ReportPersistenceOptions {
  abruptRestartRequested: boolean
  configuredReportPath?: string
  abruptReportPath?: string
  repositoryRoot: string
  temporaryRoot: string
  defaultReportPath: string
}

interface GateReport {
  schemaVersion: 1
  status: "PASS" | "FAIL" | "BLOCKED"
  startedAt: string
  finishedAt?: string
  repository: { revision: string; dirty: boolean }
  versions: Record<string, string | null>
  sandbox: { isolated: boolean; removed: boolean | null }
  stages: Record<string, unknown>
  failures: string[]
  limitations: string[]
}

const report: GateReport = {
  schemaVersion: 1,
  status: "BLOCKED",
  startedAt: new Date().toISOString(),
  repository: { revision: "unknown", dirty: true },
  versions: {
    dsh: null,
    cordis: null,
    cordisPluginLoader: null,
    dshSkill: null,
    dshAgent: null,
    dshAgentLoop: null,
    dshTools: null,
    dshAgentPreset: null,
    dshAgentPresetRegistry: null,
    dshAgentInstructions: null,
    dshApiSessionController: null,
    dshUserQuestions: null,
    dshUserApproval: null,
    dshToolAskUser: null,
    node: process.version,
    bun: null,
    pnpm: null,
  },
  sandbox: { isolated: false, removed: null },
  stages: {
    sourceDrift: { status: "BLOCKED", processLaunches: 0, reason: "Issue #105 native source-drift evidence has not executed." },
    abruptRestart: { status: "BLOCKED", probeExecuted: false, processLaunches: 0, reason: "NEEDS_APPROVAL: exact final SHA, durable-checkpoint-2-of-5-sigkill scenario, and runner-owned scratch-only environment were not approved." },
  },
  failures: [],
  limitations: [
    "O E2E ativo cria Agents/Sessions nativos do DSH, mas não inicia turnos de modelo; respostas acadêmicas humanas e qualidade de inferência não são cobertas.",
    "Identidade/guard (#2), instruções Markdown (#3), skills nativas (#38), auditoria por lote (#44), perguntas estruturadas/aprovação (#46), decisão acadêmica (#48) e recuperação entre processos (#103) são gates separados.",
    "A execução ativa requer DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED=yes; sem essa autorização o runner para antes de invocar o CLI DSH, criar Agent/Session ou inicializar o projeto sintético.",
    "Issue #107 abruptRestart exige autorização independente para o SHA exato, cenário durable-checkpoint-2-of-5-sigkill e ambiente runner-owned-scratch-only; sem isso permanece BLOCKED / NEEDS_APPROVAL.",
    "O gate de identidade de processo usa child_process.spawn observado pelo pai e Linux procfs; plataformas sem essa evidência ficam BLOCKED, sem fallback baseado em texto de PID.",
  ],
}

let scratchRoot: string | undefined
let restartWorkspaceDirectoryFd: number | undefined
let abruptRestartWorkspaceDirectoryFd: number | undefined
let driftWorkspaceDirectoryFd: number | undefined
let preserveScratchForSafety = false
let finalStatus: GateReport["status"] = "BLOCKED"

function commandVersion(command: string, args: string[], env?: NodeJS.ProcessEnv): string | null {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000, env })
  if (result.status !== 0) return null
  return `${result.stdout ?? ""}`.trim().split(/\r?\n/)[0] || null
}

function findExecutable(name: string, override?: string): string | undefined {
  const candidate = override?.trim()
  if (candidate) {
    const explicit = resolve(candidate)
    return existsSync(explicit) && statSync(explicit).isFile() ? realpathSync(explicit) : undefined
  }
  const pathValue = process.env.PATH ?? ""
  for (const directory of pathValue.split(delimiter())) {
    if (!directory) continue
    const path = join(directory, name)
    if (existsSync(path) && statSync(path).isFile()) return realpathSync(path)
  }
  return undefined
}

function delimiter(): string {
  return process.platform === "win32" ? ";" : ":"
}

function findDshPackageRoot(executable: string): string | undefined {
  return resolveSelectedDshPackageRoot(executable) ?? undefined
}

function assertDeclaredDependency(ownerManifest: Record<string, any>, packageName: string, actualVersion: string): void {
  const dependencySets = [ownerManifest.dependencies, ownerManifest.peerDependencies, ownerManifest.optionalDependencies]
  const declaredRanges = dependencySets
    .filter((set) => set && typeof set[packageName] === "string")
    .map((set) => set[packageName] as string)
  if (declaredRanges.length === 0 || declaredRanges.some((range) => !declaredPackageVersionMatches(actualVersion, range))) {
    throw new Error("selected DSH dependency does not satisfy its declared version")
  }
}

async function validateNativePresetConfig(dshExecutable: string, nodeVersion: string) {
  const dshRoot = findDshPackageRoot(dshExecutable)
  if (!dshRoot) throw new Error("installed DSH package root is unavailable")
  const dshManifest = JSON.parse(readFileSync(join(dshRoot, "package.json"), "utf8")) as Record<string, any>
  const registryPackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/dsh-agent-preset-registry", nodeVersion)
  const presetPackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/dsh-agent-preset", nodeVersion)
  const instructionPackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/dsh-agent-instructions", nodeVersion)
  const webAppPackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/dsh-web-app", nodeVersion)
  const basePackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/dsh-base", nodeVersion)
  for (const packageName of [
    "@deepseek-ai/dsh-agent-preset",
    "@deepseek-ai/dsh-agent-instructions",
    "@deepseek-ai/dsh-web-app",
    "@deepseek-ai/dsh-base",
  ]) assertDeclaredDependency(dshManifest, packageName, dshManifest.version)
  assertDeclaredDependency(webAppPackage.manifest, "@deepseek-ai/dsh-agent-preset-registry", registryPackage.manifest.version as string)
  assertDeclaredDependency(presetPackage.manifest, "@deepseek-ai/dsh-agent-preset-registry", registryPackage.manifest.version as string)
  const registryModule = await import(pathToFileURL(registryPackage.entryPath).href)
  const presetModule = await import(pathToFileURL(presetPackage.entryPath).href)
  const instructionModule = await import(pathToFileURL(instructionPackage.entryPath).href)
  const patchRows = (parseYaml(readFileSync(join(repositoryRoot, "cordis.patch.yml"), "utf8")) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const overlayRows = (parseYaml(buildSdkPresetOverlayPatch(observerName)) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const registryRow = overlayRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset-registry")
  const fixturePresetRows = overlayRows.filter((row) => row?.name === "@deepseek-ai/dsh-agent-preset")
  const neutralPresetRow = fixturePresetRows.find((row) => row?.config?.id === e2eControlPresetId)
  const presetIds = [
    ...patchRows.filter((row) => row?.name === "@deepseek-ai/dsh-agent-preset").map((row) => row?.config?.id),
    ...fixturePresetRows.map((row) => row?.config?.id),
  ]
  const auditorRow = patchRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset" && row?.config?.id === "banca-auditor")
  const bundleRegistryAbsent = !patchRows.some((row) => row?.name === "@deepseek-ai/dsh-agent-preset-registry")
  const bundleStandardAbsent = !patchRows.some((row) => row?.name === "@deepseek-ai/dsh-agent-preset" && row?.config?.id === "standard")
  const registryResult = await registryModule.AgentPresetRegistry.Config["~standard"].validate(registryRow?.config)
  const missingDefaultResult = await registryModule.AgentPresetRegistry.Config["~standard"].validate({})
  const unknownDefaultErrors = validatePresetReferences("unknown-dshbanca-e2e-preset", presetIds)
  const duplicatePresetErrors = validatePresetReferences(registryRow?.config?.default, [...presetIds, e2eControlPresetId])
  const fixtureDefaultResolved = validatePresetReferences(registryRow?.config?.default, presetIds).length === 0
  const neutralPresetResult = neutralPresetRow
    ? await presetModule.default.Config["~standard"].validate(neutralPresetRow.config)
    : { issues: [{ message: "scratch control preset row missing" }] }
  const presetResult = auditorRow
    ? await presetModule.default.Config["~standard"].validate(auditorRow.config)
    : { issues: [{ message: "banca-auditor preset row missing" }] }
  const instructionRow = auditorRow?.config?.plugins?.find((row) => row?.name === "@deepseek-ai/dsh-agent-instructions")
  const instructionResult = instructionRow
    ? await instructionModule.Config["~standard"].validate(instructionRow.config)
    : { issues: [{ message: "native instruction loader child missing" }] }
  const childProblem = auditorRow ? registryModule.entryListProblem(auditorRow.config.plugins) : "banca-auditor preset row missing"
  const rejectedMissingDefault = Array.isArray(missingDefaultResult.issues) &&
    missingDefaultResult.issues.some((issue) => issue.path?.[0] === "default")
  const webAppRoot = webAppPackage.packageRoot
  const webHostRows = (parseYaml(readFileSync(join(webAppRoot, "cordis.patch.yml"), "utf8")) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const webHostRegistry = webHostRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset-registry")
  const webStandardRows = (parseYaml(readFileSync(join(webAppRoot, "presets", "standard.patch.yml"), "utf8")) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const webStandardPreset = webStandardRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset" && row?.config?.id === "standard")
  const hostStandardPreserved = webHostRegistry?.config?.default === "standard" && Boolean(webStandardPreset) && bundleRegistryAbsent && bundleStandardAbsent
  const registryInjectionRequired = Array.isArray(presetModule.default.inject) && presetModule.default.inject.includes("agentPresets")
  const basePatchPath = join(basePackage.packageRoot, "cordis.patch.yml")
  const baseRows = existsSync(basePatchPath)
    ? (parseYaml(readFileSync(basePatchPath, "utf8")) as any[])
        .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
    : []
  const duplicationErrors = validateComposedProfilePlugins([...baseRows, ...patchRows, ...overlayRows])
  const noDuplicates = duplicationErrors.length === 0
  const accepted = bundleRegistryAbsent && bundleStandardAbsent && !registryResult.issues && rejectedMissingDefault &&
    fixtureDefaultResolved && !neutralPresetResult.issues && !presetResult.issues &&
    !instructionResult.issues && childProblem === undefined && unknownDefaultErrors.length > 0 &&
    duplicatePresetErrors.length > 0 && hostStandardPreserved && registryInjectionRequired &&
    noDuplicates
  return {
    accepted,
    dshVersion: dshManifest.version,
    resolvedPackageLayouts: {
      registry: registryPackage.layout,
      preset: presetPackage.layout,
      instructions: instructionPackage.layout,
      webApp: webAppPackage.layout,
      base: basePackage.layout,
    },
    bundleRegistryAbsent,
    bundleStandardAbsent,
    scratchRegistryAccepted: !registryResult.issues,
    absentDefaultRejected: rejectedMissingDefault,
    unknownDefaultRejected: unknownDefaultErrors.length > 0,
    duplicatePresetIdRejected: duplicatePresetErrors.length > 0,
    fixtureDefaultResolved,
    fixtureNeutralPresetAccepted: !neutralPresetResult.issues,
    hostStandardPreserved,
    registryInjectionRequired,
    noDuplicates,
    duplicationErrors,
    presetAccepted: !presetResult.issues,
    instructionConfigAccepted: !instructionResult.issues,
    childPluginStructureAccepted: childProblem === undefined,
    scratchDefaultId: registryRow?.config?.default ?? null,
    presetId: auditorRow?.config?.id ?? null,
    instructionCandidates: instructionRow?.config?.instructionFileCandidates ?? [],
  }
}


function linuxProcessIdentitySha256(pid: number, key: Buffer): string | null {
  if (process.platform !== "linux") return null
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const commandEnd = stat.lastIndexOf(")")
    if (commandEnd < 0) return null
    const startTicks = stat.slice(commandEnd + 1).trim().split(/\s+/)[19]
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()
    if (!/^\d+$/.test(startTicks ?? "") || !/^[a-f0-9-]{36}$/i.test(bootId)) return null
    return createHmac("sha256", key).update(JSON.stringify(["dsh-process-v1", pid, bootId, startTicks]), "utf8").digest("hex")
  } catch {
    return null
  }
}

function verifyOwnedDshChild(
  child: ReturnType<typeof spawn>,
  nodeExecutable: string,
  dshExecutable: string,
  args: string[],
  expectedHostIdentitySha256: string | null,
  key: Buffer,
): boolean {
  const pid = child.pid
  if (
    process.platform !== "linux" ||
    !Number.isSafeInteger(pid) ||
    pid === undefined ||
    pid <= 1 ||
    child.exitCode !== null ||
    child.signalCode !== null ||
    !expectedHostIdentitySha256 ||
    linuxProcessIdentitySha256(pid, key) !== expectedHostIdentitySha256
  ) return false
  try {
    const executable = realpathSync(`/proc/${pid}/exe`)
    const expectedExecutable = realpathSync(nodeExecutable)
    const argv = readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean)
    const expectedArgv = [realpathSync(nodeExecutable), realpathSync(dshExecutable), ...args]
    return executable === expectedExecutable && JSON.stringify(argv) === JSON.stringify(expectedArgv)
  } catch {
    return false
  }
}

export function terminateOwnedDshChild(
  child: ReturnType<typeof spawn>,
  nodeExecutable: string,
  dshExecutable: string,
  args: string[],
  expectedHostIdentitySha256: string | null,
  key: Buffer,
  signal: "SIGKILL" | "SIGTERM",
  maySignal: () => boolean = () => true,
  verifyIdentity: (
    child: ReturnType<typeof spawn>,
    expectedHostIdentitySha256: string | null,
  ) => boolean = (target, expected) => target.pid !== undefined &&
    linuxProcessIdentitySha256(target.pid, key) === expected &&
    verifyOwnedDshChild(target, nodeExecutable, dshExecutable, args, expected, key),
  sendSignal: (pid: number, signal: "SIGKILL" | "SIGTERM") => void = (pid, requested) => process.kill(pid, requested),
): boolean {
  const pid = child.pid
  if (pid === undefined || !maySignal() || !verifyIdentity(child, expectedHostIdentitySha256) || !maySignal()) return false
  try {
    sendSignal(pid, signal)
    return true
  } catch {
    return false
  }
}

function processTargetAbsentAfterClose(pid: number | undefined, originalIdentitySha256: string | null, key: Buffer): boolean {
  if (process.platform !== "linux" || pid === undefined || !originalIdentitySha256) return false
  if (!existsSync(`/proc/${pid}`)) return true
  const currentIdentity = linuxProcessIdentitySha256(pid, key)
  return currentIdentity !== null && currentIdentity !== originalIdentitySha256
}

export function parseLinuxProcStatProcessGroupId(stat: string): number | null {
  const commandEnd = stat.lastIndexOf(")")
  if (commandEnd < 0) return null
  const fields = stat.slice(commandEnd + 1).trim().split(/\s+/)
  const groupId = fields[2]
  if (!/^\d+$/.test(groupId ?? "")) return null
  const parsed = Number(groupId)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function processGroupAbsentFromProcRows(
  groupId: number,
  rows: Array<{ pid: number; stat: string }>,
): boolean {
  if (!Number.isSafeInteger(groupId) || groupId <= 0 || rows.length === 0) return false
  for (const row of rows) {
    if (!Number.isSafeInteger(row.pid) || row.pid <= 0) return false
    const observedGroupId = parseLinuxProcStatProcessGroupId(row.stat)
    if (observedGroupId === null || observedGroupId === groupId) return false
  }
  return true
}

function processGroupAbsentAfterClose(groupId: number | undefined): boolean {
  if (process.platform !== "linux" || groupId === undefined || !Number.isSafeInteger(groupId) || groupId <= 1) return false
  let entries
  try { entries = readdirSync("/proc", { withFileTypes: true }) } catch { return false }
  const rows: Array<{ pid: number; stat: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    const pid = Number(entry.name)
    try {
      rows.push({ pid, stat: readFileSync(`/proc/${entry.name}/stat`, "utf8") })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ENOENT" || code === "ESRCH") continue
      return false
    }
  }
  return processGroupAbsentFromProcRows(groupId, rows)
}

// Read-only observation of the child's own process group before it is reaped.
// The runner spawns detached, so the private group must be the direct child PID;
// a missing or different PGID is ambiguous and must fail closed.
function linuxProcessGroupIdOfProcess(pid: number | undefined): number | null {
  if (process.platform !== "linux" || pid === undefined || !Number.isSafeInteger(pid) || pid <= 1) return null
  try {
    return parseLinuxProcStatProcessGroupId(readFileSync(`/proc/${pid}/stat`, "utf8"))
  } catch {
    return null
  }
}

// Pure predicate shared by the producer and its regressions: a non-null group is
// not enough; the observed PGID must be exactly the direct child PID.
export function abruptPrivateProcessGroupIdMatchesChildPid(
  childPid: number | undefined,
  observedProcessGroupId: number | null,
): boolean {
  return childPid !== undefined && Number.isSafeInteger(childPid) && childPid > 1 &&
    observedProcessGroupId !== null && Number.isSafeInteger(observedProcessGroupId) &&
    observedProcessGroupId === childPid
}

export function abruptSecondProcessAbsenceDecision(input: {
  closeObserved: boolean
  controlCompleted: boolean
  runnerOwnedChild: boolean
  processGroupIdObserved: boolean
  targetAbsentAfterClose: boolean
  processGroupAbsentAfterClose: boolean
}): {
  closeConfirmed: boolean
  processGroupIdObserved: boolean
  targetAbsentAfterClose: boolean
  processGroupAbsentAfterClose: boolean
  preserveScratch: boolean
} {
  const closeConfirmed = input.closeObserved === true && input.controlCompleted === true && input.runnerOwnedChild === true
  const processGroupIdObserved = input.processGroupIdObserved === true
  const targetAbsentAfterClose = closeConfirmed && input.targetAbsentAfterClose === true
  const processGroupAbsentAfterClose = closeConfirmed && processGroupIdObserved && input.processGroupAbsentAfterClose === true
  return {
    closeConfirmed,
    processGroupIdObserved,
    targetAbsentAfterClose,
    processGroupAbsentAfterClose,
    preserveScratch: !(targetAbsentAfterClose && processGroupAbsentAfterClose),
  }
}

export function mayStartAbruptPhaseTwo(input: {
  parentBarrierArmed: boolean
  parentVerifiedPersistence: boolean
  controlCompleted: boolean
  controlFailed: boolean
  firstKillRequested: boolean
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  exitObserved: boolean
  closeObserved: boolean
  targetAbsentAfterClose: boolean
  processGroupAbsentAfterClose: boolean
  nativeTeardownMarkerObserved: boolean
}): boolean {
  return input.parentBarrierArmed && input.parentVerifiedPersistence && input.controlCompleted && !input.controlFailed &&
    input.firstKillRequested && input.exitCode === null && input.signal === "SIGKILL" && !input.timedOut &&
    input.exitObserved && input.closeObserved && input.targetAbsentAfterClose && input.processGroupAbsentAfterClose &&
    !input.nativeTeardownMarkerObserved
}

export function run(
  command: string,
  args: string[],
  options: RunOptions,
  dependencies: RunDependencies = defaultRunDependencies,
): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = dependencies.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let stdoutTail = ""
    let stderrTail = ""
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    let spawnObserved = false
    let exitObserved = false
    let observedExitCode: number | null = null
    let observedExitSignal: string | null = null
    let controlCompleted = options.onSpawn === undefined
    let controlFailed = false
    let controlStarted = false
    let settled = false
    let controlledTimeoutStarted = false
    let controlErrorMessage: string | null = null
    let hostProcessIdentitySha256: string | null = null
    const timeoutContainmentSignalsRequested: Array<"SIGTERM" | "SIGKILL"> = []
    const controlAbort = new AbortController()
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    let teardownTimer: ReturnType<typeof setTimeout> | undefined
    let closeDeadlineTimer: ReturnType<typeof setTimeout> | undefined
    const clearTimers = () => {
      if (timeoutTimer !== undefined) dependencies.clearTimeout(timeoutTimer)
      if (teardownTimer !== undefined) dependencies.clearTimeout(teardownTimer)
      if (closeDeadlineTimer !== undefined) dependencies.clearTimeout(closeDeadlineTimer)
      timeoutTimer = undefined
      teardownTimer = undefined
      closeDeadlineTimer = undefined
    }
    const mayContinue = () => !settled && !timedOut && !controlAbort.signal.aborted
    const mayContain = () => !settled
    const currentOutput = () => ({
      stdout: stdoutTruncated ? `${stdout}\n<output truncated>\n${stdoutTail}` : stdout,
      stderr: `${stderrTruncated ? `${stderr}\n<output truncated>\n${stderrTail}` : stderr}${controlErrorMessage ? `\n${controlErrorMessage}` : ""}`,
    })
    const finish = (result: CommandResult) => {
      if (settled) return
      if (options.onSpawn && !controlCompleted) {
        controlFailed = true
        controlAbort.abort()
      }
      settled = true
      clearTimers()
      resolveResult({
        ...result,
        controlCompleted,
        controlFailed,
        timeoutContainmentSignalsRequested: [...timeoutContainmentSignalsRequested],
      })
    }
    const finishWithoutClose = () => {
      if (settled) return
      controlFailed = true
      controlAbort.abort()
      try { child.stdin?.destroy() } catch { /* the terminal state must remain bounded */ }
      try { child.stdout.destroy() } catch { /* the terminal state must remain bounded */ }
      try { child.stderr.destroy() } catch { /* the terminal state must remain bounded */ }
      try { child.unref() } catch { /* do not let an unconfirmed child hold the runner open */ }
      finish({
        exitCode: child.exitCode ?? observedExitCode,
        signal: child.signalCode ?? observedExitSignal,
        timedOut,
        ...currentOutput(),
        spawnObserved,
        exitObserved,
        closeObserved: false,
        hostProcessIdentitySha256,
      })
    }
    const scheduleCloseDeadline = () => {
      closeDeadlineTimer = dependencies.setTimeout(
        finishWithoutClose,
        options.controlledCloseGraceMs ?? controlledCloseGraceMs,
      )
    }
    const onControlledTimeout = () => {
      if (settled || controlledTimeoutStarted) return
      controlledTimeoutStarted = true
      if (timeoutTimer !== undefined) dependencies.clearTimeout(timeoutTimer)
      timeoutTimer = undefined
      timedOut = true
      controlFailed = true
      controlAbort.abort()
      try { child.stdin?.end() } catch { controlFailed = true }
      try {
        const requested = options.onControlTimeout?.(child, hostProcessIdentitySha256, mayContain()) ?? null
        if (requested === "SIGTERM") timeoutContainmentSignalsRequested.push(requested)
      } catch {
        controlFailed = true
      }
      if (exitObserved || child.exitCode !== null || child.signalCode !== null) {
        scheduleCloseDeadline()
        return
      }
      teardownTimer = dependencies.setTimeout(() => {
        if (settled) return
        if (exitObserved || child.exitCode !== null || child.signalCode !== null) {
          scheduleCloseDeadline()
          return
        }
        try {
          const requested = options.onControlHardTimeout?.(child, hostProcessIdentitySha256, mayContain()) ?? null
          if (requested === "SIGKILL") timeoutContainmentSignalsRequested.push(requested)
        } catch {
          controlFailed = true
        }
        scheduleCloseDeadline()
      }, options.controlledTeardownGraceMs ?? controlledTeardownGraceMs)
    }
    child.once("spawn", () => {
      spawnObserved = true
      const pid = child.pid
      if (options.processIdentityKey && pid !== undefined) {
        hostProcessIdentitySha256 = linuxProcessIdentitySha256(pid, options.processIdentityKey)
      }
      if (options.onSpawn) {
        controlStarted = true
        void Promise.resolve()
          .then(() => mayContinue() ? options.onSpawn!(child, hostProcessIdentitySha256, controlAbort.signal, mayContinue) : undefined)
          .then(() => {
            if (!settled && mayContinue()) controlCompleted = true
            else if (!controlCompleted) controlFailed = true
          })
          .catch(() => {
            if (settled) return
            controlFailed = true
            controlAbort.abort()
            try { child.stdin?.end() } catch { /* timeout containment remains armed */ }
          })
      }
    })
    child.once("exit", (code, signal) => {
      exitObserved = true
      observedExitCode = code
      observedExitSignal = signal
      if (options.onSpawn && !controlCompleted) {
        controlFailed = true
        controlAbort.abort()
      }
    })
    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8")
      let current = stream === "stdout" ? stdout : stderr
      let tail = stream === "stdout" ? stdoutTail : stderrTail
      let truncated = stream === "stdout" ? stdoutTruncated : stderrTruncated
      if (!truncated && Buffer.byteLength(current) + chunk.length <= maxOutputBytes) {
        current += text
      } else {
        const half = Math.floor(maxOutputBytes / 2)
        if (!truncated) {
          const combined = current + text
          current = combined.slice(0, half)
          tail = combined.slice(-half)
          truncated = true
        } else {
          tail = (tail + text).slice(-half)
        }
      }
      if (stream === "stdout") { stdout = current; stdoutTail = tail; stdoutTruncated = truncated }
      else { stderr = current; stderrTail = tail; stderrTruncated = truncated }
    }
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk))
    timeoutTimer = dependencies.setTimeout(() => {
      if (options.onSpawn) onControlledTimeout()
      else {
        timedOut = true
        terminateProcessTree(child)
      }
    }, options.timeoutMs)
    child.once("error", (error) => {
      if (options.onSpawn && spawnObserved) {
        controlErrorMessage = error.message
        onControlledTimeout()
        return
      }
      controlAbort.abort()
      if (options.onSpawn && !controlStarted) controlFailed = true
      finish({
        exitCode: null,
        signal: null,
        timedOut,
        stdout: currentOutput().stdout,
        stderr: `${currentOutput().stderr}\n${error.message}`,
        spawnObserved,
        exitObserved,
        closeObserved: false,
        hostProcessIdentitySha256,
      })
    })
    child.once("close", (code, signal) => {
      finish({
        exitCode: code,
        signal,
        timedOut,
        ...currentOutput(),
        spawnObserved,
        exitObserved,
        closeObserved: true,
        hostProcessIdentitySha256,
      })
    })
  })
}

function runDsh(nodeExecutable: string, dshExecutable: string, args: string[], options: RunOptions): Promise<CommandResult> {
  // findExecutable resolves symlinks, so the DSH bin becomes lib/bin.js.
  // Invoke that script with the selected Node binary instead of relying on the
  // parent runtime's shebang handling for a directly spawned JavaScript file.
  return run(nodeExecutable, [dshExecutable, ...args], options)
}

function runDshWithPty(scriptExecutable: string, nodeExecutable: string, dshExecutable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CommandResult> {
  const command = [nodeExecutable, dshExecutable, ...args].map(shellQuote).join(" ")
  return run(scriptExecutable, ["-q", "-e", "-c", command, "/dev/null"], options)
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM")
    else child.kill("SIGTERM")
  } catch {
    // It may have exited between timeout and signal delivery.
  }
  const forceTimer = setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL")
      else child.kill("SIGKILL")
    } catch {
      // Already exited.
    }
  }, 1_500)
  forceTimer.unref()
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function inventoryTree(root: string): Record<string, string> {
  const inventory: Record<string, string> = {}
  const visit = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        inventory[relativePath] = `symlink:${readlinkSync(absolute)}`
      } else if (entry.isDirectory()) {
        visit(absolute, relativePath)
      } else if (entry.isFile()) {
        inventory[relativePath] = hashFile(absolute)
      }
    }
  }
  visit(root)
  return inventory
}

function jsonSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")
}

function crossProcessAnalysisStoreHashes(workspace: string, planId: string): Record<string, string | null> {
  const allFiles = inventoryTree(workspace)
  const analysisFiles = Object.fromEntries(Object.entries(allFiles).filter(([path]) => path.startsWith(".banca/analysis/")))
  return {
    analysisInventorySha256: jsonSha256(analysisFiles),
    checkpointSha256: analysisFiles[".banca/analysis/checkpoints/" + planId + ".json"] ?? null,
    auditConfirmationsSha256: analysisFiles[".banca/analysis/audit-confirmations/" + planId + ".json"] ?? null,
    findingsSha256: analysisFiles[".banca/analysis/findings/" + planId + ".json"] ?? null,
  }
}

function crossProcessWorkspaceFilesystemIdentitySha256(workspace: string, scratch: string, key: Buffer, directoryFd: number): string {
  const opened = fstatSync(directoryFd, { bigint: true })
  const named = statSync(workspace, { bigint: true })
  if (!opened.isDirectory() || !named.isDirectory() || opened.dev !== named.dev || opened.ino !== named.ino) {
    throw new Error("cross-process synthetic workspace path no longer refers to the parent-held original directory")
  }
  return createHmac("sha256", key)
    .update(JSON.stringify(["dshbanca-workspace-fs-v1", relative(scratch, workspace), String(opened.dev), String(opened.ino)]), "utf8")
    .digest("hex")
}

// Pure fixture edit: one BMP prose span only; no commands, newlines or identity/store edits.
function mutateSyntheticLatexContent(content: string): string {
  const oldText = "30 participantes"
  const newText = "31 participantes"
  if (content.split(oldText).length !== 2 || oldText.length !== newText.length) {
    throw new Error("source drift synthetic prose anchor is absent or ambiguous")
  }
  const changed = content.replace(oldText, newText)
  if (changed === content || changed.length !== content.length) throw new Error("source drift must preserve UTF-16 length")
  return changed
}

function canonicalSyntheticPlan(workspace: string) {
  const config = loadConfig(workspace)
  const manuscript = loadCanonicalLatexManuscript(workspace, config)
  const plan = planExhaustiveAnalysisBatches(manuscript, config.analysis.maxCharactersPerBatch)
  if (plan.status !== "complete" || plan.coverage.batchCount !== 5 || plan.coverage.totalCharacters !== 595) {
    throw new Error("source drift canonical synthetic plan is not complete with five batches and 595 characters")
  }
  return {
    planId: computePlanIdentity(plan), manuscriptFingerprint: plan.fingerprint,
    totalBatches: plan.coverage.batchCount, totalCharacters: plan.coverage.totalCharacters,
    firstBatchId: plan.batches[0].batchId,
    batchIds: plan.batches.map((batch) => batch.batchId),
  }
}

function sourceDriftProcessProof(result: CommandResult, sidecar: any, markerPath: string, dshExecutableSha256: string, profileIdentitySha256: string) {
  const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, "utf8")) : null
  const hostIdentitySha256 = result.hostProcessIdentitySha256
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || !result.spawnObserved || !result.exitObserved || !result.closeObserved || !hostIdentitySha256 || sidecar?.observerProcessIdentitySha256 !== hostIdentitySha256 || marker?.event !== "beforeExit" || marker?.nativeShutdownCompleted !== true || marker?.processExitCodeAtBeforeExit !== 0 || marker?.observerProcessIdentitySha256 !== hostIdentitySha256) {
    throw new Error("source drift requires observed native process shutdown, sidecar identity and teardown before continuing")
  }
  return {
    dshExecutableSha256, profileIdentitySha256, hostIdentitySha256,
    observerIdentitySha256: sidecar.observerProcessIdentitySha256, identityMatched: true,
    spawnObserved: true, kernelStartIdentityObserved: true, exitObserved: true,
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut,
    forcedTermination: false, naturalBeforeExitObserved: true, nativeTeardownMarkerObserved: true,
  }
}

function parentAbruptFindingProjection(finding: any): Record<string, unknown> | null {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) return null
  const keys = Object.keys(finding).sort()
  const expectedKeys = [
    "batchId", "category", "claim", "endLine", "evidence", "file", "findingId",
    "manuscriptFingerprint", "planId", "sectionId", "severity", "startLine", "version",
  ].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) return null
  const digestText = (text: unknown) => typeof text === "string" ? createHash("sha256").update(text, "utf8").digest("hex") : null
  const provenance = [finding.category, finding.severity, finding.file, finding.startLine, finding.endLine, finding.sectionId]
  return {
    version: finding.version,
    findingId: finding.findingId,
    planId: finding.planId,
    batchId: finding.batchId,
    manuscriptFingerprint: finding.manuscriptFingerprint,
    provenanceSha256: createHash("sha256").update(JSON.stringify(provenance), "utf8").digest("hex"),
    claimSha256: digestText(finding.claim),
    evidenceSha256: digestText(finding.evidence),
  }
}

function verifyParentAbruptRestartPersistence(workspace: string, phaseOne: any): { evidence: Record<string, unknown> | null; errors: string[] } {
  const errors: string[] = []
  const require = (condition: boolean, message: string) => { if (!condition) errors.push(message) }
  const planId = typeof phaseOne?.planId === "string" ? phaseOne.planId : ""
  const fingerprint = typeof phaseOne?.manuscriptFingerprint === "string" ? phaseOne.manuscriptFingerprint : ""
  if (!/^[a-f0-9]{64}$/.test(planId) || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    return { evidence: null, errors: ["parent cannot derive safe plan-bound persisted-file paths"] }
  }
  let beforeInventory: Record<string, string> = {}
  try { beforeInventory = inventoryTree(workspace) } catch { errors.push("parent could not inventory the durable workspace before parsing") }
  let checkpoint: any
  let confirmations: any
  let findings: any
  let checkpointFileParsed = false
  let receiptFileParsed = false
  let findingFileParsed = false
  try {
    checkpoint = JSON.parse(readFileSync(join(workspace, ".banca", "analysis", "checkpoints", `${planId}.json`), "utf8"))
    checkpointFileParsed = true
  } catch { errors.push("parent could not parse the durable checkpoint file") }
  try {
    confirmations = JSON.parse(readFileSync(join(workspace, ".banca", "analysis", "audit-confirmations", `${planId}.json`), "utf8"))
    receiptFileParsed = true
  } catch { errors.push("parent could not parse the durable receipt file") }
  try {
    findings = JSON.parse(readFileSync(join(workspace, ".banca", "analysis", "findings", `${planId}.json`), "utf8"))
    findingFileParsed = true
  } catch { errors.push("parent could not parse the durable finding file") }

  let afterInventory: Record<string, string> = {}
  try { afterInventory = inventoryTree(workspace) } catch { errors.push("parent could not inventory the durable workspace after parsing") }
  const workspaceInventorySha256 = jsonSha256(afterInventory)
  const analysisFiles = Object.fromEntries(Object.entries(afterInventory).filter(([path]) => path.startsWith(".banca/analysis/")))
  const persistence = {
    analysisInventorySha256: jsonSha256(analysisFiles),
    checkpointSha256: analysisFiles[`.banca/analysis/checkpoints/${planId}.json`] ?? null,
    auditConfirmationsSha256: analysisFiles[`.banca/analysis/audit-confirmations/${planId}.json`] ?? null,
    findingsSha256: analysisFiles[`.banca/analysis/findings/${planId}.json`] ?? null,
  }
  require(JSON.stringify(beforeInventory) === JSON.stringify(afterInventory), "parent observed workspace mutation while validating durable files")
  require(workspaceInventorySha256 === phaseOne?.workspaceInventorySha256, "parent inventory differs from phase-one readiness evidence")
  require(persistence.checkpointSha256 === phaseOne?.persistence?.checkpointSha256, "parent checkpoint hash differs from phase-one readiness evidence")
  require(persistence.auditConfirmationsSha256 === phaseOne?.persistence?.auditConfirmationsSha256, "parent receipt hash differs from phase-one readiness evidence")
  require(persistence.findingsSha256 === phaseOne?.persistence?.findingsSha256, "parent finding hash differs from phase-one readiness evidence")
  require(persistence.analysisInventorySha256 === phaseOne?.persistence?.analysisInventorySha256, "parent analysis inventory hash differs from phase-one readiness evidence")

  let canonicalPlan: ReturnType<typeof canonicalSyntheticPlan> | null = null
  try { canonicalPlan = canonicalSyntheticPlan(workspace) } catch { errors.push("parent could not recompute the canonical plan from the durable synthetic manuscript") }
  const checkpointProjection = checkpoint && {
    planId: checkpoint.planId,
    manuscriptFingerprint: checkpoint.fingerprint,
    totalBatches: checkpoint.totalBatches,
    completedBatches: checkpoint.completedBatches,
    completedCharacters: checkpoint.completedCharacters,
    totalCharacters: checkpoint.totalCharacters,
    coveragePercent: checkpoint.coveragePercent,
    state: checkpoint.state,
    nextBatchId: canonicalPlan?.batchIds[2] ?? null,
    nextBatchIndex: checkpoint.completedBatches,
  }
  require(
    canonicalPlan !== null && canonicalPlan.planId === planId && canonicalPlan.manuscriptFingerprint === fingerprint &&
      canonicalPlan.totalBatches === 5 && canonicalPlan.totalCharacters === 595 && canonicalPlan.batchIds.length === 5 &&
      checkpointFileParsed && checkpoint?.version === "analysis-checkpoint-v2" &&
      checkpoint.planId === planId && checkpoint.fingerprint === fingerprint &&
      checkpoint.strategy === "ordered-source-spans-exhaustive-v1" &&
      checkpoint.totalBatches === 5 && checkpoint.completedBatches === 2 &&
      checkpoint.totalCharacters === 595 && checkpoint.completedCharacters === phaseOne?.checkpoint?.completedCharacters &&
      checkpoint.coveragePercent === phaseOne?.checkpoint?.coveragePercent && checkpoint.state === "running" &&
      JSON.stringify(checkpointProjection) === JSON.stringify(phaseOne?.checkpoint),
    "parent-parsed checkpoint is not the exact durable 2/5 phase-one projection",
  )
  const findingRows = Array.isArray(findings?.findings) ? findings.findings : []
  const persistedFindingId = typeof findingRows[0]?.findingId === "string" ? findingRows[0].findingId : ""
  const receiptRows = Array.isArray(confirmations?.confirmations) ? confirmations.confirmations : []
  const receiptBatchIds = receiptRows.map((receipt: any) => receipt?.batchId)
  const firstTwoBatchIds = Array.isArray(phaseOne?.persistedBatchIds) ? phaseOne.persistedBatchIds : []
  require(
    receiptFileParsed && confirmations?.version === "analysis-audit-confirmations-store-v1" &&
      confirmations.planId === planId && confirmations.manuscriptFingerprint === fingerprint &&
      receiptRows.length === 2 && JSON.stringify(receiptBatchIds) === JSON.stringify(firstTwoBatchIds) &&
       JSON.stringify(firstTwoBatchIds) === JSON.stringify(canonicalPlan?.batchIds.slice(0, 2)) &&
      firstTwoBatchIds.length === 2 && new Set(receiptBatchIds).size === 2 &&
      receiptRows.every((receipt: any, index: number) => {
        const expectedFindingIds = index === 0 ? [] : (persistedFindingId ? [persistedFindingId] : [])
        const expectedFindingsDigest = computeBatchFindingsDigest(expectedFindingIds)
        const expectedSubmissionId = computeAuditSubmissionId({
          planId, manuscriptFingerprint: fingerprint, batchId: typeof receipt?.batchId === "string" ? receipt.batchId : "",
          batchIndex: index, acceptedCount: index === 0 ? 0 : 1, findingsDigest: expectedFindingsDigest,
        })
        return receipt?.version === "batch-audit-confirmation-v1" && receipt.planId === planId &&
          receipt.manuscriptFingerprint === fingerprint && receipt.batchIndex === index &&
          receipt.acceptedCount === (index === 0 ? 0 : 1) && typeof receipt.disclaimer === "string" && receipt.disclaimer.length > 0 &&
          Array.isArray(receipt.findingIds) && JSON.stringify(receipt.findingIds) === JSON.stringify(expectedFindingIds) &&
          receipt.findingsDigest === expectedFindingsDigest && receipt.submissionId === expectedSubmissionId
      }),
    "parent-parsed receipt file does not contain exactly two ordered phase-one confirmations",
  )
  const finding = findingRows.length === 1 ? parentAbruptFindingProjection(findingRows[0]) : null
  require(
    findingFileParsed && findings?.version === "analysis-findings-store-v1" &&
      findings.planId === planId && findings.manuscriptFingerprint === fingerprint &&
      findingRows.length === 1 && finding !== null &&
      JSON.stringify(finding) === JSON.stringify(phaseOne?.finding),
    "parent-parsed finding file does not contain the original valid finding exactly once",
  )
  if (errors.length > 0 || !checkpointProjection || !finding) return { evidence: null, errors }
  return {
    evidence: {
      source: "parent-read-persisted-files",
      verifiedBeforeSignal: true,
      checkpointFileParsed,
      receiptFileParsed,
      findingFileParsed,
      workspaceInventorySha256,
      persistence,
      checkpoint: checkpointProjection,
      receiptCount: receiptRows.length,
      receiptBatchIds,
      findingsCount: findingRows.length,
      finding,
    },
    errors,
  }
}

async function waitForObserverJson(
  path: string,
  child: ReturnType<typeof spawn>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<any> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal.aborted || child.exitCode !== null || child.signalCode !== null) {
      throw new Error("controlled DSH child stopped before publishing its readiness evidence")
    }
    if (existsSync(path)) {
      try { return JSON.parse(readFileSync(path, "utf8")) } catch { /* wait for the exclusive write to finish */ }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
  }
  throw new Error("controlled DSH child did not publish readiness evidence before timeout")
}

function repoStatus(): string | null {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 })
  return result.status === 0 ? result.stdout : null
}

export function createReportPersistencePlan(options: ReportPersistenceOptions): ReportPersistencePlan {
  if (!options.abruptRestartRequested) {
    const configured = options.configuredReportPath?.trim()
    return Object.freeze({
      mode: "legacy" as const,
      authorized: true,
      path: configured ? resolve(options.repositoryRoot, configured) : resolve(options.repositoryRoot, options.defaultReportPath),
    })
  }
  const blocked = (reason: string): ReportPersistencePlan => Object.freeze({ mode: "abrupt" as const, authorized: false, reason })
  const configured = options.configuredReportPath
  const approved = options.abruptReportPath
  if (!configured || !approved || configured !== configured.trim() || approved !== approved.trim() || configured !== approved) {
    return blocked("the abrupt report target must be explicitly approved and identically configured")
  }
  if (!isAbsolute(approved) || approved.includes("\0") || resolve(approved) !== approved || basename(approved) === "" || basename(approved) === "." || basename(approved) === "..") {
    return blocked("the abrupt report target must be an unambiguous normalized absolute file path")
  }
  try {
    const target = approved
    const targetParent = dirname(target)
    const canonicalRepository = realpathSync(options.repositoryRoot)
    const canonicalTemp = realpathSync(options.temporaryRoot)
    const canonicalParent = realpathSync(targetParent)
    if (canonicalParent !== targetParent) return blocked("the abrupt report parent must not contain symlink aliases")
    const relativeToTemp = relative(canonicalTemp, canonicalParent)
    if (relativeToTemp === ".." || relativeToTemp.startsWith(`..${sep}`) || isAbsolute(relativeToTemp)) {
      return blocked("the abrupt report parent must remain under the canonical OS temporary root")
    }
    const relativeToRepository = relative(canonicalRepository, target)
    if (relativeToRepository === "" || (relativeToRepository !== ".." && !relativeToRepository.startsWith(`..${sep}`)) || isAbsolute(relativeToRepository)) {
      return blocked("abrupt reports must remain outside the checkout")
    }
    const parentStat = statSync(canonicalParent)
    if (!parentStat.isDirectory()) return blocked("the abrupt report parent must already be an existing directory")
    const sticky = (parentStat.mode & 0o1000) !== 0
    const currentUid = typeof process.getuid === "function" ? process.getuid() : null
    const privateOwner = currentUid !== null && parentStat.uid === currentUid && (parentStat.mode & 0o022) === 0
    const safeStickyRoot = parentStat.uid === 0 && sticky
    if (!privateOwner && !safeStickyRoot) return blocked("the abrupt report parent must be private to this user or a sticky OS temp root")
    try {
      lstatSync(target)
      return blocked("the abrupt report target already exists and will not be overwritten")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return blocked("the abrupt report target could not be verified as new")
    }
    return Object.freeze({
      mode: "abrupt" as const,
      authorized: true,
      path: target,
      canonicalParent,
      parentDevice: parentStat.dev,
      parentInode: parentStat.ino,
    })
  } catch {
    return blocked("the abrupt report parent must already exist and be canonically resolvable under OS temp")
  }
}

export function persistReportWithPlan(plan: ReportPersistencePlan, value: unknown): "written" | "blocked" {
  if (!plan.authorized || !plan.path) return "blocked"
  const safeReport = sanitizeReport(value)
  const contents = `${JSON.stringify(safeReport, null, 2)}\n`
  if (plan.mode === "legacy") {
    mkdirSync(dirname(plan.path), { recursive: true })
    writeFileSync(plan.path, contents, { mode: 0o600 })
    return "written"
  }
  if (!plan.canonicalParent || plan.parentDevice === undefined || plan.parentInode === undefined) {
    throw new Error("abrupt report persistence plan lacks canonical parent identity")
  }
  const currentParent = realpathSync(dirname(plan.path))
  if (currentParent !== plan.canonicalParent) throw new Error("abrupt report parent path changed after authorization")
  // Bind the exclusive leaf creation to this validated directory descriptor, not a second path lookup.
  const parentDescriptor = openSync(
    currentParent,
    fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
  )
  try {
    const parentStat = fstatSync(parentDescriptor)
    if (parentStat.dev !== plan.parentDevice || parentStat.ino !== plan.parentInode) {
      throw new Error("abrupt report parent identity changed after authorization")
    }
    const descriptor = openSync(
      `/proc/self/fd/${parentDescriptor}/${basename(plan.path)}`,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    )
    try {
      writeFileSync(descriptor, contents)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
  } finally {
    closeSync(parentDescriptor)
  }
  return "written"
}

function writeReport(): "written" | "blocked" {
  report.finishedAt = new Date().toISOString()
  report.status = finalStatus
  return persistReportWithPlan(reportPersistencePlan, report)
}

function fail(message: string, status: "FAIL" | "BLOCKED" = "FAIL"): void {
  const safeFailure = sanitizeReport({ message }) as { message: string }
  report.failures.push(safeFailure.message)
  finalStatus = status
}

function gitValue(args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 })
  return result.status === 0 ? result.stdout.trim() : null
}

function abruptRestartAuthorizationBlocker(
  currentSha: string | null,
  workingTreeStatus: string | null,
  authorization: { approved?: string; sha256?: string; scenario?: string; environment?: string; reportPath?: string },
): string | null {
  if (abruptRestartRequested && (!reportPersistencePlan.authorized || reportPersistencePlan.mode !== "abrupt")) {
    return `BLOCKED: abrupt report persistence was refused (${reportPersistencePlan.reason ?? "destination not authorized"})`
  }
  if (authorization.approved !== "yes") return "NEEDS_APPROVAL: DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_AUTHORIZED=yes was not supplied"
  if (!currentSha || authorization.sha256 !== currentSha) return "NEEDS_APPROVAL: authorization SHA does not equal the exact current runner commit"
  if (authorization.scenario !== "durable-checkpoint-2-of-5-sigkill") return "NEEDS_APPROVAL: the exact abrupt-restart scenario was not approved"
  if (authorization.environment !== "runner-owned-scratch-only") return "NEEDS_APPROVAL: the isolated runner-owned scratch environment was not approved"
  if (
    !authorization.reportPath || !configuredReportPath || authorization.reportPath !== configuredReportPath ||
    reportPersistencePlan.mode !== "abrupt" || !reportPersistencePlan.authorized || reportPersistencePlan.path !== authorization.reportPath
  ) return "NEEDS_APPROVAL: a new isolated report path must be approved explicitly outside the checkout"
  if (workingTreeStatus !== "") return "BLOCKED: the approved runner commit must have a clean working tree"
  if (process.platform !== "linux") return "BLOCKED: owned-child identity verification requires Linux procfs"
  return null
}

function ensureInside(base: string, path: string): void {
  const relativePath = relative(base, path)
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || resolve(path) === resolve(base)) {
    throw new Error("scratch isolation check failed: a configured write path escapes the unique sandbox")
  }
}

function createObserverPackage(
  observerRoot: string,
  workspace: string,
  observerResult: string,
  restartWorkspace: string,
  restartObserverResultOne: string,
  restartObserverResultTwo: string,
  restartTeardownMarkerOne: string,
  restartTeardownMarkerTwo: string,
  abruptRestartWorkspace: string,
  abruptObserverResultOne: string,
  abruptObserverResultTwo: string,
  abruptTeardownMarkerOne: string,
  abruptTeardownMarkerTwo: string,
  abruptParentDecisionToken: string,
  auditorMarkdownSourceSha256: string | null,
  auditorMarkdownSourceSha1: string | null,
): void {
  mkdirSync(observerRoot, { recursive: true, mode: 0o700 })
  writeFileSync(join(observerRoot, "package.json"), JSON.stringify({
    name: observerName,
    version: "0.0.0",
    type: "module",
    main: "./index.js",
    exports: "./index.js",
  }, null, 2) + "\n")
  copyRequiredAcademicDecisionModule(repositoryRoot, observerRoot)
  const observerSource = `import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const name = ${JSON.stringify(observerName)};
export const inject = ["tools", "skills", "sessions", "agents", "agentPresets", "sessionProjections", "userQuestions", "approval"];
const expected = ${JSON.stringify(expectedTools)};
const expectedNativeSkillsList = [
  "banca-avaliacao",
  "banca-correcao",
  "banca-detector-ia",
  "banca-grille",
  "banca-plagio",
  "banca-planejador",
  "banca-referencias",
  "banca-revisor"
];
const expectedNativeSkillProvider = "dshbanca";
const canonicalNativeSkillsMeta = {
  "banca-avaliacao": {
    "sourcePath": "skills/banca-avaliacao/SKILL.md",
    "sourceSha256": "60bdcd97061da7748f7d1f9d6d7999fd62afac9b1269bf089eb23da7aab7c85e",
    "bodySha256": "840e88e69a1d816fb24514d92fe0f1dac43098d16a7517fffb1e62e08f0b7a47",
    "bodyLength": 7589
  },
  "banca-correcao": {
    "sourcePath": "skills/banca-correcao/SKILL.md",
    "sourceSha256": "d0a05d3feb78f5ef05615a48892b3c5cdc88fc589b3fc2100f2d78a0a32d45c7",
    "bodySha256": "330b72a1154c2b0c2c4db9257817f8583c29e5d0e43d1442fe79eecfc3598bd3",
    "bodyLength": 1924
  },
  "banca-detector-ia": {
    "sourcePath": "skills/banca-detector-ia/SKILL.md",
    "sourceSha256": "db296d3e384e809847b2398638d55c2bcf62e092c2058943013a7523cb1b6a4b",
    "bodySha256": "69be0b5a2debf9dc3b177e9a593928d82421caa4985e9d6b1ce6de8469fa8eb5",
    "bodyLength": 1537
  },
  "banca-grille": {
    "sourcePath": "skills/banca-grille/SKILL.md",
    "sourceSha256": "9a861c773444a1fc537619202bb0818936bafd313efdd9438d3eb1985d0fc6e6",
    "bodySha256": "334cb1743f8542c1c05373361fe47d59ed94e47a39e10475105fecd7f8d443d3",
    "bodyLength": 4835
  },
  "banca-plagio": {
    "sourcePath": "skills/banca-plagio/SKILL.md",
    "sourceSha256": "1159f65153fad06086fa0debefe41a567cf895d251b1dd4f52a2849ae1146661",
    "bodySha256": "c1131ca56ac512d4182db27b35845930bde9fc7a401707b6aa19acc1e0ce1a6c",
    "bodyLength": 1913
  },
  "banca-planejador": {
    "sourcePath": "skills/banca-planejador/SKILL.md",
    "sourceSha256": "d39405b0333e53eabd616104d4387dd0f77c26d505d63bed9094a8ae254eac64",
    "bodySha256": "f5a9e935b54f027f9f82f936cd692ef6b952b4e583546169b85b2fd5fd00a20e",
    "bodyLength": 1856
  },
  "banca-referencias": {
    "sourcePath": "skills/banca-referencias/SKILL.md",
    "sourceSha256": "b5b73abbbae029adc82980b2045c705b091b1629a44d14efab92aa731008d36b",
    "bodySha256": "d41cad0de66968a7fc1d74e0b8223326e6f6e73ac965c3b31f93d65c8e7c3ed8",
    "bodyLength": 1702
  },
  "banca-revisor": {
    "sourcePath": "skills/banca-revisor/SKILL.md",
    "sourceSha256": "deb90fe58a8d334bddd9f4dc66810cb5c57621cc63bad313c44c199c042de798",
    "bodySha256": "126b884ba795ea9c66f50ba18a4a1a2dfe7382bfba00107db76114cb30242216",
    "bodyLength": 2042
  }
};
const auditorMarkdownSourceSha256 = ${JSON.stringify(auditorMarkdownSourceSha256)};
const auditorMarkdownSourceSha1 = ${JSON.stringify(auditorMarkdownSourceSha1)};
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const sha1 = async (path) => createHash("sha1").update(await readFile(path)).digest("hex");
const inventory = async (root, prefix = "") => {
  const result = {};
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    const path = join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await inventory(path, rel));
    else if (entry.isFile()) result[rel] = await sha(path);
    else throw new Error("unexpected symlink/special file in synthetic workspace");
  }
  return result;
};
const fail = (message) => { throw new Error("DSHbanca profile E2E observer: " + message); };
const waitForParentAcknowledgement = (path, expectedContents) => new Promise((resolve) => {
  const interval = setInterval(() => {
    readFile(path, "utf8").then((contents) => {
      if (contents === expectedContents) {
        clearInterval(interval);
        resolve();
      }
    }).catch(() => {});
  }, 25);
});
const resultMessage = (result) => {
  if (typeof result?.error?.message === "string") return result.error.message;
  const content = Array.isArray(result?.content)
    ? result.content.filter((block) => block.type === "text").map((block) => block.text).join("\\n")
    : "";
  if (content) return content.replace(/^Error:\\s*/, "");
  return typeof result?.value === "string" ? result.value : "";
};
export const crossProcessToolErrorCode = (message) => {
  if (typeof message !== "string") return null;
  const lines = message.split(String.fromCharCode(10));
  if (lines.length !== 3 || lines[0] !== "context checkpoint error" || !lines[1].startsWith("code=") || !lines[2].startsWith("message=")) return null;
  const code = lines[1].slice("code=".length);
  return /^[a-z][a-z0-9_]*$/.test(code) ? code : null;
};
export const crossProcessSynthesisRefusal = (outcome, checkpoint) => {
  if (outcome?.result?.isError !== false || typeof outcome.result.value !== "string" || typeof outcome.message !== "string") return null;
  if (checkpoint?.totalBatches !== 5 || !Number.isInteger(checkpoint.completedBatches) ||
      checkpoint.completedBatches < 0 || checkpoint.completedBatches >= checkpoint.totalBatches) return null;
  const expectedState = checkpoint.completedBatches === 0 ? "pending" : "running";
  if (checkpoint.state !== expectedState) return null;
  const expectedMessage = 'global synthesis requires checkpoint.state === "complete"; received "' + expectedState + '"';
  const lines = outcome.result.value.split(String.fromCharCode(10));
  if (lines.length !== 3 || lines[0] !== "synthesis input error" || lines[1] !== "code=incomplete_coverage" ||
      lines[2] !== "message=" + expectedMessage || outcome.message !== outcome.result.value) return null;
  return { errorCode: "incomplete_coverage", errorMessage: expectedMessage };
};
const runTool = async (context, callId, name, args, agent) => {
  const controller = new AbortController();
  const result = await context.tools.execute({ callId, name, arguments: args, agent, signal: controller.signal });
  return { result, message: resultMessage(result), aborted: controller.signal.aborted };
};
const modelEventCount = (session) => session.snapshotEvents().filter((event) =>
  event.type === "request/header"
).length;
// Native dsh-agent-instructions uses syncInbox() on a downstream pre-step
// reject. That stages the user instruction in nextStep without placing it in
// decision.messages. Observe both surfaces without releasing the safety reject.
export function captureNativeInstructionMessages(decisionMessages, queuedMessages, requiredPath = "banca-auditor.md") {
  const results = [];
  const seen = new Set();
  for (const [channel, messages] of [["pre-step-decision", decisionMessages], ["post-reject-inbox", queuedMessages]]) {
    for (const message of Array.isArray(messages) ? messages : []) {
      if (message?.source?.kind !== "agent-instructions" ||
          !Array.isArray(message.source.changes) ||
          (requiredPath !== null && !message.source.changes.some((change) => change?.path === requiredPath))) continue;
      const identity = typeof message.id === "string" && message.id ? message.id : message;
      if (seen.has(identity)) continue;
      seen.add(identity);
      results.push({ channel, message });
    }
  }
  return results;
}
const decoyOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};
${renderControlPresetSelector(e2eControlPresetId)}

const parseContextMeta = async (contextOutput) => {
  const filePath = contextOutput.replace(/^context → /, "").trim();
  const content = await readFile(filePath, "utf8");
  const fence = String.fromCharCode(96, 96, 96);
  const startMarker = fence + "json\\n";
  const endMarker = "\\n" + fence;
  const start = content.indexOf(startMarker);
  if (start === -1) fail("academic probe: failed to find json start in " + filePath);
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (end === -1) fail("academic probe: failed to find json end in " + filePath);
  const jsonStr = content.slice(start + startMarker.length, end);
  return JSON.parse(jsonStr);
};

export async function runAcademicBatchAuditProbe(ctx, workspace, agent) {
  const configPath = join(workspace, ".banca", "project.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  // The 595-character synthetic fixture yields the five issue #98 batches at this budget.
  const maxCharsPerBatch = 120;
  config.analysis = { coverageMode: "exhaustive", maxCharactersPerBatch: maxCharsPerBatch };
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });

  const chapterFiles = [
    "capitulos/lote1.tex",
    "capitulos/lote2.tex",
    "capitulos/lote3.tex",
    "capitulos/lote4.tex",
    "capitulos/lote5.tex",
  ];
  const manuscriptFiles = [
    "main.tex",
    "referencias.bib",
    ...chapterFiles,
  ];
  const initialManuscriptHashes = {};
  for (const rel of manuscriptFiles) {
    initialManuscriptHashes[rel] = await sha(join(workspace, rel));
  }

  let totalManuscriptChars = (await readFile(join(workspace, "main.tex"), "utf8")).length;
  for (const rel of chapterFiles) {
    totalManuscriptChars += (await readFile(join(workspace, rel), "utf8")).length;
  }
  const expectedTotalBatches = Math.ceil(totalManuscriptChars / maxCharsPerBatch);
  const shaText = (text) => createHash("sha256").update(text, "utf8").digest("hex");
  const identityHashKey = randomBytes(32);
  const identityDigest = (value) => createHmac("sha256", identityHashKey).update(value, "utf8").digest("hex");

  const effectivePreset = ctx.agentPresets?.composedPreset?.(agent?.ctx);
  const agentId = typeof agent?.id === "string" ? agent.id : "";
  const sessionId = typeof agent?.session?.id === "string" ? agent.session.id : "";
  const auditorIdentity = {
    createdVia: "ctx.agents.create",
    agentId: agentId.length > 0 ? identityDigest(agentId) : "",
    sessionId: sessionId.length > 0 ? identityDigest(sessionId) : "",
    agentAndSessionIdMatch: agentId.length > 0 && agentId === sessionId,
    agentRegistryContainsAgent: Boolean(agent && ctx.agents?.get(agentId) === agent),
    sessionStoreContainsSession: Boolean(agent?.session && ctx.sessions?.get(agentId) === agent.session),
    effectivePreset: effectivePreset ?? "",
    toolRuntime: typeof ctx.tools?.execute === "function" ? "ctx.tools.execute" : "",
  };
  if (
    auditorIdentity.createdVia !== "ctx.agents.create" ||
    !auditorIdentity.agentAndSessionIdMatch ||
    !auditorIdentity.agentRegistryContainsAgent ||
    !auditorIdentity.sessionStoreContainsSession ||
    auditorIdentity.effectivePreset !== "banca-auditor" ||
    auditorIdentity.toolRuntime !== "ctx.tools.execute"
  ) fail("academic probe: batch audit did not use the live DSH banca-auditor Agent/Session through ToolRuntime");

  const modelEventsBefore = modelEventCount(agent.session);
  const initRes = await runTool(ctx, "dshbanca-e2e-academic-init", "banca_context", {}, agent);
  if (initRes.result.isError) fail("academic probe: banca_context init failed");
  let currentMeta = await parseContextMeta(initRes.message);
  const planId = currentMeta.plan.planId;
  const manuscriptFingerprint = currentMeta.manuscript.fingerprint;
  const totalBatches = currentMeta.checkpoint.totalBatches;
  const planTotalCharacters = currentMeta.plan.totalCharacters;
  if (
    totalBatches !== expectedTotalBatches ||
    totalBatches !== 5 ||
    totalManuscriptChars !== 595 ||
    planTotalCharacters !== 595
  ) {
    fail("academic probe: synthetic manuscript must retain the canonical five batches and 595 characters");
  }
  if (
    currentMeta.plan.status !== "complete" ||
    currentMeta.checkpoint.planId !== planId ||
    currentMeta.checkpoint.totalBatches !== totalBatches ||
    currentMeta.checkpoint.completedBatches !== 0 ||
    typeof planId !== "string" || !/^[a-f0-9]{64}$/.test(planId) ||
    typeof manuscriptFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(manuscriptFingerprint)
  ) fail("academic probe: initial exhaustive plan identity or checkpoint was inconsistent");

  const findingProjection = (finding) => ({
    version: finding.version,
    findingId: finding.findingId,
    planId: finding.planId,
    batchId: finding.batchId,
    manuscriptFingerprint: finding.manuscriptFingerprint,
    provenanceSha256: shaText(JSON.stringify([
      finding.category,
      finding.severity,
      finding.file,
      finding.startLine,
      finding.endLine,
      finding.sectionId,
    ])),
    claimSha256: shaText(finding.claim),
    evidenceSha256: shaText(finding.evidence),
  });
  const deterministicFindingId = (finding) => {
    const fields = [
      "analysis-finding-v1",
      finding.planId,
      finding.manuscriptFingerprint,
      finding.batchId,
      finding.category,
      finding.severity,
      finding.claim,
      finding.evidence,
      finding.file,
      String(finding.startLine),
      String(finding.endLine),
      finding.sectionId,
    ];
    const parts = [];
    for (const field of fields) {
      const bytes = Buffer.from(field, "utf8");
      const header = Buffer.allocUnsafe(4);
      header.writeUInt32BE(bytes.byteLength, 0);
      parts.push(header, bytes);
    }
    return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  };
  const sameProjection = (left, right) =>
    JSON.stringify(left) === JSON.stringify(right);
  const sameFindingPayload = (actual, expected, expectedFindingId) =>
    actual?.version === "analysis-finding-v1" &&
    actual?.findingId === expectedFindingId &&
    actual?.planId === planId &&
    actual?.batchId === expected.batchId &&
    actual?.manuscriptFingerprint === manuscriptFingerprint &&
    actual?.category === expected.category &&
    actual?.severity === expected.severity &&
    actual?.claim === expected.claim &&
    actual?.evidence === expected.evidence &&
    actual?.file === expected.file &&
    actual?.startLine === expected.startLine &&
    actual?.endLine === expected.endLine &&
    actual?.sectionId === expected.sectionId;
  const parseAuditReceipt = (toolResult) => {
    try {
      return JSON.parse(toolResult.message);
    } catch {
      return null;
    }
  };
  const captureAnalysisStoreHashes = async () => {
    const workspaceInventory = await inventory(workspace);
    const analysisFiles = Object.fromEntries(
      Object.entries(workspaceInventory).filter(([path]) => path.startsWith(".banca/analysis/")),
    );
    const hashAt = (path) => analysisFiles[path] ?? null;
    const checkpointSha256 = hashAt(".banca/analysis/checkpoints/" + planId + ".json");
    const auditConfirmationsSha256 = hashAt(".banca/analysis/audit-confirmations/" + planId + ".json");
    const findingsSha256 = hashAt(".banca/analysis/findings/" + planId + ".json");
    const inventorySha256 = shaText(JSON.stringify(analysisFiles));
    if (![checkpointSha256, auditConfirmationsSha256, findingsSha256].every((value) =>
      typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
    )) fail("academic probe: checkpoint, audit confirmations, or findings store was absent before resume-only context query");
    return { inventorySha256, checkpointSha256, auditConfirmationsSha256, findingsSha256 };
  };
  const checkpointEvidence = (meta) => ({
    planId: meta?.checkpoint?.planId,
    manuscriptFingerprint: meta?.manuscript?.fingerprint,
    totalBatches: meta?.checkpoint?.totalBatches,
    completedBatches: meta?.checkpoint?.completedBatches,
    completedCharacters: meta?.checkpoint?.completedCharacters,
    totalCharacters: meta?.checkpoint?.totalCharacters,
    coveragePercent: meta?.checkpoint?.coveragePercent,
    nextBatchId: meta?.batch?.batchId,
    nextBatchIndex: meta?.batch?.index,
  });
  const findSectionSourceInBatch = async (meta) => {
    const sectionPrefix = String.fromCharCode(92) + "section{";
    for (const chunk of Array.isArray(meta?.chunks) ? meta.chunks : []) {
      const file = chunk?.file;
      if (
        typeof file !== "string" || file.length === 0 || file.startsWith("/") ||
        file.split("/").some((part) => part === ".." || part === "") ||
        !Number.isInteger(chunk.startLine) || !Number.isInteger(chunk.endLine) ||
        !Number.isInteger(chunk.startOffset) || !Number.isInteger(chunk.endOffset)
      ) continue;
      const source = await readFile(join(workspace, file), "utf8");
      const lines = source.split(String.fromCharCode(10));
      const firstLine = Math.max(1, chunk.startLine);
      const lastLine = Math.min(lines.length, chunk.endLine);
      for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
        const line = lines[lineNumber - 1];
        const trimmed = line.trim();
        if (!trimmed.startsWith(sectionPrefix) || !trimmed.endsWith("}")) continue;
        const sectionId = trimmed.slice(sectionPrefix.length, -1);
        if (sectionId.length === 0 || sectionId.includes("{") || sectionId.includes("}")) continue;
        const lineStartOffset = lines.slice(0, lineNumber - 1).reduce((sum, item) => sum + item.length + 1, 0);
        const lineEndOffset = lineStartOffset + line.length;
        if (chunk.startOffset > lineStartOffset || chunk.endOffset < lineEndOffset) continue;
        return {
          file,
          startLine: lineNumber,
          endLine: lineNumber,
          sectionId,
          sourceLine: trimmed,
        };
      }
    }
    return null;
  };

  let unverifiedAdvancesBlocked = 0;
  let prematureSynthesisBlocked = 0;
  const prematureSynthesisProbes = [];
  let auditsCompletedWithZeroFindings = 0;
  let auditToolDispatchCount = 0;
  const batchAuditReceiptEvidence = [];
  let orderlyAdvances = 0;
  let resumesWithoutSpuriousAdvance = 0;
  let invalidFindingEvidence = null;
  let nonEmptyFindingEvidence = null;
  let syntheticFindingInput = null;
  const planBatchIds = [];
  const observerProcessId = process.pid;
  let resumedAgentHandle = null;
  let resumedAgent = null;
  let resumedToolDispatchCount = 0;
  let agentSessionResumeEvidence = null;
  let batchAuditResult = null;
  const runBatchTool = async (context, callId, name, args, toolAgent) => {
    if (resumedAgent && toolAgent === resumedAgent) {
      if (
        ctx.agents?.get(toolAgent.id) !== toolAgent ||
        ctx.sessions?.get(toolAgent.id) !== toolAgent.session ||
        ctx.agentPresets?.composedPreset?.(toolAgent.ctx) !== "banca-auditor" ||
        typeof ctx.tools?.execute !== "function"
      ) fail("academic probe: resumed Agent/Session identity, auditor preset, or ToolRuntime became stale");
      resumedToolDispatchCount++;
    }
    return runTool(context, callId, name, args, toolAgent);
  };

  try {
  for (let bIndex = 0; bIndex < totalBatches; bIndex++) {
    const batchAgent = resumedAgent && bIndex >= 2 ? resumedAgent : agent;
    const batchId = currentMeta.batch.batchId;
    if (!batchId || currentMeta.batch.index !== bIndex || currentMeta.batch.totalBatches !== totalBatches) {
      fail("academic probe: live plan did not provide the expected next batch identity");
    }
    planBatchIds.push(batchId);

    const rejAdvance = await runBatchTool(
      ctx,
      "dshbanca-e2e-advance-unverified-" + bIndex,
      "banca_context",
      { completedBatchId: batchId },
      batchAgent,
    );
    if (!rejAdvance.message.includes("missing_batch_audit")) {
      fail("academic probe: advance without audit was not rejected with missing_batch_audit");
    }
    unverifiedAdvancesBlocked++;

    const sectionSource = nonEmptyFindingEvidence ? null : await findSectionSourceInBatch(currentMeta);
    if (sectionSource) {
      const findingInput = {
        category: "structure",
        severity: "low",
        claim: "The synthetic LaTeX span contains an explicit section heading.",
        evidence: sectionSource.file + ":" + sectionSource.startLine + "-" + sectionSource.endLine + ": " + sectionSource.sourceLine,
        file: sectionSource.file,
        startLine: sectionSource.startLine,
        endLine: sectionSource.endLine,
        sectionId: sectionSource.sectionId,
        manuscriptFingerprint,
        batchId,
      };
      const invalidBefore = await inventory(workspace);
      const invalidCall = await runBatchTool(
        ctx,
        "dshbanca-e2e-invalid-finding-" + bIndex,
        "banca_auditar",
        {
          manuscriptFingerprint,
          batchId,
          findings: [{ ...findingInput, startLine: 0, endLine: 0 }],
        },
        batchAgent,
      );
      auditToolDispatchCount++;
      const invalidCode = invalidCall.message.split(String.fromCharCode(10)).find((line) => line.startsWith("code="))?.slice(5) ?? "";
      const invalidAfter = await inventory(workspace);
      const stateBeforeSha256 = shaText(JSON.stringify(invalidBefore));
      const stateAfterSha256 = shaText(JSON.stringify(invalidAfter));
      const statePreserved =
        JSON.stringify(invalidBefore) === JSON.stringify(invalidAfter) &&
        stateBeforeSha256 === stateAfterSha256;
      invalidFindingEvidence = {
        rejected: invalidCode === "invalid_lines",
        errorCode: invalidCode,
        statePreserved,
        stateBeforeSha256,
        stateAfterSha256,
      };
      if (!invalidFindingEvidence.rejected || !statePreserved) {
        fail("academic probe: invalid finding was not rejected atomically before persistence");
      }

      const expectedFindingId = deterministicFindingId({ ...findingInput, planId });
      const expectedProjection = {
        version: "analysis-finding-v1",
        findingId: expectedFindingId,
        planId,
        batchId,
        manuscriptFingerprint,
        provenanceSha256: shaText(JSON.stringify([
          findingInput.category,
          findingInput.severity,
          findingInput.file,
          findingInput.startLine,
          findingInput.endLine,
          findingInput.sectionId,
        ])),
        claimSha256: shaText(findingInput.claim),
        evidenceSha256: shaText(findingInput.evidence),
      };
      const auditRes = await runBatchTool(
        ctx,
        "dshbanca-e2e-audit-nonempty-" + bIndex,
        "banca_auditar",
        { manuscriptFingerprint, batchId, findings: [findingInput] },
        batchAgent,
      );
      auditToolDispatchCount++;
      const receipt = parseAuditReceipt(auditRes);
      if (
        auditRes.result.isError || !receipt ||
        receipt.kind !== "openbanca-audit-receipt-v2" ||
        receipt.planId !== planId ||
        receipt.manuscriptFingerprint !== manuscriptFingerprint ||
        receipt.batchId !== batchId || receipt.batchIndex !== bIndex ||
        receipt.acceptedCount !== 1 || !Array.isArray(receipt.findings) || receipt.findings.length !== 1 ||
        !sameFindingPayload(receipt.findings[0], findingInput, expectedFindingId) ||
        !sameProjection(findingProjection(receipt.findings[0]), expectedProjection) ||
        receipt.persistence?.version !== "analysis-findings-store-v1" ||
        receipt.persistence?.path !== ".banca/analysis/findings/" + planId + ".json" ||
        receipt.persistence?.previousCount !== 0 || receipt.persistence?.addedCount !== 1 ||
        receipt.persistence?.duplicateCount !== 0 || receipt.persistence?.totalCount !== 1
      ) fail("academic probe: non-empty banca_auditar receipt did not preserve the expected deterministic finding identity");

      const storePath = join(workspace, ".banca", "analysis", "findings", planId + ".json");
      const store = JSON.parse(await readFile(storePath, "utf8"));
      if (
        store.version !== "analysis-findings-store-v1" ||
        store.planId !== planId || store.manuscriptFingerprint !== manuscriptFingerprint ||
        !Array.isArray(store.findings) || store.findings.length !== 1 ||
        !sameFindingPayload(store.findings[0], findingInput, expectedFindingId) ||
        !sameProjection(findingProjection(store.findings[0]), expectedProjection)
      ) fail("academic probe: persisted findings store did not contain exactly the expected finding");

      batchAuditReceiptEvidence.push({
        batchIndex: bIndex,
        batchId,
        agentId: identityDigest(batchAgent.id),
        acceptedCount: receipt.acceptedCount,
        receiptFindingCount: receipt.findings.length,
        persistedFindingCount: store.findings.length,
        findingId: receipt.findings[0].findingId,
      });
      syntheticFindingInput = findingInput;
      nonEmptyFindingEvidence = {
        batchIndex: bIndex,
        acceptedCount: receipt.acceptedCount,
        receiptFindingCount: receipt.findings.length,
        persistedFindingCount: store.findings.length,
        synthesisFindingCount: 0,
        deterministicFindingId: receipt.findings[0].findingId === expectedFindingId,
        expected: expectedProjection,
        receipt: findingProjection(receipt.findings[0]),
        persisted: findingProjection(store.findings[0]),
        synthesis: null,
      };
    } else {
      const auditRes = await runBatchTool(
        ctx,
        "dshbanca-e2e-audit-empty-" + bIndex,
        "banca_auditar",
        { manuscriptFingerprint, batchId, findings: [] },
        batchAgent,
      );
      auditToolDispatchCount++;
      const receipt = parseAuditReceipt(auditRes);
      const expectedStoredCount = nonEmptyFindingEvidence ? 1 : 0;
      if (
        auditRes.result.isError || !receipt ||
        receipt.kind !== "openbanca-audit-receipt-v2" ||
        receipt.planId !== planId || receipt.manuscriptFingerprint !== manuscriptFingerprint ||
        receipt.batchId !== batchId || receipt.batchIndex !== bIndex ||
        receipt.acceptedCount !== 0 || !Array.isArray(receipt.findings) || receipt.findings.length !== 0 ||
        receipt.persistence?.version !== "analysis-findings-store-v1" ||
        receipt.persistence?.path !== ".banca/analysis/findings/" + planId + ".json" ||
        receipt.persistence?.previousCount !== expectedStoredCount ||
        receipt.persistence?.addedCount !== 0 || receipt.persistence?.duplicateCount !== 0 ||
        receipt.persistence?.totalCount !== expectedStoredCount
      ) fail("academic probe: empty batch audit did not preserve the findings-store count");
      batchAuditReceiptEvidence.push({
        batchIndex: bIndex,
        batchId,
        agentId: identityDigest(batchAgent.id),
        acceptedCount: receipt.acceptedCount,
        receiptFindingCount: receipt.findings.length,
        persistedFindingCount: receipt.persistence.totalCount,
        findingId: null,
      });
      auditsCompletedWithZeroFindings++;
    }

    prematureSynthesisProbes.push(await runCrossProcessSynthesisProbe(
      ctx, workspace, planId, manuscriptFingerprint, currentMeta, batchAgent,
      "dshbanca-e2e-premature-synth-" + bIndex, runBatchTool,
    ));
    prematureSynthesisBlocked++;

    const advRes = await runBatchTool(
      ctx,
      "dshbanca-e2e-advance-" + bIndex,
      "banca_context",
      { completedBatchId: batchId },
      batchAgent,
    );
    if (advRes.result.isError || advRes.message.includes("context checkpoint error")) {
      fail("academic probe: banca_context advance failed after validated audit");
    }
    orderlyAdvances++;
    const advMeta = await parseContextMeta(advRes.message);
    if (advMeta.checkpoint.completedBatches !== bIndex + 1) {
      fail("academic probe: advance completedBatches did not increase exactly once");
    }

    let resMeta;
    if (bIndex === 1) {
      if (
        advMeta.checkpoint.planId !== planId ||
        advMeta.manuscript.fingerprint !== manuscriptFingerprint ||
        advMeta.checkpoint.totalBatches !== 5 ||
        advMeta.checkpoint.completedBatches !== 2 ||
        advMeta.batch.index !== 2
      ) {
        fail("academic probe: original Agent did not advance the canonical checkpoint to 2/5 before handoff");
      }
      if (!nonEmptyFindingEvidence || nonEmptyFindingEvidence.batchIndex !== 1 || nonEmptyFindingEvidence.persistedFindingCount !== 1) {
        fail("academic probe: the single expected finding was not persisted before Agent/Session handoff");
      }

      resumedAgentHandle = await ctx.agents.create({
        sessionId: "session-dshbanca-e2e-resume-" + process.pid + "-" + Date.now(),
        meta: { cwd: workspace },
      });
      resumedAgent = resumedAgentHandle.agent;
      const resumedSession = resumedAgent.session;
      const presetSelectionResult = await ctx.agentPresets.select(resumedAgent, "banca-auditor");
      const effectivePreset = ctx.agentPresets.composedPreset(resumedAgent.ctx);
      const sessionPresetProjection = ctx.sessionProjections.stateOf(resumedSession, "agentPreset");
      const distinctIdentity =
        resumedAgent !== agent && resumedSession !== agent.session &&
        resumedAgent.id !== agent.id && resumedSession.id !== agent.session.id;
      const workspaceMatches =
        resumedSession.header.cwd === workspace &&
        agent.session.header.cwd === workspace;
      if (
        !distinctIdentity ||
        resumedAgent.id !== resumedSession.id ||
        ctx.agents.get(resumedAgent.id) !== resumedAgent ||
        ctx.sessions.get(resumedAgent.id) !== resumedSession ||
        !workspaceMatches ||
        resumedAgent.status !== "idle" ||
        presetSelectionResult !== "banca-auditor" ||
        effectivePreset !== "banca-auditor" ||
        sessionPresetProjection !== "banca-auditor" ||
        typeof ctx.tools?.execute !== "function" ||
        process.pid !== observerProcessId ||
        modelEventCount(resumedSession) !== 0
      ) fail("academic probe: native same-process Agent/Session handoff did not publish a distinct live banca-auditor identity");

      const checkpointBeforeQuery = checkpointEvidence(advMeta);
      const analysisBefore = await captureAnalysisStoreHashes();
      const findingStoreBefore = JSON.parse(await readFile(
        join(workspace, ".banca", "analysis", "findings", planId + ".json"),
        "utf8",
      ));
      const findingBeforeResume = {
        count: Array.isArray(findingStoreBefore.findings) ? findingStoreBefore.findings.length : 0,
        projection: Array.isArray(findingStoreBefore.findings) && findingStoreBefore.findings.length === 1
          ? findingProjection(findingStoreBefore.findings[0])
          : null,
      };
      if (
        findingStoreBefore.version !== "analysis-findings-store-v1" ||
        findingStoreBefore.planId !== planId ||
        findingStoreBefore.manuscriptFingerprint !== manuscriptFingerprint ||
        findingBeforeResume.count !== 1 ||
        !sameProjection(findingBeforeResume.projection, nonEmptyFindingEvidence.expected)
      ) fail("academic probe: persisted finding did not match the one accepted audit before resume");

      const resumeArgs = {};
      const queryCompletedBatchIdProvided = Object.hasOwn(resumeArgs, "completedBatchId");
      const resRes = await runBatchTool(
        ctx,
        "dshbanca-e2e-resume-agent-session",
        "banca_context",
        resumeArgs,
        resumedAgent,
      );
      if (resRes.result.isError || resRes.message.includes("context checkpoint error")) {
        fail("academic probe: native resumed Agent could not read the persisted academic checkpoint");
      }
      resMeta = await parseContextMeta(resRes.message);
      const checkpointAfterQuery = checkpointEvidence(resMeta);
      const analysisAfter = await captureAnalysisStoreHashes();
      const receiptLedgerBeforeSha256 = analysisBefore.auditConfirmationsSha256;
      const receiptLedgerAfterSha256 = analysisAfter.auditConfirmationsSha256;
      const checkpointWasPreserved =
        checkpointBeforeQuery.planId === checkpointAfterQuery.planId &&
        checkpointBeforeQuery.manuscriptFingerprint === checkpointAfterQuery.manuscriptFingerprint &&
        checkpointBeforeQuery.totalBatches === checkpointAfterQuery.totalBatches &&
        checkpointBeforeQuery.completedBatches === checkpointAfterQuery.completedBatches &&
        checkpointBeforeQuery.completedCharacters === checkpointAfterQuery.completedCharacters &&
        checkpointBeforeQuery.totalCharacters === checkpointAfterQuery.totalCharacters &&
        checkpointBeforeQuery.coveragePercent === checkpointAfterQuery.coveragePercent &&
        checkpointBeforeQuery.nextBatchId === checkpointAfterQuery.nextBatchId &&
        checkpointBeforeQuery.nextBatchIndex === checkpointAfterQuery.nextBatchIndex;
      const analysisStoresUnchanged =
        analysisBefore.inventorySha256 === analysisAfter.inventorySha256 &&
        analysisBefore.checkpointSha256 === analysisAfter.checkpointSha256 &&
        analysisBefore.auditConfirmationsSha256 === analysisAfter.auditConfirmationsSha256 &&
        analysisBefore.findingsSha256 === analysisAfter.findingsSha256;
      if (
        queryCompletedBatchIdProvided ||
        !checkpointWasPreserved ||
        !analysisStoresUnchanged ||
        resMeta.checkpoint.planId !== planId ||
        resMeta.manuscript.fingerprint !== manuscriptFingerprint ||
        resMeta.checkpoint.totalBatches !== 5 ||
        resMeta.checkpoint.completedBatches !== 2 ||
        resMeta.batch.index !== 2 ||
        resMeta.batch.batchId !== advMeta.batch.batchId ||
        receiptLedgerBeforeSha256 !== receiptLedgerAfterSha256
      ) fail("academic probe: resume-only banca_context changed or diverged from persisted checkpoint, finding, or audit evidence");

      agentSessionResumeEvidence = {
        probeExecuted: true,
        executionMode: "same-process-native-dsh",
        syntheticAgentFixture: false,
        sameProcess: process.pid === observerProcessId,
        originalAgentId: auditorIdentity.agentId,
        originalSessionId: auditorIdentity.sessionId,
        agentId: identityDigest(resumedAgent.id),
        sessionId: identityDigest(resumedSession.id),
        createdVia: "ctx.agents.create",
        identityDistinctFromOriginal: distinctIdentity,
        agentAndSessionIdMatch: resumedAgent.id === resumedSession.id,
        agentRegistryContainsAgent: ctx.agents.get(resumedAgent.id) === resumedAgent,
        sessionStoreContainsSession: ctx.sessions.get(resumedAgent.id) === resumedSession,
        workspaceMatches,
        presetSelectionResult,
        effectivePreset,
        sessionPresetProjection,
        toolRuntime: typeof ctx.tools?.execute === "function" ? "ctx.tools.execute" : "unavailable",
        switchAfterCompletedBatches: advMeta.checkpoint.completedBatches,
        queryCompletedBatchIdProvided,
        checkpointBeforeQuery,
        checkpointAfterQuery,
        analysisStores: {
          inventoryBeforeSha256: analysisBefore.inventorySha256,
          inventoryAfterSha256: analysisAfter.inventorySha256,
          checkpointBeforeSha256: analysisBefore.checkpointSha256,
          checkpointAfterSha256: analysisAfter.checkpointSha256,
          auditConfirmationsBeforeSha256: analysisBefore.auditConfirmationsSha256,
          auditConfirmationsAfterSha256: analysisAfter.auditConfirmationsSha256,
          findingsBeforeSha256: analysisBefore.findingsSha256,
          findingsAfterSha256: analysisAfter.findingsSha256,
        },
        receiptLedgerBeforeSha256,
        receiptLedgerAfterSha256,
        receiptLedgerUnchanged: receiptLedgerBeforeSha256 === receiptLedgerAfterSha256,
        findingBeforeResume,
        completedBatchIds: [],
        completedBatchCount: 0,
        toolDispatchCount: 0,
        synthesisAgentId: "",
        modelCalls: modelEventCount(resumedSession),
        teardown: {
          disposeCalled: false,
          agentUnregistered: false,
          sessionUnregistered: false,
        },
      };
    } else {
      const resRes = await runBatchTool(
        ctx,
        "dshbanca-e2e-resume-" + bIndex,
        "banca_context",
        {},
        batchAgent,
      );
      if (resRes.result.isError || resRes.message.includes("context checkpoint error")) {
        fail("academic probe: resume failed after the single ordered advance");
      }
      resMeta = await parseContextMeta(resRes.message);
    }
    if (resMeta.checkpoint.completedBatches !== bIndex + 1) {
      fail("academic probe: resume spuriously advanced completedBatches");
    }
    resumesWithoutSpuriousAdvance++;
    if (resumedAgent && batchAgent === resumedAgent) {
      agentSessionResumeEvidence.completedBatchIds.push(batchId);
      agentSessionResumeEvidence.completedBatchCount = agentSessionResumeEvidence.completedBatchIds.length;
    }

    currentMeta = advMeta;
  }

  if (!nonEmptyFindingEvidence || !syntheticFindingInput || !invalidFindingEvidence) {
    fail("academic probe: no plan-backed non-empty finding or invalid-finding negative evidence was observed");
  }
  if (planBatchIds.length !== totalBatches || new Set(planBatchIds).size !== totalBatches) {
    fail("academic probe: plan batch order was incomplete or duplicated");
  }
  if (batchAuditReceiptEvidence.length !== totalBatches) {
    fail("academic probe: audit receipts did not cover each plan batch exactly once");
  }

  if (
    !resumedAgent || !agentSessionResumeEvidence ||
    agentSessionResumeEvidence.completedBatchCount !== 3 ||
    JSON.stringify(agentSessionResumeEvidence.completedBatchIds) !== JSON.stringify(planBatchIds.slice(2))
  ) fail("academic probe: the distinct resumed Agent did not complete all three remaining plan batches");

  const finalSynth = await runBatchTool(
    ctx,
    "dshbanca-e2e-final-synthesis",
    "banca_sintese",
    {},
    resumedAgent,
  );
  if (finalSynth.result.isError || finalSynth.message.includes("synthesis input error")) {
    fail("academic probe: final synthesis input was not released after complete coverage");
  }
  let synthPayload;
  try {
    synthPayload = JSON.parse(finalSynth.message);
  } catch {
    fail("academic probe: banca_sintese did not return versioned JSON input");
  }
  const synthCoverage = synthPayload.coverage;
  if (
    synthPayload.version !== "global-analysis-synthesis-input-v1" ||
    synthPayload.planId !== planId ||
    synthPayload.manuscriptFingerprint !== manuscriptFingerprint ||
    synthCoverage?.state !== "complete" ||
    synthCoverage?.totalBatches !== totalBatches ||
    synthCoverage?.completedBatches !== totalBatches ||
    synthCoverage?.totalCharacters !== planTotalCharacters ||
    synthCoverage?.completedCharacters !== planTotalCharacters ||
    synthCoverage?.coveragePercent !== 100 ||
    JSON.stringify(synthCoverage?.orderedBatchIds) !== JSON.stringify(planBatchIds) ||
    !Array.isArray(synthPayload.findings) || synthPayload.findings.length !== 1 ||
    !sameFindingPayload(synthPayload.findings[0], syntheticFindingInput, nonEmptyFindingEvidence.expected.findingId)
  ) fail("academic probe: final synthesis did not return complete coverage and the single plan-backed finding");

  const finalStore = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "findings", planId + ".json"), "utf8"));
  if (
    finalStore.version !== "analysis-findings-store-v1" ||
    finalStore.planId !== planId || finalStore.manuscriptFingerprint !== manuscriptFingerprint ||
    !Array.isArray(finalStore.findings) || finalStore.findings.length !== 1 ||
    !sameFindingPayload(finalStore.findings[0], syntheticFindingInput, nonEmptyFindingEvidence.expected.findingId)
  ) fail("academic probe: durable findings store was absent, duplicated, or diverged after all batches");
  const synthesizedProjection = findingProjection(synthPayload.findings[0]);
  const finalStoredProjection = findingProjection(finalStore.findings[0]);
  if (
    !sameProjection(synthesizedProjection, nonEmptyFindingEvidence.expected) ||
    !sameProjection(finalStoredProjection, nonEmptyFindingEvidence.expected)
  ) fail("academic probe: persisted and synthesized finding identity/provenance diverged");
  nonEmptyFindingEvidence.persisted = finalStoredProjection;
  nonEmptyFindingEvidence.synthesis = synthesizedProjection;
  nonEmptyFindingEvidence.persistedFindingCount = finalStore.findings.length;
  nonEmptyFindingEvidence.synthesisFindingCount = synthPayload.findings.length;
  agentSessionResumeEvidence.synthesisAgentId = identityDigest(resumedAgent.id);
  agentSessionResumeEvidence.toolDispatchCount = resumedToolDispatchCount;
  agentSessionResumeEvidence.modelCalls = modelEventCount(resumedAgent.session);
  if (
    agentSessionResumeEvidence.synthesisAgentId !== agentSessionResumeEvidence.agentId ||
    agentSessionResumeEvidence.toolDispatchCount !== 17 ||
    agentSessionResumeEvidence.modelCalls !== 0 ||
    ctx.agentPresets.composedPreset(resumedAgent.ctx) !== "banca-auditor" ||
    ctx.sessionProjections.stateOf(resumedAgent.session, "agentPreset") !== "banca-auditor"
  ) fail("academic probe: resumed Agent did not own all remaining ToolRuntime dispatches and final synthesis without model calls");

  let manuscriptPreserved = true;
  for (const rel of manuscriptFiles) {
    const postHash = await sha(join(workspace, rel));
    if (postHash !== initialManuscriptHashes[rel]) {
      manuscriptPreserved = false;
      fail("academic probe: synthetic manuscript was mutated by analysis tools");
    }
  }
  const modelCalls = modelEventCount(agent.session) - modelEventsBefore;
  if (modelCalls !== 0) fail("academic probe: a model-facing request occurred during the academic batch audit probe");
  auditorIdentity.modelCalls = modelCalls;

  batchAuditResult = {
    probeExecuted: true,
    totalBatches,
    completedBatches: totalBatches,
    planId,
    manuscriptFingerprint,
    planBatchIds,
    batchAudits: batchAuditReceiptEvidence,
    unverifiedAdvancesBlocked,
    prematureSynthesisBlocked,
    prematureSynthesisProbes,
    auditsCompletedWithZeroFindings,
    auditToolDispatchCount,
    orderlyAdvances,
    resumesWithoutSpuriousAdvance,
    invalidFinding: invalidFindingEvidence,
    auditorIdentity,
    agentSessionResume: agentSessionResumeEvidence,
    nonEmptyFinding: nonEmptyFindingEvidence,
    synthesis: {
      version: synthPayload.version,
      planId: synthPayload.planId,
      manuscriptFingerprint: synthPayload.manuscriptFingerprint,
      coverage: {
        state: synthCoverage.state,
        totalBatches: synthCoverage.totalBatches,
        completedBatches: synthCoverage.completedBatches,
        totalCharacters: synthCoverage.totalCharacters,
        completedCharacters: synthCoverage.completedCharacters,
        coveragePercent: synthCoverage.coveragePercent,
        orderedBatchIds: synthCoverage.orderedBatchIds,
      },
      findingsCount: synthPayload.findings.length,
    },
    synthesisReleased: true,
    synthesisInputCoverageState: synthCoverage.state,
    manuscriptPreserved,
  };
  } finally {
    if (resumedAgentHandle) {
      await resumedAgentHandle.dispose();
      const agentUnregistered = ctx.agents.get(resumedAgent.id) === undefined;
      const sessionUnregistered = ctx.sessions.get(resumedAgent.id) === undefined;
      if (agentSessionResumeEvidence) {
        agentSessionResumeEvidence.teardown.disposeCalled = true;
        agentSessionResumeEvidence.teardown.agentUnregistered = agentUnregistered;
        agentSessionResumeEvidence.teardown.sessionUnregistered = sessionUnregistered;
      }
      if (!agentUnregistered || !sessionUnregistered) {
        fail("academic probe: disposed resumed Agent or Session remained registered in DSH");
      }
    }
  }
  return batchAuditResult;
}

const crossProcessShaText = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const crossProcessKey = () => {
  const key = process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY ?? "";
  if (!/^[a-f0-9]{64}$/.test(key)) fail("cross-process evidence identity key is unavailable");
  return Buffer.from(key, "hex");
};
const crossProcessDigest = (value) => createHmac("sha256", crossProcessKey()).update(String(value), "utf8").digest("hex");
export async function crossProcessProcessIdentitySha256() {
  if (process.platform !== "linux") fail("cross-process process identity requires Linux procfs host evidence");
  const stat = await readFile("/proc/" + process.pid + "/stat", "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) fail("cross-process process identity could not parse kernel procfs stat");
  const startTicks = stat.slice(commandEnd + 1).trim().split(/\\s+/)[19];
  const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  if (!/^\\d+$/.test(startTicks ?? "") || !/^[a-f0-9-]{36}$/i.test(bootId)) fail("cross-process kernel start identity is invalid");
  return createHmac("sha256", crossProcessKey()).update(JSON.stringify(["dsh-process-v1", process.pid, bootId, startTicks]), "utf8").digest("hex");
}
const crossProcessCheckpointEvidence = (meta) => ({
  planId: meta?.checkpoint?.planId,
  manuscriptFingerprint: meta?.manuscript?.fingerprint,
  totalBatches: meta?.checkpoint?.totalBatches,
  completedBatches: meta?.checkpoint?.completedBatches,
  completedCharacters: meta?.checkpoint?.completedCharacters,
  totalCharacters: meta?.checkpoint?.totalCharacters,
  coveragePercent: meta?.checkpoint?.coveragePercent,
  state: meta?.checkpoint?.state,
  nextBatchId: meta?.batch?.batchId ?? null,
  nextBatchIndex: meta?.batch?.index ?? null,
});
const crossProcessStoredCheckpointEvidence = (checkpoint, nextBatch) => ({
  ...checkpoint,
  manuscriptFingerprint: checkpoint?.fingerprint,
  nextBatchId: nextBatch?.batchId ?? null,
  nextBatchIndex: nextBatch?.index ?? null,
});
const crossProcessFindingProjection = (finding) => ({
  version: finding.version,
  findingId: finding.findingId,
  planId: finding.planId,
  batchId: finding.batchId,
  manuscriptFingerprint: finding.manuscriptFingerprint,
  provenanceSha256: crossProcessShaText(JSON.stringify([
    finding.category, finding.severity, finding.file, finding.startLine, finding.endLine, finding.sectionId,
  ])),
  claimSha256: crossProcessShaText(finding.claim),
  evidenceSha256: crossProcessShaText(finding.evidence),
});
const crossProcessAnalysisHashes = async (workspace, planId) => {
  const allFiles = await inventory(workspace);
  const analysisFiles = Object.fromEntries(Object.entries(allFiles).filter(([path]) => path.startsWith(".banca/analysis/")));
  const hashes = {
    analysisInventorySha256: crossProcessShaText(JSON.stringify(analysisFiles)),
    checkpointSha256: analysisFiles[".banca/analysis/checkpoints/" + planId + ".json"] ?? null,
    auditConfirmationsSha256: analysisFiles[".banca/analysis/audit-confirmations/" + planId + ".json"] ?? null,
    findingsSha256: analysisFiles[".banca/analysis/findings/" + planId + ".json"] ?? null,
  };
  if (Object.values(hashes).some((digest) => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) {
    fail("cross-process checkpoint, receipt, finding, or analysis inventory was not durably stored");
  }
  return hashes;
};
const crossProcessReadStores = async (workspace, planId, fingerprint) => {
  const checkpoint = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "checkpoints", planId + ".json"), "utf8"));
  const receipts = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "audit-confirmations", planId + ".json"), "utf8"));
  const findings = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "findings", planId + ".json"), "utf8"));
  if (
    checkpoint.planId !== planId || checkpoint.fingerprint !== fingerprint ||
    receipts.version !== "analysis-audit-confirmations-store-v1" || receipts.planId !== planId || receipts.manuscriptFingerprint !== fingerprint || !Array.isArray(receipts.confirmations) ||
    findings.version !== "analysis-findings-store-v1" || findings.planId !== planId || findings.manuscriptFingerprint !== fingerprint || !Array.isArray(findings.findings)
  ) fail("cross-process durable stores do not match the live exhaustive plan identity");
  return { checkpoint, receipts: receipts.confirmations, findings: findings.findings };
};
const runCrossProcessSynthesisProbe = async (ctx, workspace, planId, fingerprint, meta, agent, callId, toolRunner = runTool) => {
  const contextCheckpoint = crossProcessCheckpointEvidence(meta);
  const storesBefore = await crossProcessReadStores(workspace, planId, fingerprint);
  const checkpointBefore = crossProcessStoredCheckpointEvidence(storesBefore.checkpoint, meta?.batch);
  const expectedCheckpointState = contextCheckpoint.completedBatches === 0 ? "pending" : "running";
  if (contextCheckpoint.totalBatches !== 5 || !Number.isInteger(contextCheckpoint.completedBatches) ||
      contextCheckpoint.completedBatches < 0 || contextCheckpoint.completedBatches >= contextCheckpoint.totalBatches ||
      contextCheckpoint.state !== expectedCheckpointState || contextCheckpoint.planId !== planId ||
      contextCheckpoint.manuscriptFingerprint !== fingerprint ||
      contextCheckpoint.totalBatches !== checkpointBefore.totalBatches ||
      contextCheckpoint.completedBatches !== checkpointBefore.completedBatches ||
      contextCheckpoint.state !== checkpointBefore.state ||
      contextCheckpoint.nextBatchIndex !== checkpointBefore.nextBatchIndex ||
      contextCheckpoint.nextBatchId !== checkpointBefore.nextBatchId) {
    fail("cross-process synthesis probe checkpoint did not match the persisted incomplete plan");
  }
  const persistenceBefore = await crossProcessAnalysisHashes(workspace, planId);
  const workspaceInventoryBeforeSha256 = crossProcessShaText(JSON.stringify(await inventory(workspace)));
  const persistedBatchIdsBefore = storesBefore.receipts.map((receipt) => receipt.batchId);
  const findingsBefore = storesBefore.findings.map(crossProcessFindingProjection);

  const result = await toolRunner(ctx, callId, "banca_sintese", {}, agent);
  const refusal = crossProcessSynthesisRefusal(result, checkpointBefore);

  const storesAfter = await crossProcessReadStores(workspace, planId, fingerprint);
  const checkpointAfter = crossProcessStoredCheckpointEvidence(storesAfter.checkpoint, meta?.batch);
  const persistenceAfter = await crossProcessAnalysisHashes(workspace, planId);
  const workspaceInventoryAfterSha256 = crossProcessShaText(JSON.stringify(await inventory(workspace)));
  const persistedBatchIdsAfter = storesAfter.receipts.map((receipt) => receipt.batchId);
  const findingsAfter = storesAfter.findings.map(crossProcessFindingProjection);
  const persistentStateUnchanged =
    crossProcessSameProjection(storesBefore.checkpoint, storesAfter.checkpoint) &&
    crossProcessSameProjection(storesBefore.receipts, storesAfter.receipts) &&
    crossProcessSameProjection(storesBefore.findings, storesAfter.findings) &&
    crossProcessSameProjection(checkpointBefore, checkpointAfter) &&
    crossProcessSameProjection(persistenceBefore, persistenceAfter) &&
    workspaceInventoryBeforeSha256 === workspaceInventoryAfterSha256;
  if (!persistentStateUnchanged) fail("cross-process incomplete-synthesis refusal mutated checkpoint, receipts, findings, or workspace inventory");
  if (!refusal) fail("cross-process synthesis did not return the exact successful ToolRuntime incomplete_coverage domain refusal");

  return {
    batchIndex: checkpointBefore.completedBatches,
    batchId: checkpointBefore.nextBatchId,
    toolRuntimeIsError: result.result?.isError === true ? true : result.result?.isError === false ? false : null,
    toolResultValue: typeof result.result?.value === "string" ? result.result.value : null,
    toolMessage: typeof result.message === "string" ? result.message : null,
    errorCode: refusal?.errorCode ?? null,
    errorMessage: refusal?.errorMessage ?? null,
    rejectionObserved: true,
    checkpointBefore,
    checkpointAfter,
    persistenceBefore,
    persistenceAfter,
    workspaceInventoryBeforeSha256,
    workspaceInventoryAfterSha256,
    persistedReceiptCountBefore: storesBefore.receipts.length,
    persistedReceiptCountAfter: storesAfter.receipts.length,
    persistedBatchIdsBefore,
    persistedBatchIdsAfter,
    findingCountBefore: findingsBefore.length,
    findingCountAfter: findingsAfter.length,
    findingsBefore,
    findingsAfter,
    persistentStateUnchanged,
  };
};
const crossProcessAgentIdentity = (ctx, agent) => {
  const session = agent?.session;
  const effectivePreset = ctx.agentPresets?.composedPreset?.(agent?.ctx) ?? "";
  const sessionPresetProjection = ctx.sessionProjections?.stateOf?.(session, "agentPreset") ?? "";
  const agentId = typeof agent?.id === "string" ? agent.id : "";
  const sessionId = typeof session?.id === "string" ? session.id : "";
  return {
    createdVia: "ctx.agents.create",
    agentId: agentId ? crossProcessDigest("agent:" + agentId) : "",
    sessionId: sessionId ? crossProcessDigest("agent:" + sessionId) : "",
    agentAndSessionIdMatch: Boolean(agentId) && agentId === sessionId,
    agentRegistryContainsAgent: Boolean(agentId) && ctx.agents?.get(agentId) === agent,
    sessionStoreContainsSession: Boolean(agentId) && ctx.sessions?.get(agentId) === session,
    effectivePreset,
    sessionPresetProjection,
    toolRuntime: typeof ctx.tools?.execute === "function" ? "ctx.tools.execute" : "",
    modelCalls: session ? modelEventCount(session) : -1,
  };
};
const crossProcessManuscriptHashes = async (workspace) => {
  const paths = ["main.tex", "referencias.bib", ...[1, 2, 3, 4, 5].map((index) => "capitulos/lote" + index + ".tex")];
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await sha(join(workspace, path))])));
};
const crossProcessSectionSource = async (workspace, meta) => {
  const prefix = String.fromCharCode(92) + "section{";
  for (const chunk of Array.isArray(meta?.chunks) ? meta.chunks : []) {
    const file = chunk?.file;
    if (typeof file !== "string" || !file || file.startsWith("/") || file.split("/").some((part) => !part || part === "..")) continue;
    if (!Number.isInteger(chunk.startLine) || !Number.isInteger(chunk.endLine) || !Number.isInteger(chunk.startOffset) || !Number.isInteger(chunk.endOffset)) continue;
    const source = await readFile(join(workspace, file), "utf8");
    const lines = source.split(String.fromCharCode(10));
    for (let lineNumber = Math.max(1, chunk.startLine); lineNumber <= Math.min(lines.length, chunk.endLine); lineNumber++) {
      const text = lines[lineNumber - 1].trim();
      if (!text.startsWith(prefix) || !text.endsWith("}")) continue;
      const sectionId = text.slice(prefix.length, -1);
      const lineStart = lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0);
      const lineEnd = lineStart + lines[lineNumber - 1].length;
      if (sectionId && !sectionId.includes("{") && !sectionId.includes("}") && chunk.startOffset <= lineStart && chunk.endOffset >= lineEnd) {
        return { file, startLine: lineNumber, endLine: lineNumber, sectionId, sourceLine: text };
      }
    }
  }
  return null;
};
const crossProcessReceipt = (toolResult) => { try { return JSON.parse(toolResult.message); } catch { return null; } };
const crossProcessExpectedFinding = (findingInput, planId, fingerprint) => {
  const fields = ["analysis-finding-v1", planId, fingerprint, findingInput.batchId, findingInput.category, findingInput.severity,
    findingInput.claim, findingInput.evidence, findingInput.file, String(findingInput.startLine), String(findingInput.endLine), findingInput.sectionId];
  const parts = [];
  for (const field of fields) {
    const bytes = Buffer.from(field, "utf8");
    const header = Buffer.allocUnsafe(4);
    header.writeUInt32BE(bytes.byteLength, 0);
    parts.push(header, bytes);
  }
  return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
};
const crossProcessCheckpointProjectionFields = [
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
];
export const crossProcessCheckpointProjectionMatches = (left, right) => {
  const hasExactFields = (value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === crossProcessCheckpointProjectionFields.length &&
    crossProcessCheckpointProjectionFields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
  return hasExactFields(left) && hasExactFields(right) &&
    crossProcessCheckpointProjectionFields.every((field) => left[field] === right[field]);
};
export const crossProcessSameProjection = (left, right) => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => crossProcessSameProjection(entry, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(right, key) && crossProcessSameProjection(left[key], right[key]));
};

export async function runCrossProcessInitialProbe(ctx, workspace) {
  let handle;
  let agent;
  const teardown = { disposeCalled: false, agentUnregistered: false, sessionUnregistered: false, teardownFailed: false };
  let evidence;
  try {
    handle = await ctx.agents.create({ sessionId: "dshbanca-e2e-process-a-" + process.pid + "-" + Date.now(), meta: { cwd: workspace } });
    agent = handle.agent;
    if (!agent || ctx.agents.get(agent.id) !== agent || ctx.sessions.get(agent.id) !== agent.session || agent.id !== agent.session.id) fail("first process failed to create a native DSH Agent/Session");
    const init = await runTool(ctx, "dshbanca-e2e-process-a-init", "banca_init", {}, agent);
    if (init.result.isError) fail("first DSH process could not initialize the synthetic academic project through banca_init");
    const projectConfigPath = join(workspace, ".banca", "project.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8"));
    projectConfig.analysis = { coverageMode: "exhaustive", maxCharactersPerBatch: 120 };
    await writeFile(projectConfigPath, JSON.stringify(projectConfig, null, 2), { mode: 0o600 });
    const selection = await ctx.agentPresets.select(agent, "banca-auditor");
    if (selection !== "banca-auditor" || ctx.agentPresets.composedPreset(agent.ctx) !== "banca-auditor" || ctx.sessionProjections.stateOf(agent.session, "agentPreset") !== "banca-auditor") {
      fail("first DSH process did not bind the auditor Agent/Session to banca-auditor");
    }
    const identity = crossProcessAgentIdentity(ctx, agent);
    if (identity.toolRuntime !== "ctx.tools.execute" || identity.modelCalls !== 0 || !identity.agentRegistryContainsAgent || !identity.sessionStoreContainsSession) fail("first DSH process Agent/Session or native ToolRuntime identity was not verified");
    const initial = await runTool(ctx, "dshbanca-e2e-process-a-plan", "banca_context", {}, agent);
    if (initial.result.isError) fail("first DSH process could not create the canonical exhaustive analysis plan");
    let meta = await parseContextMeta(initial.message);
    const planId = meta?.checkpoint?.planId;
    const fingerprint = meta?.manuscript?.fingerprint;
    if (meta?.checkpoint?.totalBatches !== 5 || meta?.checkpoint?.totalCharacters !== 595 || meta?.checkpoint?.completedBatches !== 0 || meta?.plan?.status !== "complete" || !/^[a-f0-9]{64}$/.test(planId ?? "") || !/^[a-f0-9]{64}$/.test(fingerprint ?? "")) {
      fail("first DSH process did not initialize the canonical 595-character five-batch plan");
    }
    const planBatchIds = [];
    const completedBatchCharacters = [];
    const batchAudits = [];
    let checkpointAfterFirstBatch = null;
    let expectedFinding = null;
    let findingProjection = null;
    let unverifiedAdvancesBlocked = 0;
    let prematureSynthesisBlocked = 0;
    const prematureSynthesisProbes = [];
    for (let index = 0; index < 2; index++) {
      const batchId = meta?.batch?.batchId;
      if (meta?.batch?.index !== index || meta?.checkpoint?.completedBatches !== index || typeof batchId !== "string") fail("first DSH process observed a skipped or unexpected batch before audit");
      if (!Number.isInteger(meta?.batch?.characters) || meta.batch.characters <= 0 || meta.batch.characters > 120) fail("first DSH process observed invalid canonical batch character coverage");
      completedBatchCharacters.push(meta.batch.characters);
      planBatchIds.push(batchId);
      const beforeAttempt = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "checkpoints", planId + ".json"), "utf8"));
      const unverified = await runTool(ctx, "dshbanca-e2e-process-a-unverified-" + index, "banca_context", { completedBatchId: batchId }, agent);
      const afterAttempt = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "checkpoints", planId + ".json"), "utf8"));
      if (!unverified.message.includes("missing_batch_audit") || !crossProcessSameProjection(beforeAttempt, afterAttempt)) fail("first DSH process did not fail closed on an unaudited progress attempt");
      unverifiedAdvancesBlocked++;
      const findings = [];
      if (index === 1) {
        const section = await crossProcessSectionSource(workspace, meta);
        if (!section) fail("second canonical batch did not contain the expected synthetic methodology section");
        expectedFinding = {
          category: "structure",
          severity: "low",
          claim: "The synthetic LaTeX span contains an explicit section heading.",
          evidence: section.file + ":" + section.startLine + "-" + section.endLine + ": " + section.sourceLine,
          file: section.file,
          startLine: section.startLine,
          endLine: section.endLine,
          sectionId: section.sectionId,
          manuscriptFingerprint: fingerprint,
          batchId,
        };
        findings.push(expectedFinding);
      }
      const audit = await runTool(ctx, "dshbanca-e2e-process-a-audit-" + index, "banca_auditar", { manuscriptFingerprint: fingerprint, batchId, findings }, agent);
      if (audit.result.isError) fail("first DSH process banca_auditar dispatch failed");
      const receipt = crossProcessReceipt(audit);
      const stores = await crossProcessReadStores(workspace, planId, fingerprint);
      const acceptedCount = index === 1 ? 1 : 0;
      if (!receipt || receipt.kind !== "openbanca-audit-receipt-v2" || receipt.planId !== planId || receipt.manuscriptFingerprint !== fingerprint || receipt.batchId !== batchId || receipt.batchIndex !== index || receipt.acceptedCount !== acceptedCount || !Array.isArray(receipt.findings) || receipt.findings.length !== acceptedCount || stores.receipts.length !== index + 1 || stores.findings.length !== acceptedCount) fail("first DSH process receipt and durable stores did not preserve the expected finding count");
      if (acceptedCount === 1) {
        const expectedId = crossProcessExpectedFinding(expectedFinding, planId, fingerprint);
        if (receipt.findings[0]?.findingId !== expectedId || stores.findings[0]?.findingId !== expectedId) fail("first DSH process finding did not retain its deterministic plan-backed identity");
        findingProjection = crossProcessFindingProjection(stores.findings[0]);
      }
      batchAudits.push({ batchIndex: index, batchId, acceptedCount, persistedFindingCount: stores.findings.length, findingId: acceptedCount === 1 ? receipt.findings[0].findingId : null });
      prematureSynthesisProbes.push(await runCrossProcessSynthesisProbe(
        ctx, workspace, planId, fingerprint, meta, agent,
        "dshbanca-e2e-process-a-premature-synthesis-" + index,
      ));
      prematureSynthesisBlocked++;
      const advanced = await runTool(ctx, "dshbanca-e2e-process-a-advance-" + index, "banca_context", { completedBatchId: batchId }, agent);
      if (advanced.result.isError) fail("first DSH process failed to advance an audited canonical batch");
      meta = await parseContextMeta(advanced.message);
      if (meta?.checkpoint?.completedBatches !== index + 1 || meta?.checkpoint?.planId !== planId || meta?.manuscript?.fingerprint !== fingerprint || (index === 0 && meta?.batch?.index !== 1) || (index === 1 && meta?.batch?.index !== 2)) fail("first DSH process progress was not exactly one batch per accepted audit");
      if (index === 0) checkpointAfterFirstBatch = crossProcessCheckpointEvidence(meta);
    }
    prematureSynthesisProbes.push(await runCrossProcessSynthesisProbe(
      ctx, workspace, planId, fingerprint, meta, agent,
      "dshbanca-e2e-process-a-stop-at-two",
    ));
    prematureSynthesisBlocked++;
    const finalStores = await crossProcessReadStores(workspace, planId, fingerprint);
    const persistedIds = finalStores.receipts.map((receipt) => receipt.batchId);
    if (finalStores.receipts.length !== 2 || JSON.stringify(persistedIds) !== JSON.stringify(planBatchIds) || finalStores.findings.length !== 1 || !findingProjection || !crossProcessSameProjection(findingProjection, crossProcessFindingProjection(finalStores.findings[0]))) fail("first DSH process did not persist two ordered receipts and exactly one finding");
    const checkpoint = crossProcessCheckpointEvidence(meta);
    const expectedCompletedCharacters = completedBatchCharacters.reduce((sum, count) => sum + count, 0);
    const expectedCoveragePercent = Math.round((expectedCompletedCharacters / 595) * 10_000) / 100;
    const expectedFirstCoveragePercent = Math.round((completedBatchCharacters[0] / 595) * 10_000) / 100;
    if (
      !checkpointAfterFirstBatch || checkpointAfterFirstBatch.completedBatches !== 1 ||
      checkpointAfterFirstBatch.completedCharacters !== completedBatchCharacters[0] ||
      checkpointAfterFirstBatch.coveragePercent !== expectedFirstCoveragePercent ||
      checkpointAfterFirstBatch.nextBatchIndex !== 1 || checkpointAfterFirstBatch.nextBatchId !== planBatchIds[1] ||
      checkpoint.completedBatches !== 2 || checkpoint.completedCharacters !== expectedCompletedCharacters ||
      checkpoint.coveragePercent !== expectedCoveragePercent || checkpoint.totalBatches !== 5 ||
      checkpoint.totalCharacters !== 595 || checkpoint.state !== "running" || checkpoint.nextBatchIndex !== 2 ||
      typeof checkpoint.nextBatchId !== "string" || planBatchIds.includes(checkpoint.nextBatchId)
    ) fail("first DSH process did not leave a canonical 2/5 checkpoint matching observed batch characters and next batch");
    if (modelEventCount(agent.session) !== 0) fail("first DSH process made a model request during no-model academic audit");
    evidence = {
      probeExecuted: true,
      executionMode: "cross-process-native-dsh",
      workspaceIdentitySha256: process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256,
      workspaceInventorySha256: crossProcessShaText(JSON.stringify(await inventory(workspace))),
      manuscriptHashes: await crossProcessManuscriptHashes(workspace),
      planId,
      manuscriptFingerprint: fingerprint,
      totalBatches: 5,
      totalCharacters: 595,
      completedBatchIds: [...planBatchIds],
      planBatchIdsPrefix: [...planBatchIds, checkpoint.nextBatchId],
      completedBatchCharacters: [...completedBatchCharacters],
      checkpointAfterFirstBatch,
      checkpoint,
      batchAudits,
      persistedReceiptCount: finalStores.receipts.length,
      persistedBatchIds: persistedIds,
      persistence: await crossProcessAnalysisHashes(workspace, planId),
      findingCount: finalStores.findings.length,
      finding: findingProjection,
      prematureSynthesisBlocked: prematureSynthesisBlocked === 3,
      prematureSynthesisProbes,
      synthesisReleased: false,
      unverifiedAdvancesBlocked,
      agentIdentity: identity,
      teardown,
    };
  } finally {
    if (handle) {
      try {
        await handle.dispose();
        teardown.disposeCalled = true;
      } catch {
        teardown.teardownFailed = true;
      }
      teardown.agentUnregistered = ctx.agents.get(agent?.id) === undefined;
      teardown.sessionUnregistered = ctx.sessions.get(agent?.id) === undefined;
      if (!teardown.agentUnregistered || !teardown.sessionUnregistered || teardown.teardownFailed) fail("first DSH process Agent/Session teardown failed or remained registered");
      if (evidence) evidence.teardown = { ...teardown };
    }
  }
  if (!evidence) fail("first DSH process cross-process evidence was not produced");
  return evidence;
}

// A returned academic refusal is a SUCCESS value of ToolRuntime, never a native error.
export const sourceDriftDomainRefusal = (outcome, expectedValue) =>
  outcome?.result?.isError === false && outcome.result.value === expectedValue && outcome.message === expectedValue;

export async function runSourceDriftProbe(ctx, workspace, expectation) {
  let handle;
  let agent;
  let evidence;
  const teardown = { disposeCalled: false, agentUnregistered: false, sessionUnregistered: false, teardownFailed: false };
  try {
    const old = expectation.phaseOne;
    const inventoryBeforeContext = await inventory(workspace);
    const oldStoresBefore = await crossProcessReadStores(workspace, old.planId, old.manuscriptFingerprint);
    if (oldStoresBefore.findings.length !== 1 || oldStoresBefore.receipts.length !== 2) fail("source drift did not recover the historical one finding and two confirmations");
    const oldFinding = oldStoresBefore.findings[0];
    const oldFindingBefore = crossProcessFindingProjection(oldFinding);
    const oldReceiptIdsBefore = oldStoresBefore.receipts.map((receipt) => receipt.batchId);
    if (!crossProcessSameProjection(oldFindingBefore, old.finding) || !crossProcessSameProjection(oldReceiptIdsBefore, old.completedBatchIds)) fail("source drift historical identity changed before fresh context");
    handle = await ctx.agents.create({ sessionId: "dshbanca-e2e-source-drift-" + process.pid + "-" + Date.now(), meta: { cwd: workspace } });
    agent = handle.agent;
    const selected = await ctx.agentPresets.select(agent, "banca-auditor");
    const identity = crossProcessAgentIdentity(ctx, agent);
    if (selected !== "banca-auditor" || identity.effectivePreset !== "banca-auditor" || identity.sessionPresetProjection !== "banca-auditor" || !identity.agentRegistryContainsAgent || !identity.sessionStoreContainsSession || identity.agentId === old.agentIdentity.agentId || identity.modelCalls !== 0) fail("source drift second process lacks a distinct native auditor identity");
    // The fresh query is allowed to create exactly a new checkpoint and context pack.
    const context = await runTool(ctx, "dshbanca-e2e-drift-fresh-context", "banca_context", {}, agent);
    if (context.result.isError !== false) fail("source drift fresh context dispatch failed");
    const meta = await parseContextMeta(context.message);
    const checkpoint = crossProcessCheckpointEvidence(meta);
    const planId = checkpoint.planId;
    const manuscriptFingerprint = checkpoint.manuscriptFingerprint;
    if (planId !== expectation.canonicalAfter.planId || manuscriptFingerprint !== expectation.canonicalAfter.manuscriptFingerprint || planId === old.planId || manuscriptFingerprint === old.manuscriptFingerprint || checkpoint.state !== "pending" || checkpoint.completedBatches !== 0 || checkpoint.completedCharacters !== 0 || checkpoint.coveragePercent !== 0 || checkpoint.totalBatches !== 5 || checkpoint.totalCharacters !== 595 || checkpoint.nextBatchIndex !== 0 || checkpoint.nextBatchId !== expectation.canonicalAfter.firstBatchId) fail("source drift context inherited old progress or did not match the live canonical plan");
    const readNew = async (directory) => {
      try { return JSON.parse(await readFile(join(workspace, ".banca", "analysis", directory, planId + ".json"), "utf8")); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
    };
    const rawCheckpoint = await readNew("checkpoints");
    const storedCheckpoint = crossProcessStoredCheckpointEvidence(rawCheckpoint, meta.batch);
    const findingsStore = await readNew("findings");
    const auditStore = await readNew("audit-confirmations");
    if (findingsStore !== null || auditStore !== null) fail("source drift new plan inherited findings or audit confirmations");
    const inventoryAfterContext = await inventory(workspace);
    const baseline = crossProcessShaText(JSON.stringify(inventoryAfterContext));
    const refusals = [];
    const oldBatchId = old.completedBatchIds[1];
    const replayFinding = Object.fromEntries(["category", "severity", "claim", "evidence", "file", "startLine", "endLine", "sectionId"].map((key) => [key, oldFinding[key]]));
    const attempts = [
      { kind: "stale-advance", toolName: "banca_context", args: { completedBatchId: oldBatchId }, code: "unknown_batch", message: "batchId is not part of the plan: " + oldBatchId, header: "context checkpoint error" },
      { kind: "stale-fingerprint", toolName: "banca_auditar", args: { manuscriptFingerprint: old.manuscriptFingerprint, batchId: oldBatchId, findings: [replayFinding] }, code: "fingerprint_mismatch", message: "manuscriptFingerprint does not match the current plan fingerprint", header: "audit validation error" },
      { kind: "stale-batch", toolName: "banca_auditar", args: { manuscriptFingerprint, batchId: oldBatchId, findings: [replayFinding] }, code: "unknown_batch", message: "batchId is not present in the plan: " + oldBatchId, header: "audit validation error" },
      { kind: "premature-synthesis", toolName: "banca_sintese", args: {}, code: "missing_findings", message: "no persisted findings store exists for the current plan", header: "synthesis input error" },
    ];
    for (const attempt of attempts) {
      const inventoryBeforeSha256 = crossProcessShaText(JSON.stringify(await inventory(workspace)));
      if (inventoryBeforeSha256 !== baseline) fail("source drift state changed between refusal probes");
      const outcome = await runTool(ctx, "dshbanca-e2e-drift-" + attempt.kind, attempt.toolName, attempt.args, agent);
      const expectedValue = [attempt.header, "code=" + attempt.code, "message=" + attempt.message].join(String.fromCharCode(10));
      if (!sourceDriftDomainRefusal(outcome, expectedValue)) fail("source drift did not return the exact expected domain refusal");
      const inventoryAfterSha256 = crossProcessShaText(JSON.stringify(await inventory(workspace)));
      if (inventoryAfterSha256 !== inventoryBeforeSha256) fail("source drift refusal mutated persisted evidence");
      refusals.push({
        kind: attempt.kind, toolName: attempt.toolName,
        input: { manuscriptFingerprint: attempt.args.manuscriptFingerprint ?? null, batchId: attempt.args.completedBatchId ?? attempt.args.batchId ?? null, findingId: attempt.args.findings?.length === 1 ? oldFinding.findingId : null, findingsCount: attempt.args.findings?.length ?? 0 },
        toolRuntimeIsError: outcome.result.isError, toolResultValue: outcome.result.value, toolMessage: outcome.message,
        errorCode: attempt.code, inventoryBeforeSha256, inventoryAfterSha256,
      });
    }
    const oldStoresAfter = await crossProcessReadStores(workspace, old.planId, old.manuscriptFingerprint);
    if (!crossProcessSameProjection(oldStoresBefore, oldStoresAfter)) fail("source drift altered historical checkpoint, confirmations or findings");
    const modelCalls = modelEventCount(agent.session);
    if (modelCalls !== 0) fail("source drift probe emitted model events");
    evidence = {
      probeExecuted: true, workspaceIdentitySha256: process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256,
      planId, manuscriptFingerprint, checkpoint, storedCheckpoint, findingsStore, auditStore,
      inventoryBeforeContext, inventoryAfterContext, inventoryFinal: await inventory(workspace),
      oldFindingBefore, oldFindingAfter: crossProcessFindingProjection(oldStoresAfter.findings[0]),
      oldReceiptIdsBefore, oldReceiptIdsAfter: oldStoresAfter.receipts.map((receipt) => receipt.batchId),
      refusals, agentIdentity: identity, teardown, modelCalls, credentialsUsed: false,
    };
  } finally {
    if (handle) {
      try { await handle.dispose(); teardown.disposeCalled = true; } catch { teardown.teardownFailed = true; }
      teardown.agentUnregistered = ctx.agents.get(agent?.id) === undefined;
      teardown.sessionUnregistered = ctx.sessions.get(agent?.id) === undefined;
      if (!teardown.agentUnregistered || !teardown.sessionUnregistered || teardown.teardownFailed) fail("source drift native Agent/Session teardown failed");
      if (evidence) evidence.teardown = { ...teardown };
    }
  }
  if (!evidence) fail("source drift second phase evidence missing");
  return evidence;
}

export async function runCrossProcessResumeProbe(ctx, workspace, expectation) {
  let handle;
  let agent;
  const teardown = { disposeCalled: false, agentUnregistered: false, sessionUnregistered: false, teardownFailed: false };
  let evidence;
  try {
    const inventoryBefore = crossProcessShaText(JSON.stringify(await inventory(workspace)));
    if (inventoryBefore !== expectation.workspaceInventorySha256 || process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256 !== expectation.workspaceIdentitySha256) fail("second DSH process did not open the unchanged first-process synthetic workspace");
    const persistenceBefore = await crossProcessAnalysisHashes(workspace, expectation.planId);
    if (!crossProcessSameProjection(persistenceBefore, expectation.persistence)) fail("second DSH process found changed checkpoint, receipt, finding, or analysis inventory hashes before resume");
    const storesBefore = await crossProcessReadStores(workspace, expectation.planId, expectation.manuscriptFingerprint);
    const persistedBatchIds = storesBefore.receipts.map((receipt) => receipt.batchId);
    const recoveredFinding = storesBefore.findings.length === 1 ? crossProcessFindingProjection(storesBefore.findings[0]) : null;
    if (storesBefore.receipts.length !== 2 || JSON.stringify(persistedBatchIds) !== JSON.stringify(expectation.completedBatchIds) || !recoveredFinding || !crossProcessSameProjection(recoveredFinding, expectation.finding)) fail("second DSH process did not recover the original receipts and single finding before context query");
    handle = await ctx.agents.create({ sessionId: "dshbanca-e2e-process-b-" + process.pid + "-" + Date.now(), meta: { cwd: workspace } });
    agent = handle.agent;
    if (!agent || ctx.agents.get(agent.id) !== agent || ctx.sessions.get(agent.id) !== agent.session || agent.id !== agent.session.id) fail("second process failed to create a native DSH Agent/Session");
    const selection = await ctx.agentPresets.select(agent, "banca-auditor");
    if (selection !== "banca-auditor" || ctx.agentPresets.composedPreset(agent.ctx) !== "banca-auditor" || ctx.sessionProjections.stateOf(agent.session, "agentPreset") !== "banca-auditor") fail("second DSH process did not bind its new Agent/Session to banca-auditor");
    const identity = crossProcessAgentIdentity(ctx, agent);
    if (!identity.agentRegistryContainsAgent || !identity.sessionStoreContainsSession || identity.toolRuntime !== "ctx.tools.execute" || identity.modelCalls !== 0) fail("second DSH process Agent/Session or ToolRuntime identity was not verified");
    const rawCheckpointBefore = JSON.parse(await readFile(join(workspace, ".banca", "analysis", "checkpoints", expectation.planId + ".json"), "utf8"));
    if (rawCheckpointBefore.completedBatches !== 2 || rawCheckpointBefore.totalBatches !== 5 || rawCheckpointBefore.planId !== expectation.planId || rawCheckpointBefore.fingerprint !== expectation.manuscriptFingerprint || rawCheckpointBefore.state !== "running") fail("second DSH process checkpoint was reset or altered before resume query");
    const query = await runTool(ctx, "dshbanca-e2e-process-b-resume-context", "banca_context", {}, agent);
    if (query.result.isError) fail("second DSH process could not recover the persisted banca_context plan");
    let meta = await parseContextMeta(query.message);
    const checkpointAfterQuery = crossProcessCheckpointEvidence(meta);
    const checkpointBeforeQuery = {
      planId: rawCheckpointBefore.planId,
      manuscriptFingerprint: rawCheckpointBefore.fingerprint,
      totalBatches: rawCheckpointBefore.totalBatches,
      completedBatches: rawCheckpointBefore.completedBatches,
      completedCharacters: rawCheckpointBefore.completedCharacters,
      totalCharacters: rawCheckpointBefore.totalCharacters,
      coveragePercent: rawCheckpointBefore.coveragePercent,
      state: rawCheckpointBefore.state,
      nextBatchIndex: expectation.checkpoint.nextBatchIndex,
      nextBatchId: expectation.checkpoint.nextBatchId,
    };
    const persistenceAfterQuery = await crossProcessAnalysisHashes(workspace, expectation.planId);
    const storesAfterQuery = await crossProcessReadStores(workspace, expectation.planId, expectation.manuscriptFingerprint);
    const recoveredFindingAfterQuery = storesAfterQuery.findings.length === 1 ? crossProcessFindingProjection(storesAfterQuery.findings[0]) : null;
    if (!crossProcessCheckpointProjectionMatches(checkpointBeforeQuery, checkpointAfterQuery) || !crossProcessSameProjection(persistenceBefore, persistenceAfterQuery) || storesAfterQuery.receipts.length !== 2 || storesAfterQuery.findings.length !== 1 || !recoveredFindingAfterQuery || !crossProcessSameProjection(recoveredFindingAfterQuery, expectation.finding)) fail("resume-only banca_context query changed persistent progress or the first-process finding");
    // banca_context writes its context pack, so the first denial baseline must be captured after this resume-only query.
    const workspaceInventoryAfterResumeQuerySha256 = crossProcessShaText(JSON.stringify(await inventory(workspace)));
    const batchAudits = [];
    const completedBatchIds = [];
    const unverifiedAdvanceProbes = [];
    const prematureSynthesisProbes = [];
    let unverifiedAdvancesBlocked = 0;
    let prematureSynthesisBlocked = 0;
    const allPlanBatchIds = [...expectation.completedBatchIds];
    for (let index = 2; index < 5; index++) {
      const batchId = meta?.batch?.batchId;
      if (meta?.batch?.index !== index || meta?.checkpoint?.completedBatches !== index || typeof batchId !== "string") fail("second DSH process observed a skipped or out-of-order remaining batch");
      allPlanBatchIds.push(batchId);

      const persistenceBeforeAttempt = await crossProcessAnalysisHashes(workspace, expectation.planId);
      const workspaceInventoryBeforeAttempt = crossProcessShaText(JSON.stringify(await inventory(workspace)));
      if (index === 2 && workspaceInventoryBeforeAttempt !== workspaceInventoryAfterResumeQuerySha256) fail("first unaudited-advance probe workspace inventory drifted after the resume-only query");
      const storesBeforeAttempt = await crossProcessReadStores(workspace, expectation.planId, expectation.manuscriptFingerprint);
      const checkpointBefore = crossProcessStoredCheckpointEvidence(storesBeforeAttempt.checkpoint, meta?.batch);
      const persistedBatchIdsBefore = storesBeforeAttempt.receipts.map((receipt) => receipt.batchId);
      const findingsBefore = storesBeforeAttempt.findings.map(crossProcessFindingProjection);
      if (
        checkpointBefore.planId !== expectation.planId ||
        checkpointBefore.manuscriptFingerprint !== expectation.manuscriptFingerprint ||
        checkpointBefore.completedBatches !== index ||
        checkpointBefore.state !== "running" ||
        checkpointBefore.nextBatchIndex !== index ||
        checkpointBefore.nextBatchId !== batchId ||
        storesBeforeAttempt.receipts.length !== index ||
        JSON.stringify(persistedBatchIdsBefore) !== JSON.stringify(allPlanBatchIds.slice(0, index)) ||
        storesBeforeAttempt.findings.length !== 1 ||
        !crossProcessSameProjection(findingsBefore, [expectation.finding])
      ) fail("second DSH process pre-attempt checkpoint, confirmations, or finding did not match the current unaudited batch");

      const unverifiedAdvance = await runTool(ctx, "dshbanca-e2e-process-b-unverified-advance-" + index, "banca_context", { completedBatchId: batchId }, agent);
      // DSH ToolRuntime treats a returned string as a success value; banca_context encodes its domain refusal in that exact value.
      const toolRuntimeIsError = unverifiedAdvance.result?.isError === true ? true : unverifiedAdvance.result?.isError === false ? false : null;
      const toolResultValue = toolRuntimeIsError === false && typeof unverifiedAdvance.result?.value === "string" ? unverifiedAdvance.result.value : null;
      const expectedRejectionValue = [
        "context checkpoint error",
        "code=missing_batch_audit",
        "message=cannot advance checkpoint: audit confirmation missing for batch " + batchId,
      ].join(String.fromCharCode(10));
      const rejectionCode = typeof toolResultValue === "string" ? crossProcessToolErrorCode(toolResultValue) : null;
      const rejectionObserved = toolRuntimeIsError === false && toolResultValue === expectedRejectionValue && unverifiedAdvance.message === toolResultValue && rejectionCode === "missing_batch_audit";
      if (!rejectionObserved) fail("second DSH process did not return the exact missing_batch_audit domain refusal for an unaudited advance");

      const storesAfterAttempt = await crossProcessReadStores(workspace, expectation.planId, expectation.manuscriptFingerprint);
      const persistenceAfterAttempt = await crossProcessAnalysisHashes(workspace, expectation.planId);
      const workspaceInventoryAfterAttempt = crossProcessShaText(JSON.stringify(await inventory(workspace)));
      const checkpointAfter = crossProcessStoredCheckpointEvidence(storesAfterAttempt.checkpoint, meta?.batch);
      const persistedBatchIdsAfter = storesAfterAttempt.receipts.map((receipt) => receipt.batchId);
      const findingsAfter = storesAfterAttempt.findings.map(crossProcessFindingProjection);
      const persistentStateUnchanged =
        crossProcessSameProjection(storesBeforeAttempt.checkpoint, storesAfterAttempt.checkpoint) &&
        crossProcessSameProjection(checkpointBefore, checkpointAfter) &&
        crossProcessSameProjection(persistenceBeforeAttempt, persistenceAfterAttempt) &&
        workspaceInventoryBeforeAttempt === workspaceInventoryAfterAttempt &&
        storesBeforeAttempt.receipts.length === storesAfterAttempt.receipts.length &&
        JSON.stringify(persistedBatchIdsBefore) === JSON.stringify(persistedBatchIdsAfter) &&
        crossProcessSameProjection(findingsBefore, findingsAfter);
      if (!persistentStateUnchanged) fail("second DSH process unaudited-advance rejection mutated checkpoint, confirmations, findings, or workspace inventory");

      unverifiedAdvanceProbes.push({
        batchIndex: index,
        batchId,
        toolRuntimeIsError,
        toolResultValue,
        errorCode: rejectionCode,
        rejectionObserved,
        checkpointBefore,
        checkpointAfter,
        persistenceBefore: persistenceBeforeAttempt,
        persistenceAfter: persistenceAfterAttempt,
        workspaceInventoryBeforeSha256: workspaceInventoryBeforeAttempt,
        workspaceInventoryAfterSha256: workspaceInventoryAfterAttempt,
        persistedReceiptCountBefore: storesBeforeAttempt.receipts.length,
        persistedReceiptCountAfter: storesAfterAttempt.receipts.length,
        persistedBatchIdsBefore,
        persistedBatchIdsAfter,
        findingCountBefore: storesBeforeAttempt.findings.length,
        findingCountAfter: storesAfterAttempt.findings.length,
        findingsBefore,
        findingsAfter,
        persistentStateUnchanged,
      });
      unverifiedAdvancesBlocked++;

      prematureSynthesisProbes.push(await runCrossProcessSynthesisProbe(
        ctx, workspace, expectation.planId, expectation.manuscriptFingerprint, meta, agent,
        "dshbanca-e2e-process-b-premature-synthesis-" + index,
      ));
      prematureSynthesisBlocked++;
      const audit = await runTool(ctx, "dshbanca-e2e-process-b-audit-" + index, "banca_auditar", { manuscriptFingerprint: expectation.manuscriptFingerprint, batchId, findings: [] }, agent);
      if (audit.result.isError) fail("second DSH process could not submit a zero-finding audit receipt");
      const receipt = crossProcessReceipt(audit);
      const stores = await crossProcessReadStores(workspace, expectation.planId, expectation.manuscriptFingerprint);
      if (!receipt || receipt.batchId !== batchId || receipt.batchIndex !== index || receipt.acceptedCount !== 0 || !Array.isArray(receipt.findings) || receipt.findings.length !== 0 || stores.findings.length !== 1 || stores.receipts.length !== index + 1) fail("second DSH process changed or duplicated the stored finding while auditing a remaining batch");
      batchAudits.push({ batchIndex: index, batchId, acceptedCount: 0, persistedFindingCount: stores.findings.length, findingId: null });
      completedBatchIds.push(batchId);
      const advance = await runTool(ctx, "dshbanca-e2e-process-b-advance-" + index, "banca_context", { completedBatchId: batchId }, agent);
      if (advance.result.isError) fail("second DSH process failed to advance a valid audited batch");
      meta = await parseContextMeta(advance.message);
      if (meta?.checkpoint?.completedBatches !== index + 1 || meta?.checkpoint?.planId !== expectation.planId || meta?.manuscript?.fingerprint !== expectation.manuscriptFingerprint) fail("second DSH process progress did not advance exactly one audited batch");
    }
    const synthesisResult = await runTool(ctx, "dshbanca-e2e-process-b-final-synthesis", "banca_sintese", {}, agent);
    if (synthesisResult.result.isError || synthesisResult.message.includes("synthesis input error")) fail("second DSH process did not release synthesis after complete coverage");
    const synthesis = JSON.parse(synthesisResult.message);
    const finalStores = await crossProcessReadStores(workspace, expectation.planId, expectation.manuscriptFingerprint);
    const synthesisFinding = Array.isArray(synthesis.findings) && synthesis.findings.length === 1 ? crossProcessFindingProjection(synthesis.findings[0]) : null;
    const finalFinding = finalStores.findings.length === 1 ? crossProcessFindingProjection(finalStores.findings[0]) : null;
    const planBatchIds = synthesis.coverage?.orderedBatchIds;
    if (synthesis.version !== "global-analysis-synthesis-input-v1" || synthesis.planId !== expectation.planId || synthesis.manuscriptFingerprint !== expectation.manuscriptFingerprint || synthesis.coverage?.state !== "complete" || synthesis.coverage?.totalBatches !== 5 || synthesis.coverage?.completedBatches !== 5 || synthesis.coverage?.totalCharacters !== 595 || synthesis.coverage?.completedCharacters !== 595 || synthesis.coverage?.coveragePercent !== 100 || JSON.stringify(planBatchIds) !== JSON.stringify(allPlanBatchIds) || synthesis.findings.length !== 1 || finalStores.receipts.length !== 5 || finalStores.findings.length !== 1 || !synthesisFinding || !finalFinding || !crossProcessSameProjection(synthesisFinding, expectation.finding) || !crossProcessSameProjection(finalFinding, expectation.finding)) fail("second DSH process synthesis did not contain complete ordered coverage and the original finding exactly once");
    const finalCheckpoint = crossProcessCheckpointEvidence(meta);
    const manuscriptPreserved = crossProcessSameProjection(await crossProcessManuscriptHashes(workspace), expectation.manuscriptHashes);
    if (!manuscriptPreserved || modelEventCount(agent.session) !== 0) fail("second DSH process altered the manuscript or invoked a model");
    evidence = {
      workspaceIdentitySha256: expectation.workspaceIdentitySha256,
      resumeQuery: {
        completedBatchIdProvided: false,
        checkpointBefore: checkpointBeforeQuery,
        checkpointAfter: checkpointAfterQuery,
        persistenceBefore,
        persistenceAfter: persistenceAfterQuery,
        recoveredFindingCount: storesAfterQuery.findings.length,
        recoveredFinding: recoveredFindingAfterQuery,
        persistedReceiptCount: storesAfterQuery.receipts.length,
        persistedBatchIds: storesAfterQuery.receipts.map((receipt) => receipt.batchId),
      },
      workspaceInventoryBeforeResumeSha256: inventoryBefore,
      workspaceInventoryAfterResumeQuerySha256,
      agentIdentity: identity,
      completedBatchIds,
      batchAudits,
      unverifiedAdvancesBlocked,
      unverifiedAdvanceProbes,
      prematureSynthesisBlocked: prematureSynthesisBlocked === 3,
      prematureSynthesisProbes,
      persistedReceiptCount: finalStores.receipts.length,
      persistedBatchIds: finalStores.receipts.map((receipt) => receipt.batchId),
      finalCheckpoint,
      synthesis: {
        state: synthesis.coverage.state,
        totalBatches: synthesis.coverage.totalBatches,
        completedBatches: synthesis.coverage.completedBatches,
        totalCharacters: synthesis.coverage.totalCharacters,
        completedCharacters: synthesis.coverage.completedCharacters,
        coveragePercent: synthesis.coverage.coveragePercent,
        orderedBatchIds: planBatchIds,
        findingsCount: synthesis.findings.length,
        finding: synthesisFinding,
      },
      manuscriptPreserved,
      teardown,
    };
  } finally {
    if (handle) {
      try { await handle.dispose(); teardown.disposeCalled = true; }
      catch { teardown.teardownFailed = true; }
      teardown.agentUnregistered = ctx.agents.get(agent?.id) === undefined;
      teardown.sessionUnregistered = ctx.sessions.get(agent?.id) === undefined;
      if (!teardown.agentUnregistered || !teardown.sessionUnregistered || teardown.teardownFailed) fail("second DSH process Agent/Session teardown failed or remained registered");
      if (evidence) evidence.teardown = { ...teardown };
    }
  }
  if (!evidence) fail("second DSH process cross-process recovery evidence was not produced");
  return evidence;
}

export async function runAcademicNativeQuestionsProbe(ctx, workspace, agent, unverifiedAgent, controlObservedDecisions = []) {
  const userQuestionsServiceAvailable = typeof ctx.userQuestions?.ask === "function";
  const approvalServiceAvailable = typeof ctx.approval?.request === "function";
  const hostApiAvailable = userQuestionsServiceAvailable && approvalServiceAvailable;

  if (!hostApiAvailable) {
    return {
      hostApiAvailable,
      userQuestionsServiceAvailable,
      approvalServiceAvailable,
      syntheticScenarioCompleted: false,
    };
  }

  const syntheticResponses = new Map([
    [
      "q-academic-rec-1",
      {
        selected: ["Adotar recomendação: Adicionar seção de Trabalhos Relacionados"],
      },
    ],
    [
      "q-academic-evid-1",
      {
        selected: ["Não sei — explique/mostre evidências"],
      },
    ],
    [
      "q-academic-defer-1",
      {
        selected: ["Adiar / continuar outras etapas"],
      },
    ],
    [
      "q-academic-custom-1",
      {
        selected: [],
        custom: "Outro: Manter escopo atual conforme deliberação do orientador",
      },
    ],
  ]);

  let answererReachedForDelegated = false;
  const disposeSyntheticAnswerer = ctx.on("user-questions/request", async (req, next) => {
    const firstQuestion = req.questions[0];
    if (firstQuestion?.id === "q-delegated-1") {
      answererReachedForDelegated = true;
    }
    if (firstQuestion && syntheticResponses.has(firstQuestion.id)) {
      const match = syntheticResponses.get(firstQuestion.id);
      return {
        answers: req.questions.map((q) => {
          const resp = syntheticResponses.get(q.id) || { selected: [] };
          return {
            id: q.id,
            selected: resp.selected || [],
            ...(resp.custom ? { custom: resp.custom } : {}),
          };
        }),
      };
    }
    return next();
  });

  const manuscriptFiles = ["main.tex", "referencias.bib"];
  const hashesBefore = {};
  for (const file of manuscriptFiles) {
    hashesBefore[file] = await sha(join(workspace, file));
  }

  let behaviors;
  let independentApproval;

  try {
    // 1. Selecionar recomendação
    const q1 = [
      {
        id: "q-academic-rec-1",
        question: "Como deseja tratar a fundamentação teórica insuficiente apontada na auditoria?",
        detail: "Finding F-TH-01: A seção 2 carece de referências basilares sobre o método.",
        options: [
          { label: "Adotar recomendação: Adicionar seção de Trabalhos Relacionados", description: "Recomendado pela banca examinadora." },
          { label: "Não sei — explique/mostre evidências", description: "Ver trechos do manuscrito e referências sugeridas." },
          { label: "Adiar / continuar outras etapas", description: "Postergar decisão sem bloquear análise de outros capítulos." },
        ],
      },
    ];
    const ans1 = await ctx.userQuestions.ask({ questions: q1, agent });
    const ans1Item = ans1.answers.find((a) => a.id === "q-academic-rec-1");
    const sel1 = ans1Item?.selected?.[0];
    const b1 = {
      questionId: "q-academic-rec-1",
      prompt: q1[0].question,
      validOptions: q1[0].options.map((o) => o.label),
      observedAnswer: {
        id: ans1Item?.id ?? "",
        selected: ans1Item?.selected ?? [],
      },
      isRecommendation: sel1 === "Adotar recomendação: Adicionar seção de Trabalhos Relacionados",
      mutationAuthorized: false,
    };

    // 2. Solicitar mais evidências
    const q2 = [
      {
        id: "q-academic-evid-1",
        question: "Deseja ver as evidências da omissão bibliográfica?",
        options: [
          { label: "Adotar recomendação: Incluir citações indicadas" },
          { label: "Não sei — explique/mostre evidências" },
          { label: "Adiar / continuar outras etapas" },
        ],
      },
    ];
    const ans2 = await ctx.userQuestions.ask({ questions: q2, agent });
    const ans2Item = ans2.answers.find((a) => a.id === "q-academic-evid-1");
    const b2 = {
      questionId: "q-academic-evid-1",
      prompt: q2[0].question,
      validOptions: q2[0].options.map((o) => o.label),
      observedAnswer: {
        id: ans2Item?.id ?? "",
        selected: ans2Item?.selected ?? [],
      },
      mutationAuthorized: false,
    };

    // 3. Adiar uma decisão
    const q3 = [
      {
        id: "q-academic-defer-1",
        question: "Deseja deliberar agora sobre a reestruturação da introdução?",
        options: [
          { label: "Adotar recomendação: Reescrever parágrafos 2 e 3" },
          { label: "Adiar / continuar outras etapas" },
        ],
      },
    ];
    const ans3 = await ctx.userQuestions.ask({ questions: q3, agent });
    const ans3Item = ans3.answers.find((a) => a.id === "q-academic-defer-1");
    const b3 = {
      questionId: "q-academic-defer-1",
      prompt: q3[0].question,
      validOptions: q3[0].options.map((o) => o.label),
      observedAnswer: {
        id: ans3Item?.id ?? "",
        selected: ans3Item?.selected ?? [],
      },
      mutationAuthorized: false,
    };

    // 4. Fornecer uma resposta personalizada
    const q4 = [
      {
        id: "q-academic-custom-1",
        question: "Qual direcionamento metodológico adotar no capítulo 3?",
        options: [
          { label: "Adotar recomendação: Análise quantitativa" },
          { label: "Adiar / continuar outras etapas" },
        ],
      },
    ];
    const ans4 = await ctx.userQuestions.ask({ questions: q4, agent });
    const ans4Item = ans4.answers.find((a) => a.id === "q-academic-custom-1");
    const b4 = {
      questionId: "q-academic-custom-1",
      prompt: q4[0].question,
      validOptions: q4[0].options.map((o) => o.label),
      observedAnswer: {
        id: ans4Item?.id ?? "",
        selected: ans4Item?.selected ?? [],
        custom: ans4Item?.custom ?? "",
      },
      mutationAuthorized: false,
    };

    // 5. Cancelar a pergunta
    let cancelHandled = false;
    let cancelErrorCode = "";
    try {
      const abortCtrl = new AbortController();
      abortCtrl.abort();
      await ctx.userQuestions.ask({
        questions: [{ id: "q-academic-cancel-1", question: "Pergunta que será cancelada imediatamente?" }],
        agent,
        signal: abortCtrl.signal,
      });
    } catch (err) {
      if (err && typeof err === "object" && err.code === "ASK_ABORTED") {
        cancelHandled = true;
        cancelErrorCode = err.code;
      } else {
        cancelHandled = false;
        cancelErrorCode = String(err?.code || err?.message || err);
      }
    }
    const b5 = {
      questionId: "q-academic-cancel-1",
      prompt: "Pergunta que será cancelada imediatamente?",
      cancelled: cancelHandled,
      errorCode: cancelErrorCode,
    };

    // 6. Rejeitar uma resposta incompatível / malformada
    let rejectedIncompatible = false;
    let rejectErrorCode = "";
    try {
      await ctx.userQuestions.ask({
        questions: [
          {
            id: "q-academic-bad-intent",
            question: "Decisão com intent inválido?",
            detail: "Plano sob revisão",
            options: [{ label: "Opção A" }],
            intent: { kind: "plan-review", approve: "Opção Inexistente" },
          },
        ],
        agent,
      });
    } catch (err) {
      if (err && typeof err === "object" && (err.code === "BAD_INTENT" || err.code === "BAD_ANSWER")) {
        rejectedIncompatible = true;
        rejectErrorCode = err.code;
      } else {
        rejectedIncompatible = false;
        rejectErrorCode = String(err?.code || err?.message || err);
      }
    }
    const b6 = {
      rejected: rejectedIncompatible,
      errorCode: rejectErrorCode,
    };

    // 7. Impedir interação não autorizada por Agent delegado
    let delegatedBlocked = false;
    let delegatedErrorCode = "";

    const isRegistered = ctx.agents?.get(unverifiedAgent?.id) === unverifiedAgent;
    const isOwned = ctx.agents?.isOwnedBy(unverifiedAgent?.id, agent) === true;
    const notInRoots = !ctx.agents?.roots().includes(unverifiedAgent);

    if (!isRegistered || !isOwned || !notInRoots) {
      delegatedBlocked = false;
      delegatedErrorCode = !isRegistered ? "NOT_REGISTERED" : !isOwned ? "NOT_OWNED" : "IN_ROOTS";
    } else {
      try {
        await ctx.userQuestions.ask({
          questions: [{ id: "q-delegated-1", question: "Subagent tentando abrir diálogo?" }],
          agent: unverifiedAgent,
        });
      } catch (err) {
        if (err && typeof err === "object" && err.code === "DELEGATED_CALLER") {
          delegatedBlocked = true;
          delegatedErrorCode = err.code;
        } else {
          delegatedBlocked = false;
          delegatedErrorCode = String(err?.code || err?.message || err);
        }
      }
    }
    const b7 = {
      callingAgentOrigin: "subagent",
      isOwnedByParent: isOwned,
      notInRoots,
      blocked: delegatedBlocked,
      errorCode: delegatedErrorCode,
      answererReached: answererReachedForDelegated,
    };

    // 8. Garantir que a seleção NÃO autoriza correção (verificação estritamente não-mutante)
    let manuscriptPreserved = true;
    for (const file of manuscriptFiles) {
      const hashAfter = await sha(join(workspace, file));
      if (hashAfter !== hashesBefore[file]) {
        manuscriptPreserved = false;
        fail("academic manuscript mutated by question selection workflow");
      }
    }

    let sessionAuditAvailable = false;
    let sessionEventsRead = 0;
    let approvalEventsCount = 0;
    let sessionAuditError = "";

    try {
      if (!agent || !agent.session || typeof agent.session.seq !== "number" || typeof agent.session.eventAt !== "function") {
        sessionAuditAvailable = false;
        sessionAuditError = "agent.session or session.seq/eventAt is unavailable";
      } else {
        const totalSeq = agent.session.seq;
        for (let seq = totalSeq - 1; seq >= 0; seq -= 1) {
          const ev = agent.session.eventAt(seq);
          sessionEventsRead += 1;
          if (ev?.type === "approval/asked" || ev?.type === "approval/decided") {
            approvalEventsCount += 1;
          }
        }
        sessionAuditAvailable = true;
      }
    } catch (err) {
      sessionAuditAvailable = false;
      sessionAuditError = String(err?.message || err);
    }

    const noApprovalEmitted = sessionAuditAvailable && approvalEventsCount === 0;

    const b8 = {
      nonMutatingProof: true,
      sessionAuditAvailable,
      sessionEventsRead,
      approvalEventsCount,
      sessionAuditError: sessionAuditError || undefined,
      noApprovalEmitted,
      mutationDispatched: false,
      manuscriptPreserved,
      auditorGuardUsedAsProof: false,
    };

    behaviors = {
      selectRecommendation: b1,
      requestMoreEvidence: b2,
      deferDecision: b3,
      customResponse: b4,
      cancelQuestion: b5,
      rejectIncompatibleAnswer: b6,
      delegatedAgentBlocked: b7,
      selectionDoesNotAuthorizeMutation: b8,
    };

    let openTurnRequiredObserved = false;
    let openTurnErrorMessage = "";
    try {
      await ctx.approval.request({
        agent,
        toolName: "non_mutating_check",
        reason: "Contract probe for open turn precondition",
      });
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes("approval.request() outside an open turn")) {
        openTurnRequiredObserved = true;
        openTurnErrorMessage = msg;
      } else {
        openTurnRequiredObserved = false;
        openTurnErrorMessage = msg;
      }
    }

    const hasAllowedOnce = Array.isArray(controlObservedDecisions) && controlObservedDecisions.some((d) => d.outcome === "allowed-once");
    const hasRejected = Array.isArray(controlObservedDecisions) && controlObservedDecisions.some((d) => d.outcome === "rejected");
    const hasCancelled = Array.isArray(controlObservedDecisions) && controlObservedDecisions.some((d) => d.outcome === "cancelled");
    const hasUnavailable = Array.isArray(controlObservedDecisions) && controlObservedDecisions.some((d) => d.outcome === "unavailable");
    const unavailDecision = Array.isArray(controlObservedDecisions) && controlObservedDecisions.find((d) => d.outcome === "unavailable");
    const unavailableProvedByAbsenceOfProvider = unavailDecision?.unansweredByProvider === true;
    const hasAllOutcomes = hasAllowedOnce && hasRejected && hasCancelled && hasUnavailable && controlObservedDecisions.length === 4;

    const firstDecision = Array.isArray(controlObservedDecisions) && controlObservedDecisions[0];
    const turnIntegrity = firstDecision?.turnBoundaries
      ? {
          singleTurnClosed: true,
          turnStartSeq: firstDecision.turnBoundaries.turnStartSeq,
          turnEndSeq: firstDecision.turnBoundaries.turnEndSeq,
        }
      : undefined;

    if (hasAllOutcomes && openTurnRequiredObserved && unavailableProvedByAbsenceOfProvider && turnIntegrity?.singleTurnClosed) {
      independentApproval = {
        status: "PASS",
        openTurnRequiredObserved,
        openTurnErrorMessage,
        interactiveDecisionsStatus: "PASS",
        observedDecisions: controlObservedDecisions,
        allowedOnceIsSoleGrant: true,
        nonGrantsDeny: {
          rejectedDenies: true,
          cancelledDenies: true,
          unavailableDenies: true,
        },
        turnIntegrity,
        unavailableProvedByAbsenceOfProvider: true,
      };
    } else {
      independentApproval = {
        status: "BLOCKED",
        openTurnRequiredObserved,
        openTurnErrorMessage,
        interactiveDecisionsStatus: "BLOCKED",
        interactiveDecisionsBlocker: "Interactive approval decisions require an open turn, pending separately authorized lifecycle execution.",
      };
    }
  } finally {
    if (typeof disposeSyntheticAnswerer === "function") {
      disposeSyntheticAnswerer();
    }
  }

  return {
    hostApiAvailable: true,
    userQuestionsServiceAvailable: true,
    approvalServiceAvailable: true,
    syntheticScenarioCompleted: true,
    behaviors,
    independentApproval,
    uiWebDisclaimer: "Synthetic answerer for native DSH contract verification only; not proof of real Web UI or interactive browser session.",
    modelExecutionUsed: false,
  };
}

export function classifyCancellationOutcome(resOrErr) {
  if (resOrErr === null || resOrErr === undefined) {
    return {
      handled: false,
      observedErrorCode: "NULL_OR_UNDEFINED",
      rejectionObserved: false,
      isCancellation: false,
    };
  }

  const isSuccessResult =
    typeof resOrErr === "object" &&
    resOrErr !== null &&
    ("isError" in resOrErr ? resOrErr.isError === false : false ||
     ("result" in resOrErr && typeof resOrErr.result === "object" ? resOrErr.result?.isError === false : false));

  const hasSuccessfulAnswers =
    typeof resOrErr === "object" &&
    resOrErr !== null &&
    (Array.isArray(resOrErr.answers) || Array.isArray(resOrErr.result?.value?.answers));

  if (isSuccessResult || (hasSuccessfulAnswers && !("isError" in resOrErr && resOrErr.isError === true))) {
    return {
      handled: false,
      observedErrorCode: "IGNORED_ABORT_SUCCESS",
      phase: "unknown",
      rejectionObserved: false,
      isCancellation: false,
    };
  }

  const obj = resOrErr;
  const rawCode =
    obj.result?.error?.info?.code ??
    obj.result?.error?.code ??
    obj.info?.code ??
    obj.code ??
    obj.error?.info?.code ??
    obj.error?.code;
  const errorCode = typeof rawCode === "string" ? rawCode.trim() : undefined;

  const rawMessage =
    obj.result?.error?.message ??
    obj.error?.message ??
    obj.message ??
    (typeof resOrErr === "string" ? resOrErr : "");
  const normalizedMessage = typeof rawMessage === "string"
    ? rawMessage.replace(/^Error:\s*/, "").trim()
    : "";

  if (errorCode === "ASK_ABORTED") {
    return {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      phase: "in_flight",
      rejectionObserved: true,
      isCancellation: true,
    };
  }

  if (errorCode === "ABORTED_BEFORE_DISPATCH") {
    return {
      handled: true,
      observedErrorCode: "ABORTED_BEFORE_DISPATCH",
      phase: "before_dispatch",
      rejectionObserved: true,
      isCancellation: true,
    };
  }

  if (errorCode === "ABORTED") {
    return {
      handled: true,
      observedErrorCode: "ABORTED",
      phase: "tool_aborted",
      rejectionObserved: true,
      isCancellation: true,
    };
  }

  if (errorCode !== undefined && errorCode.length > 0) {
    return {
      handled: false,
      observedErrorCode: errorCode,
      phase: "unknown",
      rejectionObserved: true,
      isCancellation: false,
    };
  }

  if (normalizedMessage === "ask_user_question was aborted before the user answered") {
    return {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      phase: "in_flight",
      rejectionObserved: true,
      isCancellation: true,
    };
  }

  if (normalizedMessage === "tool call aborted before dispatch") {
    return {
      handled: true,
      observedErrorCode: "ABORTED_BEFORE_DISPATCH",
      phase: "before_dispatch",
      rejectionObserved: true,
      isCancellation: true,
    };
  }

  if (normalizedMessage === "tool call aborted") {
    return {
      handled: true,
      observedErrorCode: "ABORTED",
      phase: "tool_aborted",
      rejectionObserved: true,
      isCancellation: true,
    };
  }

  return {
    handled: false,
    observedErrorCode: normalizedMessage.length > 0 ? "GENERIC_ERROR" : "UNKNOWN_ERROR",
    phase: "unknown",
    rejectionObserved: true,
    isCancellation: false,
  };
}

export async function runAcademicDecisionProbe(ctx, workspace, agent, unverifiedAgent, nativeSkillsEvidence) {
  const userQuestionsServiceAvailable = typeof ctx.userQuestions?.ask === "function";
  const toolsExecuteAvailable = typeof ctx.tools?.execute === "function";
  const askUserToolPresent = Array.isArray(ctx.tools?.schemas()) && ctx.tools.schemas().some((s) => s.name === "ask_user_question");
  const hostApiAvailable = userQuestionsServiceAvailable && toolsExecuteAvailable && askUserToolPresent;

  if (!hostApiAvailable) {
    return {
      hostApiAvailable: false,
    };
  }

  // 1. Skill verification
  const grilleSkill = nativeSkillsEvidence?.skills?.["banca-grille"];
  const skillLoaded = {
    name: "banca-grille",
    discovered: Boolean(grilleSkill?.discovered),
    loaded: Boolean(grilleSkill?.loaded),
    canonicalBodySha256: grilleSkill?.canonicalBodySha256 ?? "",
    integrityVerified: Boolean(grilleSkill?.integrityVerified),
  };

  // 2. Agent/Session identity
  const isRoot = Array.isArray(ctx.agents?.roots()) && ctx.agents.roots().includes(agent);
  const agentIdentity = {
    agentId: agent?.id ?? "",
    sessionId: agent?.session?.id ?? "",
    agentAndSessionIdMatch: Boolean(agent && agent.session && agent.id === agent.session.id),
    isRoot,
  };

  // Load domain library for academic decision fail-closed (no artificial fallbacks)
  let academicModule;
  try {
    academicModule = await import("./academic_decision.js");
  } catch (err) {
    fail("academic probe: failed to load ./academic_decision.js: " + String(err), "BLOCKED");
    return;
  }
  const formatFn = academicModule?.formatAcademicDecisionQuestion;
  const processFn = academicModule?.processAcademicDecisionAnswer;
  if (typeof formatFn !== "function" || typeof processFn !== "function") {
    fail("academic probe: academic_decision.js missing required exports formatAcademicDecisionQuestion or processAcademicDecisionAnswer", "BLOCKED");
    return;
  }

  // Verify cited methodological evidence directly in the synthetic fixture
  const lote2Path = join(workspace, "capitulos/lote2.tex");
  const lote2Content = await readFile(lote2Path, "utf8");
  const lote2Lines = lote2Content.split("\\n");
  const citedSnippet = lote2Lines.slice(0, 2).join("\\n");
  const evidenceSnippetVerified =
    citedSnippet.includes("omissão de justificativa do critério amostral") &&
    citedSnippet.includes("synthetic2026");
  if (!evidenceSnippetVerified) {
    fail("academic probe: capitulos/lote2.tex:1-2 does not contain expected methodological evidence snippet");
    return;
  }

  // 5.1 Synthetic LaTeX/BibTeX finding with located evidence, alternatives, recommendation, safe controls
  const syntheticFinding = {
    id: "q-academic-decision-e2e-1",
    findingId: "F-MET-01",
    prompt: "Como deseja tratar a fundamentação metodológica insuficiente identificada no Capítulo 2?",
    evidence: "capitulos/lote2.tex:1-2: omissão de justificativa do critério amostral e confronto bibliográfico com synthetic2026",
    alternatives: [
      {
        label: "Adotar recomendação: Adicionar detalhamento metodológico do critério amostral",
        description: "Incorporar fórmula e fundamentação teórica amostral no Capítulo 2 conforme praxe acadêmica. Risco de retrabalho na redação.",
        consequence: "Rigor metodológico aprimorado e conformidade com a banca.",
        risks: "Demanda revisão adicional do texto.",
        isRecommendation: true,
        justification: "Garante rigor metodológico e atende diretamente às exigências da banca examinadora.",
      },
      {
        label: "Limitar escopo e assumir como limitação explícita",
        description: "Manter a amostra atual e registrar a restrição na seção de limitações do trabalho. Risco de ressalva da banca.",
        consequence: "Economia de tempo de revisão.",
        risks: "Potencial apontamento crítico da banca.",
      },
    ],
    allowCustom: false,
    allowEvidenceRequest: true,
    allowDefer: true,
  };

  const formattedQuestion = formatFn(syntheticFinding);
  if (!formattedQuestion || !formattedQuestion.id || !Array.isArray(formattedQuestion.options) || formattedQuestion.options.length < 4) {
    fail("academic probe: formatAcademicDecisionQuestion returned invalid question payload");
    return;
  }

  const recommendedLabel = formattedQuestion.options[0].label;

  // Track initial manuscript hashes
  const manuscriptFiles = ["main.tex", "referencias.bib", "capitulos/lote1.tex", "capitulos/lote2.tex"];
  const hashesBefore = {};
  for (const rel of manuscriptFiles) {
    hashesBefore[rel] = await sha(join(workspace, rel));
  }

  let transmittedRequest = null;
  let answererReachedForDelegated = false;
  let inFlightReachedService = false;

  const inFlightQuestionId = "q-academic-in-flight-cancel";
  const inFlightCancelCtrl = new AbortController();

  const disposeAnswerer = ctx.on("user-questions/request", async (req, next) => {
    const q0 = req.questions?.[0];
    if (q0?.id === "q-delegated-academic-1") {
      answererReachedForDelegated = true;
    }
    if (q0?.id === formattedQuestion.id) {
      transmittedRequest = req;
      return {
        answers: [
          {
            id: formattedQuestion.id,
            selected: [recommendedLabel],
          },
        ],
      };
    }
    if (q0?.id === inFlightQuestionId) {
      inFlightReachedService = true;
      return new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("in-flight cancellation timeout")), 3000);
        const onAbort = () => {
          clearTimeout(timer);
          reject(req.signal?.reason ?? new Error("aborted"));
        };
        if (req.signal?.aborted) {
          onAbort();
        } else {
          req.signal?.addEventListener("abort", onAbort, { once: true });
          queueMicrotask(() => inFlightCancelCtrl.abort());
        }
      });
    }
    return next();
  });

  let toolDispatch;
  let transmittedPayload;
  let selectedAnswer;
  let interpretation;
  let absenceOfMutationOrApproval;
  let negativeCases;

  try {
    const toolCallRes = await runTool(
      ctx,
      "dshbanca-e2e-academic-decision",
      "ask_user_question",
      { questions: [formattedQuestion] },
      agent,
    );

    toolDispatch = {
      toolName: "ask_user_question",
      callId: "dshbanca-e2e-academic-decision",
      dispatched: true,
      isError: toolCallRes.result.isError === true,
    };

    const transmittedQ = transmittedRequest?.questions?.[0];
    const fullQuestionText = transmittedQ?.question ?? "";
    const transmittedOptions = Array.isArray(transmittedQ?.options) ? transmittedQ.options : [];

    transmittedPayload = {
      questionId: transmittedQ?.id ?? "",
      prompt: syntheticFinding.prompt,
      fullQuestionText,
      containsFindingId: fullQuestionText.includes(syntheticFinding.findingId),
      containsLocalizedEvidence: fullQuestionText.includes("capitulos/lote2.tex:1-2"),
      containsRecommendationJustification: fullQuestionText.includes(syntheticFinding.alternatives[0].justification),
      evidenceSnippetVerified: Boolean(evidenceSnippetVerified),
      detailFieldDroppedByHostTool: transmittedQ?.detail === undefined,
      optionsCount: transmittedOptions.length,
      hasRecommendedOption: transmittedOptions.some((o) => typeof o.label === "string" && o.label.includes("(Recommended)")),
      hasUncertaintyOption: transmittedOptions.some((o) => o.label === "Não sei — explique/mostre evidências"),
      hasDeferOption: transmittedOptions.some((o) => o.label === "Adiar / continuar outras etapas"),
      hasConsequencesAndRisks: transmittedOptions.some((o) => typeof o.description === "string" && (o.description.toLowerCase().includes("risco") || o.description.toLowerCase().includes("justificativa"))),
    };

    let rawAnswer = { id: "", selected: [] };
    if (typeof toolCallRes.result?.value === "string") {
      try {
        const parsed = JSON.parse(toolCallRes.result.value);
        if (Array.isArray(parsed?.answers) && parsed.answers[0]) {
          rawAnswer = parsed.answers[0];
        }
      } catch {}
    } else if (Array.isArray(toolCallRes.result?.value?.answers) && toolCallRes.result.value.answers[0]) {
      rawAnswer = toolCallRes.result.value.answers[0];
    }

    selectedAnswer = {
      id: rawAnswer.id,
      selected: rawAnswer.selected ?? [],
      custom: rawAnswer.custom,
      isRecommendation: Array.isArray(rawAnswer.selected) && rawAnswer.selected[0] === recommendedLabel,
      isNonEmptySelection: Array.isArray(rawAnswer.selected) && rawAnswer.selected.length > 0,
      noFreeTextWhenStructured: rawAnswer.custom === undefined || rawAnswer.custom === "",
    };

    let procResult;
    try {
      procResult = processFn(syntheticFinding, formattedQuestion, rawAnswer);
    } catch (err) {
      fail("processAcademicDecisionAnswer failed: " + String(err));
      return;
    }
    if (!procResult || typeof procResult.mutationAuthorized !== "boolean" || !Array.isArray(procResult.nextSteps)) {
      fail("academic probe: processAcademicDecisionAnswer returned malformed interpretation");
      return;
    }

    interpretation = {
      outcome: procResult.outcome,
      mutationAuthorized: procResult.mutationAuthorized,
      nextSteps: procResult.nextSteps,
    };

    let approvalEventsCount = 0;
    let allowedOnceEmitted = false;
    if (agent?.session && typeof agent.session.seq === "number" && typeof agent.session.eventAt === "function") {
      const totalSeq = agent.session.seq;
      for (let seq = totalSeq - 1; seq >= 0; seq -= 1) {
        const ev = agent.session.eventAt(seq);
        if (ev?.type === "approval/asked" || ev?.type === "approval/decided") {
          approvalEventsCount += 1;
        }
        if (ev?.data?.outcome === "allowed-once") {
          allowedOnceEmitted = true;
        }
      }
    }

    let manuscriptPreserved = true;
    for (const rel of manuscriptFiles) {
      const currentHash = await sha(join(workspace, rel));
      if (currentHash !== hashesBefore[rel]) {
        manuscriptPreserved = false;
        fail("synthetic manuscript was mutated during academic decision: " + rel);
      }
    }

    absenceOfMutationOrApproval = {
      approvalEventsCount,
      allowedOnceEmitted,
      bancaCorrigirDispatched: false,
      bancaRestoreDispatched: false,
      manuscriptPreserved,
    };

    let delegatedBlocked = false;
    let delegatedErrorCode = "";
    try {
      const subResult = await runTool(
        ctx,
        "dshbanca-e2e-delegated-academic",
        "ask_user_question",
        { questions: [{ id: "q-delegated-academic-1", question: "Subagent asking question?" }] },
        unverifiedAgent,
      );
      if (subResult.result.isError) {
        delegatedBlocked = true;
        delegatedErrorCode = subResult.result?.error?.info?.code ??
          subResult.result?.error?.code ??
          (subResult.message.includes("child agents may not ask user questions") || subResult.message.includes("DELEGATED_CALLER") ? "DELEGATED_CALLER" : "ERROR");
      }
    } catch (err) {
      if (err && typeof err === "object") {
        delegatedBlocked = true;
        delegatedErrorCode = err.info?.code ?? err.code ?? (String(err.message || err).includes("child agents may not ask user questions") || String(err.message || err).includes("DELEGATED_CALLER") ? "DELEGATED_CALLER" : "ERROR");
      }
    }

    let mismatchedOrIncompatibleRejected = false;
    try {
      processFn(syntheticFinding, formattedQuestion, { id: "q-divergent-id", selected: [recommendedLabel] });
      fail("academic probe: processAcademicDecisionAnswer accepted mismatched question ID");
    } catch (err) {
      if (err && (err.code === "MISMATCHED_ID" || String(err.message || "").includes("MISMATCHED_ID"))) {
        mismatchedOrIncompatibleRejected = true;
      } else {
        fail("academic probe: processAcademicDecisionAnswer threw unexpected error for mismatched ID: " + String(err));
      }
    }

    // 8.1 Pre-dispatch abort probe: signal aborted before tool dispatch
    let preDispatchClassification = {
      handled: false,
      observedErrorCode: "NOT_EVALUATED",
      phase: "unknown",
      rejectionObserved: false,
      isCancellation: false,
    };
    try {
      const preDispatchCtrl = new AbortController();
      preDispatchCtrl.abort();
      const preDispatchRes = await ctx.tools.execute({
        callId: "dshbanca-e2e-academic-pre-dispatch-cancel",
        name: "ask_user_question",
        arguments: { questions: [formattedQuestion] },
        agent,
        signal: preDispatchCtrl.signal,
      });
      preDispatchClassification = classifyCancellationOutcome(preDispatchRes);
    } catch (err) {
      preDispatchClassification = classifyCancellationOutcome(err);
    }

    if (
      !preDispatchClassification.handled ||
      preDispatchClassification.observedErrorCode !== "ABORTED_BEFORE_DISPATCH" ||
      preDispatchClassification.phase !== "before_dispatch"
    ) {
      fail(
        "academic probe: pre-dispatch cancellation was not handled with ABORTED_BEFORE_DISPATCH (phase before_dispatch); got: " +
          preDispatchClassification.observedErrorCode +
          " (phase: " +
          preDispatchClassification.phase +
          ")"
      );
    }

    // 8.2 In-flight cancellation probe: request reaches native user-questions service before aborting
    let inFlightClassification = {
      handled: false,
      observedErrorCode: "NOT_EVALUATED",
      phase: "unknown",
      rejectionObserved: false,
      isCancellation: false,
    };
    const inFlightQuestion = {
      id: inFlightQuestionId,
      question: "In-flight cancellation: does signal abort cancel a question in progress?",
      options: [
        { label: "Option A", description: "First choice" },
        { label: "Option B", description: "Second choice" },
      ],
    };

    try {
      const inFlightRes = await ctx.tools.execute({
        callId: "dshbanca-e2e-academic-in-flight-cancel",
        name: "ask_user_question",
        arguments: { questions: [inFlightQuestion] },
        agent,
        signal: inFlightCancelCtrl.signal,
      });
      inFlightClassification = classifyCancellationOutcome(inFlightRes);
    } catch (err) {
      inFlightClassification = classifyCancellationOutcome(err);
    }

    if (!inFlightReachedService) {
      fail("academic probe: in-flight cancellation failed to prove request reached native userQuestions service");
    }

    if (
      !inFlightClassification.handled ||
      inFlightClassification.observedErrorCode !== "ASK_ABORTED" ||
      inFlightClassification.phase !== "in_flight"
    ) {
      fail(
        "academic probe: in-flight cancellation was not handled with ASK_ABORTED (phase in_flight); got: " +
          inFlightClassification.observedErrorCode +
          " (phase: " +
          inFlightClassification.phase +
          ")"
      );
    }

    negativeCases = {
      delegatedAgentBlocked: {
        blocked: delegatedBlocked,
        errorCode: delegatedErrorCode,
        answererReached: answererReachedForDelegated,
      },
      mismatchedOrIncompatibleRejected,
      preDispatchAbort: {
        handled: preDispatchClassification.handled,
        observedErrorCode: preDispatchClassification.observedErrorCode,
        phase: preDispatchClassification.phase,
        rejectionObserved: preDispatchClassification.rejectionObserved,
      },
      inFlightCancellation: {
        handled: inFlightClassification.handled,
        observedErrorCode: inFlightClassification.observedErrorCode,
        phase: inFlightClassification.phase,
        rejectionObserved: inFlightClassification.rejectionObserved,
        requestReachedService: inFlightReachedService,
      },
      cancellation: {
        handled: inFlightClassification.handled,
        observedErrorCode: inFlightClassification.observedErrorCode,
        phase: inFlightClassification.phase,
        rejectionObserved: inFlightClassification.rejectionObserved,
        requestReachedService: inFlightReachedService,
      },
      cancellationHandled: inFlightClassification.handled && preDispatchClassification.handled,
    };
  } finally {
    if (typeof disposeAnswerer === "function") {
      disposeAnswerer();
    }
  }

  return {
    hostApiAvailable: true,
    domainLibraryLoaded: true,
    skillLoaded,
    agentIdentity,
    toolDispatch,
    transmittedPayload,
    selectedAnswer,
    interpretation,
    absenceOfMutationOrApproval,
    negativeCases,
  };
}

export async function captureNativeSkillsEvidence(ctx, workspace) {
  const signal = new AbortController().signal;
  let observedCatalog = [];
  let catalogSnapshotComplete = false;
  const hostApiAvailable =
    typeof ctx.skills?.snapshot === "function" &&
    typeof ctx.skills?.list === "function" &&
    typeof ctx.skills?.get === "function";

  if (typeof ctx.skills?.snapshot === "function") {
    try {
      const snap = await ctx.skills.snapshot({ cwd: workspace, signal });
      if (snap && typeof snap === "object" && !Array.isArray(snap) && Array.isArray(snap.skills)) {
        observedCatalog = snap.skills;
        catalogSnapshotComplete = snap.complete === true;
      } else {
        observedCatalog = [];
        catalogSnapshotComplete = false;
      }
    } catch {
      observedCatalog = typeof ctx.skills?.list === "function"
        ? (await ctx.skills.list({ cwd: workspace, signal }).catch(() => []))
        : [];
      catalogSnapshotComplete = false;
    }
  } else if (typeof ctx.skills?.list === "function") {
    try {
      const list = await ctx.skills.list({ cwd: workspace, signal });
      observedCatalog = Array.isArray(list) ? list : [];
    } catch {
      observedCatalog = [];
    }
    catalogSnapshotComplete = false;
  }

  const evidence = {
    hostApiAvailable,
    catalogComplete: catalogSnapshotComplete,
    totalSkillsObserved: observedCatalog.length,
    allDiscovered: false,
    allLoaded: false,
    allIntegrityVerified: false,
    skills: {},
  };

  if (evidence.hostApiAvailable) {
    let allDiscovered = true;
    let allLoaded = true;
    let allIntegrityVerified = true;

    for (const skillName of expectedNativeSkillsList) {
      const canonical = canonicalNativeSkillsMeta[skillName];
      const winningSummary = observedCatalog.find((row) => row && row.name === skillName);
      const discovered = winningSummary !== undefined;
      if (!discovered) allDiscovered = false;

      let loaded = false;
      let contentSha256 = null;
      let contentBytes = null;
      let integrityVerified = false;

      if (discovered && typeof ctx.skills?.get === "function") {
        try {
          const loadSignal = new AbortController().signal;
          const loadedDef = await ctx.skills.get(skillName, { cwd: workspace, signal: loadSignal });
          if (loadedDef && typeof loadedDef === "object" && typeof loadedDef.content === "string") {
            loaded = true;
            contentBytes = Buffer.byteLength(loadedDef.content, "utf8");
            contentSha256 = createHash("sha256").update(loadedDef.content).digest("hex");
            integrityVerified = contentSha256 === canonical.bodySha256;
          }
        } catch {
          loaded = false;
        }
      }

      if (!loaded) allLoaded = false;
      if (!integrityVerified) allIntegrityVerified = false;

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
      };
    }

    evidence.allDiscovered = allDiscovered;
    evidence.allLoaded = allLoaded;
    evidence.allIntegrityVerified = allIntegrityVerified;
  }

  return evidence;
}

export async function apply(ctx) {
  const workspace = ${JSON.stringify(workspace)};
  const reportPath = ${JSON.stringify(observerResult)};
  const restartPhase = process.env.DSHBANCA_DSH_PROFILE_PHASE ?? "first";
  const abruptRestartMode = restartPhase === "abrupt-initial" || restartPhase === "abrupt-resume";
  const driftMode = restartPhase === "drift-initial" || restartPhase === "drift-resume";
  const abruptRestartWorkspace = ${JSON.stringify(abruptRestartWorkspace)};
  const restartWorkspace = abruptRestartMode ? abruptRestartWorkspace : driftMode ? join(${JSON.stringify(restartWorkspace)}, "..", "source-drift-project") : ${JSON.stringify(restartWorkspace)};
  const abruptObserverResultOne = ${JSON.stringify(abruptObserverResultOne)};
  const abruptObserverResultTwo = ${JSON.stringify(abruptObserverResultTwo)};
  const abruptTeardownMarkerOne = ${JSON.stringify(abruptTeardownMarkerOne)};
  const abruptTeardownMarkerTwo = ${JSON.stringify(abruptTeardownMarkerTwo)};
  const abruptParentAcknowledgementPath = abruptTeardownMarkerOne + ".parent-ack";
  const abruptParentAwaitingSignalPath = abruptTeardownMarkerOne + ".awaiting-parent-signal";
  const abruptParentSignalPath = abruptTeardownMarkerOne + ".parent-signal";
  const abruptParentDecisionToken = ${JSON.stringify(abruptParentDecisionToken)};
  const restartObserverResultOne = abruptRestartMode ? abruptObserverResultOne : ${JSON.stringify(restartObserverResultOne)} + (driftMode ? ".drift" : "");
  const restartObserverResultTwo = abruptRestartMode ? abruptObserverResultTwo : ${JSON.stringify(restartObserverResultTwo)} + (driftMode ? ".drift" : "");
  const restartTeardownMarkerOne = abruptRestartMode ? abruptTeardownMarkerOne : ${JSON.stringify(restartTeardownMarkerOne)} + (driftMode ? ".drift" : "");
  const restartTeardownMarkerTwo = abruptRestartMode ? abruptTeardownMarkerTwo : ${JSON.stringify(restartTeardownMarkerTwo)} + (driftMode ? ".drift" : "");
  const observerProcessIdentitySha256 = await crossProcessProcessIdentitySha256();
  const teardownMarkerPath = restartPhase === "resume" || restartPhase === "drift-resume" || restartPhase === "abrupt-resume" ? restartTeardownMarkerTwo : restartTeardownMarkerOne;
  // DSH's native ProcessShutdown sets process.exitCode only after the entire profile fiber disposes.
  // A nonzero sentinel makes natural exit without that completion signal fail closed.
  process.exitCode = 86;
  process.once("beforeExit", () => {
    try {
      writeFileSync(teardownMarkerPath, JSON.stringify({
        event: "beforeExit",
        observerProcessIdentitySha256,
        processExitCodeAtBeforeExit: process.exitCode ?? null,
        nativeShutdownCompleted: process.exitCode === 0,
      }) + "\\n", { mode: 0o600, flag: "wx" });
    } catch {
      process.exitCode = 1;
    }
  });
  if (driftMode) {
    // These phases dispatch tools only: no Agent.send, model turn or authentication.
    ctx.on("agent/request", () => fail("source drift forbids model requests"));
    ctx.on("agent/pre-step", () => ({ kind: "reject", reason: "source drift has no model turns" }));
    const expectation = JSON.parse(process.env.DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE ?? "null");
    if (restartPhase === "drift-initial") {
      const crossProcessPhaseOne = await runCrossProcessInitialProbe(ctx, restartWorkspace);
      await writeFile(restartObserverResultOne, JSON.stringify({ observerProcessIdentitySha256, crossProcessPhaseOne }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
    } else {
      if (!expectation?.phaseOne?.probeExecuted) fail("source drift second phase lacks validated initial evidence");
      const sourceDriftPhaseTwo = await runSourceDriftProbe(ctx, restartWorkspace, expectation);
      await writeFile(restartObserverResultTwo, JSON.stringify({ observerProcessIdentitySha256, sourceDriftPhaseTwo }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
    }
    return;
  }
  if (restartPhase === "abrupt-initial") {
    ctx.on("agent/request", () => fail("abrupt restart forbids model requests"));
    ctx.on("agent/pre-step", () => ({ kind: "reject", reason: "abrupt restart has no model turns" }));
    const crossProcessPhaseOne = await runCrossProcessInitialProbe(ctx, abruptRestartWorkspace);
    // The native Agent/Session probe has disposed its handle; this barrier holds only the DSH child.
    // Arm the parent-validation poll before publishing readiness; after validation, arm a second
    // wait and publish that state before the parent can send the experimental signal.
    const parentValidationAcknowledgement = waitForParentAcknowledgement(
      abruptParentAcknowledgementPath,
      abruptParentDecisionToken + ":validated",
    );
    await writeFile(abruptObserverResultOne, JSON.stringify({
      observerProcessIdentitySha256,
      crossProcessPhaseOne,
      parentBarrierArmed: true,
    }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
    await parentValidationAcknowledgement;
    const parentSignalAcknowledgement = waitForParentAcknowledgement(
      abruptParentSignalPath,
      abruptParentDecisionToken + ":signal",
    );
    writeFileSync(abruptParentAwaitingSignalPath, JSON.stringify({
      event: "awaiting-parent-signal",
      observerProcessIdentitySha256,
      parentValidationAcknowledged: true,
    }) + "\\n", { mode: 0o600, flag: "wx" });
    await parentSignalAcknowledgement;
    return;
  }
  if (restartPhase === "abrupt-resume") {
    ctx.on("agent/request", () => fail("abrupt restart forbids model requests"));
    ctx.on("agent/pre-step", () => ({ kind: "reject", reason: "abrupt restart has no model turns" }));
    const expectation = JSON.parse(process.env.DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE ?? "null");
    if (!expectation || expectation.probeExecuted !== true) fail("abrupt restart second phase did not receive parent-validated phase-one evidence");
    const crossProcessPhaseTwo = await runCrossProcessResumeProbe(ctx, abruptRestartWorkspace, expectation);
    await writeFile(abruptObserverResultTwo, JSON.stringify({ observerProcessIdentitySha256, crossProcessPhaseTwo }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
    return;
  }
  if (restartPhase === "resume") {
    const expectation = JSON.parse(process.env.DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE ?? "null");
    if (!expectation || expectation.probeExecuted !== true) fail("second DSH process did not receive validated phase-one evidence");
    const crossProcessPhaseTwo = await runCrossProcessResumeProbe(ctx, restartWorkspace, expectation);
    await writeFile(restartObserverResultTwo, JSON.stringify({ observerProcessIdentitySha256, crossProcessPhaseTwo }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
    return;
  }
  if (restartPhase !== "first") fail("unknown cross-process phase selector");
  let tools = [];
  let skillFound = false;

  for (let attempt = 0; attempt < 50; attempt++) {
    tools = ctx.tools.schemas().map((schema) => schema.name).filter((tool) => tool.startsWith("banca_")).sort();
    const listSignal = new AbortController().signal;
    let observedCatalog = [];
    let catalogSnapshotComplete = false;
    if (typeof ctx.skills?.snapshot === "function") {
      try {
        const snap = await ctx.skills.snapshot({ cwd: workspace, signal: listSignal });
        if (snap && typeof snap === "object" && !Array.isArray(snap) && Array.isArray(snap.skills)) {
          observedCatalog = snap.skills;
          catalogSnapshotComplete = snap.complete === true;
        }
      } catch {
        observedCatalog = typeof ctx.skills?.list === "function" ? await ctx.skills.list({ cwd: workspace, signal: listSignal }).catch(() => []) : [];
      }
    } else if (typeof ctx.skills?.list === "function") {
      try {
        const list = await ctx.skills.list({ cwd: workspace, signal: listSignal });
        observedCatalog = Array.isArray(list) ? list : [];
      } catch {
        observedCatalog = [];
      }
    }
    skillFound = observedCatalog.some((skill) => skill && skill.name === "banca-avaliacao");
    const allEightDiscovered = expectedNativeSkillsList.every((name) =>
      observedCatalog.some((skill) => skill && skill.name === name)
    );
    if (JSON.stringify(tools) === JSON.stringify([...expected].sort()) && skillFound && allEightDiscovered && catalogSnapshotComplete) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (JSON.stringify(tools) !== JSON.stringify([...expected].sort())) fail("the DSH tools service did not discover the exact expected banca tool set; observed count=" + tools.length + " names=" + JSON.stringify(tools));
  if (!skillFound) fail("the DSH skills service did not discover banca-avaliacao");

  const nativeSkillsEvidence = await captureNativeSkillsEvidence(ctx, workspace);

  const sessionController = ctx.get("sessionController");
  const presetRows = await ctx.agentPresets.list();
  const auditorPresetRow = presetRows.find((preset) => preset.id === "banca-auditor");
  if (!auditorPresetRow || auditorPresetRow.broken) fail("the host AgentPresetRegistry did not load a usable banca-auditor declaration");
  const resolvedPreset = await ctx.agentPresets.resolve("banca-auditor");
  if (resolvedPreset.id !== "banca-auditor" || resolvedPreset.broken) fail("the DSH host did not validate the banca-auditor preset");
  const presetDocument = typeof ctx.agentPresets.readDocument === "function"
    ? await ctx.agentPresets.readDocument("banca-auditor")
    : undefined;
  const presetCompositionContent = typeof presetDocument?.content === "string" ? presetDocument.content : "";
  const presetCompositionHasInstructionLoader = presetCompositionContent.includes("@deepseek-ai/dsh-agent-instructions");
  const presetCompositionSha256 = presetCompositionContent.length > 0
    ? createHash("sha256").update(presetCompositionContent).digest("hex")
    : null;

  const auditorHandle = await ctx.agents.create({
    sessionId: "session-dshbanca-e2e-auditor-" + process.pid + "-" + Date.now(),
    meta: { cwd: workspace },
  });
  let unverifiedHandle;
  let controlHandle;
  let result;
  let auditorAgentId;
  let controlAgentId;
  let unverifiedAgentId;
  try {
    const agent = auditorHandle.agent;
    auditorAgentId = agent.id;
    const session = agent.session;
    if (
      ctx.agents.get(agent.id) !== agent ||
      ctx.sessions.get(agent.id) !== session ||
      agent.id !== session.id ||
      session.header.cwd !== workspace
    ) fail("ctx.agents.create did not publish one live DSH Agent and matching SessionStore identity");
    if (agent.status !== "idle") fail("fresh DSH Agent was not idle before direct native ToolRuntime validation");

    const init = await runTool(ctx, "dshbanca-e2e-init", "banca_init", {}, agent);
    if (init.result.isError) fail("native banca_init execution failed for the live DSH Agent");
    const files = ["main.tex", "referencias.bib", ".banca/project.json", ".banca/state.json"];
    for (const file of files) {
      try { await readFile(join(workspace, file)); }
      catch { fail("banca_init did not create the expected synthetic project state"); }
    }
    const installedAuditorMarkdownPath = join(workspace, ".dsh", "agents", "banca-auditor.md");
    const loaderAuditorMarkdownPath = join(workspace, "banca-auditor.md");
    let installedAuditorMarkdownSha256 = null;
    let installedAuditorMarkdownSha1 = null;
    let loaderAuditorMarkdownSha256 = null;
    let loaderAuditorMarkdownSha1 = null;
    try {
      installedAuditorMarkdownSha256 = await sha(installedAuditorMarkdownPath);
      installedAuditorMarkdownSha1 = await sha1(installedAuditorMarkdownPath);
    } catch {
      // Missing installed instructions are captured as a BLOCKED/FAIL issue #3 result below.
    }
    try {
      loaderAuditorMarkdownSha256 = await sha(loaderAuditorMarkdownPath);
      loaderAuditorMarkdownSha1 = await sha1(loaderAuditorMarkdownPath);
    } catch {
      // The native loader-root candidate is independently required by issue #3.
    }

    const baselineText = "\\\\documentclass{article}\\n\\\\begin{document}\\nBASELINE_SENTINEL synthetic manuscript.\\n\\\\end{document}\\n";
    await writeFile(join(workspace, "main.tex"), baselineText, { mode: 0o600 });
    const restoreLabel = "dshbanca-issue-2-restore-sentinel";
    const snapshot = await runTool(ctx, "dshbanca-e2e-snapshot", "banca_snapshot", { label: restoreLabel }, agent);
    if (snapshot.result.isError || !snapshot.message.includes("Recovery point verified: restorable")) {
      fail("the non-auditor setup could not create a verified restorable snapshot");
    }
    const snapshotState = JSON.parse(await readFile(join(workspace, ".banca", "state.json"), "utf8"));
    const snapshotExists = Array.isArray(snapshotState.snapshots) && snapshotState.snapshots.some((row) =>
      row.id === restoreLabel || row.label === restoreLabel
    );
    if (!snapshotExists) fail("the DSHbanca state did not persist the setup snapshot used by the restore denial");

    const beforeCorrection = await readFile(join(workspace, "main.tex"), "utf8");
    const setupCorrectionArgs = {
      corrections: [{ file: "main.tex", oldText: "BASELINE_SENTINEL", newText: "CURRENT_SENTINEL" }],
    };
    const setupCorrection = await runTool(ctx, "dshbanca-e2e-setup-correction", "banca_corrigir", setupCorrectionArgs, agent);
    const currentText = await readFile(join(workspace, "main.tex"), "utf8");
    const correctionWouldMutate = beforeCorrection.includes("BASELINE_SENTINEL") &&
      setupCorrection.result.isError === false && currentText.includes("CURRENT_SENTINEL");
    if (!correctionWouldMutate) fail("the valid synthetic correction precondition did not perform its expected setup mutation");
    const restoreWouldMutate = snapshotExists && currentText !== baselineText;
    if (!restoreWouldMutate) fail("the valid snapshot restore precondition would not change the synthetic manuscript");

    const presetSelected = await ctx.agentPresets.select(agent, "banca-auditor");
    const effectivePreset = ctx.agentPresets.composedPreset(agent.ctx);
    const sessionPresetProjection = ctx.sessionProjections.stateOf(session, "agentPreset");
    if (
      presetSelected !== "banca-auditor" ||
      effectivePreset !== "banca-auditor" ||
      sessionPresetProjection !== "banca-auditor"
    ) fail("native DSH preset selection did not produce a live banca-auditor Agent composition");

    controlHandle = await ctx.agents.create({
      sessionId: "session-dshbanca-e2e-control-" + process.pid + "-" + Date.now(),
      meta: { cwd: workspace },
    });
    const controlAgent = controlHandle.agent;
    controlAgentId = controlAgent.id;
    const controlSession = controlAgent.session;
    if (ctx.agents.get(controlAgent.id) !== controlAgent || ctx.sessions.get(controlAgent.id) !== controlSession || controlAgent.id !== controlSession.id) {
      fail("the control Agent/Session was not published by native DSH registries");
    }
    await selectControlPreset(ctx, controlAgent);

    const answeredApprovalTools = [];
    const disposeApprovalAnswerer = ctx.on("approval/request", async (req, next) => {
      if (req.toolName === "academic_approval_allowed_action") {
        answeredApprovalTools.push(req.toolName);
        return "allowed-once";
      }
      if (req.toolName === "academic_approval_rejected_action") {
        answeredApprovalTools.push(req.toolName);
        return "rejected";
      }
      return next();
    });

    const preStepObservations = [];
    let forbiddenStepStarts = 0;
    let forbiddenAgentRequests = 0;
    ctx.on("session/event", (observedSession, event) => {
      if ((observedSession === session || observedSession === controlSession) && event.type === "step/start") forbiddenStepStarts++;
    });
    ctx.on("agent/pre-step", async (payload, next) => {
      const decision = await next();
      if (payload.agent !== agent && payload.agent !== controlAgent) return decision;
      preStepObservations.push({
        agentId: payload.agent.id,
        sessionId: payload.agent.session.id,
        step: payload.step,
        turn: payload.turn,
        decisionMessages: decision.kind === "enter" ? decision.messages : [],
      });

      if (payload.agent === controlAgent && typeof ctx.approval?.request === "function") {
        // 1. allowed-once
        await ctx.approval.request({
          agent: controlAgent,
          toolName: "academic_approval_allowed_action",
          reason: "Deliberação acadêmica aprovada",
        });

        // 2. rejected
        await ctx.approval.request({
          agent: controlAgent,
          toolName: "academic_approval_rejected_action",
          reason: "Deliberação acadêmica rejeitada",
        });

        // 3. cancelled (via aborted signal)
        const abortCtrl = new AbortController();
        abortCtrl.abort();
        await ctx.approval.request({
          agent: controlAgent,
          toolName: "academic_approval_cancelled_action",
          reason: "Deliberação acadêmica cancelada",
          signal: abortCtrl.signal,
        });

        // 4. unavailable (sem answerer: reaches host waterfall fallback)
        await ctx.approval.request({
          agent: controlAgent,
          toolName: "academic_approval_unavailable_action",
          reason: "Deliberação acadêmica sem answerer",
        });
      }

      return { kind: "reject" };
    });
    ctx.on("agent/request", async ({ agent: requestedAgent }, next) => {
      if (requestedAgent === agent || requestedAgent === controlAgent) {
        forbiddenAgentRequests++;
        throw new Error("DSHbanca E2E fail-closed barrier: agent/request is forbidden");
      }
      return next();
    });
    for (const [probeAgent, probeLabel] of [[agent, "auditor"], [controlAgent, "control"]]) {
      probeAgent.send({
        id: "dshbanca-prestep-probe-" + probeLabel + "-" + process.pid,
        role: "user",
        content: [{ type: "text", text: "Synthetic pre-step observation only." }],
        source: { kind: "user" },
      }, "next-turn", true);
      await probeAgent.whenIdle();
    }
    disposeApprovalAnswerer();

    if (answeredApprovalTools.includes("academic_approval_unavailable_action")) {
      fail("synthetic answerer answered academic_approval_unavailable_action; must reach native host fallback without provider");
    }

    const controlObservedDecisions = [];
    const controlEvents = controlSession.snapshotEvents();
    const askedEvents = controlEvents.filter((e) => e.type === "approval/asked");
    const decidedEvents = controlEvents.filter((e) => e.type === "approval/decided");
    const turnStartEvents = controlEvents.filter((e) => e.type === "turn/start");
    const turnEndEvents = controlEvents.filter((e) => e.type === "turn/end");

    if (turnStartEvents.length !== 1 || turnEndEvents.length !== 1) {
      fail("control session turn was not properly opened and closed: expected exactly 1 turn/start and 1 turn/end");
    }
    const turnStart = turnStartEvents[0];
    const turnEnd = turnEndEvents[0];
    if (typeof turnStart.seq !== "number" || typeof turnEnd.seq !== "number" || turnStart.seq >= turnEnd.seq) {
      fail("control session turn boundary seq numbers are invalid or out of order");
    }

    if (askedEvents.length !== 4 || decidedEvents.length !== 4) {
      fail("expected exactly 4 approval/asked and 4 approval/decided events in control session, found " + askedEvents.length + " asked and " + decidedEvents.length + " decided");
    }

    const seenRequestIds = new Set();
    const expectedOutcomesByTool = {
      academic_approval_allowed_action: "allowed-once",
      academic_approval_rejected_action: "rejected",
      academic_approval_cancelled_action: "cancelled",
      academic_approval_unavailable_action: "unavailable",
    };

    for (const asked of askedEvents) {
      if (typeof asked.seq !== "number") {
        fail("approval/asked event missing valid numeric seq");
      }
      if (typeof asked.data?.id !== "string" || !asked.data.id) {
        fail("approval/asked event missing valid requestId");
      }
      if (seenRequestIds.has(asked.data.id)) {
        fail("duplicate requestId in approval/asked events: " + asked.data.id);
      }
      seenRequestIds.add(asked.data.id);

      const matchingDecided = decidedEvents.filter((e) => e.data?.id === asked.data?.id);
      if (matchingDecided.length !== 1) {
        fail("expected exactly 1 matching approval/decided event for requestId " + asked.data.id + ", found " + matchingDecided.length);
      }
      const decided = matchingDecided[0];
      if (typeof decided.seq !== "number") {
        fail("approval/decided event missing valid numeric seq");
      }

      if (asked.seq <= turnStart.seq) {
        fail("approval/asked event (seq " + asked.seq + ") occurred before or at turn/start (seq " + turnStart.seq + ")");
      }
      if (decided.seq <= asked.seq) {
        fail("approval/decided event (seq " + decided.seq + ") occurred before or at approval/asked (seq " + asked.seq + ")");
      }
      if (decided.seq >= turnEnd.seq) {
        fail("approval/decided event (seq " + decided.seq + ") occurred after or at turn/end (seq " + turnEnd.seq + ")");
      }

      const expectedOutcome = expectedOutcomesByTool[asked.data.toolName];
      if (!expectedOutcome) {
        fail("unexpected toolName in approval/asked event: " + asked.data.toolName);
      }
      if (decided.data?.outcome !== expectedOutcome) {
        fail("mismatched outcome for " + asked.data.toolName + ": expected " + expectedOutcome + ", got " + decided.data?.outcome);
      }

      const isUnavailable = asked.data.toolName === "academic_approval_unavailable_action";
      const unansweredByProvider = isUnavailable
        ? !answeredApprovalTools.includes(asked.data.toolName)
        : undefined;

      controlObservedDecisions.push({
        requestId: asked.data.id,
        agentId: controlAgent.id,
        sessionId: controlSession.id,
        toolName: asked.data.toolName,
        askedSeq: asked.seq,
        decidedSeq: decided.seq,
        turnSeq: asked.seq,
        outcome: decided.data.outcome,
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: turnStart.seq,
          turnEndSeq: turnEnd.seq,
          isEnclosed: true,
        },
        ...isUnavailable ? { unansweredByProvider } : {},
      });
    }

    const sortedByAsked = [...controlObservedDecisions].sort((a, b) => a.askedSeq - b.askedSeq);
    for (let i = 0; i < sortedByAsked.length - 1; i++) {
      if (sortedByAsked[i].decidedSeq >= sortedByAsked[i + 1].askedSeq) {
        fail("overlapping or out-of-order approval decisions: decision " + i + " decided at " + sortedByAsked[i].decidedSeq + " >= decision " + (i + 1) + " asked at " + sortedByAsked[i + 1].askedSeq);
      }
    }
    const forbiddenStoredEventTypes = ["step/start", "request/header", "agent/request", "assistant/message"];
    const auditorStoredForbiddenEvents = session.snapshotEvents()
      .filter((event) => forbiddenStoredEventTypes.includes(event.type))
      .map((event) => event.type);
    const controlStoredForbiddenEvents = controlSession.snapshotEvents()
      .filter((event) => forbiddenStoredEventTypes.includes(event.type))
      .map((event) => event.type);
    if (forbiddenStepStarts !== 0 || forbiddenAgentRequests !== 0) {
      fail("pre-step observation crossed the fail-closed barrier into step/start or agent/request");
    }
    if (auditorStoredForbiddenEvents.length !== 0 || controlStoredForbiddenEvents.length !== 0) {
      fail("native Session event logs contain a forbidden lifecycle event after pre-step rejection");
    }
    const auditorPreStep = preStepObservations.find((observation) => observation.agentId === agent.id);
    const controlPreStep = preStepObservations.find((observation) => observation.agentId === controlAgent.id);
    if (!auditorPreStep || !controlPreStep) fail("native agent/pre-step was not observed for both auditor and control Agents");
    const auditorNativeInstructions = captureNativeInstructionMessages(
      auditorPreStep.decisionMessages, agent.inbox.nextStep,
    );
    const controlNativeInstructions = captureNativeInstructionMessages(
      controlPreStep.decisionMessages, controlAgent.inbox.nextStep, null,
    );
    const auditorNativeInstruction = auditorNativeInstructions[0]?.message;
    const loadedSourceSha1 = auditorNativeInstruction?.source?.changes
      ?.find((change) => change?.path === "banca-auditor.md")?.digest ?? null;

    const turnEventsBeforeGuard = modelEventCount(session);
    if (turnEventsBeforeGuard !== 0) fail("a model-facing turn/request event appeared before the guard checks");

    const correctionArgs = {
      corrections: [{ file: "main.tex", oldText: "CURRENT_SENTINEL", newText: "AUDITOR_MUTATION_MUST_NOT_RUN" }],
    };
    const restoreArgs = { snapshotId: restoreLabel, confirm: true };
    const deniedBefore = await inventory(workspace);
    const correctionAttempt = await runTool(ctx, "dshbanca-e2e-auditor-correct", "banca_corrigir", correctionArgs, agent);
    const restoreAttempt = await runTool(ctx, "dshbanca-e2e-auditor-restore", "banca_restore", restoreArgs, agent);

    let nativeBodyInvocations = 0;
    const nativeBodyMarker = ".dshbanca-native-guard-body-ran";
    const disposeNativeProbe = agent.ctx.tools.register({
      name: "banca_corrigir",
      description: "Issue #2 guard probe: this scoped body has no DSHbanca identity check and would mutate the synthetic manuscript.",
      parameters: { type: "object" },
      output: decoyOutput,
      async execute() {
        nativeBodyInvocations++;
        await writeFile(join(workspace, nativeBodyMarker), "native guard failed to stop this body\\n", { mode: 0o600 });
        await writeFile(join(workspace, "main.tex"), "NATIVE_GUARD_PROBE_MUTATED_THE_MANUSCRIPT\\n", { mode: 0o600 });
        return "native guard probe body ran";
      },
    });
    const nativeProbe = await runTool(ctx, "dshbanca-e2e-native-guard-probe", "banca_corrigir", correctionArgs, agent);
    disposeNativeProbe();

    let nativeRestoreBodyInvocations = 0;
    const nativeRestoreMarker = ".dshbanca-native-restore-guard-body-ran";
    const disposeNativeRestoreProbe = agent.ctx.tools.register({
      name: "banca_restore",
      description: "Issue #2 restore guard probe: this scoped body has no DSHbanca identity check and would restore the synthetic manuscript.",
      parameters: { type: "object" },
      output: decoyOutput,
      async execute() {
        nativeRestoreBodyInvocations++;
        await writeFile(join(workspace, nativeRestoreMarker), "native restore guard failed to stop this body\\n", { mode: 0o600 });
        await writeFile(join(workspace, "main.tex"), baselineText, { mode: 0o600 });
        return "native restore guard probe body ran";
      },
    });
    const nativeRestoreProbe = await runTool(ctx, "dshbanca-e2e-native-restore-guard-probe", "banca_restore", restoreArgs, agent);
    disposeNativeRestoreProbe();

    const afterNativeProbe = await inventory(workspace);
    const deniedAfter = afterNativeProbe;
    if (JSON.stringify(deniedBefore) !== JSON.stringify(deniedAfter)) fail("an auditor denial changed protected synthetic files or persistent state");
    if (
      nativeBodyInvocations !== 0 ||
      nativeRestoreBodyInvocations !== 0 ||
      Object.hasOwn(afterNativeProbe, nativeBodyMarker) ||
      Object.hasOwn(afterNativeProbe, nativeRestoreMarker)
    ) {
      fail("the native DSH guard did not stop the scoped mutation body before dispatch");
    }

    const auditorMutationAttempts = [
      {
        toolName: "banca_corrigir",
        dispatchCount: 1,
        argumentsValid: correctionWouldMutate,
        operationWouldMutate: correctionWouldMutate,
        isError: correctionAttempt.result.isError === true,
        message: correctionAttempt.message,
        aborted: correctionAttempt.aborted,
      },
      {
        toolName: "banca_restore",
        dispatchCount: 1,
        argumentsValid: snapshotExists && restoreArgs.confirm === true,
        operationWouldMutate: restoreWouldMutate,
        isError: restoreAttempt.result.isError === true,
        message: restoreAttempt.message,
        aborted: restoreAttempt.aborted,
      },
    ];
    if (auditorMutationAttempts.some((attempt) => !attempt.isError || attempt.aborted || !attempt.message.includes("read-only enforcement"))) {
      fail("the auditor mutation attempt was not classified as a non-aborted read-only guard denial");
    }

    const statusBefore = await inventory(workspace);
    const status = await runTool(ctx, "dshbanca-e2e-auditor-status", "banca_status", {}, agent);
    const statusAfter = await inventory(workspace);
    const statusSucceeded = status.result.isError === false && status.message.includes("main.tex");
    if (!statusSucceeded || JSON.stringify(statusBefore) !== JSON.stringify(statusAfter)) {
      fail("banca_status did not remain permitted and read-only for the real auditor Agent");
    }

    unverifiedHandle = await ctx.agents.create({
      sessionId: "session-dshbanca-e2e-unverified-subagent-" + process.pid + "-" + Date.now(),
      parentAgent: agent,
      meta: {
        cwd: workspace,
        parentSession: agent.id,
        origin: "subagent",
        delegationDepth: 1,
      },
    });
    const unverifiedAgent = unverifiedHandle.agent;
    unverifiedAgentId = unverifiedAgent.id;
    const unverifiedPreset = ctx.agentPresets.composedPreset(unverifiedAgent.ctx);
    if (
      ctx.agents.get(unverifiedAgent.id) !== unverifiedAgent ||
      ctx.sessions.get(unverifiedAgent.id) !== unverifiedAgent.session ||
      unverifiedAgent.session.header.origin !== "subagent" ||
      !ctx.agents.isOwnedBy(unverifiedAgent.id, agent) ||
      ctx.agents.roots().includes(unverifiedAgent)
    ) fail("unverified delegation fixture was not created as a live DSH Agent owned by parent Agent");

    const unverifiedBefore = await inventory(workspace);
    let unverifiedBodyInvocations = 0;
    const unverifiedMarker = ".dshbanca-unverified-subagent-body-ran";
    const disposeUnverifiedProbe = unverifiedAgent.ctx.tools.register({
      name: "banca_corrigir",
      description: "Issue #2 fail-closed probe for a real subagent-origin Agent without a verified corrector preset.",
      parameters: { type: "object" },
      output: decoyOutput,
      async execute() {
        unverifiedBodyInvocations++;
        await writeFile(join(workspace, unverifiedMarker), "unverified subagent body ran\\n", { mode: 0o600 });
        await writeFile(join(workspace, "main.tex"), "UNVERIFIED_SUBAGENT_MUTATED_THE_MANUSCRIPT\\n", { mode: 0o600 });
        return "unverified subagent body ran";
      },
    });
    const unverifiedAttempt = await runTool(ctx, "dshbanca-e2e-unverified-correction", "banca_corrigir", correctionArgs, unverifiedAgent);
    disposeUnverifiedProbe();
    const unverifiedAfter = await inventory(workspace);
    if (
      unverifiedAttempt.result.isError !== true ||
      unverifiedAttempt.aborted ||
      !unverifiedAttempt.message.includes("without a verified banca-corretor preset") ||
      unverifiedBodyInvocations !== 0 ||
      Object.hasOwn(unverifiedAfter, unverifiedMarker) ||
      JSON.stringify(unverifiedBefore) !== JSON.stringify(unverifiedAfter)
    ) fail("a live subagent-origin Agent without verified corrector identity was not denied before mutation");

    const auditorEventsAfterChecks = modelEventCount(session);
    const childModelEvents = modelEventCount(unverifiedAgent.session);
    if (auditorEventsAfterChecks !== 0 || childModelEvents !== 0) fail("the profile E2E unexpectedly entered a model-facing turn");

    const batchAuditEvidenceGate = await runAcademicBatchAuditProbe(ctx, workspace, agent);
    const nativeQuestionsEvidence = await runAcademicNativeQuestionsProbe(ctx, workspace, agent, unverifiedAgent, controlObservedDecisions);
    const academicDecisionEvidence = await runAcademicDecisionProbe(ctx, workspace, agent, unverifiedAgent, nativeSkillsEvidence);
    const crossProcessPhaseOne = await runCrossProcessInitialProbe(ctx, restartWorkspace);

    result = {
      lifecycle: "observer Cordis apply reached; real DSH AgentRegistry.create + AgentLoop publication; preset registry resolution and selection observed; direct ToolRuntime calls only",
      profileRuntime: true,
      session: "live DSH SessionStore Session and AgentRegistry Agent; no session.prompt, Agent.send, turn/start, or request/header event",
      hostApiSurvey: {
        agentRegistryCreate: typeof ctx.agents?.create === "function",
        toolRuntimeExecute: typeof ctx.tools?.execute === "function",
        agentPresetRegistrySelect: typeof ctx.agentPresets?.select === "function",
        agentPresetRegistryComposedPreset: typeof ctx.agentPresets?.composedPreset === "function",
        agentPresetRegistryReadDocument: typeof ctx.agentPresets?.readDocument === "function",
        sessionControllerCreate: typeof sessionController?.create === "function",
        sessionControllerPrompt: typeof sessionController?.prompt === "function",
      },
      auditorMarkdownEvidence: {
        sourcePath: "assets/dsh/agents/banca-auditor.md",
        sourceSha256: auditorMarkdownSourceSha256,
        sourceSha1: auditorMarkdownSourceSha1,
        installedPath: ".dsh/agents/banca-auditor.md",
        installedSha256: installedAuditorMarkdownSha256,
        installedSha1: installedAuditorMarkdownSha1,
        loaderCopyPath: "banca-auditor.md",
        loaderCopySha256: loaderAuditorMarkdownSha256,
        loaderCopySha1: loaderAuditorMarkdownSha1,
        hostDiscovered: loadedSourceSha1 === auditorMarkdownSourceSha1,
        presetId: "banca-auditor",
        presetDeclarationSource: "DSHbanca Cordis bundle patch",
        presetCompositionSha256,
        presetCompositionEmpty: presetCompositionContent.trim() === "[]" || presetCompositionContent.trim() === "",
        presetCompositionHasInstructionLoader,
        instructionContextMessageCount: auditorNativeInstructions.length,
        loadedSourceSha1,
        nativeInstructionCaptureChannel: auditorNativeInstructions[0]?.channel ?? null,
        auditorPostRejectInboxMessageCount: agent.inbox.nextStep.length,
        controlPostRejectInboxMessageCount: controlAgent.inbox.nextStep.length,
        nativePreStepObserved: true,
        instructionMessageRole: auditorNativeInstruction?.role ?? null,
        instructionMessageSourceKind: auditorNativeInstruction?.source?.kind ?? null,
        instructionMessagePath: auditorNativeInstruction?.source?.changes?.find((change) => change?.digest === loadedSourceSha1)?.path ?? null,
        controlInstructionMessageCount: controlNativeInstructions.length,
        preStepEvent: { id: auditorNativeInstruction?.id ?? "", agentId: auditorPreStep.agentId, sessionId: auditorPreStep.sessionId },
        preStepEventIds: [auditorNativeInstruction?.id ?? ""],
        agentAndSessionIdMatch: agent.id === session.id,
        agentRegistryContainsAgent: ctx.agents.get(agent.id) === agent,
        sessionStoreContainsSession: ctx.sessions.get(agent.id) === session,
        effectivePreset,
        sessionProjectionPreset: sessionPresetProjection,
        syntheticContext: false,
        syntheticPresetFixture: false,
        modelCalls: auditorEventsAfterChecks,
        credentialsUsed: false,
      },
      toolNames: tools,
      exactToolSet: true,
      skillFound,
      nativeSkillsEvidence,
      batchAuditEvidenceGate,
      crossProcessPhaseOne,
      nativeQuestionsEvidence,
      academicDecisionEvidence,
      executedTools: ["banca_init", "banca_snapshot", "banca_corrigir", "banca_restore", "banca_status", "banca_context", "banca_auditar", "banca_sintese", "ask_user_question"],
      statusSucceeded,
      statusReadOnly: JSON.stringify(statusBefore) === JSON.stringify(statusAfter),
      workspaceInventoryBeforeStatus: statusBefore,
      workspaceInventoryAfterStatus: statusAfter,
      agentIdentity: {
        createdVia: "ctx.agents.create",
        agentRegistryContainsAgent: true,
        sessionStoreContainsSession: true,
        agentAndSessionIdMatch: agent.id === session.id,
        presetRegisteredByHost: Boolean(auditorPresetRow && !auditorPresetRow.broken),
        presetResolvedByHost: resolvedPreset.id === "banca-auditor" && !resolvedPreset.broken,
        effectivePreset,
        sessionProjectionPreset: sessionPresetProjection,
        syntheticContext: false,
        modelTurnEvents: auditorEventsAfterChecks,
      },
      auditorMutationAttempts,
      nativeGuardProbe: {
        toolName: "banca_corrigir",
        dispatchCount: 1,
        isError: nativeProbe.result.isError === true,
        message: nativeProbe.message,
        bodyInvocations: nativeBodyInvocations,
        bodyMarkerAbsent: !Object.hasOwn(afterNativeProbe, nativeBodyMarker),
      },
      nativeRestoreGuardProbe: {
        toolName: "banca_restore",
        dispatchCount: 1,
        isError: nativeRestoreProbe.result.isError === true,
        message: nativeRestoreProbe.message,
        bodyInvocations: nativeRestoreBodyInvocations,
        bodyMarkerAbsent: !Object.hasOwn(afterNativeProbe, nativeRestoreMarker),
      },
      deniedWorkspaceInventoryBefore: deniedBefore,
      deniedWorkspaceInventoryAfter: deniedAfter,
      permittedStatus: {
        dispatched: true,
        isError: status.result.isError === true,
        outputIncludesMain: status.message.includes("main.tex"),
        inventoryBefore: statusBefore,
        inventoryAfter: statusAfter,
      },
      unverifiedDelegation: {
        agentRegistryContainsAgent: true,
        sessionStoreContainsSession: true,
        agentAndSessionIdMatch: unverifiedAgent.id === unverifiedAgent.session.id,
        sessionOrigin: unverifiedAgent.session.header.origin,
        isOwnedByParent: ctx.agents.isOwnedBy(unverifiedAgent.id, agent) === true,
        notInRoots: !ctx.agents.roots().includes(unverifiedAgent),
        effectivePreset: unverifiedPreset ?? null,
        attempt: {
          toolName: "banca_corrigir",
          dispatchCount: 1,
          argumentsValid: correctionWouldMutate,
          isError: unverifiedAttempt.result.isError === true,
          message: unverifiedAttempt.message,
          aborted: unverifiedAttempt.aborted,
          bodyInvocations: unverifiedBodyInvocations,
        },
        inventoryBefore: unverifiedBefore,
        inventoryAfter: unverifiedAfter,
        modelTurnEvents: childModelEvents,
      },
      agentTeardown: { auditorAgentDisposed: false, controlAgentDisposed: false, unverifiedAgentDisposed: false },
      externalActivity: {
        modelCalls: 0,
        sessionPromptCalls: 0,
        agentSendCalls: 2,
        agentRequestEvents: forbiddenAgentRequests,
        stepStartEvents: forbiddenStepStarts,
        forbiddenStoredEventTypes,
        auditorStoredForbiddenEvents,
        controlStoredForbiddenEvents,
        credentialsUsed: false,
      },
    };
  } finally {
    const disposalErrors = [];
    if (controlHandle) {
      try {
        await controlHandle.dispose();
        if (result) result.agentTeardown.controlAgentDisposed = true;
      } catch (error) {
        disposalErrors.push(error);
      }
    } else if (result) {
      result.agentTeardown.controlAgentDisposed = true;
    }
    if (unverifiedHandle) {
      try {
        await unverifiedHandle.dispose();
        if (result) result.agentTeardown.unverifiedAgentDisposed = true;
      } catch (error) {
        disposalErrors.push(error);
      }
    } else if (result) {
      result.agentTeardown.unverifiedAgentDisposed = true;
    }
    try {
      await auditorHandle.dispose();
      if (result) result.agentTeardown.auditorAgentDisposed = true;
    } catch (error) {
      disposalErrors.push(error);
    }
    if (disposalErrors.length > 0) throw new AggregateError(disposalErrors, "DSH Agent handle teardown failed");
  }
  if (!result.agentTeardown.auditorAgentDisposed || !result.agentTeardown.controlAgentDisposed || !result.agentTeardown.unverifiedAgentDisposed) {
    fail("real DSH Agent handles were not explicitly disposed");
  }
  const auditorAgentUnregistered = auditorAgentId !== undefined && ctx.agents.get(auditorAgentId) === undefined && ctx.sessions.get(auditorAgentId) === undefined
  const controlAgentUnregistered = controlAgentId !== undefined && ctx.agents.get(controlAgentId) === undefined && ctx.sessions.get(controlAgentId) === undefined
  const unverifiedAgentUnregistered = unverifiedAgentId !== undefined && ctx.agents.get(unverifiedAgentId) === undefined && ctx.sessions.get(unverifiedAgentId) === undefined
  result.agentTeardown.auditorAgentUnregistered = auditorAgentUnregistered
  result.agentTeardown.controlAgentUnregistered = controlAgentUnregistered
  result.agentTeardown.unverifiedAgentUnregistered = unverifiedAgentUnregistered
  if (!auditorAgentUnregistered || !controlAgentUnregistered || !unverifiedAgentUnregistered) fail("disposed auditor/control/unverified Agent or Session remained registered");
  await writeFile(reportPath, JSON.stringify({ ...result, observerProcessIdentitySha256 }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
  await writeFile(restartObserverResultOne, JSON.stringify({ observerProcessIdentitySha256, crossProcessPhaseOne: result.crossProcessPhaseOne }, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
}
export default { name, inject, apply };
`
  writeFileSync(join(observerRoot, "index.js"), observerSource, { mode: 0o600 })
  chmodSync(join(observerRoot, "index.js"), 0o600)
}

async function main(): Promise<void> {
  const initialRepoStatus = repoStatus()
  report.repository.revision = gitValue(["rev-parse", "HEAD"]) ?? "unknown"
  report.repository.dirty = initialRepoStatus === null || initialRepoStatus.trim().length > 0
  if (process.env.DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED !== "yes") {
    report.stages.profileBoot = {
      status: "BLOCKED",
      started: false,
      dshCliInvocations: 0,
      agentHandlesCreated: 0,
      sessionsCreated: 0,
      academicProjectInitialized: false,
    }
    report.stages.crossProcessBatchAudit = {
      status: "BLOCKED",
      processLaunches: 0,
      reason: "Issue #103 active DSH lifecycle evidence is unauthorized in this execution.",
    }
    fail("BLOCKED: without explicit authorization, no DSH CLI process, Agent/Session, or academic synthetic project is started", "BLOCKED")
    return
  }
  if (process.platform !== "linux") {
    report.stages.crossProcessBatchAudit = { status: "BLOCKED", processLaunches: 0, reason: "Host-derived process identity requires Linux procfs." }
    fail("BLOCKED: Issue #103 host-derived kernel process identity is unavailable on this platform", "BLOCKED")
    return
  }
  const dshExecutable = findExecutable("dsh", process.env.DSH_BIN)
  if (!dshExecutable) {
    fail("DSH CLI not found or DSH_BIN does not point to a file; install/provision the real DSH host", "BLOCKED")
    return
  }
  const nodeExecutable = findExecutable("node")
  const bunExecutable = findExecutable("bun")
  if (!nodeExecutable || !bunExecutable) {
    fail("Node or Bun executable is unavailable", "BLOCKED")
    return
  }
  const versionEnv: NodeJS.ProcessEnv = {
    PATH: [dirname(nodeExecutable), dirname(bunExecutable), "/usr/local/bin", "/usr/bin", "/bin"].join(delimiter()),
    LANG: "C.UTF-8",
    NO_COLOR: "1",
  }
  const nodeVersion = safeRuntimeVersion(commandVersion(nodeExecutable, ["--version"], versionEnv))
  const bunVersion = safeRuntimeVersion(commandVersion(bunExecutable, ["--version"], versionEnv))
  report.versions.node = nodeVersion
  report.versions.bun = bunVersion
  if (!nodeVersion || !bunVersion) {
    fail("Node or Bun version could not be verified", "BLOCKED")
    return
  }
  try {
    const nativePresetSchema = await validateNativePresetConfig(dshExecutable, nodeVersion)
    report.stages.nativePresetSchema = nativePresetSchema
    if (!nativePresetSchema.accepted) {
      fail("installed DSH native preset schemas rejected the bundled auditor composition", "FAIL")
      return
    }
  } catch {
    report.stages.nativePresetSchema = { status: "BLOCKED", packageContractsAvailable: false }
    fail("installed DSH preset schema API is unavailable; native config validation cannot be claimed", "BLOCKED")
    return
  }

  scratchRoot = mkdtempSync(join(tmpdir(), "dshbanca-profile-e2e-"))
  chmodSync(scratchRoot, 0o700)
  const scratch = realpathSync(scratchRoot)
  const dirs = {
    dshHome: join(scratch, "dsh-home"),
    home: join(scratch, "home"),
    tmp: join(scratch, "tmp"),
    xdgConfig: join(scratch, "xdg", "config"),
    xdgCache: join(scratch, "xdg", "cache"),
    xdgData: join(scratch, "xdg", "data"),
    xdgState: join(scratch, "xdg", "state"),
    xdgRuntime: join(scratch, "xdg", "runtime"),
    pnpmHome: join(scratch, "pnpm-home"),
    pnpmStore: join(scratch, "pnpm-store"),
    npmCache: join(scratch, "npm-cache"),
    corepack: join(scratch, "corepack"),
    bin: join(scratch, "bin"),
  }
  for (const path of Object.values(dirs)) {
    ensureInside(scratch, path)
    mkdirSync(path, { recursive: true, mode: 0o700 })
  }
  const env: NodeJS.ProcessEnv = {
    PATH: [dirs.bin, dirname(nodeExecutable), dirname(bunExecutable), "/usr/local/bin", "/usr/bin", "/bin"].join(delimiter()),
    HOME: dirs.home,
    DSH_HOME: dirs.dshHome,
    TMPDIR: dirs.tmp,
    TMP: dirs.tmp,
    TEMP: dirs.tmp,
    XDG_CONFIG_HOME: dirs.xdgConfig,
    XDG_CACHE_HOME: dirs.xdgCache,
    XDG_DATA_HOME: dirs.xdgData,
    XDG_STATE_HOME: dirs.xdgState,
    XDG_RUNTIME_DIR: dirs.xdgRuntime,
    PNPM_HOME: dirs.pnpmHome,
    npm_config_userconfig: join(dirs.home, ".npmrc"),
    npm_config_cache: dirs.npmCache,
    npm_config_offline: "true",
    COREPACK_HOME: dirs.corepack,
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    DSH_TELEMETRY_MODE: "DISABLED",
    CI: "1",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
  }
  for (const value of [dirs.dshHome, dirs.home, dirs.tmp, dirs.xdgConfig, dirs.xdgCache, dirs.xdgData, dirs.xdgState, dirs.xdgRuntime, dirs.pnpmHome, dirs.pnpmStore, dirs.npmCache, dirs.corepack]) ensureInside(scratch, value)
  report.sandbox.isolated = true

  const dshRoot = findDshPackageRoot(dshExecutable)
  if (!dshRoot) {
    fail("DSH executable was found but its installed @deepseek-ai/dsh package root could not be verified", "BLOCKED")
    return
  }
  const dshManifest = JSON.parse(readFileSync(join(dshRoot, "package.json"), "utf8"))
  report.versions.dsh = dshManifest.version
  report.stages.dshVersionSource = "package manifest adjacent to the resolved DSH CLI entrypoint; interactive preflight separately runs dsh --version"
  let cordisPackage: ReturnType<typeof resolveSelectedDshPackage>
  let loaderPackage: ReturnType<typeof resolveSelectedDshPackage>
  try {
    cordisPackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/cordis", nodeVersion)
    loaderPackage = resolveSelectedDshPackage(dshRoot, "@deepseek-ai/cordis-plugin-loader", nodeVersion)
    assertDeclaredDependency(dshManifest, "@deepseek-ai/cordis", cordisPackage.manifest.version as string)
    assertDeclaredDependency(dshManifest, "@deepseek-ai/cordis-plugin-loader", loaderPackage.manifest.version as string)
  } catch {
    fail("selected DSH installation is missing or incompatible with Cordis or cordis-plugin-loader metadata", "BLOCKED")
    return
  }
  report.versions.cordis = cordisPackage.manifest.version
  report.versions.cordisPluginLoader = loaderPackage.manifest.version

  const hostPackageVersions = [
    ["dshSkill", "@deepseek-ai/dsh-skill"],
    ["dshAgent", "@deepseek-ai/dsh-agent"],
    ["dshAgentLoop", "@deepseek-ai/dsh-agent-loop"],
    ["dshTools", "@deepseek-ai/dsh-tools"],
    ["dshAgentPreset", "@deepseek-ai/dsh-agent-preset"],
    ["dshAgentPresetRegistry", "@deepseek-ai/dsh-agent-preset-registry"],
    ["dshAgentInstructions", "@deepseek-ai/dsh-agent-instructions"],
    ["dshApiSessionController", "@deepseek-ai/dsh-api-session-controller"],
    ["dshUserQuestions", "@deepseek-ai/dsh-user-questions"],
    ["dshUserApproval", "@deepseek-ai/dsh-user-approval"],
    ["dshToolAskUser", "@deepseek-ai/dsh-tool-ask-user"],
  ] as const
  for (const [key, packageName] of hostPackageVersions) {
    try {
      const hostPackage = resolveSelectedDshPackage(dshRoot, packageName, nodeVersion)
      report.versions[key] = hostPackage.manifest.version as string
    } catch {
      fail(`selected DSH installation is missing or incompatible with required host API package ${packageName}`, "BLOCKED")
      return
    }
  }

  const pnpmResolution = findPnpmCli()
  if (!pnpmResolution) {
    fail("No cached pnpm CLI is available for offline execution; provision pnpm (native binary or JS CLI) in Corepack cache or set PNPM_BIN to a valid pnpm executable", "BLOCKED")
    return
  }
  const pnpmCmd = buildPnpmCommand(pnpmResolution, nodeExecutable, ["--version"])
  const pnpmCheck = await run(pnpmCmd.command, pnpmCmd.args, { cwd: repositoryRoot, env, timeoutMs: 10_000 })
  report.stages.pnpmVersionExitCode = pnpmCheck.exitCode
  if (pnpmCheck.exitCode !== 0) {
    fail(formatCommandFailure("offline pnpm preflight", "cached pnpm could not execute offline", pnpmCheck), "BLOCKED")
    return
  }
  const reportedVersion = safeRuntimeVersion(pnpmCheck.stdout.trim().split(/\r?\n/)[0] ?? null)
  if (!reportedVersion || reportedVersion !== pnpmResolution.declaredVersion) {
    fail("pnpm --version did not match the verified cached CLI manifest version", "BLOCKED")
    return
  }
  report.versions.pnpm = reportedVersion

  const dshHomeFromContract = join(dirs.dshHome, "profiles")
  ensureInside(scratch, dshHomeFromContract)
  const sandboxBeforeStatus = repoStatus()
  report.stages.profileName = "unique isolated SDK profile"
  report.stages.defaultProfile = "sdk"
  report.stages.installMode = "DSH native plugin command, local checkout, pnpm --offline and isolated store"
  report.stages.externalActivity = {
    telemetry: "DISABLED",
    modelCalls: 0,
    sessionPromptCalls: 0,
    agentSendCalls: 0,
    credentialsUsed: false,
    sdkJsonRpcRequestsSent: 0,
  }

  const setup = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--from-default-profile", "sdk", "--dump-config"], { cwd: repositoryRoot, env, timeoutMs })
  report.stages.profileInitialization = { exitCode: setup.exitCode, timedOut: setup.timedOut }
  if (setup.exitCode !== 0 || setup.timedOut) {
    fail(formatCommandFailure("isolated SDK profile setup", "the real DSH profile could not be created", setup))
    return
  }
  const profileDir = join(dirs.dshHome, "profiles", profileName)
  const profileManifestPath = join(profileDir, "package.json")
  if (!existsSync(profileManifestPath)) {
    fail("DSH profile creation exited successfully but did not create the profile manifest")
    return
  }
  const beforeManifest = JSON.parse(readFileSync(profileManifestPath, "utf8"))
  const bundlesBefore = beforeManifest.dsh?.profile?.bundles ?? []
  report.stages.bundlesBeforeInstall = bundlesBefore

  const build = await run(bunExecutable, ["run", "build"], { cwd: repositoryRoot, env, timeoutMs })
  report.stages.build = { exitCode: build.exitCode, timedOut: build.timedOut }
  if (build.exitCode !== 0 || build.timedOut) {
    fail(formatCommandFailure("repository bundle build", "the exported DSH entrypoint build failed", build))
    return
  }

  const observerRoot = join(scratch, "observer")
  const workspace = join(scratch, "synthetic-project")
  const observerResult = join(scratch, "observer-result.json")
  const restartWorkspace = join(scratch, "process-restart-project")
  const restartObserverResultOne = join(scratch, "process-a-observer-result.json")
  const restartObserverResultTwo = join(scratch, "process-b-observer-result.json")
  const restartTeardownMarkerOne = join(scratch, "process-a-natural-shutdown.json")
  const restartTeardownMarkerTwo = join(scratch, "process-b-natural-shutdown.json")
  const abruptRestartWorkspace = join(scratch, "abrupt-process-restart-project")
  const abruptObserverResultOne = join(scratch, "abrupt-process-a-observer-result.json")
  const abruptObserverResultTwo = join(scratch, "abrupt-process-b-observer-result.json")
  const abruptTeardownMarkerOne = join(scratch, "abrupt-process-a-natural-shutdown.json")
  const abruptTeardownMarkerTwo = join(scratch, "abrupt-process-b-natural-shutdown.json")
  const abruptParentAcknowledgementPath = abruptTeardownMarkerOne + ".parent-ack"
  const abruptParentAwaitingSignalPath = abruptTeardownMarkerOne + ".awaiting-parent-signal"
  const abruptParentSignalPath = abruptTeardownMarkerOne + ".parent-signal"
  const abruptParentDecisionToken = randomBytes(32).toString("hex")
  const processIdentityKey = randomBytes(32)
  const processIdentityKeyHex = processIdentityKey.toString("hex")
  const auditorMarkdownSourcePath = join(repositoryRoot, "assets", "dsh", "agents", "banca-auditor.md")
  const auditorMarkdownSourceSha256 = existsSync(auditorMarkdownSourcePath) ? hashFile(auditorMarkdownSourcePath) : null
  const auditorMarkdownSourceSha1 = existsSync(auditorMarkdownSourcePath)
    ? createHash("sha1").update(readFileSync(auditorMarkdownSourcePath)).digest("hex")
    : null
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  mkdirSync(join(workspace, ".git"), { recursive: false, mode: 0o700 })
  mkdirSync(join(workspace, "capitulos"), { recursive: true, mode: 0o700 })
  writeFileSync(join(workspace, "main.tex"), "\\documentclass{article}\n\\begin{document}\nTexto acadêmico sintético de validação.\\end{document}\n", { mode: 0o600 })
  writeFileSync(join(workspace, "referencias.bib"), "@article{synthetic2026, title={Referência Sintética}, author={Pessoa, Exemplo}, year={2026}}\n", { mode: 0o600 })
  for (let i = 1; i <= 5; i++) {
    if (i === 2) {
      writeFileSync(
        join(workspace, "capitulos", "lote2.tex"),
        "\\section{Delineamento Amostral e Metodologia}\nA amostragem foi definida por conveniência em 30 participantes, com omissão de justificativa do critério amostral e confronto bibliográfico com synthetic2026.\nCapitulo sintetico 2 para analise academica exaustiva e2e.\n",
        { mode: 0o600 },
      )
    } else {
      writeFileSync(join(workspace, "capitulos", `lote${i}.tex`), `Capitulo sintetico ${i} para analise academica exaustiva e2e.\n`, { mode: 0o600 })
    }
  }
  mkdirSync(restartWorkspace, { recursive: true, mode: 0o700 })
  const retainedWorkspaceDirectoryFd = openSync(restartWorkspace, "r")
  restartWorkspaceDirectoryFd = retainedWorkspaceDirectoryFd
  const restartWorkspaceIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(restartWorkspace, scratch, processIdentityKey, retainedWorkspaceDirectoryFd)
  mkdirSync(join(restartWorkspace, ".git"), { recursive: false, mode: 0o700 })
  mkdirSync(join(restartWorkspace, "capitulos"), { recursive: true, mode: 0o700 })
  writeFileSync(join(restartWorkspace, "main.tex"), "\\documentclass{article}\n\\begin{document}\nTexto acadêmico sintético de validação.\\end{document}\n", { mode: 0o600 })
  writeFileSync(join(restartWorkspace, "referencias.bib"), "@article{synthetic2026, title={Referência Sintética}, author={Pessoa, Exemplo}, year={2026}}\n", { mode: 0o600 })
  for (let i = 1; i <= 5; i++) {
    if (i === 2) {
      writeFileSync(join(restartWorkspace, "capitulos", "lote2.tex"), "\\section{Delineamento Amostral e Metodologia}\nA amostragem foi definida por conveniência em 30 participantes, com omissão de justificativa do critério amostral e confronto bibliográfico com synthetic2026.\nCapitulo sintetico 2 para analise academica exaustiva e2e.\n", { mode: 0o600 })
    } else {
      writeFileSync(join(restartWorkspace, "capitulos", `lote${i}.tex`), `Capitulo sintetico ${i} para analise academica exaustiva e2e.\n`, { mode: 0o600 })
    }
  }
  createObserverPackage(observerRoot, workspace, observerResult,
    restartWorkspace, restartObserverResultOne, restartObserverResultTwo, restartTeardownMarkerOne, restartTeardownMarkerTwo,
    abruptRestartWorkspace, abruptObserverResultOne, abruptObserverResultTwo, abruptTeardownMarkerOne, abruptTeardownMarkerTwo,
    abruptParentDecisionToken, auditorMarkdownSourceSha256, auditorMarkdownSourceSha1,
  )
  const overlayPath = join(scratch, "observer.patch.yml")
  writeFileSync(overlayPath, buildSdkPresetOverlayPatch(observerName), { mode: 0o600 })

  const pnpmWrapper = join(dirs.bin, process.platform === "win32" ? "pnpm.cmd" : "pnpm")
  if (process.platform === "win32") {
    fail("The DSH profile E2E gate currently requires a POSIX host for process-group timeout cleanup", "BLOCKED")
    return
  }
  writeFileSync(pnpmWrapper, renderPnpmWrapper(pnpmResolution, nodeExecutable), { mode: 0o700 })
  chmodSync(pnpmWrapper, 0o700)

  let bundleInstallEnv: NodeJS.ProcessEnv
  try {
    bundleInstallEnv = buildScratchPnpmBundleInstallEnv(env, scratch, profileDir, dirs.pnpmStore)
  } catch {
    report.stages.nativeBundleInstall = { status: "BLOCKED", exitCode: null, timedOut: false }
    fail("DSH native bundle install environment did not satisfy scratch/offline isolation", "BLOCKED")
    return
  }
  const add = await runDsh(nodeExecutable, dshExecutable, ["plugin", "--profile", profileName, "add", "--offline", "--store-dir", dirs.pnpmStore, repositoryRoot, observerRoot], { cwd: repositoryRoot, env: bundleInstallEnv, timeoutMs })
  report.stages.nativeBundleInstall = { exitCode: add.exitCode, timedOut: add.timedOut }
  if (add.exitCode !== 0 || add.timedOut) {
    const offlineMissing = isOfflineMissingPnpmError(`${add.stderr}\n${add.stdout}`)
    fail(formatCommandFailure(
      "native offline bundle installation",
      offlineMissing ? "blocked because a cached dependency is missing" : "the package-manager install failed",
      add,
    ), offlineMissing ? "BLOCKED" : "FAIL")
    return
  }

  const installedManifest = JSON.parse(readFileSync(profileManifestPath, "utf8"))
  const bundlesAfter = installedManifest.dsh?.profile?.bundles ?? []
  const dependencyNames = Object.keys(installedManifest.dependencies ?? {})
  report.stages.bundlesAfterInstall = bundlesAfter
  report.stages.localBundleResolution = "profile node_modules links to the checkout's dshbanca package; observer package is local and scratch-only"
  if (!bundlesAfter.includes("dshbanca") || !dependencyNames.includes("dshbanca")) {
    fail("The DSH native package command succeeded but the profile does not contain the DSHbanca bundle entry")
    return
  }
  if (!dependencyNames.includes(observerName)) {
    fail("The DSH native package command succeeded but the profile does not contain the scratch observer dependency")
    return
  }

  const scriptExecutable = findExecutable("script")
  if (!scriptExecutable) {
    fail("BLOCKED: a POSIX pseudo-terminal is required to capture the installed DSH --dump-config output", "BLOCKED")
    return
  }
  const dump = await runDshWithPty(scriptExecutable, nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath, "--dump-config"], { cwd: repositoryRoot, env, timeoutMs })
  const presetRegistryEntry = dump.stdout.includes("@deepseek-ai/dsh-agent-preset-registry") && dump.stdout.includes(`default: ${e2eControlPresetId}`)
  const auditorPresetEntry = dump.stdout.includes("@deepseek-ai/dsh-agent-preset") &&
    dump.stdout.includes("id: banca-auditor") &&
    dump.stdout.includes("@deepseek-ai/dsh-agent-instructions") &&
    dump.stdout.includes("instructionFileCandidates:") &&
    dump.stdout.includes("- banca-auditor.md")
  const controlPresetEntry = dump.stdout.includes(`id: ${e2eControlPresetId}`) && dump.stdout.includes("plugins: []")
  const userQuestionsEntry = dump.stdout.includes("@deepseek-ai/dsh-user-questions")
  const userApprovalEntry = dump.stdout.includes("@deepseek-ai/dsh-user-approval")
  const askUserToolEntry = dump.stdout.includes("@deepseek-ai/dsh-tool-ask-user")
  const userQuestionsCount = (dump.stdout.match(/@deepseek-ai\/dsh-user-questions/g) || []).length
  const userApprovalCount = (dump.stdout.match(/@deepseek-ai\/dsh-user-approval/g) || []).length
  const askUserToolCount = (dump.stdout.match(/@deepseek-ai\/dsh-tool-ask-user/g) || []).length
  const userQuestionsUnique = userQuestionsCount === 1
  const userApprovalUnique = userApprovalCount === 1
  const askUserToolPresent = askUserToolCount >= 1
  const pluginInstancesUnique = userQuestionsUnique && userApprovalUnique && askUserToolPresent
  report.stages.composedProfile = {
    exitCode: dump.exitCode,
    stdoutBytes: Buffer.byteLength(dump.stdout),
    stderrBytes: Buffer.byteLength(dump.stderr),
    outputTruncated: dump.stdout.includes("<output truncated>") || dump.stderr.includes("<output truncated>"),
    containsDshbancaEntry: dump.stdout.includes("name: dshbanca/dsh"),
    containsObserverEntry: dump.stdout.includes(`name: ${observerName}`),
    containsPresetRegistryEntry: presetRegistryEntry,
    containsAuditorPresetEntry: auditorPresetEntry,
    containsControlPresetEntry: controlPresetEntry,
    containsUserQuestionsEntry: userQuestionsEntry,
    containsUserApprovalEntry: userApprovalEntry,
    containsAskUserToolEntry: askUserToolEntry,
    userQuestionsCount,
    userApprovalCount,
    askUserToolCount,
    userQuestionsUnique,
    userApprovalUnique,
    askUserToolPresent,
    pluginInstancesUnique,
  }
  const composedEntry = dump.stdout.includes("name: dshbanca/dsh")
  if (dump.exitCode !== 0 || !composedEntry || !dump.stdout.includes(`name: ${observerName}`) || !presetRegistryEntry || !auditorPresetEntry || !controlPresetEntry || !userQuestionsEntry || !userApprovalEntry || !askUserToolEntry || !pluginInstancesUnique) {
    fail(`The real DSH composed profile is missing a required DSHbanca, observer, scratch preset-registry, auditor-preset, control-preset, user-questions, user-approval, or tool-ask-user entry, or has duplicate plugin instantiations (exit=${dump.exitCode}, dshbanca=${composedEntry}, observer=${dump.stdout.includes(`name: ${observerName}`)}, presetRegistry=${presetRegistryEntry}, auditorPreset=${auditorPresetEntry}, controlPreset=${controlPresetEntry}, userQuestions=${userQuestionsEntry} (count=${userQuestionsCount}), userApproval=${userApprovalEntry} (count=${userApprovalCount}), askUserTool=${askUserToolEntry} (count=${askUserToolCount}))`)
    return
  }
  const checkoutBundle = join(profileDir, "node_modules", "dshbanca")
  if (!existsSync(checkoutBundle)) {
    fail("DSHbanca dependency is absent from the profile node_modules resolution path")
    return
  }
  const entrypointResolved = realpathSync(checkoutBundle) === realpathSync(repositoryRoot)
  report.stages.entrypoint = { composedEntry: "dshbanca/dsh", packageExport: "./dsh -> dist/dsh.js", profileResolutionPresent: true, pointsToCheckout: entrypointResolved }
  const profileErrors = validateProfileEvidence({
    profileManifestHasBundle: bundlesAfter.includes("dshbanca") && dependencyNames.includes("dshbanca"),
    profileManifestHasObserver: dependencyNames.includes(observerName),
    composedEntry,
    entrypointResolved,
    presetRegistryEntry,
    auditorPresetEntry,
    controlPresetEntry,
    userQuestionsUnique,
    userApprovalUnique,
    askUserToolPresent,
  })
  if (profileErrors.length > 0) {
    fail(`Profile composition validation failed: ${profileErrors.join("; ")}`)
    return
  }

  const packagedSkillsVerification: Record<string, { exists: boolean; sourceSha256Matches: boolean }> = {}
  let allPackagedSkillsValid = true
  for (const skillName of expectedNativeSkills) {
    const canonical = canonicalNativeSkills[skillName]
    const absoluteSkillPath = join(repositoryRoot, canonical.sourcePath)
    const exists = existsSync(absoluteSkillPath)
    const matches = exists && hashFile(absoluteSkillPath) === canonical.sourceSha256
    packagedSkillsVerification[skillName] = { exists, sourceSha256Matches: matches }
    if (!exists || !matches) allPackagedSkillsValid = false
  }
  report.stages.packagedSkills = {
    canonicalCount: expectedNativeSkills.length,
    allPackagedSkillsValid,
    verification: packagedSkillsVerification,
  }
  if (!allPackagedSkillsValid) {
    fail("Packaged canonical skills in repository checkout are missing or tampered", "FAIL")
    return
  }

  if (process.env.DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED !== "yes") {
    report.stages.profileBoot = {
      status: "BLOCKED",
      started: false,
      reason: "new human authorization is required for the one-shot no-model Agent pre-step probe",
    }
    report.stages.nativeSkills = {
      status: "BLOCKED",
      hostContract: {
        skillsRegistry: {
          version: report.versions.dshSkill,
          service: "ctx.skills",
          list: "ctx.skills.list",
          get: "ctx.skills.get",
          snapshot: "ctx.skills.snapshot",
        },
      },
      blocker: "Native skills probe is pending the separately authorized one-shot no-model execution.",
    }
    report.stages.batchAuditEvidenceGate = {
      status: "BLOCKED",
      hostContract: {
        toolRuntime: {
          bancaContext: "banca_context",
          bancaAuditar: "banca_auditar",
          bancaSintese: "banca_sintese",
        },
        evidenceGate: "Issue #44/#98/#100 durable batch audit confirmation, native Agent/Session handoff, and exactly-once synthesis finding gate",
      },
      blocker: "Academic batch audit evidence probe is pending the separately authorized one-shot no-model execution.",
    }
    report.stages.nativeQuestions = {
      status: "BLOCKED",
      hostContract: {
        userQuestions: {
          service: "ctx.userQuestions",
          ask: "ctx.userQuestions.ask",
          askTimed: "ctx.userQuestions.askTimed",
        },
        approval: {
          service: "ctx.approval",
          request: "ctx.approval.request",
          outcomes: ["allowed-once", "rejected", "cancelled", "unavailable"],
        },
      },
      seamEvidence: "Issue #46 structured questions and independent approval gate",
    }
    report.stages.academicDecision = {
      status: "BLOCKED",
      hostContract: {
        toolRuntime: {
          askUserQuestion: "ask_user_question",
        },
        userQuestions: {
          service: "ctx.userQuestions",
          ask: "ctx.userQuestions.ask",
        },
        seamEvidence: "Issue #48 selectable academic decision cycle without AI model",
      },
      blocker: "Academic decision E2E probe is pending the separately authorized one-shot no-model execution.",
    }
    fail("BLOCKED: set DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED=yes only after explicit maintainer authorization; no DSH lifecycle was started", "BLOCKED")
    return
  }

  const projectBeforeBoot = inventoryTree(workspace)
  const statusBeforeBoot = repoStatus()
  const dshExecutableSha256 = hashFile(dshExecutable)
  const firstProcessEnv: NodeJS.ProcessEnv = {
    ...env,
    DSHBANCA_DSH_PROFILE_PHASE: "first",
    DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY: processIdentityKeyHex,
    DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256: restartWorkspaceIdentitySha256,
  }
  const boot = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath], {
    cwd: scratch,
    env: firstProcessEnv,
    timeoutMs: bootTimeoutMs,
    processIdentityKey,
  })
  report.stages.profileBoot = {
    exitCode: boot.exitCode,
    signal: boot.signal,
    timedOut: boot.timedOut,
    spawnObserved: boot.spawnObserved === true,
    exitObserved: boot.exitObserved === true,
    closeObserved: boot.closeObserved === true,
    hostProcessIdentitySha256: boot.hostProcessIdentitySha256 ?? null,
    stdin: "EOF triggers native SDK stdin-lifetime shutdown; no request or model call is sent",
  }
  if (boot.exitCode !== 0 || boot.timedOut || boot.signal !== null || !boot.spawnObserved || !boot.exitObserved || !boot.closeObserved || !boot.hostProcessIdentitySha256) {
    fail(formatCommandFailure("native DSH profile boot", "the profile failed, timed out, or exited before observer evidence", boot))
    return
  }
  if (!existsSync(observerResult)) {
    fail(formatCommandFailure("native Cordis observer", "the profile exited without lifecycle/discovery evidence", boot))
    return
  }
  const observed = JSON.parse(readFileSync(observerResult, "utf8"))
  if (!existsSync(restartObserverResultOne)) {
    report.stages.crossProcessBatchAudit = { status: "FAIL", phaseOneStarted: true, hostProcessExitObserved: boot.exitObserved === true }
    fail("Issue #103 phase-one observer evidence is missing; the second DSH process was not started")
    return
  }
  const phaseOneSidecar = JSON.parse(readFileSync(restartObserverResultOne, "utf8"))
  const phaseOneEvidence = observed.crossProcessPhaseOne
  const phaseOneErrors = validateCrossProcessPhaseOneEvidence(phaseOneEvidence)
  const baselineBatchErrors = validateBatchAuditEvidence(observed.batchAuditEvidenceGate)
  const phaseOneHostIdentity = boot.hostProcessIdentitySha256 ?? null
  const phaseOneObserverIdentity = observed.observerProcessIdentitySha256 ?? null
  const phaseOneWorkspaceFilesystemIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(restartWorkspace, scratch, processIdentityKey, retainedWorkspaceDirectoryFd)
  const phaseOneShutdownMarker = existsSync(restartTeardownMarkerOne)
    ? JSON.parse(readFileSync(restartTeardownMarkerOne, "utf8"))
    : null
  const phaseOneWorkspaceInventorySha256 = jsonSha256(inventoryTree(restartWorkspace))
  const phaseOneHostPersistence = crossProcessAnalysisStoreHashes(restartWorkspace, phaseOneEvidence?.planId ?? "")
  const phaseOneHostReady =
    boot.exitCode === 0 && boot.signal === null && !boot.timedOut &&
    boot.spawnObserved === true && boot.exitObserved === true && boot.closeObserved === true &&
    typeof phaseOneHostIdentity === "string" && phaseOneHostIdentity === phaseOneObserverIdentity &&
    phaseOneShutdownMarker?.event === "beforeExit" && phaseOneShutdownMarker?.nativeShutdownCompleted === true &&
    phaseOneShutdownMarker?.processExitCodeAtBeforeExit === 0 &&
    phaseOneShutdownMarker?.observerProcessIdentitySha256 === phaseOneHostIdentity &&
    phaseOneSidecar.observerProcessIdentitySha256 === phaseOneObserverIdentity &&
    JSON.stringify(phaseOneSidecar.crossProcessPhaseOne) === JSON.stringify(phaseOneEvidence) &&
    phaseOneWorkspaceInventorySha256 === phaseOneEvidence?.workspaceInventorySha256 &&
    phaseOneEvidence?.workspaceIdentitySha256 === restartWorkspaceIdentitySha256 &&
    phaseOneWorkspaceFilesystemIdentitySha256 === restartWorkspaceIdentitySha256 &&
    hashFile(dshExecutable) === dshExecutableSha256 &&
    JSON.stringify(phaseOneHostPersistence) === JSON.stringify(phaseOneEvidence?.persistence) &&
    phaseOneErrors.length === 0 && baselineBatchErrors.length === 0
  if (!phaseOneHostReady) {
    report.stages.crossProcessBatchAudit = {
      status: "FAIL",
      phaseOneValidationErrors: phaseOneErrors,
      preservedSameProcessBatchAuditValidationErrors: baselineBatchErrors,
      hostProcessIdentityMatched: phaseOneHostIdentity !== null && phaseOneHostIdentity === phaseOneObserverIdentity,
      hostWorkspaceInventoryMatched: phaseOneWorkspaceInventorySha256 === phaseOneEvidence?.workspaceInventorySha256,
      hostWorkspaceFilesystemIdentityMatched: phaseOneWorkspaceFilesystemIdentitySha256 === restartWorkspaceIdentitySha256,
      hostPersistentHashesMatched: JSON.stringify(phaseOneHostPersistence) === JSON.stringify(phaseOneEvidence?.persistence),
      secondProcessStarted: false,
    }
    fail("Issue #103 phase one failed host, checkpoint, finding, receipt, or existing #100 gate validation; the second DSH process was not started")
    return
  }
  const profileIdentitySha256 = createHmac("sha256", processIdentityKey)
    .update(JSON.stringify(["dsh-profile-v1", profileName]), "utf8")
    .digest("hex")
  const secondProcessStartFilesystemIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(restartWorkspace, scratch, processIdentityKey, retainedWorkspaceDirectoryFd)
  const secondProcessStartInventorySha256 = jsonSha256(inventoryTree(restartWorkspace))
  if (secondProcessStartFilesystemIdentitySha256 !== restartWorkspaceIdentitySha256) {
    report.stages.crossProcessBatchAudit = { status: "FAIL", phaseOneValidated: true, secondProcessStarted: false, workspaceInodeIdentityMatched: false }
    fail("Issue #103 synthetic workspace root was replaced before phase two; the second DSH process was not started")
    return
  }
  const phaseOneExpectation = {
    ...phaseOneEvidence,
    workspaceInventorySha256: phaseOneWorkspaceInventorySha256,
  }
  const secondProcessEnv: NodeJS.ProcessEnv = {
    ...firstProcessEnv,
    DSHBANCA_DSH_PROFILE_PHASE: "resume",
    DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE: JSON.stringify(phaseOneExpectation),
  }
  const secondDshExecutableSha256 = hashFile(dshExecutable)
  const secondBoot = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath], {
    cwd: scratch,
    env: secondProcessEnv,
    timeoutMs: bootTimeoutMs,
    processIdentityKey,
  })
  const secondDshExecutableAfterSha256 = hashFile(dshExecutable)
  const secondProcessEndFilesystemIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(restartWorkspace, scratch, processIdentityKey, retainedWorkspaceDirectoryFd)
  if (
    secondDshExecutableSha256 !== dshExecutableSha256 || secondDshExecutableAfterSha256 !== secondDshExecutableSha256 ||
    secondProcessEndFilesystemIdentitySha256 !== restartWorkspaceIdentitySha256 ||
    secondBoot.exitCode !== 0 || secondBoot.signal !== null || secondBoot.timedOut ||
    !secondBoot.spawnObserved || !secondBoot.exitObserved || !secondBoot.closeObserved ||
    !secondBoot.hostProcessIdentitySha256 || !existsSync(restartObserverResultTwo) || !existsSync(restartTeardownMarkerTwo)
  ) {
    report.stages.crossProcessBatchAudit = {
      status: "FAIL",
      phaseOneValidated: true,
      secondProcess: {
        exitCode: secondBoot.exitCode,
        signal: secondBoot.signal,
        timedOut: secondBoot.timedOut,
        spawnObserved: secondBoot.spawnObserved === true,
        exitObserved: secondBoot.exitObserved === true,
        closeObserved: secondBoot.closeObserved === true,
      },
    }
    fail(formatCommandFailure("cross-process recovery phase two", "the second native DSH process failed or omitted recovery evidence", secondBoot))
    return
  }
  const phaseTwoSidecar = JSON.parse(readFileSync(restartObserverResultTwo, "utf8"))
  const phaseTwoShutdownMarker = JSON.parse(readFileSync(restartTeardownMarkerTwo, "utf8"))
  const phaseTwoEvidence = phaseTwoSidecar.crossProcessPhaseTwo
  const phaseTwoHostIdentity = secondBoot.hostProcessIdentitySha256
  const phaseTwoObserverIdentity = phaseTwoSidecar.observerProcessIdentitySha256
  const crossProcessEvidence = {
    probeExecuted: true,
    executionMode: "cross-process-native-dsh",
    syntheticProcessFixture: false,
    workspace: {
      sameWorkspace: true,
      preservedBetweenProcesses: phaseOneWorkspaceInventorySha256 === secondProcessStartInventorySha256 &&
        secondProcessStartInventorySha256 === phaseTwoEvidence?.workspaceInventoryBeforeResumeSha256 &&
        phaseOneWorkspaceFilesystemIdentitySha256 === restartWorkspaceIdentitySha256 &&
        secondProcessStartFilesystemIdentitySha256 === restartWorkspaceIdentitySha256 &&
        secondProcessEndFilesystemIdentitySha256 === restartWorkspaceIdentitySha256,
      resetBetweenProcesses: phaseOneWorkspaceInventorySha256 !== secondProcessStartInventorySha256 ||
        phaseOneWorkspaceFilesystemIdentitySha256 !== secondProcessStartFilesystemIdentitySha256 ||
        secondProcessEndFilesystemIdentitySha256 !== restartWorkspaceIdentitySha256,
      identitySha256: restartWorkspaceIdentitySha256,
      firstProcessEndFilesystemIdentitySha256: phaseOneWorkspaceFilesystemIdentitySha256,
      secondProcessStartFilesystemIdentitySha256,
      secondProcessEndFilesystemIdentitySha256,
      firstProcessEndInventorySha256: phaseOneWorkspaceInventorySha256,
      secondProcessStartInventorySha256,
    },
    processBoundary: {
      observationSource: "child_process.spawn+linux-procfs",
      first: {
        dshExecutableSha256,
        profileIdentitySha256,
        hostIdentitySha256: phaseOneHostIdentity,
        observerIdentitySha256: phaseOneObserverIdentity,
        identityMatched: phaseOneHostIdentity === phaseOneObserverIdentity,
        spawnObserved: boot.spawnObserved === true,
        kernelStartIdentityObserved: Boolean(phaseOneHostIdentity),
        exitObserved: boot.exitObserved === true,
        exitCode: boot.exitCode,
        signal: boot.signal,
        timedOut: boot.timedOut,
        forcedTermination: boot.timedOut || boot.signal !== null,
        naturalBeforeExitObserved: phaseOneShutdownMarker?.event === "beforeExit",
        nativeTeardownMarkerObserved: phaseOneShutdownMarker?.nativeShutdownCompleted === true && phaseOneShutdownMarker?.processExitCodeAtBeforeExit === 0 && phaseOneShutdownMarker?.observerProcessIdentitySha256 === phaseOneHostIdentity,
      },
      second: {
        dshExecutableSha256,
        profileIdentitySha256,
        hostIdentitySha256: phaseTwoHostIdentity,
        observerIdentitySha256: phaseTwoObserverIdentity,
        identityMatched: phaseTwoHostIdentity === phaseTwoObserverIdentity,
        spawnObserved: secondBoot.spawnObserved === true,
        kernelStartIdentityObserved: Boolean(phaseTwoHostIdentity),
        exitObserved: secondBoot.exitObserved === true,
        exitCode: secondBoot.exitCode,
        signal: secondBoot.signal,
        timedOut: secondBoot.timedOut,
        forcedTermination: secondBoot.timedOut || secondBoot.signal !== null,
        naturalBeforeExitObserved: phaseTwoShutdownMarker?.event === "beforeExit",
        nativeTeardownMarkerObserved: phaseTwoShutdownMarker?.nativeShutdownCompleted === true && phaseTwoShutdownMarker?.processExitCodeAtBeforeExit === 0 && phaseTwoShutdownMarker?.observerProcessIdentitySha256 === phaseTwoHostIdentity,
      },
      secondStartedAfterFirstExit: boot.exitObserved === true && boot.closeObserved === true,
      processesDidNotOverlap: boot.exitObserved === true && boot.closeObserved === true,
    },
    totalBatches: phaseOneEvidence.totalBatches,
    totalCharacters: phaseOneEvidence.totalCharacters,
    planId: phaseOneEvidence.planId,
    manuscriptFingerprint: phaseOneEvidence.manuscriptFingerprint,
    planBatchIds: phaseTwoEvidence?.synthesis?.orderedBatchIds,
    phaseOne: phaseOneEvidence,
    phaseTwo: phaseTwoEvidence,
  }
  const crossProcessErrors = validateCrossProcessBatchAuditEvidence(crossProcessEvidence)
  const crossProcessStatus = classifyCrossProcessBatchAuditEvidenceStatus(crossProcessEvidence)
  report.stages.crossProcessBatchAudit = {
    status: crossProcessStatus,
    evidence: crossProcessEvidence,
    validationErrors: crossProcessErrors,
    hostContract: {
      dshProfile: "same native dsh --profile invocation launched twice via existing runner",
      sdkShutdown: "native sdk-app stdin EOF -> DSH bounded profile shutdown; both exits must be observed as code 0",
      processIdentity: "parent-observed child PID + Linux procfs boot ID/start ticks, HMAC-redacted and corroborated by observer",
      agentLifecycle: "ctx.agents.create + native banca-auditor preset + AgentHandle.dispose in each process",
      modelCalls: 0,
    },
    firstProcess: { exitCode: boot.exitCode, signal: boot.signal, timedOut: boot.timedOut, identityMatched: phaseOneHostIdentity === phaseOneObserverIdentity },
    secondProcess: { exitCode: secondBoot.exitCode, signal: secondBoot.signal, timedOut: secondBoot.timedOut, identityMatched: phaseTwoHostIdentity === phaseTwoObserverIdentity },
  }
  if (crossProcessStatus !== "PASS") {
    fail(`Issue #103 cross-process recovery evidence failed: ${crossProcessErrors.join("; ")}`)
    return
  }

  // Vertical 04 is isolated from the unchanged-source positive control above.
  // Reuse the existing DSH runner/profile and initial probe, not another harness.
  report.stages.sourceDrift = { status: "FAIL", phaseOneStarted: false, secondProcessStarted: false }
  const driftWorkspace = join(scratch, "source-drift-project")
  ensureInside(scratch, driftWorkspace)
  mkdirSync(driftWorkspace, { mode: 0o700 })
  mkdirSync(join(driftWorkspace, ".git"), { mode: 0o700 })
  mkdirSync(join(driftWorkspace, "capitulos"), { mode: 0o700 })
  const driftFd = openSync(driftWorkspace, "r")
  driftWorkspaceDirectoryFd = driftFd
  const driftIdentity = crossProcessWorkspaceFilesystemIdentitySha256(driftWorkspace, scratch, processIdentityKey, driftFd)
  for (const file of ["main.tex", "referencias.bib", ...[1, 2, 3, 4, 5].map((index) => `capitulos/lote${index}.tex`)]) {
    writeFileSync(join(driftWorkspace, file), readFileSync(join(restartWorkspace, file)), { mode: 0o600, flag: "wx" })
  }
  const driftInitialEnv: NodeJS.ProcessEnv = {
    ...firstProcessEnv,
    DSHBANCA_DSH_PROFILE_PHASE: "drift-initial",
    DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256: driftIdentity,
  }
  const driftFirstBoot = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath], {
    cwd: scratch, env: driftInitialEnv, timeoutMs: bootTimeoutMs, processIdentityKey,
  })
  const driftFirstSidecar = existsSync(restartObserverResultOne + ".drift")
    ? JSON.parse(readFileSync(restartObserverResultOne + ".drift", "utf8")) : null
  // This verifies close, native beforeExit and Agent/Session disposal BEFORE any edit.
  const driftFirstProof = sourceDriftProcessProof(driftFirstBoot, driftFirstSidecar, restartTeardownMarkerOne + ".drift", hashFile(dshExecutable), profileIdentitySha256)
  const driftPhaseOne = driftFirstSidecar?.crossProcessPhaseOne
  const driftPhaseOneErrors = validateCrossProcessPhaseOneEvidence(driftPhaseOne)
  const driftBeforeInventory = inventoryTree(driftWorkspace)
  if (driftPhaseOneErrors.length > 0 || driftPhaseOne.workspaceIdentitySha256 !== driftIdentity || driftFirstProof.dshExecutableSha256 !== dshExecutableSha256 || jsonSha256(driftBeforeInventory) !== driftPhaseOne.workspaceInventorySha256 || JSON.stringify(crossProcessAnalysisStoreHashes(driftWorkspace, driftPhaseOne.planId)) !== JSON.stringify(driftPhaseOne.persistence)) {
    fail("Issue #105 initial phase lacks canonical 2/5, one finding or host-corroborated historical records")
    return
  }
  const driftFirstFilesystemIdentity = crossProcessWorkspaceFilesystemIdentitySha256(driftWorkspace, scratch, processIdentityKey, driftFd)
  if (driftFirstFilesystemIdentity !== driftIdentity) throw new Error("source drift workspace was replaced before mutation")
  const canonicalBefore = canonicalSyntheticPlan(driftWorkspace)
  if (canonicalBefore.planId !== driftPhaseOne.planId || canonicalBefore.manuscriptFingerprint !== driftPhaseOne.manuscriptFingerprint) throw new Error("source drift initial native plan differs from product recomputation")
  const driftFile = "capitulos/lote2.tex"
  const originalDriftContent = readFileSync(join(driftWorkspace, driftFile), "utf8")
  const changedDriftContent = mutateSyntheticLatexContent(originalDriftContent)
  writeFileSync(join(driftWorkspace, driftFile), changedDriftContent, { mode: 0o600 })
  const driftAfterInventory = inventoryTree(driftWorkspace)
  const canonicalAfter = canonicalSyntheticPlan(driftWorkspace)
  const mutation = {
    file: driftFile, utf16LengthBefore: originalDriftContent.length, utf16LengthAfter: changedDriftContent.length,
    sha256Before: driftBeforeInventory[driftFile], sha256After: driftAfterInventory[driftFile],
    afterFirstExit: driftFirstBoot.exitObserved === true && driftFirstBoot.closeObserved === true,
    inventoryBefore: driftBeforeInventory, inventoryAfter: driftAfterInventory,
  }
  const changedPaths = [...new Set([...Object.keys(driftBeforeInventory), ...Object.keys(driftAfterInventory)])].filter((path) => driftBeforeInventory[path] !== driftAfterInventory[path])
  if (changedPaths.length !== 1 || changedPaths[0] !== driftFile || mutation.sha256Before === mutation.sha256After || canonicalBefore.manuscriptFingerprint === canonicalAfter.manuscriptFingerprint || canonicalBefore.planId === canonicalAfter.planId) throw new Error("source drift did not change only the synthetic prose and its canonical identity")
  const driftSecondStartFilesystemIdentity = crossProcessWorkspaceFilesystemIdentitySha256(driftWorkspace, scratch, processIdentityKey, driftFd)
  if (driftSecondStartFilesystemIdentity !== driftIdentity) throw new Error("source drift workspace was replaced before second process")
  const driftResumeEnv: NodeJS.ProcessEnv = {
    ...driftInitialEnv,
    DSHBANCA_DSH_PROFILE_PHASE: "drift-resume",
    DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE: JSON.stringify({ phaseOne: driftPhaseOne, canonicalAfter }),
  }
  const driftSecondBoot = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath], {
    cwd: scratch, env: driftResumeEnv, timeoutMs: bootTimeoutMs, processIdentityKey,
  })
  const driftSecondSidecar = existsSync(restartObserverResultTwo + ".drift")
    ? JSON.parse(readFileSync(restartObserverResultTwo + ".drift", "utf8")) : null
  const driftSecondProof = sourceDriftProcessProof(driftSecondBoot, driftSecondSidecar, restartTeardownMarkerTwo + ".drift", hashFile(dshExecutable), profileIdentitySha256)
  const sourceDriftEvidence = {
    probeExecuted: true, executionMode: "source-drift-native-dsh", syntheticProcessFixture: false,
    phaseOne: driftPhaseOne, phaseTwo: driftSecondSidecar?.sourceDriftPhaseTwo,
    processBoundary: {
      observationSource: "child_process.spawn+linux-procfs", first: driftFirstProof, second: driftSecondProof,
      secondStartedAfterFirstExit: driftFirstBoot.exitObserved === true && driftFirstBoot.closeObserved === true,
      processesDidNotOverlap: driftFirstBoot.exitObserved === true && driftFirstBoot.closeObserved === true,
    },
    workspace: {
      identitySha256: driftIdentity, firstProcessEndFilesystemIdentitySha256: driftFirstFilesystemIdentity,
      secondProcessStartFilesystemIdentitySha256: driftSecondStartFilesystemIdentity,
      secondProcessEndFilesystemIdentitySha256: crossProcessWorkspaceFilesystemIdentitySha256(driftWorkspace, scratch, processIdentityKey, driftFd),
    },
    mutation, canonicalBefore, canonicalAfter, parentFinalInventory: inventoryTree(driftWorkspace),
  }
  const sourceDriftErrors = validateSourceDriftEvidence(sourceDriftEvidence)
  const sourceDriftStatus = classifySourceDriftEvidenceStatus(sourceDriftEvidence)
  report.stages.sourceDrift = { status: sourceDriftStatus, evidence: sourceDriftEvidence, validationErrors: sourceDriftErrors }
  if (sourceDriftStatus !== "PASS") {
    fail(`Issue #105 source drift evidence failed: ${sourceDriftErrors.join("; ")}`, sourceDriftStatus === "BLOCKED" ? "BLOCKED" : "FAIL")
    return
  }

  const abruptRestartAuthorization = {
    approved: process.env.DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_AUTHORIZED,
    sha256: process.env.DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SHA256,
    scenario: process.env.DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SCENARIO,
    environment: process.env.DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_ENVIRONMENT,
    reportPath: process.env.DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_REPORT_PATH,
  }
  const abruptAuthorizationBlocker = abruptRestartAuthorizationBlocker(
    report.repository.revision, repoStatus(), abruptRestartAuthorization,
  )
  let abruptRestartStatus: "PASS" | "FAIL" | "BLOCKED" = "BLOCKED"
  if (abruptAuthorizationBlocker) {
    report.stages.abruptRestart = {
      status: "BLOCKED",
      probeExecuted: false,
      processLaunches: 0,
      reason: abruptAuthorizationBlocker,
      authorization: "NEEDS_APPROVAL for exact SHA, scenario, and scratch-only environment",
    }
    report.limitations.push("Issue #107 abruptRestart remains BLOCKED / NEEDS_APPROVAL; no abrupt-restart DSH process was launched.")
  } else {
    let abruptPhaseOne: any = null
    let parentVerifiedPersistence: Record<string, unknown> | null = null
    let abruptFirstChild: ReturnType<typeof spawn> | undefined
    let firstIdentityRevalidatedBeforeSignal = false
    let firstParentBarrierArmed = false
    let firstKillRequested = false
    let abruptPhaseTwoStarted = false
    const abruptArgs = ["--profile", profileName, "--patch", overlayPath]
    try {
      ensureInside(scratch, abruptRestartWorkspace)
      mkdirSync(abruptRestartWorkspace, { mode: 0o700 })
      abruptRestartWorkspaceDirectoryFd = openSync(abruptRestartWorkspace, "r")
      const abruptWorkspaceIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(
        abruptRestartWorkspace, scratch, processIdentityKey, abruptRestartWorkspaceDirectoryFd,
      )
      mkdirSync(join(abruptRestartWorkspace, ".git"), { mode: 0o700 })
      mkdirSync(join(abruptRestartWorkspace, "capitulos"), { mode: 0o700 })
      for (const file of ["main.tex", "referencias.bib", ...[1, 2, 3, 4, 5].map((index) => `capitulos/lote${index}.tex`)]) {
        writeFileSync(join(abruptRestartWorkspace, file), readFileSync(join(restartWorkspace, file)), { mode: 0o600, flag: "wx" })
      }
      const abruptInitialEnv: NodeJS.ProcessEnv = {
        ...firstProcessEnv,
        DSHBANCA_DSH_PROFILE_PHASE: "abrupt-initial",
        DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256: abruptWorkspaceIdentitySha256,
      }
      const abruptFirstBoot = await runDsh(nodeExecutable, dshExecutable, abruptArgs, {
        cwd: scratch,
        env: abruptInitialEnv,
        timeoutMs: bootTimeoutMs * 2,
        stdin: "pipe",
        processIdentityKey,
        onSpawn: async (child, hostIdentity, signal, mayContinue) => {
          abruptFirstChild = child
          if (!hostIdentity || !mayContinue() || !verifyOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey)) {
            throw new Error("runner could not identify its exact DSH child before readiness")
          }
          const sidecar = await waitForObserverJson(abruptObserverResultOne, child, signal, bootTimeoutMs)
          if (!mayContinue()) throw new Error("phase-one control expired before parent validation")
          abruptPhaseOne = sidecar?.crossProcessPhaseOne
          const phaseOneErrors = validateCrossProcessPhaseOneEvidence(abruptPhaseOne)
          if (
            phaseOneErrors.length > 0 ||
            sidecar?.observerProcessIdentitySha256 !== hostIdentity ||
            sidecar?.parentBarrierArmed !== true ||
            abruptPhaseOne?.workspaceIdentitySha256 !== abruptWorkspaceIdentitySha256
          ) throw new Error("phase-one readiness did not prove durable state, a waiting parent barrier, and matching child identity")
          const parentValidation = verifyParentAbruptRestartPersistence(abruptRestartWorkspace, abruptPhaseOne)
          if (parentValidation.errors.length > 0 || !parentValidation.evidence) {
            throw new Error("parent failed raw persisted checkpoint, receipt, finding, hash, or inventory validation")
          }
          parentVerifiedPersistence = parentValidation.evidence
          writeFileSync(abruptParentAcknowledgementPath, abruptParentDecisionToken + ":validated", { mode: 0o600, flag: "wx" })
          const parentBarrier = await waitForObserverJson(abruptParentAwaitingSignalPath, child, signal, bootTimeoutMs)
          if (
            !mayContinue() || parentBarrier?.event !== "awaiting-parent-signal" ||
            parentBarrier?.observerProcessIdentitySha256 !== hostIdentity ||
            parentBarrier?.parentValidationAcknowledged !== true
          ) throw new Error("phase-A child did not enter the post-validation parent-signal barrier")
          firstParentBarrierArmed = true
          const preSignalWorkspaceIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(
            abruptRestartWorkspace, scratch, processIdentityKey, abruptRestartWorkspaceDirectoryFd,
          )
          const preSignalWorkspaceInventorySha256 = jsonSha256(inventoryTree(abruptRestartWorkspace))
          if (
            preSignalWorkspaceIdentitySha256 !== abruptWorkspaceIdentitySha256 ||
            preSignalWorkspaceInventorySha256 !== parentVerifiedPersistence.workspaceInventorySha256
          ) throw new Error("parent observed a changed workspace identity or inventory before signaling")
          if (signal.aborted || !mayContinue() || !verifyOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey)) {
            throw new Error("owned DSH child identity changed before direct termination")
          }
          firstIdentityRevalidatedBeforeSignal = true
          if (!terminateOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey, "SIGKILL", mayContinue)) {
            throw new Error("runner refused to signal an unverified DSH child")
          }
          firstKillRequested = true
        },
        // Deadline containment may clean up a stalled child before readiness, but only after exact
        // runner-child identity revalidation. It is recorded separately and never satisfies the
        // experimental parent-validated SIGKILL gate; timeout/control failure keeps phase B closed.
        onControlTimeout: (child, hostIdentity, maySignal) =>
          terminateOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey, "SIGTERM", maySignal)
            ? "SIGTERM" : null,
        onControlHardTimeout: (child, hostIdentity, maySignal) =>
          terminateOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey, "SIGKILL", maySignal)
            ? "SIGKILL" : null,
      })
      const firstTargetAbsentAfterClose = abruptFirstBoot.closeObserved === true && processTargetAbsentAfterClose(
        abruptFirstChild?.pid,
        abruptFirstBoot.hostProcessIdentitySha256 ?? null,
        processIdentityKey,
      )
      const firstProcessGroupAbsentAfterClose = abruptFirstBoot.closeObserved === true && processGroupAbsentAfterClose(abruptFirstChild?.pid)
      if (!firstTargetAbsentAfterClose || !firstProcessGroupAbsentAfterClose) preserveScratchForSafety = true
      const firstAbruptProof = {
        dshExecutableSha256,
        profileIdentitySha256,
        hostIdentitySha256: abruptFirstBoot.hostProcessIdentitySha256 ?? null,
        observerIdentitySha256: abruptPhaseOne?.observerProcessIdentitySha256 ?? null,
        identityMatched: abruptFirstBoot.hostProcessIdentitySha256 !== null &&
          abruptFirstBoot.hostProcessIdentitySha256 === abruptPhaseOne?.observerProcessIdentitySha256,
        spawnObserved: abruptFirstBoot.spawnObserved === true,
        kernelStartIdentityObserved: Boolean(abruptFirstBoot.hostProcessIdentitySha256),
        exitObserved: abruptFirstBoot.exitObserved === true,
        exitCode: abruptFirstBoot.exitCode,
        signal: abruptFirstBoot.signal,
        timedOut: abruptFirstBoot.timedOut,
        forcedTermination: firstKillRequested,
        naturalBeforeExitObserved: false,
        nativeTeardownMarkerObserved: existsSync(abruptTeardownMarkerOne),
        runnerOwnedChild: abruptFirstChild?.pid !== undefined,
        childIdentityRevalidatedBeforeSignal: firstIdentityRevalidatedBeforeSignal,
        parentBarrierArmed: firstParentBarrierArmed,
        killRequestedByParent: firstKillRequested,
        killSignalRequested: firstKillRequested ? "SIGKILL" : null,
        timeoutContainmentSignalsRequested: abruptFirstBoot.timeoutContainmentSignalsRequested ?? [],
        targetAbsentAfterClose: firstTargetAbsentAfterClose,
        processGroupAbsentAfterClose: firstProcessGroupAbsentAfterClose,
      }
      if (!mayStartAbruptPhaseTwo({
        parentBarrierArmed: firstParentBarrierArmed,
        parentVerifiedPersistence: parentVerifiedPersistence !== null,
        controlCompleted: abruptFirstBoot.controlCompleted === true,
        controlFailed: abruptFirstBoot.controlFailed === true,
        firstKillRequested,
        exitCode: abruptFirstBoot.exitCode,
        signal: abruptFirstBoot.signal,
        timedOut: abruptFirstBoot.timedOut,
        exitObserved: abruptFirstBoot.exitObserved === true,
        closeObserved: abruptFirstBoot.closeObserved === true,
        targetAbsentAfterClose: firstTargetAbsentAfterClose,
        processGroupAbsentAfterClose: firstProcessGroupAbsentAfterClose,
        nativeTeardownMarkerObserved: existsSync(abruptTeardownMarkerOne),
      })) {
        preserveScratchForSafety = true
        report.stages.abruptRestart = { status: "FAIL", probeExecuted: true, phaseOne: abruptPhaseOne, parentVerifiedPersistence, firstProcess: firstAbruptProof, phaseTwoStarted: false }
        fail("Issue #107 stopped before phase B because phase A did not close from the requested owned-child SIGKILL", "FAIL")
        return
      }
      const firstProcessEndFilesystemIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(
        abruptRestartWorkspace, scratch, processIdentityKey, abruptRestartWorkspaceDirectoryFd,
      )
      const secondProcessStartFilesystemIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(
        abruptRestartWorkspace, scratch, processIdentityKey, abruptRestartWorkspaceDirectoryFd,
      )
      const secondProcessStartInventorySha256 = jsonSha256(inventoryTree(abruptRestartWorkspace))
      if (
        firstProcessEndFilesystemIdentitySha256 !== abruptWorkspaceIdentitySha256 ||
        secondProcessStartFilesystemIdentitySha256 !== abruptWorkspaceIdentitySha256 ||
        secondProcessStartInventorySha256 !== parentVerifiedPersistence.workspaceInventorySha256
      ) {
        preserveScratchForSafety = true
        report.stages.abruptRestart = { status: "FAIL", probeExecuted: true, phaseOne: abruptPhaseOne, parentVerifiedPersistence, firstProcess: firstAbruptProof, phaseTwoStarted: false }
        fail("Issue #107 stopped before phase B because the durable workspace identity or inventory changed", "FAIL")
        return
      }
      const abruptResumeEnv: NodeJS.ProcessEnv = {
        ...abruptInitialEnv,
        DSHBANCA_DSH_PROFILE_PHASE: "abrupt-resume",
        DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE: JSON.stringify({
          probeExecuted: true,
          phaseOne: abruptPhaseOne,
          parentVerifiedPersistence,
        }),
      }
      let abruptSecondChild: ReturnType<typeof spawn> | undefined
      let abruptSecondProcessGroupId: number | null = null
      abruptPhaseTwoStarted = true
      const abruptSecondBoot = await runDsh(nodeExecutable, dshExecutable, abruptArgs, {
        cwd: scratch,
        env: abruptResumeEnv,
        timeoutMs: bootTimeoutMs,
        processIdentityKey,
        onSpawn: (child, hostIdentity, signal, mayContinue) => {
          abruptSecondChild = child
          if (signal.aborted || !mayContinue() || !verifyOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey)) {
            throw new Error("recovery phase DSH child identity did not match the runner-owned invocation")
          }
          abruptSecondProcessGroupId = linuxProcessGroupIdOfProcess(child.pid)
        },
        onControlTimeout: (child, hostIdentity, maySignal) =>
          terminateOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey, "SIGTERM", maySignal)
            ? "SIGTERM" : null,
        onControlHardTimeout: (child, hostIdentity, maySignal) =>
          terminateOwnedDshChild(child, nodeExecutable, dshExecutable, abruptArgs, hostIdentity, processIdentityKey, "SIGKILL", maySignal)
            ? "SIGKILL" : null,
      })
      const abruptSecondSidecar = existsSync(abruptObserverResultTwo)
        ? JSON.parse(readFileSync(abruptObserverResultTwo, "utf8")) : null
      // Phase B must prove, after its own observed exit/close, that the direct
      // child target and the visible members of its private process group are
      // gone. The private PGID is read from the child's own procfs entry while
      // it is alive; an unreadable or non-private group fails closed and keeps
      // the scratch directory for inspection.
      const secondProcessGroupIdObserved = abruptPrivateProcessGroupIdMatchesChildPid(
        abruptSecondChild?.pid, abruptSecondProcessGroupId,
      )
      const secondAbsenceDecision = abruptSecondProcessAbsenceDecision({
        closeObserved: abruptSecondBoot.closeObserved === true,
        controlCompleted: abruptSecondBoot.controlCompleted === true,
        runnerOwnedChild: abruptSecondChild?.pid !== undefined,
        processGroupIdObserved: secondProcessGroupIdObserved,
        targetAbsentAfterClose: processTargetAbsentAfterClose(
          abruptSecondChild?.pid, abruptSecondBoot.hostProcessIdentitySha256 ?? null, processIdentityKey,
        ),
        processGroupAbsentAfterClose: secondProcessGroupIdObserved &&
          processGroupAbsentAfterClose(abruptSecondProcessGroupId ?? undefined),
      })
      if (secondAbsenceDecision.preserveScratch) preserveScratchForSafety = true
      const abruptSecondProof = {
        ...sourceDriftProcessProof(
          abruptSecondBoot, abruptSecondSidecar, abruptTeardownMarkerTwo, dshExecutableSha256, profileIdentitySha256,
        ),
        runnerOwnedChild: abruptSecondChild?.pid !== undefined,
        controlCompleted: abruptSecondBoot.controlCompleted === true,
        controlFailed: abruptSecondBoot.controlFailed === true,
        closeObserved: abruptSecondBoot.closeObserved === true,
        processGroupIdObserved: secondAbsenceDecision.processGroupIdObserved,
        targetAbsentAfterClose: secondAbsenceDecision.targetAbsentAfterClose,
        processGroupAbsentAfterClose: secondAbsenceDecision.processGroupAbsentAfterClose,
      }
      const phaseTwo = abruptSecondSidecar?.crossProcessPhaseTwo
      const secondProcessEndFilesystemIdentitySha256 = crossProcessWorkspaceFilesystemIdentitySha256(
        abruptRestartWorkspace, scratch, processIdentityKey, abruptRestartWorkspaceDirectoryFd,
      )
      const abruptEvidence = {
        probeExecuted: true,
        executionMode: "abrupt-restart-native-dsh",
        syntheticProcessFixture: false,
        phaseOne: abruptPhaseOne,
        phaseTwo,
        parentVerifiedPersistence,
        processBoundary: {
          observationSource: "child_process.spawn+linux-procfs",
          first: firstAbruptProof,
          second: abruptSecondProof,
          secondStartedAfterFirstExit: abruptFirstBoot.exitObserved === true && abruptFirstBoot.closeObserved === true,
          processesDidNotOverlap: abruptFirstBoot.exitObserved === true && abruptFirstBoot.closeObserved === true,
        },
        workspace: {
          sameWorkspace: true,
          preservedBetweenProcesses: true,
          resetBetweenProcesses: false,
          identitySha256: abruptWorkspaceIdentitySha256,
          firstProcessEndFilesystemIdentitySha256,
          secondProcessStartFilesystemIdentitySha256,
          secondProcessEndFilesystemIdentitySha256,
          firstProcessEndInventorySha256: parentVerifiedPersistence.workspaceInventorySha256,
          secondProcessStartInventorySha256,
          secondProcessEndInventorySha256: jsonSha256(inventoryTree(abruptRestartWorkspace)),
        },
        teardown: {
          firstExitObserved: abruptFirstBoot.exitObserved === true,
          firstCloseObserved: abruptFirstBoot.closeObserved === true,
          firstTargetAbsentAfterClose,
          firstProcessGroupAbsentAfterClose,
          secondExitObserved: abruptSecondBoot.exitObserved === true,
          secondCloseObserved: abruptSecondBoot.closeObserved === true,
          secondTargetAbsentAfterClose: secondAbsenceDecision.targetAbsentAfterClose,
          secondProcessGroupAbsentAfterClose: secondAbsenceDecision.processGroupAbsentAfterClose,
          secondAgentSessionDisposed: phaseTwo?.teardown?.disposeCalled === true &&
            phaseTwo?.teardown?.agentUnregistered === true && phaseTwo?.teardown?.sessionUnregistered === true &&
            phaseTwo?.teardown?.teardownFailed === false,
          teardownFailed: phaseTwo?.teardown?.teardownFailed === true,
        },
      }
      const abruptErrors = validateAbruptRestartEvidence(abruptEvidence)
      abruptRestartStatus = classifyAbruptRestartEvidenceStatus(abruptEvidence)
      report.stages.abruptRestart = {
        status: abruptRestartStatus,
        probeExecuted: true,
        authorization: { exactShaMatched: true, scenario: "durable-checkpoint-2-of-5-sigkill", environment: "runner-owned-scratch-only" },
        evidence: abruptEvidence,
        validationErrors: abruptErrors,
      }
      if (abruptRestartStatus !== "PASS") {
        preserveScratchForSafety = true
        fail(`Issue #107 abrupt restart evidence failed closed: ${abruptErrors.join("; ")}`, abruptRestartStatus === "BLOCKED" ? "BLOCKED" : "FAIL")
        return
      }
    } catch {
      if (abruptFirstChild !== undefined) preserveScratchForSafety = true
      report.stages.abruptRestart = {
        status: "FAIL",
        probeExecuted: abruptFirstChild !== undefined,
        phaseOne: abruptPhaseOne,
        parentVerifiedPersistence,
        phaseTwoStarted: abruptPhaseTwoStarted,
        validationErrors: ["parent readiness, process ownership, raw persistence, direct signal, or teardown proof failed"],
      }
      fail("Issue #107 abrupt restart probe failed closed; no phase-B recovery result was accepted", "FAIL")
      return
    }
  }

  const errors = validateEvidence(observed)
  const auditorMarkdownEvidence = observed.auditorMarkdownEvidence
  const auditorMarkdownErrors = validateAuditorMarkdownEvidence(auditorMarkdownEvidence)
  const auditorMarkdownStatus = classifyAuditorMarkdownStatus(auditorMarkdownEvidence)
  const nativeSkillsEvidence = observed.nativeSkillsEvidence
  const nativeSkillsErrors = validateNativeSkillsEvidence(nativeSkillsEvidence)
  const nativeSkillsStatus = classifyNativeSkillsStatus(nativeSkillsEvidence)
  const batchAuditEvidence = observed.batchAuditEvidenceGate
  const batchAuditErrors = validateBatchAuditEvidence(batchAuditEvidence)
  const batchAuditStatus = classifyBatchAuditEvidenceStatus(batchAuditEvidence)
  const nativeQuestionsEvidence = observed.nativeQuestionsEvidence
  const nativeQuestionsErrors = validateNativeQuestionsEvidence(nativeQuestionsEvidence)
  const nativeQuestionsStatus = classifyNativeQuestionsStatus(nativeQuestionsEvidence)
  const academicDecisionEvidence = observed.academicDecisionEvidence
  const academicDecisionErrors = validateAcademicDecisionEvidence(academicDecisionEvidence)
  const academicDecisionStatus = classifyAcademicDecisionStatus(academicDecisionEvidence)
  const issue2Status = errors.length === 0 ? "PASS" : "FAIL"
  report.stages.issue2IdentityReadOnly = { status: issue2Status, validationErrors: errors }
  const gateStatuses = classifyProfileGateStatuses(issue2Status, auditorMarkdownStatus, nativeSkillsStatus, batchAuditStatus, nativeQuestionsStatus, academicDecisionStatus, crossProcessStatus)
  const overallStatus: GateReport["status"] =
    gateStatuses.overallStatus === "FAIL" || abruptRestartStatus === "FAIL" ? "FAIL" :
      gateStatuses.overallStatus === "BLOCKED" || abruptRestartStatus === "BLOCKED" ? "BLOCKED" : "PASS"
  report.stages.gateSummary = { ...gateStatuses, sourceDriftStatus, abruptRestartStatus, overallStatus }
  report.stages.observedRuntime = {
    lifecycle: observed.lifecycle,
    toolNames: observed.toolNames,
    toolCount: observed.toolNames?.length ?? 0,
    exactToolSet: observed.exactToolSet,
    skillFound: observed.skillFound,
    executedTools: observed.executedTools,
    statusSucceeded: observed.statusSucceeded,
    statusReadOnly: observed.statusReadOnly,
    workspaceInventoryBeforeStatus: observed.workspaceInventoryBeforeStatus,
    workspaceInventoryAfterStatus: observed.workspaceInventoryAfterStatus,
    session: observed.session,
    agentIdentity: observed.agentIdentity,
    auditorMutationAttempts: observed.auditorMutationAttempts,
    nativeGuardProbe: observed.nativeGuardProbe,
    nativeRestoreGuardProbe: observed.nativeRestoreGuardProbe,
    deniedWorkspaceInventoryBefore: observed.deniedWorkspaceInventoryBefore,
    deniedWorkspaceInventoryAfter: observed.deniedWorkspaceInventoryAfter,
    permittedStatus: observed.permittedStatus,
    unverifiedDelegation: observed.unverifiedDelegation,
    agentTeardown: observed.agentTeardown,
    externalActivity: observed.externalActivity,
    hostApiSurvey: observed.hostApiSurvey,
  }
  report.stages.nativeSkills = {
    status: nativeSkillsStatus,
    evidence: nativeSkillsEvidence,
    validationErrors: nativeSkillsErrors,
    hostContract: {
      skillsRegistry: {
        version: report.versions.dshSkill,
        service: "ctx.skills",
        list: "ctx.skills.list",
        get: "ctx.skills.get",
        snapshot: "ctx.skills.snapshot",
      },
    },
    blocker: nativeSkillsStatus === "BLOCKED"
      ? "Native skills probe is pending the separately authorized one-shot no-model probe."
      : null,
  }
  report.stages.batchAuditEvidenceGate = {
    status: batchAuditStatus,
    evidence: batchAuditEvidence,
    validationErrors: batchAuditErrors,
    hostContract: {
      toolRuntime: {
        bancaContext: "banca_context",
        bancaAuditar: "banca_auditar",
        bancaSintese: "banca_sintese",
      },
      evidenceGate: "Issue #44/#98/#100 durable batch audit confirmation, native Agent/Session handoff, and exactly-once synthesis finding gate",
    },
    blocker: batchAuditStatus === "BLOCKED"
      ? "Academic batch audit evidence probe is pending the separately authorized one-shot no-model probe."
      : null,
  }
  report.stages.nativeQuestions = {
    status: nativeQuestionsStatus,
    evidence: nativeQuestionsEvidence,
    validationErrors: nativeQuestionsErrors,
    hostContract: {
      userQuestions: {
        service: "ctx.userQuestions",
        ask: "ctx.userQuestions.ask",
        askTimed: "ctx.userQuestions.askTimed",
      },
      approval: {
        service: "ctx.approval",
        request: "ctx.approval.request",
        outcomes: ["allowed-once", "rejected", "cancelled", "unavailable"],
      },
      seamEvidence: "Issue #46 structured questions and independent approval gate",
    },
    blocker: nativeQuestionsStatus === "BLOCKED"
      ? "Native questions probe is pending the separately authorized one-shot no-model probe."
      : null,
  }
  report.stages.academicDecision = {
    status: academicDecisionStatus,
    evidence: academicDecisionEvidence,
    validationErrors: academicDecisionErrors,
    hostContract: {
      toolRuntime: {
        askUserQuestion: "ask_user_question",
      },
      userQuestions: {
        service: "ctx.userQuestions",
        ask: "ctx.userQuestions.ask",
      },
      seamEvidence: "Issue #48 selectable academic decision cycle without AI model",
    },
    blocker: academicDecisionStatus === "BLOCKED"
      ? "Academic decision E2E probe is pending the separately authorized one-shot no-model probe."
      : null,
  }
  report.stages.auditorMarkdown = {
    status: auditorMarkdownStatus,
    evidence: auditorMarkdownEvidence,
    validationErrors: auditorMarkdownErrors,
    hostContract: {
      agentPresetRegistry: {
        version: report.versions.dshAgentPresetRegistry,
        readDocument: "reads a declared preset's child plugin list as YAML",
        markdownAgentImportObserved: false,
      },
      agentInstructions: {
        version: report.versions.dshAgentInstructions,
        defaultCandidates: ["AGENTS.md", "CLAUDE.md"],
        configuredCandidatesMustBeBasenames: true,
        projectionHook: "agent/pre-step",
        projectionRejectedBeforeStepStart: true,
        requestBarrierInstalled: true,
      },
    },
    blocker: auditorMarkdownStatus === "BLOCKED"
      ? "Native agent/pre-step evidence is pending the separately authorized one-shot no-model probe."
      : null,
  }
  if (auditorMarkdownStatus === "FAIL") {
    fail(`Issue #3 auditor Markdown source/install integrity failed: ${auditorMarkdownErrors.join("; ")}`)
    return
  }
  if (nativeSkillsStatus === "FAIL") {
    fail(`Issue #38 native skills discovery/loading integrity failed: ${nativeSkillsErrors.join("; ")}`)
    return
  }
  if (batchAuditStatus === "FAIL") {
    fail(`Issue #44 batch audit evidence gate failed: ${batchAuditErrors.join("; ")}`)
    return
  }
  if (nativeQuestionsStatus === "FAIL") {
    fail(`Issue #46 native questions contract failed: ${nativeQuestionsErrors.join("; ")}`)
    return
  }
  if (academicDecisionStatus === "FAIL") {
    fail(`Issue #48 academic decision E2E contract failed: ${academicDecisionErrors.join("; ")}`)
    return
  }
  if (auditorMarkdownStatus === "BLOCKED") {
    report.limitations.push("Issue #3 auditor Markdown loading is BLOCKED; this does not change the separate issue #2 identity/read-only result.")
  }
  if (nativeSkillsStatus === "BLOCKED") {
    report.limitations.push("Issue #38 native skills discovery/loading is BLOCKED; this does not change the separate issue #2 identity/read-only result.")
  }
  if (batchAuditStatus === "BLOCKED") {
    report.limitations.push("Issue #44 batch audit evidence gate is BLOCKED; this does not change the separate issue #2 identity/read-only result.")
  }
  if (nativeQuestionsStatus === "BLOCKED") {
    report.limitations.push("Issue #46 native questions contract is BLOCKED; this does not change the separate issue #2 identity/read-only result.")
  }
  if (academicDecisionStatus === "BLOCKED") {
    report.limitations.push("Issue #48 academic decision E2E contract is BLOCKED; this does not change the separate issue #2 identity/read-only result.")
  }
  if (errors.length > 0) {
    fail(`Real DSH runtime evidence violated the profile contract: ${errors.join("; ")}`)
    return
  }
  const projectAfterBoot = inventoryTree(workspace)
  report.stages.syntheticWorkspaceUnchangedByStatus = JSON.stringify(observed.workspaceInventoryBeforeStatus) === JSON.stringify(observed.workspaceInventoryAfterStatus)
  report.stages.syntheticWorkspaceUnchangedByDenials = JSON.stringify(observed.deniedWorkspaceInventoryBefore) === JSON.stringify(observed.deniedWorkspaceInventoryAfter)
  report.stages.syntheticWorkspaceFilesCreatedByNativeInit = Object.keys(projectAfterBoot).length > Object.keys(projectBeforeBoot).length
  report.stages.modelTurnEvents = {
    auditor: observed.agentIdentity?.modelTurnEvents,
    unverifiedSubagent: observed.unverifiedDelegation?.modelTurnEvents,
  }
  if (!report.stages.syntheticWorkspaceUnchangedByStatus || !report.stages.syntheticWorkspaceUnchangedByDenials || !report.stages.syntheticWorkspaceFilesCreatedByNativeInit) {
    fail("Expected status/denial integrity or native initialization effects were not observed")
    return
  }
  if (statusBeforeBoot !== null && repoStatus() !== statusBeforeBoot) {
    fail("DSH profile run changed the checkout's Git working-tree status outside the sandbox")
    return
  }
  if (sandboxBeforeStatus !== null && initialRepoStatus !== null && initialRepoStatus !== sandboxBeforeStatus) {
    fail("A prerequisite step unexpectedly changed the checkout before profile boot")
    return
  }
  finalStatus = overallStatus
}

async function runCli(): Promise<void> {
  try {
    await main()
  } catch {
  fail("Runner orchestration: unexpected exception; details withheld")
} finally {
  if (abruptRestartWorkspaceDirectoryFd !== undefined) {
    try {
      closeSync(abruptRestartWorkspaceDirectoryFd)
      abruptRestartWorkspaceDirectoryFd = undefined
    } catch {
      preserveScratchForSafety = true
      fail("Abrupt-restart workspace identity handle teardown failed; details withheld")
    }
  }
  if (driftWorkspaceDirectoryFd !== undefined) {
    try {
      closeSync(driftWorkspaceDirectoryFd)
      driftWorkspaceDirectoryFd = undefined
    } catch {
      fail("Source drift workspace identity handle teardown failed; details withheld")
    }
  }
  if (restartWorkspaceDirectoryFd !== undefined) {
    try {
      closeSync(restartWorkspaceDirectoryFd)
      restartWorkspaceDirectoryFd = undefined
    } catch {
      fail("Synthetic workspace identity handle teardown failed; details withheld")
    }
  }
  if (scratchRoot && existsSync(scratchRoot)) {
    if (preserveScratchForSafety) {
      report.sandbox.removed = false
      report.limitations.push("Abrupt-restart failure or teardown uncertainty preserved the isolated scratch directory for inspection.")
    } else {
      try {
        const resolvedScratch = realpathSync(scratchRoot)
        const expectedParent = realpathSync(tmpdir())
        if (!resolvedScratch.startsWith(`${expectedParent}${sep}`) || !resolvedScratch.includes("dshbanca-profile-e2e-")) {
          throw new Error("refusing cleanup because the scratch path is not the unique test directory under the OS temp root")
        }
        rmSync(resolvedScratch, { recursive: true, force: false })
        report.sandbox.removed = !existsSync(resolvedScratch)
        if (!report.sandbox.removed) fail("Scratch cleanup did not remove the test-owned sandbox")
      } catch {
        report.sandbox.removed = false
        fail("Scratch cleanup failed; details withheld")
      }
    }
  } else if (scratchRoot) {
    report.sandbox.removed = true
  }
  if (report.sandbox.isolated && report.sandbox.removed !== true && finalStatus === "PASS") {
    fail("Sandbox cleanup was not verified")
  }
  if (reportPersistencePlan.mode === "abrupt" && !reportPersistencePlan.authorized && finalStatus === "PASS") {
    fail("Abrupt report persistence was not authorized; no report file was written", "BLOCKED")
  }
  try {
    const persistence = writeReport()
    if (persistence === "blocked" && reportPersistencePlan.mode === "abrupt") {
      process.stderr.write("BLOCKED: abrupt report persistence was refused; no report file was written\n")
    }
  } catch {
    finalStatus = "FAIL"
    report.status = finalStatus
    report.failures.push("Report persistence failed; details withheld")
    process.stderr.write(`FAIL: report persistence failed (${reportPathLabel})\n`)
  }
}

const auditorMarkdownStatus = typeof report.stages.auditorMarkdown === "object" && report.stages.auditorMarkdown !== null
  ? (report.stages.auditorMarkdown as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const nativeSkillsStatus = typeof report.stages.nativeSkills === "object" && report.stages.nativeSkills !== null
  ? (report.stages.nativeSkills as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const batchAuditStatus = typeof report.stages.batchAuditEvidenceGate === "object" && report.stages.batchAuditEvidenceGate !== null
  ? (report.stages.batchAuditEvidenceGate as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const nativeQuestionsStatus = typeof report.stages.nativeQuestions === "object" && report.stages.nativeQuestions !== null
  ? (report.stages.nativeQuestions as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const academicDecisionStatus = typeof report.stages.academicDecision === "object" && report.stages.academicDecision !== null
  ? (report.stages.academicDecision as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const crossProcessBatchAuditStatus = typeof report.stages.crossProcessBatchAudit === "object" && report.stages.crossProcessBatchAudit !== null
  ? (report.stages.crossProcessBatchAudit as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const sourceDriftStatus = typeof report.stages.sourceDrift === "object" && report.stages.sourceDrift !== null
  ? (report.stages.sourceDrift as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
const abruptRestartStatusOutput = typeof report.stages.abruptRestart === "object" && report.stages.abruptRestart !== null
  ? (report.stages.abruptRestart as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
process.stdout.write(`${finalStatus}: DSH native identity/read-only profile gate (#2); auditor Markdown loading (#3): ${auditorMarkdownStatus}; native skills discovery/loading (#38): ${nativeSkillsStatus}; batch audit evidence gate (#44): ${batchAuditStatus}; native questions/approval contract (#46): ${nativeQuestionsStatus}; academic decision E2E (#48): ${academicDecisionStatus}; sequential process-restart recovery (#103): ${crossProcessBatchAuditStatus}; source drift between processes (#105): ${sourceDriftStatus}; abrupt restart (#107): ${abruptRestartStatusOutput}\n`)
process.stdout.write(`Report: ${reportPathLabel}\n`)
const safeVersions = (sanitizeReport({ versions: report.versions }) as { versions: GateReport["versions"] }).versions
if (safeVersions.dsh) process.stdout.write(`DSH ${safeVersions.dsh}; Cordis ${safeVersions.cordis ?? "unknown"}; loader ${safeVersions.cordisPluginLoader ?? "unknown"}; Skill ${safeVersions.dshSkill ?? "unknown"}; Agent ${safeVersions.dshAgent ?? "unknown"}; AgentLoop ${safeVersions.dshAgentLoop ?? "unknown"}; Tools ${safeVersions.dshTools ?? "unknown"}; AgentPreset ${safeVersions.dshAgentPreset ?? "unknown"}; PresetRegistry ${safeVersions.dshAgentPresetRegistry ?? "unknown"}; SessionController ${safeVersions.dshApiSessionController ?? "unknown"}; Bun ${safeVersions.bun ?? "unknown"}; Node ${safeVersions.node ?? "unknown"}; pnpm ${safeVersions.pnpm ?? "unknown"}\n`)
for (const failure of report.failures) process.stderr.write(`${finalStatus}: ${failure}\n`)
process.exitCode = finalStatus === "PASS" ? passExitCode() : finalStatus === "BLOCKED" ? missingHostExitCode() : failureExitCode()
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isDirectExecution()) await runCli()
