/**
 * Focal tests for issue #114 — `banca_contract` target resolution/classification.
 *
 * Contract of record: /tmp/dshbanca-114-contract.md. The tool stays read-only
 * over the manuscript: it resolves/classifies correction targets and emits the
 * report; it never applies a correction, creates a snapshot, writes state or
 * touches a manuscript. Only `save: true` writes the report through
 * `saveReport`.
 *
 * Every scenario uses a synthetic workspace created with `mkdtempSync(tmpdir())`
 * and removed in `afterEach`; nothing outside the temporary base directory is
 * read or written, there is no network, model or real manuscript. A tracked
 * before/after snapshot of the project tree also proves the read-only contract
 * (`banca_corrigir` not called) in every scenario.
 *
 * RED tolerance: the historical tool only summarizes files and a boolean
 * `Immutable blocked` computed on the raw logical string. Tests fail on the
 * new per-target/aggregate report markers; they never fail on syntax/import.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
const symlinksSupported = (() => {
  try {
    const probe = join(tmpdir(), `dshbanca-114-link-probe-${process.pid}-${Date.now()}`)
    symlinkSync(tmpdir(), probe)
    rmSync(probe, { force: true })
    return true
  } catch {
    return false
  }
})()

/** Symlink scenarios skip on filesystems without symlink support. */
const stest = symlinksSupported ? test : test.skip

let base: string
let project: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dshbanca-114-contract-"))
  project = join(base, "project")
  mkdirSync(project, { recursive: true })
  mkdirSync(join(project, ".banca"), { recursive: true })
})

afterEach(() => {
  if (base) rmSync(base, { recursive: true, force: true })
})

interface ProjectOverrides {
  allowedPaths?: string[]
  protectedPaths?: string[]
  immutableFacts?: string[]
  externalDependencies?: string[]
}

/** Synthetic `.banca/project.json`; defaults keep `**\/*.tex` allowed with no restrictions. */
function writeProjectJson(overrides: ProjectOverrides = {}): void {
  const config = {
    version: 1,
    manuscript: {
      format: "latex",
      root: ".",
      main: "main.tex",
      bib: "refs.bib",
      chapters: ["capitulos/*.tex"],
      outputDir: "trabalhos",
    },
    compile: { enabled: false, command: [] },
    allowedPaths: overrides.allowedPaths ?? ["**/*.tex"],
    protectedPaths: overrides.protectedPaths ?? [],
    immutableFacts: overrides.immutableFacts ?? [],
    externalDependencies: overrides.externalDependencies ?? [],
    rubricProfile: "banca-rigorosa",
    targetScore: 9.0,
    providers: {
      references: {
        primary: "mcp:crossref-academic",
        fallbacks: ["rest:crossref", "cache"],
        timeoutMs: 20000,
      },
    },
    mcp: { crossrefAcademicEnabled: true },
  }
  writeFileSync(join(project, ".banca", "project.json"), JSON.stringify(config, null, 2), "utf-8")
}

function emptyState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currentScore: null,
    lastAudit: null,
    lastLoop: null,
    snapshots: [],
    iterations: [],
    ...overrides,
  }
}

function writeStateJson(state: Record<string, unknown>): void {
  writeFileSync(join(project, ".banca", "state.json"), JSON.stringify(state, null, 2), "utf-8")
}

function writeFileAt(relPath: string, content: string): string {
  const absolute = join(project, relPath)
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, "utf-8")
  return absolute
}

function correction(file: string, oldText = "texto antigo", newText = "texto novo") {
  return { file, oldText, newText }
}

/** Canonical project-relative POSIX path, exactly as the contract defines it (realpath-based). */
function canonicalRelOf(relPath: string): string {
  const canonicalRoot = realpathSync(project)
  const canonicalTarget = realpathSync(join(project, relPath))
  return relative(canonicalRoot, canonicalTarget).split(sep).join("/")
}

function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

/** File-level tree snapshot: relative path -> 'symlink' | sha256(content). Directories are not recorded. */
function snapshotTree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name)
      const rel = relative(root, absolute).split(sep).join("/")
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) out[rel] = "symlink"
      else if (stat.isDirectory()) walk(absolute)
      else out[rel] = sha256Of(readFileSync(absolute))
    }
  }
  walk(root)
  return out
}

function captureProjectState(): Record<string, string> {
  return snapshotTree(project)
}

/**
 * Proves the tool did not mutate the workspace: every pre-existing file keeps
 * its bytes, no unexpected file appears and no snapshot directory is created.
 */
function expectReadOnly(baseline: Record<string, string>, isAllowedNewFile: (rel: string) => boolean = () => false): void {
  const after = snapshotTree(project)
  for (const [rel, digest] of Object.entries(baseline)) {
    expect(after[rel]).toBe(digest)
  }
  for (const rel of Object.keys(after)) {
    if (baseline[rel] === undefined) expect(isAllowedNewFile(rel)).toBe(true)
  }
  expect(existsSync(join(project, ".banca", "snapshots"))).toBe(false)
}

function reportsDir(): string {
  return join(project, ".banca", "reports")
}

function reportFiles(): string[] {
  if (!existsSync(reportsDir())) return []
  return readdirSync(reportsDir()).filter((file) => file.endsWith(".md"))
}

function expectNoReportFiles(): void {
  expect(reportFiles()).toEqual([])
}

async function runContract(
  corrections: Array<{ file: string; oldText: string; newText: string }>,
  save?: boolean,
): Promise<string> {
  const { bancaContract } = await import("../src/tools/banca_contract")
  expect(typeof bancaContract?.execute).toBe("function")
  const args: Record<string, unknown> = { projectRoot: project, corrections }
  if (save !== undefined) args.save = save
  const result = await bancaContract.execute(args as any, { directory: project } as any)
  expect(typeof result).toBe("string")
  return String(result)
}

// ---------------------------------------------------------------------------
// Report parsing helpers (contract §4 markers only)
// ---------------------------------------------------------------------------
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function headerField(report: string, name: string): string | null {
  const match = report.match(new RegExp(`^\\*\\*${escapeRegExp(name)}:\\*\\* (.*)$`, "m"))
  return match ? match[1].trim() : null
}

/** Body of a `## <title>` section, up to the next `## ` heading. */
function sectionText(report: string, title: string): string | null {
  const lines = report.split("\n")
  const start = lines.findIndex((line) => line === `## ${title}`)
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index++) {
    if (lines[index].startsWith("## ")) {
      end = index
      break
    }
  }
  return lines.slice(start + 1, end).join("\n").trim()
}

type Block = { header: string; fields: Record<string, string> }

/** Blocks of "## Alvos por correção" in report order. */
function parseBlocks(report: string): Block[] {
  const blocks: Block[] = []
  let current: Block | null = null
  for (const line of report.split("\n")) {
    if (line.startsWith("### ")) {
      current = { header: line.slice(4).trim(), fields: {} }
      blocks.push(current)
      continue
    }
    if (line.startsWith("## ")) {
      current = null
      continue
    }
    const field = line.match(/^- ([^:]+): (.*)$/)
    if (current && field) current!.fields[field[1]] = field[2].trim()
  }
  return blocks
}

function stripCode(value: string | undefined | null): string {
  return (value ?? "").replace(/`/g, "").trim()
}

function findValidBlock(blocks: Block[], logical: string): Block | undefined {
  return blocks.find((block) => stripCode(block.header) === logical)
}

function fieldNumber(block: Block, name: string): number {
  return Number.parseInt(block.fields[name] ?? "", 10)
}

function expectHeaderNumber(report: string, name: string, expected: number): void {
  const raw = headerField(report, name)
  expect(raw).not.toBeNull()
  expect(Number.parseInt(String(raw), 10)).toBe(expected)
}

function expectPathState(block: Block, field: string, matchedPattern: string | null): void {
  const value = block.fields[field]
  expect(value).toBeDefined()
  if (matchedPattern === null) {
    expect(value).toBe("não")
    return
  }
  expect(value).toBe(`sim — \`${matchedPattern}\``)
}

function expectValidBlock(
  block: Block | undefined,
  options: {
    logical?: string
    canonical?: string
    corrections?: number
    indices?: number[]
    protected?: string | null
    immutable?: string | null
    allowed?: string | null
    pathBlocks?: string[] | "nenhum"
  },
): void {
  expect(block).toBeDefined()
  if (!block) return
  expect(block.fields["Valid target"]).toBe("sim")
  if (options.logical !== undefined) expect(stripCode(block.fields["Logical path"])).toBe(options.logical)
  if (options.canonical !== undefined) expect(stripCode(block.fields["Canonical path"])).toBe(options.canonical)
  if (options.corrections !== undefined) expect(fieldNumber(block, "Corrections")).toBe(options.corrections)
  if (options.indices !== undefined) {
    expect(block.fields["Correction indices"]?.match(/\d+/g)?.map(Number)).toEqual(options.indices)
  }
  if (options.protected !== undefined) expectPathState(block, "Protected (protectedPaths)", options.protected)
  if (options.immutable !== undefined) expectPathState(block, "Immutable (immutableFacts)", options.immutable)
  if (options.allowed !== undefined) expectPathState(block, "Allowed (allowedPaths)", options.allowed)
  if (options.pathBlocks !== undefined) {
    const expected = options.pathBlocks === "nenhum" ? "nenhum" : options.pathBlocks.join(", ")
    expect(block.fields["Path blocks"]).toBe(expected)
  }
}

function expectInvalidBlock(
  block: Block | undefined,
  options: { reason: string; index?: number; header?: string; logical?: string; logicalUnavailable?: boolean },
): void {
  expect(block).toBeDefined()
  if (!block) return
  expect(block.fields["Valid target"]).toBe(`não — ${options.reason}`)
  expect(block.fields["Protected (protectedPaths)"]).toBe("não avaliável")
  expect(block.fields["Immutable (immutableFacts)"]).toBe("não avaliável")
  expect(block.fields["Allowed (allowedPaths)"]).toBe("não avaliável")
  expect(block.fields["Path blocks"]).toBe("destino inválido")
  expect(block.fields["Corrections"]).toBe("1")
  if (options.index !== undefined) expect(block.header).toBe(`correção #${options.index} (caminho inválido)`)
  if (options.header !== undefined) expect(block.header).toBe(options.header)
  if (options.logical !== undefined) expect(stripCode(block.fields["Logical path"])).toBe(options.logical)
  if (options.logicalUnavailable) {
    expect(block.fields["Logical path"]).toBe("não disponível (caminho inválido)")
    expect(block.fields["Canonical path"]).toBe("não resolvido")
  }
}

function aliasesSection(report: string): string {
  const text = sectionText(report, "Aliases e destinos repetidos")
  expect(text).not.toBeNull()
  return text ?? ""
}

function aggregateSection(report: string): string {
  const text = sectionText(report, "Bloqueios agregados")
  expect(text).not.toBeNull()
  return text ?? ""
}

/** Markers that every non-absence contract report must expose (§4). */
function expectCoreReport(report: string): void {
  expect(report.startsWith("# Correction Contract")).toBe(true)
  expect(headerField(report, "Date")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  expect(report).toContain("**Avaliação, não autorização:**")
  for (const header of [
    "Corrections",
    "Files",
    "Canonical targets",
    "Duplicate corrections",
    "Aliases",
    "Invalid targets",
    "Protected targets",
    "Immutable targets",
    "Outside allowedPaths",
    "Immutable blocked",
    "Identity conflict",
    "Score before",
    "External deps",
  ]) {
    expect(report).toContain(`**${header}:**`)
  }
  expect(report).toContain("## Alvos por correção")
  expect(report).toContain("## Aliases e destinos repetidos")
  expect(report).toContain("## Bloqueios agregados")
  expect(report).toContain("## Limitações")
  expect(report).toContain("não autoriza edição")
  expect(report).toContain("não comprova aprovação humana")
  expect(report).toContain("Nenhuma correção foi executada")
  // Never leak a host path and never present the report as an authorization.
  expect(report).not.toContain(project)
  expect(report).not.toContain("authorized")
  expect(report).not.toContain("autorizado")
}

// ===========================================================================
// §5.1 + §5.2 — direct immutable/protected targets
// ===========================================================================
describe("banca_contract — classificação direta por alvo", () => {
  test("1. alvo diretamente imutável: sim, Immutable blocked true e agregado 1", async () => {
    writeProjectJson({ immutableFacts: ["segredo.tex"] })
    writeFileAt("segredo.tex", "conteudo imutavel sintetico do projeto")
    const baseline = captureProjectState()

    const report = await runContract([correction("segredo.tex")])

    // Defeito histórico: imutabilidade só era avaliada no caminho lógico cru.
    expect(headerField(report, "Immutable blocked")).toBe("true")
    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 1)
    expectHeaderNumber(report, "Files", 1)
    expectHeaderNumber(report, "Canonical targets", 1)
    expectHeaderNumber(report, "Duplicate corrections", 0)
    expectHeaderNumber(report, "Aliases", 0)
    expectHeaderNumber(report, "Invalid targets", 0)
    expectHeaderNumber(report, "Protected targets", 0)
    expectHeaderNumber(report, "Immutable targets", 1)
    expectHeaderNumber(report, "Outside allowedPaths", 0)
    expect(headerField(report, "Identity conflict")).toBe("none (nenhum conflito detectado)")
    expect(headerField(report, "Score before")).toBe("—")
    expect(headerField(report, "External deps")).toBe("—")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectValidBlock(blocks[0], {
      logical: "segredo.tex",
      canonical: "segredo.tex",
      corrections: 1,
      indices: [1],
      protected: null,
      immutable: "segredo.tex",
      allowed: "**/*.tex",
      pathBlocks: ["immutableFacts"],
    })
    expect(aggregateSection(report)).toContain("- Imutabilidade (immutableFacts): 1 alvo(s)")
    expect(aggregateSection(report)).toContain("- Proteção (protectedPaths): 0 alvo(s)")
    expect(aliasesSection(report)).toContain("nenhum alias ou repetição de alvo")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("2. alvo diretamente protegido: protegido sim, imutável não", async () => {
    writeProjectJson({ protectedPaths: ["main.tex"] })
    writeFileAt("main.tex", "texto sintetico protegido")
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectCoreReport(report)
    expectHeaderNumber(report, "Protected targets", 1)
    expectHeaderNumber(report, "Immutable targets", 0)
    expect(headerField(report, "Immutable blocked")).toBe("false")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectValidBlock(blocks[0], {
      logical: "main.tex",
      canonical: "main.tex",
      corrections: 1,
      indices: [1],
      protected: "main.tex",
      immutable: null,
      allowed: "**/*.tex",
      pathBlocks: ["protectedPaths"],
    })
    expect(aggregateSection(report)).toContain("- Proteção (protectedPaths): 1 alvo(s)")
    expect(aggregateSection(report)).toContain("- Imutabilidade (immutableFacts): 0 alvo(s)")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})

// ===========================================================================
// §5.3 + §5.13 — internal alias, repetition and identity conflict
// ===========================================================================
describe("banca_contract — aliases, repetição e conflito de identidade", () => {
  stest("3. alias interno herda proteção+imutabilidade do destino canônico", async () => {
    writeProjectJson({
      protectedPaths: ["capitulos/**"],
      immutableFacts: ["capitulos/**"],
      allowedPaths: ["**/*.tex"],
    })
    writeFileAt("capitulos/real.tex", "texto academico sintetico do capitulo")
    symlinkSync(join(project, "capitulos", "real.tex"), join(project, "main.tex"), "file")
    const baseline = captureProjectState()

    const report = await runContract([
      correction("main.tex"),
      correction("capitulos/real.tex"),
    ])

    // Defeito principal histórico: o alias não era classificado pelo destino real.
    expectHeaderNumber(report, "Aliases", 1)
    expectHeaderNumber(report, "Canonical targets", 1)
    expectHeaderFieldStartsWith(report, "Identity conflict", "sim")
    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 2)
    expectHeaderNumber(report, "Files", 2)
    expectHeaderNumber(report, "Duplicate corrections", 0)
    expectHeaderNumber(report, "Invalid targets", 0)
    expectHeaderNumber(report, "Protected targets", 2)
    expectHeaderNumber(report, "Immutable targets", 2)
    expectHeaderNumber(report, "Outside allowedPaths", 0)
    expect(headerField(report, "Immutable blocked")).toBe("true")
    expect(headerField(report, "Identity conflict")).toContain(
      "múltiplos alvos resolvem para o mesmo arquivo físico",
    )
    expect(headerField(report, "Identity conflict")).toContain("banca_corrigir recusaria o lote")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    const aliasBlock = findValidBlock(blocks, "main.tex")
    expect(aliasBlock).toBeDefined()
    expectValidBlock(aliasBlock, {
      logical: "main.tex",
      canonical: "capitulos/real.tex",
      protected: "capitulos/**",
      immutable: "capitulos/**",
      allowed: "**/*.tex",
      pathBlocks: ["protectedPaths", "immutableFacts"],
    })
    const canonicalBlock = findValidBlock(blocks, "capitulos/real.tex")
    expect(canonicalBlock).toBeDefined()
    expectValidBlock(canonicalBlock, {
      logical: "capitulos/real.tex",
      canonical: "capitulos/real.tex",
      protected: "capitulos/**",
      immutable: "capitulos/**",
      allowed: "**/*.tex",
      pathBlocks: ["protectedPaths", "immutableFacts"],
    })

    const aliases = aliasesSection(report)
    expect(aliases).toContain("main.tex")
    expect(aliases).toContain("capitulos/real.tex")
    expect(aliases).toContain("→ `capitulos/real.tex`")
    expect(aliases).toContain("2 alvos, 1 destino canônico")
    expect(aggregateSection(report)).toContain("- Conflito de identidade de destino: sim")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  stest("13. repetição de alvo e alias são contabilizados sem consolidação silenciosa", async () => {
    writeProjectJson()
    writeFileAt("capitulos/real.tex", "texto academico sintetico repetido")
    symlinkSync(join(project, "capitulos", "real.tex"), join(project, "main.tex"), "file")
    const baseline = captureProjectState()

    const report = await runContract([
      correction("main.tex"),
      correction("main.tex"),
      correction("capitulos/real.tex"),
    ])

    expectHeaderNumber(report, "Corrections", 3)
    expectHeaderNumber(report, "Files", 2)
    expectHeaderNumber(report, "Canonical targets", 1)
    expectHeaderNumber(report, "Duplicate corrections", 1)
    expectHeaderNumber(report, "Aliases", 1)
    expectHeaderFieldStartsWith(report, "Identity conflict", "sim")
    expectCoreReport(report)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    const repeated = findValidBlock(blocks, "main.tex")
    expect(repeated).toBeDefined()
    if (repeated) {
      expect(fieldNumber(repeated, "Corrections")).toBe(2)
      expect(repeated.fields["Correction indices"]?.match(/\d+/g)?.map(Number)).toEqual([1, 2])
      expect(stripCode(repeated.fields["Canonical path"])).toBe("capitulos/real.tex")
    }
    const canonical = findValidBlock(blocks, "capitulos/real.tex")
    expect(canonical).toBeDefined()
    if (canonical) {
      expect(fieldNumber(canonical, "Corrections")).toBe(1)
      expect(canonical.fields["Correction indices"]?.match(/\d+/g)?.map(Number)).toEqual([3])
    }

    const aliases = aliasesSection(report)
    expect(aliases).toContain("2 alvos, 1 destino canônico")
    expect(aliases).toContain("→ `capitulos/real.tex`")
    expect(aliases).toContain("recebido em 2 correção(ões)")

    // The batch is explicitly not presented as an authorization.
    expect(report).toContain("não autoriza edição")
    expect(report).toContain("banca_corrigir recusaria o lote")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})

// ===========================================================================
// §5.4 + §5.5 + §5.6 + §5.7 — allowlist, mixed targets and globs
// ===========================================================================
describe("banca_contract — allowlist e classificação por caminho canônico", () => {
  test("4. alvo permitido sem restrições: Path blocks nenhum e nenhuma concessão", async () => {
    writeProjectJson()
    writeFileAt("main.tex", "texto sintetico permitido")
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectCoreReport(report)
    expectHeaderNumber(report, "Protected targets", 0)
    expectHeaderNumber(report, "Immutable targets", 0)
    expectHeaderNumber(report, "Outside allowedPaths", 0)
    expect(headerField(report, "Immutable blocked")).toBe("false")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectValidBlock(blocks[0], {
      logical: "main.tex",
      canonical: "main.tex",
      protected: null,
      immutable: null,
      allowed: "**/*.tex",
      pathBlocks: "nenhum",
    })
    expect(report).toContain("não autoriza edição")
    expect(report).toContain("não comprova aprovação humana")
    expect(report).not.toContain("authorized")
    expect(report).not.toContain("autorizado")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("5. alvo fora da allowlist: Allowed não e Outside allowedPaths 1", async () => {
    writeProjectJson({ allowedPaths: ["capitulos/**"] })
    writeFileAt("main.tex", "texto sintetico fora da allowlist")
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectHeaderNumber(report, "Outside allowedPaths", 1)
    expectCoreReport(report)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectValidBlock(blocks[0], {
      logical: "main.tex",
      canonical: "main.tex",
      protected: null,
      immutable: null,
      allowed: null,
      pathBlocks: ["allowedPaths"],
    })
    expect(aggregateSection(report)).toContain("- Fora da allowlist (allowedPaths): 1 alvo(s)")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("6. múltiplos alvos com classificações diferentes: agregados 1/1/1/1", async () => {
    writeProjectJson({
      allowedPaths: ["**/*.tex"],
      protectedPaths: ["capitulos/**"],
      immutableFacts: ["segredo.tex"],
    })
    writeFileAt("main.tex", "texto sintetico sem restricao")
    writeFileAt("capitulos/protegido.tex", "texto sintetico protegido")
    writeFileAt("segredo.tex", "texto sintetico imutavel")
    writeFileAt("fora.md", "texto sintetico fora da allowlist")
    const baseline = captureProjectState()

    const report = await runContract([
      correction("main.tex"),
      correction("capitulos/protegido.tex"),
      correction("segredo.tex"),
      correction("fora.md"),
    ])

    expectHeaderNumber(report, "Corrections", 4)
    expectHeaderNumber(report, "Files", 4)
    expectHeaderNumber(report, "Canonical targets", 4)
    expectHeaderNumber(report, "Duplicate corrections", 0)
    expectHeaderNumber(report, "Aliases", 0)
    expectHeaderNumber(report, "Invalid targets", 0)
    expectHeaderNumber(report, "Protected targets", 1)
    expectHeaderNumber(report, "Immutable targets", 1)
    expectHeaderNumber(report, "Outside allowedPaths", 1)
    expect(headerField(report, "Immutable blocked")).toBe("true")
    expect(headerField(report, "Identity conflict")).toBe("none (nenhum conflito detectado)")
    expectCoreReport(report)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(4)
    expectValidBlock(findValidBlock(blocks, "main.tex"), {
      protected: null,
      immutable: null,
      allowed: "**/*.tex",
      pathBlocks: "nenhum",
    })
    expectValidBlock(findValidBlock(blocks, "capitulos/protegido.tex"), {
      canonical: "capitulos/protegido.tex",
      protected: "capitulos/**",
      immutable: null,
      allowed: "**/*.tex",
      pathBlocks: ["protectedPaths"],
    })
    expectValidBlock(findValidBlock(blocks, "segredo.tex"), {
      protected: null,
      immutable: "segredo.tex",
      allowed: "**/*.tex",
      pathBlocks: ["immutableFacts"],
    })
    expectValidBlock(findValidBlock(blocks, "fora.md"), {
      protected: null,
      immutable: null,
      allowed: null,
      pathBlocks: ["allowedPaths"],
    })

    const aggregates = aggregateSection(report)
    expect(aggregates).toContain("- Proteção (protectedPaths): 1 alvo(s)")
    expect(aggregates).toContain("- Imutabilidade (immutableFacts): 1 alvo(s)")
    expect(aggregates).toContain("- Fora da allowlist (allowedPaths): 1 alvo(s)")
    expect(aggregates).toContain("- Destino inválido: 0 alvo(s)")
    expect(aggregates).toContain("- Conflito de identidade de destino: não")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("7. glob protege caminho canônico aninhado", async () => {
    writeProjectJson({
      protectedPaths: ["capitulos/**"],
      allowedPaths: ["**/*.tex"],
    })
    writeFileAt("capitulos/sub/cap.tex", "texto sintetico em subdiretorio")
    const baseline = captureProjectState()

    const report = await runContract([correction("capitulos/sub/cap.tex")])

    expectHeaderNumber(report, "Protected targets", 1)
    expectCoreReport(report)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectValidBlock(blocks[0], {
      logical: "capitulos/sub/cap.tex",
      canonical: "capitulos/sub/cap.tex",
      protected: "capitulos/**",
      immutable: null,
      allowed: "**/*.tex",
      pathBlocks: ["protectedPaths"],
    })

    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})

// ===========================================================================
// §5.8 – §5.12 — invalid targets
// ===========================================================================
describe("banca_contract — alvos inválidos", () => {
  test("8. ../outside.tex é inválido por traversal e não vaza o texto bruto", async () => {
    writeProjectJson()
    const externalFile = join(base, "outside.tex")
    writeFileSync(externalFile, "conteudo externo sintetico", "utf-8")
    const externalHashBefore = sha256Of(readFileSync(externalFile))
    const baseline = captureProjectState()

    const report = await runContract([correction("../outside.tex")])

    // Defeito histórico: traversal era aceito sem validação.
    expect(headerField(report, "Invalid targets")).toBe("1")
    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 1)
    expectHeaderNumber(report, "Files", 1)
    expectHeaderNumber(report, "Canonical targets", 0)
    expectHeaderNumber(report, "Aliases", 0)
    expectHeaderNumber(report, "Duplicate corrections", 0)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectInvalidBlock(blocks[0], {
      reason: "caminho fora do projeto ou traversal",
      index: 1,
      logicalUnavailable: true,
    })
    expect(aggregateSection(report)).toContain("- Destino inválido: 1 alvo(s)")
    expect(report).not.toContain("../outside.tex")
    expect(report).not.toContain(externalFile)
    expect(report).not.toContain(base)
    expect(sha256Of(readFileSync(externalFile))).toBe(externalHashBefore)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  stest("9. symlink externo e symlink quebrado são inválidos e não expõem o alvo externo", async () => {
    writeProjectJson()
    const external = join(base, "external")
    mkdirSync(external, { recursive: true })
    const externalFile = join(external, "outside.tex")
    writeFileSync(externalFile, "conteudo externo sintetico confidencial", "utf-8")
    symlinkSync(externalFile, join(project, "main.tex"), "file")
    symlinkSync(join(base, "missing", "gone.tex"), join(project, "quebrado.tex"), "file")
    const externalBefore = snapshotTree(external)
    const baseline = captureProjectState()

    const report = await runContract([
      correction("main.tex"),
      correction("quebrado.tex"),
    ])

    expectHeaderNumber(report, "Invalid targets", 2)
    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 2)
    expectHeaderNumber(report, "Files", 2)
    expectHeaderNumber(report, "Canonical targets", 0)
    expectHeaderNumber(report, "Aliases", 0)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    // Caminho lógico resolvido com segurança → cabeçalho mostra o lógico (decisão do contrato).
    expectInvalidBlock(blocks[0], {
      reason: "destino escapa do workspace ou symlink externo/quebrado",
      header: "`main.tex`",
      logical: "main.tex",
    })
    expectInvalidBlock(blocks[1], {
      reason: "destino escapa do workspace ou symlink externo/quebrado",
      header: "`quebrado.tex`",
      logical: "quebrado.tex",
    })
    expect(report).not.toContain(externalFile)
    expect(report).not.toContain(external)
    expect(report).not.toContain(base)
    expect(snapshotTree(external)).toEqual(externalBefore)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("10. arquivo inexistente: inválido com estados não avaliáveis", async () => {
    writeProjectJson()
    const baseline = captureProjectState()

    const report = await runContract([correction("fantasma.tex")])

    expectHeaderNumber(report, "Invalid targets", 1)
    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 1)
    expectHeaderNumber(report, "Files", 1)
    expectHeaderNumber(report, "Canonical targets", 0)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectInvalidBlock(blocks[0], {
      reason: "arquivo inexistente",
      header: "`fantasma.tex`",
      logical: "fantasma.tex",
    })
    expect(report).toContain("### `fantasma.tex`")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("11. diretório como alvo: inválido destino não é arquivo regular", async () => {
    writeProjectJson()
    mkdirSync(join(project, "pasta.tex"))
    const baseline = captureProjectState()

    const report = await runContract([correction("pasta.tex")])

    expectCoreReport(report)
    expectHeaderNumber(report, "Invalid targets", 1)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectInvalidBlock(blocks[0], {
      reason: "destino não é arquivo regular",
      header: "`pasta.tex`",
      logical: "pasta.tex",
    })

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("12. caminho vazio ou só whitespace: inválido caminho vazio sem lançar", async () => {
    writeProjectJson()
    const baseline = captureProjectState()

    const report = await runContract([correction(""), correction("   ")])

    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 2)
    expectHeaderNumber(report, "Files", 2)
    expectHeaderNumber(report, "Invalid targets", 2)
    expectHeaderNumber(report, "Canonical targets", 0)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    expectInvalidBlock(blocks[0], { reason: "caminho vazio", index: 1 })
    expectInvalidBlock(blocks[1], { reason: "caminho vazio", index: 2 })

    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})

// ===========================================================================
// §5.14 + §5.15 + §5.16 + §5.17 — read-only, persistence and metadata
// ===========================================================================
describe("banca_contract — read-only, persistência e metadados", () => {
  test("14. save falso/omitido não cria relatório e preserva state/manuscrito", async () => {
    writeProjectJson()
    writeFileAt("main.tex", "manuscrito sintetico inalterado")
    writeStateJson(emptyState({ currentScore: 6 }))
    const baseline = captureProjectState()

    const omitted = await runContract([correction("main.tex")])
    expectCoreReport(omitted)
    expectValidBlock(parseBlocks(omitted)[0], { logical: "main.tex", canonical: "main.tex" })
    expectNoReportFiles()
    expectReadOnly(baseline)

    const explicitFalse = await runContract([correction("main.tex")], false)
    expectCoreReport(explicitFalse)
    expectHeaderNumber(explicitFalse, "Corrections", 1)
    expectNoReportFiles()
    expectReadOnly(baseline)
  })

  test("15. save true persiste exatamente um contract-*.md idêntico ao retorno", async () => {
    writeProjectJson()
    writeFileAt("main.tex", "manuscrito sintetico para persistencia")
    writeStateJson(emptyState({ currentScore: 8 }))
    const baseline = captureProjectState()

    const result = await runContract([correction("main.tex")], true)

    expectCoreReport(result)
    expect(result).toContain("## Alvos por correção")
    const savedContracts = reportFiles().filter((file) => file.startsWith("contract-"))
    expect(savedContracts).toHaveLength(1)
    expect(savedContracts[0]).toMatch(/^contract-.+\.md$/)
    const persisted = readFileSync(join(reportsDir(), savedContracts[0]), "utf-8")
    expect(persisted).toBe(result)

    expectReadOnly(baseline, (rel) => rel === `.banca/reports/${savedContracts[0]}`)
  })

  test("16. metadados preservados: Score before e External deps sem novo score", async () => {
    writeProjectJson({ externalDependencies: ["dep:teste"] })
    writeFileAt("main.tex", "manuscrito sintetico com metadados")
    writeStateJson(emptyState({ currentScore: 7.5 }))
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectCoreReport(report)
    expect(headerField(report, "Score before")).toBe("7.5")
    expect(headerField(report, "External deps")).toBe("dep:teste")
    expectHeaderNumber(report, "Corrections", 1)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectValidBlock(blocks[0], { logical: "main.tex", canonical: "main.tex", pathBlocks: "nenhum" })

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("17. banca_corrigir não é chamado: sem snapshot, state e manuscritos intactos", async () => {
    writeProjectJson({
      protectedPaths: ["dados/**"],
      immutableFacts: ["main.tex"],
    })
    writeFileAt("main.tex", "manuscrito sintetico imutavel")
    writeFileAt("dados/base.tex", "dados sinteticos protegidos")
    writeStateJson(emptyState({ currentScore: 7 }))
    const baseline = captureProjectState()

    const report = await runContract([
      correction("main.tex"),
      correction("dados/base.tex"),
    ])

    expectCoreReport(report)
    expectHeaderNumber(report, "Corrections", 2)
    expectHeaderNumber(report, "Protected targets", 1)
    expectHeaderNumber(report, "Immutable targets", 1)
    expect(headerField(report, "Immutable blocked")).toBe("true")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    const immutableBlock = findValidBlock(blocks, "main.tex")
    expectValidBlock(immutableBlock, {
      logical: "main.tex",
      canonical: "main.tex",
      immutable: "main.tex",
      protected: null,
      pathBlocks: ["immutableFacts"],
    })
    const protectedBlock = findValidBlock(blocks, "dados/base.tex")
    expectValidBlock(protectedBlock, {
      logical: "dados/base.tex",
      canonical: "dados/base.tex",
      protected: "dados/**",
      immutable: null,
      pathBlocks: ["protectedPaths"],
    })

    expect(report).toContain("nenhum snapshot foi criado")
    expect(existsSync(join(project, ".banca", "snapshots"))).toBe(false)
    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})

// ---------------------------------------------------------------------------
// Small local helpers used only by the sections above.
// ---------------------------------------------------------------------------
function expectHeaderFieldStartsWith(report: string, name: string, prefix: string): void {
  const value = headerField(report, name)
  expect(value).not.toBeNull()
  expect(String(value).startsWith(prefix)).toBe(true)
}
