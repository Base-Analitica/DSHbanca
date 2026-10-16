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

export interface ProfileEvidence {
  profileManifestHasBundle?: boolean
  profileManifestHasObserver?: boolean
  composedEntry?: boolean
  entrypointResolved?: boolean
  presetRegistryEntry?: boolean
  auditorPresetEntry?: boolean
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
  return errors
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
    activity.agentSendCalls !== 0 ||
    activity.credentialsUsed !== false
  ) {
    errors.push("E2E used or did not rule out a model/credential call")
  }

  const teardown = isRecord(evidence.agentTeardown) ? evidence.agentTeardown : undefined
  if (teardown?.auditorAgentDisposed !== true || teardown.unverifiedAgentDisposed !== true) {
    errors.push("real DSH Agent lifecycle teardown was not verified")
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
