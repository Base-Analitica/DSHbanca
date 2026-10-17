import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parse } from "yaml"
import { buildSdkPresetOverlayPatch, e2eControlPresetId } from "../scripts/lib/dsh-profile-e2e-presets.js"
import { validatePresetReferences } from "../scripts/lib/dsh-profile-e2e-contract.js"

test("DSHbanca declares only its academic auditor preset and leaves global registry ownership to DSH", () => {
  const patch = parse(readFileSync("cordis.patch.yml", "utf8")) as any[]
  const rows = patch.flatMap((operation) => operation.insert ?? [])
  const registry = rows.find((row) => row.name === "@deepseek-ai/dsh-agent-preset-registry")
  const presets = rows.filter((row) => row.name === "@deepseek-ai/dsh-agent-preset")
  const auditor = presets.find((row) => row.config?.id === "banca-auditor")
  const instructionLoader = auditor?.config?.plugins?.find((row: any) => row.name === "@deepseek-ai/dsh-agent-instructions")

  expect(rows.some((row) => row.name === "dshbanca/dsh")).toBe(true)
  expect(registry).toBeUndefined()
  expect(presets.map((row) => row.config?.id)).toEqual(["banca-auditor"])
  expect(instructionLoader?.config?.maxBytes).toBe(65536)
  expect(instructionLoader?.inject).toContain("fs")
  expect(instructionLoader?.config?.instructionFileCandidates).toEqual(["banca-auditor.md"])
  expect(instructionLoader?.config?.localInstructionFileCandidates).toEqual([])
  expect(instructionLoader?.config?.projectRootMarkers).toEqual([".git"])
  expect(JSON.stringify(auditor)).not.toContain("dsh-persona")
})

test("SDK overlay provides a resolving registry and empty neutral control preset only in scratch", () => {
  const overlay = parse(buildSdkPresetOverlayPatch("dshbanca-e2e-observer")) as any[]
  const rows = overlay.flatMap((operation) => operation.insert ?? [])
  const registry = rows.find((row) => row.name === "@deepseek-ai/dsh-agent-preset-registry")
  const presetRows = rows.filter((row) => row.name === "@deepseek-ai/dsh-agent-preset")
  const neutral = presetRows.find((row) => row.config?.id === e2eControlPresetId)

  expect(registry?.config).toEqual({ default: e2eControlPresetId })
  expect(neutral?.config?.plugins).toEqual([])
  expect(validatePresetReferences(registry?.config?.default, presetRows.map((row) => row.config?.id))).toEqual([])
  expect(rows.some((row) => row.name === "dshbanca-e2e-observer")).toBe(true)
})

test("missing, unknown, and duplicate preset references fail closed", () => {
  expect(validatePresetReferences(undefined, [e2eControlPresetId])).toContain(
    "AgentPresetRegistry default does not resolve to a declared preset",
  )
  expect(validatePresetReferences("unknown", [e2eControlPresetId])).toContain(
    "AgentPresetRegistry default does not resolve to a declared preset",
  )
  expect(validatePresetReferences(e2eControlPresetId, [e2eControlPresetId, e2eControlPresetId])).toContain(
    "AgentPreset declarations contain duplicate IDs",
  )
})
