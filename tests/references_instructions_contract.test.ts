import { describe, expect, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { installAssets } from "../src/lib/install_assets"
import { canonicalNativeSkills } from "../scripts/lib/dsh-profile-e2e-contract"
import { McpClient } from "../src/lib/mcp_client"
import { RefCache } from "../src/lib/cache"
import { bancaRefs } from "../src/tools/banca_refs"

/**
 * Issue #124 — fail-closed contract for reference instructions (repair F1–F3).
 *
 * Static parity/contract regressions plus two hermetic behavioral regressions
 * tied to the instructions:
 *   F1 — descriptions must state the real offline BibTeX/cache contract.
 *   F2 — no promise of reading a manuscript bibliography section without `.bib`.
 *   F3 — no promise of `nao_encontrada` derived from a negative cache entry.
 *
 * They do NOT prove host discovery, loading or dispatch; that requires the
 * native DSH E2E gate on the final SHA. The native probe separately observes
 * the description actually published by `SkillRegistry.list()`.
 */

const repoRoot = join(__dirname, "..")
const canonicalSkillPath = join(repoRoot, "skills", "banca-referencias", "SKILL.md")
const mirrorSkillPath = join(repoRoot, "assets", "dsh", "skills", "banca-referencias", "SKILL.md")
const agentAssetPath = join(repoRoot, "assets", "dsh", "agents", "banca-fontes.md")

/**
 * Contract descriptions (F1). They are the exact values the native skill
 * registry publishes from the canonical frontmatter and the installer writes
 * from the asset/fallback, so a divergence fails closed.
 */
const EXPECTED_SKILL_DESCRIPTION =
  "Valida referências de um arquivo BibTeX local com parsing tudo-ou-nada e evidência apenas de cache positivo; transporte externo bloqueado."
const EXPECTED_AGENT_DESCRIPTION =
  "Valida referências de um arquivo BibTeX local usando banca_refs (cache positivo); transporte externo bloqueado."

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

/**
 * F2: the tool always resolves `config.manuscript.bib`; it never extracts a
 * bibliography section from the manuscript. Any of these forms would promise
 * an unsupported input.
 */
const FORBIDDEN_MANUSCRIPT_SECTION_INPUTS = [
  "seção de referências",
  "secao de referencias",
  "`referências`",
  "`referencias`",
] as const

/**
 * F3: `resolveRef` only reuses positive cache entries (`found === true`). A
 * negative cached entry yields `bloqueada`, never `nao_encontrada`.
 */
const FORBIDDEN_NEGATIVE_CACHE_CLASSIFICATION = ["nao_encontrada", "não encontrada", "nao encontradas", "não encontradas"] as const

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

function expectNoUnsupportedInputs(body: string): void {
  const lower = body.toLowerCase()
  for (const phrase of FORBIDDEN_MANUSCRIPT_SECTION_INPUTS) {
    expect(lower).not.toContain(phrase)
  }
}

function expectNoNegativeCacheClassification(body: string): void {
  const lower = body.toLowerCase()
  for (const phrase of FORBIDDEN_NEGATIVE_CACHE_CLASSIFICATION) {
    expect(lower).not.toContain(phrase)
  }
}

describe("banca-referencias instruction contract (#124 F1/F2/F3)", () => {
  test("canonical skill publishes a truthful discovery description (F1)", () => {
    const skill = splitFrontmatter(readFileSync(canonicalSkillPath, "utf8"))
    const frontmatter = parseYaml(skill.frontmatter) as Record<string, unknown>

    expect(Object.keys(frontmatter).sort()).toEqual(["description", "name"])
    expect(frontmatter.name).toBe("banca-referencias")
    expect(frontmatter.description).toBe(EXPECTED_SKILL_DESCRIPTION)

    const description = frontmatter.description as string
    expect(description).toContain("BibTeX")
    expect(description).toContain("cache positivo")
    expect(description).toContain("transporte externo")
    expect(description.toLowerCase()).not.toContain("bases de dados acadêmicas")
    expect(description).not.toContain("MCP")
  })

  test("canonical skill body states only the fail-closed local cache contract (F2/F3)", () => {
    const { body } = splitFrontmatter(readFileSync(canonicalSkillPath, "utf8"))

    expectNoPromises(body, REMOVED_SKILL_PROMISES)
    expectNoTransportPrimitives(body)
    expectNoUnsupportedInputs(body)
    expectNoNegativeCacheClassification(body)

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

  test("banca-fontes asset publishes a truthful description (F1) and preserves permissions", () => {
    const agent = splitFrontmatter(readFileSync(agentAssetPath, "utf8"))
    const frontmatter = parseYaml(agent.frontmatter) as Record<string, unknown>

    expect(Object.keys(frontmatter).sort()).toEqual(["description", "mode", "permission"])
    expect(frontmatter.mode).toBe("subagent")
    expect(frontmatter.description).toBe(EXPECTED_AGENT_DESCRIPTION)

    const description = frontmatter.description as string
    expect(description).toContain("BibTeX")
    expect(description).toContain("cache positivo")
    expect(description).toContain("transporte externo")
    expect(description).not.toContain("MCP")

    // Trust-model guard: the permission map must not be widened or reshaped.
    expect(frontmatter.permission).toEqual({
      "*": "deny",
      skill: { "*": "deny", "banca-referencias": "allow" },
      banca_refs: "allow",
      banca_context: "allow",
    })
  })

  test("banca-fontes asset body states only the fail-closed local cache contract (F2/F3)", () => {
    const { body } = splitFrontmatter(readFileSync(agentAssetPath, "utf8"))

    expectNoPromises(body, REMOVED_AGENT_PROMISES)
    expectNoTransportPrimitives(body)
    expectNoUnsupportedInputs(body)
    expectNoNegativeCacheClassification(body)

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
      // The fallback must carry the reconciled description and body.
      expect(installed).toContain(EXPECTED_AGENT_DESCRIPTION)
      expectNoPromises(installed, REMOVED_AGENT_PROMISES)
      expectNoUnsupportedInputs(installed)
      expectNoNegativeCacheClassification(installed)
      expect(installed).toContain("external_transport_blocked")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("negative drift detector rejects tampered mirror/description/payload copies", () => {
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

    // A truthful description in one copy and a false one in the other must drift.
    expect(findDrift([
      {
        label: "description",
        expected: EXPECTED_AGENT_DESCRIPTION,
        actual: "Valida referências e citações usando MCPs acadêmicos.",
      },
    ])).toEqual(["description"])

    // Byte-identical parity is stricter than normalized drift detection.
    expect(Buffer.from(`${canonical}\n`).equals(Buffer.from(mirror))).toBe(false)
  })

  test("F2 behavior: banca_refs requires the configured .bib and never reads a manuscript section", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "dshbanca-refs-f2-"))
    try {
      mkdirSync(join(workspace, ".banca"), { recursive: true })
      writeFileSync(
        join(workspace, "main.tex"),
        "\\documentclass{article}\\begin{document}\\begin{thebibliography}{1}\\bibitem{key} Autor.\\end{thebibliography}\\end{document}",
        "utf8",
      )
      writeFileSync(
        join(workspace, ".banca", "project.json"),
        JSON.stringify({
          version: 1,
          manuscript: {
            format: "latex",
            root: ".",
            main: "main.tex",
            bib: "refs.bib",
            chapters: [],
            outputDir: "trabalhos",
          },
          mcp: { crossrefAcademicEnabled: false },
        }),
        "utf8",
      )

      const result = await bancaRefs.execute({ projectRoot: workspace }, { directory: workspace } as any)
      // No refs.bib exists: the tool must fail closed on the missing file,
      // never extract the thebibliography section.
      expect(String(result)).toContain("bib not found")
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  test("F3 behavior: a negative cache entry yields bloqueada, not nao_encontrada, with no external transport", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "dshbanca-refs-f3-"))
    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    const mcpStartSpy = spyOn(McpClient.prototype, "start").mockImplementation(async () => {
      throw new Error("mocked McpClient.start: unauthorized MCP client startup detected")
    })
    try {
      mkdirSync(join(workspace, ".banca", "cache"), { recursive: true })
      writeFileSync(
        join(workspace, ".banca", "project.json"),
        JSON.stringify({
          version: 1,
          manuscript: {
            format: "latex",
            root: ".",
            main: "main.tex",
            bib: "refs.bib",
            chapters: [],
            outputDir: "trabalhos",
          },
          mcp: { crossrefAcademicEnabled: false },
        }),
        "utf8",
      )
      writeFileSync(join(workspace, "main.tex"), "\\cite{neg2020}", "utf8")
      writeFileSync(
        join(workspace, "refs.bib"),
        `@article{neg2020,
  author = {Teste, Negativo},
  title = {Entrada com Cache Negativo},
  year = {2020},
  doi = {10.1000/neg}
}`,
        "utf8",
      )

      // Negative cache entry: found=false / nao_encontrada. resolveRef must
      // ignore it and fail closed on the missing external provider.
      const cache = new RefCache(workspace)
      cache.set("neg2020", "10.1000/neg", {
        key: "neg2020",
        found: false,
        score: 0,
        status: "nao_encontrada",
        matchedBy: "none",
        evidence: "negative cache entry stored by a previous lookup",
      } as any)

      globalThis.fetch = (async () => {
        fetchCalls += 1
        return new Response("{}")
      }) as any

      const result = await bancaRefs.execute({ projectRoot: workspace }, { directory: workspace } as any)
      const text = String(result)

      expect(fetchCalls).toBe(0)
      expect(mcpStartSpy).not.toHaveBeenCalled()
      expect(text).toContain("blocked: external reference provider is not available in DSH")
      expect(text).toContain("Evaluated: 0/1")
      expect(text).toContain("Avg Score: N/A")
      expect(text).toContain("Provider breakdown: none=1")
      expect(text).not.toContain("Not found:")
    } finally {
      globalThis.fetch = originalFetch
      mcpStartSpy.mockRestore()
      rmSync(workspace, { recursive: true, force: true })
    }
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
