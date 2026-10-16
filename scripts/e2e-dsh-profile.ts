import { spawn, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { expectedTools, missingHostExitCode, passExitCode, failureExitCode, validateEvidence, validateProfileEvidence } from "./lib/dsh-profile-e2e-contract.js"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const reportPath = resolve(repositoryRoot, "docs/evidence/dsh-profile-e2e.latest.json")
const timeoutMs = 120_000
const bootTimeoutMs = 30_000
const maxOutputBytes = 1_000_000
const profileName = `dshbanca-e2e-${process.pid}-${Date.now()}`
const observerName = "dshbanca-e2e-observer"

interface CommandResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdout: string
  stderr: string
}

interface GateReport {
  schemaVersion: 1
  status: "PASS" | "FAIL" | "BLOCKED"
  startedAt: string
  finishedAt?: string
  repository: { revision: string; dirty: boolean }
  versions: Record<string, string | null>
  sandbox: { isolated: boolean; removed: boolean | null }
  stages: Record<string, unknown>
  failures: string[]
  limitations: string[]
}

const report: GateReport = {
  schemaVersion: 1,
  status: "BLOCKED",
  startedAt: new Date().toISOString(),
  repository: { revision: "unknown", dirty: true },
  versions: { dsh: null, cordis: null, cordisPluginLoader: null, node: process.version, bun: null, pnpm: null },
  sandbox: { isolated: false, removed: null },
  stages: {},
  failures: [],
  limitations: ["Este gate não inicia agente nem chama modelo. Tool loop por modelo e validação acadêmica humana não são cobertos."],
}

let scratchRoot: string | undefined
let finalStatus: GateReport["status"] = "BLOCKED"

function commandVersion(command: string, args: string[], env?: NodeJS.ProcessEnv): string | null {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000, env })
  if (result.status !== 0) return null
  return `${result.stdout ?? ""}`.trim().split(/\r?\n/)[0] || null
}

function findExecutable(name: string, override?: string): string | undefined {
  const candidate = override?.trim()
  if (candidate) {
    const explicit = resolve(candidate)
    return existsSync(explicit) && statSync(explicit).isFile() ? realpathSync(explicit) : undefined
  }
  const pathValue = process.env.PATH ?? ""
  for (const directory of pathValue.split(delimiter())) {
    if (!directory) continue
    const path = join(directory, name)
    if (existsSync(path) && statSync(path).isFile()) return realpathSync(path)
  }
  return undefined
}

function delimiter(): string {
  return process.platform === "win32" ? ";" : ":"
}

function findPackageJson(root: string, packageName: string): string | undefined {
  const packagePath = join(root, "node_modules", ...packageName.split("/"), "package.json")
  return existsSync(packagePath) ? packagePath : undefined
}

function findDshPackageRoot(executable: string): string | undefined {
  let current = dirname(realpathSync(executable))
  for (;;) {
    const manifest = join(current, "package.json")
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8"))
        if (parsed.name === "@deepseek-ai/dsh") return current
      } catch {
        // Continue to the executable's parent package.
      }
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function findPnpmCli(): string | undefined {
  const roots = new Set<string>()
  if (process.env.COREPACK_HOME) roots.add(resolve(process.env.COREPACK_HOME))
  roots.add(join(homedir(), ".cache", "node", "corepack"))
  roots.add(join(homedir(), ".cache", "corepack"))
  for (const root of roots) {
    const pnpmRoot = join(root, "v1", "pnpm")
    if (!existsSync(pnpmRoot)) continue
    for (const version of readdirSync(pnpmRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      const candidate = join(pnpmRoot, version, "bin", "pnpm.cjs")
      if (existsSync(candidate)) return realpathSync(candidate)
    }
  }
  const direct = findExecutable("pnpm", process.env.PNPM_BIN)
  if (!direct) return undefined
  const resolved = realpathSync(direct)
  if (resolved.endsWith("pnpm.cjs")) return resolved
  return undefined
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function run(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stdin?: "ignore" | "pipe" } ): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let outputBytes = 0
    let timedOut = false
    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      outputBytes += chunk.length
      const text = chunk.toString("utf8")
      if (outputBytes <= maxOutputBytes) {
        if (stream === "stdout") stdout += text
        else stderr += text
      }
    }
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk))
    const timer = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child)
    }, options.timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      resolveResult({ exitCode: null, signal: null, timedOut, stdout, stderr: `${stderr}\n${error.message}` })
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolveResult({ exitCode: code, signal, timedOut, stdout, stderr })
    })
  })
}

function terminateProcessTree(child: ReturnType<typeof spawn>): void {
  if (child.pid === undefined) return
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM")
    else child.kill("SIGTERM")
  } catch {
    // It may have exited between timeout and signal delivery.
  }
  const forceTimer = setTimeout(() => {
    try {
      if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL")
      else child.kill("SIGKILL")
    } catch {
      // Already exited.
    }
  }, 1_500)
  forceTimer.unref()
}

function safeOutput(result: CommandResult): string {
  return `${result.stderr}\n${result.stdout}`
    .replaceAll(scratchRoot ?? "\0", "<sandbox>")
    .replaceAll(repositoryRoot, "<checkout>")
    .replaceAll(homedir(), "<home>")
    .replace(/(?:sk|api|key|token)[-_]?[A-Za-z0-9]{12,}/gi, "<redacted>")
    .slice(0, 1200)
    .trim()
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function inventoryTree(root: string): Record<string, string> {
  const inventory: Record<string, string> = {}
  const visit = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        inventory[relativePath] = `symlink:${readlinkSync(absolute)}`
      } else if (entry.isDirectory()) {
        visit(absolute, relativePath)
      } else if (entry.isFile()) {
        inventory[relativePath] = hashFile(absolute)
      }
    }
  }
  visit(root)
  return inventory
}

function repoStatus(): string | null {
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 })
  return result.status === 0 ? result.stdout : null
}

function writeReport(): void {
  report.finishedAt = new Date().toISOString()
  report.status = finalStatus
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
}

function fail(message: string, status: "FAIL" | "BLOCKED" = "FAIL"): void {
  report.failures.push(message)
  finalStatus = status
}

function gitValue(args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8", timeout: 10_000 })
  return result.status === 0 ? result.stdout.trim() : null
}

function ensureInside(base: string, path: string): void {
  const relativePath = relative(base, path)
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || resolve(path) === resolve(base)) {
    throw new Error("scratch isolation check failed: a configured write path escapes the unique sandbox")
  }
}

function createObserverPackage(observerRoot: string, workspace: string, observerResult: string): void {
  mkdirSync(observerRoot, { recursive: true, mode: 0o700 })
  writeFileSync(join(observerRoot, "package.json"), JSON.stringify({
    name: observerName,
    version: "0.0.0",
    type: "module",
    main: "./index.js",
    exports: "./index.js",
  }, null, 2) + "\n")
  const observerSource = `import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const name = ${JSON.stringify(observerName)};
export const inject = ["tools", "skills", "sessions"];
const expected = ${JSON.stringify(expectedTools)};
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const inventory = async (root, prefix = "") => {
  const result = {};
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const rel = prefix ? prefix + "/" + entry.name : entry.name;
    const path = join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await inventory(path, rel));
    else if (entry.isFile()) result[rel] = await sha(path);
    else throw new Error("unexpected symlink/special file in synthetic workspace");
  }
  return result;
};
const fail = (message) => { throw new Error("DSHbanca profile E2E observer: " + message); };

export async function apply(ctx) {
  const workspace = ${JSON.stringify(workspace)};
  const reportPath = ${JSON.stringify(observerResult)};
  let tools = [];
  let skillFound = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    tools = ctx.tools.schemas().map((schema) => schema.name).filter((tool) => tool.startsWith("banca_")).sort();
    const skillRows = await ctx.skills.list({ cwd: workspace, signal: new AbortController().signal });
    skillFound = skillRows.some((skill) => skill.name === "banca-avaliacao");
    if (JSON.stringify(tools) === JSON.stringify([...expected].sort()) && skillFound) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (JSON.stringify(tools) !== JSON.stringify([...expected].sort())) fail("the DSH tools service did not discover the exact expected banca tool set; observed count=" + tools.length + " names=" + JSON.stringify(tools));
  if (!skillFound) fail("the DSH skills service did not discover banca-avaliacao");

  const session = ctx.sessions.create(undefined, { meta: { cwd: workspace } });
  if (!session?.header || session.header.cwd !== workspace) fail("DSH did not create a live synthetic workspace session");
  const agent = { session };
  const execute = (callId, name, args = {}) => ctx.tools.execute({ callId, name, arguments: args, agent, signal: new AbortController().signal });

  const init = await execute("dshbanca-e2e-init", "banca_init");
  if (init.isError) fail("native banca_init execution failed");
  const files = ["main.tex", "referencias.bib", ".banca/project.json", ".banca/state.json"];
  for (const file of files) {
    try { await readFile(join(workspace, file)); }
    catch { fail("banca_init did not create the expected synthetic project state"); }
  }
  const before = await inventory(workspace);
  const status = await execute("dshbanca-e2e-status", "banca_status");
  if (status.isError || typeof status.value !== "string" || !status.value.includes("main.tex")) fail("native banca_status did not return the synthetic project's status");
  const after = await inventory(workspace);
  if (JSON.stringify(before) !== JSON.stringify(after)) fail("banca_status changed files in the synthetic workspace");

  const result = {
    lifecycle: "observer Cordis apply reached after DSHbanca registrations; target plugin application confirmed by actual tool and skill services",
    profileRuntime: true,
    session: "live DSH SessionStore session with synthetic agent-shaped ToolRuntime context; no agent loop",
    toolNames: tools,
    exactToolSet: true,
    skillFound,
    executedTools: ["banca_init", "banca_status"],
    statusSucceeded: true,
    statusReadOnly: JSON.stringify(before) === JSON.stringify(after),
    workspaceInventoryBeforeStatus: before,
    workspaceInventoryAfterStatus: after,
  };
  await writeFile(reportPath, JSON.stringify(result, null, 2) + "\\n", { mode: 0o600, flag: "wx" });
}
export default { name, inject, apply };
`
  writeFileSync(join(observerRoot, "index.js"), observerSource, { mode: 0o600 })
  chmodSync(join(observerRoot, "index.js"), 0o600)
}

async function main(): Promise<void> {
  const initialRepoStatus = repoStatus()
  report.repository.revision = gitValue(["rev-parse", "HEAD"]) ?? "unknown"
  report.repository.dirty = initialRepoStatus === null || initialRepoStatus.trim().length > 0
  const dshExecutable = findExecutable("dsh", process.env.DSH_BIN)
  if (!dshExecutable) {
    fail("DSH CLI not found or DSH_BIN does not point to a file; install/provision the real DSH host", "BLOCKED")
    return
  }
  const nodeExecutable = findExecutable("node")
  const bunExecutable = findExecutable("bun")
  if (!nodeExecutable || !bunExecutable) {
    fail("Node or Bun executable is unavailable", "BLOCKED")
    return
  }

  scratchRoot = mkdtempSync(join(tmpdir(), "dshbanca-profile-e2e-"))
  chmodSync(scratchRoot, 0o700)
  const scratch = realpathSync(scratchRoot)
  const dirs = {
    dshHome: join(scratch, "dsh-home"),
    home: join(scratch, "home"),
    tmp: join(scratch, "tmp"),
    xdgConfig: join(scratch, "xdg", "config"),
    xdgCache: join(scratch, "xdg", "cache"),
    xdgData: join(scratch, "xdg", "data"),
    xdgState: join(scratch, "xdg", "state"),
    xdgRuntime: join(scratch, "xdg", "runtime"),
    pnpmHome: join(scratch, "pnpm-home"),
    pnpmStore: join(scratch, "pnpm-store"),
    npmCache: join(scratch, "npm-cache"),
    corepack: join(scratch, "corepack"),
    bin: join(scratch, "bin"),
  }
  for (const path of Object.values(dirs)) {
    ensureInside(scratch, path)
    mkdirSync(path, { recursive: true, mode: 0o700 })
  }
  const env: NodeJS.ProcessEnv = {
    PATH: [dirs.bin, dirname(nodeExecutable), dirname(bunExecutable), "/usr/local/bin", "/usr/bin", "/bin"].join(delimiter()),
    HOME: dirs.home,
    DSH_HOME: dirs.dshHome,
    TMPDIR: dirs.tmp,
    TMP: dirs.tmp,
    TEMP: dirs.tmp,
    XDG_CONFIG_HOME: dirs.xdgConfig,
    XDG_CACHE_HOME: dirs.xdgCache,
    XDG_DATA_HOME: dirs.xdgData,
    XDG_STATE_HOME: dirs.xdgState,
    XDG_RUNTIME_DIR: dirs.xdgRuntime,
    PNPM_HOME: dirs.pnpmHome,
    npm_config_userconfig: join(dirs.home, ".npmrc"),
    npm_config_cache: dirs.npmCache,
    npm_config_offline: "true",
    COREPACK_HOME: dirs.corepack,
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    DSH_TELEMETRY_MODE: "DISABLED",
    CI: "1",
    NO_COLOR: "1",
    LANG: "C.UTF-8",
  }
  for (const value of [dirs.dshHome, dirs.home, dirs.tmp, dirs.xdgConfig, dirs.xdgCache, dirs.xdgData, dirs.xdgState, dirs.xdgRuntime, dirs.pnpmHome, dirs.pnpmStore, dirs.npmCache, dirs.corepack]) ensureInside(scratch, value)
  report.sandbox.isolated = true

  const dshVersionResult = await run(dshExecutable, ["--version"], { cwd: repositoryRoot, env, timeoutMs: 10_000 })
  report.stages.dshVersionExitCode = dshVersionResult.exitCode
  if (dshVersionResult.exitCode !== 0) {
    fail(`DSH CLI exists but --version failed: ${safeOutput(dshVersionResult)}`)
    return
  }
  report.versions.dsh = dshVersionResult.stdout.trim().split(/\r?\n/)[0] ?? null

  const dshRoot = findDshPackageRoot(dshExecutable)
  if (!dshRoot) {
    fail("DSH executable was found but its installed @deepseek-ai/dsh package root could not be verified", "BLOCKED")
    return
  }
  const dshManifest = JSON.parse(readFileSync(join(dshRoot, "package.json"), "utf8"))
  if (dshManifest.version !== report.versions.dsh) {
    fail("DSH CLI --version does not match its installed package manifest")
    return
  }
  const cordisManifestPath = findPackageJson(dshRoot, "@deepseek-ai/cordis")
  const loaderManifestPath = findPackageJson(dshRoot, "@deepseek-ai/cordis-plugin-loader")
  if (!cordisManifestPath || !loaderManifestPath) {
    fail("DSH installation is missing Cordis or cordis-plugin-loader package metadata", "BLOCKED")
    return
  }
  report.versions.cordis = JSON.parse(readFileSync(cordisManifestPath, "utf8")).version
  report.versions.cordisPluginLoader = JSON.parse(readFileSync(loaderManifestPath, "utf8")).version

  const nodeVersion = nodeExecutable ? commandVersion(nodeExecutable, ["--version"], env) : null
  const bunVersion = bunExecutable ? commandVersion(bunExecutable, ["--version"], env) : null
  report.versions.node = nodeVersion
  report.versions.bun = bunVersion
  if (!nodeVersion || !bunVersion) {
    fail("Node or Bun version could not be verified", "BLOCKED")
    return
  }

  if (!nodeExecutable || !bunExecutable) {
    fail("Node or Bun executable is missing from PATH", "BLOCKED")
    return
  }
  const pnpmCli = findPnpmCli()
  if (!pnpmCli) {
    fail("No cached pnpm CLI is available for offline execution; provision pnpm in Corepack cache or set PNPM_BIN to a real pnpm.cjs file", "BLOCKED")
    return
  }
  const pnpmCheck = await run(nodeExecutable, [pnpmCli, "--version"], { cwd: repositoryRoot, env, timeoutMs: 10_000 })
  report.stages.pnpmVersionExitCode = pnpmCheck.exitCode
  if (pnpmCheck.exitCode !== 0) {
    fail(`Cached pnpm cannot execute offline: ${safeOutput(pnpmCheck)}`, "BLOCKED")
    return
  }
  report.versions.pnpm = pnpmCheck.stdout.trim().split(/\r?\n/)[0] ?? null

  const dshHomeFromContract = join(dirs.dshHome, "profiles")
  ensureInside(scratch, dshHomeFromContract)
  const sandboxBeforeStatus = repoStatus()
  report.stages.profileName = "unique isolated SDK profile"
  report.stages.defaultProfile = "sdk"
  report.stages.installMode = "DSH native plugin command, local checkout, pnpm --offline and isolated store"
  report.stages.externalActivity = { telemetry: "DISABLED", modelCalls: 0, sdkJsonRpcRequestsSent: 0 }

  const setup = await run(dshExecutable, ["--profile", profileName, "--from-default-profile", "sdk", "--dump-config"], { cwd: repositoryRoot, env, timeoutMs })
  report.stages.profileInitialization = { exitCode: setup.exitCode, timedOut: setup.timedOut }
  if (setup.exitCode !== 0 || setup.timedOut) {
    fail(`DSH could not create the isolated SDK profile: ${safeOutput(setup)}`)
    return
  }
  const profileDir = join(dirs.dshHome, "profiles", profileName)
  const profileManifestPath = join(profileDir, "package.json")
  if (!existsSync(profileManifestPath)) {
    fail("DSH profile creation exited successfully but did not create the profile manifest")
    return
  }
  const beforeManifest = JSON.parse(readFileSync(profileManifestPath, "utf8"))
  const bundlesBefore = beforeManifest.dsh?.profile?.bundles ?? []
  report.stages.bundlesBeforeInstall = bundlesBefore

  const observerRoot = join(scratch, "observer")
  const workspace = join(scratch, "synthetic-project")
  const observerResult = join(scratch, "observer-result.json")
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  mkdirSync(join(workspace, "capitulos"), { recursive: true, mode: 0o700 })
  writeFileSync(join(workspace, "main.tex"), "\\documentclass{article}\n\\begin{document}\nTexto acadêmico sintético de validação.\\end{document}\n", { mode: 0o600 })
  writeFileSync(join(workspace, "referencias.bib"), "@article{synthetic2026, title={Referência Sintética}, author={Pessoa, Exemplo}, year={2026}}\n", { mode: 0o600 })
  writeFileSync(join(workspace, "capitulos", "introducao.tex"), "Introdução sintética para teste do DSHbanca.\n", { mode: 0o600 })
  createObserverPackage(observerRoot, workspace, observerResult)
  const overlayPath = join(scratch, "observer.patch.yml")
  writeFileSync(overlayPath, `- insert:\n    - id: dshbanca-e2e-observer\n      name: ${observerName}\n`, { mode: 0o600 })

  const pnpmWrapper = join(dirs.bin, process.platform === "win32" ? "pnpm.cmd" : "pnpm")
  if (process.platform === "win32") {
    fail("The DSH profile E2E gate currently requires a POSIX host for process-group timeout cleanup", "BLOCKED")
    return
  }
  writeFileSync(pnpmWrapper, `#!/bin/sh\nexec ${shellQuote(nodeExecutable)} ${shellQuote(pnpmCli)} "$@"\n`, { mode: 0o700 })
  chmodSync(pnpmWrapper, 0o700)

  const build = await run(bunExecutable, ["run", "build"], { cwd: repositoryRoot, env, timeoutMs })
  report.stages.build = { exitCode: build.exitCode, timedOut: build.timedOut }
  if (build.exitCode !== 0 || build.timedOut) {
    fail(`Repository build required for the exported DSH entrypoint failed: ${safeOutput(build)}`)
    return
  }

  const add = await run(dshExecutable, ["plugin", "--profile", profileName, "add", "--offline", "--store-dir", dirs.pnpmStore, repositoryRoot, observerRoot], { cwd: repositoryRoot, env, timeoutMs })
  report.stages.nativeBundleInstall = { exitCode: add.exitCode, timedOut: add.timedOut }
  if (add.exitCode !== 0 || add.timedOut) {
    const offlineMissing = /ERR_PNPM_NO_OFFLINE_TARBALL|ERR_PNPM_FETCH|no matching version.*found offline|not available in the store/i.test(`${add.stderr}\n${add.stdout}`)
    fail(`DSH native offline bundle installation ${offlineMissing ? "is BLOCKED by a missing offline dependency" : "failed"}: ${safeOutput(add)}`, offlineMissing ? "BLOCKED" : "FAIL")
    return
  }

  const installedManifest = JSON.parse(readFileSync(profileManifestPath, "utf8"))
  const bundlesAfter = installedManifest.dsh?.profile?.bundles ?? []
  const dependencyNames = Object.keys(installedManifest.dependencies ?? {})
  report.stages.bundlesAfterInstall = bundlesAfter
  report.stages.localBundleResolution = "profile node_modules links to the checkout's dshbanca package; observer package is local and scratch-only"
  if (!bundlesAfter.includes("dshbanca") || !dependencyNames.includes("dshbanca")) {
    fail("The DSH native package command succeeded but the profile does not contain the DSHbanca bundle entry")
    return
  }
  if (!dependencyNames.includes(observerName)) {
    fail("The DSH native package command succeeded but the profile does not contain the scratch observer dependency")
    return
  }

  const dump = await run(dshExecutable, ["--profile", profileName, "--patch", overlayPath, "--dump-config"], { cwd: repositoryRoot, env, timeoutMs })
  report.stages.composedProfile = { exitCode: dump.exitCode, containsDshbancaEntry: dump.stdout.includes("name: dshbanca/dsh"), containsObserverEntry: dump.stdout.includes(`name: ${observerName}`) }
  const composedEntry = dump.stdout.includes("name: dshbanca/dsh")
  if (dump.exitCode !== 0 || !composedEntry || !dump.stdout.includes(`name: ${observerName}`)) {
    fail(`The real DSH composed profile is missing the required DSHbanca or observer entry (exit=${dump.exitCode}, dshbanca=${composedEntry}, observer=${dump.stdout.includes(`name: ${observerName}`)})`)
    return
  }
  const checkoutBundle = join(profileDir, "node_modules", "dshbanca")
  if (!existsSync(checkoutBundle)) {
    fail("DSHbanca dependency is absent from the profile node_modules resolution path")
    return
  }
  const entrypointResolved = realpathSync(checkoutBundle) === realpathSync(repositoryRoot)
  report.stages.entrypoint = { composedEntry: "dshbanca/dsh", packageExport: "./dsh -> dist/dsh.js", profileResolutionPresent: true, pointsToCheckout: entrypointResolved }
  const profileErrors = validateProfileEvidence({
    profileManifestHasBundle: bundlesAfter.includes("dshbanca") && dependencyNames.includes("dshbanca"),
    profileManifestHasObserver: dependencyNames.includes(observerName),
    composedEntry,
    entrypointResolved,
  })
  if (profileErrors.length > 0) {
    fail(`Profile composition validation failed: ${profileErrors.join("; ")}`)
    return
  }

  const projectBeforeBoot = inventoryTree(workspace)
  const statusBeforeBoot = repoStatus()
  const boot = await run(dshExecutable, ["--profile", profileName, "--patch", overlayPath], { cwd: workspace, env, timeoutMs: bootTimeoutMs })
  report.stages.profileBoot = { exitCode: boot.exitCode, signal: boot.signal, timedOut: boot.timedOut, stdin: "EOF; no SDK request or model call sent" }
  if (boot.exitCode !== 0 || boot.timedOut) {
    fail(`Real DSH SDK profile boot failed, timed out, or exited unexpectedly before evidence: ${safeOutput(boot)}`)
    return
  }
  if (!existsSync(observerResult)) {
    fail(`The real profile exited without the Cordis observer evidence file; plugin lifecycle/discovery was not observed. Sanitized boot output: ${safeOutput(boot)}`)
    return
  }
  const observed = JSON.parse(readFileSync(observerResult, "utf8"))
  const errors = validateEvidence(observed)
  report.stages.observedRuntime = {
    lifecycle: observed.lifecycle,
    toolNames: observed.toolNames,
    toolCount: observed.toolNames?.length ?? 0,
    exactToolSet: observed.exactToolSet,
    skillFound: observed.skillFound,
    executedTools: observed.executedTools,
    statusSucceeded: observed.statusSucceeded,
    statusReadOnly: observed.statusReadOnly,
    workspaceInventoryBeforeStatus: observed.workspaceInventoryBeforeStatus,
    workspaceInventoryAfterStatus: observed.workspaceInventoryAfterStatus,
    session: observed.session,
  }
  if (errors.length > 0) {
    fail(`Real DSH runtime evidence violated the profile contract: ${errors.join("; ")}`)
    return
  }
  const projectAfterBoot = inventoryTree(workspace)
  report.stages.syntheticWorkspaceUnchangedByStatus = JSON.stringify(observed.workspaceInventoryBeforeStatus) === JSON.stringify(observed.workspaceInventoryAfterStatus)
  report.stages.syntheticWorkspaceFilesCreatedByNativeInit = Object.keys(projectAfterBoot).length > Object.keys(projectBeforeBoot).length
  if (!report.stages.syntheticWorkspaceUnchangedByStatus || !report.stages.syntheticWorkspaceFilesCreatedByNativeInit) {
    fail("Expected read-only status invariance or native initialization effects were not observed")
    return
  }
  if (statusBeforeBoot !== null && repoStatus() !== statusBeforeBoot) {
    fail("DSH profile run changed the checkout's Git working-tree status outside the sandbox")
    return
  }
  if (sandboxBeforeStatus !== null && initialRepoStatus !== null && initialRepoStatus !== sandboxBeforeStatus) {
    fail("A prerequisite step unexpectedly changed the checkout before profile boot")
    return
  }
  finalStatus = "PASS"
}

try {
  await main()
} catch (error) {
  fail(`Unhandled gate error: ${error instanceof Error ? error.message.replaceAll(scratchRoot ?? "\0", "<sandbox>").replaceAll(repositoryRoot, "<checkout>") : "unknown error"}`)
} finally {
  if (scratchRoot && existsSync(scratchRoot)) {
    try {
      const resolvedScratch = realpathSync(scratchRoot)
      const expectedParent = realpathSync(tmpdir())
      if (!resolvedScratch.startsWith(`${expectedParent}${sep}`) || !resolvedScratch.includes("dshbanca-profile-e2e-")) {
        throw new Error("refusing cleanup because the scratch path is not the unique test directory under the OS temp root")
      }
      rmSync(resolvedScratch, { recursive: true, force: false })
      report.sandbox.removed = !existsSync(resolvedScratch)
      if (!report.sandbox.removed) fail("Scratch cleanup did not remove the test-owned sandbox")
    } catch (error) {
      report.sandbox.removed = false
      fail(`Scratch cleanup failed: ${error instanceof Error ? error.message : "unknown cleanup error"}`)
    }
  } else if (scratchRoot) {
    report.sandbox.removed = true
  }
  if (report.sandbox.isolated && report.sandbox.removed !== true && finalStatus === "PASS") {
    fail("Sandbox cleanup was not verified")
  }
  try {
    writeReport()
  } catch (error) {
    finalStatus = "FAIL"
    report.status = finalStatus
    report.failures.push(`Could not preserve sanitized report at ${relative(repositoryRoot, reportPath)}: ${error instanceof Error ? error.message : "unknown error"}`)
    process.stderr.write(`FAIL: report persistence failed (${relative(repositoryRoot, reportPath)})\n`)
  }
}

process.stdout.write(`${finalStatus}: DSH native profile gate\n`)
process.stdout.write(`Report: ${relative(repositoryRoot, reportPath)}\n`)
if (report.versions.dsh) process.stdout.write(`DSH ${report.versions.dsh}; Cordis ${report.versions.cordis ?? "unknown"}; loader ${report.versions.cordisPluginLoader ?? "unknown"}; Bun ${report.versions.bun ?? "unknown"}; Node ${report.versions.node ?? "unknown"}; pnpm ${report.versions.pnpm ?? "unknown"}\n`)
for (const failure of report.failures) process.stderr.write(`${finalStatus}: ${failure}\n`)
process.exitCode = finalStatus === "PASS" ? passExitCode() : finalStatus === "BLOCKED" ? missingHostExitCode() : failureExitCode()
