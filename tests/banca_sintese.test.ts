/**
 * Real-filesystem tests for banca_sintese as a read-only adapter over
 * createGlobalAnalysisSynthesisInput. Fixtures use public save/load APIs;
 * the tool itself must not write.
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
  lstatSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { loadConfig } from "../src/lib/config"
import { loadCanonicalLatexManuscript } from "../src/lib/latex_loader"
import { planExhaustiveAnalysisBatches } from "../src/lib/analysis_coverage"
import {
  completeAnalysisBatch,
  computePlanIdentity,
  createAnalysisCheckpoint,
  type AnalysisCheckpoint,
} from "../src/lib/analysis_checkpoint"
import {
  createAnalysisFinding,
  type AnalysisFinding,
} from "../src/lib/analysis_findings"
import {
  createGlobalAnalysisSynthesisInput,
  GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION,
} from "../src/lib/analysis_synthesis"
import {
  ANALYSIS_FINDINGS_STORE_VERSION,
  loadAnalysisCheckpoint,
  loadAnalysisFindings,
  saveAnalysisCheckpoint,
  saveAnalysisFindings,
  type AnalysisFindingsStoreV1,
} from "../src/lib/state"

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
        maxCharactersPerBatch: opts?.maxCharactersPerBatch ?? 40,
      },
    }),
    "utf-8",
  )
}

/** Nested includes: main → chapters/outer → chapters/inner. Small budget → multi-batch. */
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

function completeCheckpoint(
  plan: ReturnType<typeof planOracle>["plan"],
): AnalysisCheckpoint {
  let cp = createAnalysisCheckpoint(plan)
  for (const batch of plan.batches) {
    cp = completeAnalysisBatch(plan, cp, batch.batchId)
  }
  return cp
}

function findingOnBatch(
  plan: ReturnType<typeof planOracle>["plan"],
  batchIndex: number,
  claim: string,
): AnalysisFinding {
  const batch = plan.batches[batchIndex]
  const chunk = batch.chunks[0]
  return createAnalysisFinding(plan, {
    category: "structure",
    severity: "warning",
    claim,
    evidence: "Evidence span for synthesis tool fixture",
    file: chunk.source.file,
    startLine: chunk.source.startLine,
    endLine: chunk.source.endLine,
    sectionId: `sec:batch-${batchIndex}`,
    manuscriptFingerprint: plan.fingerprint!,
    batchId: batch.batchId,
  })
}

async function runSintese(
  projectRoot: string | undefined,
  ctxDirectory?: string | null,
): Promise<string> {
  const { bancaSintese } = await import("../src/tools/banca_sintese")
  const args =
    projectRoot === undefined ? {} : { projectRoot }
  const ctx =
    ctxDirectory === null
      ? undefined
      : ctxDirectory === undefined
        ? ({ directory: projectRoot ?? "" } as any)
        : ({ directory: ctxDirectory } as any)
  return String(await bancaSintese.execute(args as any, ctx as any))
}

function isErrorResult(result: string): boolean {
  return result.startsWith("synthesis input error")
}

function errorCode(result: string): string {
  const m = result.match(/^code=(.+)$/m)
  expect(m).not.toBeNull()
  return m![1]!
}

function errorMessage(result: string): string {
  const m = result.match(/^message=(.+)$/m)
  expect(m).not.toBeNull()
  return m![1]!
}

function assertControlledError(
  result: string,
  code: string,
  projectRoot?: string,
): void {
  expect(isErrorResult(result)).toBe(true)
  expect(errorCode(result)).toBe(code)
  expect(result).toMatch(/^synthesis input error\ncode=.+\nmessage=.+/s)
  if (projectRoot) {
    assertNoAbsoluteProjectPath(result, projectRoot)
  }
  assertNoLeakContent(result)
}

function assertNoAbsoluteProjectPath(text: string, projectRoot: string): void {
  const abs = resolve(projectRoot)
  expect(text.includes(abs)).toBe(false)
  expect(text).not.toMatch(/(^|[\s"'])(\/tmp\/|\/home\/|\/var\/)/)
}

function assertNoLeakContent(text: string): void {
  expect(text).not.toMatch(/\bENOENT\b/)
  expect(text).not.toMatch(/\bEACCES\b/)
  expect(text).not.toMatch(/\bEPERM\b/)
  expect(text).not.toMatch(/\bno such file or directory\b/i)
  expect(text).not.toContain("Missing abstract")
  expect(text).not.toContain("Evidence span for synthesis")
  expect(text).not.toMatch(/\bAPROVADO\b/)
  expect(text).not.toMatch(/\bREPROVADO\b/)
  expect(text).not.toMatch(/\bparecer\b/i)
  expect(text).not.toMatch(/\bnotaFinal\b/)
  expect(text).not.toMatch(/\bcurrentScore\b/)
}

function assertSuccessContract(json: string): void {
  expect(json.startsWith("{")).toBe(true)
  const parsed = JSON.parse(json)
  expect(parsed.version).toBe(GLOBAL_ANALYSIS_SYNTHESIS_INPUT_VERSION)
  expect(parsed.coverage.state).toBe("complete")
  expect(parsed.coverage.coveragePercent).toBe(100)
  expect(json).not.toMatch(/timestamp|session|model|score|approval|parecer/i)
  expect(json).not.toMatch(/\bAPROVADO\b/)
  expect(json).not.toMatch(/\bREPROVADO\b/)
  expect(json).not.toContain("/home/")
  expect(json).not.toContain("/tmp/")
  expect(Object.keys(parsed).sort()).toEqual(
    ["coverage", "findings", "manuscriptFingerprint", "planId", "version"].sort(),
  )
}

/** Deep structural + byte snapshot of the project tree (relative paths). */
function snapshotProject(projectRoot: string): {
  structure: string[]
  files: Record<string, string>
} {
  const structure: string[] = []
  const files: Record<string, string> = {}

  function walk(dir: string, rel: string): void {
    const entries = readdirSync(dir).slice().sort()
    for (const name of entries) {
      const abs = join(dir, name)
      const childRel = rel ? `${rel}/${name}` : name
      const st = lstatSync(abs)
      if (st.isDirectory()) {
        structure.push(`${childRel}/`)
        walk(abs, childRel)
      } else if (st.isFile()) {
        structure.push(childRel)
        files[childRel] = readFileSync(abs, "utf-8")
      } else {
        structure.push(`${childRel}@${st.isSymbolicLink() ? "symlink" : "other"}`)
      }
    }
  }

  walk(projectRoot, "")
  return { structure, files }
}

function expectSnapshotsEqual(
  before: ReturnType<typeof snapshotProject>,
  after: ReturnType<typeof snapshotProject>,
): void {
  expect(after.structure).toEqual(before.structure)
  expect(Object.keys(after.files).sort()).toEqual(Object.keys(before.files).sort())
  for (const key of Object.keys(before.files)) {
    expect(after.files[key]).toBe(before.files[key])
  }
}

function prepareCompleteFixtures(
  projectRoot: string,
  findings: AnalysisFinding[] = [],
): {
  plan: ReturnType<typeof planOracle>["plan"]
  planId: string
  checkpoint: AnalysisCheckpoint
  store: AnalysisFindingsStoreV1
} {
  writeNestedManuscript(projectRoot)
  const { plan } = planOracle(projectRoot)
  expect(plan.status).toBe("complete")
  expect(plan.fingerprint).toBeTruthy()
  expect(plan.batches.length).toBeGreaterThan(0)

  const planId = computePlanIdentity(plan)
  const checkpoint = completeCheckpoint(plan)
  expect(checkpoint.state).toBe("complete")
  saveAnalysisCheckpoint(projectRoot, checkpoint)

  const store: AnalysisFindingsStoreV1 = {
    version: ANALYSIS_FINDINGS_STORE_VERSION,
    planId,
    manuscriptFingerprint: plan.fingerprint as string,
    findings,
  }
  saveAnalysisFindings(projectRoot, store)

  // Confirm public loaders see what we wrote.
  expect(loadAnalysisCheckpoint(projectRoot, planId)).not.toBeNull()
  expect(loadAnalysisFindings(projectRoot, planId)).not.toBeNull()

  return { plan, planId, checkpoint, store }
}

describe("banca_sintese — validated global synthesis input tool", () => {
  let projectRoot: string

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "ob-banca-sintese-"))
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  test("1) complete checkpoint + compatible store matches primitive JSON bytes", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const checkpoint = completeCheckpoint(plan)
    const findings = [
      findingOnBatch(plan, 0, "claim first batch"),
      findingOnBatch(plan, plan.batches.length - 1, "claim last batch"),
    ]
    saveAnalysisCheckpoint(projectRoot, checkpoint)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings,
    })

    const expected = JSON.stringify(
      createGlobalAnalysisSynthesisInput(plan, checkpoint, findings),
    )

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))

    expect(isErrorResult(result)).toBe(false)
    expect(result).toBe(expected)
    assertSuccessContract(result)
    assertNoAbsoluteProjectPath(result, projectRoot)
  })

  test("2) two equivalent calls return identical bytes", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const checkpoint = completeCheckpoint(plan)
    const findings = [findingOnBatch(plan, 0, "stable claim")]
    saveAnalysisCheckpoint(projectRoot, checkpoint)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings,
    })
    const expected = JSON.stringify(
      createGlobalAnalysisSynthesisInput(plan, checkpoint, findings),
    )

    const before = snapshotProject(projectRoot)
    const first = await runSintese(projectRoot)
    const second = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))

    expect(first).toBe(second)
    expect(first).toBe(expected)
    assertSuccessContract(first)
  })

  test("3) complete checkpoint with zero findings succeeds", async () => {
    const { plan, planId, checkpoint } = prepareCompleteFixtures(projectRoot, [])
    const expected = JSON.stringify(
      createGlobalAnalysisSynthesisInput(plan, checkpoint, []),
    )

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))

    expect(result).toBe(expected)
    const parsed = JSON.parse(result)
    expect(parsed.findings).toEqual([])
    expect(parsed.planId).toBe(planId)
    assertSuccessContract(result)
  })

  test("4) missing checkpoint returns missing_checkpoint", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    // Findings only — no checkpoint.
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings: [],
    })

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "missing_checkpoint", projectRoot)
  })

  test("5a) pending checkpoint fails controlled (incomplete_coverage)", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const pending = createAnalysisCheckpoint(plan)
    expect(pending.state).toBe("pending")
    saveAnalysisCheckpoint(projectRoot, pending)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings: [],
    })

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "incomplete_coverage", projectRoot)
  })

  test("5b) running (incomplete) checkpoint fails controlled", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.batches.length).toBeGreaterThan(1)
    const planId = computePlanIdentity(plan)
    let cp = createAnalysisCheckpoint(plan)
    cp = completeAnalysisBatch(plan, cp, plan.batches[0].batchId)
    expect(cp.state).toBe("running")
    saveAnalysisCheckpoint(projectRoot, cp)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings: [],
    })

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "incomplete_coverage", projectRoot)
  })

  test("5c) blocked plan/checkpoint fails controlled", async () => {
    writeBlockedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    expect(plan.status).toBe("blocked")
    const planId = computePlanIdentity(plan)
    const blocked = createAnalysisCheckpoint(plan)
    expect(blocked.state).toBe("blocked")
    saveAnalysisCheckpoint(projectRoot, blocked)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint ?? "a".repeat(64),
      findings: [],
    })

    // Blocked plans have null fingerprint; store may fail load or synthesis.
    // Write store with empty fingerprint framing via raw file if needed.
    // loadAnalysisFindings requires manuscriptFingerprint string matching findings.
    // For blocked plan fingerprint is null — store fingerprint check:
    // store.manuscriptFingerprint !== plan.fingerprint → null comparison.
    // "a".repeat(64) !== null → incompatible_fingerprint from tool.
    // Prefer that controlled path.
    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    // Either missing fingerprint match or blocked_plan — both controlled.
    expect(isErrorResult(result)).toBe(true)
    const code = errorCode(result)
    expect(["incompatible_fingerprint", "blocked_plan", "invalid_findings_store"]).toContain(
      code,
    )
    assertNoAbsoluteProjectPath(result, projectRoot)
    assertNoLeakContent(result)
  })

  test("5d) tampered checkpoint fails controlled", async () => {
    const { plan, planId, checkpoint } = prepareCompleteFixtures(projectRoot, [])
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "checkpoints",
      `${planId}.json`,
    )
    const tampered = { ...checkpoint, completedCharacters: checkpoint.completedCharacters - 1 }
    writeFileSync(path, JSON.stringify(tampered, null, 2), "utf-8")

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "tampered_checkpoint", projectRoot)
    void plan
  })

  test("5e) incompatible checkpoint planId fails controlled", async () => {
    const { plan, planId, checkpoint } = prepareCompleteFixtures(projectRoot, [])
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "checkpoints",
      `${planId}.json`,
    )
    // Keep file named by planId but change body planId → load fails incompatible_plan
    // or save under wrong identity.
    const tampered = { ...checkpoint, planId: "b".repeat(64) }
    writeFileSync(path, JSON.stringify(tampered, null, 2), "utf-8")

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "incompatible_plan", projectRoot)
    void plan
  })

  test("5f) checkpoint fingerprint incompatible with plan fails controlled", async () => {
    const { plan, planId, checkpoint } = prepareCompleteFixtures(projectRoot, [])
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "checkpoints",
      `${planId}.json`,
    )
    const tampered = { ...checkpoint, fingerprint: "c".repeat(64) }
    writeFileSync(path, JSON.stringify(tampered, null, 2), "utf-8")

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "incompatible_plan", projectRoot)
    void plan
  })

  test("6) missing findings store returns missing_findings", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const checkpoint = completeCheckpoint(plan)
    saveAnalysisCheckpoint(projectRoot, checkpoint)
    // No findings store.

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "missing_findings", projectRoot)
  })

  test("7a) malformed findings store fails controlled", async () => {
    const { plan, planId } = prepareCompleteFixtures(projectRoot, [])
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "findings",
      `${planId}.json`,
    )
    writeFileSync(path, "{not-json", "utf-8")

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "invalid_findings_store", projectRoot)
    void plan
  })

  test("7b) findings store with fingerprint different from live plan fails controlled", async () => {
    const { plan, planId } = prepareCompleteFixtures(projectRoot, [])
    const wrongFp = "d".repeat(64)
    // Write a store that loads (internal consistency) but mismatches live plan.
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "findings",
      `${planId}.json`,
    )
    writeFileSync(
      path,
      JSON.stringify(
        {
          version: ANALYSIS_FINDINGS_STORE_VERSION,
          planId,
          manuscriptFingerprint: wrongFp,
          findings: [],
        },
        null,
        2,
      ),
      "utf-8",
    )

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "incompatible_fingerprint", projectRoot)
    void plan
  })

  test("7c) findings store with wrong planId in file fails controlled", async () => {
    const { plan, planId } = prepareCompleteFixtures(projectRoot, [])
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "findings",
      `${planId}.json`,
    )
    writeFileSync(
      path,
      JSON.stringify(
        {
          version: ANALYSIS_FINDINGS_STORE_VERSION,
          planId: "e".repeat(64),
          manuscriptFingerprint: plan.fingerprint,
          findings: [],
        },
        null,
        2,
      ),
      "utf-8",
    )

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    assertControlledError(result, "incompatible_plan", projectRoot)
  })

  test("7d) store with invalid finding payload fails controlled", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const checkpoint = completeCheckpoint(plan)
    const findings = [findingOnBatch(plan, 0, "valid then tamper")]
    saveAnalysisCheckpoint(projectRoot, checkpoint)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings,
    })
    const path = join(
      projectRoot,
      ".banca",
      "analysis",
      "findings",
      `${planId}.json`,
    )
    const store = JSON.parse(readFileSync(path, "utf-8")) as AnalysisFindingsStoreV1
    expect(store.findings.length).toBe(1)
    // Tamper findingId so structural load may fail or synthesis rejects.
    store.findings[0] = {
      ...store.findings[0]!,
      findingId: "f".repeat(64),
    }
    writeFileSync(path, JSON.stringify(store, null, 2), "utf-8")

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    expect(isErrorResult(result)).toBe(true)
    const code = errorCode(result)
    // load may accept; primitive rejects invalid finding identity
    expect([
      "invalid_findings",
      "invalid_findings_store",
      "invalid_stored_finding",
      "incompatible_fingerprint",
    ]).toContain(code)
    assertNoAbsoluteProjectPath(result, projectRoot)
    assertNoLeakContent(result)
  })

  test("8) missing or whitespace-only root returns invalid_project_root", async () => {
    writeNestedManuscript(projectRoot)

    const missing = await runSintese(undefined, null)
    assertControlledError(missing, "invalid_project_root")

    for (const projectRootArg of ["   ", "\t", " \n "]) {
      const { bancaSintese } = await import("../src/tools/banca_sintese")
      const result = String(
        await bancaSintese.execute(
          { projectRoot: projectRootArg },
          { directory: projectRoot } as any,
        ),
      )
      assertControlledError(result, "invalid_project_root", projectRoot)
    }
  })

  test("9) error messages never leak absolute paths, claim, evidence, or raw FS text", async () => {
    writeNestedManuscript(projectRoot)
    // missing checkpoint
    const r1 = await runSintese(projectRoot)
    assertControlledError(r1, "missing_checkpoint", projectRoot)
    expect(errorMessage(r1)).not.toContain(projectRoot)
    expect(r1).not.toContain("claim first")
    expect(r1).not.toContain("Evidence span")
  })

  test("10) project snapshot is byte-equal and structural after tool run", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const checkpoint = completeCheckpoint(plan)
    const findings = [findingOnBatch(plan, 0, "snapshot claim")]
    saveAnalysisCheckpoint(projectRoot, checkpoint)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings,
    })
    const before = snapshotProject(projectRoot)
    // Snapshot is content+structure after fixtures, before tool — not mtime.
    const result = await runSintese(projectRoot)
    expect(isErrorResult(result)).toBe(false)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))

    // Also verify no extra files under .banca/analysis
    const analysisDir = join(projectRoot, ".banca", "analysis")
    expect(existsSync(analysisDir)).toBe(true)
    expect(readdirSync(join(analysisDir, "checkpoints")).length).toBe(1)
    expect(readdirSync(join(analysisDir, "findings")).length).toBe(1)
  })

  test("11) src/index.ts registers banca_sintese and preserves existing tools", async () => {
    const indexSrc = readFileSync(
      join(import.meta.dir, "../src/index.ts"),
      "utf-8",
    )
    expect(indexSrc).toContain('banca_sintese: bancaSintese')
    expect(indexSrc).toContain('import("./tools/banca_sintese")')
    // Existing tools remain registered.
    for (const key of [
      "banca_init",
      "banca_status",
      "banca_context",
      "banca_auditar",
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
    ]) {
      expect(indexSrc).toContain(`${key}:`)
    }

    const pluginMod = await import("../src/index")
    const plugin = pluginMod.default
    expect(typeof plugin).toBe("function")
    const surface = await plugin({} as any)
    expect(surface.tool).toBeDefined()
    expect(surface.tool!.banca_sintese).toBeDefined()
    expect(surface.tool!.banca_auditar).toBeDefined()
    expect(surface.tool!.banca_context).toBeDefined()
    expect(surface.tool!.banca_init).toBeDefined()
  })

  test("12) success payload is only the primitive contract", async () => {
    writeNestedManuscript(projectRoot)
    const { plan } = planOracle(projectRoot)
    const planId = computePlanIdentity(plan)
    const checkpoint = completeCheckpoint(plan)
    const findings = [findingOnBatch(plan, 0, "contract claim")]
    saveAnalysisCheckpoint(projectRoot, checkpoint)
    saveAnalysisFindings(projectRoot, {
      version: ANALYSIS_FINDINGS_STORE_VERSION,
      planId,
      manuscriptFingerprint: plan.fingerprint as string,
      findings,
    })
    const expectedObj = createGlobalAnalysisSynthesisInput(
      plan,
      checkpoint,
      findings,
    )

    const before = snapshotProject(projectRoot)
    const result = await runSintese(projectRoot)
    expectSnapshotsEqual(before, snapshotProject(projectRoot))

    expect(JSON.parse(result)).toEqual(expectedObj)
    assertSuccessContract(result)
    // No wrapper keys
    const parsed = JSON.parse(result)
    expect(parsed).not.toHaveProperty("kind")
    expect(parsed).not.toHaveProperty("disclaimer")
    expect(parsed).not.toHaveProperty("path")
    expect(parsed).not.toHaveProperty("timestamp")
    expect(parsed).not.toHaveProperty("score")
    expect(parsed).not.toHaveProperty("parecer")
  })

  test("source tree is read-only orchestration (no write APIs)", () => {
    const src = readFileSync(
      join(import.meta.dir, "../src/tools/banca_sintese.ts"),
      "utf-8",
    )
    expect(src).toContain("createGlobalAnalysisSynthesisInput")
    expect(src).toContain("loadAnalysisCheckpoint")
    expect(src).toContain("loadAnalysisFindings")
    expect(src).toContain("computePlanIdentity")
    expect(src).toContain("loadCanonicalLatexManuscript")
    expect(src).toContain("planExhaustiveAnalysisBatches")
    expect(src).toContain("loadConfig")
    expect(src).toContain("ctx?.directory")
    expect(src).not.toContain("saveAnalysisCheckpoint")
    expect(src).not.toContain("saveAnalysisFindings")
    expect(src).not.toContain("writeFileSync")
    expect(src).not.toContain("renameSync")
    expect(src).not.toContain("mkdirSync")
    expect(src).not.toContain("String(err)")
    expect(src).not.toContain("err instanceof Error ? err.message")
    expect(src).not.toContain("spawn")
    expect(src).not.toContain("child_process")
    expect(src).not.toMatch(/\bAPROVADO\b/)
    expect(src).not.toMatch(/\bREPROVADO\b/)
    expect(src).not.toContain("notaFinal")
    expect(src).not.toContain("currentScore")
  })

  test("root may come from ctx.directory when projectRoot omitted", async () => {
    prepareCompleteFixtures(projectRoot, [])
    const { bancaSintese } = await import("../src/tools/banca_sintese")
    const before = snapshotProject(projectRoot)
    const result = String(
      await bancaSintese.execute({}, { directory: projectRoot } as any),
    )
    expectSnapshotsEqual(before, snapshotProject(projectRoot))
    expect(isErrorResult(result)).toBe(false)
    assertSuccessContract(result)
  })
})
