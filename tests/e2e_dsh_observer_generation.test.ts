import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { expectedTools } from "../scripts/lib/dsh-profile-e2e-contract.js"
import { e2eControlPresetId } from "../scripts/lib/dsh-profile-e2e-presets.js"
import { renderControlPresetSelector } from "../scripts/lib/dsh-profile-e2e-observer-control.js"

test("actual generated observer module binds the control preset ID without runner scope", async () => {
  const runnerSource = readFileSync("scripts/e2e-dsh-profile.ts", "utf8")
  expect(runnerSource).toContain("${renderControlPresetSelector(e2eControlPresetId)}")
  expect(runnerSource).not.toContain("ctx.agentPresets.select(controlAgent, e2eControlPresetId);")
  const templateStart = runnerSource.indexOf("const observerSource = `")
  const contentStart = templateStart + "const observerSource = `".length
  const contentEnd = runnerSource.indexOf("\n`\n  writeFileSync(join(observerRoot, \"index.js\"), observerSource", contentStart)
  expect(templateStart).toBeGreaterThanOrEqual(0)
  expect(contentEnd).toBeGreaterThan(contentStart)
  const template = runnerSource.slice(contentStart, contentEnd)
  const renderObserver = new Function(
    "observerName", "expectedTools", "auditorMarkdownSourceSha256", "auditorMarkdownSourceSha1",
    "workspace", "observerResult", "renderControlPresetSelector", "e2eControlPresetId",
    `return \`${template}\`;`,
  ) as (...args: unknown[]) => string
  const generatedModuleSource = renderObserver(
    "dshbanca-e2e-observer", expectedTools, "source-sha256", "source-sha1",
    "/tmp/synthetic-workspace", "/tmp/observer-result.json", renderControlPresetSelector, e2eControlPresetId,
  )
  expect(generatedModuleSource).toContain('const e2eControlPresetId = "dshbanca-e2e-control-neutral";')

  const directory = mkdtempSync(join(tmpdir(), "dshbanca-observer-source-"))
  const modulePath = join(directory, "observer-control.mjs")
  const brokenModulePath = join(directory, "observer-control-with-runner-scope-bug.mjs")
  try {
    writeFileSync(modulePath, generatedModuleSource, { mode: 0o600 })
    const generatedModule = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)
    expect(typeof generatedModule.apply).toBe("function")
    const agent = { id: "control-agent", ctx: {} }
    let selectedId: string | undefined
    const ctx = {
      agentPresets: {
        async select(_agent: unknown, id: string) {
          selectedId = id
          return id
        },
        composedPreset() { return selectedId },
      },
    }

    await expect(generatedModule.selectControlPreset(ctx, agent)).resolves.toBe("dshbanca-e2e-control-neutral")
    expect(selectedId).toBe("dshbanca-e2e-control-neutral")


    // Installed @deepseek-ai/dsh-agent-instructions uses syncInbox() when a
    // downstream pre-step listener rejects, rather than decision.messages.
    // Verify observation can prove a native message queued in nextStep without
    // falsely allowing any model-facing step.
    const auditorInstruction = {
      id: "native-auditor-instruction-1",
      role: "user",
      source: {
        kind: "agent-instructions",
        changes: [{ path: "banca-auditor.md", digest: "canonical-sha1" }],
      },
    }
    const queued = generatedModule.captureNativeInstructionMessages([], [auditorInstruction])
    expect(queued).toEqual([{ channel: "post-reject-inbox", message: auditorInstruction }])
    expect(generatedModule.captureNativeInstructionMessages([auditorInstruction], [auditorInstruction]))
      .toEqual([{ channel: "pre-step-decision", message: auditorInstruction }])
    expect(generatedModule.captureNativeInstructionMessages([], [
      { ...auditorInstruction, source: { kind: "agent-instructions", changes: [{ path: "AGENTS.md" }] } },
    ])).toEqual([])
    expect(generatedModule.captureNativeInstructionMessages([], [])).toEqual([])
    // The neutral control must receive ZERO native instructions, including
    // unrelated AGENTS.md messages, not merely zero banca-auditor.md copies.
    const unrelatedInstruction = {
      ...auditorInstruction,
      id: "unrelated-instruction",
      source: { kind: "agent-instructions", changes: [{ path: "AGENTS.md" }] },
    }
    expect(generatedModule.captureNativeInstructionMessages([], [unrelatedInstruction], null))
      .toEqual([{ channel: "post-reject-inbox", message: unrelatedInstruction }])

    // Negative control: remove the exact serialized module-local binding. This
    // reproduces the reviewed free-reference failure in generated JavaScript.
    const brokenModuleSource = generatedModuleSource.replace(
      'const e2eControlPresetId = "dshbanca-e2e-control-neutral";\n',
      "",
    )
    expect(brokenModuleSource).not.toContain("const e2eControlPresetId =")
    writeFileSync(brokenModulePath, brokenModuleSource, { mode: 0o600 })
    const brokenModule = await import(`${pathToFileURL(brokenModulePath).href}?test=${Date.now()}`)
    await expect(brokenModule.selectControlPreset(ctx, agent)).rejects.toThrow(/e2eControlPresetId is not defined/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
