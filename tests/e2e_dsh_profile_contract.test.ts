import { describe, expect, test } from "bun:test"
import {
  canonicalAuditorMarkdownSha256,
  canonicalAuditorMarkdownSha1,
  expectedTools,
  expectedNativeSkills,
  expectedNativeSkillProvider,
  canonicalNativeSkills,
  failureExitCode,
  missingHostExitCode,
  passExitCode,
  validateAuditorMarkdownEvidence,
  classifyAuditorMarkdownStatus,
  validateNativeSkillsEvidence,
  classifyNativeSkillsStatus,
  classifyProfileGateStatuses,
  validateEvidence,
  validateProfileEvidence,
  validatePresetReferences,
} from "../scripts/lib/dsh-profile-e2e-contract.js"

const completeAuditorMarkdownEvidence = {
  sourcePath: "assets/dsh/agents/banca-auditor.md",
  sourceSha256: canonicalAuditorMarkdownSha256,
  sourceSha1: canonicalAuditorMarkdownSha1,
  installedPath: ".dsh/agents/banca-auditor.md",
  installedSha256: canonicalAuditorMarkdownSha256,
  installedSha1: canonicalAuditorMarkdownSha1,
  loaderCopyPath: "banca-auditor.md",
  loaderCopySha256: canonicalAuditorMarkdownSha256,
  loaderCopySha1: canonicalAuditorMarkdownSha1,
  hostDiscovered: true,
  presetId: "banca-auditor",
  presetCompositionEmpty: false,
  presetCompositionHasInstructionLoader: true,
  instructionContextMessageCount: 1,
  loadedSourceSha1: canonicalAuditorMarkdownSha1,
  nativePreStepObserved: true,
  instructionMessageRole: "user",
  instructionMessageSourceKind: "agent-instructions",
  instructionMessagePath: "banca-auditor.md",
  controlInstructionMessageCount: 0,
  preStepEvent: { id: "evt-auditor-1", agentId: "agent-auditor-1", sessionId: "agent-auditor-1" },
  preStepEventIds: ["evt-auditor-1"],
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
  controlPresetEntry: true,
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
  agentTeardown: { auditorAgentDisposed: true, controlAgentDisposed: true, unverifiedAgentDisposed: true, auditorAgentUnregistered: true, controlAgentUnregistered: true },
  externalActivity: {
    modelCalls: 0, sessionPromptCalls: 0, agentSendCalls: 2, agentRequestEvents: 0, stepStartEvents: 0,
    forbiddenStoredEventTypes: ["step/start", "request/header", "agent/request", "assistant/message"],
    auditorStoredForbiddenEvents: [], controlStoredForbiddenEvents: [], credentialsUsed: false,
  },
}

describe("DSH profile E2E evidence contract", () => {
  test("rejects unresolved and duplicate registry preset IDs", () => {
    expect(validatePresetReferences("standard", ["banca-auditor"])).toContain(
      "AgentPresetRegistry default does not resolve to a declared preset",
    )
    expect(validatePresetReferences("banca-auditor", ["banca-auditor", "banca-auditor"])).toContain(
      "AgentPreset declarations contain duplicate IDs",
    )
    expect(validatePresetReferences("banca-auditor", ["banca-auditor"])).toEqual([])
  })
  test("accepts complete profile composition and runtime evidence", () => {
    expect(validateProfileEvidence(completeProfile)).toEqual([])
    expect(validateEvidence(completeRuntime)).toEqual([])
  })

  test("accepts only content-hash-backed Markdown loaded into a native auditor Agent and Session", () => {
    expect(validateAuditorMarkdownEvidence(completeAuditorMarkdownEvidence)).toEqual([])
  })

  test("missing Markdown evidence blocks issue 3 while preserving the separate issue 2 result and nonzero exit", () => {
    expect(classifyAuditorMarkdownStatus(undefined)).toBe("BLOCKED")
    expect(classifyProfileGateStatuses("PASS", "BLOCKED")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
  })

  test("proven Markdown allows PASS, while observed missing content and material integrity errors fail", () => {
    expect(classifyAuditorMarkdownStatus(completeAuditorMarkdownEvidence)).toBe("PASS")
    expect(classifyAuditorMarkdownStatus({
      ...completeAuditorMarkdownEvidence,
      hostDiscovered: false,
      instructionContextMessageCount: 0,
      loadedSourceSha1: null,
    })).toBe("FAIL")
    expect(classifyAuditorMarkdownStatus({ ...completeAuditorMarkdownEvidence, hostDiscovered: false })).toBe("FAIL")
    expect(classifyAuditorMarkdownStatus({ ...completeAuditorMarkdownEvidence, loaderCopySha256: "sha256:tampered" })).toBe("FAIL")
    expect(classifyProfileGateStatuses("PASS", "PASS")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      overallStatus: "PASS",
      exitCode: 0,
    })
    expect(classifyProfileGateStatuses("FAIL", "PASS").overallStatus).toBe("FAIL")
  })

  test.each([
    ["missing canonical Markdown", { ...completeAuditorMarkdownEvidence, sourcePath: undefined }, "canonical auditor Markdown is missing or altered"],
    ["altered canonical Markdown", { ...completeAuditorMarkdownEvidence, sourceSha256: "sha256:altered" }, "canonical auditor Markdown is missing or altered"],
    ["altered canonical Markdown source digest", { ...completeAuditorMarkdownEvidence, sourceSha1: "sha1:altered" }, "canonical auditor Markdown is missing or altered"],
    ["altered installed Markdown", { ...completeAuditorMarkdownEvidence, installedSha256: "sha256:altered" }, "installed auditor Markdown differs from canonical source"],
    ["altered installed Markdown source digest", { ...completeAuditorMarkdownEvidence, installedSha1: "sha1:altered" }, "installed auditor Markdown differs from canonical source"],
    ["missing loader-root Markdown", { ...completeAuditorMarkdownEvidence, loaderCopyPath: undefined }, "loader-root auditor Markdown differs from canonical source"],
    ["altered loader-root Markdown", { ...completeAuditorMarkdownEvidence, loaderCopySha256: "sha256:altered" }, "loader-root auditor Markdown differs from canonical source"],
    ["file present but not discovered by DSH", { ...completeAuditorMarkdownEvidence, hostDiscovered: false }, "DSH did not discover auditor Markdown content"],
    ["empty host preset", { ...completeAuditorMarkdownEvidence, presetCompositionHasInstructionLoader: false }, "banca-auditor preset does not mount native instruction content"],
    ["empty preset masked by an instruction-loader marker", { ...completeAuditorMarkdownEvidence, presetCompositionEmpty: true }, "banca-auditor preset does not mount native instruction content"],
    ["invalid auditor preset ID", { ...completeAuditorMarkdownEvidence, presetId: "banca-corretor" }, "banca-auditor preset does not mount native instruction content"],
    ["preset name registered without Markdown content", { ...completeAuditorMarkdownEvidence, loadedSourceSha1: undefined }, "native DSH did not load Markdown into the agent session"],
    ["missing instruction context message count", { ...completeAuditorMarkdownEvidence, instructionContextMessageCount: 0 }, "native pre-step instruction projection was not observed"],
    ["altered loaded source digest", { ...completeAuditorMarkdownEvidence, loadedSourceSha1: "sha1:altered" }, "native DSH did not load Markdown into the agent session"],
    ["installed Markdown not loaded by the host", { ...completeAuditorMarkdownEvidence, nativePreStepObserved: false }, "native pre-step instruction projection was not observed"],
    ["system-role instruction message", { ...completeAuditorMarkdownEvidence, instructionMessageRole: "system" }, "native instruction projection is not a user message from the expected source"],
    ["control Agent received auditor instructions", { ...completeAuditorMarkdownEvidence, controlInstructionMessageCount: 1 }, "control Agent received auditor-only instructions"],
    ["pre-step evidence without event identity", { ...completeAuditorMarkdownEvidence, preStepEvent: { id: "", agentId: "agent-auditor-1", sessionId: "agent-auditor-1" }, preStepEventIds: [] }, "pre-step evidence lacks unique native event provenance"],
    ["pre-step evidence for another Agent", { ...completeAuditorMarkdownEvidence, preStepEvent: { id: "evt-auditor-1", agentId: "other", sessionId: "agent-auditor-1" } }, "pre-step evidence lacks unique native event provenance"],
    ["duplicate pre-step event evidence", { ...completeAuditorMarkdownEvidence, preStepEventIds: ["evt-auditor-1", "evt-auditor-1"] }, "pre-step evidence lacks unique native event provenance"],
    ["synthetic context or preset fixture", { ...completeAuditorMarkdownEvidence, syntheticPresetFixture: true }, "auditor Markdown evidence is synthetic rather than host-validated"],
    ["loaded content not bound to the matching native Agent and Session", { ...completeAuditorMarkdownEvidence, agentAndSessionIdMatch: false }, "auditor instruction content is not bound to the live banca-auditor Agent and Session"],
    ["missing session projection preset", { ...completeAuditorMarkdownEvidence, sessionProjectionPreset: undefined }, "auditor instruction content is not bound to the live banca-auditor Agent and Session"],
    ["altered session projection preset", { ...completeAuditorMarkdownEvidence, sessionProjectionPreset: "banca-corretor" }, "auditor instruction content is not bound to the live banca-auditor Agent and Session"],
    ["incompatible effective Agent preset", { ...completeAuditorMarkdownEvidence, effectivePreset: "banca-corretor" }, "auditor instruction content is not bound to the live banca-auditor Agent and Session"],
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
    ["scratch control preset absent", { ...completeProfile, controlPresetEntry: false }, "scratch control DSH AgentPreset entry missing"],
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
    })).toContain("E2E did not stop both native pre-step probes before step/start and agent/request, or used a model/credential")
  })

  test("rejects lifecycle evidence without direct native Session event snapshots", () => {
    expect(validateEvidence({
      ...completeRuntime,
      externalActivity: {
        ...completeRuntime.externalActivity,
        auditorStoredForbiddenEvents: undefined,
        controlStoredForbiddenEvents: undefined,
      },
    })).toContain("E2E did not stop both native pre-step probes before step/start and agent/request, or used a model/credential")
  })

  test("requires fail-closed native pre-step probes", () => {
    expect(validateEvidence({
      ...completeRuntime,
      externalActivity: { ...completeRuntime.externalActivity, stepStartEvents: 1 },
    })).toContain("E2E did not stop both native pre-step probes before step/start and agent/request, or used a model/credential")
    expect(validateEvidence({
      ...completeRuntime,
      agentTeardown: { ...completeRuntime.agentTeardown, controlAgentDisposed: false },
    })).toContain("real DSH Agent lifecycle teardown was not verified")
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

const completeNativeSkillsEvidence = {
  hostApiAvailable: true,
  catalogComplete: true,
  totalSkillsObserved: expectedNativeSkills.length,
  allDiscovered: true,
  allLoaded: true,
  allIntegrityVerified: true,
  skills: Object.fromEntries(
    expectedNativeSkills.map((name) => [
      name,
      {
        name,
        provider: expectedNativeSkillProvider,
        sourcePath: canonicalNativeSkills[name].sourcePath,
        sourceSha256: canonicalNativeSkills[name].sourceSha256,
        canonicalBodySha256: canonicalNativeSkills[name].bodySha256,
        discovered: true,
        loaded: true,
        contentSha256: canonicalNativeSkills[name].bodySha256,
        contentBytes: canonicalNativeSkills[name].bodyLength,
        integrityVerified: true,
      },
    ]),
  ),
}

describe("DSH native skills discovery and loading contract (#38)", () => {
  test("accepts complete positive evidence for all eight native skills", () => {
    expect(validateNativeSkillsEvidence(completeNativeSkillsEvidence)).toEqual([])
    expect(classifyNativeSkillsStatus(completeNativeSkillsEvidence)).toBe("PASS")
  })

  test("reports BLOCKED when host API is unavailable or evidence is missing", () => {
    expect(classifyNativeSkillsStatus(undefined)).toBe("BLOCKED")
    expect(classifyNativeSkillsStatus({})).toBe("BLOCKED")
    expect(classifyNativeSkillsStatus({ hostApiAvailable: false })).toBe("BLOCKED")
  })

  test("updates gate summary while preserving legacy gates", () => {
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      overallStatus: "PASS",
      exitCode: 0,
    })
    expect(classifyProfileGateStatuses("PASS", "PASS", "BLOCKED")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
    expect(classifyProfileGateStatuses("PASS", "PASS", "FAIL")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "FAIL",
      overallStatus: "FAIL",
      exitCode: 1,
    })
    // Legacy 2-argument invocation remains identical
    expect(classifyProfileGateStatuses("PASS", "BLOCKED")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
  })

  test.each([
    [
      "1. Skill obrigatória ausente",
      (() => {
        const skills = { ...completeNativeSkillsEvidence.skills }
        delete (skills as Record<string, unknown>)["banca-avaliacao"]
        return { ...completeNativeSkillsEvidence, allDiscovered: false, skills }
      })(),
      'required skill "banca-avaliacao" was not discovered',
    ],
    [
      "2. Catálogo incompleto",
      { ...completeNativeSkillsEvidence, catalogComplete: false },
      "native skill catalog discovery was incomplete",
    ],
    [
      "3. Provider incorreto",
      (() => {
        const skills = {
          ...completeNativeSkillsEvidence.skills,
          "banca-correcao": {
            ...completeNativeSkillsEvidence.skills["banca-correcao"],
            provider: "dsh-skill-filesystem",
          },
        }
        return { ...completeNativeSkillsEvidence, skills }
      })(),
      'skill "banca-correcao" provider is "dsh-skill-filesystem", expected "dshbanca"',
    ],
    [
      "4. Skill descoberta, mas não carregável",
      (() => {
        const skills = {
          ...completeNativeSkillsEvidence.skills,
          "banca-detector-ia": {
            ...completeNativeSkillsEvidence.skills["banca-detector-ia"],
            loaded: false,
            contentSha256: null,
            integrityVerified: false,
          },
        }
        return { ...completeNativeSkillsEvidence, allLoaded: false, allIntegrityVerified: false, skills }
      })(),
      'skill "banca-detector-ia" was discovered but could not be loaded',
    ],
    [
      "5. Conteúdo carregado divergente",
      (() => {
        const skills = {
          ...completeNativeSkillsEvidence.skills,
          "banca-grille": {
            ...completeNativeSkillsEvidence.skills["banca-grille"],
            contentSha256: "sha256:tampered-body-content",
            integrityVerified: false,
          },
        }
        return { ...completeNativeSkillsEvidence, allIntegrityVerified: false, skills }
      })(),
      'skill "banca-grille" loaded content does not match canonical source',
    ],
    [
      "6. Hash incompatível",
      (() => {
        const skills = {
          ...completeNativeSkillsEvidence.skills,
          "banca-plagio": {
            ...completeNativeSkillsEvidence.skills["banca-plagio"],
            sourceSha256: "sha256:tampered-source-file",
          },
        }
        return { ...completeNativeSkillsEvidence, skills }
      })(),
      'canonical source hash for "banca-plagio" is invalid',
    ],
    [
      "7. Operação abortada",
      { ...completeNativeSkillsEvidence, aborted: true },
      "native skill discovery or loading operation was aborted",
    ],
    [
      "8. Relatório que declara PASS sem evidência real",
      { hostApiAvailable: false, allDiscovered: true, allLoaded: true, allIntegrityVerified: true },
      "native skills evidence lacks required host verification",
    ],
  ])("rejects negative test case: %s", (_label, evidence, expectedError) => {
    expect(validateNativeSkillsEvidence(evidence)).toContain(expectedError)
    expect(classifyNativeSkillsStatus(evidence)).toBe(evidence.hostApiAvailable === false ? "BLOCKED" : "FAIL")
  })
})
