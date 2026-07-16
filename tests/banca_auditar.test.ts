/**
 * Real-filesystem tests for banca_auditar as a pure validation adapter
 * for one exhaustive canonical analysis batch.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint"
import {
  AnalysisFindingError,
  createAnalysisFinding,
  type AnalysisFinding,
} from "../src/lib/analysis_findings"
import {
  AUDIT_RECEIPT_DISCLAIMER,
  AUDIT_RECEIPT_KIND,
  type AuditReceipt,
} from "../src/tools/banca_auditar"

function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, "utf8")
  }
}

function writeProjectConfig(
  root: string,
  opts?: { maxCharactersPerBatch?: number },
): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  writeFileSync(
    join(root, ".banca", "project.json"),
    JSON.stringify({
      version: 1,
      manuscript: {
        format: "latex",
        root: ".",
        main: "main.tex",
        bib: "refs.bib",
        chapters: [],
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
        maxCharactersPerBatch: opts?.maxCharactersPerBatch ?? 50_000,
      },
    }),
    "utf-8",
  )
}

/** Nested includes: main → chapters/outer → chapters/inner. */
function writeNestedManuscript(projectRoot: string): void {
  writeTree(projectRoot, {
    "main.tex": `\\input{chapters/outer}
`,
    "chapters/outer.tex": `Outer line one.
\\input{inner}
`,
    "chapters/inner.tex": `Inner alpha beta gamma.
Inner second line here.
Inner third line ok.
`,
  })
  writeProjectConfig(projectRoot)
}

/** Missing include forces a blocked exhaustive plan. */
function writeBlockedManuscript(projectRoot: string): void {
  writeTree(projectRoot, {
    "main.tex": `\\input{missing-chapter}
Some text after missing include.
`,
  })
  writeProjectConfig(projectRoot)
}

function planOracle(projectRoot: string) {
  const config = loadConfig(projectRoot)
  const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
  const plan = planExhaustiveAnalysisBatches(
    manuscript,
    config.analysis.maxCharactersPerBatch,
  )
  return { config, manuscript, plan }
}

async function runAudit(
  projectRoot: string,
  args: {
    manuscriptFingerprint: string
    batchId: string
    findings: Array<{
      category: string
      severity: string
      claim: string
      evidence: string
      file: string
      startLine: number
      endLine: number
      sectionId: string
    }>
  },
): Promise<string> {
  const { bancaAuditar } = await import("../src/tools/banca_auditar")
  return String(
    await bancaAuditar.execute(
      {
        projectRoot,
        manuscriptFingerprint: args.manuscriptFingerprint,
        batchId: args.batchId,
        findings: args.findings,
      },
      { directory: projectRoot } as any,
    ),
  )
}

function parseReceipt(result: string): AuditReceipt {
  expect(result.startsWith("{")).toBe(true)
  return JSON.parse(result) as AuditReceipt
}

function isErrorResult(result: string): boolean {
  return result.startsWith("audit validation error")
}

function errorCode(result: string): string {
  const m = result.match(/^code=(.+)$/m)
  expect(m).not.toBeNull()
  return m![1]
}

function listIfExists(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}

function snapshotSideEffects(projectRoot: string): {
  stateExists: boolean
  stateMtimeMs: number | null
  reportNames: string[]
  checkpointNames: string[]
} {
  const statePath = join(projectRoot, ".banca", "state.json")
  const reportsDir = join(projectRoot, ".banca", "reports")
  const checkpointsDir = join(projectRoot, ".banca", "analysis", "checkpoints")
  return {
    stateExists: existsSync(statePath),
    stateMtimeMs: existsSync(statePath)
      ? statSync(statePath).mtimeMs
      : null,
    reportNames: listIfExists(reportsDir).slice().sort(),
    checkpointNames: listIfExists(checkpointsDir).slice().sort(),
  }
}

function assertNoAbsoluteProjectPath(text: string, projectRoot: string): void {
  const abs = resolve(projectRoot)
  expect(text.includes(abs)).toBe(false)
  expect(text).not.toMatch(/(^|[\s"'])(\/tmp\/|\/home\/|\/var\/)/)
}

function assertNoGlobalConclusionWords(text: string): void {
  expect(text).not.toMatch(/\bAPROVADO\b/)
  expect(text).not.toMatch(/\bREPROVADO\b/)
  // Old audit integrator used "**Final:" / "Final:" score lines.
  expect(text).not.toMatch(/\bFinal:\s*\d/)
  expect(text).not.toMatch(/\bnotaFinal\b/)
  expect(text).not.toMatch(/\bcurrentScore\b/)
  expect(text).not.toMatch(/\blastAudit\b/)
}

function findingOnIncludedFile(
  plan: ReturnType<typeof planOracle>["plan"],
  overrides: Partial<{
    category: string
    severity: string
    claim: string
    evidence: string
    file: string
    startLine: number
    endLine: number
    sectionId: string
  }> = {},
) {
  expect(plan.status).toBe("complete")
  expect(plan.batches.length).toBeGreaterThan(0)
  const batch = plan.batches[0]
  const chunk =
    batch.chunks.find((c) => c.source.file.includes("inner")) ??
    batch.chunks[0]
  return {
    category: "structure",
    severity: "warning",
    claim: "Missing abstract in nested chapter",
    evidence: "Included file lacks abstract environment",
    file: chunk.source.file,
    startLine: chunk.source.startLine,
    endLine: chunk.source.endLine,
    sectionId: "sec:inner",
    ...overrides,
  }
}

describe("banca_auditar — canonical batch finding validation", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ob-banca-auditar-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("1+2) nested include: valid finding on included file yields deterministic receipt", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.status).toBe("complete")
    expect(plan.fingerprint).toBeTruthy()
    expect(plan.batches.length).toBeGreaterThan(0)

    // Manuscript must reach nested include.
    const files = plan.batches.flatMap((b) =>
      b.chunks.map((c) => c.source.file),
    )
    expect(files.some((f) => f.includes("inner"))).toBe(true)

    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    const expected = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
    })
    const expectedPlanId = computePlanIdentity(plan)

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })

    assertNoAbsoluteProjectPath(result, projectRoot)
    assertNoGlobalConclusionWords(result)

    const receipt = parseReceipt(result)
    expect(receipt.kind).toBe(AUDIT_RECEIPT_KIND)
    expect(receipt.kind).toBe("openbanca-audit-receipt-v2")
    expect(receipt.planId).toBe(expectedPlanId)
    expect(receipt.manuscriptFingerprint).toBe(plan.fingerprint)
    expect(receipt.batchId).toBe(batch.batchId)
    expect(receipt.batchIndex).toBe(batch.index)
    expect(receipt.acceptedCount).toBe(1)
    expect(receipt.findings).toHaveLength(1)
    expect(receipt.findings[0]).toEqual(expected)
    expect(receipt.findings[0].findingId).toBe(expected.findingId)
    expect(receipt.findings[0].findingId).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.persistence.version).toBe("analysis-findings-store-v1")
    expect(receipt.persistence.path).toBe(
      `.banca/analysis/findings/${expectedPlanId}.json`,
    )
    expect(receipt.persistence.previousCount).toBe(0)
    expect(receipt.persistence.addedCount).toBe(1)
    expect(receipt.persistence.duplicateCount).toBe(0)
    expect(receipt.persistence.totalCount).toBe(1)
    expect(receipt.disclaimer).toBe(AUDIT_RECEIPT_DISCLAIMER)
    expect(receipt.disclaimer).toMatch(/does not prove model execution/i)
    expect(receipt.disclaimer).toMatch(/checkpoint/i)
    expect(receipt.disclaimer).toMatch(/academic quality/i)
  })

  test("3) wrong fingerprint fails closed", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: "0".repeat(64),
      batchId: batch.batchId,
      findings: [item],
    })

    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("fingerprint_mismatch")
    expect(result.startsWith("{")).toBe(false)
    assertNoAbsoluteProjectPath(result, projectRoot)
    assertNoGlobalConclusionWords(result)
  })

  test("4) unknown batchId fails closed", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const item = findingOnIncludedFile(plan)

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: "not-a-real-batch-id",
      findings: [item],
    })

    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("unknown_batch")
    assertNoAbsoluteProjectPath(result, projectRoot)
  })

  test("5) file or line range outside batch coverage fails closed", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const base = findingOnIncludedFile(plan)

    const badFile = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [{ ...base, file: "does-not-exist.tex" }],
    })
    expect(isErrorResult(badFile)).toBe(true)
    expect(errorCode(badFile)).toBe("file_not_in_batch")

    const badLines = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [
        {
          ...base,
          startLine: 9990,
          endLine: 9999,
        },
      ],
    })
    expect(isErrorResult(badLines)).toBe(true)
    expect(
      errorCode(badLines) === "line_range_not_covered" ||
        errorCode(badLines) === "file_not_in_batch",
    ).toBe(true)
    assertNoAbsoluteProjectPath(badFile, projectRoot)
    assertNoAbsoluteProjectPath(badLines, projectRoot)
  })

  test("6) mixed valid+invalid list is atomic (no partial receipt or store write)", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const good = findingOnIncludedFile(plan, { claim: "Good claim" })
    const bad = findingOnIncludedFile(plan, {
      claim: "Bad claim",
      file: "ghost.tex",
    })

    // Shared-contract message for the same invalid input (index-prefixed by tool).
    let contractMessage = ""
    try {
      createAnalysisFinding(plan, {
        ...bad,
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
      })
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisFindingError)
      contractMessage = (err as AnalysisFindingError).message
      expect((err as AnalysisFindingError).code).toBe("file_not_in_batch")
    }
    expect(contractMessage.length).toBeGreaterThan(0)

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [good, bad],
    })

    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("file_not_in_batch")
    expect(result).toContain("findings[1]")
    expect(result).toContain(contractMessage)
    // No JSON receipt / partial acceptance.
    expect(result.startsWith("{")).toBe(false)
    expect(result).not.toContain("acceptedCount")
    assertNoAbsoluteProjectPath(result, projectRoot)
    // No findings store written on atomic validation failure.
    expect(
      existsSync(join(projectRoot, ".banca", "analysis", "findings")),
    ).toBe(false)
  })

  test("7) empty findings array returns receipt with zero findings + disclaimer", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const expectedPlanId = computePlanIdentity(plan)

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [],
    })

    const receipt = parseReceipt(result)
    expect(receipt.kind).toBe(AUDIT_RECEIPT_KIND)
    expect(receipt.planId).toBe(expectedPlanId)
    expect(receipt.manuscriptFingerprint).toBe(plan.fingerprint)
    expect(receipt.batchId).toBe(batch.batchId)
    expect(receipt.batchIndex).toBe(batch.index)
    expect(receipt.acceptedCount).toBe(0)
    expect(receipt.findings).toEqual([])
    expect(receipt.persistence.previousCount).toBe(0)
    expect(receipt.persistence.addedCount).toBe(0)
    expect(receipt.persistence.duplicateCount).toBe(0)
    expect(receipt.persistence.totalCount).toBe(0)
    expect(receipt.persistence.path).toBe(
      `.banca/analysis/findings/${expectedPlanId}.json`,
    )
    expect(receipt.disclaimer).toBe(AUDIT_RECEIPT_DISCLAIMER)
    expect(receipt.disclaimer.length).toBeGreaterThan(20)
    assertNoAbsoluteProjectPath(result, projectRoot)
    assertNoGlobalConclusionWords(result)
  })

  test("8) blocked plan (missing include) fails without score or findings", async () => {
    writeBlockedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.status).toBe("blocked")
    expect(plan.diagnostics.length).toBeGreaterThan(0)

    const before = snapshotSideEffects(projectRoot)

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: "a".repeat(64),
      batchId: "any-batch",
      findings: [
        {
          category: "structure",
          severity: "error",
          claim: "x",
          evidence: "y",
          file: "main.tex",
          startLine: 1,
          endLine: 1,
          sectionId: "s",
        },
      ],
    })

    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("blocked_plan")
    expect(result.startsWith("{")).toBe(false)
    expect(result).not.toMatch(/\bAPROVADO\b/)
    expect(result).not.toMatch(/\bREPROVADO\b/)
    expect(result).not.toMatch(/\bscore\b/i)
    // Canonical diagnostics preserved without local rewrite/redaction.
    for (const d of plan.diagnostics) {
      expect(result).toContain(`${d.code}: ${d.message}`)
    }
    expect(result).not.toContain("<project>")
    expect(result).not.toContain("<path>")
    assertNoAbsoluteProjectPath(result, projectRoot)

    const after = snapshotSideEffects(projectRoot)
    expect(after).toEqual(before)
  })

  test("9) execution does not create or alter state, checkpoints, or reports", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    // Seed optional pre-existing state to detect mutation.
    writeFileSync(
      join(projectRoot, ".banca", "state.json"),
      JSON.stringify({ version: 1, currentScore: 1.23, lastAudit: "seed" }),
      "utf-8",
    )
    const before = snapshotSideEffects(projectRoot)
    const stateBefore = readFileSync(
      join(projectRoot, ".banca", "state.json"),
      "utf-8",
    )

    const ok = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(parseReceipt(ok).acceptedCount).toBe(1)

    const fail = await runAudit(projectRoot, {
      manuscriptFingerprint: "f".repeat(64),
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(fail)).toBe(true)

    const after = snapshotSideEffects(projectRoot)
    expect(after.stateExists).toBe(true)
    expect(after.stateMtimeMs).toBe(before.stateMtimeMs)
    expect(
      readFileSync(join(projectRoot, ".banca", "state.json"), "utf-8"),
    ).toBe(stateBefore)
    expect(after.reportNames).toEqual(before.reportNames)
    expect(after.checkpointNames).toEqual(before.checkpointNames)
    expect(existsSync(join(projectRoot, ".banca", "reports"))).toBe(false)
    expect(
      existsSync(join(projectRoot, ".banca", "analysis", "checkpoints")),
    ).toBe(false)
  })

  test("10) success and error output omit absolute paths and removed global words", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    const ok = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item, { ...item, claim: "Second claim" }],
    })
    assertNoAbsoluteProjectPath(ok, projectRoot)
    assertNoGlobalConclusionWords(ok)
    const receipt = parseReceipt(ok)
    expect(receipt.acceptedCount).toBe(2)
    // Order preserved.
    expect(receipt.findings[0].claim).toBe(item.claim)
    expect(receipt.findings[1].claim).toBe("Second claim")
    // findingIds differ when claim differs.
    expect(receipt.findings[0].findingId).not.toBe(
      receipt.findings[1].findingId,
    )

    const err = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: "missing",
      findings: [item],
    })
    assertNoAbsoluteProjectPath(err, projectRoot)
    assertNoGlobalConclusionWords(err)
  })

  test("A) missing project root (no args.projectRoot and no ctx) fails closed", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.status).toBe("complete")
    const item = findingOnIncludedFile(plan)
    const before = snapshotSideEffects(projectRoot)

    const { bancaAuditar } = await import("../src/tools/banca_auditar")
    let threw = false
    let result = ""
    try {
      result = String(
        await bancaAuditar.execute(
          {
            manuscriptFingerprint: plan.fingerprint!,
            batchId: plan.batches[0].batchId,
            findings: [item],
          },
          undefined as any,
        ),
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("invalid_project_root")
    expect(result).toMatch(/project root could not be resolved/i)
    assertNoAbsoluteProjectPath(result, projectRoot)
    assertNoGlobalConclusionWords(result)
    expect(snapshotSideEffects(projectRoot)).toEqual(before)
  })

  test("A) whitespace-only projectRoot fails closed", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const item = findingOnIncludedFile(plan)
    const { bancaAuditar } = await import("../src/tools/banca_auditar")
    const before = snapshotSideEffects(projectRoot)

    // Whitespace-only is truthy for `||` but invalid after trim; ctx must not rescue.
    for (const projectRootArg of ["   ", "\t", " \n "]) {
      const result = String(
        await bancaAuditar.execute(
          {
            projectRoot: projectRootArg,
            manuscriptFingerprint: plan.fingerprint!,
            batchId: plan.batches[0].batchId,
            findings: [item],
          },
          { directory: projectRoot } as any,
        ),
      )
      expect(isErrorResult(result)).toBe(true)
      expect(errorCode(result)).toBe("invalid_project_root")
      expect(result).toMatch(/project root could not be resolved/i)
      assertNoAbsoluteProjectPath(result, projectRoot)
      assertNoGlobalConclusionWords(result)
    }
    expect(snapshotSideEffects(projectRoot)).toEqual(before)
  })

  test("source tree has no dead score/APROVADO path or raw-exception leakage", async () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/tools/banca_auditar.ts"),
      "utf-8",
    )
    expect(src).toContain("createAnalysisFinding")
    expect(src).toContain("mergeAnalysisFindings")
    expect(src).toContain("loadAnalysisFindings")
    expect(src).toContain("saveAnalysisFindings")
    expect(src).toContain("getAnalysisFindingsRelativePath")
    expect(src).toContain("computePlanIdentity")
    expect(src).toContain("loadCanonicalLatexManuscript")
    expect(src).toContain("planExhaustiveAnalysisBatches")
    expect(src).toContain("openbanca-audit-receipt-v2")
    expect(src).not.toContain("sanitizeDiagnosticText")
    expect(src).not.toContain('import { resolve } from "node:path"')
    expect(src).not.toContain("String(err)")
    expect(src).not.toContain("err instanceof Error ? err.message")
    expect(src).not.toContain("resolveManuscriptPaths")
    expect(src).not.toContain("notaFinal")
    expect(src).not.toContain("currentScore")
    expect(src).not.toContain("lastAudit")
    expect(src).not.toContain("saveState")
    expect(src).not.toContain("saveReport")
    expect(src).not.toContain("generateReport")
    expect(src).not.toContain("readFileSync")
    expect(src).not.toContain("writeFileSync")
    expect(src).not.toContain("loadState")
    expect(src).not.toContain("AnalysisCheckpointError")
    expect(src).not.toContain("saveAnalysisCheckpoint")
    expect(src).not.toMatch(/\bAPROVADO\b/)
    expect(src).not.toMatch(/\bREPROVADO\b/)
    expect(src).not.toContain("auditFichamento")
    expect(src).not.toContain("auditCitacoes")
  })
})
