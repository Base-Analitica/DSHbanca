import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export type PnpmCliKind = "native" | "javascript"

export interface PnpmResolution {
  kind: PnpmCliKind
  executablePath: string
  packageRoot: string
  declaredVersion: string
  source: "pnpm_bin" | "corepack_cache" | "system_path"
}

export interface PnpmPackageMetadata {
  packageRoot: string
  declaredVersion: string
  binEntries: string[]
}

export interface PnpmFindOptions {
  pnpmBin?: string
  corepackHome?: string
  cacheRoots?: string[]
  pathEnv?: string
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

/**
 * Checks whether the file has a native binary executable header (ELF, Mach-O, or PE).
 */
export function isNativeBinary(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile() || stat.size < 4) return false

    const fd = openSync(filePath, "r")
    const buffer = Buffer.alloc(4)
    const bytesRead = readSync(fd, buffer, 0, 4, 0)
    closeSync(fd)
    if (bytesRead < 4) return false

    // Linux ELF: 0x7F 'E' 'L' 'F'
    if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      return true
    }
    // Mach-O (macOS): 32/64 bit big/little endian, universal binary
    const b0 = buffer[0], b1 = buffer[1], b2 = buffer[2], b3 = buffer[3]
    if (
      (b0 === 0xfe && b1 === 0xed && b2 === 0xfa && (b3 === 0xce || b3 === 0xcf)) ||
      (b3 === 0xfe && b2 === 0xed && b1 === 0xfa && (b0 === 0xce || b0 === 0xcf)) ||
      (b0 === 0xca && b1 === 0xfe && b2 === 0xba && b3 === 0xbe)
    ) {
      return true
    }
    // Windows PE: 'M' 'Z'
    if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Checks whether the file is a JavaScript CLI script (.cjs, .mjs, or .js).
 */
export function isJavaScriptCli(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return false
    const lower = filePath.toLowerCase()
    return lower.endsWith(".cjs") || lower.endsWith(".mjs") || lower.endsWith(".js")
  } catch {
    return false
  }
}

/**
 * Checks whether the file has execution permission.
 */
export function isExecutableFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return false
    if (process.platform === "win32") return true
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Checks whether the file is a Corepack shim dispatcher rather than a self-contained pnpm CLI.
 */
export function isCorepackShim(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/")
  return normalized.includes("/corepack/dist/") || normalized.endsWith("/corepack/dist/pnpm.js")
}

/**
 * Finds and verifies a legitimate pnpm package manifest enclosing `cliPath`.
 * Enforces:
 * 1. Nearest package.json must exist and have name === "pnpm".
 * 2. Manifest must have a non-empty string version.
 * 3. cliPath must be strictly within packageRoot (preventing symlink escaping).
 * 4. cliPath must be a recognized official entrypoint or declared bin entry.
 */
export function findVerifiedPnpmPackage(cliPath: string): PnpmPackageMetadata | undefined {
  let current = dirname(cliPath)
  for (let depth = 0; depth < 5; depth++) {
    const manifestPath = join(current, "package.json")
    if (existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(readFileSync(manifestPath, "utf8"))
        // Fail closed immediately if enclosing package is not named 'pnpm'
        if (parsed?.name !== "pnpm") {
          return undefined
        }
        if (typeof parsed.version !== "string" || !parsed.version.trim()) {
          return undefined
        }

        const packageRoot = realpathSync(current)
        const resolvedCli = realpathSync(cliPath)

        // Ensure resolvedCli is confined inside packageRoot
        const rel = relative(packageRoot, resolvedCli)
        if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
          return undefined
        }

        const normalizedRel = rel.replaceAll("\\", "/")
        const allowedRelativePaths = new Set<string>([
          "pnpm",
          "pnpm.exe",
          "pnpm-native",
          "pnpm-native.exe",
          "pn",
          "pn.exe",
          "bin/pnpm.cjs",
          "bin/pnpm.mjs",
          "bin/pnpm.js",
          "bin/pnpm",
          "dist/pnpm.cjs",
          "dist/pnpm.js",
          "pnpm.cjs",
          "pnpm.mjs",
          "pnpm.js",
        ])

        if (typeof parsed.bin === "string") {
          allowedRelativePaths.add(parsed.bin.replace(/^\.\//, "").replaceAll("\\", "/"))
        } else if (typeof parsed.bin === "object" && parsed.bin !== null) {
          for (const target of Object.values(parsed.bin)) {
            if (typeof target === "string") {
              allowedRelativePaths.add(target.replace(/^\.\//, "").replaceAll("\\", "/"))
            }
          }
        }

        if (!allowedRelativePaths.has(normalizedRel)) {
          return undefined
        }

        return {
          packageRoot,
          declaredVersion: parsed.version.trim(),
          binEntries: Array.from(allowedRelativePaths),
        }
      } catch {
        return undefined
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/**
 * Resolves and validates a candidate pnpm executable path.
 * Requires verifiable package identity before accepting.
 */
export function resolvePnpmCandidate(
  candidatePath: string,
  source: PnpmResolution["source"],
  expectedVersion?: string,
): PnpmResolution | undefined {
  if (!candidatePath || typeof candidatePath !== "string") return undefined
  const resolved = resolve(candidatePath)
  if (!existsSync(resolved)) return undefined

  let realPath: string
  try {
    const stat = statSync(resolved)
    if (!stat.isFile()) return undefined
    realPath = realpathSync(resolved)
  } catch {
    return undefined
  }

  // Reject Corepack shim dispatchers which require network/Corepack activation
  if (isCorepackShim(realPath)) return undefined

  // Strict: candidate MUST belong to a verified pnpm package distribution
  const pkg = findVerifiedPnpmPackage(realPath)
  if (!pkg) return undefined

  // If an expected version is specified (e.g. from Corepack cache directory name),
  // the package manifest version must match
  if (expectedVersion && pkg.declaredVersion !== expectedVersion) {
    return undefined
  }

  if (isJavaScriptCli(realPath)) {
    return {
      kind: "javascript",
      executablePath: realPath,
      packageRoot: pkg.packageRoot,
      declaredVersion: pkg.declaredVersion,
      source,
    }
  }

  if (isNativeBinary(realPath) && isExecutableFile(realPath)) {
    return {
      kind: "native",
      executablePath: realPath,
      packageRoot: pkg.packageRoot,
      declaredVersion: pkg.declaredVersion,
      source,
    }
  }

  return undefined
}

/**
 * Discovers a legitimate pnpm CLI (native binary or JS script) from explicit PNPM_BIN or Corepack cache.
 * Fail-closed: when PNPM_BIN is explicitly provided, does not fall back to other locations.
 */
export function findPnpmCli(options?: PnpmFindOptions): PnpmResolution | undefined {
  const explicit = (options?.pnpmBin ?? process.env.PNPM_BIN)?.trim()
  if (explicit) {
    return resolvePnpmCandidate(explicit, "pnpm_bin")
  }

  const roots = new Set<string>()
  if (options?.corepackHome?.trim()) {
    roots.add(resolve(options.corepackHome.trim()))
  } else if (options?.cacheRoots && options.cacheRoots.length > 0) {
    for (const root of options.cacheRoots) {
      if (root?.trim()) roots.add(resolve(root.trim()))
    }
  } else {
    if (process.env.COREPACK_HOME?.trim()) roots.add(resolve(process.env.COREPACK_HOME.trim()))
    roots.add(join(homedir(), ".cache", "node", "corepack"))
    roots.add(join(homedir(), ".cache", "corepack"))
  }

  for (const root of roots) {
    const pnpmRoot = join(root, "v1", "pnpm")
    if (!existsSync(pnpmRoot)) continue

    let versions: string[]
    try {
      versions = readdirSync(pnpmRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    } catch {
      continue
    }

    for (const version of versions) {
      const versionDir = join(pnpmRoot, version)
      // Check for native binary first (e.g. pnpm 12 pnpm-native)
      const nativeCandidates = [
        join(versionDir, "pnpm-native"),
        join(versionDir, "pnpm.exe"),
        join(versionDir, "pnpm-native.exe"),
      ]
      for (const candidate of nativeCandidates) {
        if (existsSync(candidate)) {
          const res = resolvePnpmCandidate(candidate, "corepack_cache", version)
          if (res) return res
        }
      }

      // Check for JavaScript CLI entrypoints
      const jsCandidates = [
        join(versionDir, "bin", "pnpm.cjs"),
        join(versionDir, "bin", "pnpm.mjs"),
        join(versionDir, "dist", "pnpm.cjs"),
        join(versionDir, "pnpm.cjs"),
        join(versionDir, "pnpm.mjs"),
      ]
      for (const candidate of jsCandidates) {
        if (existsSync(candidate)) {
          const res = resolvePnpmCandidate(candidate, "corepack_cache", version)
          if (res) return res
        }
      }
    }
  }

  // Fallback to checking PATH only if system path search is explicitly or conventionally available and no isolated test roots were requested
  if (!options?.corepackHome && !options?.cacheRoots) {
    const pathValue = options?.pathEnv ?? process.env.PATH ?? ""
    const delimiter = process.platform === "win32" ? ";" : ":"
    for (const dir of pathValue.split(delimiter)) {
      if (!dir) continue
      const candidate = join(dir, "pnpm")
      if (existsSync(candidate)) {
        const res = resolvePnpmCandidate(candidate, "system_path")
        if (res) return res
      }
    }
  }

  return undefined
}

/**
 * Builds the command and argument array for executing pnpm.
 * Native binaries are executed directly; JavaScript CLIs are executed through Node.
 */
export function buildPnpmCommand(
  resolution: PnpmResolution,
  nodeExecutable: string,
  args: string[],
): { command: string; args: string[] } {
  if (resolution.kind === "native") {
    return {
      command: resolution.executablePath,
      args,
    }
  }
  return {
    command: nodeExecutable,
    args: [resolution.executablePath, ...args],
  }
}

/**
 * Renders a secure POSIX shell wrapper script for pnpm in the sandbox bin directory.
 */
export function renderPnpmWrapper(resolution: PnpmResolution, nodeExecutable: string): string {
  if (resolution.kind === "native") {
    return `#!/bin/sh\nexec ${shellQuote(resolution.executablePath)} "$@"\n`
  }
  return `#!/bin/sh\nexec ${shellQuote(nodeExecutable)} ${shellQuote(resolution.executablePath)} "$@"\n`
}

/**
 * Detects whether a pnpm error message indicates missing offline packages/tarballs.
 */
export function isOfflineMissingPnpmError(output: string): boolean {
  return /ERR_PNPM_NO_OFFLINE_TARBALL|ERR_PNPM_FETCH|no matching version.*found offline|not available in the store/i.test(output)
}
