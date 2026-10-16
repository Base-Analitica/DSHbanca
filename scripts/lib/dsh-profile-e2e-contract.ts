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
}

export function validateProfileEvidence(evidence: ProfileEvidence): string[] {
  const errors: string[] = []
  if (evidence.profileManifestHasBundle !== true) errors.push("profile bundle entry missing")
  if (evidence.profileManifestHasObserver !== true) errors.push("observer bundle entry missing")
  if (evidence.composedEntry !== true) errors.push("Cordis composition entry missing")
  if (evidence.entrypointResolved !== true) errors.push("plugin entrypoint did not resolve in profile node_modules")
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
