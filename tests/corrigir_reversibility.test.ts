import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"

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

  test("Cenário J (RED obrigatório) — Undeclared internal hard link alias is blocked before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")
    const { linkSync, statSync } = await import("node:fs")

    mkdirSync(join(project, "capitulos"), { recursive: true })
    const contentA = "\\documentclass{article}\n\\begin{document}\nINTERNAL_HARD_A\n\\end{document}\n"
    const hashA = sha256(contentA)
    writeFileSync(join(project, "main.tex"), contentA, "utf-8")
    linkSync(join(project, "main.tex"), join(project, "capitulos", "alias.tex"))

    expect(statSync(join(project, "main.tex")).nlink).toBe(2)
    expect(statSync(join(project, "capitulos", "alias.tex")).nlink).toBe(2)

    const stateBefore = loadState(project)
    expect(stateBefore.snapshots.length).toBe(0)

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "main.tex", oldText: "INTERNAL_HARD_A", newText: "INTERNAL_HARD_B" }],
      },
      {} as any,
    )

    // MUST be blocked
    expect(String(result)).toContain("blocked:")
    expect(String(result)).toContain("has multiple hard links")

    // Both files must retain original content and hash
    const currentMain = readFileSync(join(project, "main.tex"), "utf-8")
    const currentAlias = readFileSync(join(project, "capitulos", "alias.tex"), "utf-8")
    expect(currentMain).toBe(contentA)
    expect(currentAlias).toBe(contentA)
    expect(sha256(currentMain)).toBe(hashA)
    expect(sha256(currentAlias)).toBe(hashA)

    // Zero snapshots and zero iterations
    const stateAfter = loadState(project)
    expect(stateAfter.snapshots.length).toBe(0)
    expect(stateAfter.iterations.length).toBe(0)

    // Vault has no snapshots
    const snapshotsDir = join(project, ".banca", "snapshots")
    if (existsSync(snapshotsDir)) {
      const snapDirs = readdirSync(snapshotsDir).filter((d) => d.startsWith("pre-"))
      expect(snapDirs.length).toBe(0)
    }
  })

  test("Cenário K (RED obrigatório) — External hard link alias outside workspace is blocked before snapshot and write", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { loadState } = await import("../src/lib/state")
    const { linkSync, statSync } = await import("node:fs")

    const outsideDir = join(base, "outside")
    mkdirSync(outsideDir, { recursive: true })

    const contentA = "\\documentclass{article}\n\\begin{document}\nEXTERNAL_HARD_A\n\\end{document}\n"
    const hashA = sha256(contentA)
    writeFileSync(join(project, "main.tex"), contentA, "utf-8")
    linkSync(join(project, "main.tex"), join(outsideDir, "external.tex"))

    expect(statSync(join(project, "main.tex")).nlink).toBe(2)
    expect(statSync(join(outsideDir, "external.tex")).nlink).toBe(2)

    const stateBefore = loadState(project)
    expect(stateBefore.snapshots.length).toBe(0)

    const result = await bancaCorrigir.execute(
      {
        projectRoot: project,
        corrections: [{ file: "main.tex", oldText: "EXTERNAL_HARD_A", newText: "EXTERNAL_HARD_B" }],
      },
      {} as any,
    )

    // MUST be blocked
    expect(String(result)).toContain("blocked:")
    expect(String(result)).toContain("has multiple hard links")

    // Both files must retain original content and hash
    const currentMain = readFileSync(join(project, "main.tex"), "utf-8")
    const currentOutside = readFileSync(join(outsideDir, "external.tex"), "utf-8")
    expect(currentMain).toBe(contentA)
    expect(currentOutside).toBe(contentA)
    expect(sha256(currentMain)).toBe(hashA)
    expect(sha256(currentOutside)).toBe(hashA)

    // Zero snapshots and zero iterations
    const stateAfter = loadState(project)
    expect(stateAfter.snapshots.length).toBe(0)
    expect(stateAfter.iterations.length).toBe(0)

    // Vault has no snapshots
    const snapshotsDir = join(project, ".banca", "snapshots")
    if (existsSync(snapshotsDir)) {
      const snapDirs = readdirSync(snapshotsDir).filter((d) => d.startsWith("pre-"))
      expect(snapDirs.length).toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Issue #146 — banca_corrigir must normalize the workspace root once
//
// `banca_corrigir` selected `args.projectRoot || ctx.directory` without
// normalizing it and then created the mandatory pre-correction snapshot with
// `ensureRealDirInsideRoot(root, join(root, ".banca", "snapshots"))`. With a
// relative root (`project`) the manuscript was really modified and the backup
// was registered in the true `state.json`, but its bytes were stored in
// `project/project/.banca/snapshots`: the recovery point announced to the
// caller was unreachable through the corrected restore consumer (#149).
//
// Every scenario uses synthetic projects and the real tools. Relative
// representations run in bounded subprocesses with an explicit cwd (never
// `process.chdir`); recursive inventories compare kinds, link targets and
// SHA-256 before/after. The recovery point is always exercised by a real
// `banca_restore`, never accepted from the manifest alone.
// ---------------------------------------------------------------------------

describe("issue #146 — banca_corrigir keeps the pre-correction backup in the true vault", () => {
  const ORIGINAL = "PREFIXO TEXTO ORIGINAL SUFIXO"
  const CORRECTED = "PREFIXO TEXTO CORRIGIDO SUFIXO"
  const DECOY_MANUSCRIPT = "DECOY CONTENT INTOCADO"

  const CONFIG_146 = {
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
    immutableFacts: [],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9,
    providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
    mcp: { crossrefAcademicEnabled: false },
  }

  const CORRECTION = [
    { file: "main.tex", oldText: "ORIGINAL", newText: "CORRIGIDO", expectedOccurrences: 1 },
  ]

  type BoundedResult = {
    timedOut: boolean
    parsed: { ok: boolean; result?: string; name?: string; message?: string }
  }

  function write(root: string, rel: string, content: string): string {
    const abs = join(root, rel)
    mkdirSync(join(abs, ".."), { recursive: true })
    writeFileSync(abs, content, "utf8")
    return abs
  }

  function setupWorkspace(root: string, mainContent: string, config: unknown = CONFIG_146): void {
    mkdirSync(join(root, ".banca"), { recursive: true })
    write(root, ".banca/project.json", JSON.stringify(config))
    write(root, "main.tex", mainContent)
    write(root, "referencias.bib", "@book{sintetica, title={Referencia sintetica}}")
    write(root, "capitulos/cap1.tex", "CAPITULO SINTETICO INTOCADO")
  }

  function vaultOf(root: string): string {
    return join(root, ".banca", "snapshots")
  }

  function snapDirOf(root: string, label: string): string {
    return join(vaultOf(root), label)
  }

  function manifestOf(root: string, label: string): any {
    return JSON.parse(readFileSync(join(vaultOf(root), `${label}.manifest.json`), "utf8"))
  }

  function stateOf(root: string): any | null {
    const statePath = join(root, ".banca", "state.json")
    if (!existsSync(statePath)) return null
    return JSON.parse(readFileSync(statePath, "utf8"))
  }

  function stateLabels(root: string): string[] {
    return (stateOf(root)?.snapshots ?? []).map((s: any) => s.label)
  }

  function lastSnapshotLabel(root: string): string {
    const labels = stateLabels(root)
    expect(labels.length).toBeGreaterThan(0)
    return labels[labels.length - 1]
  }

  /** Complete recursive inventory: kind, symlink target or file SHA-256. */
  function inventoryTree(root: string): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (dir: string): void => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        const abs = join(dir, entry.name)
        const rel = relative(root, abs).split("\\").join("/")
        const st = lstatSync(abs)
        if (st.isSymbolicLink()) out[rel] = `symlink:${readlinkSync(abs)}`
        else if (st.isDirectory()) {
          out[rel] = "dir"
          walk(abs)
        } else if (st.isFile()) out[rel] = `file:${sha256(readFileSync(abs))}`
        else out[rel] = "special"
      }
    }
    walk(root)
    return out
  }

  /**
   * Path where the pre-fix implementation applied a relative root twice:
   * `<true root>/<relative representation>`. Independent oracle for the
   * decoy and "no stray tree" assertions.
   */
  function duplicatedRootPath(trueRoot: string, relativeRootArg: string): string {
    return join(trueRoot, ...relativeRootArg.split("/").filter((part) => part !== "" && part !== "."))
  }

  /** Run the real tool in a bounded subprocess with an explicit cwd. */
  function boundedTool(
    tool: "banca_corrigir" | "banca_restore",
    cwd: string,
    args: Record<string, unknown>,
    ctxDirectory: string,
  ): BoundedResult {
    const worker = join(cwd, `${tool}-worker-146-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`)
    const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", `${tool}.ts`)).href
    const exportName = tool === "banca_corrigir" ? "bancaCorrigir" : "bancaRestore"
    writeFileSync(
      worker,
      [
        "const toolUrl = process.argv[2]",
        "const exportName = process.argv[3]",
        "const args = JSON.parse(process.argv[4])",
        "const ctxDirectory = process.argv[5]",
        "const mod = await import(toolUrl)",
        "const tool = mod[exportName]",
        "try {",
        "  const result = await tool.execute(args, { directory: ctxDirectory })",
        "  console.log(JSON.stringify({ ok: true, result: String(result) }))",
        "} catch (error) {",
        "  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    )
    const outcome = spawnSync(
      process.execPath,
      [worker, toolUrl, exportName, JSON.stringify(args), ctxDirectory],
      { cwd, env: { ...process.env, PATH: "" }, timeout: 20_000, encoding: "utf-8" },
    )
    const timedOut = outcome.error !== undefined || outcome.signal !== null
    const jsonLine = (outcome.stdout ?? "")
      .split("\n")
      .reverse()
      .find((line) => line.trim().startsWith("{"))
    const parsed = jsonLine
      ? (JSON.parse(jsonLine) as BoundedResult["parsed"])
      : { ok: false, name: "NONE", message: "no JSON result from bounded worker" }
    return { timedOut, parsed }
  }

  function expectCorrectionSuccess(result: BoundedResult): string {
    expect(result.timedOut).toBe(false)
    expect(result.parsed.ok).toBe(true)
    const text = String(result.parsed.result)
    expect(text).toContain("✓ main.tex (1 replacement)")
    expect(text).not.toMatch(/blocked|failed/)
    return text
  }

  function expectRestoreSuccess(result: BoundedResult, label: string): string {
    expect(result.timedOut).toBe(false)
    expect(result.parsed.ok).toBe(true)
    const text = String(result.parsed.result)
    expect(text).toContain(`restored from ${label}`)
    expect(text).toContain("Safety backup created")
    expect(text).not.toMatch(/blocked|failed|partial:/)
    return text
  }

  function expectBoundedRefusal(result: BoundedResult, fragments: string[] = []): string {
    expect(result.timedOut).toBe(false)
    expect(result.parsed.ok).toBe(true)
    const text = String(result.parsed.result)
    expect(text).not.toContain("✓ main.tex")
    expect(text).not.toContain("restored from")
    expect(text).not.toContain("Safety backup created")
    for (const fragment of fragments) expect(text).toContain(fragment)
    return text
  }

  // --------------------------------------- B. authorized, reversible correction

  test("absolute root: only the authorized occurrence changes and the true-vault partial backup restores it", async () => {
    const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
    const { bancaRestore } = await import("../src/tools/banca_restore")
    setupWorkspace(project, ORIGINAL)
    const originalSha = sha256(ORIGINAL)

    const result = String(
      await bancaCorrigir.execute(
        { projectRoot: project, corrections: CORRECTION },
        {} as any,
      ),
    )
    expect(result).toContain("✓ main.tex (1 replacement)")
    // Exactly the authorized substitution, nothing else.
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CORRECTED)
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("CAPITULO SINTETICO INTOCADO")
    expect(existsSync(join(project, "project"))).toBe(false)

    // Mandatory pre-correction backup: real partial manifest with the pre bytes.
    const backupLabel = lastSnapshotLabel(project)
    const manifest = manifestOf(project, backupLabel)
    const entry = manifest.files.find((f: any) => f.logical === "main.tex")
    expect(manifest.kind).toBe("partial")
    expect(entry.sha256).toBe(originalSha)
    expect(entry.size).toBe(Buffer.byteLength(ORIGINAL))
    expect(readFileSync(join(snapDirOf(project, backupLabel), "main.tex"), "utf8")).toBe(ORIGINAL)

    // The true state references the backup and records a coherent iteration.
    const state = stateOf(project)
    expect(state.snapshots.map((s: any) => s.label)).toEqual([backupLabel])
    const iteration = state.iterations[state.iterations.length - 1]
    expect(iteration).toMatchObject({ action: "correction", scoreBefore: null, scoreAfter: null, status: "ok" })

    // The recovery point is exercised for real.
    const restoreText = String(
      await bancaRestore.execute(
        { projectRoot: project, snapshotId: backupLabel, confirm: true },
        {} as any,
      ),
    )
    expect(restoreText).toContain(`restored from ${backupLabel}`)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(originalSha)
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("CAPITULO SINTETICO INTOCADO")
  })

  test("relative root: the partial backup is written and registered in the true vault and restores the original bytes", async () => {
    setupWorkspace(project, ORIGINAL)
    const duplicated = duplicatedRootPath(project, "project")
    expect(duplicated).toBe(join(project, "project"))

    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "project", corrections: CORRECTION },
      "project",
    )
    const correctionText = expectCorrectionSuccess(correction)
    expect(correctionText).not.toMatch(/blocked|partial:/)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CORRECTED)
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("CAPITULO SINTETICO INTOCADO")
    expect(existsSync(duplicated)).toBe(false)

    const backupLabel = lastSnapshotLabel(project)
    const manifest = manifestOf(project, backupLabel)
    const entry = manifest.files.find((f: any) => f.logical === "main.tex")
    expect(manifest.kind).toBe("partial")
    expect(manifest.files.map((f: any) => f.logical)).toEqual(["main.tex"])
    expect(entry.sha256).toBe(sha256(ORIGINAL))
    expect(entry.size).toBe(Buffer.byteLength(ORIGINAL))
    expect(readFileSync(join(snapDirOf(project, backupLabel), "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(stateLabels(project)).toEqual([backupLabel])
    const state = stateOf(project)
    expect(state.iterations[state.iterations.length - 1]).toMatchObject({ action: "correction", status: "ok" })

    const restore = boundedTool(
      "banca_restore",
      base,
      { projectRoot: "project", snapshotId: backupLabel, confirm: true },
      "project",
    )
    expectRestoreSuccess(restore, backupLabel)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(sha256(ORIGINAL))
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("CAPITULO SINTETICO INTOCADO")
    expect(existsSync(duplicated)).toBe(false)
  })

  test("relative-root backup is recoverable through an absolute root in an independent fixture", async () => {
    const target = join(base, "cross", "project")
    setupWorkspace(target, ORIGINAL)

    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "cross/project", corrections: CORRECTION },
      "cross/project",
    )
    expectCorrectionSuccess(correction)
    expect(existsSync(duplicatedRootPath(target, "cross/project"))).toBe(false)
    const backupLabel = lastSnapshotLabel(target)
    expect(existsSync(join(snapDirOf(target, backupLabel), "main.tex"))).toBe(true)

    const { bancaRestore } = await import("../src/tools/banca_restore")
    const restoreText = String(
      await bancaRestore.execute(
        { projectRoot: target, snapshotId: backupLabel, confirm: true },
        {} as any,
      ),
    )
    expect(restoreText).toContain(`restored from ${backupLabel}`)
    expect(readFileSync(join(target, "main.tex"), "utf8")).toBe(ORIGINAL)
  })

  // ------------------------------------------- C. root representation matrix

  async function expectRepresentationCorrectsAndRestores(options: {
    target: string
    rootArg: string
    ctxMode?: boolean
  }): Promise<void> {
    setupWorkspace(options.target, ORIGINAL)

    const correctionArgs: Record<string, unknown> = { corrections: CORRECTION }
    if (!options.ctxMode) correctionArgs.projectRoot = options.rootArg
    const correction = boundedTool("banca_corrigir", base, correctionArgs, options.rootArg)
    expectCorrectionSuccess(correction)
    expect(existsSync(duplicatedRootPath(options.target, options.rootArg))).toBe(false)
    expect(readFileSync(join(options.target, "main.tex"), "utf8")).toBe(CORRECTED)

    const backupLabel = lastSnapshotLabel(options.target)
    expect(manifestOf(options.target, backupLabel).kind).toBe("partial")
    expect(
      manifestOf(options.target, backupLabel).files.find((f: any) => f.logical === "main.tex").sha256,
    ).toBe(sha256(ORIGINAL))
    expect(readFileSync(join(snapDirOf(options.target, backupLabel), "main.tex"), "utf8")).toBe(ORIGINAL)

    const restoreArgs: Record<string, unknown> = { snapshotId: backupLabel, confirm: true }
    if (!options.ctxMode) restoreArgs.projectRoot = options.rootArg
    const restore = boundedTool("banca_restore", base, restoreArgs, options.rootArg)
    expectRestoreSuccess(restore, backupLabel)
    expect(readFileSync(join(options.target, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(sha256(readFileSync(join(options.target, "main.tex")))).toBe(sha256(ORIGINAL))
    expect(existsSync(duplicatedRootPath(options.target, options.rootArg))).toBe(false)
  }

  test("root matrix: './' prefixed relative root corrects and restores in the true workspace", async () => {
    await expectRepresentationCorrectsAndRestores({
      target: join(base, "dot-prefix", "project"),
      rootArg: "./dot-prefix/project",
    })
  })

  test("root matrix: nested relative root corrects and restores in the true workspace", async () => {
    await expectRepresentationCorrectsAndRestores({
      target: join(base, "nested", "parent", "project"),
      rootArg: "nested/parent/project",
    })
  })

  test("root matrix: relative ctx.directory fallback corrects and restores in the true workspace", async () => {
    await expectRepresentationCorrectsAndRestores({
      target: join(base, "ctx", "project"),
      rootArg: "ctx/project",
      ctxMode: true,
    })
  })

  // -------------------------------------------------- D. duplicated-root decoy

  test("preexisting duplicated-root decoy is never written and never masks the true backup", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    setupWorkspace(project, ORIGINAL)
    const decoyRoot = join(project, "project")
    // Literal oracle for the destination the vulnerable producer used.
    expect(decoyRoot).toBe(duplicatedRootPath(project, "project"))
    setupWorkspace(decoyRoot, DECOY_MANUSCRIPT)
    write(decoyRoot, "notas/alvo.tex", "DECOY SYMLINK TARGET")
    symlinkSync("notas/alvo.tex", join(decoyRoot, "nota.tex"))
    // Legitimate decoy state/vault with its own snapshot.
    await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "decoy" }, {} as any)
    const decoyInventoryBefore = inventoryTree(decoyRoot)
    const decoyStateBefore = readFileSync(join(decoyRoot, ".banca", "state.json"))

    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "project", corrections: CORRECTION },
      "project",
    )
    expectCorrectionSuccess(correction)
    // Only the true manuscript changed, exactly as authorized.
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CORRECTED)
    expect(readFileSync(join(project, "capitulos/cap1.tex"), "utf8")).toBe("CAPITULO SINTETICO INTOCADO")

    // The backup was written and registered in the true vault only.
    const backupLabel = lastSnapshotLabel(project)
    const manifest = manifestOf(project, backupLabel)
    expect(manifest.kind).toBe("partial")
    expect(manifest.files.find((f: any) => f.logical === "main.tex").sha256).toBe(sha256(ORIGINAL))
    expect(readFileSync(join(snapDirOf(project, backupLabel), "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(existsSync(join(vaultOf(decoyRoot), backupLabel))).toBe(false)

    // Every artifact, hash, state byte and symlink target of the decoy is identical.
    expect(inventoryTree(decoyRoot)).toEqual(decoyInventoryBefore)
    expect(readFileSync(join(decoyRoot, ".banca", "state.json"))).toEqual(decoyStateBefore)
    expect(readFileSync(join(snapDirOf(decoyRoot, "decoy"), "main.tex"), "utf8")).toBe(DECOY_MANUSCRIPT)

    // Real recovery still comes from the true workspace vault.
    const restore = boundedTool(
      "banca_restore",
      base,
      { projectRoot: "project", snapshotId: backupLabel, confirm: true },
      "project",
    )
    const restoreText = expectRestoreSuccess(restore, backupLabel)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    const secondBackup = backupLabelFromText(restoreText)
    expect(existsSync(join(snapDirOf(project, secondBackup), "main.tex"))).toBe(true)
    expect(existsSync(join(vaultOf(decoyRoot), secondBackup))).toBe(false)
    expect(inventoryTree(decoyRoot)).toEqual(decoyInventoryBefore)
  })

  function backupLabelFromText(result: string): string {
    const match = result.match(/Safety backup created:\s*(\S+)/)
    if (!match) throw new Error(`no backup label in result: ${result}`)
    return match[1]
  }

  // ------------------------------------------------- E. security negatives

  test("refuses an external true vault symlink instead of writing the backup into a safe decoy vault", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    setupWorkspace(project, ORIGINAL)
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, DECOY_MANUSCRIPT)
    await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "decoy" }, {} as any)

    const externalVault = join(base, "external-vault-146")
    mkdirSync(vaultOf(project), { recursive: true })
    renameSync(vaultOf(project), externalVault)
    symlinkSync(externalVault, vaultOf(project), "dir")

    const decoyBefore = inventoryTree(decoyRoot)
    const externalBefore = inventoryTree(externalVault)
    const manuscriptHash = sha256(readFileSync(join(project, "main.tex")))

    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "project", corrections: CORRECTION },
      "project",
    )
    const text = expectBoundedRefusal(correction)
    expect(text).toMatch(/blocked/)
    // Sanitized refusal: no host path and no link target is echoed.
    expect(text).not.toContain(base)
    expect(text).not.toContain(externalVault)
    // Refusal before mutating the manuscript, capturing or registering anything.
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(manuscriptHash)
    expect(stateOf(project)).toBeNull()
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    expect(inventoryTree(externalVault)).toEqual(externalBefore)
    expect(lstatSync(vaultOf(project)).isSymbolicLink()).toBe(true)
  })

  test("refuses a broken true vault symlink instead of writing the backup into a safe decoy vault", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    setupWorkspace(project, ORIGINAL)
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, DECOY_MANUSCRIPT)
    await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "decoy" }, {} as any)

    mkdirSync(vaultOf(project), { recursive: true })
    renameSync(vaultOf(project), join(base, "moved-vault-146"))
    symlinkSync(join(base, "missing-vault-146"), vaultOf(project), "dir")

    const decoyBefore = inventoryTree(decoyRoot)
    const movedBefore = inventoryTree(join(base, "moved-vault-146"))
    const manuscriptHash = sha256(readFileSync(join(project, "main.tex")))

    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "project", corrections: CORRECTION },
      "project",
    )
    const text = expectBoundedRefusal(correction)
    expect(text).toMatch(/blocked/)
    expect(text).not.toContain(base)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(manuscriptHash)
    expect(stateOf(project)).toBeNull()
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    expect(inventoryTree(join(base, "moved-vault-146"))).toEqual(movedBefore)
  })

  test("refuses an unsafe true state origin instead of accepting the safe decoy state", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    setupWorkspace(project, ORIGINAL)
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, DECOY_MANUSCRIPT)
    await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "decoy" }, {} as any)

    const externalState = join(base, "external-state-146.json")
    writeFileSync(
      externalState,
      JSON.stringify({ currentScore: 7.3, lastAudit: null, lastLoop: "DECOY", snapshots: [], iterations: [] }),
      "utf8",
    )
    symlinkSync(externalState, join(project, ".banca", "state.json"), "file")

    const externalBefore = readFileSync(externalState)
    const decoyBefore = inventoryTree(decoyRoot)
    const manuscriptHash = sha256(readFileSync(join(project, "main.tex")))

    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "project", corrections: CORRECTION },
      "project",
    )
    const text = expectBoundedRefusal(correction)
    expect(text).toMatch(/blocked/)
    expect(text).not.toContain(base)
    // No snapshot, registration or manuscript change before the refusal.
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(manuscriptHash)
    expect(readFileSync(externalState)).toEqual(externalBefore)
    expect(readlinkSync(join(project, ".banca", "state.json"))).toBe(externalState)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
  })

  test("preflight negative contracts are preserved under a relative root", async () => {
    // (1) expectedOccurrences divergence: deterministic refusal before snapshot.
    {
      const target = join(base, "neg-divergence", "project")
      setupWorkspace(target, "ALVO UM ALVO DOIS")
      const run = boundedTool(
        "banca_corrigir",
        base,
        {
          projectRoot: "neg-divergence/project",
          corrections: [{ file: "main.tex", oldText: "ALVO", newText: "X", expectedOccurrences: 1 }],
        },
        "neg-divergence/project",
      )
      const text = expectBoundedRefusal(run)
      expect(text).toContain("occurrence preflight failed")
      expect(text).toContain("expected 1 (expectedOccurrences), found 2")
      expect(readFileSync(join(target, "main.tex"), "utf8")).toBe("ALVO UM ALVO DOIS")
      expect(stateOf(target)).toBeNull()
      expect(existsSync(duplicatedRootPath(target, "neg-divergence/project"))).toBe(false)
    }

    // (2) ambiguous count without expectedOccurrences.
    {
      const target = join(base, "neg-ambiguous", "project")
      setupWorkspace(target, "ALVO UM ALVO DOIS")
      const run = boundedTool(
        "banca_corrigir",
        base,
        {
          projectRoot: "neg-ambiguous/project",
          corrections: [{ file: "main.tex", oldText: "ALVO", newText: "X" }],
        },
        "neg-ambiguous/project",
      )
      const text = expectBoundedRefusal(run)
      expect(text).toContain("expected exactly 1 (expectedOccurrences omitted), found 2")
      expect(readFileSync(join(target, "main.tex"), "utf8")).toBe("ALVO UM ALVO DOIS")
      expect(stateOf(target)).toBeNull()
      expect(existsSync(duplicatedRootPath(target, "neg-ambiguous/project"))).toBe(false)
    }

    // (3) skipSnapshot remains prohibited in the public workflow.
    {
      const target = join(base, "neg-skip", "project")
      setupWorkspace(target, ORIGINAL)
      const run = boundedTool(
        "banca_corrigir",
        base,
        { projectRoot: "neg-skip/project", corrections: CORRECTION, skipSnapshot: true },
        "neg-skip/project",
      )
      const text = expectBoundedRefusal(run)
      expect(text).toContain("blocked: skipSnapshot is not permitted in public correction workflow")
      expect(readFileSync(join(target, "main.tex"), "utf8")).toBe(ORIGINAL)
      expect(stateOf(target)).toBeNull()
      expect(existsSync(duplicatedRootPath(target, "neg-skip/project"))).toBe(false)
    }

    // (4) workspace escape destination.
    {
      const target = join(base, "neg-escape", "project")
      setupWorkspace(target, ORIGINAL)
      writeFileSync(join(base, "neg-escape", "outside.tex"), "OUTSIDE CONTENT", "utf8")
      const run = boundedTool(
        "banca_corrigir",
        base,
        {
          projectRoot: "neg-escape/project",
          corrections: [{ file: "../outside.tex", oldText: "OUTSIDE", newText: "CHANGED" }],
        },
        "neg-escape/project",
      )
      const text = expectBoundedRefusal(run)
      expect(text).toContain("escapes project root")
      expect(readFileSync(join(base, "neg-escape", "outside.tex"), "utf8")).toBe("OUTSIDE CONTENT")
      expect(readFileSync(join(target, "main.tex"), "utf8")).toBe(ORIGINAL)
      expect(stateOf(target)).toBeNull()
      expect(existsSync(duplicatedRootPath(target, "neg-escape/project"))).toBe(false)
    }

    // (5) protected/immutable destination.
    {
      const target = join(base, "neg-protected", "project")
      const protectedConfig = {
        ...CONFIG_146,
        immutableFacts: ["dados/**"],
        protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
      }
      setupWorkspace(target, ORIGINAL, protectedConfig)
      write(target, "dados/nota.tex", "DADOS ORIGINAIS")
      const run = boundedTool(
        "banca_corrigir",
        base,
        {
          projectRoot: "neg-protected/project",
          corrections: [{ file: "dados/nota.tex", oldText: "ORIGINAIS", newText: "ALTERADOS" }],
        },
        "neg-protected/project",
      )
      const text = expectBoundedRefusal(run)
      expect(text).toMatch(/is immutable|protected path/)
      expect(readFileSync(join(target, "dados/nota.tex"), "utf8")).toBe("DADOS ORIGINAIS")
      expect(readFileSync(join(target, "main.tex"), "utf8")).toBe(ORIGINAL)
      expect(stateOf(target)).toBeNull()
      expect(existsSync(duplicatedRootPath(target, "neg-protected/project"))).toBe(false)
    }

    // (6) physical collision through an internal symlink.
    {
      const target = join(base, "neg-collision", "project")
      setupWorkspace(target, ORIGINAL)
      rmSync(join(target, "main.tex"))
      symlinkSync("capitulos/cap1.tex", join(target, "main.tex"))
      const shared = "TEXTO_COMPARTILHADO"
      write(target, "capitulos/cap1.tex", shared)
      const run = boundedTool(
        "banca_corrigir",
        base,
        {
          projectRoot: "neg-collision/project",
          corrections: [
            { file: "main.tex", oldText: shared, newText: "A" },
            { file: "capitulos/cap1.tex", oldText: shared, newText: "B" },
          ],
        },
        "neg-collision/project",
      )
      const text = expectBoundedRefusal(run)
      expect(text).toContain("blocked: destinations collide:")
      expect(readFileSync(join(target, "capitulos/cap1.tex"), "utf8")).toBe(shared)
      expect(readFileSync(join(target, "main.tex"), "utf8")).toBe(shared)
      expect(stateOf(target)).toBeNull()
      expect(existsSync(duplicatedRootPath(target, "neg-collision/project"))).toBe(false)
    }
  })

  // ------------------------------------------- F. history and compatibility

  test("a historical backup stored only in the duplicated vault is not migrated or fallback-read", async () => {
    const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
    const { addSnapshot } = await import("../src/lib/state")
    setupWorkspace(project, ORIGINAL)
    const decoyRoot = join(project, "project")
    setupWorkspace(decoyRoot, DECOY_MANUSCRIPT)

    // Historical artifact: a pre-correction backup captured in the duplicated
    // vault while the label was registered in the TRUE state. Recreated with the
    // real snapshot tool and the real state API, never guessed.
    const historicalCapture = String(
      await bancaSnapshot.execute({ projectRoot: decoyRoot, label: "pre-legacy-146" }, {} as any),
    )
    expect(historicalCapture).toContain("snapshot →")
    addSnapshot(project, "pre-legacy-146", null)
    const decoyBefore = inventoryTree(decoyRoot)
    const decoyStateBefore = readFileSync(join(decoyRoot, ".banca", "state.json"))

    // A new relative correction creates its backup in the true vault; the
    // historical duplicated artifact is not migrated or overwritten.
    const correction = boundedTool(
      "banca_corrigir",
      base,
      { projectRoot: "project", corrections: CORRECTION },
      "project",
    )
    expectCorrectionSuccess(correction)
    const backupLabel = lastSnapshotLabel(project)
    expect(backupLabel).not.toBe("pre-legacy-146")
    expect(existsSync(join(snapDirOf(project, backupLabel), "main.tex"))).toBe(true)
    expect(existsSync(join(vaultOf(project), "pre-legacy-146"))).toBe(false)
    expect(existsSync(join(vaultOf(project), "pre-legacy-146.manifest.json"))).toBe(false)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
    expect(readFileSync(join(decoyRoot, ".banca", "state.json"))).toEqual(decoyStateBefore)
    expect(stateLabels(project).sort()).toEqual(["pre-legacy-146", backupLabel].sort())

    // The historical label is not recoverable through the true root and the
    // decoy vault is never consulted as fallback.
    const refused = boundedTool(
      "banca_restore",
      base,
      { projectRoot: "project", snapshotId: "pre-legacy-146", confirm: true },
      "project",
    )
    const refusedText = expectBoundedRefusal(refused)
    expect(refusedText).toContain("snapshot directory not found")
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(CORRECTED)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)

    // The new true backup really restores the pre-correction bytes.
    const restore = boundedTool(
      "banca_restore",
      base,
      { projectRoot: "project", snapshotId: backupLabel, confirm: true },
      "project",
    )
    expectRestoreSuccess(restore, backupLabel)
    expect(readFileSync(join(project, "main.tex"), "utf8")).toBe(ORIGINAL)
    expect(inventoryTree(decoyRoot)).toEqual(decoyBefore)
  })
})
