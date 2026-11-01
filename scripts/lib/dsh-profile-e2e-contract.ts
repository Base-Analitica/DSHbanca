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
    sourceSha256: "c22d6bd6598117c491176fd1366c9c3974104bc3a349ebe791b1051f79682aa1",
    bodySha256: "46d86bfd7ad6cda4bc58f79961db784e71e4a50192b35acde882fe2756ec9f6e",
    bodyLength: 1691,
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

/** Keep the legacy identity/read-only and Markdown gates visible while incorporating native skills, batch audit, and native questions verification. */
export function classifyProfileGateStatuses(
  issue2Status: ProfileGateStatus,
  auditorMarkdownStatus: ProfileGateStatus,
  nativeSkillsStatus?: ProfileGateStatus,
  batchAuditStatus?: ProfileGateStatus,
  nativeQuestionsStatus?: ProfileGateStatus,
): {
  issue2Status: ProfileGateStatus
  auditorMarkdownStatus: ProfileGateStatus
  nativeSkillsStatus?: ProfileGateStatus
  batchAuditStatus?: ProfileGateStatus
  nativeQuestionsStatus?: ProfileGateStatus
  overallStatus: ProfileGateStatus
  exitCode: number
} {
  const statuses = [issue2Status, auditorMarkdownStatus]
  if (nativeSkillsStatus !== undefined) statuses.push(nativeSkillsStatus)
  if (batchAuditStatus !== undefined) statuses.push(batchAuditStatus)
  if (nativeQuestionsStatus !== undefined) statuses.push(nativeQuestionsStatus)
  const overallStatus: ProfileGateStatus = statuses.includes("FAIL")
    ? "FAIL"
    : statuses.includes("BLOCKED") ? "BLOCKED" : "PASS"
  return {
    issue2Status,
    auditorMarkdownStatus,
    ...(nativeSkillsStatus !== undefined ? { nativeSkillsStatus } : {}),
    ...(batchAuditStatus !== undefined ? { batchAuditStatus } : {}),
    ...(nativeQuestionsStatus !== undefined ? { nativeQuestionsStatus } : {}),
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
  outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable"
  auditEvents: {
    askedEventLogged: boolean
    decidedEventLogged: boolean
  }
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
    blocked: boolean
    errorCode: string
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
      if (!Array.isArray(approval.observedDecisions) || approval.observedDecisions.length === 0) {
        errors.push("approval.status cannot be PASS without verified native observedDecisions containing turn-enclosed audit events")
      } else {
        const decisions = approval.observedDecisions as ObservedApprovalDecision[]
        const hasAllowedOnce = decisions.some((d) => d.outcome === "allowed-once")
        const hasRejected = decisions.some((d) => d.outcome === "rejected")
        const hasCancelled = decisions.some((d) => d.outcome === "cancelled")
        const hasUnavailable = decisions.some((d) => d.outcome === "unavailable")

        if (!hasAllowedOnce) {
          errors.push("observedDecisions must contain an observed allowed-once outcome")
        }
        if (!hasRejected || !hasCancelled || !hasUnavailable) {
          errors.push("observedDecisions must contain observed non-grant outcomes (rejected, cancelled, unavailable)")
        }

        for (const dec of decisions) {
          if (typeof dec.requestId !== "string" || dec.requestId.trim().length === 0) {
            errors.push("observedDecision must contain a non-empty requestId")
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
          if (typeof dec.turnSeq !== "number" || dec.turnSeq < 0) {
            errors.push("observedDecision must contain a non-negative turnSeq proving turn-enclosed audit")
          }
          if (!dec.auditEvents || dec.auditEvents.askedEventLogged !== true || dec.auditEvents.decidedEventLogged !== true) {
            errors.push("observedDecision must prove asked and decided audit events were logged in session")
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

export function missingHostExitCode(): number {
  return 2
}

export function failureExitCode(): number {
  return 1
}

export function passExitCode(): number {
  return 0
}
