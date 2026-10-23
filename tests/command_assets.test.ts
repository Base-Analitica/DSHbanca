/**
 * Deterministic proofs for OpenCode command assets:
 * - versioned install of /banca-auditar
 * - fallback install equivalence
 * - frontmatter contract (agent, subtask, no model)
 * - body guardrails without duplicating the full audit protocol
 * - help command lists registered /banca-auditar (not /banca:auditar)
 */
import { expect, test, describe, afterEach } from "bun:test"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { installAssets } from "../src/lib/install_assets"

const VERSIONED_COMMANDS_DIR = join(
  process.cwd(),
  "assets",
  "dsh",
  "commands",
)

const AUDITAR = "banca-auditar.md"
const HELP = "banca.md"
const INIT = "banca-init.md"

const ALL_COMMANDS = [INIT, HELP, AUDITAR] as const

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n")
}

function readNormalized(path: string): string {
  return normalize(readFileSync(path, "utf-8"))
}

function parseFrontmatter(md: string): string {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error("missing frontmatter")
  return match[1]
}

function bodyOf(md: string): string {
  const match = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  if (!match) throw new Error("missing body after frontmatter")
  return match[1]
}

function installVersioned(root: string): string[] {
  return installAssets(root, true)
}

function installFallback(root: string): string[] {
  return installAssets(root, true, join(root, "missing-assets-dir"))
}

const tempRoots: string[] = []

function tempProject(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe("command assets: banca-auditar", () => {
  test("1–3: versioned install, fallback install, and three-way equivalence", () => {
    const versionedRoot = tempProject("cmd-versioned-")
    const fallbackRoot = tempProject("cmd-fallback-")

    const versionedInstalled = installVersioned(versionedRoot)
    const fallbackInstalled = installFallback(fallbackRoot)

    const versionedPath = join(versionedRoot, ".dsh", "commands", AUDITAR)
    const fallbackPath = join(fallbackRoot, ".dsh", "commands", AUDITAR)
    const sourcePath = join(VERSIONED_COMMANDS_DIR, AUDITAR)

    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(versionedPath)).toBe(true)
    expect(existsSync(fallbackPath)).toBe(true)

    expect(
      versionedInstalled.some((p) => p.endsWith(join(".dsh", "commands", AUDITAR))),
    ).toBe(true)
    expect(
      fallbackInstalled.some((p) => p.endsWith(join(".dsh", "commands", AUDITAR))),
    ).toBe(true)

    const source = readNormalized(sourcePath)
    const fromVersionedInstall = readNormalized(versionedPath)
    const fromFallback = readNormalized(fallbackPath)

    expect(fromVersionedInstall).toBe(source)
    expect(fromFallback).toBe(source)
    expect(fromFallback).toBe(fromVersionedInstall)
  })

  test("4–6: frontmatter selects banca-auditor, subtask true, no model", () => {
    const source = readNormalized(join(VERSIONED_COMMANDS_DIR, AUDITAR))
    const fm = parseFrontmatter(source)

    expect(fm).toMatch(/^\s*agent:\s*banca-auditor\s*$/m)
    expect(fm).toMatch(/^\s*subtask:\s*true\s*$/m)
    expect(fm).not.toMatch(/^\s*model\s*:/m)
    expect(source).not.toMatch(/^\s*model\s*:/m)
  })

  test("7–9: body references skill, forbids manuscript edit and incomplete full conclusion; no shell/$ARGUMENTS/old syntax", () => {
    const source = readNormalized(join(VERSIONED_COMMANDS_DIR, AUDITAR))
    const body = bodyOf(source)
    const lower = body.toLowerCase()

    expect(body).toContain("banca-avaliacao")
    expect(lower).toMatch(/n[aã]o altere o manuscrito/)
    expect(lower).toMatch(
      /parecer integral|s[ií]ntese global completa|conclus[aã]o de cobertura/,
    )
    expect(lower).toMatch(/incompletos?|bloqueados?/)

    // Functional prohibitions: no shell injection, no argument router, no colon syntax.
    expect(source).not.toContain("$ARGUMENTS")
    expect(source).not.toContain("/banca:auditar")
    expect(source).not.toMatch(/!`/)
    expect(source).not.toMatch(/!\(/)

    // Must not embed the full multi-step protocol already owned by agent/skill.
    expect(source).not.toContain("completedBatchId")
    expect(source).not.toMatch(/banca_context\s*\n\s*→\s*read/)
  })

  test("10–11: banca.md lists /banca-auditar as registered; help fallback stays equivalent", () => {
    const sourceHelp = readNormalized(join(VERSIONED_COMMANDS_DIR, HELP))

    expect(sourceHelp).toContain("/banca-auditar")
    expect(sourceHelp).toMatch(/banca-auditor/)
    expect(sourceHelp).not.toContain("/banca:auditar")

    // Registered section must present the new command; future list must not re-list it with colon.
    const registeredIdx = sourceHelp.indexOf("## Comandos Registrados")
    const futureIdx = sourceHelp.indexOf("## Funcionalidades Futuras Planejadas")
    expect(registeredIdx).toBeGreaterThanOrEqual(0)
    expect(futureIdx).toBeGreaterThan(registeredIdx)
    const registeredBlock = sourceHelp.slice(registeredIdx, futureIdx)
    expect(registeredBlock).toContain("/banca-auditar")
    expect(registeredBlock).toContain("/banca-init")

    const versionedRoot = tempProject("cmd-help-versioned-")
    const fallbackRoot = tempProject("cmd-help-fallback-")
    installVersioned(versionedRoot)
    installFallback(fallbackRoot)

    const installedVersioned = readNormalized(
      join(versionedRoot, ".dsh", "commands", HELP),
    )
    const installedFallback = readNormalized(
      join(fallbackRoot, ".dsh", "commands", HELP),
    )

    expect(installedVersioned).toBe(sourceHelp)
    expect(installedFallback).toBe(sourceHelp)
  })

  test("12: no command filename created in this task contains ':'", () => {
    const versionedRoot = tempProject("cmd-names-versioned-")
    const fallbackRoot = tempProject("cmd-names-fallback-")
    installVersioned(versionedRoot)
    installFallback(fallbackRoot)

    for (const root of [versionedRoot, fallbackRoot, VERSIONED_COMMANDS_DIR]) {
      const dir =
        root === VERSIONED_COMMANDS_DIR
          ? VERSIONED_COMMANDS_DIR
          : join(root, ".dsh", "commands")
      const files = readdirSync(dir)
      for (const name of files) {
        expect(name).not.toMatch(/:/)
      }
      expect(files).toContain(AUDITAR)
      expect(files).not.toContain("banca:auditar.md")
    }

    // Inventory from this leaf includes only hyphenated command files.
    const repoFiles = readdirSync(VERSIONED_COMMANDS_DIR).sort()
    expect(repoFiles).toEqual([...ALL_COMMANDS].sort())
  })

  test("installed frontmatter and body survive both install paths", () => {
    const versionedRoot = tempProject("cmd-fm-versioned-")
    const fallbackRoot = tempProject("cmd-fm-fallback-")
    installVersioned(versionedRoot)
    installFallback(fallbackRoot)

    for (const root of [versionedRoot, fallbackRoot]) {
      const content = readNormalized(
        join(root, ".dsh", "commands", AUDITAR),
      )
      const fm = parseFrontmatter(content)
      expect(fm).toMatch(/^\s*agent:\s*banca-auditor\s*$/m)
      expect(fm).toMatch(/^\s*subtask:\s*true\s*$/m)
      expect(fm).not.toMatch(/^\s*model\s*:/m)
      expect(content).toContain("banca-avaliacao")
      expect(content.toLowerCase()).toMatch(/n[aã]o altere o manuscrito/)
      expect(content).not.toContain("$ARGUMENTS")
      expect(content).not.toContain("/banca:auditar")
    }
  })
})
