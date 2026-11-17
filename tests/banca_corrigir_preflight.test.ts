/**
 * Issue #110 — fail-closed preflight for banca_corrigir.
 *
 * Contract under test:
 * - literal, non-overlapping occurrence counting shared with the replacement;
 * - `expectedOccurrences` (when present) is a positive safe integer and must
 *   match the real count exactly; when omitted, exactly one occurrence is the
 *   only admissible result;
 * - the whole batch is validated in memory before snapshot, state or write, so
 *   one invalid correction blocks every correction in the batch;
 * - rejection never mutates the manuscript, `state.json` or the snapshot vault;
 * - `newText` is literal (no JavaScript replacement-template expansion);
 * - a real partial pre-correction snapshot is created before the write and is
 *   restorable through the public `banca_restore` contract.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { PathTraversalError } from "../src/lib/safe_paths"

let base: string
let project: string

function projectConfig(overrides: Record<string, unknown> = {}) {
  return {
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
    protectedPaths: ["dados/**", "protegido/**", ".banca/snapshots/**", ".git/**"],
    immutableFacts: ["dados/**"],
    externalDependencies: [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9.0,
    providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
    mcp: { crossrefAcademicEnabled: false },
    ...overrides,
  }
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-issue110-"))
  project = join(base, "project")
  mkdirSync(join(project, ".banca"), { recursive: true })
  mkdirSync(join(project, "capitulos"), { recursive: true })
  writeFileSync(
    join(project, ".banca", "project.json"),
    JSON.stringify(projectConfig()),
    "utf-8",
  )
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function stateBytes(projectRoot: string): Buffer | null {
  const p = join(projectRoot, ".banca", "state.json")
  return existsSync(p) ? readFileSync(p) : null
}

function stateHash(projectRoot: string): string | null {
  const bytes = stateBytes(projectRoot)
  return bytes === null ? null : sha256(bytes)
}

/**
 * Top-level snapshot-vault entries (directories, manifests, markers).
 * A non-directory planted at `.banca/snapshots` is inventoried explicitly so
 * the snapshot-failure test can compare the inventory before and after.
 */
function vaultInventory(projectRoot: string): string[] {
  const dir = join(projectRoot, ".banca", "snapshots")
  let st
  try {
    st = lstatSync(dir)
  } catch {
    return []
  }
  if (!st.isDirectory()) return [`<non-directory:${st.isFile() ? "file" : "other"}>`]
  return readdirSync(dir).sort()
}

function writeManuscript(rel: string, content: string | Buffer): void {
  const abs = join(project, rel)
  mkdirSync(join(abs, ".."), { recursive: true })
  writeFileSync(abs, content as any)
}

async function runCorrection(args: Record<string, unknown>): Promise<string> {
  const { bancaCorrigir } = await import("../src/tools/banca_corrigir")
  return String(await bancaCorrigir.execute({ projectRoot: project, ...args } as any, {} as any))
}

/**
 * Asserts fail-closed rejection: the blocked response, untouched manuscript
 * bytes, unchanged persistent state (byte-identical state.json or still absent)
 * and unchanged snapshot vault inventory.
 */
function expectFailClosed(
  result: string,
  before: { files: Record<string, string>; stateHash: string | null; vault: string[] },
): void {
  expect(result).toContain("blocked")
  expect(result).not.toContain("✓")
  for (const [rel, hash] of Object.entries(before.files)) {
    expect(sha256(readFileSync(join(project, rel)))).toBe(hash)
  }
  expect(stateHash(project)).toBe(before.stateHash)
  expect(vaultInventory(project)).toEqual(before.vault)
}

function captureBefore(files: string[]): { files: Record<string, string>; stateHash: string | null; vault: string[] } {
  const map: Record<string, string> = {}
  for (const rel of files) map[rel] = sha256(readFileSync(join(project, rel)))
  return { files: map, stateHash: stateHash(project), vault: vaultInventory(project) }
}

const TWO_OCCURRENCES =
  "O grupo controle apresentou maior ganho.\n\nO grupo controle recebeu a dieta padrão.\n"

describe("Issue #110 — preflight de contagem: casos negativos sem mutação", () => {
  test("RED — contagem esperada menor que a real bloqueia o lote sem mutar manuscrito, estado ou vault", async () => {
    writeManuscript("main.tex", TWO_OCCURRENCES)
    const before = captureBefore(["main.tex"])
    expect(before.stateHash).toBeNull()
    expect(before.vault).toEqual([])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "grupo controle", newText: "grupo tratado", expectedOccurrences: 1 },
      ],
    })

    expectFailClosed(result, before)
    // Both occurrences must remain: no "first occurrence only" fallback either.
    const current = readFileSync(join(project, "main.tex"), "utf-8")
    expect(current).toBe(TWO_OCCURRENCES)
    expect(current.match(/grupo controle/g)).toHaveLength(2)
    expect(current).not.toContain("grupo tratado")
  })

  test("contagem esperada maior que a real bloqueia o lote", async () => {
    const content = "Texto com uma única marca FIXME.\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "FIXME", newText: "DONE", expectedOccurrences: 5 }],
    })

    expectFailClosed(result, before)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test("múltiplas correspondências sem contagem explícita bloqueiam (ambiguidade)", async () => {
    const content = "FIXME um.\nFIXME dois.\nFIXME três.\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "FIXME", newText: "DONE" }],
    })

    expectFailClosed(result, before)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test("oldText inexistente bloqueia", async () => {
    const content = "Nenhuma marca aqui.\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "AUSENTE", newText: "NOVO" }],
    })

    expectFailClosed(result, before)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test("oldText vazio bloqueia", async () => {
    const content = "Conteúdo intacto.\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "", newText: "INSERTED" }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("empty oldText")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test.each([
    ["zero", 0],
    ["negativo", -1],
    ["fracionário", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["acima do inteiro seguro", Number.MAX_SAFE_INTEGER + 1],
    ["texto", "1"],
  ])("expectedOccurrences inválido (%s) é rejeitado sem mutação", async (_label, expected) => {
    const content = "Marca FIXME única.\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "FIXME", newText: "DONE", expectedOccurrences: expected }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("expectedOccurrences")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test("arquivo inexistente bloqueia sem criar snapshot nem registrar iteração", async () => {
    writeManuscript("main.tex", "Conteúdo existente.\n")
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "missing.tex", oldText: "X", newText: "Y" }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("not found")
  })

  test("arquivo não regular (diretório) bloqueia", async () => {
    writeManuscript("main.tex", "Conteúdo existente.\n")
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "capitulos", oldText: "X", newText: "Y" }],
    })

    expectFailClosed(result, before)
  })

  test("arquivo inacessível para leitura bloqueia sem mutação", async () => {
    const content = "Conteúdo existente.\n"
    writeManuscript("main.tex", content)
    // Capture the pre-state while the file is still readable, then make the
    // read fail and restore permissions before asserting filesystem bytes.
    const before = captureBefore(["main.tex"])
    const abs = join(project, "main.tex")
    chmodSync(abs, 0o000)
    let result: string
    try {
      result = await runCorrection({
        corrections: [{ file: "main.tex", oldText: "Conteúdo", newText: "Outro" }],
      })
    } finally {
      chmodSync(abs, 0o644)
    }
    expect(result).toContain("blocked")
    expect(stateHash(project)).toBe(before.stateHash)
    expect(vaultInventory(project)).toEqual(before.vault)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test("arquivo protegido por protectedPaths bloqueia", async () => {
    writeManuscript("protegido/arquivo.tex", "TEXTO PROTEGIDO\n")
    writeManuscript("main.tex", "Conteúdo existente.\n")
    const before = captureBefore(["protegido/arquivo.tex", "main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "protegido/arquivo.tex", oldText: "TEXTO PROTEGIDO", newText: "ALTERADO" }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("protected path")
  })

  test("arquivo imutável (immutableFacts) bloqueia", async () => {
    writeManuscript("dados/experimento.csv", "1,2,3\n")
    writeManuscript("main.tex", "Conteúdo existente.\n")
    const before = captureBefore(["dados/experimento.csv", "main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "dados/experimento.csv", oldText: "1,2,3", newText: "9,9,9" }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("immutable")
  })

  test("arquivo fora da allowlist bloqueia", async () => {
    writeManuscript("notes.txt", "anotação qualquer\n")
    writeManuscript("main.tex", "Conteúdo existente.\n")
    const before = captureBefore(["notes.txt", "main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "notes.txt", oldText: "anotação", newText: "mudança" }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("not in allowed paths")
  })

  test("destino duplicado no mesmo lote bloqueia (sem deduplicar destinos)", async () => {
    const content = "ALVO ÚNICO\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ALVO ÚNICO", newText: "PRIMEIRA" },
        { file: "main.tex", oldText: "ALVO ÚNICO", newText: "SEGUNDA" },
      ],
    })

    expectFailClosed(result, before)
    expect(result).toContain("destinations collide")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test("alias por symlink e hardlink continuam bloqueados no preflight", async () => {
    const content = "ALVO COM ALIAS\n"
    writeManuscript("capitulos/cap1.tex", content)
    symlinkSync("capitulos/cap1.tex", join(project, "main.tex"))
    linkSync(join(project, "capitulos", "cap1.tex"), join(project, "capitulos", "cap1_hard.tex"))

    const before = captureBefore(["capitulos/cap1.tex", "capitulos/cap1_hard.tex"])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ALVO COM ALIAS", newText: "MUTADO" },
        { file: "capitulos/cap1_hard.tex", oldText: "ALVO COM ALIAS", newText: "MUTADO" },
      ],
    })

    expectFailClosed(result, before)
    expect(result).toContain("destinations collide")
  })

  test("lote com primeiro alvo válido e segundo inválido bloqueia integralmente (contagem)", async () => {
    const validContent = "ALVO VÁLIDO\n"
    const invalidContent = "ALVO INVÁLIDO ALVO INVÁLIDO\n"
    writeManuscript("main.tex", validContent)
    writeManuscript("capitulos/cap1.tex", invalidContent)
    const before = captureBefore(["main.tex", "capitulos/cap1.tex"])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ALVO VÁLIDO", newText: "MUTADO PRIMEIRO" },
        {
          file: "capitulos/cap1.tex",
          oldText: "ALVO INVÁLIDO",
          newText: "MUTADO SEGUNDO",
          expectedOccurrences: 1,
        },
      ],
    })

    expectFailClosed(result, before)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(validContent)
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toBe(invalidContent)
  })

  test("lote com primeiro alvo válido e segundo arquivo inexistente bloqueia integralmente", async () => {
    const validContent = "ALVO VÁLIDO\n"
    writeManuscript("main.tex", validContent)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ALVO VÁLIDO", newText: "MUTADO PRIMEIRO" },
        { file: "capitulos/ausente.tex", oldText: "ALVO", newText: "MUTADO SEGUNDO" },
      ],
    })

    expectFailClosed(result, before)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(validContent)
  })

  test("lote com segundo alvo de oldText vazio bloqueia integralmente", async () => {
    const validContent = "ALVO VÁLIDO\n"
    writeManuscript("main.tex", validContent)
    writeManuscript("capitulos/cap1.tex", "OUTRO CONTEÚDO\n")
    const before = captureBefore(["main.tex", "capitulos/cap1.tex"])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ALVO VÁLIDO", newText: "MUTADO PRIMEIRO" },
        { file: "capitulos/cap1.tex", oldText: "", newText: "X" },
      ],
    })

    expectFailClosed(result, before)
    expect(result).toContain("empty oldText")
  })

  test("skipSnapshot: true continua bloqueado antes de qualquer escrita", async () => {
    const content = "CONTEÚDO INTACTO\n"
    writeManuscript("main.tex", content)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "CONTEÚDO INTACTO", newText: "NOVO" }],
      skipSnapshot: true,
    })

    expectFailClosed(result, before)
    expect(result).toContain("skipSnapshot is not permitted")
  })

  test("conteúdo não UTF-8 é rejeitado sem corromper bytes (sem normalização silenciosa)", async () => {
    const raw = Buffer.from([0xff, 0xfe, 0x41, 0x42, 0x0a])
    writeManuscript("main.tex", raw)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "AB", newText: "CD" }],
    })

    expectFailClosed(result, before)
    expect(readFileSync(join(project, "main.tex")).equals(raw)).toBe(true)
  })

  test("estado persistente preexistente é preservado byte a byte na rejeição", async () => {
    const { addIteration } = await import("../src/lib/state")
    addIteration(project, "prior-audit", null, 7.5, "ok")
    writeManuscript("main.tex", TWO_OCCURRENCES)
    const before = captureBefore(["main.tex"])
    expect(before.stateHash).not.toBeNull()

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "grupo controle", newText: "grupo tratado", expectedOccurrences: 1 },
      ],
    })

    expectFailClosed(result, before)
    const { loadState } = await import("../src/lib/state")
    const state = loadState(project)
    expect(state.iterations).toHaveLength(1)
    expect(state.iterations[0].action).toBe("prior-audit")
    expect(state.snapshots).toHaveLength(0)
  })
})

describe("Issue #110 — substituição literal e casos positivos", () => {
  test("substituição única sem expectedOccurrences é permitida", async () => {
    writeManuscript("main.tex", "Texto com FIXME único.\n")

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "FIXME", newText: "DONE" }],
    })

    expect(result).toContain("✓ main.tex")
    expect(result).toContain("1 replacement")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("Texto com DONE único.\n")
  })

  test("substituição única com expectedOccurrences: 1 é permitida", async () => {
    writeManuscript("main.tex", "Texto com FIXME único.\n")

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "FIXME", newText: "DONE", expectedOccurrences: 1 }],
    })

    expect(result).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("Texto com DONE único.\n")
  })

  test("múltiplas substituições no mesmo texto são permitidas com contagem explícita exata", async () => {
    writeManuscript("main.tex", "FIXME um.\nFIXME dois.\nFIXME três.\n")

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "FIXME", newText: "DONE", expectedOccurrences: 3 }],
    })

    expect(result).toContain("✓ main.tex")
    expect(result).toContain("3 replacements")
    const current = readFileSync(join(project, "main.tex"), "utf-8")
    expect(current.match(/DONE/g)).toHaveLength(3)
    expect(current).not.toContain("FIXME")
  })

  test.each([
    ["$&", "$& corrigido", "$& corrigido"],
    ["$$", "$$", "$$"],
    ["$'", "$'", "$'"],
    ["$`", "$`", "$`"],
    ["barra invertida", "\\textbf{novo}", "\\textbf{novo}"],
    ["LaTeX com cifrão", "custo de R$ 1,00", "custo de R$ 1,00"],
    ["Unicode e acentos", "ção — “aspas”", "ção — “aspas”"],
    ["resultado vazio (remoção)", "", ""],
  ])("substituição literal preserva %s exatamente", async (_label, newText, expected) => {
    const content = "antes ALVO depois\n"
    writeManuscript("main.tex", content)

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "ALVO", newText, expectedOccurrences: 1 }],
    })

    expect(result).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(`antes ${expected} depois\n`)
  })

  test("oldText com metacaracteres é tratado como literal (sem regex)", async () => {
    const content = "custo a.b*c [x] (y) R$ 5\n"
    writeManuscript("main.tex", content)

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "a.b*c [x] (y) R$ 5", newText: "literal ok" }],
    })

    expect(result).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("custo literal ok\n")
  })

  test("Unicode pré-existente fora do trecho permanece byte a byte", async () => {
    const content = "Introdução — ação, coração. ALVO. Finalização — ção.\n"
    writeManuscript("main.tex", content)

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "ALVO", newText: "√ substituído" }],
    })

    expect(result).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(
      "Introdução — ação, coração. √ substituído. Finalização — ção.\n",
    )
  })

  test("BOM UTF-8 é preservado na substituição", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf])
    const original = Buffer.concat([bom, Buffer.from("ALVO com acentuação\n", "utf-8")])
    writeManuscript("main.tex", original)

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "ALVO", newText: "FEITO", expectedOccurrences: 1 }],
    })

    expect(result).toContain("✓ main.tex")
    const after = readFileSync(join(project, "main.tex"))
    expect(after.subarray(0, 3).equals(bom)).toBe(true)
    expect(after.subarray(3).toString("utf-8")).toBe("FEITO com acentuação\n")
  })
})

describe("Issue #110 — snapshot real, restore e lote multiarquivo", () => {
  test("snapshot parcial é criado antes da escrita, registrado e restaurável pelo caminho público", async () => {
    const original = "\\documentclass{article}\n\\begin{document}\nORIGINAL ACADEMIC TEXT\n\\end{document}\n"
    writeManuscript("main.tex", original)
    const originalHash = sha256(original)

    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ORIGINAL ACADEMIC TEXT", newText: "CORRECTED ACADEMIC TEXT" },
      ],
    })
    expect(result).toContain("✓ main.tex")

    // Real partial snapshot in the vault, with the pre-correction bytes.
    const stateBeforeRestore = loadState(project)
    expect(stateBeforeRestore.snapshots).toHaveLength(1)
    const label = stateBeforeRestore.snapshots[0].label
    const manifestRaw = JSON.parse(
      readFileSync(join(project, ".banca", "snapshots", `${label}.manifest.json`), "utf-8"),
    )
    expect(manifestRaw.kind).toBe("partial")
    expect(manifestRaw.files).toHaveLength(1)
    expect(manifestRaw.files[0].logical).toBe("main.tex")
    expect(manifestRaw.files[0].sha256).toBe(originalHash)
    expect(
      sha256(readFileSync(join(project, ".banca", "snapshots", label, "main.tex"))),
    ).toBe(originalHash)

    // Registered snapshot is selectable and announced as partial by banca_restore.
    const list = String(await bancaRestore.execute({ projectRoot: project }, {} as any))
    expect(list).toContain(label)
    expect(list).toContain("[partial]")

    const dry = String(
      await bancaRestore.execute({ projectRoot: project, snapshotId: label, confirm: false }, {} as any),
    )
    expect(dry).toContain(`Restore Dry-Run for Snapshot: ${label}`)
    expect(dry).toContain("- main.tex")

    const restored = String(
      await bancaRestore.execute({ projectRoot: project, snapshotId: label, confirm: true }, {} as any),
    )
    expect(restored).toContain(`restored from ${label}`)
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(original)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(originalHash)
  })

  test("lote válido com arquivos físicos distintos aplica todas as correções e restaura ambas", async () => {
    const mainOrig = "\\documentclass{article}\nMAIN_ORIG\n\\end{document}\n"
    const capOrig = "CAP1_ORIG\n"
    const outroOrig = "OUTRO INTOCADO\n"
    writeManuscript("main.tex", mainOrig)
    writeManuscript("capitulos/cap1.tex", capOrig)
    writeManuscript("capitulos/outro.tex", outroOrig)
    const hashes = {
      main: sha256(mainOrig),
      cap: sha256(capOrig),
      outro: sha256(outroOrig),
    }

    const { bancaRestore } = await import("../src/tools/banca_restore")
    const { loadState } = await import("../src/lib/state")

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "MAIN_ORIG", newText: "MAIN_NEW", expectedOccurrences: 1 },
        { file: "capitulos/cap1.tex", oldText: "CAP1_ORIG", newText: "CAP1_NEW", expectedOccurrences: 1 },
      ],
    })

    expect(result).toContain("✓ main.tex")
    expect(result).toContain("✓ capitulos/cap1.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toContain("MAIN_NEW")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toContain("CAP1_NEW")
    // Unselected file untouched and absent from the partial snapshot.
    expect(sha256(readFileSync(join(project, "capitulos", "outro.tex")))).toBe(hashes.outro)

    const state = loadState(project)
    expect(state.snapshots).toHaveLength(1)
    expect(state.iterations).toHaveLength(1)
    expect(state.iterations[0].status).toBe("ok")
    const label = state.snapshots[0].label
    const manifest = JSON.parse(
      readFileSync(join(project, ".banca", "snapshots", `${label}.manifest.json`), "utf-8"),
    )
    expect(manifest.files.map((f: { logical: string }) => f.logical).sort()).toEqual([
      "capitulos/cap1.tex",
      "main.tex",
    ])

    const restored = String(
      await bancaRestore.execute({ projectRoot: project, snapshotId: label, confirm: true }, {} as any),
    )
    expect(restored).toContain(`restored from ${label}`)
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(hashes.main)
    expect(sha256(readFileSync(join(project, "capitulos", "cap1.tex")))).toBe(hashes.cap)
    expect(sha256(readFileSync(join(project, "capitulos", "outro.tex")))).toBe(hashes.outro)
  })

  test("falha de snapshot bloqueia qualquer escrita no manuscrito", async () => {
    const content = "CONTEÚDO ORIGINAL\n"
    writeManuscript("main.tex", content)
    // A regular file where the snapshot directory should be forces capture failure.
    writeFileSync(join(project, ".banca", "snapshots"), "BLOCKING_FILE", "utf-8")
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "CONTEÚDO ORIGINAL", newText: "MUTADO" }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("snapshot")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(content)
  })

  test.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
    "falha de I/O na escrita é comunicada honestamente, sem sucesso fictício, preservando o snapshot",
    async () => {
      const content = "CONTEÚDO ORIGINAL\n"
      writeManuscript("main.tex", content)
      const abs = join(project, "main.tex")
      chmodSync(abs, 0o444) // preflight reads; the write itself fails (EACCES)
      try {
        const result = await runCorrection({
          corrections: [{ file: "main.tex", oldText: "CONTEÚDO ORIGINAL", newText: "MUTADO" }],
        })

        expect(result).not.toContain("✓")
        expect(readFileSync(abs, "utf-8")).toBe(content)

        const { loadState } = await import("../src/lib/state")
        const state = loadState(project)
        // The real pre-correction snapshot is preserved for recovery...
        expect(state.snapshots).toHaveLength(1)
        const label = state.snapshots[0].label
        expect(existsSync(join(project, ".banca", "snapshots", label, "main.tex"))).toBe(true)
        // ...and the failure is recorded as failed, never as success/rollback.
        expect(state.iterations).toHaveLength(1)
        expect(state.iterations[0].status).toBe("failed")
        expect(result).toContain(label)
        expect(result.toLowerCase()).toContain("no manuscript file was modified")
      } finally {
        chmodSync(abs, 0o644)
      }
    },
  )
})

// ---------------------------------------------------------------------------
// R1 helpers — real tool execution in a child process restricted by RLIMIT_FSIZE.
// ---------------------------------------------------------------------------

const isLinux = process.platform === "linux"

/**
 * Run the real `bancaCorrigir` in a child process whose file-size limit is
 * 8 KiB (RLIMIT_FSIZE) and whose SIGXFSZ is ignored. Under that limit a large
 * `writeFileSync` can truncate or partially write the destination and then
 * throw EFBIG, which is exactly the P1-A scenario. The limit is applied only
 * to the child: this test process, the checkout and real files are untouched.
 */
function runCorrectionUnderFileSizeLimit(corrections: unknown[]): {
  result: string
  stdout: string
  stderr: string
  status: number | null
} {
  const childScript = join(base, `r1-write-failure-child-${Date.now()}.ts`)
  const toolPath = join(import.meta.dir, "..", "src", "tools", "banca_corrigir.ts")
  writeFileSync(
    childScript,
    [
      `const { bancaCorrigir } = await import(${JSON.stringify(toolPath)})`,
      `const projectRoot = process.env.DSHBANCA_R1_PROJECT`,
      `const corrections = JSON.parse(process.env.DSHBANCA_R1_CORRECTIONS ?? "[]")`,
      `const result = await bancaCorrigir.execute({ projectRoot, corrections }, {})`,
      `process.stdout.write(JSON.stringify({ result: String(result) }))`,
      "",
    ].join("\n"),
    "utf-8",
  )
  const run = spawnSync(
    "bash",
    ["-c", 'trap "" XFSZ; ulimit -f 8; exec "$0" run "$1"', process.execPath, childScript],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DSHBANCA_R1_PROJECT: project,
        DSHBANCA_R1_CORRECTIONS: JSON.stringify(corrections),
      },
    },
  )
  let result = ""
  try {
    result = JSON.parse((run.stdout ?? "").trim() || "{}").result ?? ""
  } catch {
    result = ""
  }
  return { result, stdout: run.stdout ?? "", stderr: run.stderr ?? "", status: run.status }
}

async function restoreAndVerify(label: string, expected: Record<string, string>): Promise<void> {
  const { bancaRestore } = await import("../src/tools/banca_restore")
  const restored = String(
    await bancaRestore.execute({ projectRoot: project, snapshotId: label, confirm: true } as any, {} as any),
  )
  expect(restored).toContain(`restored from ${label}`)
  for (const [rel, content] of Object.entries(expected)) {
    expect(readFileSync(join(project, rel), "utf-8")).toBe(content)
    expect(sha256(readFileSync(join(project, rel)))).toBe(sha256(content))
  }
}

describe("Issue #110 R1/P1-A — falha de escrita após truncamento/escrita parcial", () => {
  test.skipIf(!isLinux)(
    "destino único: relata mutação parcial verificada (sha256 antes/depois) e nunca 'não modificado'",
    async () => {
      const original = "Original ALVO final\n"
      writeManuscript("main.tex", original)
      const originalHash = sha256(original)

      const run = runCorrectionUnderFileSizeLimit([
        { file: "main.tex", oldText: "ALVO", newText: "X".repeat(65536), expectedOccurrences: 1 },
      ])
      expect(run.status).toBe(0)
      expect(run.result).not.toContain("✓")
      expect(run.result.toLowerCase()).not.toContain("no manuscript file was modified")
      expect(run.result).toContain("partial:")
      expect(run.result).toContain("partially modified: main.tex")
      expect(run.result).toContain(`sha256 ${originalHash} ->`)
      expect(run.result.toLowerCase()).toContain("no automatic rollback")
      expect(run.result).toContain("applied: none")
      expect(run.result).toContain("not processed: none")

      // Filesystem proof: the write really changed the destination bytes.
      const failedBytes = readFileSync(join(project, "main.tex"))
      expect(failedBytes.length).toBeGreaterThan(Buffer.byteLength(original))
      expect(failedBytes.equals(Buffer.from(original, "utf-8"))).toBe(false)

      // Real snapshot kept; iteration recorded as failed, never ok.
      const { loadState } = await import("../src/lib/state")
      const state = loadState(project)
      expect(state.snapshots).toHaveLength(1)
      const label = state.snapshots[0].label
      expect(state.iterations).toHaveLength(1)
      expect(state.iterations[0].status).toBe("failed")
      expect(run.result).toContain(label)

      // Recovery through the public restore contract recovers exact bytes.
      await restoreAndVerify(label, { "main.tex": original })
      expect(sha256(readFileSync(join(project, "main.tex")))).toBe(originalHash)
    },
  )

  test.skipIf(!isLinux)(
    "destino posterior falha após um destino aplicado: classifica aplicado, parcialmente modificado e não processado",
    async () => {
      const originals = {
        "capitulos/a.tex": "ALVO A\n",
        "capitulos/b.tex": "ALVO B\n",
        "capitulos/c.tex": "ALVO C\n",
      }
      for (const [rel, content] of Object.entries(originals)) writeManuscript(rel, content)

      const run = runCorrectionUnderFileSizeLimit([
        { file: "capitulos/a.tex", oldText: "ALVO A", newText: "FEITO A", expectedOccurrences: 1 },
        { file: "capitulos/b.tex", oldText: "ALVO B", newText: "Y".repeat(65536), expectedOccurrences: 1 },
        { file: "capitulos/c.tex", oldText: "ALVO C", newText: "FEITO C", expectedOccurrences: 1 },
      ])
      expect(run.status).toBe(0)
      expect(run.result).not.toContain("✓")
      expect(run.result).toContain("partial:")
      expect(run.result).toContain("applied: capitulos/a.tex")
      expect(run.result).toContain("partially modified: capitulos/b.tex")
      expect(run.result).toContain("not processed: capitulos/c.tex")
      expect(run.result.toLowerCase()).not.toContain("no manuscript file was modified")
      expect(run.result.toLowerCase()).toContain("no automatic rollback")

      expect(readFileSync(join(project, "capitulos", "a.tex"), "utf-8")).toBe("FEITO A\n")
      expect(readFileSync(join(project, "capitulos", "b.tex")).equals(Buffer.from(originals["capitulos/b.tex"], "utf-8"))).toBe(false)
      expect(sha256(readFileSync(join(project, "capitulos", "c.tex")))).toBe(sha256(originals["capitulos/c.tex"]))

      const { loadState } = await import("../src/lib/state")
      const state = loadState(project)
      expect(state.snapshots).toHaveLength(1)
      expect(state.iterations).toHaveLength(1)
      expect(state.iterations[0].status).toBe("failed")

      // Restore recovers all three original files and hashes.
      await restoreAndVerify(state.snapshots[0].label, originals)
    },
  )

  test.skipIf(!isLinux)(
    "primeiro destino falha: aplicados vazios, falho verificado e demais não processados",
    async () => {
      const originals = {
        "main.tex": "ALVO M\n",
        "capitulos/b.tex": "ALVO B\n",
        "capitulos/c.tex": "ALVO C\n",
      }
      for (const [rel, content] of Object.entries(originals)) writeManuscript(rel, content)

      const run = runCorrectionUnderFileSizeLimit([
        { file: "main.tex", oldText: "ALVO M", newText: "Z".repeat(65536), expectedOccurrences: 1 },
        { file: "capitulos/b.tex", oldText: "ALVO B", newText: "FEITO B", expectedOccurrences: 1 },
        { file: "capitulos/c.tex", oldText: "ALVO C", newText: "FEITO C", expectedOccurrences: 1 },
      ])
      expect(run.status).toBe(0)
      expect(run.result).toContain("partial:")
      expect(run.result).toContain("applied: none")
      expect(run.result).toContain("partially modified: main.tex")
      expect(run.result).toContain("not processed: capitulos/b.tex, capitulos/c.tex")
      expect(run.result.toLowerCase()).not.toContain("no manuscript file was modified")

      expect(readFileSync(join(project, "main.tex")).equals(Buffer.from(originals["main.tex"], "utf-8"))).toBe(false)
      expect(readFileSync(join(project, "capitulos", "b.tex"), "utf-8")).toBe(originals["capitulos/b.tex"])
      expect(readFileSync(join(project, "capitulos", "c.tex"), "utf-8")).toBe(originals["capitulos/c.tex"])

      const { loadState } = await import("../src/lib/state")
      const state = loadState(project)
      expect(state.snapshots).toHaveLength(1)
      expect(state.iterations).toHaveLength(1)
      expect(state.iterations[0].status).toBe("failed")
      await restoreAndVerify(state.snapshots[0].label, originals)
    },
  )
})

describe("Issue #110 R1/P1-B — Unicode malformado rejeitado antes do snapshot", () => {
  test.each([
    ["newText surrogate alto isolado", { oldText: "ALVO", newText: "\uD800" }],
    ["newText surrogate baixo isolado", { oldText: "ALVO", newText: "\uDC00" }],
    ["oldText malformado", { oldText: "ALVO\uD800", newText: "X" }],
  ])("%s é rejeitado sem mutação, snapshot ou iteração", async (_label, correction) => {
    const original = "Original ALVO final\n"
    writeManuscript("main.tex", original)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      corrections: [{ file: "main.tex", expectedOccurrences: 1, ...correction }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("not well-formed Unicode")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(original)
  })

  test("busca que dividiria um par substituto existente é rejeitada", async () => {
    const original = "Emoji \u{1F600} aqui\n"
    writeManuscript("main.tex", original)
    const before = captureBefore(["main.tex"])

    const result = await runCorrection({
      // High surrogate of U+1F600 used alone: it would match half of the pair.
      corrections: [{ file: "main.tex", oldText: "\uD83D", newText: "METADE", expectedOccurrences: 1 }],
    })

    expectFailClosed(result, before)
    expect(result).toContain("not well-formed Unicode")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(original)
  })

  test("lote com primeiro arquivo válido e segundo argumento Unicode inválido bloqueia integralmente", async () => {
    const mainOrig = "ALVO MAIN\n"
    const capOrig = "ALVO CAP\n"
    writeManuscript("main.tex", mainOrig)
    writeManuscript("capitulos/cap1.tex", capOrig)
    const before = captureBefore(["main.tex", "capitulos/cap1.tex"])

    const result = await runCorrection({
      corrections: [
        { file: "main.tex", oldText: "ALVO MAIN", newText: "FEITO MAIN", expectedOccurrences: 1 },
        { file: "capitulos/cap1.tex", oldText: "ALVO CAP", newText: "\uDC00", expectedOccurrences: 1 },
      ],
    })

    expectFailClosed(result, before)
    expect(result).toContain("not well-formed Unicode")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe(mainOrig)
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toBe(capOrig)
  })

  test("pares substitutos válidos e caracteres não-BMP são preservados exatamente", async () => {
    const original = "Início \u{1F600} ação, fim\n"
    writeManuscript("main.tex", original)

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "\u{1F600}", newText: "\u{1F389}\u{1F680}", expectedOccurrences: 1 }],
    })

    expect(result).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("Início \u{1F389}\u{1F680} ação, fim\n")
    // Bytes of the supplementary characters are the real UTF-8 encodings.
    const bytes = readFileSync(join(project, "main.tex"))
    expect(bytes.includes(Buffer.from("\u{1F389}", "utf-8"))).toBe(true)
    expect(bytes.includes(Buffer.from("\u{1F680}", "utf-8"))).toBe(true)
    expect(bytes.includes(Buffer.from("\u{FFFD}", "utf-8"))).toBe(false)
  })

  test("substituição literal envolvendo emoji mantém o restante do texto intacto e é restaurável", async () => {
    const original = "Antes \u{1F680} depois — ção\n"
    writeManuscript("main.tex", original)
    const originalHash = sha256(original)

    const result = await runCorrection({
      corrections: [{ file: "main.tex", oldText: "\u{1F680}", newText: "\u{1F984}", expectedOccurrences: 1 }],
    })
    expect(result).toContain("✓ main.tex")
    expect(readFileSync(join(project, "main.tex"), "utf-8")).toBe("Antes \u{1F984} depois — ção\n")

    const { loadState } = await import("../src/lib/state")
    const label = loadState(project).snapshots[0].label
    await restoreAndVerify(label, { "main.tex": original })
    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(originalHash)
  })
})

// ---------------------------------------------------------------------------
// Issue #134 — canonical origin boundary for `.banca/project.json`
//
// A correction is the highest-impact existing consumer of the configuration:
// the file controls protected paths, immutable facts and manuscript paths. With
// an external `.banca/project.json` symlink the vulnerable reader accepted a
// configuration read outside the workspace and could snapshot and write the
// manuscript under those externally supplied rules. The canonical preflight
// must refuse before any snapshot, state change or manuscript write.
// ---------------------------------------------------------------------------

describe("issue #134 — banca_corrigir refuses an external configuration origin", () => {
  const symlinksSupported134 = (() => {
    try {
      const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-134-corrigir-link-probe-"))
      try {
        symlinkSync(probeBase, join(probeBase, "link"))
        return true
      } finally {
        rmSync(probeBase, { recursive: true, force: true })
      }
    } catch {
      return false
    }
  })()

  const stest134 = symlinksSupported134 ? test : test.skip

  stest134("refuses before snapshot, state change or manuscript write", async () => {
    const outsideConfig = join(base, "outside-project.json")
    writeFileSync(outsideConfig, JSON.stringify(projectConfig()), "utf-8")
    rmSync(join(project, ".banca", "project.json"))
    symlinkSync(outsideConfig, join(project, ".banca", "project.json"), "file")

    const originalMain = "Texto original sintético que não pode ser alterado.\n"
    writeManuscript("main.tex", originalMain)
    const manuscriptHash = sha256(originalMain)
    const stateBefore = stateHash(project)
    const vaultBefore = vaultInventory(project)
    const outsideHash = sha256(readFileSync(outsideConfig))

    await expect(
      runCorrection({
        corrections: [
          { file: "main.tex", oldText: "Texto original", newText: "Texto alterado", expectedOccurrences: 1 },
        ],
      }),
    ).rejects.toThrow(PathTraversalError)

    expect(sha256(readFileSync(join(project, "main.tex")))).toBe(manuscriptHash)
    expect(stateHash(project)).toBe(stateBefore)
    expect(vaultInventory(project)).toEqual(vaultBefore)
    expect(sha256(readFileSync(outsideConfig))).toBe(outsideHash)
  })
})

// ---------------------------------------------------------------------------
// Issue #136 — banca_corrigir with a non-regular state destination
//
// The correction flow reads the shared state when creating its mandatory
// pre-correction snapshot. A FIFO `state.json` used to block that read before
// any configuration preflight completed. The canonical state reader must
// refuse the FIFO without opening it, before snapshot/state/manuscript changes.
// Issue #141 additionally requires that refusal to happen before the vault
// root is created, with a faithful state-origin diagnostic.
// ---------------------------------------------------------------------------

describe("issue #136 — banca_corrigir refuses a non-regular state destination", () => {
  const mkfifoSupported136 = (() => {
    if (process.platform === "win32") return false
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-136-corrigir-fifo-probe-"))
    try {
      return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
    } finally {
      rmSync(probeBase, { recursive: true, force: true })
    }
  })()

  const fifoTest136 = mkfifoSupported136 ? test : test.skip

  fifoTest136(
    "FIFO state is refused without a blocking read and no manuscript change",
    () => {
      const originalMain = "ORIGINAL sintético 136\n"
      writeManuscript("main.tex", originalMain)
      const mainPath = join(project, "main.tex")
      const mainHash = sha256(readFileSync(mainPath))
      const fifoPath = join(project, ".banca", "state.json")
      expect(spawnSync("mkfifo", [fifoPath]).status).toBe(0)

      const workerPath = join(base, "corrigir-state-fifo-worker.mjs")
      const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_corrigir.ts")).href
      writeFileSync(
        workerPath,
        [
          "const toolUrl = process.argv[2]",
          "const project = process.argv[3]",
          "try {",
          "  const mod = await import(toolUrl)",
          "  const out = await mod.bancaCorrigir.execute({",
          '    projectRoot: project,',
          '    corrections: [{ file: "main.tex", oldText: "ORIGINAL", newText: "ALTERADO", expectedOccurrences: 1 }],',
          "  })",
          '  console.log(JSON.stringify({ ok: true, output: String(out) }))',
          "} catch (error) {",
          '  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))',
          "}",
          "",
        ].join("\n"),
        "utf-8",
      )

      const outcome = spawnSync(process.execPath, [workerPath, toolUrl, project], {
        timeout: 6000,
        encoding: "utf-8",
      })

      // A vulnerable reader would block on the FIFO until the timeout.
      expect(outcome.error).toBeUndefined()
      expect(outcome.signal).toBeNull()
      const parsed = JSON.parse(
        (outcome.stdout ?? "").split("\n").reverse().find((line) => line.trim().startsWith("{")) as string,
      ) as { ok: boolean; name?: string; message?: string; output?: string }
      expect(parsed.ok).toBe(true)
      // Issue #141: the state origin is refused by the secure reader in the
      // preflight, before the mandatory snapshot vault is created.
      expect(String(parsed.output)).toContain("blocked: project state origin refused")
      expect(String(parsed.output)).toContain("no manuscript file was modified")
      expect(String(parsed.output)).not.toContain("pre-correction snapshot failed")
      expect(sha256(readFileSync(mainPath))).toBe(mainHash)
      // The FIFO was never replaced by a written state file.
      expect(lstatSync(fifoPath).isFIFO()).toBe(true)
      const snapshotsDir = join(project, ".banca", "snapshots")
      expect(existsSync(snapshotsDir)).toBe(false)
    },
    20_000,
  )
})

// ---------------------------------------------------------------------------
// Issue #167 — canonical origin of main.tex for the requested regression check
//
// `resolveManuscriptPaths` is lexical. When `previousScore` is supplied, the
// configured main file must be proven to be a safe, readable regular file
// inside the workspace BEFORE the mandatory pre-correction snapshot, the state
// registration or any write. The same origin is revalidated immediately before
// the post-correction read; a change after the mutation must be reported as an
// honest partial outcome that keeps the recovery point available — never as an
// apparent success with an unverified regression.
// ---------------------------------------------------------------------------

const symlinksSupported167 = (() => {
  try {
    const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-167-corrigir-link-probe-"))
    try {
      symlinkSync(probeBase, join(probeBase, "link"))
      return true
    } finally {
      rmSync(probeBase, { recursive: true, force: true })
    }
  } catch {
    return false
  }
})()

const stest167 = symlinksSupported167 ? test : test.skip

const mkfifoSupported167 = (() => {
  if (process.platform === "win32") return false
  const probeBase = mkdtempSync(join(tmpdir(), "dshbanca-167-corrigir-fifo-probe-"))
  try {
    return spawnSync("mkfifo", [join(probeBase, "fifo")]).status === 0
  } finally {
    rmSync(probeBase, { recursive: true, force: true })
  }
})()

const MAIN_UNCITED_167 =
  [
    "Primeiro parágrafo sintético sem qualquer citação acadêmica.",
    "Segundo parágrafo sintético sem qualquer citação acadêmica.",
    "Terceiro parágrafo sintético sem qualquer citação acadêmica.",
  ].join("\n\n") + "\n"

const CHAPTER_167 = "Marcador sintético ORIGINAL que deve ser corrigido.\n"

const CHAPTER_CORRECTION_167 = {
  file: "capitulos/cap1.tex",
  oldText: "ORIGINAL",
  newText: "CORRIGIDO",
  expectedOccurrences: 1,
}

const MAIN_ORIGIN_REFUSAL_167 =
  "blocked: main manuscript origin is outside the workspace, follows an unsafe symbolic link, or is not a regular file"

const NO_MUTATION_NOTE_167 = "no snapshot, state entry or manuscript file was written"

function writeChapter167(content = CHAPTER_167): void {
  writeManuscript("capitulos/cap1.tex", content)
}

function configureMain167(main: string): void {
  writeFileSync(
    join(project, ".banca", "project.json"),
    JSON.stringify(
      projectConfig({
        manuscript: {
          format: "latex",
          root: ".",
          main,
          bib: "referencias.bib",
          chapters: ["capitulos/*.tex"],
          outputDir: "trabalhos",
        },
      }),
    ),
    "utf-8",
  )
}

describe("issue #167 — main manuscript origin for the regression check", () => {
  stest167(
    "RED/GREEN — external leaf symlink at main.tex is refused before snapshot, state or write",
    async () => {
      const outsideMain = join(base, "outside-main-167.tex")
      writeFileSync(outsideMain, MAIN_UNCITED_167, "utf-8")
      symlinkSync(outsideMain, join(project, "main.tex"), "file")
      writeChapter167()
      const before = captureBefore(["capitulos/cap1.tex"])
      const outsideHash = sha256(readFileSync(outsideMain))

      // Relative workspace root: the canonical check must not depend on the
      // caller-provided lexical form.
      const result = await runCorrection({
        projectRoot: relative(process.cwd(), project),
        corrections: [CHAPTER_CORRECTION_167],
        previousScore: 6,
      })

      expectFailClosed(result, before)
      expect(result).toContain(MAIN_ORIGIN_REFUSAL_167)
      expect(result).toContain(NO_MUTATION_NOTE_167)
      expect(result).not.toContain("⚠")
      expect(sha256(readFileSync(outsideMain))).toBe(outsideHash)
    },
  )

  stest167(
    "RED/GREEN — external symlink in an ancestor directory of main is refused",
    async () => {
      configureMain167("secoes/main.tex")
      const externalDir = join(base, "external-sections-167")
      mkdirSync(externalDir, { recursive: true })
      writeFileSync(join(externalDir, "main.tex"), MAIN_UNCITED_167, "utf-8")
      symlinkSync(externalDir, join(project, "secoes"), "dir")
      writeChapter167()
      const before = captureBefore(["capitulos/cap1.tex"])
      const outsideHash = sha256(readFileSync(join(externalDir, "main.tex")))

      const result = await runCorrection({
        corrections: [CHAPTER_CORRECTION_167],
        previousScore: 6,
      })

      expectFailClosed(result, before)
      expect(result).toContain(MAIN_ORIGIN_REFUSAL_167)
      expect(result).toContain(NO_MUTATION_NOTE_167)
      expect(sha256(readFileSync(join(externalDir, "main.tex")))).toBe(outsideHash)
    },
  )

  stest167("RED/GREEN — broken symlink at main.tex is refused", async () => {
    symlinkSync(join(base, "missing-target-167.tex"), join(project, "main.tex"), "file")
    writeChapter167()
    const before = captureBefore(["capitulos/cap1.tex"])

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION_167],
      previousScore: 6,
    })

    expectFailClosed(result, before)
    expect(result).toContain(MAIN_ORIGIN_REFUSAL_167)
    expect(result).toContain(NO_MUTATION_NOTE_167)
  })

  test("RED/GREEN — a directory at main.tex is refused", async () => {
    mkdirSync(join(project, "main.tex"))
    writeChapter167()
    const before = captureBefore(["capitulos/cap1.tex"])

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION_167],
      previousScore: 6,
    })

    expectFailClosed(result, before)
    expect(result).toContain(MAIN_ORIGIN_REFUSAL_167)
    expect(result).toContain(NO_MUTATION_NOTE_167)
  })

  const fifoTest167 = mkfifoSupported167 ? test : test.skip

  fifoTest167(
    "RED/GREEN — FIFO at main.tex is refused without a blocking read and without mutation",
    () => {
      const mainPath = join(project, "main.tex")
      expect(spawnSync("mkfifo", [mainPath]).status).toBe(0)
      writeChapter167()
      const chapterPath = join(project, "capitulos", "cap1.tex")
      const chapterHash = sha256(readFileSync(chapterPath))

      const workerPath = join(base, "corrigir-main-fifo-worker.mjs")
      const toolUrl = pathToFileURL(join(import.meta.dir, "..", "src", "tools", "banca_corrigir.ts")).href
      writeFileSync(
        workerPath,
        [
          "const toolUrl = process.argv[2]",
          "const project = process.argv[3]",
          "try {",
          "  const mod = await import(toolUrl)",
          "  const out = await mod.bancaCorrigir.execute({",
          "    projectRoot: project,",
          '    corrections: [{ file: "capitulos/cap1.tex", oldText: "ORIGINAL", newText: "CORRIGIDO", expectedOccurrences: 1 }],',
          "    previousScore: 6,",
          "  })",
          '  console.log(JSON.stringify({ ok: true, output: String(out) }))',
          "} catch (error) {",
          '  console.log(JSON.stringify({ ok: false, name: String(error && error.name), message: String(error && error.message) }))',
          "}",
          "",
        ].join("\n"),
        "utf-8",
      )

      const outcome = spawnSync(process.execPath, [workerPath, toolUrl, project], {
        timeout: 6000,
        encoding: "utf-8",
      })

      // A vulnerable reader opens the FIFO and blocks until the timeout.
      expect(outcome.error).toBeUndefined()
      expect(outcome.signal).toBeNull()
      const parsed = JSON.parse(
        (outcome.stdout ?? "").split("\n").reverse().find((line) => line.trim().startsWith("{")) as string,
      ) as { ok: boolean; output?: string }
      expect(parsed.ok).toBe(true)
      const output = String(parsed.output)
      expect(output).toContain(MAIN_ORIGIN_REFUSAL_167)
      expect(output).toContain(NO_MUTATION_NOTE_167)
      expect(output).not.toContain("pre-correction snapshot failed")
      expect(sha256(readFileSync(chapterPath))).toBe(chapterHash)
      expect(lstatSync(mainPath).isFIFO()).toBe(true)
      expect(stateHash(project)).toBeNull()
      expect(existsSync(join(project, ".banca", "snapshots"))).toBe(false)
    },
    20_000,
  )

  test("RED/GREEN — an unreadable regular main.tex is refused before mutation", async () => {
    const mainPath = join(project, "main.tex")
    writeFileSync(mainPath, MAIN_UNCITED_167, "utf-8")
    chmodSync(mainPath, 0o000)
    try {
      writeChapter167()
      const before = captureBefore(["capitulos/cap1.tex"])

      const result = await runCorrection({
        corrections: [CHAPTER_CORRECTION_167],
        previousScore: 6,
      })

      expectFailClosed(result, before)
      expect(result).toContain(
        "blocked: main manuscript destination could not be inspected or read safely",
      )
      expect(result).toContain(NO_MUTATION_NOTE_167)
      expect(result).not.toContain("⚠")
    } finally {
      chmodSync(mainPath, 0o644)
    }
  })

  test("RED/GREEN — absent main.tex requested for the regression check is refused", async () => {
    writeChapter167()
    const before = captureBefore(["capitulos/cap1.tex"])

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION_167],
      previousScore: 6,
    })

    expectFailClosed(result, before)
    expect(result).toContain("blocked: main manuscript not found")
    expect(result).toContain(NO_MUTATION_NOTE_167)
  })

  test("GREEN — regular internal main: regression computed, history coherent, snapshot restorable", async () => {
    const mainPath = join(project, "main.tex")
    writeFileSync(mainPath, MAIN_UNCITED_167, "utf-8")
    const mainHash = sha256(readFileSync(mainPath))
    writeChapter167()

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION_167],
      previousScore: 6,
    })

    expect(result).toContain("✓ capitulos/cap1.tex (1 replacement)")
    expect(result).toContain("⚠ score dropped from 6.0 to 4.0")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toContain("CORRIGIDO")
    // The regression source itself was never rewritten.
    expect(sha256(readFileSync(mainPath))).toBe(mainHash)

    const { loadState } = await import("../src/lib/state")
    const state = loadState(project)
    expect(state.iterations).toHaveLength(1)
    expect(state.iterations[0]).toMatchObject({
      action: "correction",
      scoreBefore: 6,
      scoreAfter: 4,
      status: "failed",
    })
    expect(state.currentScore).toBe(4)
    expect(state.snapshots).toHaveLength(1)
    const label = state.snapshots[0].label
    expect(vaultInventory(project)).toContain(label)

    const { bancaRestore } = await import("../src/tools/banca_restore")
    const restored = String(
      await bancaRestore.execute({ projectRoot: project, snapshotId: label, confirm: true } as any, {} as any),
    )
    expect(restored).toContain(`restored from ${label}`)
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toBe(CHAPTER_167)
  })

  stest167("GREEN — internal symlink to an internal regular main is accepted", async () => {
    const target = join(project, "manuscrito-real.tex")
    writeFileSync(target, MAIN_UNCITED_167, "utf-8")
    symlinkSync(target, join(project, "main.tex"), "file")
    writeChapter167()

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION_167],
      previousScore: 6,
    })

    expect(result).toContain("✓ capitulos/cap1.tex (1 replacement)")
    expect(result).toContain("⚠ score dropped from 6.0 to 4.0")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toContain("CORRIGIDO")
    expect(readFileSync(target, "utf-8")).toBe(MAIN_UNCITED_167)
  })

  stest167("GREEN — a safe internal symlink ancestor of main is accepted", async () => {
    configureMain167("secoes/main.tex")
    const realDir = join(project, "manuscrito")
    mkdirSync(realDir, { recursive: true })
    writeFileSync(join(realDir, "main.tex"), MAIN_UNCITED_167, "utf-8")
    symlinkSync(realDir, join(project, "secoes"), "dir")
    writeChapter167()

    const result = await runCorrection({
      corrections: [CHAPTER_CORRECTION_167],
      previousScore: 6,
    })

    expect(result).toContain("✓ capitulos/cap1.tex (1 replacement)")
    expect(result).toContain("⚠ score dropped from 6.0 to 4.0")
    expect(readFileSync(join(realDir, "main.tex"), "utf-8")).toBe(MAIN_UNCITED_167)
  })

  test("GREEN — absolute, relative and ./-prefixed workspace roots accept a valid main", async () => {
    writeFileSync(join(project, "main.tex"), MAIN_UNCITED_167, "utf-8")
    const rel = relative(process.cwd(), project)
    const roots = [project, rel, `./${rel}`]
    const targets = ["capitulos/cap1.tex", "capitulos/cap2.tex", "capitulos/cap3.tex"]

    for (let i = 0; i < roots.length; i++) {
      writeManuscript(targets[i], `Marcador ORIGINAL ${i} do capítulo que deve ser corrigido.\n`)
      const result = await runCorrection({
        projectRoot: roots[i],
        corrections: [
          { file: targets[i], oldText: "ORIGINAL", newText: "CORRIGIDO", expectedOccurrences: 1 },
        ],
        previousScore: 6,
      })
      expect(result).toContain(`✓ ${targets[i]} (1 replacement)`)
      expect(result).toContain("⚠")
    }
  })

  stest167("GREEN — without previousScore the main origin is not read (legitimate behavior preserved)", async () => {
    const outsideMain = join(base, "outside-main-noprev-167.tex")
    writeFileSync(outsideMain, MAIN_UNCITED_167, "utf-8")
    symlinkSync(outsideMain, join(project, "main.tex"), "file")
    writeChapter167()
    const outsideHash = sha256(readFileSync(outsideMain))

    const result = await runCorrection({ corrections: [CHAPTER_CORRECTION_167] })

    expect(result).toContain("✓ capitulos/cap1.tex (1 replacement)")
    expect(result).not.toContain("⚠")
    expect(readFileSync(join(project, "capitulos", "cap1.tex"), "utf-8")).toContain("CORRIGIDO")
    expect(sha256(readFileSync(outsideMain))).toBe(outsideHash)
    expect(vaultInventory(project).length).toBeGreaterThan(0)
  })

  stest167(
    "PARTIAL — a regression source that changes after the mutation is reported honestly with recovery",
    async () => {
      // Deterministic interleaving with the tool's own mandatory snapshot
      // registration: the canonical target of `main.tex` is the workspace's
      // state file, which the snapshot registration rewrites between the
      // preflight and the post-correction regression read.
      const statePath = join(project, ".banca", "state.json")
      writeFileSync(
        statePath,
        JSON.stringify(
          { currentScore: null, lastAudit: null, lastLoop: null, snapshots: [], iterations: [] },
          null,
          2,
        ),
        "utf-8",
      )
      symlinkSync(statePath, join(project, "main.tex"), "file")
      writeChapter167()
      const chapterPath = join(project, "capitulos", "cap1.tex")
      const chapterHash = sha256(readFileSync(chapterPath))

      const result = await runCorrection({
        corrections: [CHAPTER_CORRECTION_167],
        previousScore: 6,
      })

      // The write already happened: the response must not claim the regression
      // was verified, nor that nothing was modified.
      expect(result.startsWith("partial:")).toBe(true)
      expect(result).toContain("the regression check could not be verified")
      expect(result).toContain("main manuscript content changed after the preflight")
      expect(result).toContain("no automatic rollback was performed")
      expect(result).toContain("can be inspected with banca_restore")
      expect(result).not.toContain("✓")
      expect(result).not.toContain("⚠")
      expect(sha256(readFileSync(chapterPath))).not.toBe(chapterHash)

      const { loadState } = await import("../src/lib/state")
      const state = loadState(project)
      expect(state.iterations).toHaveLength(1)
      expect(state.iterations[0].status).toBe("failed")
      expect(state.iterations[0].scoreAfter).toBeNull()
      expect(state.snapshots).toHaveLength(1)
      const label = state.snapshots[0].label
      expect(existsSync(join(project, ".banca", "snapshots", `${label}.manifest.json`))).toBe(true)

      // Recovery remains available and restores the original chapter bytes.
      const { bancaRestore } = await import("../src/tools/banca_restore")
      const restored = String(
        await bancaRestore.execute(
          { projectRoot: project, snapshotId: label, confirm: true } as any,
          {} as any,
        ),
      )
      expect(restored).toContain(`restored from ${label}`)
      expect(sha256(readFileSync(chapterPath))).toBe(chapterHash)
    },
  )
})
