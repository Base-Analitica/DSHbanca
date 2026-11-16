import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { installAssets } from "../src/lib/install_assets"
import { canonicalNativeSkills } from "../scripts/lib/dsh-profile-e2e-contract"

/**
 * Issue #124 — fail-closed contract for reference instructions.
 *
 * These are static parity/contract regressions only. They prove the canonical
 * skill, the legacy mirror, the installable `banca-fontes` asset and the
 * installer fallback payload agree on the same fail-closed behavior. They do
 * NOT prove host discovery, loading or dispatch; that requires the native DSH
 * E2E gate on the final SHA.
 */

const repoRoot = join(__dirname, "..")
const canonicalSkillPath = join(repoRoot, "skills", "banca-referencias", "SKILL.md")
const mirrorSkillPath = join(repoRoot, "assets", "dsh", "skills", "banca-referencias", "SKILL.md")
const agentAssetPath = join(repoRoot, "assets", "dsh", "agents", "banca-fontes.md")

/** Frontmatter/body split identical to `src/dsh.ts` `parseFrontmatter`. */
function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  if (!text.startsWith("---")) throw new Error("missing frontmatter opening delimiter")
  const end = text.indexOf("\n---", 3)
  if (end === -1) throw new Error("missing frontmatter closing delimiter")
  return {
    frontmatter: text.slice(3, end),
    body: text.slice(end + 4).replace(/^\n+/, ""),
  }
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").trim()
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

interface DriftPair {
  readonly label: string
  readonly expected: string
  readonly actual: string
}

/**
 * Pure drift detector used by the positive and negative cases below. Real
 * artifacts must produce no findings; a tampered pair must be reported with its
 * label so a silently divergent copy can never pass.
 */
function findDrift(pairs: readonly DriftPair[]): string[] {
  return pairs
    .filter((pair) => normalizeText(pair.expected) !== normalizeText(pair.actual))
    .map((pair) => pair.label)
}

/** Legacy false promises removed by issue #124; none may survive in a body. */
const REMOVED_SKILL_PROMISES = [
  "tentar validação contra bases de dados externas",
  "chamar MCP",
  "certidão formal de validação",
  "Certidão de Fontes",
  "score geral de saúde",
  "Atua diretamente no Scorecard",
  "baseando as penalidades",
  "Depende de conectividade",
  "A referência assume estado \"Suspeita\"",
  "encontrada, não encontrada, ou suspeita",
] as const

const REMOVED_AGENT_PROMISES = [
  "chamar MCP acadêmico",
  "Depende de MCPs",
  "Calcular score de confiança (0-100)",
  "Reportar referências não encontradas ou suspeitas",
] as const

/** Transport/network primitives that must never appear as an instruction. */
const FORBIDDEN_TRANSPORTS = ["https://", "http://", "child_process", "spawn(", "fetch("] as const

function expectNoPromises(body: string, removed: readonly string[]): void {
  for (const phrase of removed) {
    expect(body.toLowerCase()).not.toContain(phrase.toLowerCase())
  }
}

function expectNoTransportPrimitives(body: string): void {
  for (const token of FORBIDDEN_TRANSPORTS) {
    expect(body).not.toContain(token)
  }
}

describe("banca-referencias instruction contract (#124)", () => {
  test("canonical skill keeps its discovery frontmatter (name, description, no permission drift)", () => {
    const skill = splitFrontmatter(readFileSync(canonicalSkillPath, "utf8"))
    const frontmatter = parseYaml(skill.frontmatter) as Record<string, unknown>

    expect(Object.keys(frontmatter).sort()).toEqual(["description", "name"])
    expect(frontmatter.name).toBe("banca-referencias")
    expect(typeof frontmatter.description).toBe("string")
    expect((frontmatter.description as string).trim().length).toBeGreaterThan(0)
  })

  test("canonical skill body states only the fail-closed local cache contract", () => {
    const { body } = splitFrontmatter(readFileSync(canonicalSkillPath, "utf8"))

    expectNoPromises(body, REMOVED_SKILL_PROMISES)
    expectNoTransportPrimitives(body)

    // The contract the tool actually implements must be discoverable in the body.
    expect(body).toContain("tudo-ou-nada")
    expect(body).toContain("cache positivo")
    expect(body).toContain("external_transport_blocked")
    expect(body).toContain("bloqueada")
    expect(body).toContain("N/A")
    expect(body).toContain("provider")
    // Blocked evidence is not inexistence and does not modify the rubric.
    expect(body.toLowerCase()).toContain("não altera rubrica")
  })

  test("legacy mirror is byte-identical to the canonical skill", () => {
    const canonical = readFileSync(canonicalSkillPath)
    const mirror = readFileSync(mirrorSkillPath)

    expect(mirror.equals(canonical)).toBe(true)
    expect(sha256(mirror.toString("utf8"))).toBe(sha256(canonical.toString("utf8")))
  })

  test("banca-fontes asset keeps subagent mode and read-only-compatible permissions", () => {
    const agent = splitFrontmatter(readFileSync(agentAssetPath, "utf8"))
    const frontmatter = parseYaml(agent.frontmatter) as Record<string, unknown>

    expect(Object.keys(frontmatter).sort()).toEqual(["description", "mode", "permission"])
    expect(frontmatter.mode).toBe("subagent")
    expect(typeof frontmatter.description).toBe("string")
    expect((frontmatter.description as string).trim().length).toBeGreaterThan(0)

    // Trust-model guard: the permission map must not be widened or reshaped.
    expect(frontmatter.permission).toEqual({
      "*": "deny",
      skill: { "*": "deny", "banca-referencias": "allow" },
      banca_refs: "allow",
      banca_context: "allow",
    })
  })

  test("banca-fontes asset body states only the fail-closed local cache contract", () => {
    const { body } = splitFrontmatter(readFileSync(agentAssetPath, "utf8"))

    expectNoPromises(body, REMOVED_AGENT_PROMISES)
    expectNoTransportPrimitives(body)

    expect(body).toContain("tudo-ou-nada")
    expect(body).toContain("cache positivo")
    expect(body).toContain("external_transport_blocked")
    expect(body).toContain("bloqueada")
  })

  test("installer fallback payload matches the installable banca-fontes asset", () => {
    const workspace = mkdtempSync(join(tmpdir(), "dshbanca-refs-contract-"))
    try {
      installAssets(workspace, true, join(workspace, "missing-assets-dir"))
      const installed = readFileSync(join(workspace, ".dsh", "agents", "banca-fontes.md"), "utf8")
      const asset = readFileSync(agentAssetPath, "utf8")

      expect(findDrift([{ label: "installerPayload", expected: asset, actual: installed }])).toEqual([])
      // The fallback must carry the reconciled body, not the historical payload.
      expectNoPromises(installed, REMOVED_AGENT_PROMISES)
      expect(installed).toContain("external_transport_blocked")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("negative drift detector rejects tampered mirror and payload copies", () => {
    const canonical = readFileSync(canonicalSkillPath, "utf8")
    const mirror = readFileSync(mirrorSkillPath, "utf8")
    const asset = readFileSync(agentAssetPath, "utf8")

    expect(findDrift([
      { label: "mirror", expected: canonical, actual: mirror },
      { label: "installerPayload", expected: asset, actual: asset },
    ])).toEqual([])

    expect(findDrift([
      { label: "mirror", expected: canonical, actual: `${canonical}\nlegacy external search` },
    ])).toEqual(["mirror"])

    expect(findDrift([
      { label: "installerPayload", expected: asset, actual: `${asset}\nlegacy MCP lookup` },
    ])).toEqual(["installerPayload"])

    // Byte-identical parity is stricter than normalized drift detection.
    expect(Buffer.from(`${canonical}\n`).equals(Buffer.from(mirror))).toBe(false)
  })

  test("E2E canonical skill pins match the reconciled artifact", () => {
    const source = readFileSync(canonicalSkillPath, "utf8")
    const { body } = splitFrontmatter(source)
    const canonical = canonicalNativeSkills["banca-referencias"]

    expect(canonical.sourcePath).toBe("skills/banca-referencias/SKILL.md")
    expect(canonical.sourceSha256).toBe(sha256(source))
    expect(canonical.bodySha256).toBe(sha256(body))
    // The contract pins UTF-16 string length (not Buffer.byteLength).
    expect(canonical.bodyLength).toBe(body.length)
  })
})
