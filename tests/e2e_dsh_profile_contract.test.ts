import { describe, expect, test } from "bun:test"
import {
  expectedTools,
  failureExitCode,
  missingHostExitCode,
  passExitCode,
  validateEvidence,
  validateProfileEvidence,
} from "../scripts/lib/dsh-profile-e2e-contract.js"

const completeProfile = {
  profileManifestHasBundle: true,
  profileManifestHasObserver: true,
  composedEntry: true,
  entrypointResolved: true,
}

const completeRuntime = {
  profileRuntime: true,
  lifecycle: "observer Cordis apply reached after DSHbanca registrations",
  toolNames: [...expectedTools],
  exactToolSet: true,
  skillFound: true,
  executedTools: ["banca_init", "banca_status"],
  statusSucceeded: true,
  statusReadOnly: true,
  workspaceInventoryBeforeStatus: { "main.tex": "sha256:a", ".banca/state.json": "sha256:b" },
  workspaceInventoryAfterStatus: { "main.tex": "sha256:a", ".banca/state.json": "sha256:b" },
}

describe("DSH profile E2E evidence contract", () => {
  test("accepts complete profile composition and runtime evidence", () => {
    expect(validateProfileEvidence(completeProfile)).toEqual([])
    expect(validateEvidence(completeRuntime)).toEqual([])
  })

  test.each([
    ["bundle absent", { ...completeProfile, profileManifestHasBundle: false }, "profile bundle entry missing"],
    ["entrypoint unresolved", { ...completeProfile, entrypointResolved: false }, "plugin entrypoint did not resolve in profile node_modules"],
    ["composition absent", { ...completeProfile, composedEntry: false }, "Cordis composition entry missing"],
  ])("rejects %s", (_label, evidence, expectedError) => {
    expect(validateProfileEvidence(evidence)).toContain(expectedError)
  })

  test.each([
    ["lifecycle absent", { ...completeRuntime, profileRuntime: false, lifecycle: undefined }, "profile runtime was not observed"],
    ["tool discovery incomplete", { ...completeRuntime, toolNames: expectedTools.slice(1) }, "tool discovery is incomplete or contains unexpected banca tools"],
    ["skill missing", { ...completeRuntime, skillFound: false }, "banca-avaliacao skill was not discovered"],
    ["tool execution absent", { ...completeRuntime, executedTools: ["banca_init"] }, "banca_status did not execute through the profile runtime"],
    ["tool result unsuccessful", { ...completeRuntime, statusSucceeded: false }, "banca_status did not succeed"],
    ["status mutates files", { ...completeRuntime, statusReadOnly: false }, "banca_status modified synthetic workspace state"],
    ["inventory differs", { ...completeRuntime, workspaceInventoryAfterStatus: { "main.tex": "sha256:changed" } }, "filesystem inventory differs across banca_status"],
  ])("rejects %s", (_label, evidence, expectedError) => {
    expect(validateEvidence(evidence)).toContain(expectedError)
  })

  test("uses distinct exit codes so unavailable DSH cannot pass", () => {
    expect(passExitCode()).toBe(0)
    expect(failureExitCode()).toBe(1)
    expect(missingHostExitCode()).toBe(2)
  })
})
