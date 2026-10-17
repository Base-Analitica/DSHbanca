import { describe, expect, test } from "bun:test"
import {
  canonicalAuditorMarkdownSha256,
  canonicalAuditorMarkdownSha1,
  expectedTools,
  failureExitCode,
  missingHostExitCode,
  passExitCode,
  validateAuditorMarkdownEvidence,
  validateEvidence,
  validateProfileEvidence,
} from "../scripts/lib/dsh-profile-e2e-contract.js"

const completeAuditorMarkdownEvidence = {
  sourcePath: "assets/dsh/agents/banca-auditor.md",
  sourceSha256: canonicalAuditorMarkdownSha256,
  sourceSha1: canonicalAuditorMarkdownSha1,
  installedPath: ".dsh/agents/banca-auditor.md",
  installedSha256: canonicalAuditorMarkdownSha256,
  installedSha1: canonicalAuditorMarkdownSha1,
  hostDiscovered: true,
  presetId: "banca-auditor",
  presetCompositionEmpty: false,
  presetCompositionHasInstructionLoader: true,
  instructionContextMessageCount: 1,
  loadedSourceSha1: canonicalAuditorMarkdownSha1,
  nativePreStepObserved: true,
  agentAndSessionIdMatch: true,
  agentRegistryContainsAgent: true,
  sessionStoreContainsSession: true,
  effectivePreset: "banca-auditor",
  sessionProjectionPreset: "banca-auditor",
  syntheticContext: false,
  syntheticPresetFixture: false,
  modelCalls: 0,
  credentialsUsed: false,
}

const completeProfile = {
  profileManifestHasBundle: true,
  profileManifestHasObserver: true,
  composedEntry: true,
  entrypointResolved: true,
  presetRegistryEntry: true,
  auditorPresetEntry: true,
}

const completeRuntime = {
  profileRuntime: true,
  lifecycle: "observer Cordis apply reached after DSHbanca registrations",
  toolNames: [...expectedTools],
  exactToolSet: true,
  skillFound: true,
  executedTools: ["banca_init", "banca_status"],
  statusSucceeded: true,
  statusReadOnly: true,
  workspaceInventoryBeforeStatus: { "main.tex": "sha256:a", ".banca/state.json": "sha256:b" },
  workspaceInventoryAfterStatus: { "main.tex": "sha256:a", ".banca/state.json": "sha256:b" },
  agentIdentity: {
    createdVia: "ctx.agents.create",
    agentRegistryContainsAgent: true,
    sessionStoreContainsSession: true,
    agentAndSessionIdMatch: true,
    presetRegisteredByHost: true,
    presetResolvedByHost: true,
    effectivePreset: "banca-auditor",
    sessionProjectionPreset: "banca-auditor",
    syntheticContext: false,
    modelTurnEvents: 0,
  },
  auditorMutationAttempts: [
    {
      toolName: "banca_corrigir",
      dispatchCount: 1,
      argumentsValid: true,
      operationWouldMutate: true,
      isError: true,
      message: 'DSHbanca guard: tool "banca_corrigir" is denied for auditor agents — read-only enforcement',
      aborted: false,
    },
    {
      toolName: "banca_restore",
      dispatchCount: 1,
      argumentsValid: true,
      operationWouldMutate: true,
      isError: true,
      message: 'DSHbanca guard: tool "banca_restore" is denied for auditor agents — read-only enforcement',
      aborted: false,
    },
  ],
  nativeGuardProbe: {
    toolName: "banca_corrigir",
    dispatchCount: 1,
    isError: true,
    message: 'DSHbanca guard: tool "banca_corrigir" is denied for auditor agents — read-only enforcement',
    bodyInvocations: 0,
    bodyMarkerAbsent: true,
  },
  nativeRestoreGuardProbe: {
    toolName: "banca_restore",
    dispatchCount: 1,
    isError: true,
    message: 'DSHbanca guard: tool "banca_restore" is denied for auditor agents — read-only enforcement',
    bodyInvocations: 0,
    bodyMarkerAbsent: true,
  },
  deniedWorkspaceInventoryBefore: { "main.tex": "sha256:before", ".banca/state.json": "sha256:state" },
  deniedWorkspaceInventoryAfter: { "main.tex": "sha256:before", ".banca/state.json": "sha256:state" },
  permittedStatus: {
    dispatched: true,
    isError: false,
    outputIncludesMain: true,
    inventoryBefore: { "main.tex": "sha256:before", ".banca/state.json": "sha256:state" },
    inventoryAfter: { "main.tex": "sha256:before", ".banca/state.json": "sha256:state" },
  },
  unverifiedDelegation: {
    agentRegistryContainsAgent: true,
    sessionStoreContainsSession: true,
    agentAndSessionIdMatch: true,
    sessionOrigin: "subagent",
    effectivePreset: null,
    attempt: {
      toolName: "banca_corrigir",
      dispatchCount: 1,
      argumentsValid: true,
      isError: true,
      message: "DSHbanca guard: tool \"banca_corrigir\" is denied for subagents without a verified banca-corretor preset — manuscript mutation requires the corrector role",
      aborted: false,
      bodyInvocations: 0,
    },
    inventoryBefore: { "main.tex": "sha256:before", ".banca/state.json": "sha256:state" },
    inventoryAfter: { "main.tex": "sha256:before", ".banca/state.json": "sha256:state" },
    modelTurnEvents: 0,
  },
  agentTeardown: { auditorAgentDisposed: true, unverifiedAgentDisposed: true },
  externalActivity: { modelCalls: 0, sessionPromptCalls: 0, agentSendCalls: 0, credentialsUsed: false },
}

describe("DSH profile E2E evidence contract", () => {
  test("accepts complete profile composition and runtime evidence", () => {
    expect(validateProfileEvidence(completeProfile)).toEqual([])
    expect(validateEvidence(completeRuntime)).toEqual([])
  })

  test("accepts only content-hash-backed Markdown loaded into a native auditor Agent and Session", () => {
    expect(validateAuditorMarkdownEvidence(completeAuditorMarkdownEvidence)).toEqual([])
  })

  test.each([
    ["missing canonical Markdown", { ...completeAuditorMarkdownEvidence, sourcePath: undefined }, "canonical auditor Markdown is missing or altered"],
    ["altered canonical Markdown", { ...completeAuditorMarkdownEvidence, sourceSha256: "sha256:altered" }, "canonical auditor Markdown is missing or altered"],
    ["altered canonical Markdown source digest", { ...completeAuditorMarkdownEvidence, sourceSha1: "sha1:altered" }, "canonical auditor Markdown is missing or altered"],
    ["altered installed Markdown", { ...completeAuditorMarkdownEvidence, installedSha256: "sha256:altered" }, "installed auditor Markdown differs from canonical source"],
    ["altered installed Markdown source digest", { ...completeAuditorMarkdownEvidence, installedSha1: "sha1:altered" }, "installed auditor Markdown differs from canonical source"],
    ["file present but not discovered by DSH", { ...completeAuditorMarkdownEvidence, hostDiscovered: false }, "DSH did not discover auditor Markdown content"],
    ["empty host preset", { ...completeAuditorMarkdownEvidence, presetCompositionHasInstructionLoader: false }, "banca-auditor preset does not mount native instruction content"],
    ["empty preset masked by an instruction-loader marker", { ...completeAuditorMarkdownEvidence, presetCompositionEmpty: true }, "banca-auditor preset does not mount native instruction content"],
    ["preset name registered without Markdown content", { ...completeAuditorMarkdownEvidence, loadedSourceSha1: undefined }, "native DSH did not load Markdown into the agent session"],
    ["missing instruction context message count", { ...completeAuditorMarkdownEvidence, instructionContextMessageCount: 0 }, "native pre-step instruction projection was not observed"],
    ["altered loaded source digest", { ...completeAuditorMarkdownEvidence, loadedSourceSha1: "sha1:altered" }, "native DSH did not load Markdown into the agent session"],
    ["installed Markdown not loaded by the host", { ...completeAuditorMarkdownEvidence, nativePreStepObserved: false }, "native pre-step instruction projection was not observed"],
    ["synthetic context or preset fixture", { ...completeAuditorMarkdownEvidence, syntheticPresetFixture: true }, "auditor Markdown evidence is synthetic rather than host-validated"],
    ["loaded content not bound to the matching native Agent and Session", { ...completeAuditorMarkdownEvidence, agentAndSessionIdMatch: false }, "auditor instruction content is not bound to the live banca-auditor Agent and Session"],
    ["model-backed evidence", { ...completeAuditorMarkdownEvidence, modelCalls: 1 }, "E2E used or did not rule out a model/credential call"],
    ["credential-backed evidence", { ...completeAuditorMarkdownEvidence, credentialsUsed: true }, "E2E used or did not rule out a model/credential call"],
  ])("rejects %s", (_label, evidence, expectedError) => {
    expect(validateAuditorMarkdownEvidence(evidence)).toContain(expectedError)
  })

  test.each([
    ["bundle absent", { ...completeProfile, profileManifestHasBundle: false }, "profile bundle entry missing"],
    ["entrypoint unresolved", { ...completeProfile, entrypointResolved: false }, "plugin entrypoint did not resolve in profile node_modules"],
    ["composition absent", { ...completeProfile, composedEntry: false }, "Cordis composition entry missing"],
    ["native preset registry absent", { ...completeProfile, presetRegistryEntry: false }, "DSH AgentPresetRegistry entry missing"],
    ["auditor preset declaration absent", { ...completeProfile, auditorPresetEntry: false }, "banca-auditor DSH AgentPreset entry missing"],
  ])("rejects %s", (_label, evidence, expectedError) => {
    expect(validateProfileEvidence(evidence)).toContain(expectedError)
  })

  test.each([
    ["lifecycle absent", { ...completeRuntime, profileRuntime: false, lifecycle: undefined }, "profile runtime was not observed"],
    ["tool discovery incomplete", { ...completeRuntime, toolNames: expectedTools.slice(1) }, "tool discovery is incomplete or contains unexpected banca tools"],
    ["skill missing", { ...completeRuntime, skillFound: false }, "banca-avaliacao skill was not discovered"],
    ["tool execution absent", { ...completeRuntime, executedTools: ["banca_init"] }, "banca_status did not execute through the profile runtime"],
    ["tool result unsuccessful", { ...completeRuntime, statusSucceeded: false }, "banca_status did not succeed"],
    ["status mutates files", { ...completeRuntime, statusReadOnly: false }, "banca_status modified synthetic workspace state"],
    ["inventory differs", { ...completeRuntime, workspaceInventoryAfterStatus: { "main.tex": "sha256:changed" } }, "filesystem inventory differs across banca_status"],
  ])("rejects %s", (_label, evidence, expectedError) => {
    expect(validateEvidence(evidence)).toContain(expectedError)
  })

  test("uses distinct exit codes so unavailable DSH cannot pass", () => {
    expect(passExitCode()).toBe(0)
    expect(failureExitCode()).toBe(1)
    expect(missingHostExitCode()).toBe(2)
  })

  test("rejects real DSH Agent evidence without verified lifecycle disposal", () => {
    expect(validateEvidence({ ...completeRuntime, agentTeardown: undefined })).toContain(
      "real DSH Agent lifecycle teardown was not verified",
    )
  })

  test("rejects the E2E when a model turn or credential use is reported", () => {
    expect(validateEvidence({
      ...completeRuntime,
      externalActivity: { ...completeRuntime.externalActivity, modelCalls: 1, credentialsUsed: true },
    })).toContain("E2E used or did not rule out a model/credential call")
  })

  test("rejects missing allowed banca_status behavior for the auditor", () => {
    expect(validateEvidence({ ...completeRuntime, permittedStatus: undefined })).toContain(
      "banca_status did not succeed for the verified auditor",
    )
  })

  test.each([
    [
      "rejects an identity copied onto a synthetic session-shaped object",
      {
        agentIdentity: {
          ...completeRuntime.agentIdentity,
          createdVia: "ctx.sessions.create",
          agentRegistryContainsAgent: false,
          syntheticContext: true,
        },
      },
      "auditor identity is not a verified live DSH agent",
    ],
    [
      "rejects an auditor identity not composed by the host preset registry",
      {
        agentIdentity: { ...completeRuntime.agentIdentity, effectivePreset: undefined },
      },
      "auditor identity is not a verified live DSH agent",
    ],
    [
      "rejects a model-facing turn in the live auditor session",
      { agentIdentity: { ...completeRuntime.agentIdentity, modelTurnEvents: 1 } },
      "model-facing turns were observed in the real DSH session",
    ],
    [
      "rejects a denied result when ToolRuntime dispatch was omitted",
      {
        auditorMutationAttempts: completeRuntime.auditorMutationAttempts.map((attempt) => ({ ...attempt, dispatchCount: 0 })),
      },
      "auditor mutation was not dispatched through DSH ToolRuntime",
    ],
    [
      "rejects a simulated denial without a native guard probe dispatch",
      { nativeGuardProbe: { ...completeRuntime.nativeGuardProbe, dispatchCount: 0 } },
      "native guard probe was not denied before body execution",
    ],
    [
      "rejects a guard denial reported only after the tool body ran",
      { nativeGuardProbe: { ...completeRuntime.nativeGuardProbe, bodyInvocations: 1 } },
      "native guard probe was not denied before body execution",
    ],
    [
      "rejects banca_restore denial after a scoped restore body ran",
      { nativeRestoreGuardProbe: { ...completeRuntime.nativeRestoreGuardProbe, bodyInvocations: 1 } },
      "native restore guard probe was not denied before body execution",
    ],
    [
      "rejects argument errors or aborts misreported as guard denials",
      {
        auditorMutationAttempts: completeRuntime.auditorMutationAttempts.map((attempt) => ({
          ...attempt,
          argumentsValid: false,
          aborted: true,
        })),
      },
      "auditor mutation denial is not a valid non-aborted guard denial",
    ],
    [
      "rejects protected-file or persisted-state hashes changed after denial",
      {
        deniedWorkspaceInventoryAfter: { ...completeRuntime.deniedWorkspaceInventoryAfter, "main.tex": "sha256:changed" },
      },
      "synthetic workspace changed after a denial",
    ],
    [
      "rejects an unverified subagent that can still mutate",
      {
        unverifiedDelegation: {
          ...completeRuntime.unverifiedDelegation,
          attempt: { ...completeRuntime.unverifiedDelegation.attempt, isError: false, bodyInvocations: 1 },
        },
      },
      "unverified delegation is not fail-closed",
    ],
  ])("%s", (_label, override, expectedError) => {
    expect(validateEvidence({ ...completeRuntime, ...override } as any)).toContain(expectedError)
  })
})
