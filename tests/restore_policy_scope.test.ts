import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"

type SnapshotEntry = { logical: string; content: string }

type ProjectOptions = {
  allowedPaths?: string[]
  protectedPaths?: string[]
  immutableFacts?: string[]
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function write(root: string, rel: string, value: string): void {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function setupProject(options: ProjectOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "dshbanca-restore-policy-"))
  mkdirSync(join(root, ".banca"), { recursive: true })
  write(root, "main.tex", "MAIN")
  writeFileSync(
    join(root, ".banca", "project.json"),
    JSON.stringify({
      version: 1,
      manuscript: {
        format: "latex",
        root: ".",
        main: "main.tex",
        bib: "referencias.bib",
        chapters: ["capitulos/*.tex"],
        outputDir: "trabalhos",
      },
      compile: { enabled: false, command: [] },
      allowedPaths: options.allowedPaths ?? ["**/*.tex", "**/*.bib", "**/*.md"],
      protectedPaths: options.protectedPaths ?? ["dados/**", ".banca/snapshots/**", ".git/**"],
      immutableFacts: options.immutableFacts ?? [],
      externalDependencies: [],
      rubricProfile: "banca-rigorosa",
      targetScore: 9,
      providers: {
        references: {
          primary: "cache",
          fallbacks: [],
          timeoutMs: 1000,
        },
      },
      mcp: { crossrefAcademicEnabled: false },
    }),
  )
  return root
}

function registerSnapshot(
  root: string,
  label: string,
  kind: "partial" | "restorable",
  entries: SnapshotEntry[],
): void {
  const snapshotDir = join(root, ".banca", "snapshots", label)
  mkdirSync(snapshotDir, { recursive: true })
  for (const entry of entries) {
    write(snapshotDir, entry.logical, entry.content)
  }
  writeFileSync(
    join(root, ".banca", "snapshots", `${label}.manifest.json`),
    JSON.stringify({
      version: 1,
      label,
      createdAt: new Date(0).toISOString(),
      kind,
      files: entries.map((entry) => ({
        logical: entry.logical,
        sha256: sha256(entry.content),
        size: Buffer.byteLength(entry.content),
      })),
      missing: [],
      skipped: [],
    }),
  )
  registerState(root, label)
}

function registerLegacySnapshot(root: string, label: string, entries: SnapshotEntry[]): void {
  const snapshotDir = join(root, ".banca", "snapshots", label)
  mkdirSync(snapshotDir, { recursive: true })
  for (const entry of entries) {
    write(snapshotDir, entry.logical, entry.content)
  }
  registerState(root, label)
}

function registerState(root: string, label: string): void {
  writeFileSync(
    join(root, ".banca", "state.json"),
    JSON.stringify({
      currentScore: null,
      lastAudit: null,
      lastLoop: null,
      snapshots: [{ id: `${label}-id`, label, createdAt: new Date(0).toISOString(), scoreBefore: null }],
      iterations: [],
    }),
  )
}

async function restore(root: string, snapshotId: string): Promise<string> {
  const { bancaRestore } = await import("../src/tools/banca_restore")
  return String(await bancaRestore.execute({ projectRoot: root, snapshotId, confirm: true }, {} as any))
}

describe("banca_restore authorization policy", () => {
  test("partial snapshot cannot restore a protected path", async () => {
    const root = setupProject()
    try {
      write(root, "dados/resultado.tex", "CURRENT-PROTECTED")
      registerSnapshot(root, "s1", "partial", [{ logical: "dados/resultado.tex", content: "SNAPSHOT-PROTECTED" }])
      const stateBefore = readFileSync(join(root, ".banca", "state.json"))
      const manifestBefore = readFileSync(join(root, ".banca", "snapshots", "s1.manifest.json"))

      const result = await restore(root, "s1")

      expect(result).toContain("blocked")
      expect(result).not.toContain("restored from")
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("CURRENT-PROTECTED")
      expect(readFileSync(join(root, ".banca", "state.json"))).toEqual(stateBefore)
      expect(readFileSync(join(root, ".banca", "snapshots", "s1.manifest.json"))).toEqual(manifestBefore)
      expect(readFileSync(join(root, ".banca", "snapshots", "s1", "dados", "resultado.tex"), "utf8")).toBe(
        "SNAPSHOT-PROTECTED",
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("partial snapshot cannot restore a path outside allowedPaths", async () => {
    const root = setupProject()
    try {
      write(root, "not-allowed.txt", "CURRENT")
      registerSnapshot(root, "s1", "partial", [{ logical: "not-allowed.txt", content: "SNAPSHOT" }])

      const result = await restore(root, "s1")

      expect(result).toContain("outside allowedPaths")
      expect(readFileSync(join(root, "not-allowed.txt"), "utf8")).toBe("CURRENT")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("partial snapshot restores an allowed chapter", async () => {
    const root = setupProject()
    try {
      write(root, "capitulos/cap1.tex", "CURRENT-CHAPTER")
      registerSnapshot(root, "s1", "partial", [{ logical: "capitulos/cap1.tex", content: "SNAPSHOT-CHAPTER" }])

      const result = await restore(root, "s1")

      expect(result).toContain("restored from s1")
      expect(readFileSync(join(root, "capitulos/cap1.tex"), "utf8")).toBe("SNAPSHOT-CHAPTER")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("immutableFacts remain protected during restore", async () => {
    const root = setupProject({ immutableFacts: ["capitulos/cap1.tex"] })
    try {
      write(root, "capitulos/cap1.tex", "CURRENT-IMMUTABLE")
      registerSnapshot(root, "s1", "partial", [{ logical: "capitulos/cap1.tex", content: "SNAPSHOT-IMMUTABLE" }])

      const result = await restore(root, "s1")

      expect(result).toContain("immutableFacts")
      expect(readFileSync(join(root, "capitulos/cap1.tex"), "utf8")).toBe("CURRENT-IMMUTABLE")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("allowed logical symlink cannot restore into a physical path outside allowedPaths", async () => {
    const root = setupProject({ allowedPaths: ["capitulos/*.tex"], protectedPaths: [] })
    try {
      write(root, "dados/resultado.tex", "CURRENT-PHYSICAL")
      mkdirSync(join(root, "capitulos"), { recursive: true })
      symlinkSync("../dados/resultado.tex", join(root, "capitulos/alias.tex"))
      registerSnapshot(root, "alias", "partial", [{ logical: "capitulos/alias.tex", content: "SNAPSHOT-PHYSICAL" }])
      const stateBefore = readFileSync(join(root, ".banca", "state.json"))
      const manifestBefore = readFileSync(join(root, ".banca", "snapshots", "alias.manifest.json"))
      const snapshotBefore = readFileSync(join(root, ".banca", "snapshots", "alias", "capitulos", "alias.tex"))
      const vaultEntriesBefore = readdirSync(join(root, ".banca", "snapshots")).sort()
      const physicalBefore = readFileSync(join(root, "dados/resultado.tex"))

      const result = await restore(root, "alias")
      const physicalAfter = readFileSync(join(root, "dados/resultado.tex"))
      expect(result).toContain("blocked")
      expect(result).not.toContain("restored from")
      expect(physicalAfter).toEqual(physicalBefore)
      expect(lstatSync(join(root, "capitulos/alias.tex")).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(root, ".banca", "state.json"))).toEqual(stateBefore)
      expect(readFileSync(join(root, ".banca", "snapshots", "alias.manifest.json"))).toEqual(manifestBefore)
      expect(readFileSync(join(root, ".banca", "snapshots", "alias", "capitulos", "alias.tex"))).toEqual(
        snapshotBefore,
      )
      expect(readdirSync(join(root, ".banca", "snapshots")).sort()).toEqual(vaultEntriesBefore)
      expect(readFileSync(join(root, "main.tex"), "utf8")).toBe("MAIN")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("logical authorization is still required when physical target is allowed", async () => {
    const root = setupProject({ allowedPaths: ["dados/*.tex"], protectedPaths: [] })
    try {
      write(root, "dados/resultado.tex", "CURRENT-PHYSICAL")
      mkdirSync(join(root, "capitulos"), { recursive: true })
      symlinkSync("../dados/resultado.tex", join(root, "capitulos/alias.tex"))
      registerSnapshot(root, "logical-denied", "partial", [
        { logical: "capitulos/alias.tex", content: "SNAPSHOT-PHYSICAL" },
      ])

      const result = await restore(root, "logical-denied")

      expect(result).toContain("outside allowedPaths")
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("CURRENT-PHYSICAL")
      expect(lstatSync(join(root, "capitulos/alias.tex")).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("internal symlink restores when both logical and physical paths are allowed", async () => {
    const root = setupProject({
      allowedPaths: ["capitulos/*.tex", "dados/*.tex"],
      protectedPaths: [],
    })
    try {
      write(root, "dados/resultado.tex", "CURRENT-PHYSICAL")
      mkdirSync(join(root, "capitulos"), { recursive: true })
      symlinkSync("../dados/resultado.tex", join(root, "capitulos/alias.tex"))
      registerSnapshot(root, "both-allowed", "partial", [
        { logical: "capitulos/alias.tex", content: "SNAPSHOT-PHYSICAL" },
      ])

      const result = await restore(root, "both-allowed")

      expect(result).toContain("restored from both-allowed")
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("SNAPSHOT-PHYSICAL")
      expect(lstatSync(join(root, "capitulos/alias.tex")).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("physical immutableFacts still block an otherwise allowed symlink restore", async () => {
    const root = setupProject({
      allowedPaths: ["capitulos/*.tex", "dados/*.tex"],
      protectedPaths: [],
      immutableFacts: ["dados/*.tex"],
    })
    try {
      write(root, "dados/resultado.tex", "CURRENT-IMMUTABLE")
      mkdirSync(join(root, "capitulos"), { recursive: true })
      symlinkSync("../dados/resultado.tex", join(root, "capitulos/alias.tex"))
      registerSnapshot(root, "physical-immutable", "partial", [
        { logical: "capitulos/alias.tex", content: "SNAPSHOT-PHYSICAL" },
      ])

      const result = await restore(root, "physical-immutable")

      expect(result).toContain("immutableFacts")
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("CURRENT-IMMUTABLE")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("banca_snapshot does not register a restorable capture with an unauthorized physical target", async () => {
    const root = setupProject({ allowedPaths: ["capitulos/*.tex"], protectedPaths: [] })
    try {
      write(root, "dados/resultado.tex", "CURRENT-PHYSICAL")
      mkdirSync(join(root, "capitulos"), { recursive: true })
      symlinkSync("../dados/resultado.tex", join(root, "capitulos/alias.tex"))
      const configPath = join(root, ".banca", "project.json")
      const config = JSON.parse(readFileSync(configPath, "utf8"))
      config.manuscript.main = "capitulos/alias.tex"
      writeFileSync(configPath, JSON.stringify(config))
      registerState(root, "baseline")
      const stateBefore = readFileSync(join(root, ".banca", "state.json"))

      const { bancaSnapshot } = await import("../src/tools/banca_snapshot")
      const result = String(await bancaSnapshot.execute({ projectRoot: root, label: "unauthorized-alias" }, {} as any))

      expect(result).toContain("not restorable")
      expect(readFileSync(join(root, ".banca", "state.json"))).toEqual(stateBefore)
      expect(existsSync(join(root, ".banca", "snapshots", "unauthorized-alias"))).toBe(false)
      expect(existsSync(join(root, ".banca", "snapshots", "unauthorized-alias.manifest.json"))).toBe(false)
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("CURRENT-PHYSICAL")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("an allowed logical symlink cannot redirect restore into protected physical data", async () => {
    const root = setupProject()
    try {
      write(root, "dados/resultado.tex", "CURRENT-PROTECTED")
      symlinkSync("dados/resultado.tex", join(root, "alias.tex"))
      registerSnapshot(root, "s1", "partial", [{ logical: "alias.tex", content: "SNAPSHOT" }])

      const result = await restore(root, "s1")

      expect(result).toContain("protected")
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("CURRENT-PROTECTED")
      expect(lstatSync(join(root, "alias.tex")).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a protected logical path is denied even when its physical target is otherwise allowed", async () => {
    const root = setupProject({ protectedPaths: ["protected/**"] })
    try {
      write(root, "protected/allowed.tex", "CURRENT")
      registerSnapshot(root, "s1", "partial", [{ logical: "protected/allowed.tex", content: "SNAPSHOT" }])

      const result = await restore(root, "s1")

      expect(result).toContain("protectedPaths")
      expect(readFileSync(join(root, "protected/allowed.tex"), "utf8")).toBe("CURRENT")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("external and broken destination symlinks are denied before any write", async () => {
    const base = mkdtempSync(join(tmpdir(), "dshbanca-restore-policy-links-"))
    const external = join(base, "external")
    const root = join(base, "project")
    mkdirSync(external, { recursive: true })
    mkdirSync(root, { recursive: true })
    try {
      write(external, "target.tex", "EXTERNAL")
      setupProjectAt(root)
      symlinkSync(join(external, "target.tex"), join(root, "external.tex"))
      registerSnapshot(root, "external", "partial", [{ logical: "external.tex", content: "SNAPSHOT" }])
      const externalBefore = readFileSync(join(external, "target.tex"))

      const externalResult = await restore(root, "external")

      expect(externalResult).toContain("blocked")
      expect(readFileSync(join(external, "target.tex"))).toEqual(externalBefore)

      rmSync(join(root, ".banca", "snapshots", "external"), { recursive: true, force: true })
      rmSync(join(root, ".banca", "snapshots", "external.manifest.json"), { force: true })
      rmSync(join(root, "external.tex"), { force: true })
      symlinkSync("missing/target.tex", join(root, "broken.tex"))
      registerSnapshot(root, "broken", "partial", [{ logical: "broken.tex", content: "SNAPSHOT" }])

      const brokenResult = await restore(root, "broken")

      expect(brokenResult).toContain("blocked")
      expect(lstatSync(join(root, "broken.tex")).isSymbolicLink()).toBe(true)
      expect(existsSync(join(external, "target.tex"))).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("internal namespaces remain denied", async () => {
    const root = setupProject({ allowedPaths: ["**/*"] })
    try {
      registerSnapshot(root, "env", "partial", [{ logical: ".env", content: "SECRET" }])
      const envResult = await restore(root, "env")
      expect(envResult).toContain("blocked")

      rmSync(join(root, ".banca", "snapshots", "env"), { recursive: true, force: true })
      rmSync(join(root, ".banca", "snapshots", "env.manifest.json"), { force: true })
      registerSnapshot(root, "internal", "partial", [{ logical: ".banca/evil.tex", content: "STATE" }])
      const internalResult = await restore(root, "internal")
      expect(internalResult).toContain("blocked")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("mixed allowed and protected entries are rejected before either write", async () => {
    const root = setupProject()
    try {
      write(root, "capitulos/cap1.tex", "CURRENT-ALLOWED")
      write(root, "dados/resultado.tex", "CURRENT-PROTECTED")
      registerSnapshot(root, "mixed", "partial", [
        { logical: "capitulos/cap1.tex", content: "SNAPSHOT-ALLOWED" },
        { logical: "dados/resultado.tex", content: "SNAPSHOT-PROTECTED" },
      ])
      const stateBefore = readFileSync(join(root, ".banca", "state.json"))

      const result = await restore(root, "mixed")

      expect(result).toContain("blocked")
      expect(readFileSync(join(root, "capitulos/cap1.tex"), "utf8")).toBe("CURRENT-ALLOWED")
      expect(readFileSync(join(root, "dados/resultado.tex"), "utf8")).toBe("CURRENT-PROTECTED")
      expect(readFileSync(join(root, ".banca", "state.json"))).toEqual(stateBefore)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("restorable and legacy legitimate snapshots remain compatible", async () => {
    const root = setupProject()
    try {
      write(root, "main.tex", "CURRENT-RESTORABLE")
      registerSnapshot(root, "restorable", "restorable", [{ logical: "main.tex", content: "SNAPSHOT-RESTORABLE" }])
      const restorableResult = await restore(root, "restorable")
      expect(restorableResult).toContain("restored from restorable")
      expect(readFileSync(join(root, "main.tex"), "utf8")).toBe("SNAPSHOT-RESTORABLE")

      rmSync(join(root, ".banca", "snapshots", "legacy"), { recursive: true, force: true })
      registerLegacySnapshot(root, "legacy", [{ logical: "main.tex", content: "SNAPSHOT-LEGACY" }])
      const legacyResult = await restore(root, "legacy")
      expect(legacyResult).toContain("restored from legacy")
      expect(readFileSync(join(root, "main.tex"), "utf8")).toBe("SNAPSHOT-LEGACY")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function setupProjectAt(root: string): void {
  mkdirSync(join(root, ".banca"), { recursive: true })
  write(root, "main.tex", "MAIN")
  writeFileSync(
    join(root, ".banca", "project.json"),
    JSON.stringify({
      version: 1,
      manuscript: {
        format: "latex",
        root: ".",
        main: "main.tex",
        bib: "referencias.bib",
        chapters: ["capitulos/*.tex"],
        outputDir: "trabalhos",
      },
      compile: { enabled: false, command: [] },
      allowedPaths: ["**/*.tex", "**/*.bib", "**/*.md"],
      protectedPaths: ["dados/**", ".banca/snapshots/**", ".git/**"],
      immutableFacts: [],
      externalDependencies: [],
      rubricProfile: "banca-rigorosa",
      targetScore: 9,
      providers: { references: { primary: "cache", fallbacks: [], timeoutMs: 1000 } },
      mcp: { crossrefAcademicEnabled: false },
    }),
  )
}
