/**
 * Deterministic checks for audit workflow assets:
 * - #86: banca-auditor + banca-avaliacao exhaustive batch workflow
 * - #90: post-banca_sintese global academic synthesis protocol
 */
import { expect, test, describe, afterEach } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installAssets } from "../src/lib/install_assets"

const AGENT_REL = join(".dsh", "agents", "banca-auditor.md")
const LOADER_AGENT_REL = "banca-auditor.md"
const SKILL_REL = join(".dsh", "skills", "banca-avaliacao", "SKILL.md")

const BANNED_PHRASES = [
  "nota final",
  "APROVADO",
  "REPROVADO",
  "delegar ao integrador",
  "nota máxima",
  "peso 3",
  "peso 2",
] as const

/** Protocol steps that must appear in logical order in agent and skill bodies. */
const PROTOCOL_ORDER_BLOCK = [
  "banca_context",
  "read do caminho retornado",
  "banca_auditar",
  "banca_context com completedBatchId",
  "read do caminho retornado",
  "banca_sintese",
  "síntese acadêmica global",
] as const

/** Six mandatory global synthesis section titles (skill + agent). */
const GLOBAL_SECTIONS = [
  "Síntese global do manuscrito",
  "Contradições ou tensões entre seções",
  "Coerência entre objetivos, método, resultados e conclusão",
  "Lacunas globais de argumentação ou evidência",
  "Redundâncias e inconsistências recorrentes",
  "Prioridades de revisão",
] as const

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n")
}

function readInstalled(root: string, rel: string): string {
  return normalize(readFileSync(join(root, rel), "utf-8"))
}

function projectInventory(root: string): Record<string, string> {
  const inventory: Record<string, string> = {}
  const walk = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path, rel)
      else inventory[rel] = entry.isFile() ? readFileSync(path, "utf8") : "<non-regular>"
    }
  }
  walk(root)
  return inventory
}

function parseFrontmatter(md: string): string {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error("missing frontmatter")
  return match[1]
}

/**
 * Case-insensitive banned-phrase detector.
 * Escapes regex metacharacters so the contract remains exact-phrase matching
 * (not free-form pattern expansion), while ignoring case.
 * Returns the first banned phrase found, or null.
 */
function findBannedPhrase(content: string): string | null {
  for (const phrase of BANNED_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(escaped, "i").test(content)) return phrase
  }
  return null
}

function assertNoBannedPhrases(label: string, content: string) {
  const hit = findBannedPhrase(content)
  expect(hit, `${label} must not contain banned phrase (found: ${hit})`).toBeNull()
}

function assertProtocolOrder(body: string, label: string) {
  let cursor = 0
  for (const marker of PROTOCOL_ORDER_BLOCK) {
    const idx = body.indexOf(marker, cursor)
    expect(
      idx,
      `${label} must contain "${marker}" after previous protocol markers`,
    ).toBeGreaterThanOrEqual(0)
    cursor = idx + marker.length
  }
}

function assertAgentPermissions(frontmatter: string) {
  // Root deny-by-default under permission: (YAML structure + indentation).
  expect(frontmatter).toMatch(/permission:\s*\n\s{2}"\*": deny/)

  // read is granular: deny catch-all, allow only context packs.
  expect(frontmatter).toMatch(
    /read:\s*\n\s{4}"\*": deny\s*\n\s{4}"\.banca\/context\/context-\*\.md": allow/,
  )
  // Must not grant generic read
  expect(frontmatter).not.toMatch(/^read:\s*allow\s*$/m)
  expect(frontmatter).not.toMatch(/read:\s*\n\s{4}"\*": allow/)

  expect(frontmatter).toContain("banca_context: allow")
  expect(frontmatter).toContain("banca_auditar: allow")
  expect(frontmatter).toContain("banca_sintese: allow")
  expect(frontmatter).toContain("banca-avaliacao: allow")

  // Forbidden capabilities
  for (const tool of [
    "bash",
    "edit",
    "write",
    "glob",
    "grep",
    "list",
    "task",
    "shell",
  ]) {
    expect(frontmatter).not.toMatch(new RegExp(`${tool}:\\s*allow`))
  }
}

describe("audit workflow assets (#86 / #90)", () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  function tempProject(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix))
    roots.push(root)
    return root
  }

  test("versioned install and fallback install produce equivalent agent and skill", () => {
    const versionedRoot = tempProject("audit-wf-versioned-")
    const fallbackRoot = tempProject("audit-wf-fallback-")
    const missingAssets = join(fallbackRoot, "assets-do-not-exist")

    const versionedInstalled = installAssets(versionedRoot, true)
    const fallbackInstalled = installAssets(fallbackRoot, true, missingAssets)

    expect(versionedInstalled.length).toBeGreaterThan(0)
    expect(fallbackInstalled.length).toBeGreaterThan(0)

    expect(existsSync(join(versionedRoot, AGENT_REL))).toBe(true)
    expect(existsSync(join(versionedRoot, SKILL_REL))).toBe(true)
    expect(existsSync(join(fallbackRoot, AGENT_REL))).toBe(true)
    expect(existsSync(join(fallbackRoot, SKILL_REL))).toBe(true)

    const versionedAgent = readInstalled(versionedRoot, AGENT_REL)
    const fallbackAgent = readInstalled(fallbackRoot, AGENT_REL)
    const versionedSkill = readInstalled(versionedRoot, SKILL_REL)
    const fallbackSkill = readInstalled(fallbackRoot, SKILL_REL)

    expect(fallbackAgent).toBe(versionedAgent)
    expect(fallbackSkill).toBe(versionedSkill)

    // Prefer byte-identity with repo sources as well.
    const sourceAgent = normalize(
      readFileSync(
        join(process.cwd(), "assets", "dsh", "agents", "banca-auditor.md"),
        "utf-8",
      ),
    )
    const sourceSkill = normalize(
      readFileSync(
        join(
          process.cwd(),
          "assets",
          "dsh",
          "skills",
          "banca-avaliacao",
          "SKILL.md",
        ),
        "utf-8",
      ),
    )
    expect(versionedAgent).toBe(sourceAgent)
    expect(versionedSkill).toBe(sourceSkill)
    expect(readInstalled(versionedRoot, LOADER_AGENT_REL)).toBe(sourceAgent)
    expect(readInstalled(fallbackRoot, LOADER_AGENT_REL)).toBe(sourceAgent)
    expect(lstatSync(join(versionedRoot, LOADER_AGENT_REL)).isFile()).toBe(true)
  })

  test("refuses to overwrite a pre-existing root auditor file", () => {
    const root = tempProject("audit-wf-root-collision-")
    const destination = join(root, LOADER_AGENT_REL)
    writeFileSync(destination, "user-owned content\n")

    const before = projectInventory(root)
    expect(() => installAssets(root, true)).toThrow(/loader banca-auditor instructions differ from the canonical source/)
    expect(readFileSync(destination, "utf8")).toBe("user-owned content\n")
    expect(projectInventory(root)).toEqual(before)
  })

  test("refuses a root auditor symlink", () => {
    const root = tempProject("audit-wf-root-symlink-")
    const external = tempProject("audit-wf-root-symlink-target-")
    const destination = join(root, LOADER_AGENT_REL)
    const target = join(external, "instructions.md")
    writeFileSync(target, "outside\n")
    symlinkSync(target, destination)

    expect(() => installAssets(root, true)).toThrow()
    expect(readFileSync(target, "utf8")).toBe("outside\n")
  })

  test("refuses a non-file root auditor destination before changing the workspace", () => {
    const root = tempProject("audit-wf-root-special-")
    const destination = join(root, LOADER_AGENT_REL)
    mkdirSync(destination)
    writeFileSync(join(destination, "user-data.txt"), "preserve\n")
    const before = projectInventory(root)

    expect(() => installAssets(root, true)).toThrow(/loader banca-auditor instructions must be a regular file/)
    expect(projectInventory(root)).toEqual(before)
  })

  test("identifies stale root copies without silently replacing them", () => {
    const root = tempProject("audit-wf-root-stale-")
    const destination = join(root, LOADER_AGENT_REL)
    writeFileSync(destination, "stale workspace content\n")

    expect(() => installAssets(root, true)).toThrow(/loader banca-auditor instructions differ from the canonical source/)
    expect(readFileSync(destination, "utf8")).toBe("stale workspace content\n")
  })

  test("detects a stale legacy installation before deriving the loader copy", () => {
    const root = tempProject("audit-wf-legacy-stale-")
    const legacyPath = join(root, AGENT_REL)
    mkdirSync(join(root, ".dsh", "agents"), { recursive: true })
    writeFileSync(legacyPath, "stale legacy content\n")

    expect(() => installAssets(root, false)).toThrow(/installed banca-auditor instructions differ from the canonical source/)
    expect(readFileSync(legacyPath, "utf8")).toBe("stale legacy content\n")
    expect(existsSync(join(root, LOADER_AGENT_REL))).toBe(false)
  })

  test("rejects a symlinked legacy asset before any copy can follow it", () => {
    const root = tempProject("audit-wf-legacy-symlink-")
    const external = tempProject("audit-wf-legacy-target-")
    const legacyPath = join(root, AGENT_REL)
    const target = join(external, "instructions.md")
    mkdirSync(join(root, ".dsh", "agents"), { recursive: true })
    writeFileSync(target, "external content\n")
    symlinkSync(target, legacyPath)

    expect(() => installAssets(root, true)).toThrow(/must be a regular file/)
    expect(readFileSync(target, "utf8")).toBe("external content\n")
    expect(existsSync(join(root, LOADER_AGENT_REL))).toBe(false)
  })

  test("agent frontmatter is deny-by-default with path-limited read", () => {
    const root = tempProject("audit-wf-agent-perm-")
    installAssets(root, true)
    const agent = readInstalled(root, AGENT_REL)
    const fm = parseFrontmatter(agent)
    assertAgentPermissions(fm)
    // Fallback path must match
    const fallbackRoot = tempProject("audit-wf-agent-perm-fb-")
    installAssets(fallbackRoot, true, join(fallbackRoot, "no-assets"))
    const fallbackFm = parseFrontmatter(readInstalled(fallbackRoot, AGENT_REL))
    assertAgentPermissions(fallbackFm)
  })

  test("skill and agent describe context→read→audit→advance→read→synthesis order", () => {
    const root = tempProject("audit-wf-protocol-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)
    assertProtocolOrder(skill, "skill")
    assertProtocolOrder(agent, "agent")

    // Explicit instruction: read after every successful banca_context
    expect(skill).toMatch(/após \*\*cada\*\* chamada bem-sucedida de `banca_context`/i)
    expect(skill).toMatch(/ferramenta nativa `read`/i)
    expect(skill).toMatch(/caminho exato retornado/i)
    expect(skill).toMatch(/Não ler o manuscrito diretamente/i)
    expect(agent).toMatch(/ferramenta nativa `read`/i)
    expect(agent).toMatch(/caminho exato retornado/i)

    // Synthesis only after complete coverage — gate language present.
    expect(skill.toLowerCase()).toMatch(/cobertura completa|checkpoint completo/)
    expect(skill).toContain("banca_sintese")
    expect(skill).toMatch(/somente|apenas/)
    expect(skill).toMatch(/completedBatchId/)
    expect(skill).toMatch(/array vazio|findings/)

    // Advance only after successful audit
    expect(skill).toMatch(
      /após recibo bem-sucedido|somente.*banca_auditar|banca_auditar[\s\S]{0,200}avanç/i,
    )

    // banca_sintese remains after full batch completion (gate before global synthesis)
    const sinteseIdxSkill = skill.indexOf("banca_sintese somente após cobertura completa")
    const globalIdxSkill = skill.indexOf(
      "síntese acadêmica global após retorno bem-sucedido de banca_sintese",
    )
    expect(sinteseIdxSkill).toBeGreaterThanOrEqual(0)
    expect(globalIdxSkill).toBeGreaterThan(sinteseIdxSkill)

    const sinteseIdxAgent = agent.indexOf("banca_sintese somente após cobertura completa")
    const globalIdxAgent = agent.indexOf(
      "síntese acadêmica global após retorno bem-sucedido de banca_sintese",
    )
    expect(sinteseIdxAgent).toBeGreaterThanOrEqual(0)
    expect(globalIdxAgent).toBeGreaterThan(sinteseIdxAgent)
  })

  test("findings provenance fields are required by the skill contract", () => {
    const root = tempProject("audit-wf-findings-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    for (const field of [
      "categoria",
      "severidade",
      "claim",
      "evidence",
      "arquivo público relativo",
      "linhas inicial e final",
      "sectionId",
    ]) {
      expect(skill.includes(field), `missing finding field guidance: ${field}`).toBe(
        true,
      )
    }
    expect(skill).toMatch(/Não invente arquivo|não invente arquivo/i)
    expect(skill).toMatch(/fora de `banca_auditar`|fora de banca_auditar/)
  })

  test("banned scoring / integrador contract phrases are absent (case-insensitive)", () => {
    const root = tempProject("audit-wf-banned-")
    const fallbackRoot = tempProject("audit-wf-banned-fb-")
    installAssets(root, true)
    installAssets(fallbackRoot, true, join(fallbackRoot, "missing-assets-dir"))

    for (const [label, content] of [
      ["versioned agent", readInstalled(root, AGENT_REL)],
      ["versioned skill", readInstalled(root, SKILL_REL)],
      ["fallback agent", readInstalled(fallbackRoot, AGENT_REL)],
      ["fallback skill", readInstalled(fallbackRoot, SKILL_REL)],
    ] as const) {
      assertNoBannedPhrases(label, content)
    }

    // Sanity: case-insensitive detector catches variant casing
    expect(findBannedPhrase("x Nota Final y")).toBe("nota final")
    expect(findBannedPhrase("status APROVADO")).toBe("APROVADO")
    expect(findBannedPhrase("clean contract text")).toBeNull()
  })

  test("failure stops flow without global opinion language in contracts", () => {
    const root = tempProject("audit-wf-stop-")
    installAssets(root, true)
    const agent = readInstalled(root, AGENT_REL)
    const skill = readInstalled(root, SKILL_REL)
    for (const content of [agent, skill]) {
      expect(content).toMatch(/interromper/i)
      expect(content).toMatch(/fingerprint/i)
      expect(content).toMatch(/plano bloqueado|cobertura incompleta/i)
    }
  })

  test("global synthesis requires six sections after successful banca_sintese", () => {
    const root = tempProject("audit-wf-global-sections-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)

    for (const content of [skill, agent]) {
      let cursor = 0
      for (const section of GLOBAL_SECTIONS) {
        const idx = content.indexOf(section, cursor)
        expect(
          idx,
          `missing or out-of-order global section "${section}"`,
        ).toBeGreaterThanOrEqual(0)
        cursor = idx + section.length
      }
    }

    // Explicit post-success synthesis step (not mere tool return)
    expect(skill).toMatch(
      /após `banca_sintese` retornar com sucesso|após o retorno bem-sucedido de `banca_sintese`/i,
    )
    expect(agent).toMatch(
      /após `banca_sintese` retornar com sucesso|após o retorno bem-sucedido de `banca_sintese`/i,
    )
    expect(skill).toMatch(/relacionando findings de lotes diferentes/i)
    expect(agent).toMatch(/relacionando findings de lotes diferentes/i)
  })

  test("global conclusions require findingId and provenance", () => {
    const root = tempProject("audit-wf-global-prov-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)

    for (const content of [skill, agent]) {
      expect(content).toContain("findingId")
      expect(content).toMatch(/arquivo/i)
      expect(content).toMatch(/linhas/i)
      expect(content).toMatch(/seção|secao/i)
      expect(content).toMatch(/claim ou evidence/i)
      expect(content).toMatch(
        /dois ou mais findings|múltiplos findings|multiplos findings/i,
      )
    }
  })

  test("global observations are not presented as persisted findings", () => {
    const root = tempProject("audit-wf-global-obs-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)

    for (const content of [skill, agent]) {
      expect(content).toMatch(
        /\*{0,2}não\*{0,2}\s+cria silenciosamente novos findings persistidos/i,
      )
      expect(content).toMatch(/observação global que requer revisão humana/i)
      expect(content).toMatch(
        /Findings locais são criados e persistidos.*banca_auditar|criados e persistidos.*somente.*banca_auditar/i,
      )
    }
  })

  test("score, approval and rejection remain prohibited in synthesis path", () => {
    const root = tempProject("audit-wf-no-score-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)

    for (const content of [skill, agent]) {
      // Prohibition language must remain (terms appear only in bans)
      expect(content).toMatch(/não.*pontua|sem.*pontua|Não calcula pontuação/i)
      expect(content).toMatch(/aprovação/i)
      expect(content).toMatch(/reprovação/i)
      // No positive scoring/approval framing as product outcome
      expect(content).not.toMatch(/calcule a nota|emitir nota|nota de 0 a 10/i)
      expect(content).not.toMatch(/\bAPROVADO\b/)
      expect(content).not.toMatch(/\bREPROVADO\b/)
      expect(content).toMatch(/previsão de banca|nota acadêmica/i)
    }
  })

  test("error or incomplete coverage blocks integral synthesis", () => {
    const root = tempProject("audit-wf-fail-closed-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)

    for (const content of [skill, agent]) {
      expect(content).toMatch(/cobertura incompleta/i)
      expect(content).toMatch(
        /contrato inválido|dados insuficientes|fingerprint incompatível/i,
      )
      expect(content).toMatch(/parecer integral/i)
      expect(content).toMatch(/interromper/i)
      expect(content).toMatch(
        /não.*síntese integral|sem.*parecer integral|sem gerar.*parecer integral/i,
      )
    }

    // Skill explicitly blocks integral synthesis on banca_sintese failure
    expect(skill).toMatch(
      /Se `banca_sintese` retornar erro|falha de `banca_sintese`|Em falha de `banca_sintese`/i,
    )
    expect(skill).toMatch(/síntese integral/i)
  })

  test("agent permissions remain unchanged and restricted (no new tools)", () => {
    const root = tempProject("audit-wf-perm-stable-")
    installAssets(root, true)
    const fm = parseFrontmatter(readInstalled(root, AGENT_REL))
    assertAgentPermissions(fm)

    // mode: subagent preserved
    expect(fm).toMatch(/mode:\s*subagent/)

    // Only the known academic tools + skill + restricted read
    const allowedToolLines = fm
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /:\s*allow\s*$/.test(l))
    const allowed = allowedToolLines.map((l) => l.replace(/:\s*allow\s*$/, ""))
    expect(allowed.sort()).toEqual(
      [
        "banca-avaliacao",
        '".banca/context/context-*.md"',
        "banca_context",
        "banca_auditar",
        "banca_sintese",
      ].sort(),
    )
  })

  test("mere structured pass-through of banca_sintese is not sufficient final behavior", () => {
    const root = tempProject("audit-wf-no-pass-through-")
    installAssets(root, true)
    const skill = readInstalled(root, SKILL_REL)
    const agent = readInstalled(root, AGENT_REL)

    // Old final behavior wording must not remain as the complete post-success instruction
    expect(skill).not.toContain(
      "Após síntese bem-sucedida: repasse estruturado da entrada de síntese retornada por `banca_sintese`",
    )

    // Explicit negative: pass-through alone is insufficient (exact contract phrases)
    for (const content of [skill, agent]) {
      const lower = content.toLowerCase()
      expect(lower).toContain("mero repasse estruturado")
      expect(content).toContain("**não** é comportamento final suficiente")
    }
    // Skill-only complementary wording
    expect(skill.toLowerCase()).toContain("não basta repassar")

    // Positive: relational analysis is required (exact phrases from assets)
    expect(skill).toContain("análise relacional")
    expect(skill).toContain("relaciona findings já validados")
    expect(agent).toContain("relacionar os findings validados")
    expect(agent).toContain("relacionando findings")
  })
})
