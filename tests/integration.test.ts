import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const tmpBase = join(tmpdir(), "banca-int-" + Date.now())

let testRoot: string

function mockMainTex() {
  writeFileSync(join(testRoot, "main.tex"), `
\\documentclass{article}
\\begin{document}
Introduction paragraph without cite.

Second paragraph with \\cite{autor2020}.

More content here.
\\end{document}
`)
}

function mockProjectJson(overrides = {}) {
  const cfg = {
    version: 1,
    manuscript: { format: "latex", root: ".", main: "main.tex", bib: "refs.bib", chapters: ["capitulos/*.tex"], outputDir: "trabalhos" },
    compile: { enabled: false, command: [] },
    allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
    protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: [], externalDependencies: [],
    rubricProfile: "banca-rigorosa", targetScore: 9.0,
    providers: { references: { primary: "mcp:crossref-academic", fallbacks: ["rest:crossref", "cache"], timeoutMs: 20000 } },
    mcp: { crossrefAcademicEnabled: true },
    ...overrides,
  }
  writeFileSync(join(testRoot, ".banca", "project.json"), JSON.stringify(cfg), "utf-8")
}

describe("Integration — config validation", () => {
  beforeEach(() => { testRoot = join(tmpBase, `cfg-${Date.now()}`); mkdirSync(testRoot, { recursive: true }); mkdirSync(join(testRoot, ".banca"), { recursive: true }) })
  afterEach(() => { rmSync(tmpBase, { recursive: true, force: true }) })

  test("valid config passes", async () => {
    mockProjectJson()
    const { validateConfig } = await import("../src/lib/config")
    const r = validateConfig(testRoot)
    expect(r.valid).toBe(true)
  })

  test("invalid targetScore fails", async () => {
    mockProjectJson({ targetScore: 15 })
    const { validateConfig } = await import("../src/lib/config")
    const r = validateConfig(testRoot)
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => e.includes("targetScore"))).toBe(true)
  })

  test("missing config returns invalid", async () => {
    const { validateConfig } = await import("../src/lib/config")
    const r = validateConfig(join(tmpBase, "nonexistent"))
    expect(r.valid).toBe(false)
  })
})

describe("Integration — state management", () => {
  beforeEach(() => { testRoot = join(tmpBase, `state-${Date.now()}`); mkdirSync(join(testRoot, ".banca"), { recursive: true }) })
  afterEach(() => { rmSync(tmpBase, { recursive: true, force: true }) })

  test("loadState returns empty if no state file", async () => {
    const { loadState } = await import("../src/lib/state")
    const s = loadState(testRoot)
    expect(s.currentScore).toBeNull()
    expect(s.iterations).toEqual([])
  })

  test("addIteration persists to state", async () => {
    const { addIteration, loadState } = await import("../src/lib/state")
    addIteration(testRoot, "test-correction", null, 8.0, "ok")
    const s = loadState(testRoot)
    expect(s.iterations.length).toBe(1)
    expect(s.iterations[0].scoreAfter).toBe(8.0)
    expect(s.currentScore).toBe(8.0)
  })

  test("addSnapshot registers snapshot", async () => {
    const { addSnapshot, loadState } = await import("../src/lib/state")
    const id = addSnapshot(testRoot, "pre-test", 7.0)
    const s = loadState(testRoot)
    expect(s.snapshots.length).toBe(1)
    expect(s.snapshots[0].id).toBe(id)
    expect(s.snapshots[0].scoreBefore).toBe(7.0)
  })
})

describe("Integration — audit", () => {
  beforeEach(() => { testRoot = join(tmpBase, `audit-${Date.now()}`); mkdirSync(join(testRoot, "capitulos"), { recursive: true }); mkdirSync(join(testRoot, ".banca"), { recursive: true }) })
  afterEach(() => { rmSync(tmpBase, { recursive: true, force: true }) })

  test("audit validates batch findings and returns structured receipt (no global score)", async () => {
    mockProjectJson()
    mockMainTex()
    writeFileSync(join(testRoot, "refs.bib"), "@article{autor2020, author={A}, title={T}, year={2020}}")

    const { loadConfig } = await import("../src/lib/config")
    const { loadCanonicalLatexManuscript } = await import("../src/lib/latex_loader")
    const { planExhaustiveAnalysisBatches } = await import("../src/lib/analysis_coverage")
    const { bancaAuditar, AUDIT_RECEIPT_KIND, AUDIT_RECEIPT_DISCLAIMER } = await import(
      "../src/tools/banca_auditar"
    )

    const config = loadConfig(testRoot)
    const manuscript = loadCanonicalLatexManuscript(testRoot, config)
    const plan = planExhaustiveAnalysisBatches(
      manuscript,
      config.analysis.maxCharactersPerBatch,
    )
    expect(plan.status).toBe("complete")
    expect(plan.batches.length).toBeGreaterThan(0)

    const batch = plan.batches[0]
    const chunk = batch.chunks[0]
    const result = String(
      await bancaAuditar.execute(
        {
          projectRoot: testRoot,
          manuscriptFingerprint: plan.fingerprint!,
          batchId: batch.batchId,
          findings: [
            {
              category: "structure",
              severity: "warning",
              claim: "Integration claim",
              evidence: "Integration evidence",
              file: chunk.source.file,
              startLine: chunk.source.startLine,
              endLine: chunk.source.endLine,
              sectionId: "sec:integration",
            },
          ],
        },
        { directory: testRoot } as any,
      ),
    )

    const receipt = JSON.parse(result)
    expect(receipt.kind).toBe(AUDIT_RECEIPT_KIND)
    expect(receipt.acceptedCount).toBe(1)
    expect(receipt.findings).toHaveLength(1)
    expect(receipt.findings[0].findingId).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.disclaimer).toBe(AUDIT_RECEIPT_DISCLAIMER)
    expect(result).not.toContain("AUDIT RESULT")
    expect(result).not.toMatch(/\bAPROVADO\b/)
    expect(result).not.toMatch(/\bREPROVADO\b/)
    expect(result).not.toMatch(/\bFinal:\s*\d/)
  })
})

describe("Integration — immutableFacts guard", () => {
  beforeEach(() => { testRoot = join(tmpBase, `guard-${Date.now()}`); mkdirSync(join(testRoot, "capitulos"), { recursive: true }); mkdirSync(join(testRoot, ".banca"), { recursive: true }) })
  afterEach(() => { rmSync(tmpBase, { recursive: true, force: true }) })

  test("blocks correction to immutable file", async () => {
    mockProjectJson({ immutableFacts: ["dados/**"] })
    mkdirSync(join(testRoot, "dados"), { recursive: true })
    writeFileSync(join(testRoot, "dados", "experimento.csv"), "a,b,c\n1,2,3")
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const result = await bancaCorrigir.execute({
      projectRoot: testRoot,
      corrections: [{ file: "dados/experimento.csv", oldText: "1,2,3", newText: "4,5,6" }],
      skipSnapshot: true,
    }, {} as any)
    expect(result).toContain("blocked")
    expect(result).toContain("immutable")
  })

  test("allows correction to non-immutable file", async () => {
    mockProjectJson({ immutableFacts: ["dados/**"] })
    mockMainTex()
    writeFileSync(join(testRoot, "refs.bib"), "@article{a, author={A}, title={T}, year={2020}}")
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const result = await bancaCorrigir.execute({
      projectRoot: testRoot,
      corrections: [{ file: "main.tex", oldText: "Introduction paragraph", newText: "Updated paragraph" }],
      skipSnapshot: true,
    }, {} as any)
    expect(result).not.toContain("blocked")
    expect(result).toContain("✓")
  })
})

describe("Integration — IA regex fallback", () => {
  beforeEach(() => { testRoot = join(tmpBase, `ia-${Date.now()}`); mkdirSync(join(testRoot, "capitulos"), { recursive: true }); mkdirSync(join(testRoot, ".banca"), { recursive: true }) })
  afterEach(() => { rmSync(tmpBase, { recursive: true, force: true }) })

  test("detects AI patterns in text", async () => {
    mockProjectJson()
    writeFileSync(join(testRoot, "main.tex"), `\\documentclass{article}
\\begin{document}
Ademais, é imperativo que consideremos esta questão.
Outrossim, torna-se evidente que não apenas os resultados,
mas também a metodologia são relevantes.
\\end{document}`)
    const { bancaIa } = await import("../src/tools/banca_ia")
    const result = await bancaIa.execute({ projectRoot: testRoot, forceRegex: true }, {} as any)
    expect(result).toContain("risk=")
    expect(result).toContain("patterns=")
  })
})

describe("Integration — loop circuit breaker", () => {
  beforeEach(() => { testRoot = join(tmpBase, `loop-${Date.now()}`); mkdirSync(join(testRoot, "capitulos"), { recursive: true }); mkdirSync(join(testRoot, ".banca"), { recursive: true }) })
  afterEach(() => { rmSync(tmpBase, { recursive: true, force: true }) })

  test("appends iteration and detects no stagnation on first run", async () => {
    mockProjectJson()
    mockMainTex()
    writeFileSync(join(testRoot, "refs.bib"), "@article{a, author={A}, title={T}, year={2020}}")
    const { bancaLoop } = await import("../src/tools/banca_loop")
    const result = await bancaLoop.execute({ projectRoot: testRoot }, {} as any)
    expect(result).toContain("Loop iteration")
  })
})

describe("Integration — path traversal safety", () => {
  beforeEach(() => {
    testRoot = join(tmpBase, `path-safety-${Date.now()}`)
    mkdirSync(testRoot, { recursive: true })
    mkdirSync(join(testRoot, ".banca"), { recursive: true })
  })
  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true })
  })

  test("rejeita ../evil.tex em bancaCorrigir", async () => {
    mockProjectJson()
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const result = await bancaCorrigir.execute({
      projectRoot: testRoot,
      corrections: [{ file: "../evil.tex", oldText: "a", newText: "b" }],
      skipSnapshot: true,
    }, {} as any)
    expect(result).toContain("blocked")
    expect(result).toContain("escapes project root")
  })

  test("rejeita path absoluto em bancaCorrigir", async () => {
    mockProjectJson()
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const result = await bancaCorrigir.execute({
      projectRoot: testRoot,
      corrections: [{ file: "/etc/passwd", oldText: "a", newText: "b" }],
      skipSnapshot: true,
    }, {} as any)
    expect(result).toContain("blocked")
    expect(result).toContain("escapes project root")
  })

  test("rejeita snapshot label com ../ em bancaSnapshot", async () => {
    mockProjectJson()
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const result = await bancaSnapshot.execute({
      projectRoot: testRoot,
      label: "../evil-label",
    }, {} as any)
    expect(result).toContain("blocked")
    expect(result).toContain("escapes project root")
  })

  test("restore não aceita label que sai de .banca/snapshots", async () => {
    mockProjectJson()
    const { addSnapshot } = await import("../src/lib/state")
    // Register a malicious snapshot label in state.json manually
    const id = addSnapshot(testRoot, "../evil-label", 5.0)

    const { bancaRestore } = await import("../src/tools/banca_restore")
    const result = await bancaRestore.execute({
      projectRoot: testRoot,
      snapshotId: id,
    }, {} as any)
    expect(result).toContain("blocked")
    expect(result).toContain("escapes project root")
  })

  test("snapshots ignoram arquivos proibidos como .env", async () => {
    mockProjectJson()
    mockMainTex()
    writeFileSync(join(testRoot, ".env"), "SECRET=123")
    mkdirSync(join(testRoot, ".banca", "cache"), { recursive: true })
    writeFileSync(join(testRoot, ".banca", "cache", "refs.json"), "{}")
    mkdirSync(join(testRoot, ".opencode", "agents"), { recursive: true })
    writeFileSync(join(testRoot, ".opencode", "agents", "x.md"), "agent")

    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const result = await bancaSnapshot.execute({
      projectRoot: testRoot,
      label: "test-exclude",
    }, {} as any)

    expect(result).toContain("snapshot →")
    const snapDir = join(testRoot, ".banca", "snapshots", "test-exclude")
    expect(existsSync(join(snapDir, "main.tex"))).toBe(true)
    expect(existsSync(join(snapDir, ".env"))).toBe(false)
    expect(existsSync(join(snapDir, ".banca", "cache", "refs.json"))).toBe(false)
    expect(existsSync(join(snapDir, ".opencode", "agents", "x.md"))).toBe(false)
  })
})

describe("Integration — buildCompileCommands", () => {
  test("buildCompileCommands com caminhos relativos e espaços", async () => {
    const { buildCompileCommands } = await import("../src/lib/latex")
    const commands = ["pdflatex", "bibtex", "pdflatex"]
    const mainFileAbs = "/workspace/project/trabalho final/main.tex"
    const cwdAbs = "/workspace/project"
    const steps = buildCompileCommands(commands, mainFileAbs, cwdAbs)
    
    expect(steps.length).toBe(3)
    expect(steps[0]).toEqual({
      command: "pdflatex",
      args: ["-interaction=nonstopmode", "trabalho final/main.tex"],
      label: "pdflatex pass 1"
    })
    expect(steps[1]).toEqual({
      command: "bibtex",
      args: ["trabalho final/main"],
      label: "bibtex bibliography"
    })
    expect(steps[2]).toEqual({
      command: "pdflatex",
      args: ["-interaction=nonstopmode", "trabalho final/main.tex"],
      label: "pdflatex pass 3"
    })
  })
})

describe("Integration — path portability", () => {
  test("toPosixPath converte caminhos Windows para POSIX", async () => {
    const { toPosixPath, isPathProtected, isPathAllowed } = await import("../src/lib/paths")
    
    expect(toPosixPath("capitulos\\intro.tex")).toBe("capitulos/intro.tex")
    expect(toPosixPath("capitulos\\\\intro.tex")).toBe("capitulos/intro.tex")
    expect(toPosixPath("capitulos/intro.tex")).toBe("capitulos/intro.tex")

    const config = {
      allowedPaths: ["capitulos/*.tex"],
      protectedPaths: [".banca/snapshots/**"]
    } as any

    expect(isPathAllowed("capitulos\\intro.tex", config)).toBe(true)
    expect(isPathProtected(".banca\\snapshots\\snap-1\\main.tex", config)).toBe(true)
  })
})

describe("Integration — Auditoria Extrema Fixes", () => {
  beforeEach(() => {
    testRoot = join(tmpBase, `fixes-${Date.now()}`)
    mkdirSync(testRoot, { recursive: true })
    mkdirSync(join(testRoot, ".banca"), { recursive: true })
  })
  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true })
  })

  test("banca_ia com forceRegex executa com sucesso sem shell", async () => {
    mockProjectJson()
    writeFileSync(join(testRoot, "main.tex"), "Ademais, é imperativo que o faça.")
    const { bancaIa } = await import("../src/tools/banca_ia")
    const result = await bancaIa.execute({ projectRoot: testRoot, forceRegex: true }, {} as any)
    expect(result).toContain("Regex heuristic")
  })

  test("banca_plagio com HTML executa com sucesso sem shell", async () => {
    mockProjectJson()
    const reportHtml = join(testRoot, "report.html")
    writeFileSync(reportHtml, "<table><tr><td>origem.tex</td><td>15,5%</td><td>12,0%</td><td>termo1</td></tr></table>")
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    const result = await bancaPlagio.execute({ projectRoot: testRoot, reportPath: reportHtml }, {} as any)
    expect(result).toContain("Plágio — Report")
  })

  test("banca_plagio rejeita reportPath absoluto fora do projectRoot", async () => {
    mockProjectJson()
    const { bancaPlagio } = await import("../src/tools/banca_plagio")
    expect(bancaPlagio.execute({ projectRoot: testRoot, reportPath: "/etc/passwd" }, {} as any)).rejects.toThrow()
  })

  test("banca_restore sem confirm executa apenas dry-run", async () => {
    mockProjectJson()
    mockMainTex()
    // Create snapshot
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    await bancaSnapshot.execute({ projectRoot: testRoot, label: "snap-restore-test" }, {} as any)

    // Modify file
    const mainPath = join(testRoot, "main.tex")
    writeFileSync(mainPath, "MODIFIED CONTENT")

    // Restore without confirm
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const result = await bancaRestore.execute({ projectRoot: testRoot, snapshotId: "snap-restore-test" }, {} as any)
    expect(result).toContain("Restore Dry-Run")
    expect(readFileSync(mainPath, "utf-8")).toContain("MODIFIED CONTENT")
  })

  test("banca_restore com confirm cria backup e restaura", async () => {
    mockProjectJson()
    mockMainTex()
    // Create snapshot
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    await bancaSnapshot.execute({ projectRoot: testRoot, label: "snap-restore-test" }, {} as any)

    // Modify file
    const mainPath = join(testRoot, "main.tex")
    writeFileSync(mainPath, "MODIFIED CONTENT")

    // Restore with confirm
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const result = await bancaRestore.execute({ projectRoot: testRoot, snapshotId: "snap-restore-test", confirm: true }, {} as any)
    expect(result).toContain("restored from snap-restore-test")
    expect(result).toContain("Safety backup created")
    expect(readFileSync(mainPath, "utf-8")).not.toContain("MODIFIED CONTENT")
    expect(readFileSync(mainPath, "utf-8")).toContain("Introduction paragraph")
  })

  test("installAssets instala assets versionados representativos", async () => {
    const { installAssets } = await import("../src/lib/install_assets")
    const installed = installAssets(testRoot, true)
    expect(installed.length).toBeGreaterThan(0)
    // Check if the agent file is copied
    const agentPath = join(testRoot, ".opencode", "agents", "banca-loop.md")
    expect(existsSync(agentPath)).toBe(true)
    expect(readFileSync(agentPath, "utf-8")).toContain("Orquestra etapa assistida")
  })

  test("banca_ia com caminho contendo aspas e caracteres especiais não executa código injetado", async () => {
    const filename = "main_\"_inject.tex"
    mockProjectJson({
      manuscript: { format: "latex", root: ".", main: filename, bib: "refs.bib", chapters: [], outputDir: "trabalhos" }
    })
    writeFileSync(join(testRoot, filename), "Ademais, é imperativo que o faça.")
    
    const { bancaIa } = await import("../src/tools/banca_ia")
    const result = await bancaIa.execute({ projectRoot: testRoot }, {} as any)
    expect(result).toContain("IA Detection Report")
  })

  test("banca_ia rejeita arquivos fora do projectRoot", async () => {
    mockProjectJson({
      manuscript: { format: "latex", root: ".", main: "../evil.tex", bib: "refs.bib", chapters: [], outputDir: "trabalhos" }
    })
    const { bancaIa } = await import("../src/tools/banca_ia")
    expect(bancaIa.execute({ projectRoot: testRoot }, {} as any)).rejects.toThrow()
  })
})



