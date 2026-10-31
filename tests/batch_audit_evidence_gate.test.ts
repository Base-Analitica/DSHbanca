import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  symlinkSync,
  chmodSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { bancaContext } from "../src/tools/banca_context"
import { bancaAuditar } from "../src/tools/banca_auditar"
import { bancaSintese } from "../src/tools/banca_sintese"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import {
  computePlanIdentity,
  createAnalysisCheckpoint,
  completeAnalysisBatch,
} from "../src/lib/analysis_checkpoint"
import { createAnalysisFinding } from "../src/lib/analysis_findings"
import {
  createBatchAuditConfirmation,
  BATCH_AUDIT_CONFIRMATION_VERSION,
  type BatchAuditConfirmation,
} from "../src/lib/analysis_audit_confirmation"
import {
  ANALYSIS_FINDINGS_STORE_VERSION,
  ANALYSIS_AUDIT_CONFIRMATIONS_STORE_VERSION,
  loadAnalysisCheckpoint,
  saveAnalysisCheckpoint,
  loadAnalysisFindings,
  loadAnalysisAuditConfirmations,
  saveAnalysisAuditConfirmations,
  recordBatchAuditConfirmation,
  saveAnalysisFindings,
} from "../src/lib/state"

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
}

function writeProject(
  root: string,
  opts?: {
    maxCharactersPerBatch?: number
    chapters?: string[]
    mainContent?: string
    introContent?: string
    metodoContent?: string
  },
): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(
    join(root, ".banca", "project.json"),
    JSON.stringify(
      {
        version: 1,
        manuscript: {
          format: "latex",
          root: ".",
          main: "main.tex",
          bib: "refs.bib",
          chapters: opts?.chapters ?? ["capitulos/*.tex"],
          outputDir: "trabalhos",
        },
        compile: { enabled: false, command: [] },
        allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
        protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
        immutableFacts: [],
        externalDependencies: [],
        rubricProfile: "banca-rigorosa",
        targetScore: 9.0,
        mcp: { crossrefAcademicEnabled: false },
        analysis: {
          coverageMode: "exhaustive",
          maxCharactersPerBatch: opts?.maxCharactersPerBatch ?? 100,
        },
      },
      null,
      2,
    ),
    "utf-8",
  )

  writeTree(root, {
    "main.tex":
      opts?.mainContent ??
      "\\documentclass{article}\n\\begin{document}\n\\include{capitulos/intro}\n\\include{capitulos/metodo}\n\\end{document}\n",
    "capitulos/intro.tex":
      opts?.introContent ??
      "Primeiro capitulo sintetico para analise academica exaustiva com conteudo estruturado para formar um lote proprio e exigir segmentacao.\n",
    "capitulos/metodo.tex":
      opts?.metodoContent ??
      "Segundo capitulo sintetico com conteudo de metodologia analitica independente para garantir o segundo lote obrigatorio do plano.\n",
    "refs.bib": "@article{ref1, title={Ref 1}}\n",
  })
}

function getPlan(root: string) {
  const config = loadConfig(root)
  const manuscript = loadCanonicalLatexManuscript(root, config)
  const plan = planExhaustiveAnalysisBatches(
    manuscript,
    config.analysis.maxCharactersPerBatch,
  )
  const planId = computePlanIdentity(plan)
  return { config, manuscript, plan, planId }
}

describe("Issue #44: Batch audit evidence gate", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "gate-44-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("RED->GREEN: checkpoint advance and synthesis require durable audit confirmation for all batches", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    expect(plan.batches.length).toBeGreaterThanOrEqual(2)

    const ctx = { directory: projectRoot } as any

    // 1. Initialize context
    const initRes = await bancaContext.execute({ projectRoot }, ctx)
    expect(initRes).toMatch(/^context → /)

    let cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.state).toBe("pending")
    expect(cp?.completedBatches).toBe(0)

    // 2. Attempt to advance batch 0 without audit -> BLOCKED
    const unconfirmedAdvance = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(unconfirmedAdvance).toContain("context checkpoint error")
    expect(unconfirmedAdvance).toContain("code=missing_batch_audit")

    // Checkpoint did NOT advance
    cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.state).toBe("pending")
    expect(cp?.completedBatches).toBe(0)

    // 3. Legitimate audit with zero findings
    const auditRes0 = await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[0].batchId,
        findings: [],
      },
      ctx,
    )
    expect(auditRes0).not.toContain("audit validation error")
    expect(JSON.parse(auditRes0).kind).toBe("openbanca-audit-receipt-v2")

    // 4. Now advance batch 0 -> SUCCEEDS
    const advanceRes0 = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(advanceRes0).toMatch(/^context → /)
    cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.state).toBe("running")
    expect(cp?.completedBatches).toBe(1)

    // 5. Synthesis attempted with partial audit -> BLOCKED (missing confirmation for batch 1)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [],
    })

    const partialSintese = await bancaSintese.execute({ projectRoot }, ctx)
    expect(partialSintese).toContain("synthesis input error")
    // Checkpoint is still running (incomplete_coverage)
    expect(partialSintese).toContain("code=incomplete_coverage")

    // 6. Complete remaining batches legitimately
    for (let i = 1; i < plan.batches.length; i++) {
      const b = plan.batches[i]
      const auditRes = await bancaAuditar.execute(
        {
          projectRoot,
          manuscriptFingerprint: plan.fingerprint!,
          batchId: b.batchId,
          findings: [],
        },
        ctx,
      )
      expect(auditRes).not.toContain("audit validation error")

      const advRes = await bancaContext.execute(
        { projectRoot, completedBatchId: b.batchId },
        ctx,
      )
      expect(advRes).toMatch(/^context → /)
    }

    cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.state).toBe("complete")
    expect(cp?.completedBatches).toBe(plan.batches.length)

    // 7. Synthesis now succeeds!
    const finalSintese = await bancaSintese.execute({ projectRoot }, ctx)
    expect(finalSintese).not.toContain("synthesis input error")
    const parsedSintese = JSON.parse(finalSintese)
    expect(parsedSintese.coverage.state).toBe("complete")
    expect(parsedSintese.coverage.completedBatches).toBe(plan.batches.length)
  })

  test("negative: confirmation with incorrect fingerprint is rejected", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    // Forged confirmation with wrong fingerprint
    const forged: BatchAuditConfirmation = {
      version: BATCH_AUDIT_CONFIRMATION_VERSION,
      planId,
      manuscriptFingerprint: "f".repeat(64),
      batchId: plan.batches[0].batchId,
      batchIndex: 0,
      acceptedCount: 0,
      disclaimer: "test",
    }
    // Writing store directly with wrong fingerprint
    saveAnalysisAuditConfirmations(projectRoot, {
      version: ANALYSIS_AUDIT_CONFIRMATIONS_STORE_VERSION,
      planId,
      manuscriptFingerprint: "f".repeat(64),
      confirmations: [forged],
    })

    const result = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(result).toContain("context checkpoint error")
    expect(result).toContain("code=incompatible_batch_audit")

    // Checkpoint did not advance
    const cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.completedBatches).toBe(0)
  })

  test("negative: confirmation of another plan is rejected", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    // Confirmation for a different planId
    const otherPlanId = "0".repeat(64)
    const otherConfirmation: BatchAuditConfirmation = {
      version: BATCH_AUDIT_CONFIRMATION_VERSION,
      planId: otherPlanId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
      batchIndex: 0,
      acceptedCount: 0,
      disclaimer: "test",
    }
    saveAnalysisAuditConfirmations(projectRoot, {
      version: ANALYSIS_AUDIT_CONFIRMATIONS_STORE_VERSION,
      planId: otherPlanId,
      manuscriptFingerprint: plan.fingerprint!,
      confirmations: [otherConfirmation],
    })

    // Current plan has no confirmation
    const result = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(result).toContain("code=missing_batch_audit")
  })

  test("negative: unknown batch is rejected without mutating checkpoint", async () => {
    writeProject(projectRoot)
    const { planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    const result = await bancaContext.execute(
      { projectRoot, completedBatchId: "nonexistent-batch-id" },
      ctx,
    )
    expect(result).toContain("code=unknown_batch")

    const cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.completedBatches).toBe(0)
  })

  test("negative: out-of-order batch advance is rejected", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    // Audit batch 1 in advance
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[1].batchId,
        findings: [],
      },
      ctx,
    )

    // Attempt to complete batch 1 when batch 0 is expected
    const result = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[1].batchId },
      ctx,
    )
    expect(result).toContain("code=out_of_order")

    const cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.completedBatches).toBe(0)
  })

  test("idempotence: repeated audit of same batch does not duplicate progress", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    // First audit
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[0].batchId,
        findings: [],
      },
      ctx,
    )

    let auditStore = loadAnalysisAuditConfirmations(projectRoot, planId)
    expect(auditStore?.confirmations.length).toBe(1)

    // Second audit of the same batch
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[0].batchId,
        findings: [],
      },
      ctx,
    )

    auditStore = loadAnalysisAuditConfirmations(projectRoot, planId)
    expect(auditStore?.confirmations.length).toBe(1)
  })

  test("negative: corrupted confirmation store fails closed", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    // Write malformed JSON in audit store
    const storePath = join(
      projectRoot,
      ".banca",
      "analysis",
      "audit-confirmations",
      `${planId}.json`,
    )
    mkdirSync(dirname(storePath), { recursive: true })
    writeFileSync(storePath, "{not-json", "utf-8")

    const result = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(result).toContain("context checkpoint error")
    expect(result).toContain("code=invalid_audit_store")
  })

  test("negative: tampered confirmation record fails closed", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    const storePath = join(
      projectRoot,
      ".banca",
      "analysis",
      "audit-confirmations",
      `${planId}.json`,
    )
    mkdirSync(dirname(storePath), { recursive: true })
    // Tampered: negative acceptedCount
    writeFileSync(
      storePath,
      JSON.stringify({
        version: ANALYSIS_AUDIT_CONFIRMATIONS_STORE_VERSION,
        planId,
        manuscriptFingerprint: plan.fingerprint!,
        confirmations: [
          {
            version: BATCH_AUDIT_CONFIRMATION_VERSION,
            planId,
            manuscriptFingerprint: plan.fingerprint!,
            batchId: plan.batches[0].batchId,
            batchIndex: 0,
            acceptedCount: -1,
            disclaimer: "test",
          },
        ],
      }),
      "utf-8",
    )

    const result = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(result).toContain("context checkpoint error")
    expect(result).toContain("code=invalid_audit_store")
  })

  test("negative: symlink in storage directory is refused", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    // Create decoy directory and symlink .banca/analysis/audit-confirmations to it
    const decoyDir = join(projectRoot, "decoy-confirmations")
    mkdirSync(decoyDir, { recursive: true })
    const linkPath = join(projectRoot, ".banca", "analysis", "audit-confirmations")
    mkdirSync(dirname(linkPath), { recursive: true })
    symlinkSync(decoyDir, linkPath)

    const result = await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[0].batchId,
        findings: [],
      },
      ctx,
    )
    expect(result).toContain("audit validation error")
    expect(result).toContain("code=symlink_refused")
  })

  test("resume after restart without completedBatchId does not advance", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    await bancaContext.execute({ projectRoot }, ctx)
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[0].batchId,
        findings: [],
      },
      ctx,
    )
    await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )

    const cpBefore = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cpBefore?.completedBatches).toBe(1)

    // Call context without completedBatchId (restart/resume)
    const resumeRes = await bancaContext.execute({ projectRoot }, ctx)
    expect(resumeRes).toMatch(/^context → /)

    const cpAfter = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cpAfter).toEqual(cpBefore)
  })

  test("manuscript alteration invalidates prior audit evidence and plan identity", async () => {
    writeProject(projectRoot)
    const { plan: plan1, planId: planId1 } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    // Audit and complete batch 0 for plan 1
    await bancaContext.execute({ projectRoot }, ctx)
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan1.fingerprint!,
        batchId: plan1.batches[0].batchId,
        findings: [],
      },
      ctx,
    )
    await bancaContext.execute(
      { projectRoot, completedBatchId: plan1.batches[0].batchId },
      ctx,
    )

    // Alter manuscript content
    writeFileSync(
      join(projectRoot, "capitulos", "intro.tex"),
      "Texto completamente alterado para invalidar o fingerprint e o plano anterior.\n",
      "utf-8",
    )

    const { plan: plan2, planId: planId2 } = getPlan(projectRoot)
    expect(planId2).not.toBe(planId1)
    expect(plan2.fingerprint).not.toBe(plan1.fingerprint)

    // Attempting to complete new batch using old evidence fails
    const res = await bancaContext.execute(
      { projectRoot, completedBatchId: plan2.batches[0].batchId },
      ctx,
    )
    expect(res).toContain("code=missing_batch_audit")
  })

  test("maxCharactersPerBatch change alters planId and invalidates prior evidence", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan: plan1 } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    await bancaContext.execute({ projectRoot }, ctx)
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan1.fingerprint!,
        batchId: plan1.batches[0].batchId,
        findings: [],
      },
      ctx,
    )
    await bancaContext.execute(
      { projectRoot, completedBatchId: plan1.batches[0].batchId },
      ctx,
    )

    // Change maxCharactersPerBatch in config
    writeProject(projectRoot, { maxCharactersPerBatch: 50 })
    const { plan: plan2, planId: planId2 } = getPlan(projectRoot)
    expect(plan2.batches.length).toBeGreaterThan(plan1.batches.length)

    // New plan has no audit confirmation
    const res = await bancaContext.execute(
      { projectRoot, completedBatchId: plan2.batches[0].batchId },
      ctx,
    )
    expect(res).toContain("code=missing_batch_audit")
  })

  test("legacy complete checkpoint without audit confirmations is rejected by banca_sintese", async () => {
    writeProject(projectRoot)
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    // Forge complete checkpoint (simulate legacy checkpoint)
    let cp = createAnalysisCheckpoint(plan)
    for (const b of plan.batches) {
      cp = completeAnalysisBatch(plan, cp, b.batchId)
    }
    expect(cp.state).toBe("complete")
    saveAnalysisCheckpoint(projectRoot, cp)

    // Save findings store
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [],
    })

    // BUT NO audit confirmations store exists on disk!
    const sinteseRes = await bancaSintese.execute({ projectRoot }, ctx)
    expect(sinteseRes).toContain("synthesis input error")
    expect(sinteseRes).toContain("code=missing_audit_confirmation")
    expect(sinteseRes).toContain(
      "no persisted audit confirmations exist for the current plan",
    )
  })

  test("valid empty manuscript (0 batches) succeeds synthesis without confirmations", async () => {
    // Empty manuscript with zero characters in main.tex and no chapters
    writeProject(projectRoot, {
      mainContent: "",
      chapters: [],
    })
    const { plan, planId } = getPlan(projectRoot)
    expect(plan.batches.length).toBe(0)
    expect(plan.status).toBe("complete")

    const ctx = { directory: projectRoot } as any
    await bancaContext.execute({ projectRoot }, ctx)

    const cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.state).toBe("complete")
    expect(cp?.totalBatches).toBe(0)

    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [],
    })

    const sinteseRes = await bancaSintese.execute({ projectRoot }, ctx)
    expect(sinteseRes).not.toContain("synthesis input error")
    const parsed = JSON.parse(sinteseRes)
    expect(parsed.coverage.state).toBe("complete")
    expect(parsed.coverage.totalBatches).toBe(0)
    expect(parsed.findings).toEqual([])
  })

  test("P1 regression: fabricated confirmations without banca_auditar cannot advance checkpoint or release synthesis", async () => {
    writeProject(projectRoot, {
      maxCharactersPerBatch: 50,
      introContent:
        "Primeiro capitulo sintetico para analise academica com texto longo o bastante para dividir em multiplos lotes ordenados.\\n",
      metodoContent:
        "Segundo capitulo sintetico de metodologia para segmentar em ainda mais lotes exaustivos da analise.\\n",
    })
    const { plan, planId } = getPlan(projectRoot)
    expect(plan.batches.length).toBeGreaterThanOrEqual(4)
    const ctx = { directory: projectRoot } as any

    await bancaContext.execute({ projectRoot }, ctx)
    const initialCp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(initialCp?.completedBatches).toBe(0)

    // Fabricate confirmations using createBatchAuditConfirmation(plan, batch, 0)
    const fabricatedConfirmations = plan.batches.map((b) =>
      createBatchAuditConfirmation(plan, b, 0),
    )
    saveAnalysisAuditConfirmations(projectRoot, {
      version: ANALYSIS_AUDIT_CONFIRMATIONS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      confirmations: fabricatedConfirmations,
    })

    // Save empty findings store
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [],
    })

    // For each batchId, attempt to advance with banca_context
    let advances = 0
    for (const batch of plan.batches) {
      const res = await bancaContext.execute(
        { projectRoot, completedBatchId: batch.batchId },
        ctx,
      )
      if (
        !res.includes("context checkpoint error") &&
        !res.includes("missing_batch_audit")
      ) {
        advances++
      }
    }

    const checkpoint = loadAnalysisCheckpoint(projectRoot, planId)
    const synthRes = await bancaSintese.execute({ projectRoot }, ctx)
    const synthOk = !synthRes.includes("synthesis input error")

    // Assert that the vulnerability from review #5725015784 is BLOCKED
    expect(advances).toBe(0)
    expect(checkpoint?.state).not.toBe("complete")
    expect(synthOk).toBe(false)
    expect(synthRes).toContain("synthesis input error")
  })

  test("negative: confirmation count or digest incompatible with stored findings fails closed", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: plan.batches[0].batchId,
        findings: [
          {
            category: "estrutura",
            severity: "media",
            claim: "claim text for batch 0",
            evidence: "evidence text",
            file: "capitulos/intro.tex",
            startLine: 1,
            endLine: 1,
            sectionId: "sec1",
          },
        ],
      },
      ctx,
    )

    // Tamper with the confirmation: change acceptedCount to 0 while store has 1 finding
    const auditStore = loadAnalysisAuditConfirmations(projectRoot, planId)!
    auditStore.confirmations[0] = {
      ...auditStore.confirmations[0],
      acceptedCount: 0,
    }
    saveAnalysisAuditConfirmations(projectRoot, auditStore)

    const advanceRes = await bancaContext.execute(
      { projectRoot, completedBatchId: plan.batches[0].batchId },
      ctx,
    )
    expect(advanceRes).toContain("context checkpoint error")
    expect(advanceRes).toContain("code=incompatible_batch_audit")
  })

  test("negative: findings store altered after audit fails closed", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    for (const batch of plan.batches) {
      await bancaAuditar.execute(
        {
          projectRoot,
          manuscriptFingerprint: plan.fingerprint!,
          batchId: batch.batchId,
          findings: [],
        },
        ctx,
      )
      await bancaContext.execute(
        { projectRoot, completedBatchId: batch.batchId },
        ctx,
      )
    }
    const cp = loadAnalysisCheckpoint(projectRoot, planId)
    expect(cp?.state).toBe("complete")

    // Tamper with the findings store: inject an unexpected finding for batch 0
    const injectedFinding = createAnalysisFinding(plan, {
      category: "estrutura",
      severity: "media",
      claim: "tampered valid claim",
      evidence: "tampered evidence",
      file: "capitulos/intro.tex",
      startLine: 1,
      endLine: 1,
      sectionId: "sec1",
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })
    const store = loadAnalysisFindings(projectRoot, planId)!
    store.findings.push(injectedFinding)
    saveAnalysisFindings(projectRoot, store)

    const synthRes = await bancaSintese.execute({ projectRoot }, ctx)
    expect(synthRes).toContain("synthesis input error")
    expect(synthRes).toContain("code=incompatible_batch_audit")
  })

  test("positive: legitimate banca_auditar submission with zero findings advances checkpoint and synthesizes cleanly", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    for (const batch of plan.batches) {
      const auditRes = await bancaAuditar.execute(
        {
          projectRoot,
          manuscriptFingerprint: plan.fingerprint!,
          batchId: batch.batchId,
          findings: [],
        },
        ctx,
      )
      expect(auditRes).toContain('"acceptedCount":0')

      const advanceRes = await bancaContext.execute(
        { projectRoot, completedBatchId: batch.batchId },
        ctx,
      )
      expect(advanceRes).not.toContain("context checkpoint error")
    }

    const checkpoint = loadAnalysisCheckpoint(projectRoot, planId)
    expect(checkpoint?.state).toBe("complete")

    const synthRes = await bancaSintese.execute({ projectRoot }, ctx)
    expect(synthRes).not.toContain("synthesis input error")
    const parsed = JSON.parse(synthRes)
    expect(parsed.coverage.state).toBe("complete")
  })

  test("P1 regression (#5725144182): multiple incremental submissions to the same batch accumulate canonical findings cleanly", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    const batch0 = plan.batches[0]

    // 1. First audit of batch 0 with finding A
    const resA = await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch0.batchId,
        findings: [
          {
            category: "estrutura",
            severity: "media",
            claim: "claim A for batch 0",
            evidence: "evidence A",
            file: "capitulos/intro.tex",
            startLine: 1,
            endLine: 1,
            sectionId: "sec1",
          },
        ],
      },
      ctx,
    )
    expect(resA).toContain('"acceptedCount":1')
    expect(resA).toContain('"addedCount":1')
    expect(resA).toContain('"totalCount":1')

    // 2. Second audit of same batch 0 with distinct finding B
    const resB = await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch0.batchId,
        findings: [
          {
            category: "clareza",
            severity: "baixa",
            claim: "claim B for batch 0",
            evidence: "evidence B",
            file: "capitulos/intro.tex",
            startLine: 1,
            endLine: 1,
            sectionId: "sec1",
          },
        ],
      },
      ctx,
    )
    expect(resB).toContain('"acceptedCount":1')
    expect(resB).toContain('"addedCount":1')
    expect(resB).toContain('"totalCount":2')

    // 3. banca_context must advance batch 0 cleanly (no incompatible_batch_audit!)
    const advanceRes = await bancaContext.execute(
      { projectRoot, completedBatchId: batch0.batchId },
      ctx,
    )
    expect(advanceRes).not.toContain("context checkpoint error")
    expect(advanceRes).not.toContain("incompatible_batch_audit")

    const checkpoint = loadAnalysisCheckpoint(projectRoot, planId)
    expect(checkpoint?.completedBatches).toBe(1)
  })

  test("incremental submission: replay of exact identical finding is deduplicated and preserves coherence", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    const batch0 = plan.batches[0]

    const finding = {
      category: "estrutura",
      severity: "media",
      claim: "repeated claim for batch 0",
      evidence: "evidence text",
      file: "capitulos/intro.tex",
      startLine: 1,
      endLine: 1,
      sectionId: "sec1",
    }

    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch0.batchId,
        findings: [finding],
      },
      ctx,
    )

    // Replay identical finding
    const replayRes = await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch0.batchId,
        findings: [finding],
      },
      ctx,
    )
    expect(replayRes).toContain('"acceptedCount":1')
    expect(replayRes).toContain('"addedCount":0')
    expect(replayRes).toContain('"duplicateCount":1')
    expect(replayRes).toContain('"totalCount":1')

    // Checkpoint advances without error
    const advanceRes = await bancaContext.execute(
      { projectRoot, completedBatchId: batch0.batchId },
      ctx,
    )
    expect(advanceRes).not.toContain("context checkpoint error")
  })

  test("incremental submission: zero findings call after non-empty audit preserves previous findings", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    const batch0 = plan.batches[0]

    // Initial audit with 1 finding
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch0.batchId,
        findings: [
          {
            category: "estrutura",
            severity: "media",
            claim: "claim before empty call",
            evidence: "evidence text",
            file: "capitulos/intro.tex",
            startLine: 1,
            endLine: 1,
            sectionId: "sec1",
          },
        ],
      },
      ctx,
    )

    // Second audit with zero findings
    const emptyRes = await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch0.batchId,
        findings: [],
      },
      ctx,
    )
    expect(emptyRes).toContain('"acceptedCount":0')
    expect(emptyRes).toContain('"addedCount":0')
    expect(emptyRes).toContain('"totalCount":1')

    // Stored findings must NOT have been wiped out
    const store = loadAnalysisFindings(projectRoot, planId)
    expect(store?.findings.length).toBe(1)

    // Checkpoint advances cleanly
    const advanceRes = await bancaContext.execute(
      { projectRoot, completedBatchId: batch0.batchId },
      ctx,
    )
    expect(advanceRes).not.toContain("context checkpoint error")
  })

  test("persistence failure during banca_auditar fails closed without advancing checkpoint", async () => {
    writeProject(projectRoot, { maxCharactersPerBatch: 100 })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any
    const batch0 = plan.batches[0]

    const bancaDir = join(projectRoot, ".banca")
    chmodSync(bancaDir, 0o555)

    try {
      const auditRes = await bancaAuditar.execute(
        {
          projectRoot,
          manuscriptFingerprint: plan.fingerprint!,
          batchId: batch0.batchId,
          findings: [
            {
              category: "estrutura",
              severity: "media",
              claim: "claim on un-writable store",
              evidence: "evidence text",
              file: "capitulos/intro.tex",
              startLine: 1,
              endLine: 1,
              sectionId: "sec1",
            },
          ],
        },
        ctx,
      )
      expect(auditRes).toContain("audit validation error")
      expect(auditRes).toContain("code=invalid_findings_storage")

      // Attempting to advance batch 0 must fail closed
      const advanceRes = await bancaContext.execute(
        { projectRoot, completedBatchId: batch0.batchId },
        ctx,
      )
      expect(advanceRes).toContain("context checkpoint error")
    } finally {
      chmodSync(bancaDir, 0o755)
    }
  })

  test("trust model authenticity boundary: workspace-internal forgery passes consistency but does not prove host execution", async () => {
    writeProject(projectRoot, {
      maxCharactersPerBatch: 50,
      introContent:
        "Primeiro capitulo com texto suficiente para gerar lotes multiplos.\\n",
      metodoContent:
        "Segundo capitulo com metodologia independente para gerar mais lotes.\\n",
    })
    const { plan, planId } = getPlan(projectRoot)
    const ctx = { directory: projectRoot } as any

    // Direct filesystem fabrication using the pure consistency helper
    const fabricatedConfirmations = plan.batches.map((b) =>
      createBatchAuditConfirmation(plan, b, { findings: [] }),
    )
    saveAnalysisAuditConfirmations(projectRoot, {
      version: ANALYSIS_AUDIT_CONFIRMATIONS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      confirmations: fabricatedConfirmations,
    })
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [],
    })

    // Advance all batches programmatically
    let advances = 0
    for (const batch of plan.batches) {
      const res = await bancaContext.execute(
        { projectRoot, completedBatchId: batch.batchId },
        ctx,
      )
      if (!res.includes("context checkpoint error")) advances++
    }

    const synthRes = await bancaSintese.execute({ projectRoot }, ctx)

    // Confirms that intra-workspace consistency succeeds, demonstrating why
    // authentic host provenance requires host-level trust model / host-signed tokens (NEEDS_APPROVAL).
    expect(advances).toBe(plan.batches.length)
    expect(synthRes).not.toContain("synthesis input error")
  })
})
