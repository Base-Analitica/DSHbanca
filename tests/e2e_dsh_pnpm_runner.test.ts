import { describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import {
  buildPnpmCommand,
  findPnpmCli,
  isExecutableFile,
  isJavaScriptCli,
  isNativeBinary,
  isOfflineMissingPnpmError,
  renderPnpmWrapper,
  resolvePnpmCandidate,
  shellQuote,
} from "../scripts/lib/dsh-profile-e2e-pnpm.js"

describe("DSH runner pnpm 12 native and JS CLI support (Issue #32)", () => {
  test("isNativeBinary identifies ELF header and rejects non-ELF text/scripts", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-binary-"))
    try {
      const elfFile = join(tempDir, "mock-elf")
      // ELF magic: 0x7f, 'E', 'L', 'F'
      writeFileSync(elfFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
      expect(isNativeBinary(elfFile)).toBe(true)

      const scriptFile = join(tempDir, "mock-script.sh")
      writeFileSync(scriptFile, "#!/bin/sh\necho hi\n")
      expect(isNativeBinary(scriptFile)).toBe(false)

      const emptyFile = join(tempDir, "empty")
      writeFileSync(emptyFile, Buffer.alloc(0))
      expect(isNativeBinary(emptyFile)).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("isJavaScriptCli recognizes .cjs, .mjs, and .js", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-js-"))
    try {
      const cjs = join(tempDir, "pnpm.cjs")
      const mjs = join(tempDir, "pnpm.mjs")
      const js = join(tempDir, "pnpm.js")
      const bin = join(tempDir, "pnpm-native")

      writeFileSync(cjs, "console.log('cjs')")
      writeFileSync(mjs, "console.log('mjs')")
      writeFileSync(js, "console.log('js')")
      writeFileSync(bin, "binary")

      expect(isJavaScriptCli(cjs)).toBe(true)
      expect(isJavaScriptCli(mjs)).toBe(true)
      expect(isJavaScriptCli(js)).toBe(true)
      expect(isJavaScriptCli(bin)).toBe(false)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("isExecutableFile verifies execute permissions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-exec-"))
    try {
      const execFile = join(tempDir, "run.sh")
      const nonExec = join(tempDir, "data.txt")
      writeFileSync(execFile, "#!/bin/sh\n")
      chmodSync(execFile, 0o755)
      writeFileSync(nonExec, "data")
      chmodSync(nonExec, 0o600)

      expect(isExecutableFile(execFile)).toBe(true)
      if (process.platform !== "win32") {
        expect(isExecutableFile(nonExec)).toBe(false)
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("resolvePnpmCandidate rejects Corepack shim dispatcher", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-corepack-"))
    try {
      const shimDir = join(tempDir, "corepack", "dist")
      mkdirSync(shimDir, { recursive: true })
      const shim = join(shimDir, "pnpm.js")
      writeFileSync(shim, "module.exports = {}")
      expect(resolvePnpmCandidate(shim, "system_path")).toBeUndefined()
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("resolvePnpmCandidate discovers native binary with package metadata", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-native-"))
    try {
      const pkgDir = join(tempDir, "v1", "pnpm", "12.14.0")
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
      const nativeBin = join(pkgDir, "pnpm-native")
      // Real ELF header
      writeFileSync(nativeBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
      chmodSync(nativeBin, 0o755)

      const resolution = resolvePnpmCandidate(nativeBin, "corepack_cache")
      expect(resolution).toBeDefined()
      expect(resolution?.kind).toBe("native")
      expect(resolution?.declaredVersion).toBe("12.14.0")
      expect(resolution?.executablePath).toBe(nativeBin)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("resolvePnpmCandidate discovers JavaScript entrypoint (.cjs/.mjs)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-js-pkg-"))
    try {
      const pkgDir = join(tempDir, "v1", "pnpm", "9.15.9")
      mkdirSync(join(pkgDir, "bin"), { recursive: true })
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "pnpm", version: "9.15.9" }))
      const cjsBin = join(pkgDir, "bin", "pnpm.cjs")
      writeFileSync(cjsBin, "console.log('pnpm 9')")

      const resolution = resolvePnpmCandidate(cjsBin, "corepack_cache")
      expect(resolution).toBeDefined()
      expect(resolution?.kind).toBe("javascript")
      expect(resolution?.declaredVersion).toBe("9.15.9")
      expect(resolution?.executablePath).toBe(cjsBin)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("findPnpmCli prioritizes latest version in Corepack cache and selects native binary", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-versions-"))
    try {
      const pnpmRoot = join(tempDir, "v1", "pnpm")
      const v9Dir = join(pnpmRoot, "9.15.9", "bin")
      const v12Dir = join(pnpmRoot, "12.14.0")
      mkdirSync(v9Dir, { recursive: true })
      mkdirSync(v12Dir, { recursive: true })

      writeFileSync(join(pnpmRoot, "9.15.9", "package.json"), JSON.stringify({ name: "pnpm", version: "9.15.9" }))
      writeFileSync(join(v9Dir, "pnpm.cjs"), "console.log('9')")

      writeFileSync(join(v12Dir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
      const native12 = join(v12Dir, "pnpm-native")
      writeFileSync(native12, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
      chmodSync(native12, 0o755)

      const result = findPnpmCli({ corepackHome: tempDir })
      expect(result).toBeDefined()
      expect(result?.kind).toBe("native")
      expect(result?.declaredVersion).toBe("12.14.0")
      expect(result?.executablePath).toBe(native12)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("findPnpmCli with explicit PNPM_BIN fails closed without fallback on invalid path", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-fail-closed-"))
    try {
      // Valid cache entry in Corepack
      const pnpmRoot = join(tempDir, "v1", "pnpm", "12.14.0")
      mkdirSync(pnpmRoot, { recursive: true })
      writeFileSync(join(pnpmRoot, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
      const native12 = join(pnpmRoot, "pnpm-native")
      writeFileSync(native12, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
      chmodSync(native12, 0o755)

      // When an invalid PNPM_BIN is specified, must return undefined (NO fallback to tempDir)
      const invalidPath = join(tempDir, "non-existent-pnpm")
      const result = findPnpmCli({ pnpmBin: invalidPath, corepackHome: tempDir })
      expect(result).toBeUndefined()
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("buildPnpmCommand differentiates native vs javascript invocation", () => {
    const nativeRes = {
      kind: "native" as const,
      executablePath: "/opt/pnpm/pnpm-native",
      source: "corepack_cache" as const,
    }
    const jsRes = {
      kind: "javascript" as const,
      executablePath: "/opt/pnpm/bin/pnpm.mjs",
      source: "corepack_cache" as const,
    }

    const nativeCmd = buildPnpmCommand(nativeRes, "/usr/bin/node", ["--version"])
    expect(nativeCmd.command).toBe("/opt/pnpm/pnpm-native")
    expect(nativeCmd.args).toEqual(["--version"])

    const jsCmd = buildPnpmCommand(jsRes, "/usr/bin/node", ["--version"])
    expect(jsCmd.command).toBe("/usr/bin/node")
    expect(jsCmd.args).toEqual(["/opt/pnpm/bin/pnpm.mjs", "--version"])
  })

  test("renderPnpmWrapper formats secure POSIX wrapper without command injection", () => {
    const nativeRes = {
      kind: "native" as const,
      executablePath: "/opt/pnpm path with spaces/pnpm-native",
      source: "corepack_cache" as const,
    }
    const jsRes = {
      kind: "javascript" as const,
      executablePath: "/opt/pnpm/pnpm's script.cjs",
      source: "pnpm_bin" as const,
    }

    const nativeWrapper = renderPnpmWrapper(nativeRes, "/usr/bin/node")
    expect(nativeWrapper).toContain("#!/bin/sh\n")
    expect(nativeWrapper).toContain("exec '/opt/pnpm path with spaces/pnpm-native' \"$@\"\n")

    const jsWrapper = renderPnpmWrapper(jsRes, "/usr/bin/node")
    expect(jsWrapper).toContain("#!/bin/sh\n")
    expect(jsWrapper).toContain("exec '/usr/bin/node' '/opt/pnpm/pnpm'\\''s script.cjs' \"$@\"\n")
  })

  test("wrapper execution preserves arguments with spaces and special characters", () => {
    if (process.platform === "win32") return
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-wrapper-exec-"))
    try {
      const echoScript = join(tempDir, "echo-args.sh")
      writeFileSync(echoScript, `#!/bin/sh\nfor arg in "$@"; do echo "ARG:$arg"; done\n`)
      chmodSync(echoScript, 0o755)

      const resolution = {
        kind: "native" as const,
        executablePath: echoScript,
        source: "pnpm_bin" as const,
      }
      const wrapperScript = join(tempDir, "pnpm")
      writeFileSync(wrapperScript, renderPnpmWrapper(resolution, "/usr/bin/node"))
      chmodSync(wrapperScript, 0o755)

      const result = spawnSync(wrapperScript, ["hello world", "arg with 'quotes'", "semi;colon"], {
        encoding: "utf8",
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain("ARG:hello world\n")
      expect(result.stdout).toContain("ARG:arg with 'quotes'\n")
      expect(result.stdout).toContain("ARG:semi;colon\n")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("isOfflineMissingPnpmError classifies offline missing tarball and store errors", () => {
    expect(isOfflineMissingPnpmError("ERR_PNPM_NO_OFFLINE_TARBALL No matching version found for foo offline")).toBe(true)
    expect(isOfflineMissingPnpmError("ERR_PNPM_FETCH GET https://registry.npmjs.org/foo failed: ENOTFOUND")).toBe(true)
    expect(isOfflineMissingPnpmError("Package @deepseek-ai/dsh is not available in the store")).toBe(true)
    expect(isOfflineMissingPnpmError("ERR_PNPM_ADDING_TO_ROOT Cannot add dependency to root")).toBe(false)
    expect(isOfflineMissingPnpmError("SyntaxError: Unexpected token")).toBe(false)
  })

  test("shellQuote handles empty, spaces, and single quotes safely", () => {
    expect(shellQuote("")).toBe("''")
    expect(shellQuote("simple")).toBe("'simple'")
    expect(shellQuote("with spaces")).toBe("'with spaces'")
    expect(shellQuote("don't fail")).toBe("'don'\\''t fail'")
  })

  test("findPnpmCli discovers pnpm 12 with bin/pnpm.mjs when pnpm-native is absent", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-mjs12-"))
    try {
      const pnpmRoot = join(tempDir, "v1", "pnpm")
      const v12Dir = join(pnpmRoot, "12.14.0")
      mkdirSync(join(v12Dir, "bin"), { recursive: true })
      writeFileSync(join(v12Dir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
      const mjs12 = join(v12Dir, "bin", "pnpm.mjs")
      writeFileSync(mjs12, "console.log('12 mjs')")

      const result = findPnpmCli({ corepackHome: tempDir })
      expect(result).toBeDefined()
      expect(result?.kind).toBe("javascript")
      expect(result?.declaredVersion).toBe("12.14.0")
      expect(result?.executablePath).toBe(mjs12)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("Host discovery resolves pnpm when present or returns undefined fail-closed when absent", () => {
    const hostResolution = findPnpmCli()
    if (hostResolution) {
      expect(["native", "javascript"]).toContain(hostResolution.kind)
      expect(typeof hostResolution.executablePath).toBe("string")
      if (hostResolution.declaredVersion) {
        expect(typeof hostResolution.declaredVersion).toBe("string")
      }
    } else {
      // In bare CI environments without provisioned Corepack cache or PNPM_BIN, fails closed safely
      expect(hostResolution).toBeUndefined()
    }
  })

  describe("Package identity and provenance verification (Issue #32 P1)", () => {
    test("rejects arbitrary JavaScript script without package.json manifest", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-unrelated-"))
      try {
        const unrelatedJs = join(tempDir, "unrelated.js")
        writeFileSync(unrelatedJs, "console.log('12.14.0');\n")

        // 1. resolvePnpmCandidate must reject unmanifested JS
        const candidate = resolvePnpmCandidate(unrelatedJs, "pnpm_bin")
        expect(candidate).toBeUndefined()

        // 2. findPnpmCli with PNPM_BIN pointing to it must return undefined
        const fromEnv = findPnpmCli({ pnpmBin: unrelatedJs })
        expect(fromEnv).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects script when package.json name is not 'pnpm'", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-wrong-pkg-"))
      try {
        writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "not-pnpm", version: "12.14.0" }))
        const script = join(tempDir, "pnpm.cjs")
        writeFileSync(script, "console.log('12.14.0');\n")

        expect(resolvePnpmCandidate(script, "pnpm_bin")).toBeUndefined()
        expect(findPnpmCli({ pnpmBin: script })).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects native ELF binary when not part of a verified pnpm package", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-orphan-elf-"))
      try {
        const elfFile = join(tempDir, "custom-elf")
        writeFileSync(elfFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
        chmodSync(elfFile, 0o755)

        expect(resolvePnpmCandidate(elfFile, "pnpm_bin")).toBeUndefined()
        expect(findPnpmCli({ pnpmBin: elfFile })).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects Corepack cache entry when package.json version disagrees with directory version", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-version-mismatch-"))
      try {
        const pnpmRoot = join(tempDir, "v1", "pnpm")
        const v12Dir = join(pnpmRoot, "12.14.0")
        mkdirSync(v12Dir, { recursive: true })
        // Directory claims 12.14.0, but manifest says 9.15.9
        writeFileSync(join(v12Dir, "package.json"), JSON.stringify({ name: "pnpm", version: "9.15.9" }))
        const nativeBin = join(v12Dir, "pnpm-native")
        writeFileSync(nativeBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
        chmodSync(nativeBin, 0o755)

        const result = findPnpmCli({ corepackHome: tempDir })
        expect(result).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects candidate when entrypoint is outside the verified package root", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-outside-root-"))
      try {
        const pkgDir = join(tempDir, "pnpm-pkg")
        const outsideDir = join(tempDir, "outside")
        mkdirSync(pkgDir, { recursive: true })
        mkdirSync(outsideDir, { recursive: true })

        writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
        const outsideScript = join(outsideDir, "outside.js")
        writeFileSync(outsideScript, "console.log('outside');\n")

        expect(resolvePnpmCandidate(outsideScript, "pnpm_bin")).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects invalid PNPM_BIN without falling back even when valid Corepack cache exists", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-no-fallback-"))
      try {
        // Create valid cache entry
        const pnpmRoot = join(tempDir, "v1", "pnpm")
        const v12Dir = join(pnpmRoot, "12.14.0")
        mkdirSync(v12Dir, { recursive: true })
        writeFileSync(join(v12Dir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
        const nativeBin = join(v12Dir, "pnpm-native")
        writeFileSync(nativeBin, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]))
        chmodSync(nativeBin, 0o755)

        // Point PNPM_BIN to a non-existent or invalid file
        const invalidBin = join(tempDir, "fake.js")
        writeFileSync(invalidBin, "console.log('fake');\n")

        const result = findPnpmCli({ pnpmBin: invalidBin, corepackHome: tempDir })
        expect(result).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects package with missing or empty version field", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-empty-version-"))
      try {
        writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "pnpm", version: "" }))
        const script = join(tempDir, "bin", "pnpm.cjs")
        mkdirSync(join(tempDir, "bin"), { recursive: true })
        writeFileSync(script, "console.log('empty version');\n")

        expect(resolvePnpmCandidate(script, "pnpm_bin")).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects package with malformed package.json syntax", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-malformed-json-"))
      try {
        writeFileSync(join(tempDir, "package.json"), "{ invalid json: true, ")
        const script = join(tempDir, "bin", "pnpm.cjs")
        mkdirSync(join(tempDir, "bin"), { recursive: true })
        writeFileSync(script, "console.log('malformed');\n")

        expect(resolvePnpmCandidate(script, "pnpm_bin")).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects arbitrary internal script not declared in official entrypoints or bin field", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-arbitrary-entry-"))
      try {
        writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0", bin: { pnpm: "pnpm" } }))
        const arbitraryScript = join(tempDir, "subfolder", "random.js")
        mkdirSync(join(tempDir, "subfolder"), { recursive: true })
        writeFileSync(arbitraryScript, "console.log('random');\n")

        expect(resolvePnpmCandidate(arbitraryScript, "pnpm_bin")).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    test("rejects symlink inside package root pointing to outside target", () => {
      if (process.platform === "win32") return
      const tempDir = mkdtempSync(join(tmpdir(), "pnpm-test-symlink-escape-"))
      try {
        const pkgDir = join(tempDir, "pkg")
        const outsideDir = join(tempDir, "outside")
        mkdirSync(pkgDir, { recursive: true })
        mkdirSync(outsideDir, { recursive: true })

        writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "pnpm", version: "12.14.0" }))
        const outsideTarget = join(outsideDir, "target.js")
        writeFileSync(outsideTarget, "console.log('outside target');\n")

        const symlinkPath = join(pkgDir, "pnpm.cjs")
        symlinkSync(outsideTarget, symlinkPath)

        expect(resolvePnpmCandidate(symlinkPath, "pnpm_bin")).toBeUndefined()
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })
})
