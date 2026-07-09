import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const tmpBase = join(tmpdir(), "banca-test-auditar-" + Date.now())

describe("banca_auditar", () => {
  const testRoot = join(tmpBase, "test-project")

  beforeEach(() => {
    mkdirSync(join(testRoot, "capitulos"), { recursive: true })
    mkdirSync(join(testRoot, ".banca"), { recursive: true })
    writeFileSync(join(testRoot, ".banca", "project.json"), JSON.stringify({
      version: 1,
      manuscript: { format: "latex", root: ".", main: "main.tex", bib: "refs.bib", chapters: ["capitulos/*.tex"], outputDir: "trabalhos" },
      compile: { enabled: false, command: [] },
      allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
      protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
      immutableFacts: [], externalDependencies: [],
      rubricProfile: "banca-rigorosa", targetScore: 9.0,
      mcp: { referenceValidation: [] },
    }), "utf-8")
    writeFileSync(join(testRoot, "main.tex"), `
\\documentclass{article}
\\begin{document}
First paragraph without citation.

Second paragraph also no citation.

\\cite{autor2020} says something important.

Fourth paragraph with \\cite{outro2021}.

Last paragraph.
\\end{document}`)
    writeFileSync(join(testRoot, "refs.bib"), "@article{autor2020, author={A}, title={T}, year={2020}}")
  })

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true })
  })

  test("counts paragraphs and citations", async () => {
    const { bancaAuditar } = await import("../src/tools/banca_auditar")
    const result = await bancaAuditar.execute({ projectRoot: testRoot }, {} as any)

    expect(typeof result).toBe("string")
    expect(result).toContain("AUDIT RESULT")
    expect(result).toContain("Citações:")
    expect(result).toContain("Final:")
  })
})
