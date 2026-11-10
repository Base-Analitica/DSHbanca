import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import {
  canonicalAuditorMarkdownSha1,
  canonicalAuditorMarkdownSha256,
  classifyAuditorMarkdownStatus,
  expectedTools,
  validateAuditorMarkdownEvidence,
} from "../scripts/lib/dsh-profile-e2e-contract.js"
import { e2eControlPresetId } from "../scripts/lib/dsh-profile-e2e-presets.js"
import { renderControlPresetSelector } from "../scripts/lib/dsh-profile-e2e-observer-control.js"

test("unauthorized E2E returns before any DSH CLI or academic project setup", () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const mainStart = runnerSource.indexOf("async function main(): Promise<void>")
  const authorizationGate = runnerSource.indexOf('if (process.env.DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED !== "yes")', mainStart)
  const dshLookup = runnerSource.indexOf('const dshExecutable = findExecutable("dsh", process.env.DSH_BIN)', mainStart)
  const workspaceSetup = runnerSource.indexOf('const workspace = join(scratch, "synthetic-project")', mainStart)
  expect(mainStart).toBeGreaterThanOrEqual(0)
  expect(authorizationGate).toBeGreaterThan(mainStart)
  expect(authorizationGate).toBeLessThan(dshLookup)
  expect(authorizationGate).toBeLessThan(workspaceSetup)
  expect(runnerSource.slice(authorizationGate, dshLookup)).toContain("dshCliInvocations: 0")
  expect(runnerSource.slice(authorizationGate, dshLookup)).toContain("academicProjectInitialized: false")
  expect(runnerSource).not.toContain('process.env.DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED = "yes"')
})

test("runner gates the second DSH spawn on host-verified phase-one recovery and legacy batch evidence", () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const phaseOneValidation = runnerSource.indexOf("validateCrossProcessPhaseOneEvidence(phaseOneEvidence)")
  const legacyBatchValidation = runnerSource.indexOf("validateBatchAuditEvidence(observed.batchAuditEvidenceGate)")
  const firstCloseCheck = runnerSource.indexOf("boot.closeObserved === true", phaseOneValidation)
  const secondSpawn = runnerSource.indexOf("const secondBoot = await runDsh", phaseOneValidation)
  expect(phaseOneValidation).toBeGreaterThanOrEqual(0)
  expect(legacyBatchValidation).toBeGreaterThan(phaseOneValidation)
  expect(firstCloseCheck).toBeGreaterThan(phaseOneValidation)
  expect(secondSpawn).toBeGreaterThan(legacyBatchValidation)
  expect(secondSpawn).toBeGreaterThan(firstCloseCheck)
  expect(runnerSource.slice(phaseOneValidation, secondSpawn)).toContain("if (!phaseOneHostReady)")
  expect(runnerSource.slice(phaseOneValidation, secondSpawn)).toContain("secondProcessStarted: false")
  expect(runnerSource).toContain('openSync(restartWorkspace, "r")')
  expect(runnerSource).toContain("fstatSync(directoryFd, { bigint: true })")
  expect(runnerSource).toContain("opened.dev !== named.dev || opened.ino !== named.ino")
  expect(runnerSource).toContain("secondProcessStartFilesystemIdentitySha256 !== restartWorkspaceIdentitySha256")
  expect(runnerSource).toContain("completedBatchCharacters")
  expect(runnerSource).toContain("planBatchIdsPrefix")
})

test("restored process rejects each unaudited advance before auditing and advancing", () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const resumeProbe = runnerSource.indexOf("export async function runCrossProcessResumeProbe")
  const resumedBatchLoop = runnerSource.indexOf("for (let index = 2; index < 5; index++)", resumeProbe)
  const unverifiedAdvance = runnerSource.indexOf('"dshbanca-e2e-process-b-unverified-advance-" + index', resumedBatchLoop)
  const audit = runnerSource.indexOf('"dshbanca-e2e-process-b-audit-" + index', resumedBatchLoop)
  const validAdvance = runnerSource.indexOf('"dshbanca-e2e-process-b-advance-" + index', resumedBatchLoop)
  expect(resumeProbe).toBeGreaterThanOrEqual(0)
  expect(resumedBatchLoop).toBeGreaterThan(resumeProbe)
  expect(unverifiedAdvance).toBeGreaterThan(resumedBatchLoop)
  expect(unverifiedAdvance).toBeLessThan(audit)
  expect(audit).toBeLessThan(validAdvance)
  const rejectionBlock = runnerSource.slice(resumedBatchLoop, audit)
  expect(rejectionBlock).toContain("crossProcessAnalysisHashes")
  expect(rejectionBlock).toContain("crossProcessReadStores")
  expect(rejectionBlock).toContain('"banca_context", { completedBatchId: batchId }, agent')
  expect(rejectionBlock).toContain("workspaceInventoryBeforeAttempt")
  expect(rejectionBlock).toContain("crossProcessToolErrorCode(unverifiedAdvance.message)")
  expect(rejectionBlock).toContain('rejectionCode === "missing_batch_audit"')
  expect(rejectionBlock).toContain("unverifiedAdvancesBlocked++")
})

test("actual generated observer module binds the control preset ID without runner scope", async () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  expect(runnerSource).toContain("${renderControlPresetSelector(e2eControlPresetId)}")
  expect(runnerSource).not.toContain("ctx.agentPresets.select(controlAgent, e2eControlPresetId);")
  const templateStart = runnerSource.indexOf("const observerSource = `")
  const contentStart = templateStart + "const observerSource = `".length
  const contentEnd = runnerSource.indexOf("\n`\n  writeFileSync(join(observerRoot, \"index.js\"), observerSource", contentStart)
  expect(templateStart).toBeGreaterThanOrEqual(0)
  expect(contentEnd).toBeGreaterThan(contentStart)
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
    "/tmp/process-a-result.json", "/tmp/process-b-result.json", "/tmp/process-a-shutdown.json", "/tmp/process-b-shutdown.json", renderControlPresetSelector, e2eControlPresetId,
  )
  expect(generatedModuleSource).toContain('const e2eControlPresetId = "dshbanca-e2e-control-neutral";')

  const directory = mkdtempSync(join(tmpdir(), "dshbanca-observer-source-"))
  const modulePath = join(directory, "observer-control.mjs")
  const brokenModulePath = join(directory, "observer-control-with-runner-scope-bug.mjs")
  try {
    writeFileSync(modulePath, generatedModuleSource, { mode: 0o600 })
    const generatedModule = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)
    expect(typeof generatedModule.apply).toBe("function")
    expect(typeof generatedModule.runAcademicBatchAuditProbe).toBe("function")
    expect(typeof generatedModule.runCrossProcessInitialProbe).toBe("function")
    expect(typeof generatedModule.runCrossProcessResumeProbe).toBe("function")
    expect(typeof generatedModule.crossProcessToolErrorCode).toBe("function")
    const newline = String.fromCharCode(10)
    expect(generatedModule.crossProcessToolErrorCode(`context checkpoint error${newline}code=missing_batch_audit${newline}message=missing confirmation`)).toBe("missing_batch_audit")
    expect(generatedModule.crossProcessToolErrorCode(`context checkpoint error${newline}code=missing_batch_audit_extra${newline}message=wrong code`)).toBe("missing_batch_audit_extra")
    expect(generatedModule.crossProcessToolErrorCode(`context checkpoint error${newline}message=message contains code=missing_batch_audit only`)).toBeNull()
    expect(generatedModule.crossProcessToolErrorCode(`successful context${newline}code=missing_batch_audit${newline}more context`)).toBeNull()
    expect(generatedModule.crossProcessToolErrorCode(`code=missing_batch_audit${newline}code=unexpected`)).toBeNull()
    expect(typeof generatedModule.crossProcessProcessIdentitySha256).toBe("function")
    expect(typeof generatedModule.runAcademicNativeQuestionsProbe).toBe("function")
    expect(runnerSource).toContain('child.once("spawn"')
    expect(generatedModuleSource).toContain("/proc/sys/kernel/random/boot_id")
    expect(generatedModuleSource).toContain('readFile("/proc/" + process.pid + "/stat"')
    expect(generatedModuleSource).toContain("analysis-audit-confirmations-store-v1")
    expect(generatedModuleSource).toContain("DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE")
    expect(generatedModuleSource).toContain('process.once("beforeExit"')
    expect(generatedModuleSource).toContain("process.exitCode = 86")
    expect(generatedModuleSource).toContain("nativeShutdownCompleted: process.exitCode === 0")
    expect(generatedModuleSource).toContain("processExitCodeAtBeforeExit: process.exitCode ?? null")
    expect(generatedModuleSource).toContain("banca_auditar")
    expect(generatedModuleSource).toContain("missing_batch_audit")
    expect(generatedModuleSource).toContain("expectedTotalBatches")
    expect(generatedModuleSource).toContain("totalManuscriptChars !== 595")
    expect(generatedModuleSource).toContain("dshbanca-e2e-final-synthesis")
    expect(generatedModuleSource).toContain("dshbanca-e2e-resume-agent-session")
    expect(generatedModuleSource).toContain("ctx.agents.create({")
    expect(generatedModuleSource).toContain('ctx.agentPresets.select(resumedAgent, "banca-auditor")')
    expect(generatedModuleSource).toContain('ctx.agentPresets.composedPreset(resumedAgent.ctx)')
    expect(generatedModuleSource).toContain('ctx.sessionProjections.stateOf(resumedSession, "agentPreset")')
    expect(generatedModuleSource).toContain("captureAnalysisStoreHashes")
    expect(generatedModuleSource).toContain("resumedAgentHandle.dispose()")
    expect(generatedModuleSource).toContain("agentSessionResume: agentSessionResumeEvidence")
    expect(generatedModuleSource).toContain("q-academic-rec-1")
    expect(generatedModuleSource).toContain("user-questions/request")
    expect(generatedModuleSource).toContain("DELEGATED_CALLER")
    expect(generatedModuleSource).toContain("parentAgent: agent")
    expect(generatedModuleSource).toContain("isOwnedBy")
    expect(generatedModuleSource).toContain("roots().includes")
    expect(generatedModuleSource).toContain("answererReached")
    expect(generatedModuleSource).toContain("unverifiedAgentUnregistered")
    expect(generatedModuleSource).toContain("noApprovalEmitted")
    expect(generatedModuleSource).toContain("sessionAuditAvailable")
    expect(generatedModuleSource).toContain("sessionEventsRead")
    expect(generatedModuleSource).toContain("approval.request() outside an open turn")
    expect(generatedModuleSource).toContain("academic_approval_allowed_action")
    expect(generatedModuleSource).toContain("academic_approval_rejected_action")
    expect(generatedModuleSource).toContain("academic_approval_cancelled_action")
    expect(generatedModuleSource).toContain("academic_approval_unavailable_action")
    expect(generatedModuleSource).toContain("approval/request")
    expect(generatedModuleSource).not.toContain('return "unavailable";')
    expect(generatedModuleSource).toContain("unansweredByProvider")
    expect(generatedModuleSource).toContain("asked.seq <= turnStart.seq")
    expect(generatedModuleSource).not.toContain("dshbanca-e2e-unauthorized-selection-mutation")
    const agent = { id: "control-agent", ctx: {} }
    let selectedId: string | undefined
    const ctx = {
      agentPresets: {
        async select(_agent: unknown, id: string) {
          selectedId = id
          return id
        },
        composedPreset() { return selectedId },
      },
    }

    await expect(generatedModule.selectControlPreset(ctx, agent)).resolves.toBe("dshbanca-e2e-control-neutral")
    expect(selectedId).toBe("dshbanca-e2e-control-neutral")


    // Installed @deepseek-ai/dsh-agent-instructions uses syncInbox() when a
    // downstream pre-step listener rejects, rather than decision.messages.
    // Verify observation can prove a native message queued in nextStep without
    // falsely allowing any model-facing step.
    const auditorInstruction = {
      id: "native-auditor-instruction-1",
      role: "user",
      source: {
        kind: "agent-instructions",
        changes: [{ path: "banca-auditor.md", digest: "canonical-sha1" }],
      },
    }
    const queued = generatedModule.captureNativeInstructionMessages([], [auditorInstruction])
    expect(queued).toEqual([{ channel: "post-reject-inbox", message: auditorInstruction }])
    expect(generatedModule.captureNativeInstructionMessages([auditorInstruction], [auditorInstruction]))
      .toEqual([{ channel: "pre-step-decision", message: auditorInstruction }])
    expect(generatedModule.captureNativeInstructionMessages([], [
      { ...auditorInstruction, source: { kind: "agent-instructions", changes: [{ path: "AGENTS.md" }] } },
    ])).toEqual([])
    expect(generatedModule.captureNativeInstructionMessages([], [])).toEqual([])
    // The neutral control must receive ZERO native instructions, including
    // unrelated AGENTS.md messages, not merely zero banca-auditor.md copies.
    const unrelatedInstruction = {
      ...auditorInstruction,
      id: "unrelated-instruction",
      source: { kind: "agent-instructions", changes: [{ path: "AGENTS.md" }] },
    }
    expect(generatedModule.captureNativeInstructionMessages([], [unrelatedInstruction], null))
      .toEqual([{ channel: "post-reject-inbox", message: unrelatedInstruction }])

    // Negative control: remove the exact serialized module-local binding. This
    // reproduces the reviewed free-reference failure in generated JavaScript.
    const brokenModuleSource = generatedModuleSource.replace(
      'const e2eControlPresetId = "dshbanca-e2e-control-neutral";\n',
      "",
    )
    expect(brokenModuleSource).not.toContain("const e2eControlPresetId =")
    writeFileSync(brokenModulePath, brokenModuleSource, { mode: 0o600 })
    const brokenModule = await import(`${pathToFileURL(brokenModulePath).href}?test=${Date.now()}`)
    await expect(brokenModule.selectControlPreset(ctx, agent)).rejects.toThrow(/e2eControlPresetId is not defined/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("generated auditor evidence uses the strict session projection contract", async () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const templateStart = runnerSource.indexOf("const observerSource = `")
  const contentStart = templateStart + "const observerSource = `".length
  const contentEnd = runnerSource.indexOf("\n`\n  writeFileSync(join(observerRoot, \"index.js\"), observerSource", contentStart)
  expect(templateStart).toBeGreaterThanOrEqual(0)
  expect(contentEnd).toBeGreaterThan(contentStart)
  const template = runnerSource.slice(contentStart, contentEnd)
  const renderObserver = new Function(
    "observerName", "expectedTools", "auditorMarkdownSourceSha256", "auditorMarkdownSourceSha1",
    "workspace", "observerResult", "restartWorkspace", "restartObserverResultOne", "restartObserverResultTwo",
    "restartTeardownMarkerOne", "restartTeardownMarkerTwo", "renderControlPresetSelector", "e2eControlPresetId",
    `return \`${template}\`;`,
  ) as (...args: unknown[]) => string
  const generatedModuleSource = renderObserver(
    "dshbanca-e2e-observer", expectedTools,
    canonicalAuditorMarkdownSha256, canonicalAuditorMarkdownSha1,
    "/tmp/synthetic-workspace", "/tmp/observer-result.json", "/tmp/restart-workspace",
    "/tmp/process-a-result.json", "/tmp/process-b-result.json", "/tmp/process-a-shutdown.json", "/tmp/process-b-shutdown.json", renderControlPresetSelector, e2eControlPresetId,
  )

  // Evaluate the exact object literal embedded in the generated observer module.
  // This keeps the regression tied to the producer instead of a hand-built
  // payload that already satisfies the validator.
  const marker = "auditorMarkdownEvidence: {"
  const start = generatedModuleSource.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const objectStart = start + marker.length - 1
  let depth = 0
  let objectEnd = -1
  for (let index = objectStart; index < generatedModuleSource.length; index++) {
    if (generatedModuleSource[index] === "{") depth++
    if (generatedModuleSource[index] === "}" && --depth === 0) {
      objectEnd = index + 1
      break
    }
  }
  expect(objectEnd).toBeGreaterThan(objectStart)
  const objectLiteral = generatedModuleSource.slice(objectStart, objectEnd)
  const generatedAgent = { id: "agent-auditor-1", inbox: { nextStep: [] } }
  const generatedSession = { id: "agent-auditor-1" }
  const emitted = new Function(
    "auditorMarkdownSourceSha256", "auditorMarkdownSourceSha1",
    "installedAuditorMarkdownSha256", "installedAuditorMarkdownSha1",
    "loaderAuditorMarkdownSha256", "loaderAuditorMarkdownSha1",
    "loadedSourceSha1", "presetCompositionSha256", "presetCompositionContent",
    "presetCompositionHasInstructionLoader", "auditorNativeInstructions", "agent",
    "controlAgent", "auditorNativeInstruction", "controlNativeInstructions",
    "auditorPreStep", "session", "ctx", "effectivePreset", "sessionPresetProjection",
    "auditorEventsAfterChecks",
    `return (${objectLiteral});`,
  )(
    canonicalAuditorMarkdownSha256, canonicalAuditorMarkdownSha1,
    canonicalAuditorMarkdownSha256, canonicalAuditorMarkdownSha1,
    canonicalAuditorMarkdownSha256, canonicalAuditorMarkdownSha1,
    canonicalAuditorMarkdownSha1, "sha256:preset", "native instruction loader",
    true, [{ channel: "post-reject-inbox", message: {
      id: "evt-auditor-1", role: "user",
      source: { kind: "agent-instructions", changes: [{ path: "banca-auditor.md", digest: canonicalAuditorMarkdownSha1 }] },
    } }],
    generatedAgent,
    { id: "control-agent-1", inbox: { nextStep: [] } },
    { id: "evt-auditor-1", role: "user", source: {
      kind: "agent-instructions", changes: [{ path: "banca-auditor.md", digest: canonicalAuditorMarkdownSha1 }],
    } },
    [],
    { agentId: "agent-auditor-1", sessionId: "agent-auditor-1" },
    generatedSession,
    {
      agents: { get: () => generatedAgent },
      sessions: { get: () => generatedSession },
    },
    "banca-auditor", "banca-auditor", 0,
  )

  expect(emitted.sessionProjectionPreset).toBe("banca-auditor")
  expect(emitted.sessionPresetProjection).toBeUndefined()
  expect(validateAuditorMarkdownEvidence(emitted)).toEqual([])
  expect(classifyAuditorMarkdownStatus(emitted)).toBe("PASS")
  expect(validateAuditorMarkdownEvidence({ ...emitted, sessionProjectionPreset: undefined })).toContain(
    "auditor instruction content is not bound to the live banca-auditor Agent and Session",
  )
  expect(validateAuditorMarkdownEvidence({ ...emitted, sessionProjectionPreset: "banca-corretor" })).toContain(
    "auditor instruction content is not bound to the live banca-auditor Agent and Session",
  )
})
