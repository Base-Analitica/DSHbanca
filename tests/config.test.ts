import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig, saveConfig, validateConfig } from "../src/lib/config"

const DEFAULT_LIMIT = 50_000

describe("ProjectConfig analysis per-batch limit", () => {
  let root: string
  let path: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ob-config-test-"))
    mkdirSync(join(root, ".banca"), { recursive: true })
    path = join(root, ".banca", "project.json")
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function writeConfig(config: unknown): void {
    writeFileSync(path, JSON.stringify({ version: 1, ...(config as object) }), "utf-8")
  }

  test("uses the exhaustive per-batch defaults when config is absent", () => {
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
  })

  test("sanitizes malformed JSON to independent defaults and validateConfig diagnoses it", () => {
    writeFileSync(path, "{ invalid }", "utf-8")
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
    expect(validateConfig(root).valid).toBe(false)
  })

  test("adds analysis defaults to legacy configs without analysis", () => {
    writeConfig({ version: 1, manuscript: { format: "latex" } })
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
  })

  test("migrates the legacy budgetCharacters alias without exposing it", () => {
    writeConfig({ analysis: { budgetCharacters: 75_000 } })
    const analysis = loadConfig(root).analysis
    expect(analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 75_000 })
    expect(analysis).not.toHaveProperty("budgetCharacters")
    expect(validateConfig(root)).toEqual({ valid: true, errors: [] })
  })

  test("loads a valid explicit per-batch contract", () => {
    writeConfig({ analysis: { coverageMode: "exhaustive", maxCharactersPerBatch: 100_000 } })
    expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 100_000 })
    expect(validateConfig(root)).toEqual({ valid: true, errors: [] })
  })

  test("defaults an omitted coverageMode and diagnoses another coverage mode", () => {
    writeConfig({ analysis: { maxCharactersPerBatch: 80_000 } })
    expect(loadConfig(root).analysis.coverageMode).toBe("exhaustive")
    expect(validateConfig(root).valid).toBe(true)

    writeConfig({ analysis: { coverageMode: "partial", maxCharactersPerBatch: 80_000 } })
    expect(loadConfig(root).analysis.coverageMode).toBe("exhaustive")
    expect(validateConfig(root).errors).toContain('analysis.coverageMode must be "exhaustive"')
  })

  test("sanitizes invalid analysis shapes and validateConfig diagnoses each one", () => {
    for (const analysis of [null, "invalid", []]) {
      writeConfig({ analysis })
      expect(loadConfig(root).analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: DEFAULT_LIMIT })
      expect(validateConfig(root).errors).toContain("analysis must be an object")
    }
  })

  test("sanitizes invalid per-batch limits and validateConfig diagnoses each one", () => {
    for (const maxCharactersPerBatch of [0, -1, 1.5, "50000", null]) {
      writeConfig({ analysis: { maxCharactersPerBatch } })
      expect(loadConfig(root).analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
      expect(validateConfig(root).errors).toContain("analysis.maxCharactersPerBatch must be a finite integer > 0")
    }

    writeFileSync(path, '{"version":1,"analysis":{"maxCharactersPerBatch":1e999}}', "utf-8")
    expect(loadConfig(root).analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
    expect(validateConfig(root).errors).toContain("analysis.maxCharactersPerBatch must be a finite integer > 0")

    writeFileSync(path, '{"version":1,"analysis":{"maxCharactersPerBatch":NaN}}', "utf-8")
    expect(loadConfig(root).analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
    expect(validateConfig(root).valid).toBe(false)
  })

  test("returns independent analysis objects on every load", () => {
    const first = loadConfig(root)
    const second = loadConfig(root)
    expect(first.analysis).not.toBe(second.analysis)
    first.analysis.maxCharactersPerBatch = 999
    expect(second.analysis.maxCharactersPerBatch).toBe(DEFAULT_LIMIT)
  })

  test("round-trips only the new contract", () => {
    writeConfig({ analysis: { budgetCharacters: 75_000 } })
    saveConfig(root, loadConfig(root))
    const persisted = JSON.parse(readFileSync(path, "utf-8"))
    expect(persisted.analysis).toEqual({ coverageMode: "exhaustive", maxCharactersPerBatch: 75_000 })
    expect(persisted.analysis).not.toHaveProperty("budgetCharacters")
    expect(loadConfig(root).analysis).toEqual(persisted.analysis)
  })
})
