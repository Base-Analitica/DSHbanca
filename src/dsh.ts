import { readdir, readFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path"
import { z } from "zod"
import { resolveInsideRoot, PathTraversalError } from "./lib/safe_paths.js"
import { loadBancaTools } from "./lib/tools.js"

export const name = "dshbanca"
export const inject = ["skills", "tools"]

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
  const candidates: any[] = []
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

const DESTRUCTIVE_TOOLS = new Set([
  "banca_init",
  "banca_corrigir",
  "banca_snapshot",
  "banca_compile",
  "banca_restore",
  "banca_loop",
])

const AUDITOR_PRESET_PREFIX = "banca-auditor"

function isAuditorAgent(exec: any): boolean {
  const preset: string | undefined = exec?.agent?.session?.header?.agentPreset
  return preset !== undefined && preset.startsWith(AUDITOR_PRESET_PREFIX)
}

function resolveWorkspaceRoot(exec: any): string {
  const cwd = exec?.agent?.session?.header?.cwd
  if (cwd === undefined) {
    throw new Error("DSHbanca requires a session workspace; no cwd in session header")
  }
  const resolvedCwd = realpathSync(cwd)
  return resolvedCwd
}

export async function apply(ctx: any) {
  const definitions = await loadBancaTools()

  for (const [toolName, definition] of Object.entries(definitions)) {
    const schema = z.object(definition.args)
    const { $schema, ...parameters } = z.toJSONSchema(schema, { io: "input" })
    ctx.tools.register({
      name: toolName,
      description: definition.description,
      parameters,
      output: {
        schema: { type: "string" },
        render: (_args: unknown, value: string) => [{ type: "text", text: value }],
      },
      async execute(input: unknown, exec: any) {
        exec.signal.throwIfAborted()

        if (DESTRUCTIVE_TOOLS.has(toolName) && isAuditorAgent(exec)) {
          throw new Error(
            `DSHbanca guard: tool "${toolName}" is denied for auditor agents — read-only enforcement`,
          )
        }

        const args = schema.parse(input)
        const root = resolveWorkspaceRoot(exec)

        let directory: string
        if (args.projectRoot !== undefined && args.projectRoot !== "") {
          if (isAbsolute(args.projectRoot)) {
            const rel = relative(root, args.projectRoot)
            if (rel.startsWith("..") || isAbsolute(rel)) {
              throw new PathTraversalError(
                `absolute path escapes workspace root: ${args.projectRoot}`,
              )
            }
            directory = resolveInsideRoot(root, rel)
          } else {
            directory = resolveInsideRoot(root, args.projectRoot)
          }
          try {
            directory = realpathSync(directory)
          } catch {
            // ignore
          }
          if (!directory.startsWith(root + "/") && directory !== root) {
            if (directory.endsWith(sep) || root.endsWith(sep)) {
              // normalize
            }
            const resolvedRootNoSep = root.replace(/\/$/, "")
            const dirNoSep = directory.replace(/\/$/, "")
            if (dirNoSep !== resolvedRootNoSep && !dirNoSep.startsWith(resolvedRootNoSep + "/")) {
              throw new PathTraversalError(
                `tool "${toolName}" resolved path escapes workspace root: ${directory}`,
              )
            }
          }
        } else {
          directory = root
        }

        const result = await definition.execute(
          { ...args, projectRoot: directory } as any,
          { directory, worktree: directory, abort: exec.signal } as any,
        )
        return typeof result === "string" ? result : result.output
      },
    })
  }

  ctx.tools.guard((exec: any) => {
    const toolName = exec?.name ?? exec?.tool?.name
    if (DESTRUCTIVE_TOOLS.has(toolName) && isAuditorAgent(exec)) {
      return `DSHbanca guard: tool "${toolName}" is denied for auditor agents — read-only enforcement`
    }
    return undefined
  })

  const skillsRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "skills")
  if (ctx.skills?.registerProvider) {
    ctx.skills.registerProvider(() => ({
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

export default { apply, name, inject }
