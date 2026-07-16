/**
 * Real-filesystem tests for analysis findings store load/save in state.ts
 * and end-to-end persistence via banca_auditar.
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
  symlinkSync,
  lstatSync,
  statSync,
  chmodSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import { computePlanIdentity } from "../src/lib/analysis_checkpoint"
import {
  ANALYSIS_FINDING_VERSION,
  computeFindingIdentity,
  createAnalysisFinding,
  type AnalysisFinding,
} from "../src/lib/analysis_findings"
import {
  ANALYSIS_FINDINGS_STORE_VERSION,
  AnalysisFindingsStoreError,
  getAnalysisFindingsRelativePath,
  loadAnalysisFindings,
  saveAnalysisFindings,
  type AnalysisFindingsStoreV1,
} from "../src/lib/state"
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

function writeProjectConfig(root: string): void {
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
        maxCharactersPerBatch: 50_000,
      },
    }),
    "utf-8",
  )
}

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

function planOracle(projectRoot: string) {
  const config = loadConfig(projectRoot)
  const manuscript = loadCanonicalLatexManuscript(projectRoot, config)
  const plan = planExhaustiveAnalysisBatches(
    manuscript,
    config.analysis.maxCharactersPerBatch,
  )
  return { config, manuscript, plan }
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

function assertNoAbsoluteProjectPath(text: string, projectRoot: string): void {
  const abs = resolve(projectRoot)
  expect(text.includes(abs)).toBe(false)
  expect(text).not.toMatch(/(^|[\s"'])(\/tmp\/|\/home\/|\/var\/)/)
}

function storeAbsPath(projectRoot: string, planId: string): string {
  return join(projectRoot, ".banca", "analysis", "findings", `${planId}.json`)
}

function readStoreBytes(projectRoot: string, planId: string): string {
  return readFileSync(storeAbsPath(projectRoot, planId), "utf-8")
}

function listIfExists(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}

function snapshotSideEffects(projectRoot: string) {
  const statePath = join(projectRoot, ".banca", "state.json")
  const reportsDir = join(projectRoot, ".banca", "reports")
  const checkpointsDir = join(projectRoot, ".banca", "analysis", "checkpoints")
  return {
    stateExists: existsSync(statePath),
    stateBytes: existsSync(statePath)
      ? readFileSync(statePath, "utf-8")
      : null,
    reportNames: listIfExists(reportsDir).slice().sort(),
    checkpointNames: listIfExists(checkpointsDir).slice().sort(),
  }
}

describe("analysis findings store (state.ts)", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ob-findings-store-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("getAnalysisFindingsRelativePath is POSIX relative and validates planId", () => {
    const planId = "a".repeat(64)
    expect(getAnalysisFindingsRelativePath(planId)).toBe(
      `.banca/analysis/findings/${planId}.json`,
    )
    expect(() => getAnalysisFindingsRelativePath("not-hex")).toThrow(
      AnalysisFindingsStoreError,
    )
    try {
      getAnalysisFindingsRelativePath("NOTHEX")
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisFindingsStoreError)
      expect((err as AnalysisFindingsStoreError).code).toBe("invalid_plan_id")
      expect((err as Error).message).not.toMatch(/\/tmp\/|\/home\/|\/var\//)
    }
  })

  test("load returns null when absent; save creates store; load round-trips", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })

    expect(loadAnalysisFindings(projectRoot, planId)).toBeNull()

    const store: AnalysisFindingsStoreV1 = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [finding],
    }
    saveAnalysisFindings(projectRoot, store)

    const rel = getAnalysisFindingsRelativePath(planId)
    expect(existsSync(join(projectRoot, rel))).toBe(true)
    const loaded = loadAnalysisFindings(projectRoot, planId)
    expect(loaded).not.toBeNull()
    expect(loaded!.version).toBe(ANALYSIS_FINDINGS_STORE_VERSION)
    expect(loaded!.planId).toBe(planId)
    expect(loaded!.manuscriptFingerprint).toBe(plan.fingerprint)
    expect(loaded!.findings).toEqual([finding])

    const raw = readStoreBytes(projectRoot, planId)
    assertNoAbsoluteProjectPath(raw, projectRoot)
    expect(raw).not.toMatch(/createdAt|timestamp|Date\.|process\.|hostname/i)
    const parsed = JSON.parse(raw)
    expect(Object.keys(parsed).sort()).toEqual(
      ["findings", "manuscriptFingerprint", "planId", "version"].sort(),
    )
  })

  test("malformed JSON / wrong version / extra key / missing key fail without overwrite", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)

    const cases: Array<{ body: string; code: string }> = [
      { body: "{not-json", code: "invalid_findings_store" },
      {
        body: JSON.stringify({
          version: "analysis-findings-store-v0",
          planId,
          manuscriptFingerprint: plan.fingerprint,
          findings: [],
        }),
        code: "invalid_findings_store",
      },
      {
        body: JSON.stringify({
          version: ANALYSIS_FINDINGS_STORE_VERSION,
          planId,
          manuscriptFingerprint: plan.fingerprint,
          findings: [],
          extra: true,
        }),
        code: "invalid_findings_store",
      },
      {
        body: JSON.stringify({
          version: ANALYSIS_FINDINGS_STORE_VERSION,
          planId,
          findings: [],
        }),
        code: "invalid_findings_store",
      },
    ]

    for (const c of cases) {
      writeFileSync(abs, c.body, "utf-8")
      const before = readFileSync(abs, "utf-8")
      try {
        loadAnalysisFindings(projectRoot, planId)
        expect.unreachable("should have thrown")
      } catch (err) {
        expect(err).toBeInstanceOf(AnalysisFindingsStoreError)
        expect((err as AnalysisFindingsStoreError).code).toBe(c.code)
        expect((err as Error).message).not.toMatch(/\/tmp\/|\/home\/|\/var\//)
        expect((err as Error).message).not.toContain(abs)
      }
      expect(readFileSync(abs, "utf-8")).toBe(before)
    }
  })

  test("divergent planId and adulterated findingId fail closed", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)

    const wrongPlan = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId: "b".repeat(64),
      manuscriptFingerprint: plan.fingerprint,
      findings: [],
    }
    writeFileSync(abs, JSON.stringify(wrongPlan), "utf-8")
    const beforePlan = readFileSync(abs, "utf-8")
    expect(() => loadAnalysisFindings(projectRoot, planId)).toThrow(
      AnalysisFindingsStoreError,
    )
    try {
      loadAnalysisFindings(projectRoot, planId)
    } catch (err) {
      expect((err as AnalysisFindingsStoreError).code).toBe("incompatible_plan")
    }
    expect(readFileSync(abs, "utf-8")).toBe(beforePlan)

    const tampered = {
      ...finding,
      findingId: "c".repeat(64),
    }
    const tamperedStore = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [tampered],
    }
    writeFileSync(abs, JSON.stringify(tamperedStore), "utf-8")
    const beforeTamper = readFileSync(abs, "utf-8")
    expect(() => loadAnalysisFindings(projectRoot, planId)).toThrow(
      AnalysisFindingsStoreError,
    )
    expect(readFileSync(abs, "utf-8")).toBe(beforeTamper)
  })

  test("fingerprint mismatch on finding vs store envelope fails closed", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: "d".repeat(64),
      findings: [finding],
    })
    writeFileSync(abs, body, "utf-8")
    expect(() => loadAnalysisFindings(projectRoot, planId)).toThrow(
      AnalysisFindingsStoreError,
    )
    try {
      loadAnalysisFindings(projectRoot, planId)
    } catch (err) {
      expect((err as AnalysisFindingsStoreError).code).toBe(
        "incompatible_fingerprint",
      )
    }
    expect(readFileSync(abs, "utf-8")).toBe(body)
  })

  test("symlink on .banca / analysis / findings / final file refuses; external target unchanged", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })
    const store: AnalysisFindingsStoreV1 = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [finding],
    }

    const externalDir = mkdtempSync(join(tmpdir(), "ob-findings-ext-"))
    try {
      const externalFile = join(externalDir, "secret.json")
      const externalPayload = JSON.stringify({ keep: true, marker: "external" })
      writeFileSync(externalFile, externalPayload, "utf-8")

      // Final file is a symlink to external payload.
      const findingsDir = join(projectRoot, ".banca", "analysis", "findings")
      mkdirSync(findingsDir, { recursive: true })
      const finalAbs = storeAbsPath(projectRoot, planId)
      symlinkSync(externalFile, finalAbs)
      expect(lstatSync(finalAbs).isSymbolicLink()).toBe(true)

      expect(() => loadAnalysisFindings(projectRoot, planId)).toThrow(
        AnalysisFindingsStoreError,
      )
      expect(() => saveAnalysisFindings(projectRoot, store)).toThrow(
        AnalysisFindingsStoreError,
      )
      expect(readFileSync(externalFile, "utf-8")).toBe(externalPayload)

      // Directory component symlink: replace findings dir with link.
      rmSync(finalAbs, { force: true })
      rmSync(findingsDir, { recursive: true, force: true })
      const realFindings = join(externalDir, "findings-real")
      mkdirSync(realFindings, { recursive: true })
      writeFileSync(join(realFindings, "marker.txt"), "dir-target", "utf-8")
      symlinkSync(realFindings, findingsDir)

      expect(() => loadAnalysisFindings(projectRoot, planId)).toThrow(
        AnalysisFindingsStoreError,
      )
      expect(() => saveAnalysisFindings(projectRoot, store)).toThrow(
        AnalysisFindingsStoreError,
      )
      expect(readFileSync(join(realFindings, "marker.txt"), "utf-8")).toBe(
        "dir-target",
      )
      expect(readdirSync(realFindings)).toEqual(["marker.txt"])

      // .banca as symlink
      rmSync(join(projectRoot, ".banca"), { recursive: true, force: true })
      const realBanca = join(externalDir, "banca-real")
      mkdirSync(realBanca, { recursive: true })
      writeFileSync(join(realBanca, "seed.txt"), "banca-seed", "utf-8")
      // Need project.json inside for other tests; for pure store API only path matters.
      symlinkSync(realBanca, join(projectRoot, ".banca"))
      expect(() => saveAnalysisFindings(projectRoot, store)).toThrow(
        AnalysisFindingsStoreError,
      )
      expect(readFileSync(join(realBanca, "seed.txt"), "utf-8")).toBe(
        "banca-seed",
      )
      expect(readdirSync(realBanca)).toEqual(["seed.txt"])
    } finally {
      rmSync(externalDir, { recursive: true, force: true })
    }
  })

  test("controlled error messages never leak absolute paths or err.message", () => {
    writeNestedManuscript(projectRoot)
    const planId = "e".repeat(64)
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    // Make the final path a directory so "not a regular file".
    mkdirSync(storeAbsPath(projectRoot, planId), { recursive: true })
    try {
      loadAnalysisFindings(projectRoot, planId)
      expect.unreachable("should throw")
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisFindingsStoreError)
      expect((err as AnalysisFindingsStoreError).code).toBe(
        "invalid_findings_storage",
      )
      const msg = (err as Error).message
      expect(msg).not.toContain(projectRoot)
      expect(msg).not.toMatch(/ENOENT|EISDIR|EACCES/)
      expect(msg).not.toMatch(/\/tmp\/|\/home\/|\/var\//)
    }
  })

  test("unknown envelope key with absolute-path marker fails without echoing marker", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)
    const marker = "/home/private/path"
    // Length-matched swap so unknown-key branch runs (not just key-count).
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      findings: [],
      [marker]: "evil-envelope",
    })
    writeFileSync(abs, body, "utf-8")
    const before = readFileSync(abs, "utf-8")
    try {
      loadAnalysisFindings(projectRoot, planId)
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisFindingsStoreError)
      expect((err as AnalysisFindingsStoreError).code).toBe(
        "invalid_findings_store",
      )
      const msg = (err as Error).message
      expect(msg).not.toContain(marker)
      expect(msg).not.toContain("evil-envelope")
      expect(msg).not.toMatch(/\/home\/|\/tmp\/|\/var\//)
      expect(msg).not.toContain(abs)
      expect(msg).not.toContain(projectRoot)
    }
    expect(readFileSync(abs, "utf-8")).toBe(before)
  })

  test("unknown finding key with absolute-path marker fails without echoing marker", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)
    const marker = "/home/private/path"
    // Swap a required field for an untrusted key so key count still matches.
    const { claim: _claim, ...rest } = finding
    const maliciousFinding = {
      ...rest,
      [marker]: "evil-finding",
    }
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [maliciousFinding],
    })
    writeFileSync(abs, body, "utf-8")
    const before = readFileSync(abs, "utf-8")
    try {
      loadAnalysisFindings(projectRoot, planId)
      expect.unreachable("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(AnalysisFindingsStoreError)
      expect((err as AnalysisFindingsStoreError).code).toBe(
        "invalid_findings_store",
      )
      const msg = (err as Error).message
      // Must not propagate AnalysisFindingError.message (which may echo keys).
      expect(msg).not.toContain(marker)
      expect(msg).not.toContain("evil-finding")
      expect(msg).not.toMatch(/\/home\/|\/tmp\/|\/var\//)
      expect(msg).not.toContain(abs)
      expect(msg).toBe("findings store contains invalid findings")
    }
    expect(readFileSync(abs, "utf-8")).toBe(before)
  })

  test("structurally canonical finding with unknown batchId loads but is plan-invalid", () => {
    // Load only checks structural findingId integrity, not live plan coverage.
    // A finding with a correct identity hash for a nonexistent batchId must still
    // parse as a store document; audit revalidation is covered separately.
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const fakeBatchId = "batch-not-in-live-plan"
    const findingId = computeFindingIdentity({
      version: ANALYSIS_FINDING_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: fakeBatchId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: item.file,
      startLine: item.startLine,
      endLine: item.endLine,
      sectionId: item.sectionId,
    })
    const finding: AnalysisFinding = {
      version: ANALYSIS_FINDING_VERSION,
      findingId,
      planId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: item.file,
      startLine: item.startLine,
      endLine: item.endLine,
      sectionId: item.sectionId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: fakeBatchId,
    }
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [finding],
    })
    writeFileSync(storeAbsPath(projectRoot, planId), body, "utf-8")
    const loaded = loadAnalysisFindings(projectRoot, planId)
    expect(loaded).not.toBeNull()
    expect(loaded!.findings).toHaveLength(1)
    expect(loaded!.findings[0].batchId).toBe(fakeBatchId)
    expect(readStoreBytes(projectRoot, planId)).toBe(body)
  })

  test("directory-create failure on save throws controlled error (no raw FS leak, no store)", () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: plan.batches[0].batchId,
    })
    const store: AnalysisFindingsStoreV1 = {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      findings: [finding],
    }

    const bancaDir = join(projectRoot, ".banca")
    // Read+execute only: lstat/readdir ok, mkdir of analysis/findings fails (EACCES).
    // Ensure analysis/ does not already exist so save must create it.
    expect(existsSync(join(bancaDir, "analysis"))).toBe(false)
    chmodSync(bancaDir, 0o555)

    try {
      try {
        saveAnalysisFindings(projectRoot, store)
        expect.unreachable("should have thrown on mkdir failure")
      } catch (err) {
        expect(err).toBeInstanceOf(AnalysisFindingsStoreError)
        expect((err as AnalysisFindingsStoreError).code).toBe(
          "invalid_findings_storage",
        )
        const msg = (err as Error).message
        expect(msg).toMatch(/failed to create findings storage directory/i)
        // Component name only — not absolute path or host errno text.
        expect(msg).toContain("analysis")
        expect(msg).not.toContain(projectRoot)
        expect(msg).not.toContain(bancaDir)
        expect(msg).not.toMatch(/ENOENT|EACCES|EPERM|EISDIR/)
        expect(msg).not.toMatch(/\/tmp\/|\/home\/|\/var\//)
        // Not a raw Node Error masquerading as domain error.
        expect((err as Error).name).toBe("AnalysisFindingsStoreError")
      }

      expect(existsSync(storeAbsPath(projectRoot, planId))).toBe(false)
      expect(existsSync(join(bancaDir, "analysis", "findings"))).toBe(false)
    } finally {
      // Restore write bit so afterEach cleanup can remove the tree.
      chmodSync(bancaDir, 0o755)
    }
  })
})

describe("banca_auditar — findings persistence", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ob-banca-auditar-persist-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("initial valid call creates exactly one versioned store for planId", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    const expected = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
    })

    const beforeSide = snapshotSideEffects(projectRoot)
    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    const receipt = parseReceipt(result)

    expect(receipt.kind).toBe(AUDIT_RECEIPT_KIND)
    expect(receipt.kind).toBe("openbanca-audit-receipt-v2")
    expect(receipt.acceptedCount).toBe(1)
    expect(receipt.findings).toEqual([expected])
    expect(receipt.persistence.version).toBe(ANALYSIS_FINDINGS_STORE_VERSION)
    expect(receipt.persistence.path).toBe(
      getAnalysisFindingsRelativePath(planId),
    )
    expect(receipt.persistence.previousCount).toBe(0)
    expect(receipt.persistence.addedCount).toBe(1)
    expect(receipt.persistence.duplicateCount).toBe(0)
    expect(receipt.persistence.totalCount).toBe(1)
    expect(receipt.disclaimer).toBe(AUDIT_RECEIPT_DISCLAIMER)
    expect(receipt.disclaimer).toMatch(/does not prove model execution/i)
    expect(receipt.disclaimer).toMatch(/checkpoint/i)
    expect(receipt.disclaimer).toMatch(/coverage/i)
    expect(receipt.disclaimer).toMatch(/academic quality/i)
    assertNoAbsoluteProjectPath(result, projectRoot)

    const rel = getAnalysisFindingsRelativePath(planId)
    expect(existsSync(join(projectRoot, rel))).toBe(true)
    // Exactly one store file under findings/
    const findingsDir = join(projectRoot, ".banca", "analysis", "findings")
    expect(readdirSync(findingsDir)).toEqual([`${planId}.json`])

    const loaded = loadAnalysisFindings(projectRoot, planId)!
    expect(loaded.findings).toEqual([expected])
    assertNoAbsoluteProjectPath(readStoreBytes(projectRoot, planId), projectRoot)

    const afterSide = snapshotSideEffects(projectRoot)
    expect(afterSide.stateBytes).toBe(beforeSide.stateBytes)
    expect(afterSide.reportNames).toEqual(beforeSide.reportNames)
    expect(afterSide.checkpointNames).toEqual(beforeSide.checkpointNames)
  })

  test("exact retry same process is idempotent (totalCount stable)", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    const first = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [item],
      }),
    )
    expect(first.persistence.totalCount).toBe(1)
    expect(first.persistence.addedCount).toBe(1)

    const bytesAfterFirst = readStoreBytes(projectRoot, planId)

    const second = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [item],
      }),
    )
    expect(second.persistence.previousCount).toBe(1)
    expect(second.persistence.addedCount).toBe(0)
    expect(second.persistence.duplicateCount).toBe(1)
    expect(second.persistence.totalCount).toBe(1)
    expect(second.acceptedCount).toBe(1)

    const loaded = loadAnalysisFindings(projectRoot, planId)!
    expect(loaded.findings).toHaveLength(1)
    // Content stable (pretty-print may rewrite; total findings identity is what matters)
    expect(loaded.findings[0].findingId).toBe(first.findings[0].findingId)
    // Retry must not grow the store.
    expect(JSON.parse(readStoreBytes(projectRoot, planId)).findings).toHaveLength(
      1,
    )
    expect(bytesAfterFirst.length).toBeGreaterThan(0)
  })

  test("exact retry in a separate process remains idempotent", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    const first = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [item],
      }),
    )
    expect(first.persistence.totalCount).toBe(1)

    const script = `
      import { bancaAuditar } from ${JSON.stringify(resolve(import.meta.dir, "../src/tools/banca_auditar.ts"))};
      const result = await bancaAuditar.execute({
        projectRoot: ${JSON.stringify(projectRoot)},
        manuscriptFingerprint: ${JSON.stringify(plan.fingerprint)},
        batchId: ${JSON.stringify(batch.batchId)},
        findings: [${JSON.stringify(item)}],
      }, { directory: ${JSON.stringify(projectRoot)} });
      process.stdout.write(String(result));
    `
    const child = spawnSync("bun", ["-e", script], {
      encoding: "utf-8",
      cwd: resolve(import.meta.dir, ".."),
    })
    expect(child.status).toBe(0)
    expect(child.stderr || "").not.toMatch(/error/i)
    const second = parseReceipt(child.stdout)
    expect(second.persistence.totalCount).toBe(1)
    expect(second.persistence.addedCount).toBe(0)
    expect(second.persistence.duplicateCount).toBe(1)
    expect(second.persistence.previousCount).toBe(1)

    const loaded = loadAnalysisFindings(projectRoot, planId)!
    expect(loaded.findings).toHaveLength(1)
    expect(loaded.findings[0].findingId).toBe(first.findings[0].findingId)
  })

  test("in-call duplicates and mix of dups+new preserve first-occurrence order", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const a = findingOnIncludedFile(plan, { claim: "Claim A first" })
    const b = findingOnIncludedFile(plan, { claim: "Claim B second" })
    const c = findingOnIncludedFile(plan, { claim: "Claim C third" })

    // Seed A and B.
    const seed = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [a, b],
      }),
    )
    expect(seed.persistence.totalCount).toBe(2)
    expect(seed.findings.map((f) => f.claim)).toEqual([
      "Claim A first",
      "Claim B second",
    ])

    // Same call: duplicate A, new C, duplicate B (order of first occurrence for new = after existing).
    const mixed = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [a, c, a, b],
      }),
    )
    expect(mixed.acceptedCount).toBe(4)
    expect(mixed.persistence.previousCount).toBe(2)
    expect(mixed.persistence.addedCount).toBe(1)
    expect(mixed.persistence.duplicateCount).toBe(3)
    expect(mixed.persistence.totalCount).toBe(3)

    const loaded = loadAnalysisFindings(projectRoot, planId)!
    expect(loaded.findings.map((f) => f.claim)).toEqual([
      "Claim A first",
      "Claim B second",
      "Claim C third",
    ])

    // In-call-only duplicates with empty prior of a fresh claim set
    const d = findingOnIncludedFile(plan, { claim: "Only D" })
    const inCall = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [d, d, d],
      }),
    )
    expect(inCall.acceptedCount).toBe(3)
    expect(inCall.persistence.addedCount).toBe(1)
    expect(inCall.persistence.duplicateCount).toBe(2)
    expect(inCall.persistence.totalCount).toBe(4)
  })

  test("empty findings list is valid persistence op without academic conclusion", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [],
    })
    const receipt = parseReceipt(result)
    expect(receipt.acceptedCount).toBe(0)
    expect(receipt.findings).toEqual([])
    expect(receipt.persistence.previousCount).toBe(0)
    expect(receipt.persistence.addedCount).toBe(0)
    expect(receipt.persistence.duplicateCount).toBe(0)
    expect(receipt.persistence.totalCount).toBe(0)
    expect(receipt.disclaimer).toBe(AUDIT_RECEIPT_DISCLAIMER)
    assertNoAbsoluteProjectPath(result, projectRoot)
    expect(result).not.toMatch(/\bAPROVADO\b|\bREPROVADO\b|\bnotaFinal\b/)

    const loaded = loadAnalysisFindings(projectRoot, planId)!
    expect(loaded.findings).toEqual([])
    expect(loaded.version).toBe(ANALYSIS_FINDINGS_STORE_VERSION)
  })

  test("invalid item among valid creates no store / no partial write", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const good = findingOnIncludedFile(plan, { claim: "Good" })
    const bad = findingOnIncludedFile(plan, {
      claim: "Bad",
      file: "ghost.tex",
    })

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [good, bad],
    })
    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("file_not_in_batch")
    expect(existsSync(storeAbsPath(projectRoot, planId))).toBe(false)
    expect(
      existsSync(join(projectRoot, ".banca", "analysis", "findings")),
    ).toBe(false)

    // Seed a store, then fail — prior bytes unchanged.
    const seed = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [good],
      }),
    )
    expect(seed.persistence.totalCount).toBe(1)
    const before = readStoreBytes(projectRoot, planId)

    const fail = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [good, bad],
    })
    expect(isErrorResult(fail)).toBe(true)
    expect(readStoreBytes(projectRoot, planId)).toBe(before)
    assertNoAbsoluteProjectPath(fail, projectRoot)
  })

  test("corrupt store / wrong version / planId / fingerprint / findingId fail without overwrite", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
    })

    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)

    const corruptCases: string[] = [
      "{broken",
      JSON.stringify({
        version: "nope",
        planId,
        manuscriptFingerprint: plan.fingerprint,
        findings: [],
      }),
      JSON.stringify({
        version: ANALYSIS_FINDINGS_STORE_VERSION,
        planId: "f".repeat(64),
        manuscriptFingerprint: plan.fingerprint,
        findings: [],
      }),
      JSON.stringify({
        version: ANALYSIS_FINDINGS_STORE_VERSION,
        planId,
        manuscriptFingerprint: "1".repeat(64),
        findings: [],
      }),
      JSON.stringify({
        version: ANALYSIS_FINDINGS_STORE_VERSION,
        planId,
        manuscriptFingerprint: plan.fingerprint,
        findings: [{ ...finding, findingId: "0".repeat(64) }],
      }),
      JSON.stringify({
        version: ANALYSIS_FINDINGS_STORE_VERSION,
        planId,
        manuscriptFingerprint: plan.fingerprint,
        findings: [],
        extraField: 1,
      }),
    ]

    for (const body of corruptCases) {
      writeFileSync(abs, body, "utf-8")
      const before = readFileSync(abs, "utf-8")
      const result = await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [item],
      })
      expect(isErrorResult(result)).toBe(true)
      expect(readFileSync(abs, "utf-8")).toBe(before)
      assertNoAbsoluteProjectPath(result, projectRoot)
      expect(result).not.toContain(abs)
    }
  })

  test("store fingerprint diverging from current plan fails without write", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    // Valid empty store but wrong fingerprint relative to current plan.
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: "2".repeat(64),
      findings: [],
    })
    writeFileSync(storeAbsPath(projectRoot, planId), body, "utf-8")

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("incompatible_fingerprint")
    expect(readStoreBytes(projectRoot, planId)).toBe(body)
  })

  test("symlink findings path fails closed; external target and state.json untouched", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    writeFileSync(
      join(projectRoot, ".banca", "state.json"),
      JSON.stringify({ version: 1, currentScore: 4.5, lastAudit: "seed" }),
      "utf-8",
    )
    const stateBefore = readFileSync(
      join(projectRoot, ".banca", "state.json"),
      "utf-8",
    )

    const externalDir = mkdtempSync(join(tmpdir(), "ob-auditar-ext-"))
    try {
      const externalFile = join(externalDir, "payload.json")
      const payload = JSON.stringify({ external: true })
      writeFileSync(externalFile, payload, "utf-8")

      const findingsDir = join(projectRoot, ".banca", "analysis", "findings")
      mkdirSync(findingsDir, { recursive: true })
      symlinkSync(externalFile, storeAbsPath(projectRoot, planId))

      const result = await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [item],
      })
      expect(isErrorResult(result)).toBe(true)
      expect(errorCode(result)).toBe("symlink_refused")
      expect(readFileSync(externalFile, "utf-8")).toBe(payload)
      expect(
        readFileSync(join(projectRoot, ".banca", "state.json"), "utf-8"),
      ).toBe(stateBefore)
      assertNoAbsoluteProjectPath(result, projectRoot)
      expect(
        existsSync(join(projectRoot, ".banca", "analysis", "checkpoints")),
      ).toBe(false)
    } finally {
      rmSync(externalDir, { recursive: true, force: true })
    }
  })

  test("success does not mutate state.json, checkpoints, or reports", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)

    writeFileSync(
      join(projectRoot, ".banca", "state.json"),
      JSON.stringify({ version: 1, currentScore: 1.23, lastAudit: "seed" }),
      "utf-8",
    )
    const before = snapshotSideEffects(projectRoot)

    const ok = parseReceipt(
      await runAudit(projectRoot, {
        manuscriptFingerprint: plan.fingerprint!,
        batchId: batch.batchId,
        findings: [item],
      }),
    )
    expect(ok.persistence.totalCount).toBe(1)

    const after = snapshotSideEffects(projectRoot)
    expect(after.stateBytes).toBe(before.stateBytes)
    expect(after.reportNames).toEqual(before.reportNames)
    expect(after.checkpointNames).toEqual(before.checkpointNames)
    expect(existsSync(join(projectRoot, ".banca", "reports"))).toBe(false)
    expect(
      existsSync(join(projectRoot, ".banca", "analysis", "checkpoints")),
    ).toBe(false)
  })

  test("stored finding with unknown batchId fails audit revalidation without overwrite", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    const fakeBatchId = "batch-not-in-live-plan"
    const findingId = computeFindingIdentity({
      version: ANALYSIS_FINDING_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: fakeBatchId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: item.file,
      startLine: item.startLine,
      endLine: item.endLine,
      sectionId: item.sectionId,
    })
    const finding: AnalysisFinding = {
      version: ANALYSIS_FINDING_VERSION,
      findingId,
      planId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: item.file,
      startLine: item.startLine,
      endLine: item.endLine,
      sectionId: item.sectionId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: fakeBatchId,
    }
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [finding],
    })
    writeFileSync(storeAbsPath(projectRoot, planId), body, "utf-8")

    // Structural load still succeeds (findingId matches payload).
    expect(loadAnalysisFindings(projectRoot, planId)).not.toBeNull()

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("invalid_stored_finding")
    expect(result).toMatch(
      /existing findings store is not valid against the current plan/,
    )
    expect(readStoreBytes(projectRoot, planId)).toBe(body)
    assertNoAbsoluteProjectPath(result, projectRoot)
    expect(result).not.toContain(fakeBatchId)
  })

  test("stored finding with lines outside batch coverage fails audit without overwrite", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    // File is in the batch, but line range is far outside coverage.
    const outStart = 9000
    const outEnd = 9001
    const findingId = computeFindingIdentity({
      version: ANALYSIS_FINDING_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: item.file,
      startLine: outStart,
      endLine: outEnd,
      sectionId: item.sectionId,
    })
    const finding: AnalysisFinding = {
      version: ANALYSIS_FINDING_VERSION,
      findingId,
      planId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: item.file,
      startLine: outStart,
      endLine: outEnd,
      sectionId: item.sectionId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
    }
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [finding],
    })
    writeFileSync(storeAbsPath(projectRoot, planId), body, "utf-8")

    expect(loadAnalysisFindings(projectRoot, planId)).not.toBeNull()

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("invalid_stored_finding")
    expect(readStoreBytes(projectRoot, planId)).toBe(body)
    assertNoAbsoluteProjectPath(result, projectRoot)
    expect(result).not.toContain(String(outStart))
    expect(result).not.toMatch(/\/home\/|\/tmp\/|\/var\//)
  })

  test("stored finding with file not in batch fails audit without overwrite", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    const ghostFile = "ghost-not-in-batch.tex"
    const findingId = computeFindingIdentity({
      version: ANALYSIS_FINDING_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: ghostFile,
      startLine: 1,
      endLine: 1,
      sectionId: item.sectionId,
    })
    const finding: AnalysisFinding = {
      version: ANALYSIS_FINDING_VERSION,
      findingId,
      planId,
      category: item.category,
      severity: item.severity,
      claim: item.claim,
      evidence: item.evidence,
      file: ghostFile,
      startLine: 1,
      endLine: 1,
      sectionId: item.sectionId,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
    }
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const body = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [finding],
    })
    writeFileSync(storeAbsPath(projectRoot, planId), body, "utf-8")

    const result = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(result)).toBe(true)
    expect(errorCode(result)).toBe("invalid_stored_finding")
    expect(readStoreBytes(projectRoot, planId)).toBe(body)
    assertNoAbsoluteProjectPath(result, projectRoot)
    expect(result).not.toContain(ghostFile)
  })

  test("audit path: malicious envelope/finding keys with path marker never leak", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const batch = plan.batches[0]
    const item = findingOnIncludedFile(plan)
    const finding = createAnalysisFinding(plan, {
      ...item,
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
    })
    const dir = join(projectRoot, ".banca", "analysis", "findings")
    mkdirSync(dir, { recursive: true })
    const abs = storeAbsPath(projectRoot, planId)
    const marker = "/home/private/path"

    const envelopeBody = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      findings: [],
      [marker]: "evil-envelope",
    })
    writeFileSync(abs, envelopeBody, "utf-8")
    const envResult = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(envResult)).toBe(true)
    expect(envResult).not.toContain(marker)
    expect(envResult).not.toContain("evil-envelope")
    expect(readFileSync(abs, "utf-8")).toBe(envelopeBody)
    assertNoAbsoluteProjectPath(envResult, projectRoot)

    const { claim: _claim, ...rest } = finding
    const findingBody = JSON.stringify({
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint,
      findings: [{ ...rest, [marker]: "evil-finding" }],
    })
    writeFileSync(abs, findingBody, "utf-8")
    const findResult = await runAudit(projectRoot, {
      manuscriptFingerprint: plan.fingerprint!,
      batchId: batch.batchId,
      findings: [item],
    })
    expect(isErrorResult(findResult)).toBe(true)
    expect(findResult).not.toContain(marker)
    expect(findResult).not.toContain("evil-finding")
    expect(readFileSync(abs, "utf-8")).toBe(findingBody)
    assertNoAbsoluteProjectPath(findResult, projectRoot)
  })
})
