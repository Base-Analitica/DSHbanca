import { readdir, readFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { z } from "zod"
import { PathTraversalError, resolveRealInsideRoot } from "./lib/safe_paths.js"
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

/** Workspace-mutating tools denied to verified auditor agents. */
const AUDITOR_DENIED_TOOLS = new Set([
  "banca_init",
  "banca_corrigir",
  "banca_snapshot",
  "banca_compile",
  "banca_restore",
  "banca_loop",
])

/** Tools that alter or revert the author's manuscript. */
const MANUSCRIPT_MUTATING_TOOLS = new Set(["banca_corrigir", "banca_restore"])

const AUDITOR_PRESET_PREFIX = "banca-auditor"
const CORRECTOR_PRESET_PREFIX = "banca-corretor"

/**
 * Live preset composition, when the host exposes it. `agentPreset` in the
 * session header is a durable, creation-time value (delegated sessions inherit
 * the parent's preset), while the live composition is authoritative at
 * dispatch time. Both sources are deny-monotonic: any source that identifies
 * an auditor denies.
 */
function liveComposedPreset(exec: any): string | undefined {
  try {
    const agentCtx = exec?.agent?.ctx
    const presets = agentCtx?.get?.("agentPresets")
    const id = presets?.composedPreset?.(agentCtx)
    return typeof id === "string" ? id : undefined
  } catch {
    return undefined
  }
}

function presetCandidates(exec: any): string[] {
  const header = exec?.agent?.session?.header
  const candidates = [liveComposedPreset(exec), header?.agentPreset]
  return candidates.filter((p): p is string => typeof p === "string")
}

/**
 * Academic tool policy for the native guard (and the executor double-check):
 *
 * - verified auditor lineage (`banca-auditor*`): read-only; workspace-mutating
 *   tools are denied.
 * - delegated sessions (`origin: "subagent"`) without a verified
 *   `banca-corretor*` preset: manuscript mutation is denied. The absence of a
 *   verifiable identity never grants authorization.
 * - top-level sessions are not gated here: the host sandbox/approval policy
 *   remains authoritative.
 *
 * The guard is deny-only and total: it never throws and never force-allows.
 */
function guardDenyReason(toolName: string | undefined, exec: any): string | undefined {
  if (typeof toolName !== "string") return undefined
  const presets = presetCandidates(exec)
  const origin = exec?.agent?.session?.header?.origin

  if (presets.some((p) => p.startsWith(AUDITOR_PRESET_PREFIX))) {
    if (AUDITOR_DENIED_TOOLS.has(toolName)) {
      return `DSHbanca guard: tool "${toolName}" is denied for auditor agents — read-only enforcement`
    }
    return undefined
  }

  if (origin === "subagent" && !presets.some((p) => p.startsWith(CORRECTOR_PRESET_PREFIX))) {
    if (MANUSCRIPT_MUTATING_TOOLS.has(toolName)) {
      return `DSHbanca guard: tool "${toolName}" is denied for subagents without a verified banca-corretor preset — manuscript mutation requires the corrector role`
    }
  }

  return undefined
}

function resolveWorkspaceRoot(exec: any): string {
  const cwd = exec?.agent?.session?.header?.cwd
  if (typeof cwd !== "string" || cwd === "") {
    throw new PathTraversalError("DSHbanca requires a session workspace; no cwd in session header")
  }
  try {
    return realpathSync(cwd)
  } catch {
    throw new PathTraversalError("session workspace is not accessible")
  }
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

        const denied = guardDenyReason(toolName, exec)
        if (denied) {
          throw new Error(denied)
        }

        const args = schema.parse(input)
        const root = resolveWorkspaceRoot(exec)

        let directory: string
        if (args.projectRoot !== undefined && args.projectRoot !== "") {
          try {
            directory = resolveRealInsideRoot(root, args.projectRoot)
          } catch (err) {
            if (err instanceof PathTraversalError) {
              throw new PathTraversalError(
                `tool "${toolName}" rejected a projectRoot outside the workspace`,
              )
            }
            throw err
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

  ctx.tools.guard((exec: any) => guardDenyReason(exec?.name ?? exec?.tool?.name, exec))

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
