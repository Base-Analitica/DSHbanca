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

  test("Cenário C (RED obrigatório) — Physical collision via internal symlink blocks correction batch before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")

    mkdirSync(join(project, "capitulos"), { recursive: true })
    const contentA = "\\documentclass{article}\n\\begin{document}\nCONTENT_SYM_A\n\\end{document}\n"
    const hashA = sha256(contentA)
    writeFileSync(join(project, "capitulos", "cap1.tex"), contentA, "utf-8")
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))

    const stateBefore = loadState(project)
    expect(stateBefore.snapshots.length).toBe(0)

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [
          { file: "main.tex", oldText: "CONTENT_SYM_A", newText: "CONTENT_SYM_B" },
          { file: "capitulos/cap1.tex", oldText: "CONTENT_SYM_B", newText: "CONTENT_SYM_C" },
        ],
      },
      {} as any,
    )

    // MUST be blocked
    expect(String(result)).toContain("blocked: destinations collide:")
    expect(String(result)).toContain("resolve to the same file")

    // File content and hashes must remain exactly as original (CONTENT_SYM_A)
    const currentCap = readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")
    const currentMain = readFileSync(join(project, "main.tex"), "utf-8")
    expect(currentCap).toBe(contentA)
    expect(currentMain).toBe(contentA)
    expect(sha256(currentCap)).toBe(hashA)
    expect(sha256(currentMain)).toBe(hashA)

    // State must have zero snapshots and zero iterations
    const stateAfter = loadState(project)
    expect(stateAfter.snapshots.length).toBe(0)
    expect(stateAfter.iterations.length).toBe(0)

    // Vault must have zero snapshots
    const snapshotsDir = join(project, ".banca", "snapshots")
    if (existsSync(snapshotsDir)) {
      const snapDirs = readdirSync(snapshotsDir).filter((d) => d.startsWith("pre-"))
      expect(snapDirs.length).toBe(0)
    }
  })

  test("Cenário D (RED obrigatório) — Physical collision via hard links blocks correction batch before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")
    const { linkSync } = await import("node:fs")

    mkdirSync(join(project, "capitulos"), { recursive: true })
    const contentA = "\\documentclass{article}\n\\begin{document}\nHARD_CONTENT_A\n\\end{document}\n"
    const hashA = sha256(contentA)
    writeFileSync(join(project, "capitulos", "cap1.tex"), contentA, "utf-8")
    linkSync(join(project, "capitulos", "cap1.tex"), join(project, "capitulos", "cap1_hard.tex"))

    const stateBefore = loadState(project)
    expect(stateBefore.snapshots.length).toBe(0)

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [
          { file: "capitulos/cap1.tex", oldText: "HARD_CONTENT_A", newText: "HARD_CONTENT_B" },
          { file: "capitulos/cap1_hard.tex", oldText: "HARD_CONTENT_B", newText: "HARD_CONTENT_C" },
        ],
      },
      {} as any,
    )

    // MUST be blocked
    expect(String(result)).toContain("blocked: destinations collide:")
    expect(String(result)).toContain("resolve to the same file")

    // Both paths must remain intact with original content
    const current1 = readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")
    const current2 = readFileSync(join(project, "capitulos", "cap1_hard.tex"), "utf-8")
    expect(current1).toBe(contentA)
    expect(current2).toBe(contentA)
    expect(sha256(current1)).toBe(hashA)
    expect(sha256(current2)).toBe(hashA)

    // Zero snapshots
    const stateAfter = loadState(project)
    expect(stateAfter.snapshots.length).toBe(0)
    expect(stateAfter.iterations.length).toBe(0)
  })

  test("Cenário E — Duplicate logical targets in batch block correction before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")

    const contentA = "\\documentclass{article}\n\\begin{document}\nDUPLICATE_TARGET_A\n\\end{document}\n"
    const hashA = sha256(contentA)
    writeFileSync(join(project, "main.tex"), contentA, "utf-8")

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [
          { file: "main.tex", oldText: "DUPLICATE_TARGET_A", newText: "DUPLICATE_TARGET_B" },
          { file: "main.tex", oldText: "DUPLICATE_TARGET_B", newText: "DUPLICATE_TARGET_C" },
        ],
      },
      {} as any,
    )

    expect(String(result)).toContain("blocked: destinations collide:")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(contentA)
    expect(sha256(readFileSync(join(project, "main.tex"), "utf-8"))).toBe(hashA)

    const state = loadState(project)
    expect(state.snapshots.length).toBe(0)
  })

  test("Cenário F — Broken symlink destination blocks correction before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")

    mkdirSync(join(project, "capitulos"), { recursive: true })
    symlinkSync("nonexistent.tex", join(project, "capitulos", "broken.tex"))

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "capitulos/broken.tex", oldText: "A", newText: "B" }],
      },
      {} as any,
    )

    expect(String(result)).toContain("blocked:")
    const state = loadState(project)
    expect(state.snapshots.length).toBe(0)
  })

  test("Cenário G — Workspace escape destination blocks correction before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "../outside.tex", oldText: "A", newText: "B" }],
      },
      {} as any,
    )

    expect(String(result)).toContain("blocked: ../outside.tex escapes project root")
    const state = loadState(project)
    expect(state.snapshots.length).toBe(0)
  })

  test("Cenário H — Positive: batch with multiple independent files creates snapshot, dry-run works, and confirmed restore brings back exact bytes", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    mkdirSync(join(project, "capitulos"), { recursive: true })
    const mainOrig = "\\documentclass{article}\n\\begin{document}\nMAIN_ORIG\n\\end{document}\n"
    const cap1Orig = "CAP1_ORIG\n"
    writeFileSync(join(project, "main.tex"), mainOrig, "utf-8")
    writeFileSync(join(project, "capitulos", "cap1.tex"), cap1Orig, "utf-8")
    const hashMainOrig = sha256(mainOrig)
    const hashCapOrig = sha256(cap1Orig)

    const corrResult = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [
          { file: "main.tex", oldText: "MAIN_ORIG", newText: "MAIN_MODIFIED" },
          { file: "capitulos/cap1.tex", oldText: "CAP1_ORIG", newText: "CAP1_MODIFIED" },
        ],
      },
      {} as any,
    )

    expect(String(corrResult)).toContain("✓ main.tex")
    expect(String(corrResult)).toContain("✓ capitulos/cap1.tex")

    const state = loadState(project)
    expect(state.snapshots.length).toBe(1)
    const snapLabel = state.snapshots[0].label

    const dryRun = await bancaRestore.execute(
      { projectRoot: project, snapshotId: snapLabel, confirm: false },
      {} as any,
    )
    expect(String(dryRun)).toContain(`Restore Dry-Run for Snapshot: ${snapLabel}`)
    expect(String(dryRun)).toContain("- main.tex")
    expect(String(dryRun)).toContain("- capitulos/cap1.tex")

    const confirmRestore = await bancaRestore.execute(
      { projectRoot: project, snapshotId: snapLabel, confirm: true },
      {} as any,
    )
    expect(String(confirmRestore)).toContain(`restored from ${snapLabel}`)

    const restoredMain = readFileSync(join(project, "main.tex"), "utf-8")
    const restoredCap = readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")
    expect(restoredMain).toBe(mainOrig)
    expect(restoredCap).toBe(cap1Orig)
    expect(sha256(restoredMain)).toBe(hashMainOrig)
    expect(sha256(restoredCap)).toBe(hashCapOrig)
  })

  test("Cenário I — Positive: single internal symlink destination without collision succeeds and is restorable", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    mkdirSync(join(project, "capitulos"), { recursive: true })
    const capOrig = "\\documentclass{article}\n\\begin{document}\nCAP_VIA_SYM_ORIG\n\\end{document}\n"
    const hashOrig = sha256(capOrig)
    writeFileSync(join(project, "capitulos", "cap1.tex"), capOrig, "utf-8")
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))

    const corrResult = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "main.tex", oldText: "CAP_VIA_SYM_ORIG", newText: "CAP_VIA_SYM_MODIFIED" }],
      },
      {} as any,
    )

    expect(String(corrResult)).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toContain("CAP_VIA_SYM_MODIFIED")

    const state = loadState(project)
    expect(state.snapshots.length).toBe(1)
    const snapLabel = state.snapshots[0].label

    const confirmRestore = await bancaRestore.execute(
      { projectRoot: project, snapshotId: snapLabel, confirm: true },
      {} as any,
    )
    expect(String(confirmRestore)).toContain(`restored from ${snapLabel}`)

    const restoredMain = readFileSync(join(project, "main.tex"), "utf-8")
    const restoredCap = readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")
    expect(restoredMain).toBe(capOrig)
    expect(restoredCap).toBe(capOrig)
    expect(sha256(restoredMain)).toBe(hashOrig)
    expect(sha256(restoredCap)).toBe(hashOrig)
  })
})
