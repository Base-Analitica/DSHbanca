import { createHash } from "node:crypto"

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

/** Keep legacy gates visible while incorporating native skills, batch audit, native questions, and academic decision verification. */
export function classifyProfileGateStatuses(
  issue2Status: ProfileGateStatus,
  auditorMarkdownStatus: ProfileGateStatus,
  nativeSkillsStatus?: ProfileGateStatus,
  batchAuditStatus?: ProfileGateStatus,
  nativeQuestionsStatus?: ProfileGateStatus,
  academicDecisionStatus?: ProfileGateStatus,
): {
  issue2Status: ProfileGateStatus
  auditorMarkdownStatus: ProfileGateStatus
  nativeSkillsStatus?: ProfileGateStatus
  batchAuditStatus?: ProfileGateStatus
  nativeQuestionsStatus?: ProfileGateStatus
  academicDecisionStatus?: ProfileGateStatus
  overallStatus: ProfileGateStatus
  exitCode: number
} {
  const statuses = [issue2Status, auditorMarkdownStatus]
  if (nativeSkillsStatus !== undefined) statuses.push(nativeSkillsStatus)
  if (batchAuditStatus !== undefined) statuses.push(batchAuditStatus)
  if (nativeQuestionsStatus !== undefined) statuses.push(nativeQuestionsStatus)
  if (academicDecisionStatus !== undefined) statuses.push(academicDecisionStatus)
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

export interface BatchAuditEvidenceGateEvidence {
  totalBatches: number
  completedBatches: number
  planId: string
  manuscriptFingerprint: string
  unverifiedAdvancesBlocked: number
  prematureSynthesisBlocked: number
  auditsCompletedWithZeroFindings: number
  orderlyAdvances: number
  resumesWithoutSpuriousAdvance: number
  synthesisReleased: boolean
  synthesisInputCoverageState: string
  manuscriptPreserved: boolean
}

/**
 * Validate proof that all batches required durable audit confirmation before advancing
 * and releasing synthesis input, with zero-findings support and synthetic manuscript preservation.
 */
export function validateBatchAuditEvidence(value: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(value)) {
    return ["batch audit evidence gate lacks required host verification"]
  }
  if (typeof value.totalBatches !== "number" || value.totalBatches < 2) {
    errors.push("totalBatches must be at least 2")
  }
  if (value.completedBatches !== value.totalBatches) {
    errors.push("completedBatches must equal totalBatches")
  }
  if (typeof value.planId !== "string" || value.planId.length === 0) {
    errors.push("planId must be a non-empty string")
  }
  if (typeof value.manuscriptFingerprint !== "string" || value.manuscriptFingerprint.length === 0) {
    errors.push("manuscriptFingerprint must be a non-empty string")
  }
  if (typeof value.unverifiedAdvancesBlocked !== "number" || value.unverifiedAdvancesBlocked < (value.totalBatches ?? 2)) {
    errors.push("all batches must reject advance without audit")
  }
  if (typeof value.prematureSynthesisBlocked !== "number" || value.prematureSynthesisBlocked < (value.totalBatches ?? 2)) {
    errors.push("all incomplete batches must block synthesis")
  }
  if (typeof value.auditsCompletedWithZeroFindings !== "number" || value.auditsCompletedWithZeroFindings !== value.totalBatches) {
    errors.push("all batches must accept audit with zero findings")
  }
  if (typeof value.orderlyAdvances !== "number" || value.orderlyAdvances !== value.totalBatches) {
    errors.push("all batches must advance in order")
  }
  if (typeof value.resumesWithoutSpuriousAdvance !== "number" || value.resumesWithoutSpuriousAdvance !== value.totalBatches) {
    errors.push("resume must not spuriously advance completedBatches")
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

export interface AcademicDecisionCancellationEvidence {
  handled: boolean
  observedErrorCode: string
  rejectionObserved: boolean
}

export interface CancellationClassification {
  handled: boolean
  observedErrorCode: string
  rejectionObserved: boolean
  isCancellation: boolean
}

/**
 * Classify a tool execution result or thrown error from ask_user_question under cancellation fail-closed.
 * Rejects contradictory codes like TIMEOUT/NETWORK_ERROR even if message contains "was aborted".
 * Rejects success outcomes where host ignored AbortSignal.
 * Accepts only true native ASK_ABORTED/TOOL_ABORTED codes or exact canonical message when code is stripped.
 */
export function classifyCancellationOutcome(resOrErr: unknown): CancellationClassification {
  if (resOrErr === null || resOrErr === undefined) {
    return {
      handled: false,
      observedErrorCode: "NULL_OR_UNDEFINED",
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

  // 3. Known valid cancellation error codes
  if (
    errorCode === "ASK_ABORTED" ||
    errorCode === "TOOL_ABORTED" ||
    errorCode === "TOOL_ABORTED_BEFORE_DISPATCH"
  ) {
    return {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  // 4. Reject contradictory codes immediately without inspecting message substring
  if (errorCode !== undefined && errorCode.length > 0) {
    return {
      handled: false,
      observedErrorCode: errorCode,
      rejectionObserved: true,
      isCancellation: false,
    }
  }

  // 5. Code absent or stripped: accept only EXACT canonical native messages
  if (
    normalizedMessage === "ask_user_question was aborted before the user answered" ||
    normalizedMessage === "tool call aborted before dispatch" ||
    normalizedMessage === "tool call aborted"
  ) {
    return {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      rejectionObserved: true,
      isCancellation: true,
    }
  }

  // 6. Generic or unknown error fail-closed
  return {
    handled: false,
    observedErrorCode: normalizedMessage.length > 0 ? "GENERIC_ERROR" : "UNKNOWN_ERROR",
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
