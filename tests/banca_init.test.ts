import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const tmpBase = join(tmpdir(), "banca-test-" + Date.now())

describe("banca_init", () => {
  const testRoot = join(tmpBase, "test-project")

  beforeEach(() => {
    mkdirSync(testRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true })
  })

  test("creates .banca directory structure", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    const result = await bancaInit.execute({ projectRoot: testRoot }, {} as any)

    expect(typeof result).toBe("string")
    expect(result).toContain(".banca/ + config + state")
    expect(existsSync(join(testRoot, ".banca", "project.json"))).toBe(true)
    expect(existsSync(join(testRoot, ".banca", "reports"))).toBe(true)
    expect(existsSync(join(testRoot, ".banca", "context"))).toBe(true)
    expect(existsSync(join(testRoot, ".banca", "snapshots"))).toBe(true)
    expect(existsSync(join(testRoot, ".banca", "cache"))).toBe(true)
    expect(existsSync(join(testRoot, ".banca", "state.json"))).toBe(true)
  })

  test("skips if already initialized", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    await bancaInit.execute({ projectRoot: testRoot }, {} as any)
    const result = await bancaInit.execute({ projectRoot: testRoot }, {} as any)

    expect(result).toContain("skipped")
  })

  test("force overwrites existing config", async () => {
    const { bancaInit } = await import("../src/tools/banca_init")
    await bancaInit.execute({ projectRoot: testRoot }, {} as any)
    const result = await bancaInit.execute({ projectRoot: testRoot, force: true }, {} as any)

    expect(result).toContain(".banca/ + config + state")
  })
})
