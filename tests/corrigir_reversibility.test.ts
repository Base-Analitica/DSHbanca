import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-corrigir-rev-"))
  project = join(base, "project")
  mkdirSync(project, { recursive: true })
  mkdirSync(join(project, ".banca"), { recursive: true })
  writeFileSync(
    join(project, ".banca", "project.json"),
    JSON.stringify({
      version: 1,
      manuscript: {
        format: "latex",
        root: ".",
        main: "main.tex",
        bib: "referencias.bib",
        chapters: ["capitulos/*.tex"],
        outputDir: "trabalhos",
      },
      compile: { enabled: false, command: [] },
      allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
      protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
      immutableFacts: ["dados/**"],
      externalDependencies: [],
      rubricProfile: "banca-rigorosa",
      targetScore: 9.0,
      providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
      mcp: { crossrefAcademicEnabled: false },
    }),
    "utf-8",
  )
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

describe("Issue #30: banca_corrigir and banca_restore reversibility", () => {
  test("Cenário A — pre-correction snapshot must be registered, restorable in dry-run, and fully reversible in confirm mode", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    const originalContent = "\\documentclass{article}\n\\begin{document}\nORIGINAL ACADEMIC TEXT\n\\end{document}\n"
    const originalHash = sha256(originalContent)
    writeFileSync(join(project, "main.tex"), originalContent, "utf-8")

    // Execute valid correction without skipSnapshot
    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "main.tex", oldText: "ORIGINAL ACADEMIC TEXT", newText: "CORRECTED ACADEMIC TEXT" }],
      },
      {} as any,
    )

    expect(String(result)).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(
      "\\documentclass{article}\n\\begin{document}\nCORRECTED ACADEMIC TEXT\n\\end{document}\n",
    )

    // Snapshot directory and manifest must exist
    const snapshotsDir = join(project, ".banca", "snapshots")
    expect(existsSync(snapshotsDir)).toBe(true)
    const dirs = readdirSync(snapshotsDir).filter((d) => d.startsWith("pre-") && !d.endsWith(".json"))
    expect(dirs.length).toBe(1)
    const preLabel = dirs[0]

    // MUST be registered in state.snapshots
    const state = loadState(project)
    const registered = state.snapshots.find((s) => s.label === preLabel || s.id === preLabel)
    expect(registered).toBeDefined()
    expect(registered!.label).toBe(preLabel)

    // Snapshot list in banca_restore must show it as [partial]
    const listResult = await bancaRestore.execute({ projectRoot: project }, {} as any)
    expect(String(listResult)).toContain(preLabel)
    expect(String(listResult)).toContain("[partial]")

    // Dry-run must succeed and show planned file
    const restoreDry = await bancaRestore.execute(
      { projectRoot: project, snapshotId: preLabel, confirm: false },
      {} as any,
    )
    const dryText = String(restoreDry)
    expect(dryText).toContain(`Restore Dry-Run for Snapshot: ${preLabel}`)
    expect(dryText).toContain("- main.tex")

    // Confirm restore must restore original content and byte hash
    const restoreConfirm = await bancaRestore.execute(
      { projectRoot: project, snapshotId: preLabel, confirm: true },
      {} as any,
    )
    expect(String(restoreConfirm)).toContain(`restored from ${preLabel}`)
    expect(String(restoreConfirm)).toContain("main.tex")

    const restoredContent = readFileSync(join(project, "main.tex"), "utf-8")
    expect(restoredContent).toBe(originalContent)
    expect(sha256(restoredContent)).toBe(originalHash)
  })

  test("Cenário B — skipSnapshot: true must be blocked and never modify files", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    const originalContent = "\\documentclass{article}\n\\begin{document}\nORIGINAL UNTOUCHED TEXT\n\\end{document}\n"
    const originalHash = sha256(originalContent)
    writeFileSync(join(project, "main.tex"), originalContent, "utf-8")

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "main.tex", oldText: "ORIGINAL UNTOUCHED TEXT", newText: "UNAUTHORIZED MUTATION" }],
        skipSnapshot: true,
      },
      {} as any,
    )

    // Must be blocked fail-closed
    expect(String(result)).toContain("blocked: skipSnapshot is not permitted in public correction workflow")

    // File must NOT be modified
    const currentContent = readFileSync(join(project, "main.tex"), "utf-8")
    expect(currentContent).toBe(originalContent)
    expect(sha256(currentContent)).toBe(originalHash)
  })

  test("Capture failure fail-closed: if snapshot directory cannot be created, no file is modified", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")

    const originalContent = "\\documentclass{article}\n\\begin{document}\nORIGINAL CONTENT\n\\end{document}\n"
    const originalHash = sha256(originalContent)
    writeFileSync(join(project, "main.tex"), originalContent, "utf-8")

    // Plant a regular file at .banca/snapshots to force snapshot creation failure
    const snapshotsPath = join(project, ".banca", "snapshots")
    writeFileSync(snapshotsPath, "BLOCKING_FILE", "utf-8")

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "main.tex", oldText: "ORIGINAL CONTENT", newText: "NEW CONTENT" }],
      },
      {} as any,
    )

    expect(String(result)).toContain("blocked:")
    // File must remain unchanged
    const currentContent = readFileSync(join(project, "main.tex"), "utf-8")
    expect(currentContent).toBe(originalContent)
    expect(sha256(currentContent)).toBe(originalHash)
  })

  test("Multiple corrections create distinct unique snapshots and both are restorable", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    const v0 = "VERSION 0\n"
    writeFileSync(join(project, "main.tex"), v0, "utf-8")

    // Correction 1: v0 -> v1
    const res1 = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "VERSION 0", newText: "VERSION 1" }] },
      {} as any,
    )
    expect(String(res1)).toContain("✓ main.tex")

    const state1 = loadState(project)
    expect(state1.snapshots.length).toBe(1)
    const snap1Label = state1.snapshots[0].label

    // Correction 2: v1 -> v2
    const res2 = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "VERSION 1", newText: "VERSION 2" }] },
      {} as any,
    )
    expect(String(res2)).toContain("✓ main.tex")

    const state2 = loadState(project)
    expect(state2.snapshots.length).toBe(2)
    const snap2Label = state2.snapshots[1].label
    expect(snap1Label).not.toBe(snap2Label)

    // Restore to snap1 (which should bring back v0)
    const rest1 = await bancaRestore.execute(
      { projectRoot: project, snapshotId: snap1Label, confirm: true },
      {} as any,
    )
    expect(String(rest1)).toContain(`restored from ${snap1Label}`)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(v0)
  })

  test("Security: tampered snapshot content is rejected and leaves manuscript untouched", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    writeFileSync(join(project, "main.tex"), "ORIGINAL\n", "utf-8")
    await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "ORIGINAL", newText: "MODIFIED" }] },
      {} as any,
    )

    const state = loadState(project)
    const label = state.snapshots[0].label

    // Tamper with snapshot vault file
    const vaultFile = join(project, ".banca", "snapshots", label, "main.tex")
    writeFileSync(vaultFile, "TAMPERED DATA", "utf-8")

    // Attempt restore
    const restoreResult = await bancaRestore.execute(
      { projectRoot: project, snapshotId: label, confirm: true },
      {} as any,
    )

    expect(String(restoreResult)).toContain("blocked: snapshot content for main.tex is missing or corrupted")
    // Current manuscript must stay as MODIFIED (not corrupted or tampered)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("MODIFIED\n")
  })

  test("Security: incomplete snapshot with .capture-incomplete marker is refused", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    writeFileSync(join(project, "main.tex"), "V1\n", "utf-8")
    await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "main.tex", oldText: "V1", newText: "V2" }] },
      {} as any,
    )

    const state = loadState(project)
    const label = state.snapshots[0].label

    // Plant .capture-incomplete marker
    const marker = join(project, ".banca", "snapshots", label, ".capture-incomplete")
    writeFileSync(marker, "incomplete\n", "utf-8")

    const restoreResult = await bancaRestore.execute(
      { projectRoot: project, snapshotId: label, confirm: true },
      {} as any,
    )

    expect(String(restoreResult)).toContain("blocked: snapshot is incomplete")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("V2\n")
  })

  test("Security: immutable facts and protected paths block correction before snapshot creation", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")

    mkdirSync(join(project, "dados"), { recursive: true })
    writeFileSync(join(project, "dados", "experimento.csv"), "1,2,3\n", "utf-8")

    const result = await bancaCorrigir.execute(
      { projectRoot: project, corrections: [{ file: "dados/experimento.csv", oldText: "1,2,3", newText: "9,9,9" }] },
      {} as any,
    )

    expect(String(result)).toContain("blocked:")
    expect(String(result)).toContain("is immutable")
    expect(readFileSync(join(project, "dados", "experimento.csv"), "utf-8")).toBe("1,2,3\n")

    // Zero snapshots created or registered
    const state = loadState(project)
    expect(state.snapshots.length).toBe(0)
  })
})
