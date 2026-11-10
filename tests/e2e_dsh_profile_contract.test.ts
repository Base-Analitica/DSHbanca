import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { parse as parseYaml } from "yaml"
import { buildSdkPresetOverlayPatch, e2eControlPresetId } from "../scripts/lib/dsh-profile-e2e-presets.js"
import { renderControlPresetSelector } from "../scripts/lib/dsh-profile-e2e-observer-control.js"
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
  validateBatchAuditEvidence,
  classifyBatchAuditEvidenceStatus,
  validateNativeQuestionsEvidence,
  classifyNativeQuestionsStatus,
  validateAcademicDecisionEvidence,
  classifyAcademicDecisionStatus,
  classifyCancellationOutcome,
  classifyProfileGateStatuses,
  captureNativeSkillsEvidence,
  validateEvidence,
  validateProfileEvidence,
  validatePresetReferences,
  validateComposedProfilePlugins,
} from "../scripts/lib/dsh-profile-e2e-contract.js"
import * as profileEvidenceContract from "../scripts/lib/dsh-profile-e2e-contract.js"

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

function getCanonicalSkillBody(name: string): string {
  const text = readFileSync(`skills/${name}/SKILL.md`, "utf8")
  const end = text.indexOf("\n---", 3)
  return text.slice(end + 4).replace(/^\n+/, "")
}

function buildMockSkillsContext(options: {
  snapshot?: "complete" | "incomplete" | "throws" | "malformed" | "missing"
  list?: "valid" | "incomplete" | "throws"
  get?: "valid" | "divergent" | "missingSkill" | "throws"
}) {
  const names = options.list === "incomplete" ? expectedNativeSkills.slice(0, 7) : expectedNativeSkills
  const summaries = names.map((name) => ({ name, provider: expectedNativeSkillProvider }))
  return {
    skills: {
      ...(options.snapshot === "missing"
        ? {}
        : {
            snapshot: async () => {
              if (options.snapshot === "throws") throw new Error("DSH skills snapshot host error")
              if (options.snapshot === "incomplete") return { skills: summaries, complete: false }
              if (options.snapshot === "malformed") return { skills: "not-an-array", complete: "yes" }
              return { skills: summaries, complete: true }
            },
          }),
      list: async () => {
        if (options.list === "throws") throw new Error("DSH skills list host error")
        return summaries
      },
      get: async (name: string) => {
        if (options.get === "throws") throw new Error(`DSH skills get error for ${name}`)
        if (options.get === "missingSkill" && name === "banca-revisor") return undefined
        const content = getCanonicalSkillBody(name)
        if (options.get === "divergent" && name === "banca-revisor") {
          return { name, content: content + "\n<!-- divergent content -->" }
        }
        return { name, content }
      },
    },
  }
}

describe("observer evidence capture and fail-closed catalog completeness", () => {
  test("1. snapshot throws, list and get succeed -> returns FAIL, not PASS", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "throws", list: "valid", get: "valid" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.catalogComplete).toBe(false)
    expect(evidence.hostApiAvailable).toBe(true)
    expect(validateNativeSkillsEvidence(evidence)).toContain("native skill catalog discovery was incomplete")
    expect(classifyNativeSkillsStatus(evidence)).toBe("FAIL")
  })

  test("2. snapshot is missing, list and get work -> returns BLOCKED, not PASS", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "missing", list: "valid", get: "valid" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.catalogComplete).toBe(false)
    expect(evidence.hostApiAvailable).toBe(false)
    expect(validateNativeSkillsEvidence(evidence)).toContain("native skills evidence lacks required host verification")
    expect(classifyNativeSkillsStatus(evidence)).toBe("BLOCKED")
  })

  test("3. snapshot.complete is false -> returns FAIL", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "incomplete", list: "valid", get: "valid" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.catalogComplete).toBe(false)
    expect(validateNativeSkillsEvidence(evidence)).toContain("native skill catalog discovery was incomplete")
    expect(classifyNativeSkillsStatus(evidence)).toBe("FAIL")
  })

  test("4. snapshot returns malformed object -> returns FAIL", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "malformed", list: "valid", get: "valid" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.catalogComplete).toBe(false)
    expect(validateNativeSkillsEvidence(evidence)).toContain("native skill catalog discovery was incomplete")
    expect(classifyNativeSkillsStatus(evidence)).toBe("FAIL")
  })

  test("5. snapshot.complete is true with 8 valid skills and integer content -> returns PASS", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "complete", list: "valid", get: "valid" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.catalogComplete).toBe(true)
    expect(evidence.allDiscovered).toBe(true)
    expect(evidence.allLoaded).toBe(true)
    expect(evidence.allIntegrityVerified).toBe(true)
    expect(validateNativeSkillsEvidence(evidence)).toEqual([])
    expect(classifyNativeSkillsStatus(evidence)).toBe("PASS")
  })

  test("6a. missing skill from get -> returns FAIL", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "complete", list: "valid", get: "missingSkill" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.allLoaded).toBe(false)
    expect(validateNativeSkillsEvidence(evidence)).toContain('skill "banca-revisor" was discovered but could not be loaded')
    expect(classifyNativeSkillsStatus(evidence)).toBe("FAIL")
  })

  test("6b. divergent content from get -> returns FAIL", async () => {
    const ctx = buildMockSkillsContext({ snapshot: "complete", list: "valid", get: "divergent" })
    const evidence = await captureNativeSkillsEvidence(ctx, "/tmp/workspace")
    expect(evidence.allIntegrityVerified).toBe(false)
    expect(validateNativeSkillsEvidence(evidence)).toContain('skill "banca-revisor" loaded content does not match canonical source')
    expect(classifyNativeSkillsStatus(evidence)).toBe("FAIL")
  })

  test("actual observer module generated in scripts/e2e-dsh-profile.ts is fail-closed", async () => {
    const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
    const templateStart = runnerSource.indexOf("const observerSource = `")
    const contentStart = templateStart + "const observerSource = `".length
    const contentEnd = runnerSource.indexOf("\n`\n  writeFileSync(join(observerRoot, \"index.js\"), observerSource", contentStart)
    const template = runnerSource.slice(contentStart, contentEnd)
    const renderObserver = new Function(
      "observerName", "expectedTools", "auditorMarkdownSourceSha256", "auditorMarkdownSourceSha1",
      "workspace", "observerResult", "restartWorkspace", "restartObserverResultOne", "restartObserverResultTwo",
      "restartTeardownMarkerOne", "restartTeardownMarkerTwo", "renderControlPresetSelector", "e2eControlPresetId",
      `return \`${template}\`;`,
    ) as (...args: unknown[]) => string
    const generatedModuleSource = renderObserver(
      "dshbanca-e2e-observer", expectedTools, "source-sha256", "source-sha1",
      "/tmp/synthetic-workspace", "/tmp/observer-result.json", "/tmp/restart-workspace",
      "/tmp/process-a-result.json", "/tmp/process-b-result.json", "/tmp/process-a-shutdown.json", "/tmp/process-b-shutdown.json",
      renderControlPresetSelector, e2eControlPresetId,
    )

    const directory = mkdtempSync(join(tmpdir(), "dshbanca-observer-skills-"))
    const modulePath = join(directory, "observer-skills.mjs")
    try {
      writeFileSync(modulePath, generatedModuleSource, { mode: 0o600 })
      const generatedModule = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)
      expect(typeof generatedModule.captureNativeSkillsEvidence).toBe("function")

      // Snapshot throws: must FAIL, not PASS
      const ctxThrows = buildMockSkillsContext({ snapshot: "throws", list: "valid", get: "valid" })
      const evidenceThrows = await generatedModule.captureNativeSkillsEvidence(ctxThrows, "/tmp/workspace")
      expect(evidenceThrows.catalogComplete).toBe(false)
      expect(classifyNativeSkillsStatus(evidenceThrows)).toBe("FAIL")

      // Snapshot missing: must BLOCKED, not PASS
      const ctxMissing = buildMockSkillsContext({ snapshot: "missing", list: "valid", get: "valid" })
      const evidenceMissing = await generatedModule.captureNativeSkillsEvidence(ctxMissing, "/tmp/workspace")
      expect(evidenceMissing.catalogComplete).toBe(false)
      expect(classifyNativeSkillsStatus(evidenceMissing)).toBe("BLOCKED")

      // Snapshot complete: must PASS
      const ctxPass = buildMockSkillsContext({ snapshot: "complete", list: "valid", get: "valid" })
      const evidencePass = await generatedModule.captureNativeSkillsEvidence(ctxPass, "/tmp/workspace")
      expect(evidencePass.catalogComplete).toBe(true)
      expect(classifyNativeSkillsStatus(evidencePass)).toBe("PASS")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

const batchAuditPlanId = "1fc2cf44ea0ad923b401d36e35932491c8009807ff0207e05f1e7bd3d3929085"
const batchAuditFingerprint = "a6260a0083fa91b7e41bdc14855f626f65df8d9c2b57e71e54f05eef51784338"
const batchAuditIds = ["batch-01", "batch-02", "batch-03", "batch-04", "batch-05"]
const batchAuditOriginalAgentId = "a".repeat(64)
const batchAuditResumedAgentId = "b".repeat(64)
const completeFindingProjection = {
  version: "analysis-finding-v1",
  findingId: "f".repeat(64),
  planId: batchAuditPlanId,
  batchId: batchAuditIds[1],
  manuscriptFingerprint: batchAuditFingerprint,
  provenanceSha256: "a".repeat(64),
  claimSha256: "b".repeat(64),
  evidenceSha256: "c".repeat(64),
}
const completeAgentSessionResumeEvidence = {
  probeExecuted: true,
  executionMode: "same-process-native-dsh",
  syntheticAgentFixture: false,
  sameProcess: true,
  originalAgentId: batchAuditOriginalAgentId,
  originalSessionId: batchAuditOriginalAgentId,
  agentId: batchAuditResumedAgentId,
  sessionId: batchAuditResumedAgentId,
  createdVia: "ctx.agents.create",
  identityDistinctFromOriginal: true,
  agentAndSessionIdMatch: true,
  agentRegistryContainsAgent: true,
  sessionStoreContainsSession: true,
  workspaceMatches: true,
  presetSelectionResult: "banca-auditor",
  effectivePreset: "banca-auditor",
  sessionPresetProjection: "banca-auditor",
  toolRuntime: "ctx.tools.execute",
  switchAfterCompletedBatches: 2,
  queryCompletedBatchIdProvided: false,
  checkpointBeforeQuery: {
    planId: batchAuditPlanId,
    manuscriptFingerprint: batchAuditFingerprint,
    totalBatches: 5,
    completedBatches: 2,
    completedCharacters: 240,
    totalCharacters: 595,
    coveragePercent: 40.34,
    nextBatchId: batchAuditIds[2],
    nextBatchIndex: 2,
  },
  checkpointAfterQuery: {
    planId: batchAuditPlanId,
    manuscriptFingerprint: batchAuditFingerprint,
    totalBatches: 5,
    completedBatches: 2,
    completedCharacters: 240,
    totalCharacters: 595,
    coveragePercent: 40.34,
    nextBatchId: batchAuditIds[2],
    nextBatchIndex: 2,
  },
  analysisStores: {
    inventoryBeforeSha256: "1".repeat(64),
    inventoryAfterSha256: "1".repeat(64),
    checkpointBeforeSha256: "2".repeat(64),
    checkpointAfterSha256: "2".repeat(64),
    auditConfirmationsBeforeSha256: "3".repeat(64),
    auditConfirmationsAfterSha256: "3".repeat(64),
    findingsBeforeSha256: "4".repeat(64),
    findingsAfterSha256: "4".repeat(64),
  },
  receiptLedgerBeforeSha256: "3".repeat(64),
  receiptLedgerAfterSha256: "3".repeat(64),
  receiptLedgerUnchanged: true,
  findingBeforeResume: {
    count: 1,
    projection: { ...completeFindingProjection },
  },
  completedBatchIds: batchAuditIds.slice(2),
  completedBatchCount: 3,
  toolDispatchCount: 17,
  synthesisAgentId: batchAuditResumedAgentId,
  modelCalls: 0,
  teardown: {
    disposeCalled: true,
    agentUnregistered: true,
    sessionUnregistered: true,
  },
}
const completeBatchAuditEvidence = {
  probeExecuted: true,
  totalBatches: 5,
  completedBatches: 5,
  planId: batchAuditPlanId,
  manuscriptFingerprint: batchAuditFingerprint,
  planBatchIds: [...batchAuditIds],
  unverifiedAdvancesBlocked: 5,
  prematureSynthesisBlocked: 5,
  auditsCompletedWithZeroFindings: 4,
  batchAudits: batchAuditIds.map((batchId, batchIndex) => ({
    batchIndex,
    batchId,
    agentId: batchIndex < 2 ? batchAuditOriginalAgentId : batchAuditResumedAgentId,
    acceptedCount: batchIndex === 1 ? 1 : 0,
    receiptFindingCount: batchIndex === 1 ? 1 : 0,
    persistedFindingCount: batchIndex < 1 ? 0 : 1,
    findingId: batchIndex === 1 ? completeFindingProjection.findingId : null,
  })),
  auditToolDispatchCount: 6,
  orderlyAdvances: 5,
  resumesWithoutSpuriousAdvance: 5,
  invalidFinding: {
    rejected: true,
    errorCode: "invalid_lines",
    statePreserved: true,
    stateBeforeSha256: "d".repeat(64),
    stateAfterSha256: "d".repeat(64),
  },
  auditorIdentity: {
    createdVia: "ctx.agents.create",
    agentId: batchAuditOriginalAgentId,
    sessionId: batchAuditOriginalAgentId,
    agentAndSessionIdMatch: true,
    agentRegistryContainsAgent: true,
    sessionStoreContainsSession: true,
    effectivePreset: "banca-auditor",
    toolRuntime: "ctx.tools.execute",
    modelCalls: 0,
  },
  agentSessionResume: { ...completeAgentSessionResumeEvidence },
  nonEmptyFinding: {
    batchIndex: 1,
    acceptedCount: 1,
    receiptFindingCount: 1,
    persistedFindingCount: 1,
    synthesisFindingCount: 1,
    deterministicFindingId: true,
    expected: { ...completeFindingProjection },
    receipt: { ...completeFindingProjection },
    persisted: { ...completeFindingProjection },
    synthesis: { ...completeFindingProjection },
  },
  synthesis: {
    version: "global-analysis-synthesis-input-v1",
    planId: batchAuditPlanId,
    manuscriptFingerprint: batchAuditFingerprint,
    coverage: {
      state: "complete",
      totalBatches: 5,
      completedBatches: 5,
      totalCharacters: 595,
      completedCharacters: 595,
      coveragePercent: 100,
      orderedBatchIds: [...batchAuditIds],
    },
    findingsCount: 1,
  },
  synthesisReleased: true,
  synthesisInputCoverageState: "complete",
  manuscriptPreserved: true,
}

const crossProcessPersistenceHashes = {
  analysisInventorySha256: "c".repeat(64),
  checkpointSha256: "d".repeat(64),
  auditConfirmationsSha256: "e".repeat(64),
  findingsSha256: "f".repeat(64),
}
const crossProcessCheckpointAtTwo = {
  planId: batchAuditPlanId,
  manuscriptFingerprint: batchAuditFingerprint,
  totalBatches: 5,
  completedBatches: 2,
  completedCharacters: 240,
  totalCharacters: 595,
  coveragePercent: 40.34,
  state: "running",
  nextBatchIndex: 2,
  nextBatchId: batchAuditIds[2],
}
const crossProcessCheckpointAt = (batchIndex: number) => {
  const completedCharacters = batchIndex * 120
  return {
    ...crossProcessCheckpointAtTwo,
    completedBatches: batchIndex,
    completedCharacters,
    coveragePercent: Math.round((completedCharacters / 595) * 10000) / 100,
    nextBatchIndex: batchIndex,
    nextBatchId: batchAuditIds[batchIndex],
  }
}
const completeCrossProcessUnauditedAdvanceProbes = [2, 3, 4].map((batchIndex, probeIndex) => {
  const checkpoint = crossProcessCheckpointAt(batchIndex)
  const priorBatchIds = batchAuditIds.slice(0, batchIndex)
  const inventoryDigest = ["8", "9", "0"][probeIndex].repeat(64)
  return {
    batchIndex,
    batchId: batchAuditIds[batchIndex],
    errorCode: "missing_batch_audit",
    rejectionObserved: true,
    checkpointBefore: { ...checkpoint },
    checkpointAfter: { ...checkpoint },
    persistenceBefore: { ...crossProcessPersistenceHashes },
    persistenceAfter: { ...crossProcessPersistenceHashes },
    workspaceInventoryBeforeSha256: inventoryDigest,
    workspaceInventoryAfterSha256: inventoryDigest,
    persistedReceiptCountBefore: batchIndex,
    persistedReceiptCountAfter: batchIndex,
    persistedBatchIdsBefore: priorBatchIds,
    persistedBatchIdsAfter: [...priorBatchIds],
    findingCountBefore: 1,
    findingCountAfter: 1,
    findingsBefore: [{ ...completeFindingProjection }],
    findingsAfter: [{ ...completeFindingProjection }],
    persistentStateUnchanged: true,
  }
})
const crossProcessAuditorIdentity = (agentId: string) => ({
  createdVia: "ctx.agents.create",
  agentId,
  sessionId: agentId,
  agentAndSessionIdMatch: true,
  agentRegistryContainsAgent: true,
  sessionStoreContainsSession: true,
  effectivePreset: "banca-auditor",
  sessionPresetProjection: "banca-auditor",
  toolRuntime: "ctx.tools.execute",
  modelCalls: 0,
})
const crossProcessTeardown = {
  disposeCalled: true,
  agentUnregistered: true,
  sessionUnregistered: true,
  teardownFailed: false,
}
const completeCrossProcessBatchAuditEvidence = {
  probeExecuted: true,
  executionMode: "cross-process-native-dsh",
  syntheticProcessFixture: false,
  workspace: {
    sameWorkspace: true,
    preservedBetweenProcesses: true,
    resetBetweenProcesses: false,
    identitySha256: "1".repeat(64),
    firstProcessEndFilesystemIdentitySha256: "1".repeat(64),
    secondProcessStartFilesystemIdentitySha256: "1".repeat(64),
    secondProcessEndFilesystemIdentitySha256: "1".repeat(64),
    firstProcessEndInventorySha256: "a".repeat(64),
    secondProcessStartInventorySha256: "a".repeat(64),
  },
  processBoundary: {
    observationSource: "child_process.spawn+linux-procfs",
    first: {
      dshExecutableSha256: "b".repeat(64),
      profileIdentitySha256: "c".repeat(64),
      hostIdentitySha256: "2".repeat(64),
      observerIdentitySha256: "2".repeat(64),
      identityMatched: true,
      spawnObserved: true,
      kernelStartIdentityObserved: true,
      exitObserved: true,
      exitCode: 0,
      signal: null,
      timedOut: false,
      forcedTermination: false,
      naturalBeforeExitObserved: true,
      nativeTeardownMarkerObserved: true,
    },
    second: {
      dshExecutableSha256: "b".repeat(64),
      profileIdentitySha256: "c".repeat(64),
      hostIdentitySha256: "3".repeat(64),
      observerIdentitySha256: "3".repeat(64),
      identityMatched: true,
      spawnObserved: true,
      kernelStartIdentityObserved: true,
      exitObserved: true,
      exitCode: 0,
      signal: null,
      timedOut: false,
      forcedTermination: false,
      naturalBeforeExitObserved: true,
      nativeTeardownMarkerObserved: true,
    },
    secondStartedAfterFirstExit: true,
    processesDidNotOverlap: true,
  },
  totalBatches: 5,
  totalCharacters: 595,
  planId: batchAuditPlanId,
  manuscriptFingerprint: batchAuditFingerprint,
  planBatchIds: [...batchAuditIds],
  phaseOne: {
    probeExecuted: true,
    executionMode: "cross-process-native-dsh",
    workspaceIdentitySha256: "1".repeat(64),
    workspaceInventorySha256: "a".repeat(64),
    planId: batchAuditPlanId,
    manuscriptFingerprint: batchAuditFingerprint,
    totalBatches: 5,
    totalCharacters: 595,
    checkpoint: { ...crossProcessCheckpointAtTwo },
    checkpointAfterFirstBatch: {
      ...crossProcessCheckpointAtTwo,
      completedBatches: 1,
      completedCharacters: 120,
      coveragePercent: 20.17,
      nextBatchIndex: 1,
      nextBatchId: batchAuditIds[1],
    },
    completedBatchIds: batchAuditIds.slice(0, 2),
    planBatchIdsPrefix: batchAuditIds.slice(0, 3),
    completedBatchCharacters: [120, 120],
    batchAudits: batchAuditIds.slice(0, 2).map((batchId, batchIndex) => ({
      batchIndex,
      batchId,
      acceptedCount: batchIndex === 1 ? 1 : 0,
      persistedFindingCount: batchIndex === 1 ? 1 : 0,
    })),
    persistence: { ...crossProcessPersistenceHashes },
    persistedReceiptCount: 2,
    persistedBatchIds: batchAuditIds.slice(0, 2),
    unverifiedAdvancesBlocked: 2,
    findingCount: 1,
    finding: { ...completeFindingProjection },
    prematureSynthesisBlocked: true,
    synthesisReleased: false,
    agentIdentity: crossProcessAuditorIdentity("8".repeat(64)),
    teardown: { ...crossProcessTeardown },
  },
  phaseTwo: {
    workspaceIdentitySha256: "1".repeat(64),
    resumeQuery: {
      completedBatchIdProvided: false,
      checkpointBefore: { ...crossProcessCheckpointAtTwo },
      checkpointAfter: { ...crossProcessCheckpointAtTwo },
      persistenceBefore: { ...crossProcessPersistenceHashes },
      persistenceAfter: { ...crossProcessPersistenceHashes },
      recoveredFindingCount: 1,
      recoveredFinding: { ...completeFindingProjection },
      persistedReceiptCount: 2,
      persistedBatchIds: batchAuditIds.slice(0, 2),
    },
    workspaceInventoryBeforeResumeSha256: "a".repeat(64),
    agentIdentity: crossProcessAuditorIdentity("9".repeat(64)),
    completedBatchIds: batchAuditIds.slice(2),
    batchAudits: batchAuditIds.slice(2).map((batchId, index) => ({
      batchIndex: index + 2,
      batchId,
      acceptedCount: 0,
      persistedFindingCount: 1,
    })),
    unverifiedAdvancesBlocked: 3,
    unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes,
    persistedReceiptCount: 5,
    persistedBatchIds: [...batchAuditIds],
    finalCheckpoint: {
      planId: batchAuditPlanId,
      manuscriptFingerprint: batchAuditFingerprint,
      totalBatches: 5,
      completedBatches: 5,
      completedCharacters: 595,
      totalCharacters: 595,
      coveragePercent: 100,
      state: "complete",
      nextBatchIndex: null,
      nextBatchId: null,
    },
    synthesis: {
      state: "complete",
      totalBatches: 5,
      completedBatches: 5,
      totalCharacters: 595,
      completedCharacters: 595,
      coveragePercent: 100,
      orderedBatchIds: [...batchAuditIds],
      findingsCount: 1,
      finding: { ...completeFindingProjection },
    },
    manuscriptPreserved: true,
    teardown: { ...crossProcessTeardown },
  },
}

describe("DSH process-restart recovery contract (#103)", () => {
  test("validates phase one before any phase-two process launch", () => {
    expect(profileEvidenceContract.validateCrossProcessPhaseOneEvidence(completeCrossProcessBatchAuditEvidence.phaseOne)).toEqual([])
    const malformedEvidence = [
      { ...completeCrossProcessBatchAuditEvidence.phaseOne, checkpoint: { ...crossProcessCheckpointAtTwo, completedCharacters: 250 } },
      { ...completeCrossProcessBatchAuditEvidence.phaseOne, checkpoint: { ...crossProcessCheckpointAtTwo, nextBatchId: "not-the-next-plan-batch" } },
      { ...completeCrossProcessBatchAuditEvidence.phaseOne, checkpoint: { ...crossProcessCheckpointAtTwo, coveragePercent: 50 } },
      {
        ...completeCrossProcessBatchAuditEvidence.phaseOne,
        checkpointAfterFirstBatch: { ...completeCrossProcessBatchAuditEvidence.phaseOne.checkpointAfterFirstBatch, nextBatchId: "wrong-next-id" },
      },
      { ...completeCrossProcessBatchAuditEvidence.phaseOne, checkpoint: { ...crossProcessCheckpointAtTwo, completedBatches: 3 } },
      { ...completeCrossProcessBatchAuditEvidence.phaseOne, planBatchIdsPrefix: [batchAuditIds[0], batchAuditIds[1], "wrong-next-id"] },
    ]
    for (const evidence of malformedEvidence) {
      expect(profileEvidenceContract.validateCrossProcessPhaseOneEvidence(evidence)).toContain(
        "phase one must leave canonical 1/5 and 2/5 checkpoints matching observed batch characters, coverage, and next plan IDs",
      )
    }
  })

  test("cross-process BLOCKED status participates in the overall gate", () => {
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "PASS", "PASS", "BLOCKED")).toMatchObject({
      crossProcessBatchAuditStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
  })

  test("accepts independently observed sequential DSH process recovery", () => {
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence(completeCrossProcessBatchAuditEvidence)).toEqual([])
    expect(profileEvidenceContract.classifyCrossProcessBatchAuditEvidenceStatus(completeCrossProcessBatchAuditEvidence)).toBe("PASS")
  })

  test("requires the resumed DSH process to reject unaudited advances before each remaining batch", () => {
    const phaseTwoWithoutAdvanceDenials = {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        unverifiedAdvancesBlocked: undefined,
      },
    }
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence(phaseTwoWithoutAdvanceDenials)).toContain(
      "second process must reject unaudited advancement for all three remaining batches before auditing",
    )
  })

  test.each([
    ["zero denials", { unverifiedAdvancesBlocked: 0 }, "second process must reject unaudited advancement for all three remaining batches before auditing"],
    ["incomplete denial count", { unverifiedAdvancesBlocked: 2 }, "second process must reject unaudited advancement for all three remaining batches before auditing"],
    ["missing probe list", { unverifiedAdvanceProbes: undefined }, "second process must reject unaudited advancement for all three remaining batches before auditing"],
    ["unconfirmed rejection", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? { ...probe, rejectionObserved: false } : probe),
    }, "second process must observe missing_batch_audit for unaudited batch 3"],
    ["incomplete probe list", { unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.slice(0, 2) }, "second process must reject unaudited advancement for all three remaining batches before auditing"],
    ["wrong rejection code", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? { ...probe, errorCode: "unexpected" } : probe),
    }, "second process must observe missing_batch_audit for unaudited batch 3"],
    ["changed checkpoint", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? { ...probe, checkpointAfter: { ...probe.checkpointAfter, completedBatches: 3 } } : probe),
    }, "unaudited advance probe for batch 3 must preserve the current ordered checkpoint"],
    ["changed first-probe baseline hashes", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        persistenceBefore: { ...probe.persistenceBefore, checkpointSha256: "0".repeat(64) },
        persistenceAfter: { ...probe.persistenceAfter, checkpointSha256: "0".repeat(64) },
      } : probe),
    }, "second process must prove batch 3 rejection left checkpoint, confirmations, findings, and inventory unchanged"],
    ["changed audit confirmations", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        persistenceAfter: { ...probe.persistenceAfter, auditConfirmationsSha256: "0".repeat(64) },
      } : probe),
    }, "second process must prove batch 3 rejection left checkpoint, confirmations, findings, and inventory unchanged"],
    ["changed finding", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        findingsAfter: [{ ...completeFindingProjection, findingId: "0".repeat(64) }],
      } : probe),
    }, "second process must prove batch 3 rejection left checkpoint, confirmations, findings, and inventory unchanged"],
    ["changed workspace inventory", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        workspaceInventoryAfterSha256: "7".repeat(64),
      } : probe),
    }, "second process must prove batch 3 rejection left checkpoint, confirmations, findings, and inventory unchanged"],
  ])("rejects post-restart denial evidence mutation: %s", (_label, phaseTwoPatch, expectedError) => {
    const evidence = {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        ...phaseTwoPatch,
      },
    }
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence(evidence)).toContain(expectedError)
  })

  test.each([
    ["one DSH process reused across both phases", {
      ...completeCrossProcessBatchAuditEvidence,
      processBoundary: {
        ...completeCrossProcessBatchAuditEvidence.processBoundary,
        second: { ...completeCrossProcessBatchAuditEvidence.processBoundary.second, hostIdentitySha256: "2".repeat(64), observerIdentitySha256: "2".repeat(64) },
      },
    }, "two distinct sequential DSH process instances must be observed; a reused process is rejected"],
    ["only PID-shaped text is supplied", {
      ...completeCrossProcessBatchAuditEvidence,
      processBoundary: { ...completeCrossProcessBatchAuditEvidence.processBoundary, observationSource: "pid text in observer report" },
    }, "process identity must come from host spawn and kernel process-start observations"],
    ["process identity is fixture-only", {
      ...completeCrossProcessBatchAuditEvidence,
      syntheticProcessFixture: true,
    }, "synthetic process fixtures are not sufficient host process evidence"],
    ["phase two started before phase one exited", {
      ...completeCrossProcessBatchAuditEvidence,
      processBoundary: { ...completeCrossProcessBatchAuditEvidence.processBoundary, secondStartedAfterFirstExit: false },
    }, "two distinct sequential DSH process instances must be observed; a reused process is rejected"],
    ["first process required forced termination", {
      ...completeCrossProcessBatchAuditEvidence,
      processBoundary: {
        ...completeCrossProcessBatchAuditEvidence.processBoundary,
        first: { ...completeCrossProcessBatchAuditEvidence.processBoundary.first, signal: "SIGTERM", forcedTermination: true },
      },
    }, "first DSH process did not complete graceful teardown with exit code zero"],
    ["second process exited unsuccessfully", {
      ...completeCrossProcessBatchAuditEvidence,
      processBoundary: {
        ...completeCrossProcessBatchAuditEvidence.processBoundary,
        second: { ...completeCrossProcessBatchAuditEvidence.processBoundary.second, exitCode: 1 },
      },
    }, "second DSH process did not complete graceful teardown with exit code zero"],
    ["native DSH teardown completion was not observed", {
      ...completeCrossProcessBatchAuditEvidence,
      processBoundary: {
        ...completeCrossProcessBatchAuditEvidence.processBoundary,
        first: { ...completeCrossProcessBatchAuditEvidence.processBoundary.first, nativeTeardownMarkerObserved: false },
      },
    }, "first DSH process did not complete graceful teardown with exit code zero"],
    ["workspace was reset between phases", {
      ...completeCrossProcessBatchAuditEvidence,
      workspace: { ...completeCrossProcessBatchAuditEvidence.workspace, resetBetweenProcesses: true },
    }, "the same persisted synthetic workspace must be retained without reset between processes"],
    ["workspace inventory changed at process boundary", {
      ...completeCrossProcessBatchAuditEvidence,
      workspace: { ...completeCrossProcessBatchAuditEvidence.workspace, secondProcessStartInventorySha256: "b".repeat(64) },
    }, "the same persisted synthetic workspace must be retained without reset between processes"],
    ["same-content workspace was replaced with a new root directory", {
      ...completeCrossProcessBatchAuditEvidence,
      workspace: { ...completeCrossProcessBatchAuditEvidence.workspace, secondProcessStartFilesystemIdentitySha256: "b".repeat(64) },
    }, "the same persisted synthetic workspace must be retained without reset between processes"],
    ["phase one lacks durable receipts", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseOne: { ...completeCrossProcessBatchAuditEvidence.phaseOne, persistedReceiptCount: 1 },
    }, "first process must durably persist exactly two ordered audit receipts"],
    ["second process did not recover first receipts", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: { ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery, persistedReceiptCount: 1 },
      },
    }, "second process must recover the first two persisted audit receipts before advancing"],
    ["final receipt store omits a batch", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: { ...completeCrossProcessBatchAuditEvidence.phaseTwo, persistedReceiptCount: 4 },
    }, "final durable audit store must contain exactly one ordered receipt per canonical batch"],
    ["first phase checkpoint progressed beyond 2/5", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseOne: {
        ...completeCrossProcessBatchAuditEvidence.phaseOne,
        checkpoint: { ...crossProcessCheckpointAtTwo, completedBatches: 3 },
      },
    }, "first process must leave an unreset checkpoint at exactly 2/5 matching its canonical character coverage and next batch ID"],
    ["first phase plan was restarted", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseOne: {
        ...completeCrossProcessBatchAuditEvidence.phaseOne,
        checkpoint: { ...crossProcessCheckpointAtTwo, planId: "a".repeat(64) },
      },
    }, "first process must leave an unreset checkpoint at exactly 2/5 matching its canonical character coverage and next batch ID"],
    ["phase-one plan prefix diverged from final synthesis", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseOne: { ...completeCrossProcessBatchAuditEvidence.phaseOne, planBatchIdsPrefix: [batchAuditIds[0], batchAuditIds[1], "wrong-next-id"] },
    }, "first process observed plan prefix must match synthesis batch IDs across the restart boundary"],
    ["resume query advanced progress", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          completedBatchIdProvided: true,
          checkpointAfter: { ...crossProcessCheckpointAtTwo, completedBatches: 3 },
        },
      },
    }, "second process must query banca_context without completedBatchId"],
    ["resume query changed durable hashes", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          persistenceAfter: { ...crossProcessPersistenceHashes, findingsSha256: "a".repeat(64) },
        },
      },
    }, "cross-process persistent hashes must match and remain unchanged across resume-only context query"],
    ["second phase Agent/Session was not host verified", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        agentIdentity: { ...completeCrossProcessBatchAuditEvidence.phaseTwo.agentIdentity, sessionStoreContainsSession: false },
      },
    }, "second process must create and verify a new native banca-auditor Agent/Session"],
    ["second phase reused Agent/Session identity", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        agentIdentity: crossProcessAuditorIdentity("8".repeat(64)),
      },
    }, "second process must use an Agent/Session identity distinct from the first process"],
    ["Agent teardown failed", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        teardown: { ...crossProcessTeardown, agentUnregistered: false },
      },
    }, "second process Agent and Session teardown must complete without errors"],
    ["finding disappeared on process restart", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: { ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery, recoveredFindingCount: 0 },
      },
    }, "the original non-empty finding must remain present exactly once in storage and synthesis"],
    ["finding provenance changed on restart", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          recoveredFinding: { ...completeFindingProjection, provenanceSha256: "b".repeat(64) },
        },
      },
    }, "first-process finding identity and provenance must be unchanged after restart and in synthesis"],
    ["finding duplicated in synthesis", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        synthesis: { ...completeCrossProcessBatchAuditEvidence.phaseTwo.synthesis, findingsCount: 2 },
      },
    }, "final synthesis input must contain complete ordered coverage and exactly one finding"],
    ["a resumed batch was skipped", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        completedBatchIds: batchAuditIds.slice(3),
      },
    }, "second process must complete exactly the remaining three batches in plan order"],
    ["checkpoint was tampered after resume query", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        finalCheckpoint: { ...completeCrossProcessBatchAuditEvidence.phaseTwo.finalCheckpoint, planId: "b".repeat(64) },
      },
    }, "second process must finish the same plan at exactly 5/5 complete coverage"],
  ])("rejects integrity failure: %s", (_label, evidence, expectedError) => {
    const errors = profileEvidenceContract.validateCrossProcessBatchAuditEvidence(evidence)
    expect(errors).toContain(expectedError)
    expect(profileEvidenceContract.classifyCrossProcessBatchAuditEvidenceStatus(evidence)).toBe("FAIL")
  })
})

describe("DSH batch audit evidence gate contract (#44, #98, #100)", () => {
  test("accepts complete positive batch audit evidence with native Agent/Session handoff", () => {
    expect(validateBatchAuditEvidence(completeBatchAuditEvidence)).toEqual([])
    expect(classifyBatchAuditEvidenceStatus(completeBatchAuditEvidence)).toBe("PASS")
  })

  test.each([
    ["new Agent reused original Agent/Session identity", {
      ...completeAgentSessionResumeEvidence,
      agentId: batchAuditOriginalAgentId,
      sessionId: batchAuditOriginalAgentId,
    }],
    ["native Agent/Session ID is not pseudonymized", {
      ...completeAgentSessionResumeEvidence,
      agentId: "agent-e2e-resume",
      sessionId: "agent-e2e-resume",
    }],
    ["native lifecycle is replaced by a fixture", {
      ...completeAgentSessionResumeEvidence,
      executionMode: "fixture",
      syntheticAgentFixture: true,
    }],
    ["native Agent/Session is not in the same process", {
      ...completeAgentSessionResumeEvidence,
      sameProcess: false,
    }],
    ["new Agent lacks verified auditor preset", {
      ...completeAgentSessionResumeEvidence,
      effectivePreset: "",
      sessionPresetProjection: "",
    }],
    ["checkpoint restarted from zero", {
      ...completeAgentSessionResumeEvidence,
      checkpointAfterQuery: {
        ...completeAgentSessionResumeEvidence.checkpointAfterQuery,
        completedBatches: 0,
        completedCharacters: 0,
        coveragePercent: 0,
        nextBatchId: batchAuditIds[0],
        nextBatchIndex: 0,
      },
    }],
    ["resume-only context spuriously advanced checkpoint", {
      ...completeAgentSessionResumeEvidence,
      checkpointAfterQuery: {
        ...completeAgentSessionResumeEvidence.checkpointAfterQuery,
        completedBatches: 3,
        completedCharacters: 360,
        coveragePercent: 60.5,
        nextBatchId: batchAuditIds[3],
        nextBatchIndex: 3,
      },
    }],
    ["plan identity diverged at resume", {
      ...completeAgentSessionResumeEvidence,
      checkpointAfterQuery: {
        ...completeAgentSessionResumeEvidence.checkpointAfterQuery,
        planId: "e".repeat(64),
      },
    }],
    ["manuscript fingerprint diverged at resume", {
      ...completeAgentSessionResumeEvidence,
      checkpointAfterQuery: {
        ...completeAgentSessionResumeEvidence.checkpointAfterQuery,
        manuscriptFingerprint: "e".repeat(64),
      },
    }],
    ["resume selected wrong next batch", {
      ...completeAgentSessionResumeEvidence,
      checkpointAfterQuery: {
        ...completeAgentSessionResumeEvidence.checkpointAfterQuery,
        nextBatchId: batchAuditIds[3],
        nextBatchIndex: 3,
      },
    }],
    ["resume query claimed a completedBatchId", {
      ...completeAgentSessionResumeEvidence,
      queryCompletedBatchIdProvided: true,
    }],
    ["persisted checkpoint changed during read", {
      ...completeAgentSessionResumeEvidence,
      analysisStores: {
        ...completeAgentSessionResumeEvidence.analysisStores,
        checkpointAfterSha256: "e".repeat(64),
      },
    }],
    ["persisted audit confirmations changed during read", {
      ...completeAgentSessionResumeEvidence,
      analysisStores: {
        ...completeAgentSessionResumeEvidence.analysisStores,
        auditConfirmationsAfterSha256: "e".repeat(64),
      },
    }],
    ["persisted finding store changed during read", {
      ...completeAgentSessionResumeEvidence,
      analysisStores: {
        ...completeAgentSessionResumeEvidence.analysisStores,
        findingsAfterSha256: "e".repeat(64),
      },
    }],
    ["analysis store inventory changed during read", {
      ...completeAgentSessionResumeEvidence,
      analysisStores: {
        ...completeAgentSessionResumeEvidence.analysisStores,
        inventoryAfterSha256: "e".repeat(64),
      },
    }],
    ["in-memory audit receipt ledger changed during read", {
      ...completeAgentSessionResumeEvidence,
      receiptLedgerAfterSha256: "e".repeat(64),
    }],
    ["receipt ledger digest is not bound to persisted audit confirmations", {
      ...completeAgentSessionResumeEvidence,
      receiptLedgerBeforeSha256: "5".repeat(64),
      receiptLedgerAfterSha256: "5".repeat(64),
    }],
    ["preset selection did not commit the auditor role", {
      ...completeAgentSessionResumeEvidence,
      presetSelectionResult: "",
    }],
    ["persisted finding is absent before resume", {
      ...completeAgentSessionResumeEvidence,
      findingBeforeResume: {
        ...completeAgentSessionResumeEvidence.findingBeforeResume,
        count: 0,
      },
    }],
    ["persisted finding is duplicated before resume", {
      ...completeAgentSessionResumeEvidence,
      findingBeforeResume: {
        ...completeAgentSessionResumeEvidence.findingBeforeResume,
        count: 2,
      },
    }],
    ["persisted finding fingerprint diverged before resume", {
      ...completeAgentSessionResumeEvidence,
      findingBeforeResume: {
        ...completeAgentSessionResumeEvidence.findingBeforeResume,
        projection: {
          ...completeFindingProjection,
          manuscriptFingerprint: "e".repeat(64),
        },
      },
    }],
    ["remaining batch was not audited by the new Agent", {
      ...completeAgentSessionResumeEvidence,
      completedBatchIds: [batchAuditIds[2], batchAuditIds[3]],
      completedBatchCount: 2,
    }],
    ["final synthesis was not produced by the new Agent", {
      ...completeAgentSessionResumeEvidence,
      synthesisAgentId: batchAuditOriginalAgentId,
    }],
    ["resumed Agent entered a model-facing turn", {
      ...completeAgentSessionResumeEvidence,
      modelCalls: 1,
    }],
    ["new Agent was not disposed", {
      ...completeAgentSessionResumeEvidence,
      teardown: { ...completeAgentSessionResumeEvidence.teardown, disposeCalled: false },
    }],
    ["new Agent remained registered after disposal", {
      ...completeAgentSessionResumeEvidence,
      teardown: { ...completeAgentSessionResumeEvidence.teardown, agentUnregistered: false },
    }],
    ["new Session remained registered after disposal", {
      ...completeAgentSessionResumeEvidence,
      teardown: { ...completeAgentSessionResumeEvidence.teardown, sessionUnregistered: false },
    }],
  ])("rejects Agent/Session resume regression: %s", (_label, invalidResume) => {
    const evidence = {
      ...completeBatchAuditEvidence,
      agentSessionResume: invalidResume,
    }
    expect(validateBatchAuditEvidence(evidence).length).toBeGreaterThan(0)
    expect(classifyBatchAuditEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("fails closed when a full batch report omits native resume evidence", () => {
    const { agentSessionResume: _resume, ...evidence } = completeBatchAuditEvidence
    expect(validateBatchAuditEvidence(evidence)).not.toEqual([])
    expect(classifyBatchAuditEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("rejects unredacted native Agent/Session identifiers in the batch report", () => {
    const evidence = {
      ...completeBatchAuditEvidence,
      auditorIdentity: {
        ...completeBatchAuditEvidence.auditorIdentity,
        agentId: "agent-e2e-auditor",
        sessionId: "agent-e2e-auditor",
      },
    }
    expect(validateBatchAuditEvidence(evidence)).toContain(
      "auditor Agent/Session identity must be observed through DSH registries",
    )
    expect(classifyBatchAuditEvidenceStatus(evidence)).toBe("FAIL")
  })

  test.each([
    ["original Agent does not own the first two audits", 0, batchAuditResumedAgentId],
    ["resumed Agent does not own the final three audits", 2, batchAuditOriginalAgentId],
  ])("rejects handoff audit ownership regression: %s", (_label, batchIndex, agentId) => {
    const evidence = {
      ...completeBatchAuditEvidence,
      batchAudits: completeBatchAuditEvidence.batchAudits.map((audit, index) =>
        index === batchIndex ? { ...audit, agentId } : audit
      ),
    }
    expect(validateBatchAuditEvidence(evidence)).toContain(
      "the original Agent must audit batches 1-2 and the distinct resumed Agent batches 3-5",
    )
    expect(classifyBatchAuditEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("rejects a finding not accepted in batch two before the Agent/Session handoff", () => {
    const evidence = {
      ...completeBatchAuditEvidence,
      nonEmptyFinding: { ...completeBatchAuditEvidence.nonEmptyFinding, batchIndex: 0 },
    }
    expect(validateBatchAuditEvidence(evidence).length).toBeGreaterThan(0)
    expect(classifyBatchAuditEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("reports BLOCKED when evidence is missing or totalBatches undefined", () => {
    expect(classifyBatchAuditEvidenceStatus(undefined)).toBe("BLOCKED")
    expect(classifyBatchAuditEvidenceStatus({})).toBe("BLOCKED")
  })

  test("gate summary incorporates batch audit status while preserving earlier gates", () => {
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      overallStatus: "PASS",
      exitCode: 0,
    })
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "BLOCKED")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "FAIL")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "FAIL",
      overallStatus: "FAIL",
      exitCode: 1,
    })
  })

  test.each([
    [
      "totalBatches < 2",
      { ...completeBatchAuditEvidence, totalBatches: 1, completedBatches: 1 },
      "totalBatches must be at least 2",
    ],
    [
      "completedBatches !== totalBatches",
      { ...completeBatchAuditEvidence, completedBatches: 4 },
      "completedBatches must equal totalBatches",
    ],
    [
      "unverified advance not blocked",
      { ...completeBatchAuditEvidence, unverifiedAdvancesBlocked: 4 },
      "all batches must reject advance without audit",
    ],
    [
      "premature synthesis not blocked",
      { ...completeBatchAuditEvidence, prematureSynthesisBlocked: 4 },
      "all incomplete batches must block synthesis",
    ],
    [
      "audits completed with zero findings mismatch",
      { ...completeBatchAuditEvidence, auditsCompletedWithZeroFindings: 3 },
      "exactly one batch must accept a non-empty finding; other batches must remain empty",
    ],
    [
      "orderly advances mismatch",
      { ...completeBatchAuditEvidence, orderlyAdvances: 4 },
      "all batches must advance in order",
    ],
    [
      "resume spurious advance",
      { ...completeBatchAuditEvidence, resumesWithoutSpuriousAdvance: 4 },
      "resume must not spuriously advance completedBatches",
    ],
    [
      "synthesis not released",
      { ...completeBatchAuditEvidence, synthesisReleased: false },
      "synthesis must be released upon full coverage",
    ],
    [
      "synthesis coverage state not complete",
      { ...completeBatchAuditEvidence, synthesisInputCoverageState: "partial" },
      "synthesis coverage state must be complete",
    ],
    [
      "synthetic manuscript modified by analysis tools",
      { ...completeBatchAuditEvidence, manuscriptPreserved: false },
      "synthetic manuscript was modified by analysis tools",
    ],
  ])("rejects negative test case: %s", (_label, invalidEvidence, expectedError) => {
    const errors = validateBatchAuditEvidence(invalidEvidence)
    expect(errors).toContain(expectedError)
    expect(classifyBatchAuditEvidenceStatus(invalidEvidence)).toBe("FAIL")
  })

  test.each([
    ["probe was skipped", { ...completeBatchAuditEvidence, probeExecuted: false }, "batch audit probe must have executed"],
    [
      "Agent and Session identity is fabricated",
      {
        ...completeBatchAuditEvidence,
        auditorIdentity: { ...completeBatchAuditEvidence.auditorIdentity, sessionId: "different-session" },
      },
      "auditor Agent/Session identity must be observed through DSH registries",
    ],
    [
      "finding is absent from synthesis",
      {
        ...completeBatchAuditEvidence,
        nonEmptyFinding: { ...completeBatchAuditEvidence.nonEmptyFinding, synthesisFindingCount: 0 },
      },
      "synthesis input must contain exactly one finding",
    ],
    [
      "finding is duplicated in storage",
      {
        ...completeBatchAuditEvidence,
        nonEmptyFinding: { ...completeBatchAuditEvidence.nonEmptyFinding, persistedFindingCount: 2 },
      },
      "persisted findings store must contain exactly one non-empty finding",
    ],
    [
      "synthesis provenance diverged",
      {
        ...completeBatchAuditEvidence,
        nonEmptyFinding: {
          ...completeBatchAuditEvidence.nonEmptyFinding,
          synthesis: { ...completeBatchAuditEvidence.nonEmptyFinding.synthesis, provenanceSha256: "e".repeat(64) },
        },
      },
      "expected, receipt, stored, and synthesis finding identity/provenance must match",
    ],
    [
      "synthesis batch order diverged",
      {
        ...completeBatchAuditEvidence,
        synthesis: {
          ...completeBatchAuditEvidence.synthesis,
          coverage: { ...completeBatchAuditEvidence.synthesis.coverage, orderedBatchIds: [...batchAuditIds].reverse() },
        },
      },
      "synthesis input must preserve the exact plan batch order",
    ],
    [
      "invalid finding mutated state",
      { ...completeBatchAuditEvidence, invalidFinding: { ...completeBatchAuditEvidence.invalidFinding, statePreserved: false } },
      "invalid finding rejection must leave persisted state unchanged",
    ],
    [
      "invalid finding state hashes diverged",
      {
        ...completeBatchAuditEvidence,
        invalidFinding: { ...completeBatchAuditEvidence.invalidFinding, stateAfterSha256: "e".repeat(64) },
      },
      "invalid finding rejection must leave persisted state unchanged",
    ],
    [
      "invalid finding was not rejected",
      { ...completeBatchAuditEvidence, invalidFinding: { ...completeBatchAuditEvidence.invalidFinding, rejected: false } },
      "invalid finding must be rejected before persistence",
    ],
    [
      "finding ID was not verified as deterministic",
      {
        ...completeBatchAuditEvidence,
        nonEmptyFinding: { ...completeBatchAuditEvidence.nonEmptyFinding, deterministicFindingId: false },
      },
      "findingId must match the deterministic identity calculated from the submitted finding",
    ],
    [
      "every batch was reported as empty",
      { ...completeBatchAuditEvidence, auditsCompletedWithZeroFindings: 5 },
      "exactly one batch must accept a non-empty finding; other batches must remain empty",
    ],
    [
      "batch receipt was repeated instead of covering the next plan batch",
      {
        ...completeBatchAuditEvidence,
        batchAudits: completeBatchAuditEvidence.batchAudits.map((audit, index) => index === 2
          ? { ...completeBatchAuditEvidence.batchAudits[1] }
          : audit),
      },
      "batch audit receipts must cover every plan batch exactly once in plan order",
    ],
    [
      "an empty batch claims another accepted finding",
      {
        ...completeBatchAuditEvidence,
        batchAudits: completeBatchAuditEvidence.batchAudits.map((audit, index) => index === 0
          ? { ...audit, acceptedCount: 1, receiptFindingCount: 1, findingId: "d".repeat(64) }
          : audit),
      },
      "exactly one batch audit must accept the expected finding; other batches must remain empty",
    ],
    [
      "batch audit finding ID diverged from the expected finding",
      {
        ...completeBatchAuditEvidence,
        batchAudits: completeBatchAuditEvidence.batchAudits.map((audit, index) => index === 1
          ? { ...audit, findingId: "d".repeat(64) }
          : audit),
      },
      "exactly one batch audit must accept the expected finding; other batches must remain empty",
    ],
    [
      "receipt finding identity diverged",
      {
        ...completeBatchAuditEvidence,
        nonEmptyFinding: {
          ...completeBatchAuditEvidence.nonEmptyFinding,
          receipt: { ...completeBatchAuditEvidence.nonEmptyFinding.receipt, findingId: "d".repeat(64) },
        },
      },
      "expected, receipt, stored, and synthesis finding identity/provenance must match",
    ],
    [
      "synthesis coverage counters diverged",
      {
        ...completeBatchAuditEvidence,
        synthesis: {
          ...completeBatchAuditEvidence.synthesis,
          coverage: { ...completeBatchAuditEvidence.synthesis.coverage, completedCharacters: 594 },
        },
      },
      "synthesis coverage totals and counts must agree with the complete plan",
    ],
  ])("rejects vertical finding adulteration: %s", (_label, invalidEvidence, expectedError) => {
    const errors = validateBatchAuditEvidence(invalidEvidence)
    expect(errors).toContain(expectedError)
    expect(classifyBatchAuditEvidenceStatus(invalidEvidence)).toBe("FAIL")
  })
})

const completeNativeQuestionsEvidence = {
  hostApiAvailable: true,
  userQuestionsServiceAvailable: true,
  approvalServiceAvailable: true,
  syntheticScenarioCompleted: true,
  behaviors: {
    selectRecommendation: {
      questionId: "q-academic-rec-1",
      prompt: "Como deseja tratar a fundamentação teórica insuficiente apontada na auditoria?",
      validOptions: [
        "Adotar recomendação: Adicionar seção de Trabalhos Relacionados",
        "Não sei — explique/mostre evidências",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-rec-1",
        selected: ["Adotar recomendação: Adicionar seção de Trabalhos Relacionados"],
      },
      isRecommendation: true,
      mutationAuthorized: false,
    },
    requestMoreEvidence: {
      questionId: "q-academic-evid-1",
      prompt: "Deseja ver as evidências da omissão bibliográfica?",
      validOptions: [
        "Adotar recomendação: Incluir citações indicadas",
        "Não sei — explique/mostre evidências",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-evid-1",
        selected: ["Não sei — explique/mostre evidências"],
      },
      mutationAuthorized: false,
    },
    deferDecision: {
      questionId: "q-academic-defer-1",
      prompt: "Deseja deliberar agora sobre a reestruturação da introdução?",
      validOptions: [
        "Adotar recomendação: Reescrever parágrafos 2 e 3",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-defer-1",
        selected: ["Adiar / continuar outras etapas"],
      },
      mutationAuthorized: false,
    },
    customResponse: {
      questionId: "q-academic-custom-1",
      prompt: "Qual direcionamento metodológico adotar no capítulo 3?",
      validOptions: [
        "Adotar recomendação: Análise quantitativa",
        "Adiar / continuar outras etapas",
      ],
      observedAnswer: {
        id: "q-academic-custom-1",
        selected: [],
        custom: "Outro: Manter escopo atual conforme deliberação do orientador",
      },
      mutationAuthorized: false,
    },
    cancelQuestion: {
      questionId: "q-academic-cancel-1",
      prompt: "Pergunta que será cancelada imediatamente?",
      cancelled: true,
      errorCode: "ASK_ABORTED",
    },
    rejectIncompatibleAnswer: {
      rejected: true,
      errorCode: "BAD_INTENT",
    },
    delegatedAgentBlocked: {
      callingAgentOrigin: "subagent",
      isOwnedByParent: true,
      notInRoots: true,
      blocked: true,
      errorCode: "DELEGATED_CALLER",
      answererReached: false,
    },
    selectionDoesNotAuthorizeMutation: {
      nonMutatingProof: true,
      sessionAuditAvailable: true,
      sessionEventsRead: 12,
      approvalEventsCount: 0,
      noApprovalEmitted: true,
      mutationDispatched: false,
      manuscriptPreserved: true,
      auditorGuardUsedAsProof: false,
    },
  },
  independentApproval: {
    status: "BLOCKED",
    openTurnRequiredObserved: true,
    openTurnErrorMessage:
      "approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.",
    interactiveDecisionsStatus: "BLOCKED",
    interactiveDecisionsBlocker:
      "Interactive approval decisions require an open turn, pending separately authorized lifecycle execution.",
  },
  uiWebDisclaimer:
    "Synthetic answerer for native DSH contract verification only; not proof of real Web UI or interactive browser session.",
  modelExecutionUsed: false,
}

const fullPassNativeQuestionsEvidence = {
  ...completeNativeQuestionsEvidence,
  independentApproval: {
    status: "PASS",
    openTurnRequiredObserved: true,
    openTurnErrorMessage:
      "approval.request() outside an open turn: the approval/asked + approval/decided audit pair must be turn-enclosed (a bare event between turns is crash-tail garbage on reload). Ask from inside the turn that needs the decision.",
    interactiveDecisionsStatus: "PASS",
    turnIntegrity: {
      singleTurnClosed: true,
      turnStartSeq: 1,
      turnEndSeq: 10,
    },
    unavailableProvedByAbsenceOfProvider: true,
    observedDecisions: [
      {
        requestId: "appr-req-001",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_allowed_action",
        askedSeq: 2,
        decidedSeq: 3,
        turnSeq: 2,
        outcome: "allowed-once",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
      },
      {
        requestId: "appr-req-002",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_rejected_action",
        askedSeq: 4,
        decidedSeq: 5,
        turnSeq: 4,
        outcome: "rejected",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
      },
      {
        requestId: "appr-req-003",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_cancelled_action",
        askedSeq: 6,
        decidedSeq: 7,
        turnSeq: 6,
        outcome: "cancelled",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
      },
      {
        requestId: "appr-req-004",
        agentId: "agent-root-test",
        sessionId: "sess-turn-001",
        toolName: "academic_approval_unavailable_action",
        askedSeq: 8,
        decidedSeq: 9,
        turnSeq: 8,
        outcome: "unavailable",
        auditEvents: {
          askedEventLogged: true,
          decidedEventLogged: true,
        },
        turnBoundaries: {
          turnStartSeq: 1,
          turnEndSeq: 10,
          isEnclosed: true,
        },
        unansweredByProvider: true,
      },
    ],
    allowedOnceIsSoleGrant: true,
    nonGrantsDeny: {
      rejectedDenies: true,
      cancelledDenies: true,
      unavailableDenies: true,
    },
  },
}

describe("DSH native questions evidence gate contract (#46)", () => {
  test("accepts complete valid native questions evidence (BLOCKED pre-lifecycle)", () => {
    expect(validateNativeQuestionsEvidence(completeNativeQuestionsEvidence)).toEqual([])
    expect(classifyNativeQuestionsStatus(completeNativeQuestionsEvidence)).toBe("BLOCKED")
  })

  test("accepts full pass native questions evidence (PASS post-lifecycle)", () => {
    expect(validateNativeQuestionsEvidence(fullPassNativeQuestionsEvidence)).toEqual([])
    expect(classifyNativeQuestionsStatus(fullPassNativeQuestionsEvidence)).toBe("PASS")
  })

  test("reports BLOCKED when evidence is missing or hostApiAvailable false", () => {
    expect(classifyNativeQuestionsStatus(undefined)).toBe("BLOCKED")
    expect(classifyNativeQuestionsStatus({})).toBe("BLOCKED")
    expect(classifyNativeQuestionsStatus({ hostApiAvailable: false })).toBe("BLOCKED")
  })

  test("gate summary incorporates native questions status while preserving earlier gates", () => {
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "PASS")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      nativeQuestionsStatus: "PASS",
      overallStatus: "PASS",
      exitCode: 0,
    })
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "BLOCKED")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      nativeQuestionsStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
    expect(classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "FAIL")).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      nativeQuestionsStatus: "FAIL",
      overallStatus: "FAIL",
      exitCode: 1,
    })
  })

  test.each([
    [
      "recommendation selection marked as mutation authorized",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectRecommendation: { ...completeNativeQuestionsEvidence.behaviors.selectRecommendation, mutationAuthorized: true },
        },
      },
      "central safety risk violation: selecting a recommendation must not grant mutation authorization",
    ],
    [
      "manuscript modified following selection",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            manuscriptPreserved: false,
          },
        },
      },
      "academic manuscript was mutated by question selection workflow",
    ],
    [
      "cancellation not handled",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          cancelQuestion: { ...completeNativeQuestionsEvidence.behaviors.cancelQuestion, cancelled: false },
        },
      },
      "question cancellation was not verified with ASK_ABORTED error",
    ],
    [
      "delegated agent not blocked",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: { ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked, blocked: false },
        },
      },
      "delegated agent must be blocked from userQuestions with DELEGATED_CALLER",
    ],
    [
      "delegated agent returned NO_PROVIDER instead of DELEGATED_CALLER",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            errorCode: "NO_PROVIDER",
            blocked: false,
          },
        },
      },
      "NO_PROVIDER must not be accepted as proof of delegated agent blocking",
    ],
    [
      "delegated agent not owned by parent in runtime",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            isOwnedByParent: false,
          },
        },
      },
      "delegated agent must be verified as owned by parent in runtime",
    ],
    [
      "delegated agent present in runtime roots",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            notInRoots: false,
          },
        },
      },
      "delegated agent must not be present in runtime roots",
    ],
    [
      "delegated agent question reached answerer",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          delegatedAgentBlocked: {
            ...completeNativeQuestionsEvidence.behaviors.delegatedAgentBlocked,
            answererReached: true,
          },
        },
      },
      "delegated agent question must not reach the answerer",
    ],
    [
      "approval rejected outcome does not deny in PASS",
      {
        ...fullPassNativeQuestionsEvidence,
        independentApproval: {
          ...fullPassNativeQuestionsEvidence.independentApproval,
          nonGrantsDeny: { ...fullPassNativeQuestionsEvidence.independentApproval.nonGrantsDeny, rejectedDenies: false },
        },
      },
      "non-grant approval outcome 'rejected' must deny authorization",
    ],
    [
      "model execution used in probe",
      { ...completeNativeQuestionsEvidence, modelExecutionUsed: true },
      "native questions probe used unauthorized model execution",
    ],
    [
      "unobserved static boolean claim of approval contract verification",
      {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          ...completeNativeQuestionsEvidence.independentApproval,
          contractVerified: true,
        },
      },
      "unobserved static boolean claim of approval contract verification is rejected",
    ],
    [
      "attempt to present auditor guard as independent approval proof",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            attemptedTool: "banca_corrigir",
            auditorGuardUsedAsProof: true,
          },
        },
      },
      "auditor read-only guard must not be presented as proof of independent approval boundary",
    ],
    [
      "approval PASS status missing observedDecisions with turn audit",
      {
        ...completeNativeQuestionsEvidence,
        independentApproval: {
          status: "PASS",
          openTurnRequiredObserved: true,
          openTurnErrorMessage: "approval.request() outside an open turn",
          interactiveDecisionsStatus: "PASS",
          allowedOnceIsSoleGrant: true,
          nonGrantsDeny: { rejectedDenies: true, cancelledDenies: true, unavailableDenies: true },
        },
      },
      "approval.status cannot be PASS without verified native observedDecisions containing turn-enclosed audit events",
    ],
    [
      "session audit unavailable to prove absence of approval",
      {
        ...completeNativeQuestionsEvidence,
        behaviors: {
          ...completeNativeQuestionsEvidence.behaviors,
          selectionDoesNotAuthorizeMutation: {
            ...completeNativeQuestionsEvidence.behaviors.selectionDoesNotAuthorizeMutation,
            sessionAuditAvailable: false,
          },
        },
      },
      "session event stream was not available or could not be verified to prove absence of approval",
    ],
  ])("rejects negative test case: %s", (_label, invalidEvidence, expectedError) => {
    const errors = validateNativeQuestionsEvidence(invalidEvidence)
    expect(errors).toContain(expectedError)
    expect(classifyNativeQuestionsStatus(invalidEvidence)).toBe("FAIL")
  })
})

const completeAcademicDecisionEvidence = {
  hostApiAvailable: true,
  domainLibraryLoaded: true,
  skillLoaded: {
    name: "banca-grille",
    discovered: true,
    loaded: true,
    canonicalBodySha256: canonicalNativeSkills["banca-grille"].bodySha256,
    integrityVerified: true,
  },
  agentIdentity: {
    agentId: "agent-auditor-root",
    sessionId: "agent-auditor-root",
    agentAndSessionIdMatch: true,
    isRoot: true,
  },
  toolDispatch: {
    toolName: "ask_user_question",
    callId: "dshbanca-e2e-academic-decision",
    dispatched: true,
    isError: false,
  },
  transmittedPayload: {
    questionId: "f-academic-e2e-001",
    prompt: "Como deseja estruturar o delineamento amostral no capítulo 1?",
    fullQuestionText:
      "Como deseja estruturar o delineamento amostral no capítulo 1?\n\nAchado: f-academic-e2e-001\nEvidência: capitulos/lote1.tex:1-1 — Deliberação metodológica necessária: escolha de técnica de amostragem\nJustificativa da recomendação: Recomendado para garantir validade estatística e comparabilidade dos estratos na pesquisa sintética.",
    containsFindingId: true,
    containsLocalizedEvidence: true,
    containsRecommendationJustification: true,
    evidenceSnippetVerified: true,
    detailFieldDroppedByHostTool: true,
    optionsCount: 5,
    hasRecommendedOption: true,
    hasUncertaintyOption: true,
    hasDeferOption: true,
    hasConsequencesAndRisks: true,
  },
  selectedAnswer: {
    id: "f-academic-e2e-001",
    selected: [
      "Adotar amostragem probabilística estratificada (Recommended)",
    ],
    isRecommendation: true,
    isNonEmptySelection: true,
    noFreeTextWhenStructured: true,
  },
  interpretation: {
    outcome: "selected_recommendation",
    mutationAuthorized: false,
    nextSteps: [
      "investigar_evidencias",
      "preparar_proposta_examinavel",
      "gerar_diff_proposto",
    ],
  },
  absenceOfMutationOrApproval: {
    approvalEventsCount: 0,
    allowedOnceEmitted: false,
    bancaCorrigirDispatched: false,
    bancaRestoreDispatched: false,
    manuscriptPreserved: true,
  },
  negativeCases: {
    delegatedAgentBlocked: {
      blocked: true,
      errorCode: "DELEGATED_CALLER",
      answererReached: false,
    },
    mismatchedOrIncompatibleRejected: true,
    preDispatchAbort: {
      handled: true,
      observedErrorCode: "ABORTED_BEFORE_DISPATCH",
      phase: "before_dispatch",
      rejectionObserved: true,
    },
    inFlightCancellation: {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      phase: "in_flight",
      rejectionObserved: true,
      requestReachedService: true,
    },
    cancellation: {
      handled: true,
      observedErrorCode: "ASK_ABORTED",
      phase: "in_flight",
      rejectionObserved: true,
      requestReachedService: true,
    },
    cancellationHandled: true,
  },
}

describe("DSH native academic decision evidence gate contract (#48)", () => {
  test("accepts complete valid academic decision evidence (PASS)", () => {
    expect(validateAcademicDecisionEvidence(completeAcademicDecisionEvidence)).toEqual([])
    expect(classifyAcademicDecisionStatus(completeAcademicDecisionEvidence)).toBe("PASS")
  })

  test("reports BLOCKED when evidence is missing or hostApiAvailable false", () => {
    expect(classifyAcademicDecisionStatus(undefined)).toBe("BLOCKED")
    expect(classifyAcademicDecisionStatus({})).toBe("BLOCKED")
    expect(classifyAcademicDecisionStatus({ hostApiAvailable: false })).toBe("BLOCKED")
  })

  test("gate summary incorporates academicDecisionStatus while preserving earlier gates", () => {
    expect(
      classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "PASS", "PASS"),
    ).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      nativeQuestionsStatus: "PASS",
      academicDecisionStatus: "PASS",
      overallStatus: "PASS",
      exitCode: 0,
    })
    expect(
      classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "PASS", "BLOCKED"),
    ).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      nativeQuestionsStatus: "PASS",
      academicDecisionStatus: "BLOCKED",
      overallStatus: "BLOCKED",
      exitCode: 2,
    })
    expect(
      classifyProfileGateStatuses("PASS", "PASS", "PASS", "PASS", "PASS", "FAIL"),
    ).toEqual({
      issue2Status: "PASS",
      auditorMarkdownStatus: "PASS",
      nativeSkillsStatus: "PASS",
      batchAuditStatus: "PASS",
      nativeQuestionsStatus: "PASS",
      academicDecisionStatus: "FAIL",
      overallStatus: "FAIL",
      exitCode: 1,
    })
  })

  test.each([
    [
      "skill banca-grille was not discovered",
      {
        ...completeAcademicDecisionEvidence,
        skillLoaded: { ...completeAcademicDecisionEvidence.skillLoaded, discovered: false },
      },
      'required skill "banca-grille" was not discovered',
    ],
    [
      "skill banca-grille could not be loaded",
      {
        ...completeAcademicDecisionEvidence,
        skillLoaded: { ...completeAcademicDecisionEvidence.skillLoaded, loaded: false },
      },
      'skill "banca-grille" was discovered but could not be loaded',
    ],
    [
      "skill banca-grille body content altered",
      {
        ...completeAcademicDecisionEvidence,
        skillLoaded: { ...completeAcademicDecisionEvidence.skillLoaded, integrityVerified: false },
      },
      'skill "banca-grille" loaded content does not match canonical source',
    ],
    [
      "tool dispatch not ask_user_question",
      {
        ...completeAcademicDecisionEvidence,
        toolDispatch: { ...completeAcademicDecisionEvidence.toolDispatch, toolName: "banca_status" },
      },
      'academic decision must be dispatched through native tool "ask_user_question"',
    ],
    [
      "tool dispatch omitted or errored",
      {
        ...completeAcademicDecisionEvidence,
        toolDispatch: { ...completeAcademicDecisionEvidence.toolDispatch, dispatched: false },
      },
      'native tool "ask_user_question" was not successfully dispatched through ToolRuntime',
    ],
    [
      "findingId omitted from transmitted question",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, containsFindingId: false },
      },
      "transmitted question text must contain stable academic finding identification",
    ],
    [
      "localized evidence omitted from transmitted question",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, containsLocalizedEvidence: false },
      },
      "transmitted question text must contain localized file and line evidence",
    ],
    [
      "recommendation justification omitted from transmitted question",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, containsRecommendationJustification: false },
      },
      "transmitted question text must contain recommendation justification",
    ],
    [
      "host tool failed to forward because detail was not in question text",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, detailFieldDroppedByHostTool: false },
      },
      "evidence must prove host tool drops detail field and incorporates content into question text",
    ],
    [
      "less than 4 options transmitted (requires 2-4 alternatives + safe controls)",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, optionsCount: 3 },
      },
      "transmitted question must contain at least 4 options (2-4 alternatives plus safe controls)",
    ],
    [
      "recommended option missing from transmitted options",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, hasRecommendedOption: false },
      },
      "transmitted question must include a designated recommended option",
    ],
    [
      "safe uncertainty control missing",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, hasUncertaintyOption: false },
      },
      'transmitted question must include safe uncertainty option "Não sei — explique/mostre evidências"',
    ],
    [
      "safe defer control missing",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, hasDeferOption: false },
      },
      'transmitted question must include safe deferral option "Adiar / continuar outras etapas"',
    ],
    [
      "consequences and risks missing from alternatives",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: { ...completeAcademicDecisionEvidence.transmittedPayload, hasConsequencesAndRisks: false },
      },
      "transmitted alternatives must document consequences and risks",
    ],
    [
      "selected answer was empty",
      {
        ...completeAcademicDecisionEvidence,
        selectedAnswer: { ...completeAcademicDecisionEvidence.selectedAnswer, isNonEmptySelection: false, selected: [] },
      },
      "observed answer must contain a non-empty selection",
    ],
    [
      "selected answer used free text instead of structured choice",
      {
        ...completeAcademicDecisionEvidence,
        selectedAnswer: { ...completeAcademicDecisionEvidence.selectedAnswer, noFreeTextWhenStructured: false, custom: "livre" },
      },
      "observed answer must choose a structured alternative without free text",
    ],
    [
      "mutation authorized by decision selection (SAFETY INVARIANT VIOLATION)",
      {
        ...completeAcademicDecisionEvidence,
        interpretation: { ...completeAcademicDecisionEvidence.interpretation, mutationAuthorized: true },
      },
      "central safety risk violation: academic decision must not grant mutation authorization",
    ],
    [
      "interpretation suggests mutating tool",
      {
        ...completeAcademicDecisionEvidence,
        interpretation: { ...completeAcademicDecisionEvidence.interpretation, nextSteps: ["banca_corrigir"] },
      },
      "academic decision nextSteps must not include mutation tools without independent approval",
    ],
    [
      "approval events detected in academic session",
      {
        ...completeAcademicDecisionEvidence,
        absenceOfMutationOrApproval: { ...completeAcademicDecisionEvidence.absenceOfMutationOrApproval, approvalEventsCount: 1 },
      },
      "approval events were detected in academic session following decision",
    ],
    [
      "allowed-once emitted from academic decision",
      {
        ...completeAcademicDecisionEvidence,
        absenceOfMutationOrApproval: { ...completeAcademicDecisionEvidence.absenceOfMutationOrApproval, allowedOnceEmitted: true },
      },
      "allowed-once must not be emitted from academic decision workflow",
    ],
    [
      "banca_corrigir dispatched following decision",
      {
        ...completeAcademicDecisionEvidence,
        absenceOfMutationOrApproval: { ...completeAcademicDecisionEvidence.absenceOfMutationOrApproval, bancaCorrigirDispatched: true },
      },
      "mutation tool was dispatched without independent approval grant",
    ],
    [
      "banca_restore dispatched following decision",
      {
        ...completeAcademicDecisionEvidence,
        absenceOfMutationOrApproval: { ...completeAcademicDecisionEvidence.absenceOfMutationOrApproval, bancaRestoreDispatched: true },
      },
      "restore tool was dispatched without independent approval grant",
    ],
    [
      "manuscript modified following decision",
      {
        ...completeAcademicDecisionEvidence,
        absenceOfMutationOrApproval: { ...completeAcademicDecisionEvidence.absenceOfMutationOrApproval, manuscriptPreserved: false },
      },
      "academic manuscript was mutated by academic decision workflow",
    ],
    [
      "delegated agent not blocked",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          delegatedAgentBlocked: { ...completeAcademicDecisionEvidence.negativeCases.delegatedAgentBlocked, blocked: false },
        },
      },
      "delegated agent must be blocked from ask_user_question with DELEGATED_CALLER",
    ],
    [
      "delegated agent reached answerer",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          delegatedAgentBlocked: { ...completeAcademicDecisionEvidence.negativeCases.delegatedAgentBlocked, answererReached: true },
        },
      },
      "delegated agent question must not reach the answerer",
    ],
    [
      "mismatched or incompatible answer not rejected",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: { ...completeAcademicDecisionEvidence.negativeCases, mismatchedOrIncompatibleRejected: false },
      },
      "mismatched or incompatible answer must be rejected",
    ],
    [
      "cancellation not handled",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: { ...completeAcademicDecisionEvidence.negativeCases, cancellationHandled: false },
      },
      "cancellation must be handled fail-closed",
    ],
    [
      "academic domain library missing or not loaded",
      {
        ...completeAcademicDecisionEvidence,
        domainLibraryLoaded: false,
      },
      "academic decision domain library academic_decision.js was not loaded or required exports were missing",
    ],
    [
      "evidence snippet on cited lines not verified in synthetic fixture",
      {
        ...completeAcademicDecisionEvidence,
        transmittedPayload: {
          ...completeAcademicDecisionEvidence.transmittedPayload,
          evidenceSnippetVerified: false,
        },
      },
      "evidence snippet on cited lines of synthetic manuscript fixture was not verified",
    ],
    [
      "pre-dispatch abort not observing ABORTED_BEFORE_DISPATCH",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          preDispatchAbort: {
            handled: false,
            observedErrorCode: "ASK_ABORTED",
            phase: "in_flight",
            rejectionObserved: true,
          },
        },
      },
      "pre-dispatch abort must observe native ABORTED_BEFORE_DISPATCH error with phase before_dispatch",
    ],
    [
      "in-flight cancellation request did not reach native service",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          inFlightCancellation: {
            handled: true,
            observedErrorCode: "ASK_ABORTED",
            phase: "in_flight",
            rejectionObserved: true,
            requestReachedService: false,
          },
        },
      },
      "in-flight cancellation must prove request reached native service and observe native ASK_ABORTED error with phase in_flight",
    ],
    [
      "in-flight cancellation observing wrong code instead of ASK_ABORTED",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          inFlightCancellation: {
            handled: true,
            observedErrorCode: "ABORTED_BEFORE_DISPATCH",
            phase: "before_dispatch",
            rejectionObserved: true,
            requestReachedService: true,
          },
        },
      },
      "in-flight cancellation must prove request reached native service and observe native ASK_ABORTED error with phase in_flight",
    ],
    [
      "host ignores abort signal and returns success",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          cancellation: {
            handled: false,
            observedErrorCode: "IGNORED_ABORT_SUCCESS",
            rejectionObserved: false,
          },
        },
      },
      "cancellation must observe native ASK_ABORTED error from ToolRuntime; generic errors or unhandled aborts are rejected",
    ],
    [
      "cancellation observes generic error instead of native cancellation",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          cancellation: {
            handled: false,
            observedErrorCode: "GENERIC_ERROR",
            rejectionObserved: true,
          },
        },
      },
      "cancellation must observe native ASK_ABORTED error from ToolRuntime; generic errors or unhandled aborts are rejected",
    ],
    [
      "cancellation rejection not observed",
      {
        ...completeAcademicDecisionEvidence,
        negativeCases: {
          ...completeAcademicDecisionEvidence.negativeCases,
          cancellation: {
            handled: false,
            observedErrorCode: "",
            rejectionObserved: false,
          },
        },
      },
      "cancellation must observe native ASK_ABORTED error from ToolRuntime; generic errors or unhandled aborts are rejected",
    ],
  ])("rejects negative test case: %s", (_label, invalidEvidence, expectedError) => {
    const errors = validateAcademicDecisionEvidence(invalidEvidence)
    expect(errors).toContain(expectedError)
    expect(classifyAcademicDecisionStatus(invalidEvidence)).toBe("FAIL")
  })
})

describe("Cancellation outcome classification logic (#48)", () => {
  // Test both the TypeScript contract classifier and the observer implementation generated in scripts/e2e-dsh-profile.ts
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const fnStart = runnerSource.indexOf("export function classifyCancellationOutcome(resOrErr) {")
  const fnEnd = runnerSource.indexOf("\nexport async function runAcademicDecisionProbe", fnStart)
  const observerFnSource = runnerSource.slice(fnStart, fnEnd).replace("export function classifyCancellationOutcome", "function classifyCancellationOutcome")
  const observerClassify = new Function(`${observerFnSource}; return classifyCancellationOutcome;`)()

  const implementations = [
    { name: "TypeScript contract classifier", classify: classifyCancellationOutcome },
    { name: "Observer implementation from scripts/e2e-dsh-profile.ts", classify: observerClassify },
  ]

  for (const { name, classify } of implementations) {
    describe(`${name}`, () => {
      test("rejects TIMEOUT error even when message contains 'was aborted' (no false PASS)", () => {
        const errorWithTimeout = {
          code: "TIMEOUT",
          message: "request was aborted during an unrelated network timeout",
        }
        const classification = classify(errorWithTimeout)
        expect(classification.isCancellation).toBe(false)
        expect(classification.handled).toBe(false)
        expect(classification.observedErrorCode).toBe("TIMEOUT")
        expect(classification.phase).toBe("unknown")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("rejects ToolRuntime result with code TIMEOUT and abort mention", () => {
        const toolResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "operation was aborted due to timeout",
              info: { name: "TimeoutError", code: "TIMEOUT" },
            },
          },
        }
        const classification = classify(toolResult)
        expect(classification.isCancellation).toBe(false)
        expect(classification.handled).toBe(false)
        expect(classification.observedErrorCode).toBe("TIMEOUT")
        expect(classification.phase).toBe("unknown")
      })

      test("rejects NETWORK_ERROR without reclassifying to ASK_ABORTED", () => {
        const netError = {
          code: "NETWORK_ERROR",
          message: "socket was aborted by peer",
        }
        const classification = classify(netError)
        expect(classification.isCancellation).toBe(false)
        expect(classification.handled).toBe(false)
        expect(classification.observedErrorCode).toBe("NETWORK_ERROR")
        expect(classification.phase).toBe("unknown")
      })

      test("rejects generic error without code even when message contains 'was aborted'", () => {
        const genericError = {
          message: "request was aborted during an unrelated network timeout",
        }
        const classification = classify(genericError)
        expect(classification.isCancellation).toBe(false)
        expect(classification.handled).toBe(false)
        expect(classification.observedErrorCode).toBe("GENERIC_ERROR")
        expect(classification.phase).toBe("unknown")
      })

      test("rejects successful tool result even when caller signal was aborted (IGNORED_ABORT_SUCCESS)", () => {
        const successResult = {
          isError: false,
          result: {
            isError: false,
            value: { answers: [{ id: "q1", selected: ["opt1"] }] },
          },
        }
        const classification = classify(successResult)
        expect(classification.isCancellation).toBe(false)
        expect(classification.handled).toBe(false)
        expect(classification.observedErrorCode).toBe("IGNORED_ABORT_SUCCESS")
        expect(classification.phase).toBe("unknown")
        expect(classification.rejectionObserved).toBe(false)
      })

      test("rejects generic exception fail-closed", () => {
        const error = new TypeError("cannot read property of undefined")
        const classification = classify(error)
        expect(classification.isCancellation).toBe(false)
        expect(classification.handled).toBe(false)
        expect(classification.observedErrorCode).toBe("GENERIC_ERROR")
        expect(classification.phase).toBe("unknown")
      })

      test("accepts native UserQuestionError with code ASK_ABORTED (phase: in_flight)", () => {
        const nativeError = {
          info: { code: "ASK_ABORTED" },
          message: "ask_user_question was aborted before the user answered",
        }
        const classification = classify(nativeError)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ASK_ABORTED")
        expect(classification.phase).toBe("in_flight")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("accepts ToolRuntime result carrying UserQuestionError ASK_ABORTED (phase: in_flight)", () => {
        const toolRuntimeResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "ask_user_question was aborted before the user answered",
              info: { name: "UserQuestionError", code: "ASK_ABORTED" },
            },
          },
        }
        const classification = classify(toolRuntimeResult)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ASK_ABORTED")
        expect(classification.phase).toBe("in_flight")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("accepts ToolRuntime pre-dispatch abort ABORTED_BEFORE_DISPATCH without converting to ASK_ABORTED", () => {
        const preDispatchResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "tool call aborted before dispatch",
              info: { name: "AbortError", code: "ABORTED_BEFORE_DISPATCH" },
            },
          },
        }
        const classification = classify(preDispatchResult)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ABORTED_BEFORE_DISPATCH")
        expect(classification.observedErrorCode).not.toBe("ASK_ABORTED")
        expect(classification.phase).toBe("before_dispatch")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("accepts ToolRuntime started tool abort ABORTED (phase: tool_aborted)", () => {
        const toolAbortResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "tool call aborted",
              info: { name: "AbortError", code: "ABORTED" },
            },
          },
        }
        const classification = classify(toolAbortResult)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ABORTED")
        expect(classification.phase).toBe("tool_aborted")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("rejects invented error codes like TOOL_ABORTED_BEFORE_DISPATCH and TOOL_ABORTED", () => {
        const invented1 = {
          isError: true,
          error: {
            message: "tool call aborted before dispatch",
            info: { code: "TOOL_ABORTED_BEFORE_DISPATCH" },
          },
        }
        const c1 = classify(invented1)
        expect(c1.isCancellation).toBe(false)
        expect(c1.handled).toBe(false)
        expect(c1.observedErrorCode).toBe("TOOL_ABORTED_BEFORE_DISPATCH")
        expect(c1.phase).toBe("unknown")

        const invented2 = {
          isError: true,
          error: {
            message: "tool call aborted",
            info: { code: "TOOL_ABORTED" },
          },
        }
        const c2 = classify(invented2)
        expect(c2.isCancellation).toBe(false)
        expect(c2.handled).toBe(false)
        expect(c2.observedErrorCode).toBe("TOOL_ABORTED")
        expect(c2.phase).toBe("unknown")
      })

      test("accepts exact canonical native message when code is stripped (ask_user_question)", () => {
        const strippedResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "ask_user_question was aborted before the user answered",
            },
          },
        }
        const classification = classify(strippedResult)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ASK_ABORTED")
        expect(classification.phase).toBe("in_flight")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("accepts exact canonical native message when code is stripped (tool call aborted before dispatch)", () => {
        const strippedResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "tool call aborted before dispatch",
            },
          },
        }
        const classification = classify(strippedResult)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ABORTED_BEFORE_DISPATCH")
        expect(classification.phase).toBe("before_dispatch")
        expect(classification.rejectionObserved).toBe(true)
      })

      test("accepts exact canonical native message when code is stripped (tool call aborted)", () => {
        const strippedResult = {
          isError: true,
          result: {
            isError: true,
            error: {
              message: "tool call aborted",
            },
          },
        }
        const classification = classify(strippedResult)
        expect(classification.isCancellation).toBe(true)
        expect(classification.handled).toBe(true)
        expect(classification.observedErrorCode).toBe("ABORTED")
        expect(classification.phase).toBe("tool_aborted")
        expect(classification.rejectionObserved).toBe(true)
      })
    })
  }
})

describe("DSH Cordis composed profile plugin deduplication contract (#48 P1)", () => {
  test("RED: rejects duplicate @deepseek-ai/dsh-user-approval across distinct row IDs (identity-based)", () => {
    // Row IDs are deliberately DIFFERENT ("approval" vs "user-approval"), as reproduced in review #572922
    const conflictingRows = [
      { id: "approval", name: "@deepseek-ai/dsh-user-approval" },
      { id: "user-approval", name: "@deepseek-ai/dsh-user-approval" },
    ]
    const errors = validateComposedProfilePlugins(conflictingRows)
    expect(errors.length).toBeGreaterThanOrEqual(1)
    // Asserts detection is by package/service identity, NOT just repeating row ID
    expect(errors.some((e) => e.includes("@deepseek-ai/dsh-user-approval"))).toBe(true)
    expect(errors.some((e) => e.includes('duplicate Cordis service "approval"'))).toBe(true)
  })

  test("RED: rejects duplicate @deepseek-ai/dsh-user-questions across duplicate row IDs", () => {
    const conflictingRows = [
      { id: "user-questions", name: "@deepseek-ai/dsh-user-questions" },
      { id: "user-questions", name: "@deepseek-ai/dsh-user-questions" },
    ]
    const errors = validateComposedProfilePlugins(conflictingRows)
    expect(errors.length).toBeGreaterThanOrEqual(2)
    expect(errors.some((e) => e.includes('duplicate row id "user-questions"'))).toBe(true)
    expect(errors.some((e) => e.includes("@deepseek-ai/dsh-user-questions"))).toBe(true)
    expect(errors.some((e) => e.includes('duplicate Cordis service "userQuestions"'))).toBe(true)
  })

  test("RED: rejects duplicate @deepseek-ai/dsh-agent-preset-registry singleton", () => {
    const conflictingRows = [
      { id: "registry-1", name: "@deepseek-ai/dsh-agent-preset-registry" },
      { id: "agent-preset-registry", name: "@deepseek-ai/dsh-agent-preset-registry" },
    ]
    const errors = validateComposedProfilePlugins(conflictingRows)
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.includes("@deepseek-ai/dsh-agent-preset-registry"))).toBe(true)
    expect(errors.some((e) => e.includes('duplicate Cordis service "agentPresets"'))).toBe(true)
  })

  test("ignores disabled plugin rows without false rejection", () => {
    const rowsWithDisabled = [
      { id: "approval", name: "@deepseek-ai/dsh-user-approval" },
      { id: "user-approval-disabled", name: "@deepseek-ai/dsh-user-approval", disabled: true },
    ]
    const errors = validateComposedProfilePlugins(rowsWithDisabled)
    expect(errors).toEqual([])
  })

  test("allows legitimate multi-instance factory plugins like @deepseek-ai/dsh-agent-preset", () => {
    const rowsWithMultiplePresets = [
      { id: "dshbanca-banca-auditor-preset", name: "@deepseek-ai/dsh-agent-preset" },
      { id: e2eControlPresetId, name: "@deepseek-ai/dsh-agent-preset" },
    ]
    const errors = validateComposedProfilePlugins(rowsWithMultiplePresets)
    expect(errors).toEqual([])
  })

  test("GREEN: accepts clean profile composition reusing dsh-base services without overlay duplication", () => {
    const cleanComposedProfile = [
      // Provided natively by dsh-base
      { id: "user-questions", name: "@deepseek-ai/dsh-user-questions" },
      { id: "approval", name: "@deepseek-ai/dsh-user-approval" },
      // Provided by dshbanca bundle
      { id: "dshbanca", name: "dshbanca/dsh" },
      { id: "dshbanca-banca-auditor-preset", name: "@deepseek-ai/dsh-agent-preset" },
      // Provided by corrected overlay
      { id: "agent-preset-registry", name: "@deepseek-ai/dsh-agent-preset-registry" },
      { id: e2eControlPresetId, name: "@deepseek-ai/dsh-agent-preset" },
      { id: "tool-ask-user", name: "@deepseek-ai/dsh-tool-ask-user" },
      { id: "dshbanca-e2e-observer", name: "scratch-observer" },
    ]
    const errors = validateComposedProfilePlugins(cleanComposedProfile)
    expect(errors).toEqual([])
  })

  test("reproduction of prior HEAD (b6f572ff) bug: overlay with duplicate rows fails contract check", () => {
    // dsh-base native rows
    const baseRows = [
      { id: "user-questions", name: "@deepseek-ai/dsh-user-questions" },
      { id: "approval", name: "@deepseek-ai/dsh-user-approval" },
    ]
    // The flawed overlay from SHA b6f572ff:
    const flawedOverlayRows = [
      { id: "agent-preset-registry", name: "@deepseek-ai/dsh-agent-preset-registry" },
      { id: e2eControlPresetId, name: "@deepseek-ai/dsh-agent-preset" },
      { id: "user-questions", name: "@deepseek-ai/dsh-user-questions" },
      { id: "user-approval", name: "@deepseek-ai/dsh-user-approval" },
      { id: "tool-ask-user", name: "@deepseek-ai/dsh-tool-ask-user" },
      { id: "dshbanca-e2e-observer", name: "test-observer" },
    ]
    const errors = validateComposedProfilePlugins([...baseRows, ...flawedOverlayRows])
    expect(errors.length).toBeGreaterThanOrEqual(2)
    // Proves detection catches both row-ID conflict and different-ID provider conflict
    expect(errors.some((e) => e.includes('duplicate Cordis service "approval"'))).toBe(true)
    expect(errors.some((e) => e.includes('duplicate Cordis service "userQuestions"'))).toBe(true)
    expect(errors.some((e) => e.includes("@deepseek-ai/dsh-user-approval"))).toBe(true)
  })

  test("verified overlay from buildSdkPresetOverlayPatch has ZERO duplicate rows against dsh-base", () => {
    const overlayYaml = buildSdkPresetOverlayPatch("verified-observer")
    const parsedOverlay = (parseYaml(overlayYaml) as any[])
      .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])

    // Asserts that overlay no longer instantiates user-questions or user-approval
    const approvalRows = parsedOverlay.filter((r) => r?.name === "@deepseek-ai/dsh-user-approval")
    const questionRows = parsedOverlay.filter((r) => r?.name === "@deepseek-ai/dsh-user-questions")
    const askUserToolRows = parsedOverlay.filter((r) => r?.name === "@deepseek-ai/dsh-tool-ask-user")

    expect(approvalRows.length).toBe(0)
    expect(questionRows.length).toBe(0)
    expect(askUserToolRows.length).toBe(1)
    expect(askUserToolRows[0].id).toBe("tool-ask-user")

    // Combined with dsh-base, composition is valid
    const baseRows = [
      { id: "user-questions", name: "@deepseek-ai/dsh-user-questions" },
      { id: "approval", name: "@deepseek-ai/dsh-user-approval" },
    ]
    const errors = validateComposedProfilePlugins([...baseRows, ...parsedOverlay])
    expect(errors).toEqual([])
  })

  test("validateProfileEvidence enforces uniqueness of user-questions and user-approval", () => {
    expect(validateProfileEvidence({
      ...completeProfile,
      userQuestionsUnique: false,
    })).toContain("user-questions plugin package has duplicate instances in composed profile")

    expect(validateProfileEvidence({
      ...completeProfile,
      userApprovalUnique: false,
    })).toContain("user-approval plugin package has duplicate instances in composed profile")

    expect(validateProfileEvidence({
      ...completeProfile,
      askUserToolPresent: false,
    })).toContain("tool-ask-user entry missing from composed profile")

    expect(validateProfileEvidence({
      ...completeProfile,
      userQuestionsUnique: true,
      userApprovalUnique: true,
      askUserToolPresent: true,
    })).toEqual([])
  })
})
