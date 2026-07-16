/**
 * Deterministic checks for issue #86: banca-auditor + banca-avaliacao
 * exhaustive batch workflow contracts (versioned assets vs install fallback).
 */
import { expect, test, describe, afterEach } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installAssets } from "../src/lib/install_assets"

const AGENT_REL = join(".opencode", "agents", "banca-auditor.md")
const SKILL_REL = join(".opencode", "skills", "banca-avaliacao", "SKILL.md")

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
] as const

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n")
}

function readInstalled(root: string, rel: string): string {
  return normalize(readFileSync(join(root, rel), "utf-8"))
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

describe("audit workflow assets (#86)", () => {
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
        join(process.cwd(), "assets", "opencode", "agents", "banca-auditor.md"),
        "utf-8",
      ),
    )
    const sourceSkill = normalize(
      readFileSync(
        join(
          process.cwd(),
          "assets",
          "opencode",
          "skills",
          "banca-avaliacao",
          "SKILL.md",
        ),
        "utf-8",
      ),
    )
    expect(versionedAgent).toBe(sourceAgent)
    expect(versionedSkill).toBe(sourceSkill)
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
})
