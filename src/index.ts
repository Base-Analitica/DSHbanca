import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { readdir, readFile } from "node:fs/promises"
import type { Plugin } from "@opencode-ai/plugin"
import { loadBancaTools } from "./lib/tools.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export const name = "dshbanca"
export const inject = ["skills"]

const PACKAGED_SKILL_RANK = 550
const SOURCE = "custom"

function parseFrontmatter(text: string) {
  if (!text.startsWith("---")) return null
  const end = text.indexOf("\n---", 3)
  if (end === -1) return null
  const block = text.slice(3, end)
  const body = text.slice(end + 4).replace(/^\n+/, "")
  const metadata: Record<string, any> = {}
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim())
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    metadata[match[1]] = value
  }
  return { metadata, body }
}

async function parseSkillFile(skillFile: string, signal?: AbortSignal) {
  let text: string
  try {
    text = await readFile(skillFile, "utf8")
  } catch {
    return undefined
  }
  if (signal?.aborted) return undefined
  const parsed = parseFrontmatter(text)
  if (parsed === null) return undefined
  return {
    name: parsed.metadata.name ?? "",
    description: parsed.metadata.description ?? "",
    whenToUse: parsed.metadata.whenToUse,
    metadata: parsed.metadata,
    content: parsed.body,
  }
}

async function discoverCandidates(skillsRoot: string, signal?: AbortSignal) {
  let entries
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const candidates = []
  for (const entry of entries) {
    if (signal?.aborted) break
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsRoot, entry.name)
    const skillFile = join(skillDir, "SKILL.md")
    const parsed = await parseSkillFile(skillFile, signal)
    if (parsed === undefined) continue
    candidates.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
      invocation: { modelInvocable: true, userInvocable: true },
      source: SOURCE,
      provider: name,
      rank: PACKAGED_SKILL_RANK,
      locator: skillDir,
      path: skillFile,
      ...(Object.keys(parsed.metadata).length > 0 ? { metadata: parsed.metadata } : {}),
    })
  }
  return candidates
}

export function apply(ctx: any) {
  const skillsRoot = join(__dirname, "..", "skills")
  if (ctx.skills && typeof ctx.skills.registerProvider === "function") {
    ctx.skills.registerProvider((control: any) => ({
      name,
      async list(options: any) {
        return discoverCandidates(skillsRoot, options?.signal)
      },
      async get(candidate: any, options: any) {
        const parsed = await parseSkillFile(candidate.path, options?.signal)
        if (parsed === undefined) return undefined
        return {
          name: parsed.name,
          description: parsed.description,
          ...(parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {}),
          invocation: { modelInvocable: true, userInvocable: true },
          source: SOURCE,
          provider: name,
          resourceBase: { kind: "directory", path: candidate.locator },
          path: candidate.path,
          ...(Object.keys(parsed.metadata).length > 0 ? { metadata: parsed.metadata } : {}),
          content: parsed.content,
        }
      },
    }))
  }
}

const plugin: Plugin = async () => {
  return {
    tool: await loadBancaTools(),
    config: async (cfg) => {
      const autoRegisterCrossrefMcp =
        process.env.OPENBANCA_ENABLE_CROSSREF_MCP === "1" ||
        process.env.OPENBANCA_ENABLE_CROSSREF_MCP === "true" ||
        process.env.DSHBANCA_ENABLE_CROSSREF_MCP === "1" ||
        process.env.DSHBANCA_ENABLE_CROSSREF_MCP === "true"

      if (autoRegisterCrossrefMcp) {
        if (!cfg.mcp) cfg.mcp = {}
        if (!cfg.mcp["crossref-academic"]) {
          cfg.mcp["crossref-academic"] = {
            type: "local",
            command: ["uvx", "--from", "crossref-academic-mcp-server", "crossref-server"],
            enabled: true,
          }
        }
      }
    },
  }
}

;(plugin as any).apply = apply
;(plugin as any).inject = inject
try {
  Object.defineProperty(plugin, "name", { value: name, configurable: true })
} catch {}

export default plugin
