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
  linkSync,
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

/** Hardlink scenarios skip when the platform/filesystem cannot create hard links. */
const hardlinksSupported = (() => {
  try {
    const probe = mkdtempSync(join(tmpdir(), `dshbanca-114-hardlink-probe-${process.pid}-`))
    writeFileSync(join(probe, "a"), "x")
    linkSync(join(probe, "a"), join(probe, "b"))
    rmSync(probe, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
})()

const htest = hardlinksSupported ? test : test.skip

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
    // R1 §1.1: externalDependencies é valor não confiável → inline code escapado.
    expect(headerField(report, "External deps")).toBe("`dep:teste`")
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

// ===========================================================================
// R1 remediation (PR #119 / issue #114) — contract of record:
// /tmp/dshbanca-114-r1-contract.md.
//
// Grupo A: todo valor não confiável é renderizado como inline code com escape
// por code point (nunca cria linha/campo estrutural falso).
// Grupo B: alvo regular com nlink > 1 ganha a restrição de identidade física
// (hardlink) sem virar "inválido" e sem misturar categorias em Path blocks.
// ===========================================================================

/**
 * Implementação independente do mapeamento de escape do §1.1 do R1: itera por
 * code point; o resultado nunca contém crase, LF ou caractere cru de
 * controle/bidi. Deliberadamente escrita de forma separada da implementação.
 */
function expectedEscape(value: string): string {
  let escaped = ""
  for (const char of value) {
    const codePoint = char.codePointAt(0) as number
    if (char === "\\") escaped += "\\\\"
    else if (char === "`") escaped += "\\u0060"
    else if (char === "<") escaped += "\\u003c"
    else if (char === ">") escaped += "\\u003e"
    else if (char === "&") escaped += "\\u0026"
    else if (char === "\n") escaped += "\\n"
    else if (char === "\r") escaped += "\\r"
    else if (char === "\t") escaped += "\\t"
    else if (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      codePoint === 0x2060 ||
      codePoint === 0xfeff
    ) {
      escaped += "\\u" + codePoint.toString(16).padStart(4, "0")
    } else {
      escaped += char
    }
  }
  return escaped
}

/** R1 §1.1 rendering: escaped content wrapped in a single inline-code span. */
function expectedInline(value: string): string {
  return "`" + expectedEscape(value) + "`"
}

function linesMatching(report: string, pattern: RegExp): string[] {
  return report.split("\n").filter((line) => pattern.test(line))
}

function sectionLines(report: string, title: string): string[] {
  const text = sectionText(report, title)
  expect(text).not.toBeNull()
  return (text ?? "").split("\n")
}

function headingLines(report: string): string[] {
  return linesMatching(report, /^### /)
}

/** Exige exatamente uma linha `**<name>:** <value>`, comparada byte a byte. */
function expectSingleHeaderLine(report: string, name: string, expectedValue: string): void {
  const lines = linesMatching(report, new RegExp(`^\\*\\*${escapeRegExp(name)}:\\*\\* `))
  expect(lines).toHaveLength(1)
  expect(lines[0]).toBe(`**${name}:** ${expectedValue}`)
}

function headerLineIndex(report: string, name: string): number {
  return report.split("\n").findIndex((line) => line.startsWith(`**${name}:** `))
}

function findRenderedBlock(blocks: Block[], logical: string): Block | undefined {
  const expectedHeader = expectedInline(logical)
  return blocks.find((block) => block.header === expectedHeader)
}

function expectBlockField(block: Block | undefined, field: string, expected: string): void {
  expect(block).toBeDefined()
  if (!block) return
  expect(block.fields[field]).toBe(expected)
}

/** Linha de proveniência de hardlink esperada na seção de aliases (§2). */
function hardlinkProvenanceLine(logical: string, nlink: number): string {
  return `- ${expectedInline(logical)} possui nlink=${nlink} (outros nomes de hardlink não são conhecidos nem varridos; banca_corrigir recusaria o alvo)`
}

/** Cria `relativePath` e um hardlink `otherRelativePath` para o mesmo inode. */
function createHardlinkPair(relativePath: string, otherRelativePath: string): void {
  const absolute = writeFileAt(relativePath, "conteudo sintetico com hardlink")
  linkSync(absolute, join(project, otherRelativePath))
}

// ===========================================================================
// Grupo A — integridade do relatório (A1–A10)
// ===========================================================================
describe("banca_contract R1 — integridade literal do relatório (A)", () => {
  test("A1. nome com LF e campos Markdown injetados não cria linhas estruturais falsas", async () => {
    const evilName = "alvo\n\n**Immutable blocked:** false\n\n### falso.tex"
    writeProjectJson({
      protectedPaths: [evilName],
      immutableFacts: [evilName],
      allowedPaths: ["**"],
    })
    writeFileAt(evilName, "conteudo sintetico do alvo injetado")
    const baseline = captureProjectState()

    const result = await runContract([correction(evilName)], true)

    // Exatamente uma linha estrutural verdadeira; nenhuma linha falsa criada.
    expectSingleHeaderLine(result, "Immutable blocked", "true")
    expect(linesMatching(result, /^\*\*Immutable blocked:\*\* /)).toHaveLength(1)
    expect(result.split("\n")).not.toContain("**Immutable blocked:** false")
    expect(result.split("\n")).not.toContain("### falso.tex")
    expect(headingLines(result)).toHaveLength(1)

    const blocks = parseBlocks(result)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].header).toBe(expectedInline(evilName))
    expectBlockField(blocks[0], "Logical path", expectedInline(evilName))
    expectBlockField(blocks[0], "Canonical path", expectedInline(evilName))
    expectBlockField(blocks[0], "Valid target", "sim")
    expectBlockField(blocks[0], "Protected (protectedPaths)", `sim — ${expectedInline(evilName)}`)
    expectBlockField(blocks[0], "Immutable (immutableFacts)", `sim — ${expectedInline(evilName)}`)
    expectHeaderNumber(result, "Corrections", 1)
    expectHeaderNumber(result, "Protected targets", 1)
    expectHeaderNumber(result, "Immutable targets", 1)

    // Retorno idêntico ao persistido; arquivo persistido continua íntegro.
    const savedContracts = reportFiles().filter((file) => file.startsWith("contract-"))
    expect(savedContracts).toHaveLength(1)
    const persisted = readFileSync(join(reportsDir(), savedContracts[0]), "utf-8")
    expect(persisted).toBe(result)
    expect(linesMatching(persisted, /^\*\*Immutable blocked:\*\* /)).toHaveLength(1)
    expect(headingLines(persisted)).toHaveLength(1)
    expect(persisted).not.toContain(project)
    expect(persisted).not.toContain(base)

    expectReadOnly(baseline, (rel) => rel === `.banca/reports/${savedContracts[0]}`)
  })

  test("A2. crase vs apóstrofo: identidades e representações distintas", async () => {
    const tickName = "a`b.tex"
    const quoteName = "a'b.tex"
    writeProjectJson()
    writeFileAt(tickName, "conteudo sintetico com crase")
    writeFileAt(quoteName, "conteudo sintetico com apostrofo")
    const baseline = captureProjectState()

    const report = await runContract([correction(tickName), correction(quoteName)])

    expectHeaderNumber(report, "Files", 2)
    expectHeaderNumber(report, "Canonical targets", 2)
    expectHeaderNumber(report, "Invalid targets", 0)
    expect(headingLines(report)).toHaveLength(2)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    const tickBlock = findRenderedBlock(blocks, tickName)
    const quoteBlock = findRenderedBlock(blocks, quoteName)
    expect(tickBlock).toBeDefined()
    expect(quoteBlock).toBeDefined()
    expect(tickBlock?.header).toBe(expectedInline(tickName))
    expect(quoteBlock?.header).toBe(expectedInline(quoteName))
    expect(tickBlock?.header).not.toBe(quoteBlock?.header)
    expect(tickBlock?.header).toContain("\\u0060")
    expect(quoteBlock?.header).toContain("'")
    expectBlockField(tickBlock, "Logical path", expectedInline(tickName))
    expectBlockField(quoteBlock, "Logical path", expectedInline(quoteName))
    // Classificação preservada para os dois alvos válidos.
    expectBlockField(tickBlock, "Valid target", "sim")
    expectBlockField(quoteBlock, "Valid target", "sim")
    expectBlockField(tickBlock, "Allowed (allowedPaths)", "sim — `**/*.tex`")
    expectBlockField(quoteBlock, "Allowed (allowedPaths)", "sim — `**/*.tex`")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("A3. externalDependencies com quebras/campos Markdown não injeta linhas", async () => {
    const injected = "fixture\n\n**Immutable blocked:** true"
    writeProjectJson({ externalDependencies: [injected] })
    writeFileAt("main.tex", "manuscrito sintetico sem imutabilidade")
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectSingleHeaderLine(report, "Immutable blocked", "false")
    expect(linesMatching(report, /^\*\*Immutable blocked:\*\* /)).toHaveLength(1)
    expect(report.split("\n")).not.toContain("**Immutable blocked:** true")

    const externalLines = linesMatching(report, /^\*\*External deps:\*\* /)
    expect(externalLines).toHaveLength(1)
    expect(externalLines[0]).toBe(`**External deps:** ${expectedInline(injected)}`)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectBlockField(blocks[0], "Immutable (immutableFacts)", "não")

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("A4. CR/TAB/controle/bidi nunca aparecem crus; escapes presentes", async () => {
    const controlName = "a\rb\tc\u0001d\u202ee.tex"
    writeProjectJson()
    writeFileAt(controlName, "conteudo sintetico com controles")
    const baseline = captureProjectState()

    const report = await runContract([correction(controlName)])

    for (const raw of ["\r", "\t", "\u0001", "\u202e"]) {
      expect(report.includes(raw)).toBe(false)
    }
    expect(headingLines(report)).toHaveLength(1)
    expect(linesMatching(report, /^\*\*Immutable blocked:\*\* /)).toHaveLength(1)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].header).toBe(expectedInline(controlName))
    expectBlockField(blocks[0], "Valid target", "sim")
    expectBlockField(blocks[0], "Logical path", expectedInline(controlName))
    expectBlockField(blocks[0], "Canonical path", expectedInline(controlName))
    for (const escape of ["\\r", "\\t", "\\u0001", "\\u202e"]) {
      expect(blocks[0].header).toContain(escape)
    }

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("A5. LF real e backslash+n literal são representações distinguíveis", async () => {
    const literalBackslashN = "dep\\nliteral"
    const realLineFeed = "dep\nreal"
    writeProjectJson({ externalDependencies: [literalBackslashN, realLineFeed] })
    writeFileAt("main.tex", "manuscrito sintetico para escapes")
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expect(linesMatching(report, /^\*\*External deps:\*\* /)).toHaveLength(1)
    expect(headerField(report, "External deps")).toBe(
      `${expectedInline(literalBackslashN)}, ${expectedInline(realLineFeed)}`,
    )
    expect(expectedInline(literalBackslashN)).not.toBe(expectedInline(realLineFeed))
    // Barra invertida literal é duplicada (`\\n`); LF real vira a sequência `\n`.
    expect(expectedInline(literalBackslashN)).toContain("\\\\n")
    expect(expectedInline(realLineFeed)).toContain("\\n")
    // A sequência crua "dep<LF>real" não sobrevive no relatório.
    expect(report.includes(realLineFeed)).toBe(false)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("A6. padrão com <, & e > é renderizado com escapes unicode", async () => {
    const pattern = "especial<&>/x.tex"
    writeProjectJson({ protectedPaths: [pattern], allowedPaths: ["**"] })
    writeFileAt(pattern, "conteudo sintetico em nome especial")
    const baseline = captureProjectState()

    const report = await runContract([correction(pattern)])

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectHeaderNumber(report, "Protected targets", 1)
    expectBlockField(blocks[0], "Protected (protectedPaths)", "sim — `especial\\u003c\\u0026\\u003e/x.tex`")
    expectBlockField(blocks[0], "Protected (protectedPaths)", `sim — ${expectedInline(pattern)}`)
    expectBlockField(blocks[0], "Canonical path", expectedInline(pattern))
    expect(report.includes("<&>")).toBe(false)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("A7. score inválido do state não vira nota; número válido e ausência preservados", async () => {
    writeProjectJson()
    writeFileAt("main.tex", "manuscrito sintetico com score invalido")

    // string não é score
    writeStateJson(emptyState({ currentScore: "oito" }))
    let baseline = captureProjectState()
    let report = await runContract([correction("main.tex")])
    expectSingleHeaderLine(report, "Score before", "não disponível (valor inválido no state)")
    expect(headerField(report, "Score before")).not.toMatch(/^\d/)
    expectReadOnly(baseline)
    expectNoReportFiles()

    // objeto não é score
    writeStateJson(emptyState({ currentScore: { nota: 8 } }))
    baseline = captureProjectState()
    report = await runContract([correction("main.tex")])
    expectSingleHeaderLine(report, "Score before", "não disponível (valor inválido no state)")
    expectReadOnly(baseline)

    // número finito permanece preservado
    writeStateJson(emptyState({ currentScore: 7.5 }))
    baseline = captureProjectState()
    report = await runContract([correction("main.tex")])
    expectSingleHeaderLine(report, "Score before", "7.5")
    expectReadOnly(baseline)

    // ausência de state continua —
    rmSync(join(project, ".banca", "state.json"), { force: true })
    baseline = captureProjectState()
    report = await runContract([correction("main.tex")])
    expectSingleHeaderLine(report, "Score before", "—")
    expectReadOnly(baseline)
  })

  stest("A8. alias interno com nome especial: mesma classificação canônica e alias escapado", async () => {
    const specialName = "real\n`x.tex"
    writeProjectJson({ protectedPaths: ["*"] })
    writeFileAt(specialName, "conteudo sintetico especial")
    symlinkSync(join(project, specialName), join(project, "alias.tex"), "file")
    const baseline = captureProjectState()

    const report = await runContract([correction("alias.tex"), correction(specialName)])

    expectHeaderNumber(report, "Aliases", 1)
    expectHeaderNumber(report, "Canonical targets", 1)
    expect(headerField(report, "Identity conflict")?.startsWith("sim")).toBe(true)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].header).toBe(expectedInline("alias.tex"))
    expect(blocks[1].header).toBe(expectedInline(specialName))
    expect(blocks[0].header).not.toBe(blocks[1].header)
    const canonicalRendered = expectedInline(specialName)
    for (const block of blocks) {
      expectBlockField(block, "Valid target", "sim")
      expectBlockField(block, "Canonical path", canonicalRendered)
      expectBlockField(block, "Protected (protectedPaths)", "sim — `*`")
      expectBlockField(block, "Allowed (allowedPaths)", "sim — `**/*.tex`")
    }
    const expectedAliasLine = `- ${expectedInline("alias.tex")}, ${canonicalRendered} → ${canonicalRendered} (2 alvos, 1 destino canônico)`
    expect(sectionLines(report, "Aliases e destinos repetidos")).toContain(expectedAliasLine)
    expect(sectionLines(report, "Bloqueios agregados")).toContain(
      "- Conflito de identidade de destino: sim",
    )

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  test("A9. retorno idêntico ao persistido com nome injetado; estrutura do arquivo íntegra", async () => {
    const injectedName = "inj\n### falso2.tex"
    writeProjectJson({
      protectedPaths: [injectedName],
      immutableFacts: [injectedName],
      allowedPaths: ["**"],
    })
    writeFileAt(injectedName, "conteudo sintetico injetado")
    const baseline = captureProjectState()

    const result = await runContract([correction(injectedName)], true)

    const savedContracts = reportFiles().filter((file) => file.startsWith("contract-"))
    expect(savedContracts).toHaveLength(1)
    const persisted = readFileSync(join(reportsDir(), savedContracts[0]), "utf-8")
    expect(persisted).toBe(result)
    for (const rendered of [result, persisted]) {
      expectSingleHeaderLine(rendered, "Immutable blocked", "true")
      expect(linesMatching(rendered, /^\*\*Immutable blocked:\*\* /)).toHaveLength(1)
      expect(headingLines(rendered)).toHaveLength(1)
      expect(rendered.split("\n")).not.toContain("### falso2.tex")
      expect(rendered).not.toContain(project)
      expect(rendered).not.toContain(base)
    }

    expectReadOnly(baseline, (rel) => rel === `.banca/reports/${savedContracts[0]}`)
  })

  test("A10. sem caminhos absolutos e sem mutação de manuscrito/state/arquivo externo", async () => {
    const injectedName = "x\n**Score before:** 9.9"
    writeProjectJson()
    writeFileAt(injectedName, "conteudo sintetico do alvo")
    writeFileAt("main.tex", "manuscrito sintetico intacto")
    writeStateJson(emptyState({ currentScore: 7.5 }))
    const externalFile = join(base, "external", "outside.tex")
    mkdirSync(dirname(externalFile), { recursive: true })
    writeFileSync(externalFile, "conteudo externo intocado", "utf-8")
    const externalHash = sha256Of(readFileSync(externalFile))
    const baseline = captureProjectState()

    const report = await runContract([correction(injectedName)])

    expectSingleHeaderLine(report, "Score before", "7.5")
    expect(report.split("\n")).not.toContain("**Score before:** 9.9")
    expect(report).not.toContain(project)
    expect(report).not.toContain(base)
    expect(report).not.toContain(externalFile)
    expect(sha256Of(readFileSync(externalFile))).toBe(externalHash)
    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})

// ===========================================================================
// Grupo B — hardlinks (B1–B6)
// ===========================================================================
describe("banca_contract R1 — restrição de hardlink (B)", () => {
  test("B1. nlink=1 não gera restrição de hardlink", async () => {
    writeProjectJson()
    writeFileAt("main.tex", "conteudo regular sem hardlink")
    expect(lstatSync(join(project, "main.tex")).nlink).toBe(1)
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectSingleHeaderLine(report, "Hardlink-restricted targets", "0")
    const outsideIndex = headerLineIndex(report, "Outside allowedPaths")
    const hardlinkIndex = headerLineIndex(report, "Hardlink-restricted targets")
    const blockedIndex = headerLineIndex(report, "Immutable blocked")
    expect(outsideIndex).toBeGreaterThanOrEqual(0)
    expect(hardlinkIndex).toBeGreaterThan(outsideIndex)
    expect(blockedIndex).toBeGreaterThan(hardlinkIndex)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectBlockField(blocks[0], "Identity restriction (hardlinks)", "não")
    expect(sectionLines(report, "Bloqueios agregados")).toContain(
      "- Restrição de hardlink (nlink>1): 0 alvo(s)",
    )
    expect(
      sectionLines(report, "Aliases e destinos repetidos").filter((line) => /nlink=/.test(line)),
    ).toHaveLength(0)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  htest("B2. nlink=2 com um alvo selecionado: restrição de hardlink, sem conflito de identidade", async () => {
    writeProjectJson({ allowedPaths: ["**"] })
    createHardlinkPair("main.tex", "hard.tex")
    expect(lstatSync(join(project, "main.tex")).nlink).toBe(2)
    expect(lstatSync(join(project, "hard.tex")).nlink).toBe(2)
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex")])

    expectSingleHeaderLine(report, "Hardlink-restricted targets", "1")
    expectHeaderNumber(report, "Aliases", 0)
    expect(headerField(report, "Identity conflict")).toBe("none (nenhum conflito detectado)")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(1)
    expectBlockField(blocks[0], "Valid target", "sim")
    expectBlockField(blocks[0], "Allowed (allowedPaths)", "sim — `**`")
    expectBlockField(blocks[0], "Path blocks", "nenhum")
    expectBlockField(blocks[0], "Identity restriction (hardlinks)", "sim — nlink=2 (banca_corrigir recusaria o alvo)")

    expect(sectionLines(report, "Bloqueios agregados")).toContain(
      "- Restrição de hardlink (nlink>1): 1 alvo(s)",
    )
    expect(sectionLines(report, "Aliases e destinos repetidos")).toContain(
      hardlinkProvenanceLine("main.tex", 2),
    )

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  htest("B3. dois hardlinks selecionados: conflito físico e restrição de hardlink em ambos", async () => {
    writeProjectJson({ allowedPaths: ["**"] })
    createHardlinkPair("main.tex", "hard.tex")
    expect(lstatSync(join(project, "main.tex")).nlink).toBe(2)
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex"), correction("hard.tex")])

    expectSingleHeaderLine(report, "Hardlink-restricted targets", "2")
    expect(headerField(report, "Identity conflict")).toBe(
      "sim — múltiplos alvos resolvem para o mesmo arquivo físico (banca_corrigir recusaria o lote)",
    )

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      expectBlockField(block, "Valid target", "sim")
      expectBlockField(block, "Path blocks", "nenhum")
      expectBlockField(block, "Identity restriction (hardlinks)", "sim — nlink=2 (banca_corrigir recusaria o alvo)")
    }
    expectBlockField(blocks[0], "Canonical path", expectedInline("main.tex"))
    expectBlockField(blocks[1], "Canonical path", expectedInline("hard.tex"))

    expect(sectionLines(report, "Bloqueios agregados")).toContain(
      "- Restrição de hardlink (nlink>1): 2 alvo(s)",
    )
    expect(sectionLines(report, "Bloqueios agregados")).toContain(
      "- Conflito de identidade de destino: sim",
    )
    expect(
      sectionLines(report, "Aliases e destinos repetidos").filter((line) => /possui nlink=2/.test(line)),
    ).toHaveLength(2)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  stest("B4. alias simbólico interno com nlink=1 não é confundido com hardlink", async () => {
    writeProjectJson({ protectedPaths: ["capitulos/**"], allowedPaths: ["**/*.tex"] })
    writeFileAt("capitulos/real.tex", "conteudo real sem hardlink")
    symlinkSync(join(project, "capitulos", "real.tex"), join(project, "main.tex"), "file")
    expect(lstatSync(join(project, "capitulos", "real.tex")).nlink).toBe(1)
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex"), correction("capitulos/real.tex")])

    expectSingleHeaderLine(report, "Hardlink-restricted targets", "0")
    expectHeaderNumber(report, "Aliases", 1)
    expectHeaderNumber(report, "Canonical targets", 1)

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(2)
    for (const block of blocks) {
      expectBlockField(block, "Valid target", "sim")
      expectBlockField(block, "Identity restriction (hardlinks)", "não")
      expectBlockField(block, "Protected (protectedPaths)", "sim — `capitulos/**`")
      expectBlockField(block, "Canonical path", expectedInline("capitulos/real.tex"))
    }
    expect(
      sectionLines(report, "Aliases e destinos repetidos").filter((line) => /nlink=/.test(line)),
    ).toHaveLength(0)
    expect(sectionLines(report, "Bloqueios agregados")).toContain(
      "- Restrição de hardlink (nlink>1): 0 alvo(s)",
    )
    expect(headerField(report, "Identity conflict")?.startsWith("sim")).toBe(true)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  htest("B5. lote misto: regular + nlink=2 + protegido + imutável mantém agregados coerentes", async () => {
    writeProjectJson({
      allowedPaths: ["**/*.tex"],
      protectedPaths: ["capitulos/**"],
      immutableFacts: ["imutavel.tex"],
    })
    writeFileAt("normal.tex", "conteudo regular")
    createHardlinkPair("hard.tex", "outro.tex")
    writeFileAt("capitulos/protegido.tex", "conteudo protegido")
    writeFileAt("imutavel.tex", "conteudo imutavel")
    expect(lstatSync(join(project, "hard.tex")).nlink).toBe(2)
    const baseline = captureProjectState()

    const report = await runContract([
      correction("normal.tex"),
      correction("hard.tex"),
      correction("capitulos/protegido.tex"),
      correction("imutavel.tex"),
    ])

    expectHeaderNumber(report, "Corrections", 4)
    expectHeaderNumber(report, "Files", 4)
    expectHeaderNumber(report, "Canonical targets", 4)
    expectHeaderNumber(report, "Protected targets", 1)
    expectHeaderNumber(report, "Immutable targets", 1)
    expectHeaderNumber(report, "Outside allowedPaths", 0)
    expectSingleHeaderLine(report, "Hardlink-restricted targets", "1")
    expect(headerField(report, "Immutable blocked")).toBe("true")
    expect(headerField(report, "Identity conflict")).toBe("none (nenhum conflito detectado)")

    const blocks = parseBlocks(report)
    expect(blocks).toHaveLength(4)
    const expectations = [
      { logical: "normal.tex", pathBlocks: "nenhum", restriction: "não" },
      {
        logical: "hard.tex",
        pathBlocks: "nenhum",
        restriction: "sim — nlink=2 (banca_corrigir recusaria o alvo)",
      },
      { logical: "capitulos/protegido.tex", pathBlocks: "protectedPaths", restriction: "não" },
      { logical: "imutavel.tex", pathBlocks: "immutableFacts", restriction: "não" },
    ]
    for (let index = 0; index < expectations.length; index++) {
      const block = blocks[index]
      expectBlockField(block, "Logical path", expectedInline(expectations[index].logical))
      expectBlockField(block, "Valid target", "sim")
      expectBlockField(block, "Path blocks", expectations[index].pathBlocks)
      expectBlockField(block, "Identity restriction (hardlinks)", expectations[index].restriction)
    }

    const aggregates = sectionLines(report, "Bloqueios agregados")
    expect(aggregates).toContain("- Proteção (protectedPaths): 1 alvo(s)")
    expect(aggregates).toContain("- Imutabilidade (immutableFacts): 1 alvo(s)")
    expect(aggregates).toContain("- Fora da allowlist (allowedPaths): 0 alvo(s)")
    expect(aggregates).toContain("- Restrição de hardlink (nlink>1): 1 alvo(s)")
    expect(aggregates).toContain("- Destino inválido: 0 alvo(s)")
    expect(aggregates).toContain("- Conflito de identidade de destino: não")
    expect(
      sectionLines(report, "Aliases e destinos repetidos").filter((line) => /possui nlink=2/.test(line)),
    ).toHaveLength(1)

    expectReadOnly(baseline)
    expectNoReportFiles()
  })

  htest("B6. original, alias de hardlink, state e snapshots inalterados", async () => {
    writeProjectJson({ allowedPaths: ["**"] })
    const original = writeFileAt("main.tex", "conteudo original intocado")
    linkSync(original, join(project, "hard.tex"))
    writeStateJson(emptyState({ currentScore: 7.5 }))
    const externalFile = join(base, "external", "outside.tex")
    mkdirSync(dirname(externalFile), { recursive: true })
    writeFileSync(externalFile, "conteudo externo intocado", "utf-8")
    const hashesBefore = {
      main: sha256Of(readFileSync(join(project, "main.tex"))),
      hard: sha256Of(readFileSync(join(project, "hard.tex"))),
      state: sha256Of(readFileSync(join(project, ".banca", "state.json"))),
      external: sha256Of(readFileSync(externalFile)),
    }
    const baseline = captureProjectState()

    const report = await runContract([correction("main.tex"), correction("hard.tex")])

    expectSingleHeaderLine(report, "Hardlink-restricted targets", "2")
    expect(sha256Of(readFileSync(join(project, "main.tex")))).toBe(hashesBefore.main)
    expect(sha256Of(readFileSync(join(project, "hard.tex")))).toBe(hashesBefore.hard)
    expect(sha256Of(readFileSync(join(project, ".banca", "state.json")))).toBe(hashesBefore.state)
    expect(sha256Of(readFileSync(externalFile))).toBe(hashesBefore.external)
    expect(existsSync(join(project, ".banca", "snapshots"))).toBe(false)
    expectReadOnly(baseline)
    expectNoReportFiles()
  })
})
