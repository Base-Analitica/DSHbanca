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
import { join } from "node:path"

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
