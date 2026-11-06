import { describe, expect, test } from "bun:test"
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { delimiter, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import {
  DSH_NATIVE_TEST_AUTHORIZATION_ENV,
  DSH_TEST_HOST_PACKAGE_ENV,
  selectDshNativeTestGate,
} from "./dsh-native-test-gate"

const fakeImportMarkerName = "host-imported.marker"
const fakeWhichMarkerName = "which-called.marker"
const fakeDshMarkerName = "dsh-executed.marker"

type Fixture = {
  root: string
  toolsBin: string
  fakeHostBin: string
  hostPackage: string
  fakeDsh: string
}

function findExecutable(name: string): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue searching the current PATH without executing the candidate.
    }
  }
  throw new Error(`Required local executable is unavailable: ${name}`)
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "dshbanca-native-gate-"))
  const toolsBin = join(root, "tools")
  const hostRoot = join(root, "synthetic-host")
  const fakeHostBin = join(hostRoot, "bin")
  const hostPackage = join(hostRoot, "package.json")
  const cordisPackage = join(hostRoot, "node_modules", "@deepseek-ai", "cordis")
  const fakeDsh = join(fakeHostBin, "dsh")

  mkdirSync(toolsBin, { recursive: true })
  mkdirSync(join(root, "home"), { recursive: true })
  mkdirSync(join(root, "tmp"), { recursive: true })
  mkdirSync(fakeHostBin, { recursive: true })
  mkdirSync(cordisPackage, { recursive: true })
  symlinkSync(process.execPath, join(toolsBin, "bun"))
  symlinkSync(findExecutable("node"), join(toolsBin, "node"))

  writeFileSync(hostPackage, JSON.stringify({ name: "dsh", version: "0.0.0-synthetic" }))
  writeFileSync(
    join(cordisPackage, "package.json"),
    JSON.stringify({ name: "@deepseek-ai/cordis", type: "module", exports: "./index.js" }),
  )
  writeFileSync(
    join(cordisPackage, "index.js"),
    'import { writeFileSync } from "node:fs";\n' +
      'writeFileSync(process.env.DSH_TEST_FIXTURE_IMPORT_MARKER, "synthetic Cordis import reached");\n' +
      "export class Context {}\n",
  )
  writeFileSync(
    fakeDsh,
    '#!/bin/sh\nprintf "executed\\n" > "$DSH_TEST_FIXTURE_DSH_INVOKED_MARKER"\nexit 99\n',
  )
  chmodSync(fakeDsh, 0o755)
  writeFileSync(
    join(fakeHostBin, "which"),
    '#!/bin/sh\nprintf "called\\n" > "$DSH_TEST_FIXTURE_WHICH_MARKER"\n' +
      'if [ "$1" = "dsh" ]; then printf "%s\\n" "$DSH_TEST_FIXTURE_DSH_PATH"; exit 0; fi\n' +
      "exit 1\n",
  )
  chmodSync(join(fakeHostBin, "which"), 0o755)

  return { root, toolsBin, fakeHostBin, hostPackage, fakeDsh }
}

function runHermeticTestFile(
  fixture: Fixture,
  testFile: string,
  options: {
    includeFakeDsh?: boolean
    authorization?: string
    hostPackage?: string
  } = {},
) {
  const fakeImportMarker = join(fixture.root, fakeImportMarkerName)
  const fakeWhichMarker = join(fixture.root, fakeWhichMarkerName)
  const fakeDshMarker = join(fixture.root, fakeDshMarkerName)
  const env: NodeJS.ProcessEnv = {
    PATH: options.includeFakeDsh
      ? `${fixture.toolsBin}${delimiter}${fixture.fakeHostBin}`
      : fixture.toolsBin,
    HOME: join(fixture.root, "home"),
    TMPDIR: join(fixture.root, "tmp"),
    DSH_TEST_FIXTURE_IMPORT_MARKER: fakeImportMarker,
    DSH_TEST_FIXTURE_WHICH_MARKER: fakeWhichMarker,
    DSH_TEST_FIXTURE_DSH_INVOKED_MARKER: fakeDshMarker,
    DSH_TEST_FIXTURE_DSH_PATH: fixture.fakeDsh,
  }
  if (options.authorization !== undefined) {
    env[DSH_NATIVE_TEST_AUTHORIZATION_ENV] = options.authorization
  }
  if (options.hostPackage !== undefined) {
    env[DSH_TEST_HOST_PACKAGE_ENV] = options.hostPackage
  }

  const result = spawnSync(process.execPath, ["test", testFile], {
    cwd: resolve("."),
    encoding: "utf8",
    env,
    timeout: 120_000,
  })
  return { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker }
}

function runHermeticDshTest(
  fixture: Fixture,
  options: {
    includeFakeDsh?: boolean
    authorization?: string
    hostPackage?: string
  } = {},
) {
  return runHermeticTestFile(fixture, "tests/dsh.test.ts", options)
}

describe("native DSH test authorization gate", () => {
  test("the default mode ignores PATH and reports no native proof", () => {
    expect(selectDshNativeTestGate({ PATH: "/synthetic/bin/dsh" })).toEqual({ mode: "none" })
  })

  test("only the exact authorization and an absolute package path select native mode", () => {
    expect(
      selectDshNativeTestGate({
        [DSH_NATIVE_TEST_AUTHORIZATION_ENV]: "yes",
        [DSH_TEST_HOST_PACKAGE_ENV]: "/inspected/dsh/package.json",
      }),
    ).toEqual({ mode: "authorized", hostPackage: "/inspected/dsh/package.json" })
  })

  test("an incomplete or malformed opt-in is blocked without selecting native mode", () => {
    expect(selectDshNativeTestGate({ [DSH_TEST_HOST_PACKAGE_ENV]: "/synthetic/package.json" }).mode)
      .toBe("blocked")
    expect(selectDshNativeTestGate({ [DSH_NATIVE_TEST_AUTHORIZATION_ENV]: "yes" }).mode)
      .toBe("blocked")
    expect(
      selectDshNativeTestGate({
        [DSH_NATIVE_TEST_AUTHORIZATION_ENV]: "true",
        [DSH_TEST_HOST_PACKAGE_ENV]: "/synthetic/package.json",
      }).mode,
    ).toBe("blocked")
    expect(
      selectDshNativeTestGate({
        [DSH_NATIVE_TEST_AUTHORIZATION_ENV]: "yes",
        [DSH_TEST_HOST_PACKAGE_ENV]: "relative/package.json",
      }).mode,
    ).toBe("blocked")
  })

  test("DSH absent: the hermetic bundle and workspace test reports NATIVE_NONE", () => {
    const fixture = createFixture()
    try {
      const { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker } = runHermeticDshTest(fixture)
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("NATIVE_NONE")
      expect(result.stdout).not.toContain("NATIVE_GUARD_PASS")
      expect(existsSync(fakeImportMarker)).toBe(false)
      expect(existsSync(fakeWhichMarker)).toBe(false)
      expect(existsSync(fakeDshMarker)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      expect(existsSync(fixture.root)).toBe(false)
    }
  })

  test("a synthetic dsh on PATH is neither queried, executed, nor imported", () => {
    const fixture = createFixture()
    try {
      const { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker } = runHermeticDshTest(
        fixture,
        { includeFakeDsh: true },
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("NATIVE_NONE")
      expect(result.stdout).not.toContain("NATIVE_GUARD_PASS")
      expect(existsSync(fakeImportMarker)).toBe(false)
      expect(existsSync(fakeWhichMarker)).toBe(false)
      expect(existsSync(fakeDshMarker)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      expect(existsSync(fixture.root)).toBe(false)
    }
  })

  test("DSH_TEST_HOST_PACKAGE alone is blocked and never imports the synthetic Host", () => {
    const fixture = createFixture()
    try {
      const { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker } = runHermeticDshTest(
        fixture,
        { includeFakeDsh: true, hostPackage: fixture.hostPackage },
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("NATIVE_BLOCKED")
      expect(result.stdout).not.toContain("NATIVE_GUARD_PASS")
      expect(existsSync(fakeImportMarker)).toBe(false)
      expect(existsSync(fakeWhichMarker)).toBe(false)
      expect(existsSync(fakeDshMarker)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      expect(existsSync(fixture.root)).toBe(false)
    }
  })

  test("authorization alone is blocked and cannot activate a PATH fixture", () => {
    const fixture = createFixture()
    try {
      const { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker } = runHermeticDshTest(
        fixture,
        { includeFakeDsh: true, authorization: "yes" },
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("NATIVE_BLOCKED")
      expect(result.stdout).not.toContain("NATIVE_GUARD_PASS")
      expect(existsSync(fakeImportMarker)).toBe(false)
      expect(existsSync(fakeWhichMarker)).toBe(false)
      expect(existsSync(fakeDshMarker)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      expect(existsSync(fixture.root)).toBe(false)
    }
  })

  test("malformed opt-in is blocked before any synthetic Host import", () => {
    const fixture = createFixture()
    try {
      const { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker } = runHermeticDshTest(
        fixture,
        {
          includeFakeDsh: true,
          authorization: "yes",
          hostPackage: "relative/package.json",
        },
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("NATIVE_BLOCKED")
      expect(result.stdout).not.toContain("NATIVE_GUARD_PASS")
      expect(existsSync(fakeImportMarker)).toBe(false)
      expect(existsSync(fakeWhichMarker)).toBe(false)
      expect(existsSync(fakeDshMarker)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      expect(existsSync(fixture.root)).toBe(false)
    }
  })

  test("academic-decision native tests also ignore DSH_TEST_HOST_PACKAGE without authorization", () => {
    const fixture = createFixture()
    try {
      const { result, fakeImportMarker, fakeWhichMarker, fakeDshMarker } = runHermeticTestFile(
        fixture,
        "tests/academic_decision.test.ts",
        { includeFakeDsh: true, hostPackage: fixture.hostPackage },
      )
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain("NATIVE_GUARD_PASS")
      expect(existsSync(fakeImportMarker)).toBe(false)
      expect(existsSync(fakeWhichMarker)).toBe(false)
      expect(existsSync(fakeDshMarker)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
      expect(existsSync(fixture.root)).toBe(false)
    }
  })
})
