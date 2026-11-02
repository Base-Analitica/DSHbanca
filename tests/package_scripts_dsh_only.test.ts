import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("package.json scripts - DSH-only manifest", () => {
  const pkgPath = join(import.meta.dir, "..", "package.json")
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))

  test("manifest provides the native DSH profile E2E script", () => {
    expect(pkg.scripts).toBeDefined()
    expect(pkg.scripts["e2e:dsh:profile"]).toBe("bun run scripts/e2e-dsh-profile.ts")
  })

  test("manifest rejects legacy operational e2e opencode scripts", () => {
    const scripts = pkg.scripts ?? {}
    expect(scripts["e2e:opencode"]).toBeUndefined()

    const opencodeE2eScriptKeys = Object.keys(scripts).filter((key) =>
      /^e2e:.*opencode/i.test(key),
    )
    expect(opencodeE2eScriptKeys).toEqual([])

    const anyOpencodeScriptKeys = Object.keys(scripts).filter((key) =>
      /opencode/i.test(key),
    )
    expect(anyOpencodeScriptKeys).toEqual([])

    const opencodeScriptValues = Object.entries(scripts).filter(([, cmd]) =>
      typeof cmd === "string" && /scripts\/e2e-opencode\.ts/i.test(cmd),
    )
    expect(opencodeScriptValues).toEqual([])
  })

  test("manifest preserves essential development and validation scripts", () => {
    const scripts = pkg.scripts ?? {}
    expect(scripts["build"]).toBeDefined()
    expect(scripts["test"]).toBe("bun test")
    expect(scripts["typecheck"]).toBe("tsc --noEmit")
    expect(scripts["validate:skills"]).toBe("bun run scripts/validate-skills.ts")
    expect(scripts["validate:agents"]).toBe("bun run scripts/validate-agents.ts")
  })
})
