import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
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
import {
  createReportPersistencePlan,
  mayStartAbruptPhaseTwo,
  parseLinuxProcStatProcessGroupId,
  processGroupAbsentFromProcRows,
  persistReportWithPlan,
  run as runControlledProcess,
  terminateOwnedDshChild,
} from "../scripts/e2e-dsh-profile.js"

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
      "restartTeardownMarkerOne", "restartTeardownMarkerTwo", "abruptRestartWorkspace", "abruptObserverResultOne",
      "abruptObserverResultTwo", "abruptTeardownMarkerOne", "abruptTeardownMarkerTwo", "abruptParentDecisionToken",
      "renderControlPresetSelector", "e2eControlPresetId",
      `return \`${template}\`;`,
    ) as (...args: unknown[]) => string
    const generatedModuleSource = renderObserver(
      "dshbanca-e2e-observer", expectedTools, "source-sha256", "source-sha1",
      "/tmp/synthetic-workspace", "/tmp/observer-result.json", "/tmp/restart-workspace",
      "/tmp/process-a-result.json", "/tmp/process-b-result.json", "/tmp/process-a-shutdown.json", "/tmp/process-b-shutdown.json",
      "/tmp/abrupt-restart-workspace", "/tmp/abrupt-process-a-result.json", "/tmp/abrupt-process-b-result.json",
      "/tmp/abrupt-process-a-shutdown.json", "/tmp/abrupt-process-b-shutdown.json", "test-parent-decision-token",
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
const incompleteCoverageMessage = (state: "pending" | "running") =>
  `global synthesis requires checkpoint.state === "complete"; received "${state}"`
const incompleteCoverageValue = (state: "pending" | "running") => [
  "synthesis input error",
  "code=incomplete_coverage",
  `message=${incompleteCoverageMessage(state)}`,
].join("\n")
const storedCheckpointEvidence = (checkpoint: {
  planId: string
  manuscriptFingerprint: string
  totalBatches: number
  completedBatches: number
  completedCharacters: number
  totalCharacters: number
  coveragePercent: number
  state: string
  nextBatchIndex: number | null
  nextBatchId: string | null
}) => ({
  version: "analysis-checkpoint-v2",
  planId: checkpoint.planId,
  fingerprint: checkpoint.manuscriptFingerprint,
  strategy: "ordered-source-spans-exhaustive-v1",
  totalBatches: checkpoint.totalBatches,
  completedBatches: checkpoint.completedBatches,
  totalCharacters: checkpoint.totalCharacters,
  completedCharacters: checkpoint.completedCharacters,
  coveragePercent: checkpoint.coveragePercent,
  state: checkpoint.state,
  manuscriptFingerprint: checkpoint.manuscriptFingerprint,
  nextBatchId: checkpoint.nextBatchId,
  nextBatchIndex: checkpoint.nextBatchIndex,
})
const completeBatchAuditSynthesisProbes = batchAuditIds.map((batchId, batchIndex) => {
  const completedCharacters = batchIndex * 120
  const state = batchIndex === 0 ? "pending" : "running"
  const checkpoint = storedCheckpointEvidence({
    planId: batchAuditPlanId,
    manuscriptFingerprint: batchAuditFingerprint,
    totalBatches: 5,
    completedBatches: batchIndex,
    completedCharacters,
    totalCharacters: 595,
    coveragePercent: Math.round((completedCharacters / 595) * 10_000) / 100,
    state,
    nextBatchIndex: batchIndex,
    nextBatchId: batchId,
  })
  const findings = batchIndex === 0 ? [] : [{ ...completeFindingProjection }]
  const persistedBatchIds = batchAuditIds.slice(0, batchIndex + 1)
  const persistence = {
    analysisInventorySha256: "a".repeat(64),
    checkpointSha256: "b".repeat(64),
    auditConfirmationsSha256: "c".repeat(64),
    findingsSha256: "d".repeat(64),
  }
  const workspaceInventory = ["4", "5", "6", "7", "8"][batchIndex]!.repeat(64)
  return {
    batchIndex,
    batchId,
    toolRuntimeIsError: false,
    toolResultValue: incompleteCoverageValue(state),
    toolMessage: incompleteCoverageValue(state),
    errorCode: "incomplete_coverage",
    errorMessage: incompleteCoverageMessage(state),
    rejectionObserved: true,
    checkpointBefore: { ...checkpoint },
    checkpointAfter: { ...checkpoint },
    persistenceBefore: { ...persistence },
    persistenceAfter: { ...persistence },
    workspaceInventoryBeforeSha256: workspaceInventory,
    workspaceInventoryAfterSha256: workspaceInventory,
    persistedReceiptCountBefore: batchIndex + 1,
    persistedReceiptCountAfter: batchIndex + 1,
    persistedBatchIdsBefore: [...persistedBatchIds],
    persistedBatchIdsAfter: [...persistedBatchIds],
    findingCountBefore: findings.length,
    findingCountAfter: findings.length,
    findingsBefore: findings.map((finding) => ({ ...finding })),
    findingsAfter: findings.map((finding) => ({ ...finding })),
    persistentStateUnchanged: true,
  }
})
const completeBatchAuditEvidence = {
  probeExecuted: true,
  totalBatches: 5,
  completedBatches: 5,
  planId: batchAuditPlanId,
  manuscriptFingerprint: batchAuditFingerprint,
  planBatchIds: [...batchAuditIds],
  unverifiedAdvancesBlocked: 5,
  prematureSynthesisBlocked: 5,
  prematureSynthesisProbes: completeBatchAuditSynthesisProbes,
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
  const state = batchIndex === 0 ? "pending" : "running"
  return {
    ...crossProcessCheckpointAtTwo,
    completedBatches: batchIndex,
    completedCharacters,
    coveragePercent: Math.round((completedCharacters / 595) * 10000) / 100,
    state,
    nextBatchIndex: batchIndex,
    nextBatchId: batchAuditIds[batchIndex],
  }
}
const crossProcessStoredCheckpointAt = (batchIndex: number) =>
  storedCheckpointEvidence(crossProcessCheckpointAt(batchIndex))
const completeCrossProcessUnauditedAdvanceProbes = [2, 3, 4].map((batchIndex, probeIndex) => {
  const checkpoint = crossProcessStoredCheckpointAt(batchIndex)
  const priorBatchIds = batchAuditIds.slice(0, batchIndex)
  const inventoryDigest = ["7", "9", "0"][probeIndex].repeat(64)
  return {
    batchIndex,
    batchId: batchAuditIds[batchIndex],
    toolRuntimeIsError: false,
    toolResultValue: [
      "context checkpoint error",
      "code=missing_batch_audit",
      `message=cannot advance checkpoint: audit confirmation missing for batch ${batchAuditIds[batchIndex]}`,
    ].join("\n"),
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
const completePhaseOneSynthesisProbes = [0, 1, 2].map((batchIndex) => {
  const receiptCount = Math.min(batchIndex + 1, 2)
  const findings = batchIndex === 0 ? [] : [{ ...completeFindingProjection }]
  const persistence = { ...crossProcessPersistenceHashes }
  const inventoryDigest = ["4", "5", "6"][batchIndex]!.repeat(64)
  const checkpoint = crossProcessStoredCheckpointAt(batchIndex)
  const state = batchIndex === 0 ? "pending" : "running"
  return {
    batchIndex,
    batchId: batchAuditIds[batchIndex],
    toolRuntimeIsError: false,
    toolResultValue: incompleteCoverageValue(state),
    toolMessage: incompleteCoverageValue(state),
    errorCode: "incomplete_coverage",
    errorMessage: incompleteCoverageMessage(state),
    rejectionObserved: true,
    checkpointBefore: { ...checkpoint },
    checkpointAfter: { ...checkpoint },
    persistenceBefore: { ...persistence },
    persistenceAfter: { ...persistence },
    workspaceInventoryBeforeSha256: inventoryDigest,
    workspaceInventoryAfterSha256: inventoryDigest,
    persistedReceiptCountBefore: receiptCount,
    persistedReceiptCountAfter: receiptCount,
    persistedBatchIdsBefore: batchAuditIds.slice(0, receiptCount),
    persistedBatchIdsAfter: batchAuditIds.slice(0, receiptCount),
    findingCountBefore: findings.length,
    findingCountAfter: findings.length,
    findingsBefore: findings.map((finding) => ({ ...finding })),
    findingsAfter: findings.map((finding) => ({ ...finding })),
    persistentStateUnchanged: true,
  }
})
const completePhaseTwoSynthesisProbes = [2, 3, 4].map((batchIndex, probeIndex) => {
  const priorAdvanceProbe = completeCrossProcessUnauditedAdvanceProbes[probeIndex]!
  return {
    batchIndex,
    batchId: batchAuditIds[batchIndex],
    toolRuntimeIsError: false,
    toolResultValue: incompleteCoverageValue("running"),
    toolMessage: incompleteCoverageValue("running"),
    errorCode: "incomplete_coverage",
    errorMessage: incompleteCoverageMessage("running"),
    rejectionObserved: true,
    checkpointBefore: { ...priorAdvanceProbe.checkpointAfter },
    checkpointAfter: { ...priorAdvanceProbe.checkpointAfter },
    persistenceBefore: { ...priorAdvanceProbe.persistenceAfter },
    persistenceAfter: { ...priorAdvanceProbe.persistenceAfter },
    workspaceInventoryBeforeSha256: priorAdvanceProbe.workspaceInventoryAfterSha256,
    workspaceInventoryAfterSha256: priorAdvanceProbe.workspaceInventoryAfterSha256,
    persistedReceiptCountBefore: priorAdvanceProbe.persistedReceiptCountAfter,
    persistedReceiptCountAfter: priorAdvanceProbe.persistedReceiptCountAfter,
    persistedBatchIdsBefore: [...priorAdvanceProbe.persistedBatchIdsAfter],
    persistedBatchIdsAfter: [...priorAdvanceProbe.persistedBatchIdsAfter],
    findingCountBefore: priorAdvanceProbe.findingCountAfter,
    findingCountAfter: priorAdvanceProbe.findingCountAfter,
    findingsBefore: priorAdvanceProbe.findingsAfter.map((finding) => ({ ...finding })),
    findingsAfter: priorAdvanceProbe.findingsAfter.map((finding) => ({ ...finding })),
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
    prematureSynthesisProbes: completePhaseOneSynthesisProbes,
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
    workspaceInventoryAfterResumeQuerySha256: "7".repeat(64),
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
    prematureSynthesisBlocked: true,
    prematureSynthesisProbes: completePhaseTwoSynthesisProbes,
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

const driftJsonHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
function sourceDriftFixture(): any {
  const phaseOne: any = structuredClone(completeCrossProcessBatchAuditEvidence.phaseOne)
  const manuscriptHashes = Object.fromEntries(["main.tex", "referencias.bib", ...[1, 2, 3, 4, 5].map(n => `capitulos/lote${n}.tex`)].map(path => [path, "6".repeat(64)]))
  const inventoryBefore = {
    ...manuscriptHashes,
    [`.banca/analysis/checkpoints/${phaseOne.planId}.json`]: phaseOne.persistence.checkpointSha256,
    [`.banca/analysis/audit-confirmations/${phaseOne.planId}.json`]: phaseOne.persistence.auditConfirmationsSha256,
    [`.banca/analysis/findings/${phaseOne.planId}.json`]: phaseOne.persistence.findingsSha256,
    ".banca/context/context-100.md": "5".repeat(64),
  }
  phaseOne.manuscriptHashes = manuscriptHashes
  phaseOne.workspaceInventorySha256 = driftJsonHash(inventoryBefore)
  phaseOne.persistence.analysisInventorySha256 = driftJsonHash(Object.fromEntries(Object.entries(inventoryBefore).filter(([path]) => path.startsWith(".banca/analysis/"))))
  const inventoryAfter = { ...inventoryBefore, "capitulos/lote2.tex": "7".repeat(64) }
  const canonicalAfter = { planId: "2".repeat(64), manuscriptFingerprint: "3".repeat(64), totalBatches: 5, totalCharacters: 595, firstBatchId: `ordered-source-spans-exhaustive-v1:${"3".repeat(64)}:120:0` }
  const inventoryFinal = { ...inventoryAfter, [`.banca/analysis/checkpoints/${canonicalAfter.planId}.json`]: "4".repeat(64), ".banca/context/context-101.md": "8".repeat(64) }
  const checkpoint = { planId: canonicalAfter.planId, manuscriptFingerprint: canonicalAfter.manuscriptFingerprint, totalBatches: 5, completedBatches: 0, totalCharacters: 595, completedCharacters: 0, coveragePercent: 0, state: "pending", nextBatchId: canonicalAfter.firstBatchId, nextBatchIndex: 0 }
  const storedCheckpoint = storedCheckpointEvidence(checkpoint)
  const checkpointBytes = JSON.stringify(Object.fromEntries(["version", "planId", "fingerprint", "strategy", "totalBatches", "completedBatches", "totalCharacters", "completedCharacters", "coveragePercent", "state"].map(key => [key, (storedCheckpoint as any)[key]])), null, 2)
  inventoryFinal[`.banca/analysis/checkpoints/${canonicalAfter.planId}.json`] = createHash("sha256").update(checkpointBytes).digest("hex")
  const oldBatch = phaseOne.completedBatchIds[1]
  const refusalInputs = [
    { manuscriptFingerprint: null, batchId: oldBatch, findingId: null, findingsCount: 0 },
    { manuscriptFingerprint: phaseOne.manuscriptFingerprint, batchId: oldBatch, findingId: phaseOne.finding.findingId, findingsCount: 1 },
    { manuscriptFingerprint: canonicalAfter.manuscriptFingerprint, batchId: oldBatch, findingId: phaseOne.finding.findingId, findingsCount: 1 },
    { manuscriptFingerprint: null, batchId: null, findingId: null, findingsCount: 0 },
  ]
  const refusals = [
    ["stale-advance", "banca_context", "unknown_batch", "context checkpoint error", `batchId is not part of the plan: ${oldBatch}`],
    ["stale-fingerprint", "banca_auditar", "fingerprint_mismatch", "audit validation error", "manuscriptFingerprint does not match the current plan fingerprint"],
    ["stale-batch", "banca_auditar", "unknown_batch", "audit validation error", `batchId is not present in the plan: ${oldBatch}`],
    ["premature-synthesis", "banca_sintese", "missing_findings", "synthesis input error", "no persisted findings store exists for the current plan"],
  ].map(([kind, toolName, errorCode, header, message], index) => ({ kind, toolName, errorCode, input: refusalInputs[index], toolRuntimeIsError: false, toolResultValue: `${header}\ncode=${errorCode}\nmessage=${message}`, toolMessage: `${header}\ncode=${errorCode}\nmessage=${message}`, inventoryBeforeSha256: driftJsonHash(inventoryFinal), inventoryAfterSha256: driftJsonHash(inventoryFinal) }))
  return {
    probeExecuted: true, executionMode: "source-drift-native-dsh", syntheticProcessFixture: false,
    phaseOne, processBoundary: structuredClone(completeCrossProcessBatchAuditEvidence.processBoundary),
    workspace: { identitySha256: phaseOne.workspaceIdentitySha256, firstProcessEndFilesystemIdentitySha256: phaseOne.workspaceIdentitySha256, secondProcessStartFilesystemIdentitySha256: phaseOne.workspaceIdentitySha256, secondProcessEndFilesystemIdentitySha256: phaseOne.workspaceIdentitySha256 },
    canonicalBefore: { planId: phaseOne.planId, manuscriptFingerprint: phaseOne.manuscriptFingerprint, totalBatches: 5, totalCharacters: 595 }, canonicalAfter,
    mutation: { file: "capitulos/lote2.tex", utf16LengthBefore: 120, utf16LengthAfter: 120, sha256Before: inventoryBefore["capitulos/lote2.tex"], sha256After: inventoryAfter["capitulos/lote2.tex"], afterFirstExit: true, inventoryBefore, inventoryAfter },
    parentFinalInventory: inventoryFinal,
    phaseTwo: { probeExecuted: true, workspaceIdentitySha256: phaseOne.workspaceIdentitySha256, planId: canonicalAfter.planId, manuscriptFingerprint: canonicalAfter.manuscriptFingerprint, checkpoint, storedCheckpoint: storedCheckpointEvidence(checkpoint), findingsStore: null, auditStore: null, inventoryBeforeContext: inventoryAfter, inventoryAfterContext: inventoryFinal, inventoryFinal, oldFindingBefore: structuredClone(phaseOne.finding), oldFindingAfter: structuredClone(phaseOne.finding), oldReceiptIdsBefore: [...phaseOne.completedBatchIds], oldReceiptIdsAfter: [...phaseOne.completedBatchIds], refusals, agentIdentity: crossProcessAuditorIdentity("9".repeat(64)), teardown: { ...crossProcessTeardown }, modelCalls: 0, credentialsUsed: false },
  }
}

const sourceDriftContract = profileEvidenceContract as unknown as { validateSourceDriftEvidence(value: unknown): string[]; classifySourceDriftEvidenceStatus(value: unknown): string }
describe("DSH source drift restart contract (#105)", () => {
  test("exports strict validator and classifies unexecuted gates as BLOCKED", () => {
    expect(typeof sourceDriftContract.validateSourceDriftEvidence).toBe("function")
    for (const value of [undefined, null, {}, { probeExecuted: undefined }]) expect(sourceDriftContract.classifySourceDriftEvidenceStatus(value)).toBe("BLOCKED")
    for (const probeExecuted of [true, false, null, "true", 1]) expect(sourceDriftContract.classifySourceDriftEvidenceStatus({ probeExecuted })).toBe("FAIL")
    const tampered = sourceDriftFixture()
    delete tampered.probeExecuted
    expect(sourceDriftContract.classifySourceDriftEvidenceStatus(tampered)).toBe("BLOCKED")
  })
  test("accepts fresh pending context without finding or audit stores", () => {
    expect(sourceDriftContract.validateSourceDriftEvidence(sourceDriftFixture())).toEqual([])
    expect(sourceDriftContract.classifySourceDriftEvidenceStatus(sourceDriftFixture())).toBe("PASS")
  })
  test("sanitized report hides native identifiers, secrets and local paths without relaxing raw validation", () => {
    const evidence = sourceDriftFixture()
    const syntheticToken = ["sk", "12345678901234567890"].join("-")
    evidence.diagnostic = { agentId: "agent-raw-native-identifier", token: syntheticToken, file: "/private/workspace/main.tex" }
    const safe = profileEvidenceContract.sanitizeReport(evidence) as any
    const serialized = JSON.stringify(safe)
    for (const secret of ["agent-raw-native-identifier", syntheticToken, "/private/workspace/main.tex"]) expect(serialized).not.toContain(secret)
    for (const phase of ["phaseOne", "phaseTwo"]) {
      expect(safe[phase].agentIdentity.agentId).toBe("<redacted-native-id>")
      expect(safe[phase].agentIdentity.sessionId).toBe("<redacted-native-id>")
    }
    expect(safe.phaseTwo.refusals[3].errorCode).toBe("missing_findings")
    // Existing report sanitation flattens exact domain strings and redacts IDs;
    // strict native evidence is validated in memory before that boundary.
    expect(sourceDriftContract.validateSourceDriftEvidence(safe).length).toBeGreaterThan(0)
  })
  test("new persisted checkpoint bytes must bind its pending projection", () => {
    const evidence = sourceDriftFixture()
    const path = `.banca/analysis/checkpoints/${evidence.canonicalAfter.planId}.json`
    evidence.phaseTwo.inventoryAfterContext[path] = "0".repeat(64)
    for (const refusal of evidence.phaseTwo.refusals) {
      refusal.inventoryBeforeSha256 = driftJsonHash(evidence.phaseTwo.inventoryAfterContext)
      refusal.inventoryAfterSha256 = refusal.inventoryBeforeSha256
    }
    expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
  })
  test("analysis inventory aggregate must bind the historical inventory", () => {
    const evidence = sourceDriftFixture()
    evidence.phaseOne.persistence.analysisInventorySha256 = "0".repeat(64)
    expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
  })
  const mutations: Array<[string, (e: any) => void]> = [
    ["synthetic process", e => { e.syntheticProcessFixture = true }],
    ["missing phase two", e => { delete e.phaseTwo }],
    ["missing teardown", e => { delete e.phaseTwo.teardown }],
    ["unspecified teardown failure", e => { delete e.phaseTwo.teardown.teardownFailed }],
    ["reused agent", e => { e.phaseTwo.agentIdentity = e.phaseOne.agentIdentity }],
    ["overlap", e => { e.processBoundary.processesDidNotOverlap = false }],
    ["forced exit", e => { e.processBoundary.first.forcedTermination = true }],
    ["no natural exit", e => { delete e.processBoundary.second.naturalBeforeExitObserved }],
    ["new workspace", e => { e.workspace.secondProcessStartFilesystemIdentitySha256 = "0".repeat(64) }],
    ["same fingerprint", e => { e.canonicalAfter.manuscriptFingerprint = e.canonicalBefore.manuscriptFingerprint }],
    ["same plan", e => { e.canonicalAfter.planId = e.canonicalBefore.planId }],
    ["wrong first batch", e => { e.canonicalAfter.firstBatchId = "old-batch" }],
    ["changed length", e => { e.mutation.utf16LengthAfter++ }],
    ["mutation before exit", e => { e.mutation.afterFirstExit = false }],
    ["no changed bytes", e => { e.mutation.sha256After = e.mutation.sha256Before }],
    ["missing map", e => { delete e.mutation.inventoryBefore }],
    ["unsafe inventory path", e => { e.mutation.inventoryBefore["../escape"] = "0".repeat(64) }],
    ["invalid inventory digest", e => { e.mutation.inventoryBefore["main.tex"] = "invalid" }],
    ["unbound manuscript", e => { e.phaseOne.manuscriptHashes["main.tex"] = "0".repeat(64) }],
    ["missing manuscript", e => { delete e.phaseOne.manuscriptHashes["main.tex"] }],
    ["historical checkpoint hash", e => { e.mutation.inventoryBefore[`.banca/analysis/checkpoints/${e.phaseOne.planId}.json`] = "0".repeat(64) }],
    ["historical finding missing", e => { delete e.phaseTwo.inventoryFinal[`.banca/analysis/findings/${e.phaseOne.planId}.json`] }],
    ["extra mutation", e => { e.mutation.inventoryAfter["main.tex"] = "0".repeat(64) }],
    ["added mutation file", e => { e.mutation.inventoryAfter["extra"] = "0".repeat(64) }],
    ["extra context addition", e => { e.phaseTwo.inventoryAfterContext[".banca/context/context-102.md"] = "0".repeat(64) }],
    ["replaced old context", e => { e.phaseTwo.inventoryAfterContext[".banca/context/context-100.md"] = "0".repeat(64) }],
    ["missing pending checkpoint", e => { delete e.phaseTwo.inventoryAfterContext[`.banca/analysis/checkpoints/${e.canonicalAfter.planId}.json`] }],
    ["new findings file", e => { e.phaseTwo.inventoryFinal[`.banca/analysis/findings/${e.canonicalAfter.planId}.json`] = "0".repeat(64) }],
    ["non-null audit store", e => { e.phaseTwo.auditStore = {} }],
    ["non-null finding store", e => { e.phaseTwo.findingsStore = {} }],
    ["old finding changed", e => { e.phaseTwo.oldFindingAfter.claimSha256 = "0".repeat(64) }],
    ["old receipts changed", e => { e.phaseTwo.oldReceiptIdsAfter.reverse() }],
    ["checkpoint coverage", e => { e.phaseTwo.checkpoint.completedBatches = 2 }],
    ["checkpoint extra field", e => { e.phaseTwo.checkpoint.extra = true }],
    ["stored checkpoint metadata", e => { e.phaseTwo.storedCheckpoint.fingerprint = "0".repeat(64) }],
    ["missing refusal", e => { e.phaseTwo.refusals.pop() }],
    ["reordered refusals", e => { e.phaseTwo.refusals.reverse() }],
    ["ToolRuntime error", e => { e.phaseTwo.refusals[0].toolRuntimeIsError = true }],
    ["wrong domain code", e => { e.phaseTwo.refusals[3].errorCode = "incomplete_coverage" }],
    ["false refusal string", e => { e.phaseTwo.refusals[1].toolResultValue = "fingerprint_mismatch" }],
    ["message mismatch", e => { e.phaseTwo.refusals[2].toolMessage = "unknown_batch" }],
    ["refusal mutation", e => { e.phaseTwo.refusals[3].inventoryAfterSha256 = "0".repeat(64) }],
    ["model call", e => { e.phaseTwo.modelCalls = 1 }],
    ["credentials", e => { e.phaseTwo.credentialsUsed = true }],
  ]
  test.each(mutations)("rejects %s", (_label, mutate) => {
    const evidence = sourceDriftFixture()
    mutate(evidence)
    expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
    expect(sourceDriftContract.classifySourceDriftEvidenceStatus(evidence)).toBe("FAIL")
  })
  test("refusals bind exact replay inputs rather than just returned strings", () => {
    for (let index = 0; index < 4; index++) {
      const evidence = sourceDriftFixture()
      evidence.phaseTwo.refusals[index].input = { manuscriptFingerprint: "0".repeat(64), batchId: "fake", findingId: null, findingsCount: 0 }
      expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
    }
  })
  test("required root and nested proof fields cannot be omitted", () => {
    for (const parent of ["", "mutation", "canonicalBefore", "canonicalAfter", "workspace", "processBoundary", "processBoundary.first", "processBoundary.second", "phaseTwo.agentIdentity", "phaseTwo.teardown", "phaseTwo.checkpoint", "phaseTwo.storedCheckpoint"]) {
      const source = parent.split(".").filter(Boolean).reduce((node, key) => node[key], sourceDriftFixture())
      for (const key of Object.keys(source)) {
        const evidence = sourceDriftFixture()
        const target = parent.split(".").filter(Boolean).reduce((node, segment) => node[segment], evidence)
        delete target[key]
        expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
      }
    }
    for (let index = 0; index < 4; index++) {
      for (const key of Object.keys(sourceDriftFixture().phaseTwo.refusals[index])) {
        const evidence = sourceDriftFixture()
        delete evidence.phaseTwo.refusals[index][key]
        expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
      }
      for (const key of Object.keys(sourceDriftFixture().phaseTwo.refusals[index].input)) {
        const evidence = sourceDriftFixture()
        delete evidence.phaseTwo.refusals[index].input[key]
        expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
      }
    }
  })
  test("every required phase-two field is fail-closed on omission", () => {
    for (const key of Object.keys(sourceDriftFixture().phaseTwo)) {
      const evidence = sourceDriftFixture()
      delete evidence.phaseTwo[key]
      expect(sourceDriftContract.validateSourceDriftEvidence(evidence).length).toBeGreaterThan(0)
    }
  })
})

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

  test.each([
    ["ToolRuntime dispatch error", { toolRuntimeIsError: true }],
    ["successful JSON synthesis", { toolResultValue: JSON.stringify({ coverage: { state: "complete" } }), errorCode: null }],
    ["wrong domain code", { toolResultValue: incompleteCoverageValue("pending").replace("incomplete_coverage", "missing_findings"), errorCode: "missing_findings" }],
    ["wrong checkpoint message", { toolResultValue: incompleteCoverageValue("pending").replace('received "pending"', 'received "running"'), errorMessage: incompleteCoverageMessage("running") }],
    ["checkpoint changed during refusal", { checkpointAfter: { ...crossProcessCheckpointAt(0), completedBatches: 1 } }],
    ["persisted store changed during refusal", { persistenceAfter: { ...crossProcessPersistenceHashes, findingsSha256: "0".repeat(64) } }],
    ["workspace changed during refusal", { workspaceInventoryAfterSha256: "0".repeat(64) }],
  ])("phase-one premature synthesis rejects %s", (_label, probePatch) => {
    const phaseOne = {
      ...completeCrossProcessBatchAuditEvidence.phaseOne,
      prematureSynthesisProbes: completePhaseOneSynthesisProbes.map((probe, index) => index === 0 ? {
        ...probe,
        ...probePatch,
        rejectionObserved: false,
      } : probe),
    }
    expect(profileEvidenceContract.validateCrossProcessPhaseOneEvidence(phaseOne)).toContain(
      "phase one must observe exact incomplete_coverage domain refusals without persistent-state mutation",
    )
  })

  test.each([
    ["running at 0/5", 0, "running"],
    ["pending after 0/5", 1, "pending"],
  ])("phase one rejects %s despite a matching refusal message", (_label, probeIndex, wrongState) => {
    const phaseOne = {
      ...completeCrossProcessBatchAuditEvidence.phaseOne,
      prematureSynthesisProbes: completePhaseOneSynthesisProbes.map((probe, index) => index === probeIndex ? {
        ...probe,
        toolResultValue: incompleteCoverageValue(wrongState),
        toolMessage: incompleteCoverageValue(wrongState),
        errorMessage: incompleteCoverageMessage(wrongState),
        checkpointBefore: { ...probe.checkpointBefore, state: wrongState },
        checkpointAfter: { ...probe.checkpointAfter, state: wrongState },
      } : probe),
    }
    expect(profileEvidenceContract.validateCrossProcessPhaseOneEvidence(phaseOne)).toContain(
      "phase one must observe exact incomplete_coverage domain refusals without persistent-state mutation",
    )
  })

  test.each([
    ["ToolRuntime error is not a domain refusal", { toolRuntimeIsError: true }],
    ["successful output releases synthesis", { toolResultValue: JSON.stringify({ coverage: { state: "complete" } }), errorCode: null }],
    ["persisted checkpoint mutates", { checkpointAfter: { ...crossProcessCheckpointAt(2), completedBatches: 3 } }],
    ["persisted checkpoint metadata mutates", { checkpointAfter: { ...crossProcessCheckpointAt(2), fingerprint: "wrong-fingerprint" } }],
    ["receipts mutate", { persistedBatchIdsAfter: [batchAuditIds[0]] }],
    ["findings mutate", { findingsAfter: [] }],
    ["workspace mutates", { workspaceInventoryAfterSha256: "0".repeat(64) }],
  ])("phase-two premature synthesis rejects %s", (_label, probePatch) => {
    const phaseTwo = {
      ...completeCrossProcessBatchAuditEvidence.phaseTwo,
      prematureSynthesisProbes: completePhaseTwoSynthesisProbes.map((probe, index) => index === 0 ? {
        ...probe,
        ...probePatch,
        rejectionObserved: false,
      } : probe),
    }
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence({
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo,
    })).toContain("second process must observe exact incomplete_coverage domain refusals without persistent-state mutation")
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

  test("accepts the observer's full persisted checkpoint snapshots for resumed batches 3-5", () => {
    for (const probe of completeCrossProcessBatchAuditEvidence.phaseTwo.unverifiedAdvanceProbes) {
      expect(Object.keys(probe.checkpointBefore)).toEqual([
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
      ])
    }
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence(completeCrossProcessBatchAuditEvidence)).toEqual([])
  })

  test("resume checkpoint snapshots compare structurally despite different property insertion order", () => {
    const checkpoint = crossProcessCheckpointAtTwo
    const checkpointBefore = Object.fromEntries(Object.entries(checkpoint).reverse())
    const checkpointAfterEntries = Object.entries(checkpoint).filter(([key]) => key !== "nextBatchIndex" && key !== "nextBatchId")
    const checkpointAfter = Object.fromEntries([
      ...checkpointAfterEntries,
      ["nextBatchId", checkpoint.nextBatchId],
      ["nextBatchIndex", checkpoint.nextBatchIndex],
    ])
    expect(JSON.stringify(checkpointBefore)).not.toBe(JSON.stringify(checkpointAfter))
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence({
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          checkpointBefore,
          checkpointAfter,
        },
      },
    })).toEqual([])
  })

  test("refusal checkpoint projections remain equivalent across reordered fields", () => {
    const phaseTwo = completeCrossProcessBatchAuditEvidence.phaseTwo
    const reorder = (checkpoint: Record<string, unknown>, reverse: boolean) => {
      if (reverse) return Object.fromEntries(Object.entries(checkpoint).reverse())
      const otherEntries = Object.entries(checkpoint).filter(([key]) => key !== "nextBatchIndex" && key !== "nextBatchId")
      return Object.fromEntries([
        ...otherEntries,
        ["nextBatchId", checkpoint.nextBatchId],
        ["nextBatchIndex", checkpoint.nextBatchIndex],
      ])
    }
    const unverifiedAdvanceProbes = phaseTwo.unverifiedAdvanceProbes.map((probe, index) => index === 0
      ? { ...probe, checkpointBefore: reorder(probe.checkpointBefore, true), checkpointAfter: reorder(probe.checkpointAfter, false) }
      : probe)
    const prematureSynthesisProbes = phaseTwo.prematureSynthesisProbes.map((probe, index) => index === 0
      ? {
        ...probe,
        checkpointBefore: reorder({ ...probe.checkpointBefore, fingerprint: batchAuditFingerprint }, true),
        checkpointAfter: reorder({ ...probe.checkpointAfter, fingerprint: batchAuditFingerprint }, false),
      }
      : probe)
    expect(profileEvidenceContract.validateCrossProcessBatchAuditEvidence({
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: { ...phaseTwo, unverifiedAdvanceProbes, prematureSynthesisProbes },
    })).toEqual([])
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
    }, "second process must observe the exact missing_batch_audit application refusal in a successful ToolRuntime value for unaudited batch 3"],
    ["incomplete probe list", { unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.slice(0, 2) }, "second process must reject unaudited advancement for all three remaining batches before auditing"],
    ["wrong rejection code", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? { ...probe, errorCode: "unexpected" } : probe),
    }, "second process must observe the exact missing_batch_audit application refusal in a successful ToolRuntime value for unaudited batch 3"],
    ["native ToolRuntime error is confused with the returned domain refusal", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? { ...probe, toolRuntimeIsError: true } : probe),
    }, "second process must observe the exact missing_batch_audit application refusal in a successful ToolRuntime value for unaudited batch 3"],
    ["successful output only contains a confusable code line", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        toolResultValue: ["successful context", "code=missing_batch_audit", "more context"].join(String.fromCharCode(10)),
      } : probe),
    }, "second process must observe the exact missing_batch_audit application refusal in a successful ToolRuntime value for unaudited batch 3"],
    ["domain error names a different batch", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        toolResultValue: completeCrossProcessUnauditedAdvanceProbes[1].toolResultValue,
      } : probe),
    }, "second process must observe the exact missing_batch_audit application refusal in a successful ToolRuntime value for unaudited batch 3"],
    ["missing post-query workspace baseline", { workspaceInventoryAfterResumeQuerySha256: undefined }, "second-process post-query workspace inventory must be captured before unaudited-advance probes"],
    ["changed first-probe workspace baseline", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        workspaceInventoryBeforeSha256: "8".repeat(64),
        workspaceInventoryAfterSha256: "8".repeat(64),
      } : probe),
    }, "first unaudited-advance probe must start from the captured post-resume workspace inventory"],
    ["changed checkpoint", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? { ...probe, checkpointAfter: { ...probe.checkpointAfter, completedBatches: 3 } } : probe),
    }, "unaudited advance probe for batch 3 must preserve the current ordered checkpoint"],
    ["changed persisted checkpoint version", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        checkpointBefore: { ...probe.checkpointBefore, version: "analysis-checkpoint-v1" },
        checkpointAfter: { ...probe.checkpointAfter, version: "analysis-checkpoint-v1" },
      } : probe),
    }, "unaudited advance probe for batch 3 must preserve the current ordered checkpoint"],
    ["changed persisted checkpoint fingerprint", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        checkpointBefore: { ...probe.checkpointBefore, fingerprint: "wrong-fingerprint" },
        checkpointAfter: { ...probe.checkpointAfter, fingerprint: "wrong-fingerprint" },
      } : probe),
    }, "unaudited advance probe for batch 3 must preserve the current ordered checkpoint"],
    ["changed persisted checkpoint strategy", {
      unverifiedAdvanceProbes: completeCrossProcessUnauditedAdvanceProbes.map((probe, index) => index === 0 ? {
        ...probe,
        checkpointBefore: { ...probe.checkpointBefore, strategy: "unexpected-strategy" },
        checkpointAfter: { ...probe.checkpointAfter, strategy: "unexpected-strategy" },
      } : probe),
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
        workspaceInventoryAfterSha256: "5".repeat(64),
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
    ["resume query changed checkpoint state", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          checkpointAfter: { ...crossProcessCheckpointAtTwo, state: "pending" },
        },
      },
    }, "resume-only banca_context query must leave checkpoint and next batch unchanged"],
    ["resume query changed checkpoint coverage", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          checkpointAfter: { ...crossProcessCheckpointAtTwo, completedCharacters: 241, coveragePercent: 40.5 },
        },
      },
    }, "resume-only banca_context query must leave checkpoint and next batch unchanged"],
    ["resume query changed only checkpoint coverage", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          checkpointAfter: { ...crossProcessCheckpointAtTwo, coveragePercent: 40.35 },
        },
      },
    }, "resume-only banca_context query must leave checkpoint and next batch unchanged"],
    ["resume query added an unknown checkpoint field", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          checkpointAfter: { ...crossProcessCheckpointAtTwo, unrecognizedField: true },
        },
      },
    }, "resume-only banca_context query must leave checkpoint and next batch unchanged"],
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
    ["resume query recovered incompatible receipt IDs", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          persistedBatchIds: [batchAuditIds[0], "wrong-receipt-id"],
        },
      },
    }, "second process must recover the first two persisted audit receipts before advancing"],
    ["resume query recovered an incompatible finding", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        resumeQuery: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.resumeQuery,
          recoveredFinding: { ...completeFindingProjection, findingId: "b".repeat(64) },
        },
      },
    }, "first-process finding identity and provenance must be unchanged after restart and in synthesis"],
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
    ["checkpoint claims complete before 5/5", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        finalCheckpoint: {
          ...completeCrossProcessBatchAuditEvidence.phaseTwo.finalCheckpoint,
          completedBatches: 4,
          completedCharacters: 480,
          coveragePercent: 80.67,
          state: "complete",
          nextBatchIndex: 4,
          nextBatchId: batchAuditIds[4],
        },
      },
    }, "second process must finish the same plan at exactly 5/5 complete coverage"],
    ["checkpoint is not complete at 5/5", {
      ...completeCrossProcessBatchAuditEvidence,
      phaseTwo: {
        ...completeCrossProcessBatchAuditEvidence.phaseTwo,
        finalCheckpoint: { ...completeCrossProcessBatchAuditEvidence.phaseTwo.finalCheckpoint, state: "running" },
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
      "exact synthesis probes are missing",
      { ...completeBatchAuditEvidence, prematureSynthesisProbes: [] },
      "each incomplete batch must record an exact synthesis refusal",
    ],
    [
      "synthesis dispatch error is mistaken for domain refusal",
      {
        ...completeBatchAuditEvidence,
        prematureSynthesisProbes: completeBatchAuditSynthesisProbes.map((probe, index) => index === 0
          ? { ...probe, toolRuntimeIsError: true }
          : probe),
      },
      "incomplete batch 0 must return the exact incomplete_coverage ToolRuntime value without mutation",
    ],
    [
      "synthesis returns successful output instead of refusal",
      {
        ...completeBatchAuditEvidence,
        prematureSynthesisProbes: completeBatchAuditSynthesisProbes.map((probe, index) => index === 0
          ? { ...probe, toolResultValue: JSON.stringify({ coverage: { state: "complete" } }), toolMessage: JSON.stringify({ coverage: { state: "complete" } }) }
          : probe),
      },
      "incomplete batch 0 must return the exact incomplete_coverage ToolRuntime value without mutation",
    ],
    [
      "synthesis refusal mutates durable state",
      {
        ...completeBatchAuditEvidence,
        prematureSynthesisProbes: completeBatchAuditSynthesisProbes.map((probe, index) => index === 0
          ? { ...probe, persistenceAfter: { ...probe.persistenceAfter, findingsSha256: "e".repeat(64) }, persistentStateUnchanged: false }
          : probe),
      },
      "incomplete batch 0 must return the exact incomplete_coverage ToolRuntime value without mutation",
    ],
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

describe("DSH E2E diagnostic redaction", () => {
  test("runtime version outputs are allowlisted before report or terminal use", () => {
    const safeRuntimeVersion = Reflect.get(profileEvidenceContract, "safeRuntimeVersion") as (value: unknown) => string | null
    expect(safeRuntimeVersion("v26.7.0")).toBe("v26.7.0")
    expect(safeRuntimeVersion("1.4.2")).toBe("1.4.2")
    expect(safeRuntimeVersion("9.15.9")).toBe("9.15.9")
    expect(safeRuntimeVersion("/private-root/token=arbitrary-output")).toBeNull()
    expect(safeRuntimeVersion("v26.7.0 arbitrary output")).toBeNull()
    expect(safeRuntimeVersion("api-secret123456789012")).toBeNull()
  })

  test.each([["PASS"], ["FAIL"], ["BLOCKED"]])("preserves the complete canonical report shape in %s reports", (status) => {
    const sanitizeReport = Reflect.get(profileEvidenceContract, "sanitizeReport") as (report: unknown) => unknown
    const composedProfile = {
      exitCode: status === "PASS" ? 0 : status === "FAIL" ? 1 : null,
      stdoutBytes: 512,
      stderrBytes: status === "FAIL" ? 24 : 0,
      outputTruncated: false,
      containsDshbancaEntry: true,
      containsObserverEntry: true,
      containsPresetRegistryEntry: true,
      containsAuditorPresetEntry: true,
      containsControlPresetEntry: true,
      containsUserQuestionsEntry: true,
      containsUserApprovalEntry: true,
      containsAskUserToolEntry: true,
      userQuestionsCount: 1,
      userApprovalCount: 1,
      askUserToolCount: 1,
      userQuestionsUnique: true,
      userApprovalUnique: true,
      askUserToolPresent: true,
      askUserToolUnique: true,
      pluginInstancesUnique: true,
    }
    const versions = {
      dsh: "0.2.1-rc.5",
      cordis: "4.0.5",
      cordisPluginLoader: "1.0.6",
      dshSkill: "0.2.1-rc.5",
      dshAgent: "0.2.1-rc.5",
      dshAgentLoop: "0.2.1-rc.5",
      dshTools: "0.2.1-rc.5",
      dshAgentPreset: "0.2.1-rc.5",
      dshAgentPresetRegistry: "0.2.1-rc.5",
      dshAgentInstructions: "0.2.1-rc.5",
      dshApiSessionController: "0.2.1-rc.5",
      dshUserQuestions: "0.2.1-rc.5",
      dshUserApproval: "0.2.1-rc.5",
      dshToolAskUser: "0.2.1-rc.5",
      node: "v22.23.2",
      bun: "1.4.2",
      pnpm: "9.15.9",
    }
    const report = {
      schemaVersion: 1,
      status,
      startedAt: "2026-11-10T00:00:00.000Z",
      finishedAt: "2026-11-10T00:00:01.000Z",
      repository: { revision: "a".repeat(40), dirty: false },
      versions,
      sandbox: { isolated: true, removed: true },
      stages: { composedProfile },
      failures: status === "FAIL" ? ["/private-root/failure.log"] : [],
      limitations: ["synthetic evidence fixture; host E2E not run"],
    }
    const sanitized = JSON.parse(JSON.stringify(sanitizeReport(report)))
    expect(Object.keys(sanitized)).toEqual(Object.keys(report))
    expect(Object.keys(sanitized.repository)).toEqual(Object.keys(report.repository))
    expect(Object.keys(sanitized.versions)).toEqual(Object.keys(versions))
    expect(sanitized.versions).toEqual(versions)
    const safeVersions = (sanitizeReport({ versions }) as { versions: typeof versions }).versions
    expect(safeVersions).toEqual(versions)
    expect(Object.keys(sanitized.sandbox)).toEqual(Object.keys(report.sandbox))
    expect(Object.keys(sanitized.stages.composedProfile)).toEqual(Object.keys(composedProfile))
    expect(sanitized.stages.composedProfile).toEqual(composedProfile)
    expect(sanitized.failures).toEqual(status === "FAIL" ? ["<absolute-path>"] : [])
    expect(sanitized.status).toBe(status)
    expect(sanitized.schemaVersion).toBe(1)
  })

  test("canonical key exemptions still redact their untrusted values", () => {
    const sanitizeReport = Reflect.get(profileEvidenceContract, "sanitizeReport") as (report: unknown) => unknown
    const report = {
      versions: { dshApiSessionController: "api-secret123456789012" },
      stages: {
        composedProfile: {
          containsAskUserToolEntry: "session-abcdef123456",
          askUserToolCount: 1,
          askUserToolUnique: true,
          askUserToolPresent: true,
        },
      },
    }
    const sanitized = JSON.parse(JSON.stringify(sanitizeReport(report)))
    expect(Object.keys(sanitized.versions)).toEqual(["dshApiSessionController"])
    expect(sanitized.versions.dshApiSessionController).toBe("<redacted>")
    expect(Object.keys(sanitized.stages.composedProfile)).toEqual(Object.keys(report.stages.composedProfile))
    expect(sanitized.stages.composedProfile.containsAskUserToolEntry).toBe("<redacted-native-id>")
  })

  test("canonical key exemptions do not leak into array-contained dynamic maps", () => {
    const sanitizeReport = Reflect.get(profileEvidenceContract, "sanitizeReport") as (report: unknown) => unknown
    const report = {
      versions: [{ dshApiSessionController: "api-secret123456789012" }],
      stages: {
        composedProfile: [{ askUserToolCount: 1, askUserToolUnique: true }],
      },
    }
    const sanitized = JSON.parse(JSON.stringify(sanitizeReport(report)))
    expect(Object.keys(sanitized.versions[0])).toEqual(["dsh<redacted>"])
    expect(sanitized.versions[0]["dsh<redacted>"]).toBe("<redacted>")
    expect(Object.keys(sanitized.stages.composedProfile[0])).toEqual(["a<redacted>", "a<redacted>#1"])
    expect(Object.values(sanitized.stages.composedProfile[0])).toEqual([1, true])
  })

  test("sanitizes dynamic untrusted report keys without collisions or data loss", () => {
    const sanitizeReport = Reflect.get(profileEvidenceContract, "sanitizeReport") as (report: unknown) => unknown
    const dynamicMap = Object.fromEntries([
      ["/private-root/first", "first"],
      ["/private-root/second", "second"],
      ["api-secret123456789012", "third"],
      ["<redacted>", "fourth"],
      ["file:///private-root/uri", "fifth"],
      ["session-abcdef123456", "sixth"],
      ["<redacted-native-id>", "seventh"],
      ["askUserToolCount", "eighth"],
      ["askUserToolUnique", "ninth"],
      ["__proto__", "tenth"],
    ])
    const sanitized = JSON.parse(JSON.stringify(sanitizeReport({ status: "BLOCKED", stages: { dynamicMap } })))
    const entries = Object.entries(sanitized.stages.dynamicMap)
    expect(entries).toHaveLength(10)
    expect(new Set(entries.map(([key]) => key)).size).toBe(10)
    expect(entries.map(([, value]) => value)).toEqual(["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"])
    const dynamicJson = JSON.stringify(sanitized.stages.dynamicMap)
    expect(dynamicJson).not.toContain("private-root")
    expect(dynamicJson).not.toContain("api-secret")
    expect(dynamicJson).not.toContain("file:///")
    expect(dynamicJson).not.toContain("session-abcdef123456")
    expect(dynamicJson).not.toContain("askUserToolCount")
    expect(dynamicJson).not.toContain("askUserToolUnique")
  })

  test("command failures and nested reports retain status metadata without local paths, URIs, or native IDs", () => {
    const safeOutput = Reflect.get(profileEvidenceContract, "safeOutput") as (result: Record<string, unknown>) => string
    const formatCommandFailure = Reflect.get(profileEvidenceContract, "formatCommandFailure") as (
      stage: string,
      nature: string,
      result: Record<string, unknown>,
    ) => string
    const sanitizeReport = Reflect.get(profileEvidenceContract, "sanitizeReport") as (report: unknown) => unknown
    expect(typeof safeOutput).toBe("function")
    expect(typeof formatCommandFailure).toBe("function")
    expect(typeof sanitizeReport).toBe("function")

    const command = {
      exitCode: 2,
      signal: null,
      timedOut: false,
      spawnObserved: true,
      exitObserved: true,
      closeObserved: true,
      stdout: "/private-root/checkouts/dshbanca file:///private-root/scratch/observer native-agent-secret-123",
      stderr: 'sessionId=native-session-secret-456 local://workspace/private agentId=native-agent-secret-123',
    }
    const diagnostic = formatCommandFailure("phase-two synthesis", "incomplete coverage refusal failed", command)
    expect(diagnostic).toContain("phase-two synthesis")
    expect(diagnostic).toContain("incomplete coverage refusal failed")
    expect(diagnostic).toContain("exitCode=2")
    expect(diagnostic).not.toContain("private-root")
    expect(diagnostic).not.toContain("file://")
    expect(diagnostic).not.toContain("local://")
    expect(diagnostic).not.toContain("native-agent-secret")
    expect(diagnostic).not.toContain("native-session-secret")
    expect(safeOutput(command)).toBe(diagnostic.slice(diagnostic.indexOf("exitCode=")))
    const longDiagnostic = formatCommandFailure("report persistence", "observer output was withheld", {
      ...command,
      stdout: `${"x".repeat(20_000)} /private-root/trailing-native-session-secret-456`,
    })
    expect(longDiagnostic.length).toBeLessThan(500)
    expect(longDiagnostic).not.toContain("private-root")
    expect(longDiagnostic).not.toContain("native-session-secret")

    const hostileReport = {
      status: "BLOCKED",
      failures: [diagnostic],
      stages: {
        boot: { status: "FAIL", exitCode: 2, failureKind: "native_profile_boot_failed", diagnostic: "/private-root/checkouts/dshbanca/file:///private-root/logs/boot.log" },
        academicDecision: { evidence: { agentIdentity: { agentId: "native-agent-secret-123", sessionId: "native-session-secret-456" } } },
        nativeQuestions: { request: { requestId: "native-request-secret-789" }, event: { id: "550e8400-e29b-41d4-a716-446655440000" } },
        alternateIdentityKeys: {
          "session-id": "hyphen-session-secret-123",
          agent_id: "underscore-agent-secret-456",
          processId: "process-secret-789",
          process: { ids: ["opaque-process-array-secret"] },
          pid: "pid-secret-abc",
        },
        serializedIdentity: '{"session_id":"serialized-session-secret-234","pid":"serialized-pid-secret-def"}',
        platform: {
          windowsPath: "C:\\Users\\fake\\repo",
          uncPath: "\\\\fakehost\\share\\repo",
          uri: "file:///private-root/a%20b",
          localUris: ["file:/private-root/x", "file://localhost/C:/Users/fake/x", "local://workspace/path", "local:/workspace/path"],
          uriWithSpaces: "opening file:///private root/sensitive-uri-path; retry",
          pathWithSpaces: "/private root/checkouts/unique-X",
        },
      },
    }
    const sanitized = JSON.stringify(sanitizeReport(hostileReport))
    for (const secret of [
      "/private-root",
      "/private root",
      "unique-X",
      "sensitive-uri-path",
      "C:\\Users\\fake\\repo",
      "fakehost\\share",
      "file:",
      "local://",
      "native-agent-secret",
      "native-session-secret",
      "native-request-secret",
      "hyphen-session-secret",
      "underscore-agent-secret",
      "process-secret",
      "opaque-process-array-secret",
      "pid-secret",
      "serialized-session-secret",
      "serialized-pid-secret",
      "550e8400-e29b-41d4-a716-446655440000",
    ]) expect(sanitized).not.toContain(secret)
    expect(sanitized).toContain('"status":"BLOCKED"')
    expect(sanitized).toContain('"failureKind":"native_profile_boot_failed"')
    expect(sanitized).toContain('"exitCode":2')
    expect(sanitized).toContain("phase-two synthesis")
    expect(sanitized).toContain("incomplete coverage refusal failed")
  })

  test("runner sanitizes the complete report and withholds raw exception and child output", () => {
    const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
    const writeReportStart = runnerSource.indexOf("export function persistReportWithPlan(")
    const failFunctionStart = runnerSource.indexOf("function fail(message:", writeReportStart)
    const writeReportSource = runnerSource.slice(writeReportStart, failFunctionStart)
    expect(writeReportSource).toContain("sanitizeReport(value)")
    expect(writeReportSource).toContain("persistReportWithPlan(reportPersistencePlan, report)")
    expect(runnerSource).toContain("const nodeVersion = safeRuntimeVersion(await commandVersion(nodeExecutable")
    expect(runnerSource).toContain("const bunVersion = safeRuntimeVersion(await commandVersion(bunExecutable")
    expect(runnerSource).toContain("const reportedVersion = safeRuntimeVersion(pnpmCheck.stdout")
    expect(runnerSource).toContain("const safeVersions = (sanitizeReport({ versions: report.versions }) as { versions: GateReport[\"versions\"] }).versions")
    expect(runnerSource).not.toContain("sanitizeReport(report.versions)")
    expect(runnerSource).not.toContain("Node ${report.versions.node")
    expect(runnerSource).not.toContain('execution reported "${reportedVersion}"')
    expect(runnerSource).toContain('fail("Runner orchestration: unexpected exception; details withheld")')
    expect(runnerSource).toContain('report.failures.push("Report persistence failed; details withheld")')
    expect(runnerSource).toContain('formatCommandFailure("native DSH profile boot"')
    expect(runnerSource).toContain('const reportPathLabel = reportPersistencePlan.mode === "abrupt"')
    expect(runnerSource).not.toContain("error.message.replaceAll(scratchRoot")
    expect(runnerSource).not.toContain("Could not preserve sanitized report at ${reportPathLabel}: ${error.message")
  })
})

function abruptRestartEvidenceFixture(): any {
  const evidence: any = structuredClone(completeCrossProcessBatchAuditEvidence)
  evidence.executionMode = "abrupt-restart-native-dsh"
  evidence.processBoundary.second = {
    ...evidence.processBoundary.second,
    runnerOwnedChild: true,
    controlCompleted: true,
    controlFailed: false,
    closeObserved: true,
    processGroupIdObserved: true,
    targetAbsentAfterClose: true,
    processGroupAbsentAfterClose: true,
  }
  evidence.processBoundary.first = {
    ...evidence.processBoundary.first,
    exitCode: null,
    signal: "SIGKILL",
    timedOut: false,
    forcedTermination: true,
    naturalBeforeExitObserved: false,
    nativeTeardownMarkerObserved: false,
    runnerOwnedChild: true,
    childIdentityRevalidatedBeforeSignal: true,
    parentBarrierArmed: true,
    killRequestedByParent: true,
    killSignalRequested: "SIGKILL",
    targetAbsentAfterClose: true,
    processGroupAbsentAfterClose: true,
  }
  evidence.parentVerifiedPersistence = {
    source: "parent-read-persisted-files",
    verifiedBeforeSignal: true,
    checkpointFileParsed: true,
    receiptFileParsed: true,
    findingFileParsed: true,
    workspaceInventorySha256: evidence.phaseOne.workspaceInventorySha256,
    persistence: { ...evidence.phaseOne.persistence },
    checkpoint: { ...evidence.phaseOne.checkpoint },
    receiptCount: 2,
    receiptBatchIds: [...evidence.phaseOne.persistedBatchIds],
    findingsCount: 1,
    finding: { ...evidence.phaseOne.finding },
  }
  evidence.teardown = {
    firstExitObserved: true,
    firstCloseObserved: true,
    firstTargetAbsentAfterClose: true,
    firstProcessGroupAbsentAfterClose: true,
    secondExitObserved: true,
    secondCloseObserved: true,
    secondTargetAbsentAfterClose: true,
    secondProcessGroupAbsentAfterClose: true,
    secondAgentSessionDisposed: true,
    teardownFailed: false,
  }
  return evidence
}

// The former positive fixture before R2: it never proves that phase B's target
// and private process group are empty after close.
function abruptRestartEvidenceWithoutSecondAbsence(): any {
  const evidence = abruptRestartEvidenceFixture()
  for (const key of ["closeObserved", "processGroupIdObserved", "targetAbsentAfterClose", "processGroupAbsentAfterClose"]) {
    delete evidence.processBoundary.second[key]
  }
  delete evidence.teardown.secondTargetAbsentAfterClose
  delete evidence.teardown.secondProcessGroupAbsentAfterClose
  return evidence
}

const abruptRestartEvidenceContract = profileEvidenceContract as unknown as {
  validateAbruptRestartEvidence(value: unknown): string[]
  classifyAbruptRestartEvidenceStatus(value: unknown): string
}

describe("DSH abrupt process-restart evidence gate (#107)", () => {
  test("exports a strict validator and leaves unexecuted evidence BLOCKED", () => {
    expect(typeof abruptRestartEvidenceContract.validateAbruptRestartEvidence).toBe("function")
    expect(typeof abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus).toBe("function")
    for (const value of [undefined, null, {}, { probeExecuted: undefined }, { probeExecuted: false }]) {
      expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(value)).toBe("BLOCKED")
    }
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus({ probeExecuted: true })).toBe("FAIL")
  })

  test("accepts only parent-verified durable phase A followed by owned SIGKILL and independent recovery", () => {
    const evidence = abruptRestartEvidenceFixture()
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence)).toEqual([])
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("PASS")
  })

  test.each([
    ["missing parent readiness", (e: any) => { e.parentVerifiedPersistence.verifiedBeforeSignal = false }],
    ["missing persisted receipt proof", (e: any) => { delete e.parentVerifiedPersistence.receiptBatchIds }],
    ["falsified persistence hash", (e: any) => { e.parentVerifiedPersistence.persistence.findingsSha256 = "0".repeat(64) }],
    ["one-of-five checkpoint", (e: any) => { e.phaseOne.checkpoint.completedBatches = 1 }],
    ["three-of-five checkpoint", (e: any) => { e.phaseOne.checkpoint.completedBatches = 3 }],
    ["duplicate receipts", (e: any) => { e.parentVerifiedPersistence.receiptBatchIds[1] = e.parentVerifiedPersistence.receiptBatchIds[0] }],
    ["finding duplicated", (e: any) => { e.parentVerifiedPersistence.findingsCount = 2 }],
    ["first process exited normally without signal", (e: any) => { e.processBoundary.first.exitCode = 0; e.processBoundary.first.signal = null }],
    ["wrong termination signal", (e: any) => { e.processBoundary.first.signal = "SIGTERM" }],
    ["child ownership not proved", (e: any) => { e.processBoundary.first.runnerOwnedChild = false }],
    ["identity not revalidated before signal", (e: any) => { e.processBoundary.first.childIdentityRevalidatedBeforeSignal = false }],
    ["parent barrier not armed before signal", (e: any) => { e.processBoundary.first.parentBarrierArmed = false }],
    ["process identity changed", (e: any) => { e.processBoundary.first.hostIdentitySha256 = "4".repeat(64) }],
    ["B started before A closed", (e: any) => { e.processBoundary.secondStartedAfterFirstExit = false }],
    ["recovery child startup control failed", (e: any) => { e.processBoundary.second.controlFailed = true }],
    ["recovery child is not runner-owned", (e: any) => { e.processBoundary.second.runnerOwnedChild = false }],
    ["same process reused", (e: any) => { e.processBoundary.second.hostIdentitySha256 = e.processBoundary.first.hostIdentitySha256 }],
    ["second Agent/Session reused", (e: any) => { e.phaseTwo.agentIdentity.agentId = e.phaseOne.agentIdentity.agentId }],
    ["changed workspace inventory", (e: any) => { e.parentVerifiedPersistence.workspaceInventorySha256 = "5".repeat(64) }],
    ["partial synthesis", (e: any) => { e.phaseTwo.synthesis.completedBatches = 4 }],
    ["finding changed at synthesis", (e: any) => { e.phaseTwo.synthesis.finding.findingId = "6".repeat(64) }],
    ["cleanup or teardown failed", (e: any) => { e.teardown.teardownFailed = true }],
    ["target process survived close", (e: any) => { e.teardown.firstTargetAbsentAfterClose = false }],
    ["runner-owned process group has survivor", (e: any) => { e.teardown.firstProcessGroupAbsentAfterClose = false }],
    ["recovery target process survived close", (e: any) => { e.processBoundary.second.targetAbsentAfterClose = false }],
    ["recovery process group has survivor", (e: any) => { e.processBoundary.second.processGroupAbsentAfterClose = false }],
    ["recovery private process group not observed", (e: any) => { e.processBoundary.second.processGroupIdObserved = false }],
    ["recovery close not observed after exit", (e: any) => { e.processBoundary.second.closeObserved = false }],
    ["teardown claims surviving recovery target absence", (e: any) => { e.teardown.secondTargetAbsentAfterClose = false }],
    ["teardown claims surviving recovery group member", (e: any) => { e.teardown.secondProcessGroupAbsentAfterClose = false }],
  ])("fails closed for %s", (_label, mutate) => {
    const evidence = abruptRestartEvidenceFixture()
    mutate(evidence)
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("rejects the former positive fixture once phase-B absence and private-PGID proof are absent", () => {
    const evidence = abruptRestartEvidenceWithoutSecondAbsence()
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("requires every phase-B absence, close, and private-PGID observation", () => {
    const required: Array<[string, (e: any) => void]> = [
      ["processBoundary.second.closeObserved", (e) => { delete e.processBoundary.second.closeObserved }],
      ["processBoundary.second.processGroupIdObserved", (e) => { delete e.processBoundary.second.processGroupIdObserved }],
      ["processBoundary.second.targetAbsentAfterClose", (e) => { delete e.processBoundary.second.targetAbsentAfterClose }],
      ["processBoundary.second.processGroupAbsentAfterClose", (e) => { delete e.processBoundary.second.processGroupAbsentAfterClose }],
      ["teardown.secondTargetAbsentAfterClose", (e) => { delete e.teardown.secondTargetAbsentAfterClose }],
      ["teardown.secondProcessGroupAbsentAfterClose", (e) => { delete e.teardown.secondProcessGroupAbsentAfterClose }],
    ]
    for (const [field, mutate] of required) {
      const evidence = abruptRestartEvidenceFixture()
      mutate(evidence)
      expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length, field).toBeGreaterThan(0)
      expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence), field).toBe("FAIL")
    }
  })

  test("rejects contradictory phase-B absence between process boundary and teardown", () => {
    const boundaryOnly = abruptRestartEvidenceFixture()
    boundaryOnly.processBoundary.second.targetAbsentAfterClose = false
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(boundaryOnly).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(boundaryOnly)).toBe("FAIL")
    const teardownOnly = abruptRestartEvidenceFixture()
    teardownOnly.teardown.secondProcessGroupAbsentAfterClose = false
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(teardownOnly).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(teardownOnly)).toBe("FAIL")
  })

  test("a simulated surviving member of phase B's private process group fails closed", () => {
    const stat = (pid: number, groupId: number) => `${pid} (dsh-child) S 1 ${groupId} ${groupId} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`
    const groupId = 7301
    const survivorRows = [{ pid: 7302, stat: stat(7302, groupId) }]
    expect(processGroupAbsentFromProcRows(groupId, survivorRows)).toBe(false)
    const evidence = abruptRestartEvidenceFixture()
    evidence.processBoundary.second.processGroupAbsentAfterClose = processGroupAbsentFromProcRows(groupId, survivorRows)
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("requires every parent persistence receipt and finding field", () => {
    for (const key of Object.keys(abruptRestartEvidenceFixture().parentVerifiedPersistence)) {
      const evidence = abruptRestartEvidenceFixture()
      delete evidence.parentVerifiedPersistence[key]
      expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length).toBeGreaterThan(0)
    }
  })
})

class MockWritable extends EventEmitter {
  endCalls = 0
  destroyCalls = 0
  end(): this { this.endCalls++; return this }
  destroy(): this { this.destroyCalls++; return this }
}

class MockReadable extends EventEmitter {
  destroyCalls = 0
  destroy(): this { this.destroyCalls++; return this }
}

class MockControlledChild extends EventEmitter {
  pid: number | undefined = 4242
  exitCode: number | null = null
  signalCode: string | null = null
  stdin = new MockWritable()
  stdout = new MockReadable()
  stderr = new MockReadable()
  unrefCalls = 0
  unref(): this { this.unrefCalls++; return this }
  observeExit(code: number | null, signal: string | null): void {
    this.exitCode = code
    this.signalCode = signal
    this.emit("exit", code, signal)
  }
  observeClose(code: number | null, signal: string | null): void {
    this.emit("close", code, signal)
  }
}

class ManualClock {
  private readonly timers: Array<{ callback: () => void; delay: number; cancelled: boolean; fired: boolean }> = []
  readonly delays: number[] = []
  readonly setTimeout: typeof setTimeout = ((callback: () => void, delay = 0) => {
    const timer = { callback, delay, cancelled: false, fired: false }
    this.timers.push(timer)
    this.delays.push(delay)
    return timer as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  readonly clearTimeout: typeof clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const timer = handle as unknown as { cancelled: boolean }
    timer.cancelled = true
  }) as typeof clearTimeout
  runNext(): void {
    const timer = this.timers.find((candidate) => !candidate.cancelled && !candidate.fired)
    if (!timer) throw new Error("manual clock has no pending timeout")
    timer.fired = true
    timer.callback()
  }
  runAll(): void {
    let count = 0
    while (this.timers.some((candidate) => !candidate.cancelled && !candidate.fired)) {
      if (++count > 20) throw new Error("manual clock exceeded bounded timeout schedule")
      this.runNext()
    }
  }
  // Fire the most recently scheduled callback even if it was cancelled, to prove
  // late timers/callbacks cannot signal after the terminal state.
  runLastScheduled(): void {
    const timer = this.timers[this.timers.length - 1]
    if (!timer) throw new Error("manual clock has no scheduled timeout")
    timer.fired = true
    timer.callback()
  }
  pendingCount(): number {
    return this.timers.filter((candidate) => !candidate.cancelled && !candidate.fired).length
  }
}

function startMockControlledRun(options: Record<string, unknown> = {}) {
  const child = new MockControlledChild()
  const clock = new ManualClock()
  const result = runControlledProcess("mock-dsh", [], {
    cwd: tmpdir(),
    env: {},
    timeoutMs: 10,
    controlledTeardownGraceMs: 5,
    controlledCloseGraceMs: 3,
    ...options,
  } as any, {
    spawn: (() => child) as any,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  child.emit("spawn")
  return { child, clock, result }
}

function createAbruptReportPlan(root: string, repo: string, path: string, overrides: Record<string, unknown> = {}) {
  const configured = overrides.configuredReportPath ?? path
  const abruptPath = overrides.abruptReportPath ?? path
  return createReportPersistencePlan({
    abruptRestartRequested: true,
    configuredReportPath: configured as string,
    abruptReportPath: abruptPath as string,
    repositoryRoot: repo,
    temporaryRoot: root,
    defaultReportPath: "docs/evidence/dsh-profile-e2e.latest.json",
  })
}

describe("P1 report-writer and controlled-process regressions", () => {
  test("blocked #107 finally write leaves an existing sentinel unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "dshbanca-report-blocked-"))
    try {
      const repo = join(root, "checkout")
      const privateParent = join(root, "reports")
      mkdirSync(repo, { mode: 0o700 })
      mkdirSync(privateParent, { mode: 0o700 })
      const sentinel = join(privateParent, "existing.json")
      const bytes = Buffer.from("DO-NOT-OVERWRITE\n")
      writeFileSync(sentinel, bytes, { mode: 0o600 })
      const plan = createAbruptReportPlan(root, repo, sentinel)
      expect(plan.mode).toBe("abrupt")
      expect(plan.authorized).toBe(false)
      let reportResult: string | undefined
      let dshBoots = 0
      const earlyBlockedReturn = () => {
        try {
          return
        } finally {
          reportResult = persistReportWithPlan(plan, { status: "BLOCKED", dshBoots })
        }
      }
      earlyBlockedReturn()
      expect(dshBoots).toBe(0)
      expect(reportResult).toBe("blocked")
      expect(readFileSync(sentinel)).toEqual(bytes)
      const missingApprovedTarget = createReportPersistencePlan({
        abruptRestartRequested: true,
        configuredReportPath: undefined,
        abruptReportPath: undefined,
        repositoryRoot: repo,
        temporaryRoot: root,
        defaultReportPath: "docs/evidence/fallback.json",
      })
      expect(missingApprovedTarget.mode).toBe("abrupt")
      expect(missingApprovedTarget.authorized).toBe(false)
      expect(persistReportWithPlan(missingApprovedTarget, { status: "BLOCKED" })).toBe("blocked")
      expect(existsSync(join(repo, "docs/evidence/fallback.json"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("refuses checkout, outside-temp, missing-parent, and symlink report paths without creating them", () => {
    const root = mkdtempSync(join(tmpdir(), "dshbanca-report-guards-"))
    const outside = mkdtempSync(join(tmpdir(), "dshbanca-report-outside-"))
    try {
      const repo = join(root, "checkout")
      const parent = join(root, "private")
      mkdirSync(repo, { mode: 0o700 })
      mkdirSync(parent, { mode: 0o700 })
      const insideCheckout = join(repo, "report.json")
      const missingParent = join(root, "absent", "report.json")
      const outsideTemp = join(outside, "report.json")
      const symlinkParent = join(root, "redirect")
      symlinkSync(outside, symlinkParent, "dir")
      const symlinkEscape = join(symlinkParent, "report.json")
      for (const target of [insideCheckout, missingParent, outsideTemp, symlinkEscape]) {
        const plan = createAbruptReportPlan(root, repo, target)
        expect(plan.authorized).toBe(false)
        expect(persistReportWithPlan(plan, { status: "BLOCKED" })).toBe("blocked")
      }
      expect(existsSync(join(root, "absent"))).toBe(false)
      expect(existsSync(insideCheckout)).toBe(false)
      expect(existsSync(outsideTemp)).toBe(false)
      expect(existsSync(join(outside, "report.json"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test("rejects final symlink and a target created after preflight without changing sentinel bytes", () => {
    const root = mkdtempSync(join(tmpdir(), "dshbanca-report-race-"))
    try {
      const repo = join(root, "checkout")
      const parent = join(root, "private")
      mkdirSync(repo, { mode: 0o700 })
      mkdirSync(parent, { mode: 0o700 })
      const sentinel = join(parent, "sentinel.json")
      const sentinelBytes = Buffer.from("sentinel bytes\n")
      writeFileSync(sentinel, sentinelBytes, { mode: 0o600 })
      const link = join(parent, "link.json")
      symlinkSync(sentinel, link)
      const linkPlan = createAbruptReportPlan(root, repo, link)
      expect(linkPlan.authorized).toBe(false)
      expect(persistReportWithPlan(linkPlan, { status: "FAIL" })).toBe("blocked")
      expect(readFileSync(sentinel)).toEqual(sentinelBytes)

      const racedTarget = join(parent, "raced.json")
      const preflight = createAbruptReportPlan(root, repo, racedTarget)
      expect(preflight.authorized).toBe(true)
      writeFileSync(racedTarget, sentinelBytes, { mode: 0o600, flag: "wx" })
      expect(() => persistReportWithPlan(preflight, { status: "FAIL" })).toThrow()
      expect(readFileSync(racedTarget)).toEqual(sentinelBytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("parent replacement between preflight and persist is refused without writing through a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "dshbanca-report-parent-race-"))
    try {
      const repo = join(root, "checkout")
      const parent = join(root, "private")
      const movedParent = join(root, "private-moved")
      const escape = join(root, "escape")
      mkdirSync(repo, { mode: 0o700 })
      mkdirSync(parent, { mode: 0o700 })
      mkdirSync(escape, { mode: 0o700 })
      const target = join(parent, "report.json")
      const plan = createAbruptReportPlan(root, repo, target)
      expect(plan.authorized).toBe(true)
      renameSync(parent, movedParent)
      symlinkSync(escape, parent, "dir")
      expect(() => persistReportWithPlan(plan, { status: "FAIL" })).toThrow()
      expect(existsSync(join(escape, "report.json"))).toBe(false)
      expect(existsSync(join(movedParent, "report.json"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("writes one new abrupt report exclusively and preserves legacy report semantics", () => {
    const root = mkdtempSync(join(tmpdir(), "dshbanca-report-valid-"))
    try {
      const repo = join(root, "checkout")
      const parent = join(root, "private")
      mkdirSync(repo, { mode: 0o700 })
      mkdirSync(parent, { mode: 0o700 })
      const target = join(parent, "report.json")
      const plan = createAbruptReportPlan(root, repo, target)
      expect(plan.authorized).toBe(true)
      expect(persistReportWithPlan(plan, { status: "BLOCKED", message: "safe report" })).toBe("written")
      const firstBytes = readFileSync(target)
      expect(statSync(target).mode & 0o777).toBe(0o600)
      expect(JSON.parse(firstBytes.toString("utf8")).status).toBe("BLOCKED")
      expect(() => persistReportWithPlan(plan, { status: "FAIL" })).toThrow()
      expect(readFileSync(target)).toEqual(firstBytes)

      const legacyParent = join(repo, "legacy")
      mkdirSync(legacyParent, { mode: 0o700 })
      const legacyTarget = join(legacyParent, "latest.json")
      writeFileSync(legacyTarget, "legacy sentinel\n", { mode: 0o600 })
      const legacyPlan = createReportPersistencePlan({
        abruptRestartRequested: false,
        configuredReportPath: "legacy/latest.json",
        repositoryRoot: repo,
        temporaryRoot: root,
        defaultReportPath: "docs/evidence/dsh-profile-e2e.latest.json",
      })
      expect(legacyPlan.mode).toBe("legacy")
      expect(persistReportWithPlan(legacyPlan, { status: "PASS" })).toBe("written")
      expect(JSON.parse(readFileSync(legacyTarget, "utf8")).status).toBe("PASS")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("controlled timeout is bounded when readiness never completes and no close/error arrives", async () => {
    const requested: string[] = []
    const { child, clock, result } = startMockControlledRun({
      onSpawn: async () => await new Promise<void>(() => {}),
      onControlTimeout: () => { requested.push("SIGTERM"); return "SIGTERM" },
      onControlHardTimeout: () => { requested.push("SIGKILL"); return "SIGKILL" },
    })
    await Promise.resolve()
    clock.runNext()
    expect(child.stdin.endCalls).toBe(1)
    clock.runAll()
    const completed = await result
    expect(completed.timedOut).toBe(true)
    expect(completed.controlFailed).toBe(true)
    expect(completed.exitObserved).toBe(false)
    expect(completed.closeObserved).toBe(false)
    expect(completed.timeoutContainmentSignalsRequested).toEqual(["SIGTERM", "SIGKILL"])
    expect(child.unrefCalls).toBe(1)
    expect(child.stdout.destroyCalls).toBe(1)
    expect(clock.delays).toEqual([10, 5, 3])
  })

  test("SIGTERM without close settles as uncertain and cannot release phase B", async () => {
    const { child, clock, result } = startMockControlledRun({
      onSpawn: async () => await new Promise<void>(() => {}),
      onControlTimeout: () => "SIGTERM",
      onControlHardTimeout: () => null,
    })
    await Promise.resolve()
    clock.runAll()
    const completed = await result
    expect(completed.timeoutContainmentSignalsRequested).toEqual(["SIGTERM"])
    expect(completed.closeObserved).toBe(false)
    expect(child.unrefCalls).toBe(1)
    expect(mayStartAbruptPhaseTwo({
      parentBarrierArmed: true,
      parentVerifiedPersistence: true,
      controlCompleted: completed.controlCompleted === true,
      controlFailed: completed.controlFailed === true,
      firstKillRequested: false,
      exitCode: completed.exitCode,
      signal: completed.signal,
      timedOut: completed.timedOut,
      exitObserved: completed.exitObserved === true,
      closeObserved: completed.closeObserved === true,
      targetAbsentAfterClose: false,
      processGroupAbsentAfterClose: false,
      nativeTeardownMarkerObserved: false,
    })).toBe(false)
  })

  test("unverified child identity prevents every timeout signal", async () => {
    const requested: string[] = []
    const { clock, result } = startMockControlledRun({
      onSpawn: async (_child: unknown, identity: string | null) => {
        if (!identity) throw new Error("child identity unavailable")
      },
      onControlTimeout: (_child: unknown, identity: string | null) => {
        if (!identity) return null
        requested.push("SIGTERM")
        return "SIGTERM"
      },
      onControlHardTimeout: (_child: unknown, identity: string | null) => {
        if (!identity) return null
        requested.push("SIGKILL")
        return "SIGKILL"
      },
    })
    await Promise.resolve()
    clock.runAll()
    const completed = await result
    expect(requested).toEqual([])
    expect(completed.timeoutContainmentSignalsRequested).toEqual([])
    expect(completed.controlFailed).toBe(true)
    expect(completed.closeObserved).toBe(false)
  })

  test("late onSpawn callback cannot signal after timeout terminal state", async () => {
    let releaseCallback: (() => void) | undefined
    let signalAttempts = 0
    const { clock, result } = startMockControlledRun({
      onSpawn: async (_child: unknown, _identity: string | null, _signal: AbortSignal, mayContinue: () => boolean) => {
        await new Promise<void>((resolve) => { releaseCallback = resolve })
        if (mayContinue()) signalAttempts++
      },
      onControlTimeout: () => null,
      onControlHardTimeout: () => null,
    })
    await Promise.resolve()
    await Promise.resolve()
    clock.runAll()
    const completed = await result
    expect(completed.closeObserved).toBe(false)
    releaseCallback?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(signalAttempts).toBe(0)
    expect(completed.timedOut).toBe(true)
    expect(completed.controlFailed).toBe(true)
  })

  test("exit is not close and a delayed control callback cannot signal afterward", async () => {
    let releaseCallback: (() => void) | undefined
    let experimentalSignals = 0
    const { child, result } = startMockControlledRun({
      onSpawn: async (_child: unknown, _identity: string | null, _signal: AbortSignal, mayContinue: () => boolean) => {
        await new Promise<void>((resolve) => { releaseCallback = resolve })
        if (mayContinue()) experimentalSignals++
      },
      onControlTimeout: () => null,
      onControlHardTimeout: () => null,
    })
    await Promise.resolve()
    await Promise.resolve()
    child.observeExit(0, null)
    expect(child.exitCode).toBe(0)
    expect(child.listenerCount("close")).toBeGreaterThan(0)
    releaseCallback?.()
    await Promise.resolve()
    expect(experimentalSignals).toBe(0)
    child.observeClose(0, null)
    const completed = await result
    expect(completed.exitObserved).toBe(true)
    expect(completed.closeObserved).toBe(true)
    expect(completed.controlFailed).toBe(true)
    expect(completed.signal).toBe(null)
  })

  test("owned-child signaling revalidates and targets only the positive direct PID", () => {
    const child = new MockControlledChild() as any
    const signals: Array<[number, string]> = []
    const args: string[] = []
    const key = Buffer.alloc(32)
    expect(terminateOwnedDshChild(
      child, "node", "dsh", args, "identity", key, "SIGTERM", () => true,
      (_target, identity) => identity === "identity",
      (pid, signal) => { signals.push([pid, signal]) },
    )).toBe(true)
    expect(terminateOwnedDshChild(
      child, "node", "dsh", args, "identity", key, "SIGKILL", () => true,
      () => false,
      (pid, signal) => { signals.push([pid, signal]) },
    )).toBe(false)
    expect(terminateOwnedDshChild(
      child, "node", "dsh", args, "identity", key, "SIGKILL", () => false,
      () => true,
      (pid, signal) => { signals.push([pid, signal]) },
    )).toBe(false)
    expect(signals).toEqual([[4242, "SIGTERM"]])
    expect(signals.every(([pid]) => pid > 0)).toBe(true)
  })

  test("process-group absence inspection is fail-closed and never signals a group", () => {
    const stat = (pid: number, groupId: number, command = "worker") => `${pid} (${command}) S 1 ${groupId} ${groupId} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`
    expect(parseLinuxProcStatProcessGroupId(stat(110, 101, "worker ) helper"))).toBe(101)
    expect(processGroupAbsentFromProcRows(101, [
      { pid: 201, stat: stat(201, 202) },
      { pid: 301, stat: stat(301, 302) },
    ])).toBe(true)
    expect(processGroupAbsentFromProcRows(101, [{ pid: 201, stat: stat(201, 101) }])).toBe(false)
    expect(processGroupAbsentFromProcRows(101, [{ pid: 201, stat: "malformed" }])).toBe(false)
    expect(processGroupAbsentFromProcRows(101, [{ pid: 0, stat: stat(201, 202) }])).toBe(false)
    expect(processGroupAbsentFromProcRows(101, [])).toBe(false)
    expect(processGroupAbsentFromProcRows(0, [])).toBe(false)
  })

  test("phase B requires completed parent barrier, experimental kill, close, and absence proof", () => {
    const ready = {
      parentBarrierArmed: true,
      parentVerifiedPersistence: true,
      controlCompleted: true,
      controlFailed: false,
      firstKillRequested: true,
      exitCode: null,
      signal: "SIGKILL",
      timedOut: false,
      exitObserved: true,
      closeObserved: true,
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
      nativeTeardownMarkerObserved: false,
    }
    expect(mayStartAbruptPhaseTwo(ready)).toBe(true)
    for (const change of [
      { parentBarrierArmed: false },
      { parentVerifiedPersistence: false },
      { controlCompleted: false },
      { controlFailed: true },
      { firstKillRequested: false },
      { timedOut: true },
      { exitObserved: false },
      { closeObserved: false },
      { targetAbsentAfterClose: false },
      { processGroupAbsentAfterClose: false },
      { nativeTeardownMarkerObserved: true },
    ]) expect(mayStartAbruptPhaseTwo({ ...ready, ...change })).toBe(false)
  })
})

describe("Runner phase-B absence gate decision (#107 R2)", () => {
  test("preserves scratch unless B's target and private process group are absent after exit and close", async () => {
    const runner = await import("../scripts/e2e-dsh-profile.js") as any
    expect(typeof runner.abruptSecondProcessAbsenceDecision).toBe("function")
    const ready = {
      closeObserved: true,
      controlCompleted: true,
      runnerOwnedChild: true,
      processGroupIdObserved: true,
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
    }
    expect(runner.abruptSecondProcessAbsenceDecision(ready)).toEqual({
      closeConfirmed: true,
      processGroupIdObserved: true,
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
      preserveScratch: false,
    })
    // Exit 0 plus close alone (or any unproven observation) cannot accept the gate.
    for (const change of [
      { closeObserved: false },
      { controlCompleted: false },
      { runnerOwnedChild: false },
      { processGroupIdObserved: false },
      { targetAbsentAfterClose: false },
      { processGroupAbsentAfterClose: false },
    ]) {
      const decision = runner.abruptSecondProcessAbsenceDecision({ ...ready, ...change })
      expect(decision.preserveScratch, JSON.stringify(change)).toBe(true)
      expect(decision.targetAbsentAfterClose && decision.processGroupAbsentAfterClose, JSON.stringify(change)).toBe(false)
    }
  })

  test("binds phase B's observed PGID to the direct child PID instead of any non-null group", async () => {
    const runner = await import("../scripts/e2e-dsh-profile.js") as any
    expect(typeof runner.abruptPrivateProcessGroupIdMatchesChildPid).toBe("function")
    expect(runner.abruptPrivateProcessGroupIdMatchesChildPid(7301, 7301)).toBe(true)
    for (const [childPid, observed] of [
      [7301, 7302],
      [7301, null],
      [undefined, 7301],
      [0, 0],
      [-1, -1],
      [1, 1],
      [7301.5, 7301.5],
      [7301, undefined],
    ] as Array<[number | undefined | null, number | null | undefined]>) {
      expect(runner.abruptPrivateProcessGroupIdMatchesChildPid(childPid, observed), `${childPid}/${observed}`).toBe(false)
    }
    const ready = {
      closeObserved: true,
      controlCompleted: true,
      runnerOwnedChild: true,
      processGroupIdObserved: true,
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
    }
    const mismatched = runner.abruptPrivateProcessGroupIdMatchesChildPid(7301, 7302)
    expect(mismatched).toBe(false)
    const decision = runner.abruptSecondProcessAbsenceDecision({ ...ready, processGroupIdObserved: mismatched })
    expect(decision.preserveScratch).toBe(true)
  })

  test("ties the read-only procfs survivor and scan-failure observations to scratch preservation", async () => {
    const runner = await import("../scripts/e2e-dsh-profile.js") as any
    const stat = (pid: number, groupId: number) => `${pid} (dsh-child) S 1 ${groupId} ${groupId} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`
    const ready = {
      closeObserved: true,
      controlCompleted: true,
      runnerOwnedChild: true,
      processGroupIdObserved: true,
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
    }
    const survivor = processGroupAbsentFromProcRows(8101, [{ pid: 8102, stat: stat(8102, 8101) }])
    const unreadableScan = processGroupAbsentFromProcRows(8101, [])
    expect(survivor).toBe(false)
    expect(unreadableScan).toBe(false)
    for (const observed of [survivor, unreadableScan]) {
      const decision = runner.abruptSecondProcessAbsenceDecision({ ...ready, processGroupAbsentAfterClose: observed })
      expect(decision.processGroupAbsentAfterClose).toBe(false)
      expect(decision.preserveScratch).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// Issue #107 R3: the abrupt provider must build the exact envelope its own
// validator consumes. Inputs below mimic the real sidecars (observer envelope +
// crossProcessPhaseOne/Two payloads) and parent observations; the builder is the
// same one called by the runner.
// ---------------------------------------------------------------------------

function abruptIntegrationInputs(): any {
  const phaseOne = structuredClone(completeCrossProcessBatchAuditEvidence.phaseOne) as any
  const phaseTwo = structuredClone(completeCrossProcessBatchAuditEvidence.phaseTwo) as any
  const readinessObserverIdentitySha256 = "2".repeat(64)
  const recoveryObserverIdentitySha256 = "3".repeat(64)
  const workspaceIdentitySha256 = "1".repeat(64)
  return {
    phaseOneSidecar: {
      observerProcessIdentitySha256: readinessObserverIdentitySha256,
      crossProcessPhaseOne: phaseOne,
      parentBarrierArmed: true,
    },
    phaseTwoSidecar: {
      observerProcessIdentitySha256: recoveryObserverIdentitySha256,
      crossProcessPhaseTwo: phaseTwo,
    },
    parentObservedHostIdentitySha256: readinessObserverIdentitySha256,
    barrierObserverIdentitySha256: readinessObserverIdentitySha256,
    parentVerifiedPersistence: {
      source: "parent-read-persisted-files",
      verifiedBeforeSignal: true,
      checkpointFileParsed: true,
      receiptFileParsed: true,
      findingFileParsed: true,
      workspaceInventorySha256: phaseOne.workspaceInventorySha256,
      persistence: { ...phaseOne.persistence },
      checkpoint: { ...phaseOne.checkpoint },
      receiptCount: 2,
      receiptBatchIds: [...phaseOne.persistedBatchIds],
      findingsCount: 1,
      finding: { ...phaseOne.finding },
    },
    firstProcess: {
      dshExecutableSha256: "b".repeat(64),
      profileIdentitySha256: "c".repeat(64),
      hostIdentitySha256: readinessObserverIdentitySha256,
      spawnObserved: true,
      kernelStartIdentityObserved: true,
      exitObserved: true,
      exitCode: null,
      signal: "SIGKILL",
      timedOut: false,
      forcedTermination: true,
      naturalBeforeExitObserved: false,
      nativeTeardownMarkerObserved: false,
      runnerOwnedChild: true,
      childIdentityRevalidatedBeforeSignal: true,
      parentBarrierArmed: true,
      killRequestedByParent: true,
      killSignalRequested: "SIGKILL",
      timeoutContainmentSignalsRequested: [],
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
    },
    secondProcess: {
      dshExecutableSha256: "b".repeat(64),
      profileIdentitySha256: "c".repeat(64),
      hostIdentitySha256: recoveryObserverIdentitySha256,
      observerIdentitySha256: recoveryObserverIdentitySha256,
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
      runnerOwnedChild: true,
      controlCompleted: true,
      controlFailed: false,
      closeObserved: true,
      processGroupIdObserved: true,
      targetAbsentAfterClose: true,
      processGroupAbsentAfterClose: true,
    },
    secondStartedAfterFirstExit: true,
    processesDidNotOverlap: true,
    workspace: {
      sameWorkspace: true,
      preservedBetweenProcesses: true,
      resetBetweenProcesses: false,
      identitySha256: workspaceIdentitySha256,
      firstProcessEndFilesystemIdentitySha256: workspaceIdentitySha256,
      secondProcessStartFilesystemIdentitySha256: workspaceIdentitySha256,
      secondProcessEndFilesystemIdentitySha256: workspaceIdentitySha256,
      firstProcessEndInventorySha256: phaseOne.workspaceInventorySha256,
      secondProcessStartInventorySha256: phaseOne.workspaceInventorySha256,
      secondProcessEndInventorySha256: "a".repeat(64),
    },
    teardown: {
      firstExitObserved: true,
      firstCloseObserved: true,
      firstTargetAbsentAfterClose: true,
      firstProcessGroupAbsentAfterClose: true,
      secondExitObserved: true,
      secondCloseObserved: true,
      secondTargetAbsentAfterClose: true,
      secondProcessGroupAbsentAfterClose: true,
      secondAgentSessionDisposed: true,
      teardownFailed: false,
    },
  }
}

async function abruptIntegrationBuilder(): Promise<any> {
  const runner = await import("../scripts/e2e-dsh-profile.js") as any
  return runner.buildAbruptRestartEvidence
}

describe("Abrupt producer → validator integration (#107 R3)", () => {
  test("the runner builder produces a complete envelope that the full validator accepts as PASS", async () => {
    const build = await abruptIntegrationBuilder()
    expect(typeof build).toBe("function")
    const inputs = abruptIntegrationInputs()
    const evidence = build(inputs)
    expect(evidence.totalBatches).toBe(5)
    expect(evidence.totalCharacters).toBe(595)
    expect(evidence.planId).toBe(inputs.phaseOneSidecar.crossProcessPhaseOne.planId)
    expect(evidence.manuscriptFingerprint).toBe(inputs.phaseOneSidecar.crossProcessPhaseOne.manuscriptFingerprint)
    expect(evidence.planBatchIds).toEqual(inputs.phaseTwoSidecar.crossProcessPhaseTwo.synthesis.orderedBatchIds)
    expect(evidence.phaseOne.checkpoint.completedBatches).toBe(2)
    expect(evidence.phaseTwo.finalCheckpoint.completedBatches).toBe(5)
    expect(evidence.phaseTwo.synthesis.findingsCount).toBe(1)
    expect(evidence.processBoundary.first.observerIdentitySha256).toBe(inputs.phaseOneSidecar.observerProcessIdentitySha256)
    expect(evidence.processBoundary.first.identityMatched).toBe(true)
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence)).toEqual([])
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("PASS")
  })

  test("retains the readiness-envelope observer digest instead of copying the host digest", async () => {
    const build = await abruptIntegrationBuilder()
    const inputs = abruptIntegrationInputs()
    const differentObserver = "d".repeat(64)
    inputs.phaseOneSidecar.observerProcessIdentitySha256 = differentObserver
    inputs.barrierObserverIdentitySha256 = differentObserver
    const evidence = build(inputs)
    expect(evidence.processBoundary.first.observerIdentitySha256).toBe(differentObserver)
    expect(evidence.processBoundary.first.hostIdentitySha256).toBe(inputs.parentObservedHostIdentitySha256)
    expect(evidence.processBoundary.first.identityMatched).toBe(false)
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("FAIL")
  })

  test("rejects missing or contradictory projections and identities from builder inputs", async () => {
    const build = await abruptIntegrationBuilder()
    const cases: Array<[string, (input: any) => void]> = [
      ["missing readiness observer digest", (i) => { delete i.phaseOneSidecar.observerProcessIdentitySha256 }],
      ["null readiness observer digest", (i) => { i.phaseOneSidecar.observerProcessIdentitySha256 = null }],
      ["readiness observer digest diverges from host", (i) => { i.phaseOneSidecar.observerProcessIdentitySha256 = "9".repeat(64) }],
      ["barrier digest diverges from readiness", (i) => { i.barrierObserverIdentitySha256 = "8".repeat(64) }],
      ["missing phase-one planId", (i) => { delete i.phaseOneSidecar.crossProcessPhaseOne.planId }],
      ["phase-two planId diverges", (i) => { i.phaseTwoSidecar.crossProcessPhaseTwo.resumeQuery.checkpointBefore.planId = "5".repeat(64) }],
      ["missing manuscript fingerprint", (i) => { delete i.phaseOneSidecar.crossProcessPhaseOne.manuscriptFingerprint }],
      ["phase-two fingerprint diverges", (i) => { i.phaseTwoSidecar.crossProcessPhaseTwo.finalCheckpoint.manuscriptFingerprint = "6".repeat(64) }],
      ["incompatible total batches", (i) => { i.phaseOneSidecar.crossProcessPhaseOne.totalBatches = 4 }],
      ["incompatible total characters", (i) => { i.phaseOneSidecar.crossProcessPhaseOne.totalCharacters = 597 }],
      ["duplicated batch ids", (i) => {
        const ids = i.phaseTwoSidecar.crossProcessPhaseTwo.synthesis.orderedBatchIds
        ids[1] = ids[0]
      }],
      ["reordered batch ids", (i) => {
        const ids = i.phaseTwoSidecar.crossProcessPhaseTwo.synthesis.orderedBatchIds
        ;[ids[0], ids[1]] = [ids[1], ids[0]]
      }],
      ["missing batch id", (i) => { i.phaseTwoSidecar.crossProcessPhaseTwo.synthesis.orderedBatchIds.pop() }],
      ["incomplete synthesis", (i) => { i.phaseTwoSidecar.crossProcessPhaseTwo.synthesis.completedBatches = 4 }],
      ["duplicated synthesis finding", (i) => { i.phaseTwoSidecar.crossProcessPhaseTwo.synthesis.findingsCount = 2 }],
      ["missing second teardown absence proof", (i) => { delete i.teardown.secondTargetAbsentAfterClose }],
      ["false first teardown absence proof", (i) => { i.teardown.firstProcessGroupAbsentAfterClose = false }],
      ["missing phase-two sidecar payload", (i) => { delete i.phaseTwoSidecar.crossProcessPhaseTwo }],
    ]
    for (const [label, mutate] of cases) {
      const inputs = abruptIntegrationInputs()
      mutate(inputs)
      const evidence = build(inputs)
      expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length, label).toBeGreaterThan(0)
      expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence), label).toBe("FAIL")
    }
  })

  test("phase B receives the flat resume expectation the resume probe consumes", async () => {
    const runner = await import("../scripts/e2e-dsh-profile.js") as any
    expect(typeof runner.buildAbruptResumeExpectation).toBe("function")
    const inputs = abruptIntegrationInputs()
    const phaseOne = inputs.phaseOneSidecar.crossProcessPhaseOne
    const expectation = runner.buildAbruptResumeExpectation(phaseOne, phaseOne.workspaceInventorySha256)
    for (const key of ["probeExecuted", "workspaceIdentitySha256", "planId", "manuscriptFingerprint", "persistence", "completedBatchIds", "checkpoint", "finding"]) {
      expect(Object.prototype.hasOwnProperty.call(expectation, key), key).toBe(true)
      expect(expectation[key], key).toEqual(phaseOne[key])
    }
    expect(expectation.workspaceInventorySha256).toBe(phaseOne.workspaceInventorySha256)
    expect(Object.prototype.hasOwnProperty.call(expectation, "phaseOne")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(expectation, "parentVerifiedPersistence")).toBe(false)
    const empty = runner.buildAbruptResumeExpectation(undefined, "a".repeat(64))
    expect(empty.planId).toBeUndefined()
    expect(empty.probeExecuted).toBeUndefined()
    expect(empty.workspaceInventorySha256).toBe("a".repeat(64))
  })

  test("the retired provider shape without root projections or envelope identity is rejected", async () => {
    const build = await abruptIntegrationBuilder()
    const evidence = build(abruptIntegrationInputs()) as any
    for (const key of ["totalBatches", "totalCharacters", "planId", "manuscriptFingerprint", "planBatchIds"]) delete evidence[key]
    evidence.processBoundary.first.observerIdentitySha256 = null
    evidence.processBoundary.first.identityMatched = false
    expect(abruptRestartEvidenceContract.validateAbruptRestartEvidence(evidence).length).toBeGreaterThan(0)
    expect(abruptRestartEvidenceContract.classifyAbruptRestartEvidenceStatus(evidence)).toBe("FAIL")
  })
})

// ---------------------------------------------------------------------------
// Issue #107 R4: the whole runner must obey the verified-direct-child
// containment authority whenever #107 is requested. These tests execute the
// real `run()` containment path with fake ChildProcess objects, fake
// process.kill, a manual clock, and simulated procfs identity observations.
// Every test first asserts the R4 API exists, so the suite never reaches the
// legacy group-signaling path on an old HEAD.
// ---------------------------------------------------------------------------

describe("R4 containment authority for the whole #107 runner", () => {
  async function strictRunner(): Promise<any> {
    const runner = await import("../scripts/e2e-dsh-profile.js") as any
    expect(typeof runner.ContainmentAuthorityAbort).toBe("function")
    expect(typeof runner.containmentIncidentSnapshot).toBe("function")
    expect(typeof runner.containmentAuthorityReportSnapshot).toBe("function")
    expect(typeof runner.scratchPreservationForSafetySnapshot).toBe("function")
    expect(typeof runner.containmentRequiresScratchPreservation).toBe("function")
    expect(typeof runner.selectContainmentPolicy).toBe("function")
    expect(typeof runner.resolveCommandExecutableForIdentity).toBe("function")
    return runner
  }

  function startStrictRun(
    runner: any,
    options: Record<string, unknown> = {},
    identityState: { value?: string | null; executableMatches?: boolean; emitSpawn?: boolean } = {},
  ) {
    const child = new MockControlledChild()
    const clock = new ManualClock()
    const signals: Array<[number, string]> = []
    const identity: { value: string | null; executableMatches: boolean; executableChecks: number } = {
      value: identityState.value === undefined ? "identity-a" : identityState.value,
      executableMatches: identityState.executableMatches ?? true,
      executableChecks: 0,
    }
    const promise = runner.run("mock-command", [], {
      cwd: tmpdir(),
      env: {},
      timeoutMs: 10,
      processIdentityKey: Buffer.alloc(32),
      containment: "strict-direct-only",
      containmentStage: "strict-test-stage",
      strictContainmentGraceMs: 5,
      controlledCloseGraceMs: 3,
      ...options,
    }, {
      spawn: (() => child) as any,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => { signals.push([pid, signal]) },
      processIdentity: () => identity.value,
      verifyExecutable: () => {
        identity.executableChecks++
        return identity.executableMatches
      },
    })
    if (identityState.emitSpawn !== false) child.emit("spawn")
    return { child, clock, signals, identity, promise }
  }

  async function outcome(promise: Promise<any>): Promise<{ result?: any; error?: any }> {
    try {
      return { result: await promise }
    } catch (error) {
      return { error }
    }
  }

  test("production strict matrix records the incident, rejects, and preserves the scratch", async () => {
    const runner = await strictRunner()
    const { clock, signals, promise } = startStrictRun(
      runner,
      { containmentStage: "production-strict-stage" },
      { value: null },
    )
    clock.runNext()
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(error.stage).toBe("production-strict-stage")
    expect(error.result?.timedOut).toBe(true)
    expect(String(error.result?.containmentIncident)).toContain("identity")
    expect(signals).toEqual([])
    expect(signals.every(([pid]) => pid > 0)).toBe(true)
    const incident = runner.containmentIncidentSnapshot()
    expect(incident?.stage).toBe("production-strict-stage")
    expect(String(incident?.reason).length).toBeGreaterThan(0)
    const reportStage = runner.containmentAuthorityReportSnapshot() as any
    expect(reportStage?.status).toBe("FAIL")
    expect(reportStage?.stage).toBe("production-strict-stage")
    expect(runner.scratchPreservationForSafetySnapshot()).toBe(true)
    expect(runner.containmentRequiresScratchPreservation({ preserveForSafety: false, containmentIncident: incident })).toBe(true)
    expect(runner.containmentRequiresScratchPreservation({ preserveForSafety: true, containmentIncident: null })).toBe(true)
    expect(runner.containmentRequiresScratchPreservation({ preserveForSafety: false, containmentIncident: null })).toBe(false)
  })

  test("strict timeout signals only the verified direct child, never a group", async () => {
    const runner = await strictRunner()
    const { clock, signals, promise, child } = startStrictRun(runner)
    clock.runNext()
    expect(signals).toEqual([[4242, "SIGTERM"]])
    clock.runNext()
    expect(signals).toEqual([[4242, "SIGTERM"], [4242, "SIGKILL"]])
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    const result = error.result
    expect(result.timedOut).toBe(true)
    expect(result.closeObserved).toBe(false)
    expect(typeof result.containmentIncident).toBe("string")
    expect(signals.every(([pid]) => pid > 0)).toBe(true)
    expect(child.unrefCalls).toBeGreaterThan(0)
  })

  test("missing identity forbids every signal and rejects the bounded run closed", async () => {
    const runner = await strictRunner()
    const { clock, signals, identity, promise } = startStrictRun(runner)
    identity.value = null
    clock.runNext()
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(signals).toEqual([])
    expect(error.result.timedOut).toBe(true)
    expect(String(error.result.containmentIncident)).toContain("identity")
  })

  test("PID reuse or a changed identity before timeout forbids every signal", async () => {
    const runner = await strictRunner()
    const { clock, signals, identity, promise } = startStrictRun(runner)
    identity.value = "identity-from-reused-pid"
    clock.runNext()
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(signals).toEqual([])
  })

  test("identity change between SIGTERM and the deferred attempt blocks SIGKILL", async () => {
    const runner = await strictRunner()
    const { clock, signals, identity, promise } = startStrictRun(runner)
    clock.runNext()
    expect(signals).toEqual([[4242, "SIGTERM"]])
    identity.value = "identity-changed"
    clock.runNext()
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(signals).toEqual([[4242, "SIGTERM"]])
    expect(String(error.result.containmentIncident).length).toBeGreaterThan(0)
  })

  test("missing process-identity key or an unexpected executable forbids signals", async () => {
    const runner = await strictRunner()
    const withoutKey = startStrictRun(runner, { processIdentityKey: undefined })
    withoutKey.clock.runNext()
    withoutKey.clock.runNext()
    expect(withoutKey.signals).toEqual([])
    expect((await outcome(withoutKey.promise)).error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    const unexpectedExecutable = startStrictRun(runner)
    unexpectedExecutable.identity.executableMatches = false
    unexpectedExecutable.clock.runNext()
    unexpectedExecutable.clock.runNext()
    expect(unexpectedExecutable.signals).toEqual([])
    expect((await outcome(unexpectedExecutable.promise)).error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
  })

  test("wrapper targets are never signaled and the wait stays bounded", async () => {
    const runner = await strictRunner()
    const { clock, signals, promise } = startStrictRun(runner, { containmentTarget: "wrapper-unverifiable" })
    clock.runNext()
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(signals).toEqual([])
    expect(error.result.closeObserved).toBe(false)
    expect(String(error.result.containmentIncident)).toContain("wrapper")
  })

  test("exit without close stays bounded, reports uncertainty, and sends no signal", async () => {
    const runner = await strictRunner()
    const { child, clock, signals, promise } = startStrictRun(runner)
    child.observeExit(0, null)
    clock.runLastScheduled()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(error.result.closeObserved).toBe(false)
    expect(error.result.timedOut).toBe(false)
    expect(signals).toEqual([])
    expect(String(error.result.containmentIncident)).toContain("close")
  })

  test("post-spawn error releases runner handles, fences timers, signals nothing, and rejects", async () => {
    const runner = await strictRunner()
    const { child, clock, signals, promise } = startStrictRun(runner)
    child.emit("error", new Error("synthetic child failure"))
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    expect(String(error.result.containmentIncident)).toContain("error")
    expect(error.result.closeObserved).toBe(false)
    expect(signals).toEqual([])
    expect(child.stdin.destroyCalls).toBeGreaterThan(0)
    expect(child.stdout.destroyCalls).toBeGreaterThan(0)
    expect(child.stderr.destroyCalls).toBeGreaterThan(0)
    expect(child.unrefCalls).toBeGreaterThan(0)
    expect(clock.pendingCount()).toBe(0)
    // A late close/timer after the terminal state must stay inert.
    child.observeClose(0, null)
    clock.runLastScheduled()
    expect(signals).toEqual([])
  })

  test("error before spawn releases runner handles without inventing a containment incident", async () => {
    const runner = await strictRunner()
    const { child, clock, signals, promise } = startStrictRun(runner, {}, { emitSpawn: false })
    child.emit("error", new Error("synthetic spawn failure"))
    const { result, error } = await outcome(promise)
    expect(error).toBeUndefined()
    expect(result.closeObserved).toBe(false)
    expect(signals).toEqual([])
    expect(child.stdin.destroyCalls).toBeGreaterThan(0)
    expect(child.stdout.destroyCalls).toBeGreaterThan(0)
    expect(child.stderr.destroyCalls).toBeGreaterThan(0)
    expect(child.unrefCalls).toBeGreaterThan(0)
    expect(clock.pendingCount()).toBe(0)
  })

  test("a timer delayed past a rejected terminal cannot signal", async () => {
    const runner = await strictRunner()
    const { clock, signals, promise } = startStrictRun(runner)
    clock.runNext()
    expect(signals).toEqual([[4242, "SIGTERM"]])
    clock.runNext()
    clock.runNext()
    const { error } = await outcome(promise)
    expect(error).toBeInstanceOf(runner.ContainmentAuthorityAbort)
    const before = signals.length
    clock.runLastScheduled()
    expect(signals.length).toBe(before)
    expect(signals.every(([pid]) => pid > 0)).toBe(true)
  })

  test("confirmed close cancels timers and late callbacks cannot signal", async () => {
    const runner = await strictRunner()
    const { child, clock, signals, promise } = startStrictRun(runner)
    child.observeClose(0, null)
    const { result, error } = await outcome(promise)
    expect(error).toBeUndefined()
    expect(result.closeObserved).toBe(true)
    expect(clock.pendingCount()).toBe(0)
    clock.runLastScheduled()
    expect(signals).toEqual([])
  })

  test("selects the strict policy only for non-empty #107 request variables", async () => {
    const runner = await strictRunner()
    expect(runner.selectContainmentPolicy({})).toBe("legacy")
    expect(runner.selectContainmentPolicy({ DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_AUTHORIZED: "yes" })).toBe("strict-direct-only")
    expect(runner.selectContainmentPolicy({ DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SHA256: "   " })).toBe("legacy")
    expect(runner.selectContainmentPolicy({ DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_REPORT_PATH: "/tmp/report.json" })).toBe("strict-direct-only")
  })

  test("resolves relative command names through PATH for identity comparison", async () => {
    const runner = await strictRunner()
    const git = runner.resolveCommandExecutableForIdentity("git")
    expect(typeof git).toBe("string")
    expect(git.length).toBeGreaterThan(0)
    expect(runner.resolveCommandExecutableForIdentity("dshbanca-definitely-missing-command")).toBeNull()
  })

  test("the real executable verifier fails closed for invalid or unknown identities", async () => {
    const runner = await strictRunner()
    expect(runner.verifyProcessExecutableIdentity(0, "git", [])).toBe(false)
    expect(runner.verifyProcessExecutableIdentity(1, "git", [])).toBe(false)
    expect(runner.verifyProcessExecutableIdentity(process.pid, "dshbanca-definitely-missing-command", [])).toBe(false)
  })
})


// ---------------------------------------------------------------------------
// Issue #107 R5: terminal scratch/evidence preservation. The real decision used
// by runCli() is exercised with filesystem fixtures; FAIL/BLOCKED can never
// destroy the only diagnostic evidence, and cleanup only follows durable
// exclusive report persistence with proven teardown.
// ---------------------------------------------------------------------------

describe("R5 terminal scratch and evidence preservation", () => {
  async function runnerApi(): Promise<any> {
    const runner = await import("../scripts/e2e-dsh-profile.js") as any
    expect(typeof runner.decideScratchCleanup).toBe("function")
    expect(typeof runner.applyScratchCleanup).toBe("function")
    return runner
  }

  function decisionInput(overrides: Record<string, unknown> = {}) {
    return {
      abruptMode: true,
      scratchExists: true,
      finalStatus: "PASS",
      containmentIncident: false,
      reportPersistenceFailed: false,
      reportPersistenceBlocked: false,
      teardownProven: true,
      ...overrides,
    }
  }

  test("FAIL, BLOCKED, incidents, unproven teardown, and persistence failures preserve the scratch", async () => {
    const runner = await runnerApi()
    const cases: Array<[string, Record<string, unknown>]> = [
      ["conventional FAIL without containment incident", { finalStatus: "FAIL" }],
      ["conventional BLOCKED without containment incident", { finalStatus: "BLOCKED" }],
      ["offline plugin-add failure (BLOCKED)", { finalStatus: "BLOCKED" }],
      ["conventional setup/build failure (FAIL)", { finalStatus: "FAIL" }],
      ["timeout or post-spawn error incident", { finalStatus: "FAIL", containmentIncident: true }],
      ["invalid final evidence (FAIL)", { finalStatus: "FAIL" }],
      ["teardown uncertain while status is PASS", { teardownProven: false }],
      ["report persistence failed", { reportPersistenceFailed: true }],
      ["report persistence blocked", { reportPersistenceBlocked: true }],
    ]
    for (const [label, overrides] of cases) {
      const decision = runner.decideScratchCleanup(decisionInput(overrides))
      expect(decision.preserve, label).toBe(true)
      expect(decision.remove, label).toBe(false)
      expect(typeof decision.reason, label).toBe("string")
    }
  })

  test("PASS with proven teardown and durable report removes; missing scratch never invents cleanup", async () => {
    const runner = await runnerApi()
    const remove = runner.decideScratchCleanup(decisionInput())
    expect(remove).toEqual({ preserve: false, remove: true, reason: null })
    const noScratch = runner.decideScratchCleanup(decisionInput({ scratchExists: false }))
    expect(noScratch).toEqual({ preserve: false, remove: false, reason: null })
    const legacyBlocked = runner.decideScratchCleanup(decisionInput({ abruptMode: false, finalStatus: "FAIL" }))
    expect(legacyBlocked.remove).toBe(true)
    const legacyReportFailure = runner.decideScratchCleanup(decisionInput({ abruptMode: false, reportPersistenceFailed: true }))
    expect(legacyReportFailure.preserve).toBe(true)
  })

  test("filesystem cleanup preserves the directory on failure and removes it only for PASS", async () => {
    const runner = await runnerApi()
    const preservedRoot = mkdtempSync(join(tmpdir(), "dshbanca-profile-e2e-r5-preserve-"))
    const removedRoot = mkdtempSync(join(tmpdir(), "dshbanca-profile-e2e-r5-remove-"))
    try {
      const failDecision = runner.decideScratchCleanup(decisionInput({ finalStatus: "FAIL" }))
      const preserved = runner.applyScratchCleanup({ scratchRoot: preservedRoot, temporaryRoot: tmpdir(), decision: failDecision })
      expect(preserved.observed).toBe(true)
      expect(preserved.removed).toBe(false)
      expect(preserved.error).toBeNull()
      expect(existsSync(preservedRoot)).toBe(true)

      const passDecision = runner.decideScratchCleanup(decisionInput())
      const removed = runner.applyScratchCleanup({ scratchRoot: removedRoot, temporaryRoot: tmpdir(), decision: passDecision })
      expect(removed.attempted).toBe(true)
      expect(removed.removed).toBe(true)
      expect(removed.error).toBeNull()
      expect(existsSync(removedRoot)).toBe(false)

      const noScratch = runner.applyScratchCleanup({ scratchRoot: undefined, temporaryRoot: tmpdir(), decision: passDecision })
      expect(noScratch).toEqual({ attempted: false, removed: false, observed: false, error: null })
      const missingScratch = runner.applyScratchCleanup({ scratchRoot: removedRoot, temporaryRoot: tmpdir(), decision: passDecision })
      expect(missingScratch.attempted).toBe(false)
      expect(missingScratch.removed).toBe(false)
      expect(missingScratch.observed).toBe(false)
    } finally {
      rmSync(preservedRoot, { recursive: true, force: true })
      rmSync(removedRoot, { recursive: true, force: true })
    }
  })

  test("a cleanup that cannot remove or resolve the runner directory fails closed", async () => {
    const runner = await runnerApi()
    const notRunnerOwned = tmpdir()
    const decision = runner.decideScratchCleanup(decisionInput())
    const outcome = runner.applyScratchCleanup({ scratchRoot: notRunnerOwned, temporaryRoot: tmpdir(), decision })
    expect(outcome.attempted).toBe(true)
    expect(outcome.removed).toBe(false)
    expect(typeof outcome.error).toBe("string")
    expect(existsSync(notRunnerOwned)).toBe(true)
  })
})
