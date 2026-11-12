import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { readFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { loadConfig } from "../src/lib/config.js"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader.js"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage.js"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint.js"
import { bancaContext } from "../src/tools/banca_context.js"
import { bancaAuditar } from "../src/tools/banca_auditar.js"
import { bancaSintese } from "../src/tools/banca_sintese.js"
import {
  canonicalAuditorMarkdownSha1,
  canonicalAuditorMarkdownSha256,
  classifyAuditorMarkdownStatus,
  expectedTools,
  validateAuditorMarkdownEvidence,
} from "../scripts/lib/dsh-profile-e2e-contract.js"
import * as profileEvidenceContract from "../scripts/lib/dsh-profile-e2e-contract.js"
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
  expect(rejectionBlock).toContain("workspaceInventoryBeforeAttempt !== workspaceInventoryAfterResumeQuerySha256")
  expect(rejectionBlock).toContain("toolRuntimeIsError === false")
  expect(rejectionBlock).toContain("toolResultValue === expectedRejectionValue")
  expect(rejectionBlock).toContain('"message=cannot advance checkpoint: audit confirmation missing for batch " + batchId')
  expect(rejectionBlock).toContain("unverifiedAdvance.message === toolResultValue")
  expect(rejectionBlock).toContain("crossProcessToolErrorCode(toolResultValue)")
  expect(rejectionBlock).toContain('rejectionCode === "missing_batch_audit"')
  expect(rejectionBlock).toContain("unverifiedAdvancesBlocked++")
})

test("both process phases verify successful incomplete-coverage refusal and persistent state", () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const firstPhaseStart = runnerSource.indexOf("export async function runCrossProcessInitialProbe")
  const secondPhaseStart = runnerSource.indexOf("export async function runCrossProcessResumeProbe")
  const firstPhase = runnerSource.slice(firstPhaseStart, secondPhaseStart)
  const secondPhase = runnerSource.slice(secondPhaseStart)
  const audit = firstPhase.indexOf('"dshbanca-e2e-process-a-audit-" + index')
  const perBatchSynthesis = firstPhase.indexOf("runCrossProcessSynthesisProbe(", audit)
  const advance = firstPhase.indexOf('"dshbanca-e2e-process-a-advance-" + index', perBatchSynthesis)
  const finalTwoOfFiveSynthesis = firstPhase.indexOf('"dshbanca-e2e-process-a-stop-at-two"', advance)
  const unverifiedAdvance = secondPhase.indexOf('"dshbanca-e2e-process-b-unverified-advance-" + index')
  const synthesis = secondPhase.indexOf("runCrossProcessSynthesisProbe(", unverifiedAdvance)
  const secondAudit = secondPhase.indexOf('"dshbanca-e2e-process-b-audit-" + index', synthesis)
  const secondAdvance = secondPhase.indexOf('"dshbanca-e2e-process-b-advance-" + index', secondAudit)
  expect(firstPhaseStart).toBeGreaterThanOrEqual(0)
  expect(audit).toBeGreaterThanOrEqual(0)
  expect(perBatchSynthesis).toBeGreaterThan(audit)
  expect(advance).toBeGreaterThan(perBatchSynthesis)
  expect(finalTwoOfFiveSynthesis).toBeGreaterThan(advance)
  expect(unverifiedAdvance).toBeGreaterThanOrEqual(0)
  expect(synthesis).toBeGreaterThan(unverifiedAdvance)
  expect(secondAudit).toBeGreaterThan(synthesis)
  expect(secondAdvance).toBeGreaterThan(secondAudit)

  const refusalHelper = runnerSource.slice(runnerSource.indexOf("export const crossProcessSynthesisRefusal"), runnerSource.indexOf("const runTool", runnerSource.indexOf("export const crossProcessSynthesisRefusal")))
  const probeHelper = runnerSource.slice(runnerSource.indexOf("const runCrossProcessSynthesisProbe"), firstPhaseStart)
  expect(refusalHelper).toContain("outcome?.result?.isError !== false")
  expect(refusalHelper).toContain('lines[1] !== "code=incomplete_coverage"')
  expect(refusalHelper).toContain("outcome.message !== outcome.result.value")
  expect(probeHelper).toContain("crossProcessReadStores")
  expect(probeHelper).toContain("crossProcessAnalysisHashes")
  expect(probeHelper).toContain("workspaceInventoryBeforeSha256 === workspaceInventoryAfterSha256")
  expect(probeHelper).toContain("persistentStateUnchanged")
  expect(runnerSource).toContain("const crossProcessStoredCheckpointEvidence = (checkpoint, nextBatch) => ({")
  expect(runnerSource).toContain("...checkpoint,")
  expect(runnerSource).toContain("manuscriptFingerprint: checkpoint?.fingerprint")
  expect(secondPhase).toContain("const checkpointBefore = crossProcessStoredCheckpointEvidence(storesBeforeAttempt.checkpoint, meta?.batch)")
  expect(secondPhase).toContain("const checkpointAfter = crossProcessStoredCheckpointEvidence(storesAfterAttempt.checkpoint, meta?.batch)")
})

test("source drift is mandatory and edits only synthetic prose after first shutdown", () => {
  const source = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  expect(source).toContain("export async function runSourceDriftProbe")
  expect(source).toContain('DSHBANCA_DSH_PROFILE_PHASE: "drift-initial"')
  expect(source).toContain('DSHBANCA_DSH_PROFILE_PHASE: "drift-resume"')
  expect(source).toContain("validateSourceDriftEvidence(sourceDriftEvidence)")
  expect(source).toContain('report.stages.sourceDrift = {')
  expect(source).toContain('if (sourceDriftStatus !== "PASS")')
  expect(source).toContain("mutateSyntheticLatexContent")
  const first = source.indexOf("const driftFirstProof = sourceDriftProcessProof(")
  const validation = source.indexOf("validateCrossProcessPhaseOneEvidence(driftPhaseOne)", first)
  const edit = source.indexOf("const changedDriftContent = mutateSyntheticLatexContent(", validation)
  const second = source.indexOf("const driftSecondBoot = await runDsh(", edit)
  expect(first).toBeGreaterThan(0)
  expect(validation).toBeGreaterThan(first)
  expect(edit).toBeGreaterThan(validation)
  expect(second).toBeGreaterThan(edit)
  expect(source.slice(first, edit)).toContain("return")
  expect(source.slice(source.indexOf("function sourceDriftProcessProof"), source.indexOf("function repoStatus"))).toContain("!result.closeObserved")
  expect(source.slice(source.indexOf("function sourceDriftProcessProof"), source.indexOf("function repoStatus"))).toContain('marker?.nativeShutdownCompleted !== true')
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
    "/tmp/abrupt-process-a-shutdown.json", "/tmp/abrupt-process-b-shutdown.json", "test-parent-decision-token", renderControlPresetSelector, e2eControlPresetId,
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
    expect(typeof generatedModule.crossProcessSynthesisRefusal).toBe("function")
    expect(typeof generatedModule.crossProcessCheckpointProjectionMatches).toBe("function")
    const checkpointBeforeQuery = {
      planId: "plan-id",
      manuscriptFingerprint: "manuscript-fingerprint",
      totalBatches: 5,
      completedBatches: 2,
      completedCharacters: 240,
      totalCharacters: 595,
      coveragePercent: 40.34,
      state: "running",
      nextBatchIndex: 2,
      nextBatchId: "batch-2",
    }
    const checkpointAfterQuery = {
      planId: "plan-id",
      manuscriptFingerprint: "manuscript-fingerprint",
      totalBatches: 5,
      completedBatches: 2,
      completedCharacters: 240,
      totalCharacters: 595,
      coveragePercent: 40.34,
      state: "running",
      nextBatchId: "batch-2",
      nextBatchIndex: 2,
    }
    expect(JSON.stringify(checkpointBeforeQuery)).not.toBe(JSON.stringify(checkpointAfterQuery))
    expect(generatedModuleSource).toContain("crossProcessCheckpointProjectionMatches(checkpointBeforeQuery, checkpointAfterQuery)")
    expect(generatedModuleSource).not.toContain("JSON.stringify(checkpointBeforeQuery) !== JSON.stringify(checkpointAfterQuery)")
    expect(generatedModule.crossProcessCheckpointProjectionMatches(checkpointBeforeQuery, checkpointAfterQuery)).toBe(true)
    for (const [field, original] of Object.entries(checkpointBeforeQuery)) {
      const changed = typeof original === "number" ? original + 1 : `${original}-changed`
      expect(generatedModule.crossProcessCheckpointProjectionMatches(checkpointBeforeQuery, {
        ...checkpointBeforeQuery,
        [field]: changed,
      })).toBe(false)
    }
    const missingCheckpointField = Object.fromEntries(Object.entries(checkpointBeforeQuery).filter(([field]) => field !== "nextBatchId"))
    expect(generatedModule.crossProcessCheckpointProjectionMatches(checkpointBeforeQuery, missingCheckpointField)).toBe(false)
    expect(generatedModule.crossProcessCheckpointProjectionMatches(checkpointBeforeQuery, {
      ...checkpointBeforeQuery,
      unexpectedField: true,
    })).toBe(false)
    expect(typeof generatedModule.crossProcessSameProjection).toBe("function")
    const persistedCheckpointBefore = {
      planId: "plan-id",
      fingerprint: "manuscript-fingerprint",
      state: "running",
      batchIds: ["batch-1", "batch-2"],
      metadata: { createdAt: "2026-11-10T00:00:00.000Z", evidence: { first: 1, second: 2 } },
    }
    const persistedCheckpointAfter = {
      metadata: { evidence: { second: 2, first: 1 }, createdAt: "2026-11-10T00:00:00.000Z" },
      batchIds: ["batch-1", "batch-2"],
      state: "running",
      fingerprint: "manuscript-fingerprint",
      planId: "plan-id",
    }
    expect(JSON.stringify(persistedCheckpointBefore)).not.toBe(JSON.stringify(persistedCheckpointAfter))
    expect(generatedModule.crossProcessSameProjection(persistedCheckpointBefore, persistedCheckpointAfter)).toBe(true)
    expect(generatedModule.crossProcessSameProjection(persistedCheckpointBefore, {
      ...persistedCheckpointAfter,
      state: "complete",
    })).toBe(false)
    expect(generatedModule.crossProcessSameProjection(persistedCheckpointBefore, {
      ...persistedCheckpointAfter,
      unexpectedField: true,
    })).toBe(false)
    expect(generatedModule.crossProcessSameProjection(["batch-1", "batch-2"], ["batch-2", "batch-1"])).toBe(false)
    expect(generatedModuleSource).toContain("crossProcessSameProjection(storesBefore.checkpoint, storesAfter.checkpoint)")
    expect(generatedModuleSource).toContain("crossProcessSameProjection(checkpointBefore, checkpointAfter)")
    expect(generatedModuleSource).toContain("crossProcessSameProjection(beforeAttempt, afterAttempt)")
    expect(generatedModuleSource).not.toContain("JSON.stringify(storesBefore.checkpoint) === JSON.stringify(storesAfter.checkpoint)")
    expect(generatedModuleSource).not.toContain("JSON.stringify(checkpointBefore) === JSON.stringify(checkpointAfter)")
    expect(generatedModuleSource).not.toContain("JSON.stringify(beforeAttempt) !== JSON.stringify(afterAttempt)")
    const newline = String.fromCharCode(10)
    expect(generatedModule.crossProcessToolErrorCode(`context checkpoint error${newline}code=missing_batch_audit${newline}message=missing confirmation`)).toBe("missing_batch_audit")
    expect(generatedModule.crossProcessToolErrorCode(`context checkpoint error${newline}code=missing_batch_audit_extra${newline}message=wrong code`)).toBe("missing_batch_audit_extra")
    expect(generatedModule.crossProcessToolErrorCode(`context checkpoint error${newline}message=message contains code=missing_batch_audit only`)).toBeNull()
    expect(generatedModule.crossProcessToolErrorCode(`successful context${newline}code=missing_batch_audit${newline}more context`)).toBeNull()
    expect(generatedModule.crossProcessToolErrorCode(`code=missing_batch_audit${newline}code=unexpected`)).toBeNull()

    const incompleteMessage = 'global synthesis requires checkpoint.state === "complete"; received "running"'
    const incompleteValue = `synthesis input error${newline}code=incomplete_coverage${newline}message=${incompleteMessage}`
    const incompleteCheckpoint = { state: "running", completedBatches: 2, totalBatches: 5 }
    const successfulDomainRefusal = { result: { isError: false, value: incompleteValue }, message: incompleteValue }
    expect(generatedModule.crossProcessSynthesisRefusal(successfulDomainRefusal, incompleteCheckpoint)).toEqual({
      errorCode: "incomplete_coverage",
      errorMessage: incompleteMessage,
    })
    expect(generatedModule.crossProcessSynthesisRefusal(successfulDomainRefusal, { ...incompleteCheckpoint, completedBatches: 1 })).toEqual({
      errorCode: "incomplete_coverage",
      errorMessage: incompleteMessage,
    })
    expect(generatedModule.crossProcessSynthesisRefusal({ result: { isError: true, value: incompleteValue }, message: incompleteValue }, incompleteCheckpoint)).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal({ result: { isError: false, value: JSON.stringify({ coverage: { state: "complete" } }) }, message: JSON.stringify({ coverage: { state: "complete" } }) }, incompleteCheckpoint)).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal({ result: { isError: false, value: incompleteValue.replace("code=incomplete_coverage", "code=missing_findings") }, message: incompleteValue.replace("code=incomplete_coverage", "code=missing_findings") }, incompleteCheckpoint)).toBeNull()
    const wrongStateMessage = incompleteValue.replace('received "running"', 'received "complete"')
    expect(generatedModule.crossProcessSynthesisRefusal({ result: { isError: false, value: wrongStateMessage }, message: wrongStateMessage }, incompleteCheckpoint)).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal({ result: { isError: false, value: incompleteValue }, message: "conflicting tool message" }, incompleteCheckpoint)).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal(successfulDomainRefusal, { ...incompleteCheckpoint, state: "complete" })).toBeNull()
    const pendingMessage = 'global synthesis requires checkpoint.state === "complete"; received "pending"'
    const pendingValue = `synthesis input error${newline}code=incomplete_coverage${newline}message=${pendingMessage}`
    const pendingCheckpoint = { state: "pending", completedBatches: 0, totalBatches: 5 }
    const pendingDomainRefusal = { result: { isError: false, value: pendingValue }, message: pendingValue }
    expect(generatedModule.crossProcessSynthesisRefusal(pendingDomainRefusal, pendingCheckpoint)).toEqual({
      errorCode: "incomplete_coverage",
      errorMessage: pendingMessage,
    })
    expect(generatedModule.crossProcessSynthesisRefusal(successfulDomainRefusal, { ...incompleteCheckpoint, completedBatches: 0 })).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal(pendingDomainRefusal, { ...pendingCheckpoint, completedBatches: 1 })).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal(pendingDomainRefusal, { ...pendingCheckpoint, state: "running" })).toBeNull()
    expect(generatedModule.crossProcessSynthesisRefusal(successfulDomainRefusal, { ...incompleteCheckpoint, completedBatches: 5, state: "complete" })).toBeNull()
    expect(typeof generatedModule.crossProcessProcessIdentitySha256).toBe("function")
    if (process.platform === "linux") {
      const previousIdentityKey = process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY
      process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY = "a".repeat(64)
      try {
        const generatedIdentity = await generatedModule.crossProcessProcessIdentitySha256()
        expect(generatedIdentity).toMatch(/^[a-f0-9]{64}$/)
      } finally {
        if (previousIdentityKey === undefined) delete process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY
        else process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY = previousIdentityKey
      }
    }
    expect(typeof generatedModule.runAcademicNativeQuestionsProbe).toBe("function")
    expect(runnerSource).toContain('child.once("spawn"')
    expect(runnerSource).toContain('const expectedCheckpointState = contextCheckpoint.completedBatches === 0 ? "pending" : "running";')
    expect(runnerSource).toContain("contextCheckpoint.state !== checkpointBefore.state")
    expect(generatedModuleSource).toContain("/proc/sys/kernel/random/boot_id")
    expect(generatedModuleSource).toContain('readFile("/proc/" + process.pid + "/stat"')
    expect(generatedModuleSource).toContain("analysis-audit-confirmations-store-v1")
    expect(generatedModuleSource).toContain("DSHBANCA_DSH_PROFILE_PHASE_ONE_EVIDENCE")
    expect(generatedModuleSource).toContain('restartPhase === "abrupt-initial"')
    expect(generatedModuleSource).toContain('restartPhase === "abrupt-resume"')
    expect(generatedModuleSource).toContain("abruptRestartWorkspace")
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
    "restartTeardownMarkerOne", "restartTeardownMarkerTwo", "abruptRestartWorkspace", "abruptObserverResultOne",
    "abruptObserverResultTwo", "abruptTeardownMarkerOne", "abruptTeardownMarkerTwo", "abruptParentDecisionToken",
    "renderControlPresetSelector", "e2eControlPresetId",
    `return \`${template}\`;`,
  ) as (...args: unknown[]) => string
  const generatedModuleSource = renderObserver(
    "dshbanca-e2e-observer", expectedTools,
    canonicalAuditorMarkdownSha256, canonicalAuditorMarkdownSha1,
    "/tmp/synthetic-workspace", "/tmp/observer-result.json", "/tmp/restart-workspace",
    "/tmp/process-a-result.json", "/tmp/process-b-result.json", "/tmp/process-a-shutdown.json", "/tmp/process-b-shutdown.json",
    "/tmp/abrupt-restart-workspace", "/tmp/abrupt-process-a-result.json", "/tmp/abrupt-process-b-result.json",
    "/tmp/abrupt-process-a-shutdown.json", "/tmp/abrupt-process-b-shutdown.json", "test-parent-decision-token", renderControlPresetSelector, e2eControlPresetId,
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

test("generated drift probe matches real local academic tools without loading the DSH Host", async () => {
  // This is explicitly a hermetic adapter fixture, NOT native lifecycle evidence.
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const templateStart = runnerSource.indexOf("const observerSource = `") + "const observerSource = `".length
  const templateEnd = runnerSource.indexOf('\n`\n  writeFileSync(join(observerRoot, "index.js"), observerSource', templateStart)
  const render = new Function(
    "observerName", "expectedTools", "auditorMarkdownSourceSha256", "auditorMarkdownSourceSha1",
    "workspace", "observerResult", "restartWorkspace", "restartObserverResultOne", "restartObserverResultTwo",
    "restartTeardownMarkerOne", "restartTeardownMarkerTwo", "abruptRestartWorkspace", "abruptObserverResultOne",
    "abruptObserverResultTwo", "abruptTeardownMarkerOne", "abruptTeardownMarkerTwo", "abruptParentDecisionToken",
    "renderControlPresetSelector", "e2eControlPresetId",
    `return \`${runnerSource.slice(templateStart, templateEnd)}\`;`,
  )
  const directory = mkdtempSync(join(tmpdir(), "dshbanca-hermetic-drift-"))
  const workspace = join(directory, "project")
  mkdirSync(join(workspace, "capitulos"), { recursive: true })
  mkdirSync(join(workspace, ".banca"))
  writeFileSync(join(workspace, ".banca", "project.json"), JSON.stringify({ version: 1, analysis: { coverageMode: "exhaustive", maxCharactersPerBatch: 120 } }))
  writeFileSync(join(workspace, "main.tex"), "\\documentclass{article}\n\\begin{document}\nTexto acadêmico sintético de validação.\\end{document}\n")
  writeFileSync(join(workspace, "referencias.bib"), "@article{synthetic2026, title={Referência Sintética}, author={Pessoa, Exemplo}, year={2026}}\n")
  for (let i = 1; i <= 5; i++) writeFileSync(join(workspace, "capitulos", `lote${i}.tex`), i === 2
    ? "\\section{Delineamento Amostral e Metodologia}\nA amostragem foi definida por conveniência em 30 participantes, com omissão de justificativa do critério amostral e confronto bibliográfico com synthetic2026.\nCapitulo sintetico 2 para analise academica exaustiva e2e.\n"
    : `Capitulo sintetico ${i} para analise academica exaustiva e2e.\n`)
  const source = render("fixture-observer", expectedTools, "fixture-sha256", "fixture-sha1", workspace, "unused", workspace, "unused-a", "unused-b", "unused-c", "unused-d", workspace, "unused-abrupt-a", "unused-abrupt-b", "unused-abrupt-c", "unused-abrupt-d", "test-parent-decision-token", renderControlPresetSelector, e2eControlPresetId)
  const modulePath = join(directory, "observer.mjs")
  writeFileSync(modulePath, source)
  const oldKey = process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY
  const oldIdentity = process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256
  process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY = "ab".repeat(32)
  process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256 = "cd".repeat(32)
  const hash = (value: string) => createHash("sha256").update(value).digest("hex")
  const inventory = (root: string, prefix = ""): Record<string, string> => Object.fromEntries(readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? Object.entries(inventory(join(root, entry.name), rel)) : [[rel, hash(readFileSync(join(root, entry.name), "utf8"))]]
  }))
  const agents = new Map<string, any>()
  const sessions = new Map<string, any>()
  const dispatches: string[] = []
  const ctx = {
    agents: {
      get: (id: string) => agents.get(id),
      async create({ sessionId }: { sessionId: string }) {
        const session = { id: sessionId, snapshotEvents: () => [] }
        const agent = { id: sessionId, session, ctx: { preset: "" } }
        agents.set(sessionId, agent); sessions.set(sessionId, session)
        return { agent, async dispose() { agents.delete(sessionId); sessions.delete(sessionId) } }
      },
    },
    sessions: { get: (id: string) => sessions.get(id) },
    agentPresets: {
      async select(agent: any, preset: string) { agent.ctx.preset = preset; return preset },
      composedPreset: (context: any) => context.preset,
    },
    sessionProjections: { stateOf: (session: any) => agents.get(session.id)?.ctx.preset },
    tools: { async execute(input: any) {
      dispatches.push(input.name)
      // Skip banca_init's compiler discovery subprocess: synthetic config exists already.
      if (input.name === "banca_init") return { isError: false, value: "hermetic fixture initialized" }
      const tools: Record<string, any> = { banca_context: bancaContext, banca_auditar: bancaAuditar, banca_sintese: bancaSintese }
      const value = await tools[input.name].execute(input.arguments, { directory: workspace })
      return { isError: false, value }
    } },
  }
  try {
    const generated = await import(`${pathToFileURL(modulePath).href}?drift=1`)
    expect(typeof generated.runSourceDriftProbe).toBe("function")
    const phaseOne = await generated.runCrossProcessInitialProbe(ctx, workspace)
    expect(phaseOne.checkpoint.completedBatches).toBe(2)
    expect(phaseOne.findingCount).toBe(1)
    expect(profileEvidenceContract.validateCrossProcessPhaseOneEvidence(phaseOne)).toEqual([])
    const beforeInventory = inventory(workspace)
    const beforePlan = planExhaustiveAnalysisBatches(loadCanonicalLatexManuscript(workspace, loadConfig(workspace)), 120)
    const mutationStart = runnerSource.indexOf("function mutateSyntheticLatexContent(")
    const mutationEnd = runnerSource.indexOf("\nfunction canonicalSyntheticPlan", mutationStart)
    const mutatorSource = runnerSource.slice(mutationStart, mutationEnd).replace("(content: string): string", "(content)")
    const mutate = new Function(`return (${mutatorSource});`)() as (content: string) => string
    const latexPath = join(workspace, "capitulos", "lote2.tex")
    const oldLatex = readFileSync(latexPath, "utf8")
    const newLatex = mutate(oldLatex)
    expect(newLatex.length).toBe(oldLatex.length)
    expect(hash(newLatex)).not.toBe(hash(oldLatex))
    expect(newLatex.replace("31 participantes", "30 participantes")).toBe(oldLatex)
    expect(() => mutate("no expected prose")).toThrow("absent or ambiguous")
    expect(() => mutate(oldLatex + oldLatex)).toThrow("absent or ambiguous")
    writeFileSync(latexPath, newLatex)
    const afterPlan = planExhaustiveAnalysisBatches(loadCanonicalLatexManuscript(workspace, loadConfig(workspace)), 120)
    expect(afterPlan.fingerprint).not.toBe(beforePlan.fingerprint)
    expect(computePlanIdentity(afterPlan)).not.toBe(computePlanIdentity(beforePlan))
    expect(afterPlan.coverage).toEqual(beforePlan.coverage)
    expect(afterPlan.batches.every(batch => !beforePlan.batches.some(old => old.batchId === batch.batchId))).toBe(true)
    const canonicalAfter = { planId: computePlanIdentity(afterPlan), manuscriptFingerprint: afterPlan.fingerprint, firstBatchId: afterPlan.batches[0]!.batchId }
    dispatches.length = 0
    const phaseTwo = await generated.runSourceDriftProbe(ctx, workspace, { phaseOne, canonicalAfter })
    expect(dispatches).toEqual(["banca_context", "banca_context", "banca_auditar", "banca_auditar", "banca_sintese"])
    expect(phaseTwo.checkpoint.completedBatches).toBe(0)
    expect(phaseTwo.checkpoint.completedCharacters).toBe(0)
    expect(phaseTwo.checkpoint.state).toBe("pending")
    expect(phaseTwo.findingsStore).toBeNull()
    expect(phaseTwo.auditStore).toBeNull()
    expect(phaseTwo.oldFindingBefore).toEqual(phaseOne.finding)
    expect(phaseTwo.oldFindingAfter).toEqual(phaseOne.finding)
    expect(phaseTwo.oldReceiptIdsAfter).toEqual(phaseOne.completedBatchIds)
    for (const [path, digest] of Object.entries(beforeInventory).filter(([path]) => path.startsWith(".banca/analysis/"))) expect(phaseTwo.inventoryFinal[path]).toBe(digest)
    expect(phaseTwo.refusals.map((refusal: any) => refusal.errorCode)).toEqual(["unknown_batch", "fingerprint_mismatch", "unknown_batch", "missing_findings"])
    for (const refusal of phaseTwo.refusals) {
      expect(refusal.toolRuntimeIsError).toBe(false)
      expect(refusal.inventoryBeforeSha256).toBe(refusal.inventoryAfterSha256)
      const value = { result: { isError: false, value: refusal.toolResultValue }, message: refusal.toolMessage }
      expect(generated.sourceDriftDomainRefusal(value, refusal.toolResultValue)).toBe(true)
      expect(generated.sourceDriftDomainRefusal({ ...value, result: { ...value.result, isError: true } }, refusal.toolResultValue)).toBe(false)
      expect(generated.sourceDriftDomainRefusal({ ...value, message: "wrong result" }, refusal.toolResultValue)).toBe(false)
    }
    const additions = Object.keys(phaseTwo.inventoryAfterContext).filter(path => !(path in phaseTwo.inventoryBeforeContext))
    expect(additions.length).toBe(2)
    expect(additions).toContain(`.banca/analysis/checkpoints/${canonicalAfter.planId}.json`)
    expect(additions.filter(path => /^\.banca\/context\/context-\d+\.md$/.test(path)).length).toBe(1)
    expect(phaseTwo.inventoryFinal).toEqual(phaseTwo.inventoryAfterContext)
    // Fabricated boundary rows below are a contract fixture only, never a report of DSH execution.
    const boundaryRow = (label: string) => ({
      dshExecutableSha256: hash("fixture-cli"), profileIdentitySha256: hash("fixture-profile"),
      hostIdentitySha256: hash(label), observerIdentitySha256: hash(label), identityMatched: true,
      spawnObserved: true, kernelStartIdentityObserved: true, exitObserved: true, exitCode: 0,
      signal: null, timedOut: false, forcedTermination: false, naturalBeforeExitObserved: true, nativeTeardownMarkerObserved: true,
    })
    const completeFixture = {
      probeExecuted: true, executionMode: "source-drift-native-dsh", syntheticProcessFixture: false,
      phaseOne, phaseTwo, processBoundary: { observationSource: "child_process.spawn+linux-procfs", first: boundaryRow("fixture-A"), second: boundaryRow("fixture-B"), secondStartedAfterFirstExit: true, processesDidNotOverlap: true },
      workspace: Object.fromEntries(["identitySha256", "firstProcessEndFilesystemIdentitySha256", "secondProcessStartFilesystemIdentitySha256", "secondProcessEndFilesystemIdentitySha256"].map(key => [key, "cd".repeat(32)])),
      mutation: { file: "capitulos/lote2.tex", utf16LengthBefore: oldLatex.length, utf16LengthAfter: newLatex.length, sha256Before: hash(oldLatex), sha256After: hash(newLatex), afterFirstExit: true, inventoryBefore: beforeInventory, inventoryAfter: phaseTwo.inventoryBeforeContext },
      canonicalBefore: { planId: computePlanIdentity(beforePlan), manuscriptFingerprint: beforePlan.fingerprint, totalBatches: 5, totalCharacters: 595 },
      canonicalAfter: { ...canonicalAfter, totalBatches: 5, totalCharacters: 595 }, parentFinalInventory: inventory(workspace),
    }
    expect(profileEvidenceContract.validateSourceDriftEvidence(completeFixture)).toEqual([])
    expect(profileEvidenceContract.validateSourceDriftEvidence({ ...completeFixture, phaseTwo: { ...phaseTwo, probeExecuted: false } }).length).toBeGreaterThan(0)
    expect(phaseTwo.teardown).toEqual({ disposeCalled: true, agentUnregistered: true, sessionUnregistered: true, teardownFailed: false })
    expect(agents.size).toBe(0)
    expect(sessions.size).toBe(0)
  } finally {
    if (oldKey === undefined) delete process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY
    else process.env.DSHBANCA_DSH_PROFILE_PROCESS_IDENTITY_KEY = oldKey
    if (oldIdentity === undefined) delete process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256
    else process.env.DSHBANCA_DSH_PROFILE_WORKSPACE_IDENTITY_SHA256 = oldIdentity
    rmSync(directory, { recursive: true, force: true })
  }
})

test("selected DSH dependency version checks honor exact and tilde declarations", () => {
  const matches = Reflect.get(profileEvidenceContract, "declaredPackageVersionMatches") as (actualVersion: string, declaredRange: unknown) => boolean
  expect(matches("0.2.1-rc.5", "0.2.1-rc.5")).toBe(true)
  expect(matches("4.0.5", "~4.0.5")).toBe(true)
  expect(matches("4.0.6", "~4.0.5")).toBe(true)
  expect(matches("4.1.0", "~4.0.5")).toBe(false)
  expect(matches("4.0.4", "~4.0.5")).toBe(false)
  expect(matches("4.0.6-rc.1", "~4.0.5")).toBe(false)
  expect(matches("4.0.5", "^4.0.5")).toBe(false)
  expect(matches("bad-version", "~4.0.5")).toBe(false)
})

test("selected DSH package dependency resolution supports both layouts without ancestor fallback", async () => {
  const resolveSelectedDshPackageImpl = Reflect.get(profileEvidenceContract, "resolveSelectedDshPackage") as (
    dshRoot: string,
    packageName: string,
    nodeVersion: string,
  ) => { layout: string; packageRoot: string; manifest: { name: string; version: string }; entryPath: string }
  const resolveSelectedDshPackage = (dshRoot: string, packageName: string, nodeVersion = "v26.7.0") =>
    resolveSelectedDshPackageImpl(dshRoot, packageName, nodeVersion)
  expect(typeof resolveSelectedDshPackage).toBe("function")

  const resolveSelectedDshPackageRoot = Reflect.get(profileEvidenceContract, "resolveSelectedDshPackageRoot") as (executable: string) => string | null
  expect(typeof resolveSelectedDshPackageRoot).toBe("function")
  const directory = mkdtempSync(join(tmpdir(), "dshbanca-native-package-layout-"))
  const targetName = "@deepseek-ai/dsh-agent-preset-registry"
  const installFixture = (dshRoot: string, version: string, layout: "nested" | "sibling", sentinel: string, packageName = targetName) => {
    mkdirSync(join(dshRoot, "lib"), { recursive: true })
    writeFileSync(join(dshRoot, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version, bin: { dsh: "lib/bin.js" } }))
    writeFileSync(join(dshRoot, "lib", "bin.js"), "export {}\n")
    const packageScope = layout === "nested" ? join(dshRoot, "node_modules", "@deepseek-ai") : dirname(dshRoot)
    const packageRoot = join(packageScope, packageName.split("/")[1]!)
    mkdirSync(join(packageRoot, "lib"), { recursive: true })
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version, main: "lib/index.js", exports: { ".": { default: "./lib/index.js" } } }))
    writeFileSync(join(packageRoot, "lib", "index.js"), `export default ${JSON.stringify(sentinel)};\n`)
    return packageRoot
  }

  try {
    const executableRoot = join(directory, "verified-bin-install", "node_modules", "@deepseek-ai", "dsh")
    installFixture(executableRoot, "0.2.1-rc.5", "sibling", "bin-fixture")
    expect(resolveSelectedDshPackageRoot(join(executableRoot, "lib", "bin.js"))).toBe(executableRoot)
    writeFileSync(join(executableRoot, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.2.1-rc.5", bin: { dsh: "lib/other.js" } }))
    writeFileSync(join(executableRoot, "lib", "other.js"), "export {}\n")
    expect(resolveSelectedDshPackageRoot(join(executableRoot, "lib", "bin.js"))).toBeNull()

    const nestedRoot = join(directory, "nested-install", "node_modules", "@deepseek-ai", "dsh")
    const nestedPackageRoot = installFixture(nestedRoot, "0.2.0-rc.2", "nested", "nested-selected")
    const nested = resolveSelectedDshPackage(nestedRoot, targetName)
    expect(nested.layout).toBe("nested")
    expect(nested.packageRoot).toBe(nestedPackageRoot)
    expect(nested.manifest).toMatchObject({ name: targetName, version: "0.2.0-rc.2" })
    expect((await import(`${pathToFileURL(nested.entryPath).href}?test=nested`)).default).toBe("nested-selected")

    const siblingRoot = join(directory, "sibling-install", "node_modules", "@deepseek-ai", "dsh")
    const siblingPackageRoot = installFixture(siblingRoot, "0.2.1-rc.5", "sibling", "sibling-selected")
    const sibling = resolveSelectedDshPackage(siblingRoot, targetName)
    expect(sibling.layout).toBe("sibling")
    expect(sibling.packageRoot).toBe(siblingPackageRoot)
    expect(sibling.manifest).toMatchObject({ name: targetName, version: "0.2.1-rc.5" })
    expect((await import(`${pathToFileURL(sibling.entryPath).href}?test=sibling`)).default).toBe("sibling-selected")

    const precedenceRoot = join(directory, "precedence-install", "node_modules", "@deepseek-ai", "dsh")
    const nestedPreferredRoot = installFixture(precedenceRoot, "0.2.1-rc.5", "nested", "nested-preferred")
    installFixture(precedenceRoot, "0.2.1-rc.5", "sibling", "sibling-decoy")
    const precedence = resolveSelectedDshPackage(precedenceRoot, targetName)
    expect(precedence.layout).toBe("nested")
    expect(precedence.packageRoot).toBe(nestedPreferredRoot)
    expect((await import(`${pathToFileURL(precedence.entryPath).href}?test=precedence`)).default).toBe("nested-preferred")

    const selectedRoot = join(directory, "isolated-install", "node_modules", "@deepseek-ai", "dsh")
    mkdirSync(join(selectedRoot, "lib"), { recursive: true })
    writeFileSync(join(selectedRoot, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.2.1-rc.5", bin: { dsh: "lib/bin.js" } }))
    writeFileSync(join(selectedRoot, "lib", "bin.js"), "export {}\n")
    const ancestorDecoy = join(directory, "node_modules", "@deepseek-ai", targetName.split("/")[1]!)
    mkdirSync(join(ancestorDecoy, "lib"), { recursive: true })
    writeFileSync(join(ancestorDecoy, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": { default: "./lib/index.js" } } }))
    writeFileSync(join(ancestorDecoy, "lib", "index.js"), 'export default "ancestor-decoy";\n')
    expect(() => resolveSelectedDshPackage(selectedRoot, targetName)).toThrow()

    const spoofedRoot = join(directory, "spoofed-install", "node_modules", "@deepseek-ai", "dsh")
    const spoofedPackageRoot = installFixture(spoofedRoot, "0.2.1-rc.5", "sibling", "must-not-load")
    writeFileSync(join(spoofedPackageRoot, "package.json"), JSON.stringify({ name: "@deepseek-ai/not-the-registry", version: "0.2.1-rc.5" }))
    expect(() => resolveSelectedDshPackage(spoofedRoot, targetName)).toThrow()

    const mismatchedRoot = join(directory, "mismatched-install", "node_modules", "@deepseek-ai", "dsh")
    const mismatchedPackageRoot = installFixture(mismatchedRoot, "0.2.1-rc.5", "sibling", "must-not-load")
    writeFileSync(join(mismatchedPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.0-rc.2", main: "lib/index.js", exports: { ".": { default: "./lib/index.js" } } }))
    expect(() => resolveSelectedDshPackage(mismatchedRoot, targetName)).toThrow()

    const hiddenEntryRoot = join(directory, "hidden-entry-install", "node_modules", "@deepseek-ai", "dsh")
    const hiddenEntryPackageRoot = installFixture(hiddenEntryRoot, "0.2.1-rc.5", "sibling", "must-not-load")
    writeFileSync(join(hiddenEntryPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { "./private": "./lib/index.js" } }))
    expect(() => resolveSelectedDshPackage(hiddenEntryRoot, targetName)).toThrow()

    const mixedExportsRoot = join(directory, "mixed-exports-install", "node_modules", "@deepseek-ai", "dsh")
    const mixedExportsPackageRoot = installFixture(mixedExportsRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(mixedExportsPackageRoot, "lib", "public.js"), 'export default "mixed-public";')
    writeFileSync(join(mixedExportsPackageRoot, "lib", "condition.js"), 'export default "mixed-condition";')
    writeFileSync(join(mixedExportsPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": "./lib/public.js", node: "./lib/condition.js" } }))
    expect(() => resolveSelectedDshPackage(mixedExportsRoot, targetName)).toThrow()

    const invalidSubpathRoot = join(directory, "invalid-subpath-install", "node_modules", "@deepseek-ai", "dsh")
    const invalidSubpathPackageRoot = installFixture(invalidSubpathRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(invalidSubpathPackageRoot, "lib", "public.js"), 'export default "invalid-subpath-public";')
    writeFileSync(join(invalidSubpathPackageRoot, "lib", "other.js"), 'export default "invalid-subpath-other";')
    writeFileSync(join(invalidSubpathPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": "./lib/public.js", ".private": "./lib/other.js" } }))
    expect(() => resolveSelectedDshPackage(invalidSubpathRoot, targetName)).toThrow()

    const nodeModulesTargetRoot = join(directory, "node-modules-target-install", "node_modules", "@deepseek-ai", "dsh")
    const nodeModulesTargetPackageRoot = installFixture(nodeModulesTargetRoot, "0.2.1-rc.5", "sibling", "private-main")
    mkdirSync(join(nodeModulesTargetPackageRoot, "node_modules"), { recursive: true })
    writeFileSync(join(nodeModulesTargetPackageRoot, "node_modules", "internal.js"), 'export default "node-modules-target";')
    writeFileSync(join(nodeModulesTargetPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": "./node_modules/internal.js" } }))
    expect(() => resolveSelectedDshPackage(nodeModulesTargetRoot, targetName)).toThrow()

    const encodedSeparatorRoot = join(directory, "encoded-separator-install", "node_modules", "@deepseek-ai", "dsh")
    const encodedSeparatorPackageRoot = installFixture(encodedSeparatorRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(encodedSeparatorPackageRoot, "lib%2Fprivate.js"), 'export default "encoded-separator";')
    writeFileSync(join(encodedSeparatorPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": "./lib%2Fprivate.js" } }))
    expect(() => resolveSelectedDshPackage(encodedSeparatorRoot, targetName)).toThrow()

    const stringExportRoot = join(directory, "string-export-install", "node_modules", "@deepseek-ai", "dsh")
    const stringExportPackageRoot = installFixture(stringExportRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(stringExportPackageRoot, "lib", "public.js"), 'export default "string-export";')
    writeFileSync(join(stringExportPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: "./lib/public.js" }))
    const stringExport = resolveSelectedDshPackage(stringExportRoot, targetName)
    expect(stringExport.entryPath).toBe(join(stringExportPackageRoot, "lib", "public.js"))
    expect((await import(`${pathToFileURL(stringExport.entryPath).href}?test=string-export`)).default).toBe("string-export")

    const nodeConditionRoot = join(directory, "node-condition-install", "node_modules", "@deepseek-ai", "dsh")
    const nodeConditionPackageRoot = installFixture(nodeConditionRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(nodeConditionPackageRoot, "lib", "node.js"), 'export default "node-export";')
    writeFileSync(join(nodeConditionPackageRoot, "lib", "import.js"), 'export default "import-export";')
    writeFileSync(join(nodeConditionPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": { node: "./lib/node.js", import: "./lib/import.js", default: "./lib/index.js" } } }))
    const nodeCondition = resolveSelectedDshPackage(nodeConditionRoot, targetName)
    expect(nodeCondition.entryPath).toBe(join(nodeConditionPackageRoot, "lib", "node.js"))
    expect((await import(`${pathToFileURL(nodeCondition.entryPath).href}?test=node-condition`)).default).toBe("node-export")

    const importConditionRoot = join(directory, "import-condition-install", "node_modules", "@deepseek-ai", "dsh")
    const importConditionPackageRoot = installFixture(importConditionRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(importConditionPackageRoot, "lib", "import.js"), 'export default "import-condition";')
    writeFileSync(join(importConditionPackageRoot, "lib", "node.js"), 'export default "later-node-condition";')
    writeFileSync(join(importConditionPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": { import: "./lib/import.js", node: "./lib/node.js", default: "./lib/index.js" } } }))
    const importCondition = resolveSelectedDshPackage(importConditionRoot, targetName)
    expect(importCondition.entryPath).toBe(join(importConditionPackageRoot, "lib", "import.js"))
    expect((await import(`${pathToFileURL(importCondition.entryPath).href}?test=import-condition`)).default).toBe("import-condition")

    const moduleSyncRoot = join(directory, "module-sync-condition-install", "node_modules", "@deepseek-ai", "dsh")
    const moduleSyncPackageRoot = installFixture(moduleSyncRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(moduleSyncPackageRoot, "lib", "module-sync.js"), 'export default "module-sync-condition";')
    writeFileSync(join(moduleSyncPackageRoot, "lib", "import.js"), 'export default "import-condition";')
    writeFileSync(join(moduleSyncPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": { "module-sync": "./lib/module-sync.js", import: "./lib/import.js", default: "./lib/index.js" } } }))
    expect(resolveSelectedDshPackage(moduleSyncRoot, targetName, "v22.9.0").entryPath).toBe(join(moduleSyncPackageRoot, "lib", "import.js"))
    expect(resolveSelectedDshPackage(moduleSyncRoot, targetName, "v22.10.0").entryPath).toBe(join(moduleSyncPackageRoot, "lib", "module-sync.js"))
    expect(() => resolveSelectedDshPackage(moduleSyncRoot, targetName, "unknown")).toThrow()

    const targetRuntimeRoot = join(directory, "target-runtime-condition-install", "node_modules", "@deepseek-ai", "dsh")
    const targetRuntimePackageRoot = installFixture(targetRuntimeRoot, "0.2.1-rc.5", "sibling", "private-main")
    writeFileSync(join(targetRuntimePackageRoot, "lib", "bun.js"), 'export default "bun-condition";')
    writeFileSync(join(targetRuntimePackageRoot, "lib", "node.js"), 'export default "node-condition";')
    writeFileSync(join(targetRuntimePackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js", exports: { ".": { bun: "./lib/bun.js", node: "./lib/node.js", default: "./lib/index.js" } } }))
    const targetRuntime = resolveSelectedDshPackage(targetRuntimeRoot, targetName)
    expect(targetRuntime.entryPath).toBe(join(targetRuntimePackageRoot, "lib", "node.js"))

    const legacyMainRoot = join(directory, "legacy-main-install", "node_modules", "@deepseek-ai", "dsh")
    const legacyMainPackageRoot = installFixture(legacyMainRoot, "0.2.1-rc.5", "sibling", "legacy-main")
    writeFileSync(join(legacyMainPackageRoot, "package.json"), JSON.stringify({ name: targetName, version: "0.2.1-rc.5", main: "lib/index.js" }))
    expect(resolveSelectedDshPackage(legacyMainRoot, targetName).entryPath).toBe(join(legacyMainPackageRoot, "lib/index.js"))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("abrupt restart is SHA-bound and terminates only the verified owned child after parent persistence checks", () => {
  const source = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const mainStart = source.indexOf("async function main(): Promise<void>")
  const shaAuthorization = source.indexOf("DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SHA256", mainStart)
  const scenarioAuthorization = source.indexOf("DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_SCENARIO", mainStart)
  const firstSpawn = source.indexOf("const abruptFirstBoot = await runDsh", mainStart)
  const persistenceCheck = source.indexOf("verifyParentAbruptRestartPersistence(", firstSpawn)
  const ownershipCheck = source.indexOf("verifyOwnedDshChild(", persistenceCheck)
  const kill = source.indexOf("terminateOwnedDshChild(", ownershipCheck)
  const preSignalInventoryCheck = source.indexOf("preSignalWorkspaceInventorySha256", persistenceCheck)
  const timeoutSignalGuard = source.indexOf("onControlTimeout:", kill)
  const timeoutHardSignal = source.indexOf("onControlHardTimeout:", timeoutSignalGuard)
  const phaseTwoGate = source.indexOf("if (!mayStartAbruptPhaseTwo({", kill)
  const firstCloseCheck = source.indexOf("closeObserved: abruptFirstBoot.closeObserved === true", phaseTwoGate)
  const secondSpawn = source.indexOf("const abruptSecondBoot = await runDsh", phaseTwoGate)
  const secondOptionsEnd = source.indexOf("const abruptSecondSidecar", secondSpawn)
  const secondOptions = source.slice(secondSpawn, secondOptionsEnd)
  const parentHelperStart = source.indexOf("function verifyParentAbruptRestartPersistence(")
  const parentHelperEnd = source.indexOf("\nasync function waitForObserverJson", parentHelperStart)
  const parentHelper = source.slice(parentHelperStart, parentHelperEnd)

  expect(mainStart).toBeGreaterThanOrEqual(0)
  expect(shaAuthorization).toBeGreaterThan(mainStart)
  expect(scenarioAuthorization).toBeGreaterThan(shaAuthorization)
  expect(firstSpawn).toBeGreaterThan(scenarioAuthorization)
  expect(persistenceCheck).toBeGreaterThan(firstSpawn)
  expect(ownershipCheck).toBeGreaterThan(persistenceCheck)
  expect(preSignalInventoryCheck).toBeGreaterThan(persistenceCheck)
  expect(preSignalInventoryCheck).toBeLessThan(kill)
  expect(parentHelperStart).toBeGreaterThanOrEqual(0)
  expect(parentHelper).toContain("computeBatchFindingsDigest")
  expect(parentHelper).toContain("computeAuditSubmissionId")
  expect(parentHelper).toContain("canonicalPlan?.batchIds[2]")
  expect(parentHelper).toContain("canonicalPlan?.batchIds.slice(0, 2)")
  expect(kill).toBeGreaterThan(ownershipCheck)
  expect(timeoutSignalGuard).toBeGreaterThan(kill)
  expect(timeoutHardSignal).toBeGreaterThan(timeoutSignalGuard)
  expect(phaseTwoGate).toBeGreaterThan(kill)
  expect(firstCloseCheck).toBeGreaterThan(phaseTwoGate)
  expect(secondSpawn).toBeGreaterThan(phaseTwoGate)
  expect(secondOptionsEnd).toBeGreaterThan(secondSpawn)
  expect(secondOptions).toContain("onSpawn:")
  expect(secondOptions).toContain("verifyOwnedDshChild")
  expect(secondOptions).toContain("terminateOwnedDshChild")
  expect(secondOptions).toContain("onControlHardTimeout:")
  expect(secondOptions).not.toContain("terminateProcessTree")
  expect(source).toContain("process.kill(pid, requested)")
  expect(source).toContain('report.stages.abruptRestart = {\n      status: "BLOCKED"')
  expect(source).toContain("targetAbsentAfterClose")
  expect(source).toContain("processGroupAbsentAfterClose")
  expect(source).toContain("DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_AUTHORIZED")
  expect(source).toContain("DSHBANCA_DSH_PROFILE_ABRUPT_RESTART_REPORT_PATH")
  expect(source).toContain("lstatSync(target)")
  expect(source).toContain("fsConstants.O_EXCL")
  expect(source).toContain("fsConstants.O_NOFOLLOW")
  expect(source).toContain("fstatSync(parentDescriptor)")
  const observerInitialStart = source.indexOf('if (restartPhase === "abrupt-initial")')
  const observerBarrierPoll = source.indexOf("waitForParentAcknowledgement(", observerInitialStart)
  const readinessWrite = source.indexOf("await writeFile(abruptObserverResultOne", observerInitialStart)
  const validationAckWait = source.indexOf("await parentValidationAcknowledgement", readinessWrite)
  const signalBarrierPoll = source.indexOf("waitForParentAcknowledgement(", validationAckWait + 1)
  const waitingSignalMarker = source.indexOf("writeFileSync(abruptParentAwaitingSignalPath", signalBarrierPoll)
  const parentValidationAck = source.indexOf("writeFileSync(abruptParentAcknowledgementPath", firstSpawn)
  const parentWaitingSignalRead = source.indexOf("waitForObserverJson(abruptParentAwaitingSignalPath", parentValidationAck)
  const parentExperimentalKill = source.indexOf('"SIGKILL", mayContinue', parentWaitingSignalRead)
  expect(observerInitialStart).toBeGreaterThanOrEqual(0)
  expect(observerBarrierPoll).toBeLessThan(readinessWrite)
  expect(readinessWrite).toBeLessThan(validationAckWait)
  expect(validationAckWait).toBeLessThan(signalBarrierPoll)
  expect(signalBarrierPoll).toBeLessThan(waitingSignalMarker)
  expect(parentValidationAck).toBeGreaterThan(persistenceCheck)
  expect(parentWaitingSignalRead).toBeGreaterThan(parentValidationAck)
  expect(parentExperimentalKill).toBeGreaterThan(parentWaitingSignalRead)
  const secondAbsenceStart = source.indexOf("abruptSecondProcessAbsenceDecision(", secondSpawn)
  const secondProofStart = source.indexOf("const abruptSecondProof", secondSpawn)
  const secondSpawnToProof = source.slice(secondSpawn, secondProofStart)
  const secondProofEnd = source.indexOf("const phaseTwo =", secondProofStart)
  const secondProof = source.slice(secondProofStart, secondProofEnd)
  const teardownStart = source.indexOf("teardown: {", secondProofEnd)
  const teardownEnd = source.indexOf("const abruptErrors", teardownStart)
  const teardown = source.slice(teardownStart, teardownEnd)
  expect(secondAbsenceStart).toBeGreaterThan(secondSpawn)
  expect(secondAbsenceStart).toBeLessThan(secondProofStart)
  expect(secondSpawnToProof).toContain("preserveScratchForSafety = true")
  expect(secondSpawnToProof).toContain("linuxProcessGroupIdOfProcess(")
  expect(secondSpawnToProof).toContain("abruptPrivateProcessGroupIdMatchesChildPid(")
  for (const field of ["closeObserved", "processGroupIdObserved", "targetAbsentAfterClose", "processGroupAbsentAfterClose"]) {
    expect(secondProof).toContain(`${field}:`)
  }
  expect(teardownStart).toBeGreaterThan(secondProofEnd)
  expect(teardown).toContain("secondTargetAbsentAfterClose")
  expect(teardown).toContain("secondProcessGroupAbsentAfterClose")
  const readinessRetention = source.indexOf("abruptReadinessSidecar = sidecar", firstSpawn)
  const barrierIdentityRetention = source.indexOf("abruptBarrierObserverIdentitySha256 =", firstSpawn)
  const builderCallStart = source.indexOf("const abruptEvidence = buildAbruptRestartEvidence({", secondSpawn)
  const builderCallEnd = source.indexOf("const abruptErrors", builderCallStart)
  const builderCall = source.slice(builderCallStart, builderCallEnd)
  expect(readinessRetention).toBeGreaterThan(firstSpawn)
  expect(readinessRetention).toBeLessThan(secondSpawn)
  expect(barrierIdentityRetention).toBeGreaterThan(persistenceCheck)
  expect(barrierIdentityRetention).toBeLessThan(secondSpawn)
  expect(builderCallStart).toBeGreaterThan(secondSpawn)
  expect(builderCallEnd).toBeGreaterThan(builderCallStart)
  expect(builderCall).toContain("phaseOneSidecar: abruptReadinessSidecar")
  expect(builderCall).toContain("phaseTwoSidecar: abruptSecondSidecar")
  expect(builderCall).toContain("parentObservedHostIdentitySha256:")
  expect(builderCall).toContain("barrierObserverIdentitySha256: abruptBarrierObserverIdentitySha256")
  expect(builderCall).toContain("firstProcess: firstProcessObservation")
  expect(builderCall).toContain("secondProcess: abruptSecondProof")
  expect(source).toContain("export function buildAbruptRestartEvidence(")
  expect(source).toContain("export function abruptFirstProcessIdentityFields(")
  expect(source).not.toContain("abruptPhaseOne?.observerProcessIdentitySha256")
  const resumeExpectationStart = source.indexOf("const abruptResumeExpectation = buildAbruptResumeExpectation(", phaseTwoGate)
  const resumeEnvStart = source.indexOf("const abruptResumeEnv", phaseTwoGate)
  const resumeEnvEnd = source.indexOf("let abruptSecondChild", resumeEnvStart)
  const resumeEnv = source.slice(resumeEnvStart, resumeEnvEnd)
  expect(source).toContain("export function buildAbruptResumeExpectation(")
  expect(resumeExpectationStart).toBeGreaterThan(phaseTwoGate)
  expect(resumeExpectationStart).toBeLessThan(secondSpawn)
  expect(resumeEnvStart).toBeGreaterThan(resumeExpectationStart)
  expect(resumeEnvEnd).toBeGreaterThan(resumeEnvStart)
  expect(resumeEnv).toContain('DSHBANCA_DSH_PROFILE_PHASE: "abrupt-resume"')
  expect(resumeEnv).toContain("JSON.stringify(abruptResumeExpectation)")
  expect(resumeEnv).not.toContain("phaseOne: abruptPhaseOne")
  expect(resumeEnv).not.toContain("parentVerifiedPersistence,")
  const killHelperStart = source.indexOf("export function terminateOwnedDshChild(")
  const killHelperEnd = source.indexOf("\nfunction processTargetAbsentAfterClose", killHelperStart + 1)
  const killHelper = source.slice(killHelperStart, killHelperEnd)
  expect(killHelper).toContain("child.pid")
  expect(killHelper).toContain("linuxProcessIdentitySha256")
  expect(killHelper).not.toContain("process.kill(-")
  expect(killHelper).not.toContain("terminateProcessTree")
})

test("every #107 subprocess class is wired to the verified-direct-child containment authority", () => {
  const source = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  const mainStart = source.indexOf("async function main(): Promise<void>")
  const runCliStart = source.indexOf("async function runCli(): Promise<void>")
  expect(mainStart).toBeGreaterThanOrEqual(0)
  expect(runCliStart).toBeGreaterThan(mainStart)
  const mainSource = source.slice(mainStart, runCliStart)
  // Every launch in main() must carry the strict policy stage label AND the
  // parent-owned identity key; there is no raw launch without policy options.
  const rawRunCalls = [...mainSource.matchAll(/await run\(/g)]
  const rawDshCalls = [...mainSource.matchAll(/await runDsh\(/g)]
  const rawPtyCalls = [...mainSource.matchAll(/await runDshWithPty\(/g)]
  expect(rawRunCalls.length).toBe(2)
  expect(rawDshCalls.length).toBe(8)
  expect(rawPtyCalls.length).toBe(1)
  const launchSlices = [...rawRunCalls, ...rawDshCalls, ...rawPtyCalls]
    .map((match) => mainSource.slice(match.index!, match.index! + 900))
  for (const launch of launchSlices) {
    expect(launch).toContain("containmentStage:")
    expect(launch).toContain("processIdentityKey")
  }
  const stagedClasses = [
    "pnpm-preflight",
    "profile-setup",
    "repository-build",
    "native-bundle-install",
    "pty-dump-config",
    "cross-process-first",
    "cross-process-second",
    "source-drift-first",
    "source-drift-second",
    "abrupt-phase-a",
    "abrupt-phase-b",
  ]
  for (const stage of stagedClasses) {
    const index = mainSource.indexOf(`"${stage}"`)
    expect(index, stage).toBeGreaterThanOrEqual(0)
    const launch = mainSource.slice(Math.max(0, index - 700), index + 200)
    expect(launch, stage).toContain("processIdentityKey")
  }
  // Abrupt A/B keep the controlled onSpawn path with parent-owned identity.
  const abruptCalls = rawDshCalls
    .map((match) => mainSource.slice(match.index!, match.index! + 1200))
    .filter((call) => call.includes("onSpawn:"))
  expect(abruptCalls.length).toBe(2)
  expect(abruptCalls.every((call) => call.includes("containmentStage: \"abrupt-phase-"))).toBe(true)
  // Implicit spawnSync timeouts were replaced by the bounded policy-aware runner.
  expect(source).not.toContain("spawnSync")
  for (const helper of ["async function commandVersion(", "async function gitValue(", "async function repoStatus("]) {
    expect(source).toContain(helper)
  }
  // Group/tree containment is legacy-only and its dependencies are injectable so
  // a regression cannot emit a real negative-PID signal from the tests.
  const legacyStart = source.indexOf("function terminateProcessTree(")
  const legacyEnd = source.indexOf("\nfunction hashFile(", legacyStart)
  const legacy = source.slice(legacyStart, legacyEnd)
  expect(legacyStart).toBeGreaterThanOrEqual(0)
  expect(legacy).toContain('runnerContainmentPolicy === "strict-direct-only"')
  expect(legacy).toContain("dependencies.kill(-child.pid")
  expect(legacy).toContain("dependencies.setTimeout(")
  expect((source.match(/terminateProcessTree\(/g) ?? []).length).toBe(2)
  expect(source).toContain("terminateProcessTree(child, {")
  expect(source).toContain("if (!strictContainment)")
  expect(source).toContain("beginStrictTimeoutContainment")
  expect(source).toContain("const runnerContainmentPolicy: ContainmentPolicy = selectContainmentPolicy(process.env)")
  expect(source).toContain("export function selectContainmentPolicy(")
  expect(source).toContain("export function resolveCommandExecutableForIdentity(")
  expect(source).toContain("export function verifyProcessExecutableIdentity(")
  expect(source).toContain("error instanceof ContainmentAuthorityAbort")
  expect(source).toContain("export class ContainmentAuthorityAbort")
  expect(source).toContain("containmentRequiresScratchPreservation(")
  expect(source).toContain("containmentAuthorityReportSnapshot()")
})
