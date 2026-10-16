import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import {
  buildProjectRunEnv,
  OPENCODE_HOST_AUTH_OPT_IN,
  OPENCODE_MODEL_E2E_OPT_IN,
  opencodeModelE2eOptInError,
} from "../scripts/e2e-opencode.js"

const temporaryRoots: string[] = []

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("OpenCode E2E is fail-closed in the default test path", () => {
  test("real-model opt-in requires an explicit model and separate host-auth consent", () => {
    expect(opencodeModelE2eOptInError({})).toContain(OPENCODE_MODEL_E2E_OPT_IN)
    expect(
      opencodeModelE2eOptInError({
        [OPENCODE_MODEL_E2E_OPT_IN]: "1",
        OPENCODE_E2E_MODEL: "fixture/no-provider-model",
      })
    ).toContain(OPENCODE_HOST_AUTH_OPT_IN)
    expect(
      opencodeModelE2eOptInError({
        [OPENCODE_MODEL_E2E_OPT_IN]: "1",
        [OPENCODE_HOST_AUTH_OPT_IN]: "1",
        OPENCODE_E2E_MODEL: "provider/model-explicitly-selected",
      })
    ).toBeUndefined()
  })

  test("buildProjectRunEnv does not inherit auth environment variables or copy host auth by default", () => {
    const root = tempRoot("dshbanca-opencode-auth-default-")
    const hostHome = join(root, "host")
    const isolatedHome = join(root, "isolated")
    const project = join(root, "project")
    const config = join(root, "isolated-config")
    const authFile = join(hostHome, ".local", "share", "opencode", "auth.json")
    mkdirSync(join(hostHome, ".local", "share", "opencode"), { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(authFile, JSON.stringify({ fixtureOnly: "not-a-real-credential" }))

    const env = buildProjectRunEnv(project, {
      isolateHome: isolatedHome,
      isolateConfigDir: config,
      hostHome,
      base: {
        PATH: process.env.PATH,
        OPENCODE_API_KEY: "fixture-api-key-not-valid",
        OPENCODE_AUTH_CONTENT: "fixture-auth-not-valid",
        OPENCODE_SERVER_PASSWORD: "fixture-password-not-valid",
        OPENCODE_SERVER_USERNAME: "fixture-user",
      },
    })

    expect(existsSync(join(isolatedHome, ".local", "share", "opencode", "auth.json"))).toBe(false)
    expect(env.OPENCODE_API_KEY).toBeUndefined()
    expect(env.OPENCODE_AUTH_CONTENT).toBeUndefined()
    expect(env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
    expect(env.OPENCODE_SERVER_USERNAME).toBeUndefined()
    expect(readFileSync(authFile, "utf8")).toContain("fixtureOnly")
  })

  test("buildProjectRunEnv copies fixture auth and auth env only after explicit seedAuth consent", () => {
    const root = tempRoot("dshbanca-opencode-auth-opt-in-")
    const hostHome = join(root, "host")
    const isolatedHome = join(root, "isolated")
    const project = join(root, "project")
    const config = join(root, "isolated-config")
    const authFile = join(hostHome, ".local", "share", "opencode", "auth.json")
    mkdirSync(join(hostHome, ".local", "share", "opencode"), { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(authFile, JSON.stringify({ fixtureOnly: "not-a-real-credential" }))

    const env = buildProjectRunEnv(project, {
      isolateHome: isolatedHome,
      isolateConfigDir: config,
      hostHome,
      seedAuth: true,
      base: { OPENCODE_API_KEY: "fixture-api-key-not-valid" },
    })

    expect(readFileSync(join(isolatedHome, ".local", "share", "opencode", "auth.json"), "utf8")).toContain("fixtureOnly")
    expect(env.OPENCODE_API_KEY).toBe("fixture-api-key-not-valid")
  })

  test("default bun test skips the model E2E even when an OpenCode stub and fake host auth are detectable", () => {
    const root = tempRoot("dshbanca-opencode-stub-")
    const hostHome = join(root, "host")
    const bin = join(root, "bin")
    const stub = join(bin, "opencode")
    const marker = join(root, "opencode-was-launched.json")
    mkdirSync(join(hostHome, ".local", "share", "opencode"), { recursive: true })
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(hostHome, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({ fixtureOnly: "not-a-real-credential" })
    )
    writeFileSync(
      stub,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nconst path = require("node:path");\nfs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({args: process.argv.slice(2), apiKeyInherited: Boolean(process.env.OPENCODE_API_KEY), authFilePresent: fs.existsSync(path.join(process.env.HOME || "", ".local/share/opencode/auth.json"))}));\nprocess.exit(0);\n`
    )
    chmodSync(stub, 0o755)

    const childEnv: NodeJS.ProcessEnv = {
      HOME: hostHome,
      OPENCODE_BIN: stub,
      OPENCODE_E2E_MODEL: "fixture/no-provider-model",
      OPENCODE_API_KEY: "fixture-api-key-not-valid",
      PATH: `${bin}:${process.env.PATH || ""}`,
      TMPDIR: root,
    }

    const child = spawnSync(
      process.execPath,
      [
        "test",
        "tests/e2e-opencode.test.ts",
        "--test-name-pattern",
        "real OpenCode: contaminated host config",
      ],
      { cwd: resolve("."), env: childEnv, encoding: "utf8", timeout: 120_000 }
    )
    const output = `${child.stdout || ""}\n${child.stderr || ""}`

    expect(child.error).toBeUndefined()
    expect(existsSync(marker)).toBe(false)
    if (existsSync(marker)) {
      const invocation = JSON.parse(readFileSync(marker, "utf8")) as {
        args: string[]
        apiKeyInherited: boolean
        authFilePresent: boolean
      }
      expect(invocation.args).not.toContain("run")
      expect(invocation.apiKeyInherited).toBe(false)
      expect(invocation.authFilePresent).toBe(false)
    }
    expect(child.status).toBe(0)
    expect(output).toMatch(/1 tests skipped|skip/i)
  })

  test("standalone runner exits BLOCKED before resolving or launching OpenCode without opt-in", () => {
    const root = tempRoot("dshbanca-opencode-runner-blocked-")
    const hostHome = join(root, "host")
    const bin = join(root, "bin")
    const stub = join(bin, "opencode")
    const marker = join(root, "opencode-was-launched.json")
    mkdirSync(join(hostHome, ".local", "share", "opencode"), { recursive: true })
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(hostHome, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({ fixtureOnly: "not-a-real-credential" })
    )
    writeFileSync(
      stub,
      `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "launched");\nprocess.exit(0);\n`
    )
    chmodSync(stub, 0o755)

    const child = spawnSync(process.execPath, ["scripts/e2e-opencode.ts"], {
      cwd: resolve("."),
      env: { HOME: hostHome, OPENCODE_BIN: stub, PATH: `${bin}:${process.env.PATH || ""}`, TMPDIR: root },
      encoding: "utf8",
      timeout: 15_000,
    })

    expect(child.error).toBeUndefined()
    expect(child.status).toBe(2)
    expect(`${child.stdout || ""}\n${child.stderr || ""}`).toContain("BLOCKED: OpenCode model E2E is disabled by default")
    expect(existsSync(marker)).toBe(false)
    expect(
      readFileSync(join(hostHome, ".local", "share", "opencode", "auth.json"), "utf8")
    ).toContain("fixtureOnly")
  })
})
