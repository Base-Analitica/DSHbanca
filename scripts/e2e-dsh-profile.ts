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
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse as parseYaml } from "yaml"
import { buildSdkPresetOverlayPatch, e2eControlPresetId } from "./lib/dsh-profile-e2e-presets.js"
import { renderControlPresetSelector } from "./lib/dsh-profile-e2e-observer-control.js"
import {
  canonicalAuditorMarkdownSha256,
  expectedTools,
  missingHostExitCode,
  passExitCode,
  failureExitCode,
  classifyAuditorMarkdownStatus,
  classifyProfileGateStatuses,
  validateAuditorMarkdownEvidence,
  validateEvidence,
  validateProfileEvidence,
  validatePresetReferences,
} from "./lib/dsh-profile-e2e-contract.js"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const configuredReportPath = process.env.DSHBANCA_DSH_PROFILE_REPORT_PATH?.trim()
const reportPath = configuredReportPath
  ? resolve(repositoryRoot, configuredReportPath)
  : resolve(repositoryRoot, "docs/evidence/dsh-profile-e2e.latest.json")
const reportPathLabel = (() => {
  const repositoryRelative = relative(repositoryRoot, reportPath)
  return repositoryRelative === ".." || repositoryRelative.startsWith(`..${sep}`) || isAbsolute(repositoryRelative)
    ? "<external report path>"
    : repositoryRelative
})()
const timeoutMs = 120_000
const bootTimeoutMs = 30_000
const maxOutputBytes = 8_000_000
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
  versions: {
    dsh: null,
    cordis: null,
    cordisPluginLoader: null,
    dshAgent: null,
    dshAgentLoop: null,
    dshTools: null,
    dshAgentPreset: null,
    dshAgentPresetRegistry: null,
    dshAgentInstructions: null,
    dshApiSessionController: null,
    node: process.version,
    bun: null,
    pnpm: null,
  },
  sandbox: { isolated: false, removed: null },
  stages: {},
  failures: [],
  limitations: [
    "Este gate não inicia agente nem chama modelo. Tool loop por modelo e validação acadêmica humana não são cobertos.",
    "O resultado da identidade/guard (#2) e o carregamento das instruções Markdown (#3) são reportados separadamente.",
    "A sonda ativa agent/pre-step exige DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED=yes; sem essa autorização o runner para antes do boot do perfil.",
  ],
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

async function validateNativePresetConfig(dshExecutable: string) {
  const dshRoot = findDshPackageRoot(dshExecutable)
  if (!dshRoot) throw new Error("installed DSH package root is unavailable")
  const packageRoot = join(dshRoot, "node_modules", "@deepseek-ai")
  const registryModule = await import(pathToFileURL(join(packageRoot, "dsh-agent-preset-registry", "lib", "index.js")).href)
  const presetModule = await import(pathToFileURL(join(packageRoot, "dsh-agent-preset", "lib", "index.js")).href)
  const instructionModule = await import(pathToFileURL(join(packageRoot, "dsh-agent-instructions", "lib", "index.js")).href)
  const patchRows = (parseYaml(readFileSync(join(repositoryRoot, "cordis.patch.yml"), "utf8")) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const overlayRows = (parseYaml(buildSdkPresetOverlayPatch(observerName)) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const registryRow = overlayRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset-registry")
  const fixturePresetRows = overlayRows.filter((row) => row?.name === "@deepseek-ai/dsh-agent-preset")
  const neutralPresetRow = fixturePresetRows.find((row) => row?.config?.id === e2eControlPresetId)
  const presetIds = [
    ...patchRows.filter((row) => row?.name === "@deepseek-ai/dsh-agent-preset").map((row) => row?.config?.id),
    ...fixturePresetRows.map((row) => row?.config?.id),
  ]
  const auditorRow = patchRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset" && row?.config?.id === "banca-auditor")
  const bundleRegistryAbsent = !patchRows.some((row) => row?.name === "@deepseek-ai/dsh-agent-preset-registry")
  const bundleStandardAbsent = !patchRows.some((row) => row?.name === "@deepseek-ai/dsh-agent-preset" && row?.config?.id === "standard")
  const registryResult = await registryModule.AgentPresetRegistry.Config["~standard"].validate(registryRow?.config)
  const missingDefaultResult = await registryModule.AgentPresetRegistry.Config["~standard"].validate({})
  const unknownDefaultErrors = validatePresetReferences("unknown-dshbanca-e2e-preset", presetIds)
  const duplicatePresetErrors = validatePresetReferences(registryRow?.config?.default, [...presetIds, e2eControlPresetId])
  const fixtureDefaultResolved = validatePresetReferences(registryRow?.config?.default, presetIds).length === 0
  const neutralPresetResult = neutralPresetRow
    ? await presetModule.default.Config["~standard"].validate(neutralPresetRow.config)
    : { issues: [{ message: "scratch control preset row missing" }] }
  const presetResult = auditorRow
    ? await presetModule.default.Config["~standard"].validate(auditorRow.config)
    : { issues: [{ message: "banca-auditor preset row missing" }] }
  const instructionRow = auditorRow?.config?.plugins?.find((row) => row?.name === "@deepseek-ai/dsh-agent-instructions")
  const instructionResult = instructionRow
    ? await instructionModule.Config["~standard"].validate(instructionRow.config)
    : { issues: [{ message: "native instruction loader child missing" }] }
  const childProblem = auditorRow ? registryModule.entryListProblem(auditorRow.config.plugins) : "banca-auditor preset row missing"
  const rejectedMissingDefault = Array.isArray(missingDefaultResult.issues) &&
    missingDefaultResult.issues.some((issue) => issue.path?.[0] === "default")
  const webAppRoot = join(packageRoot, "dsh-web-app")
  const webHostRows = (parseYaml(readFileSync(join(webAppRoot, "cordis.patch.yml"), "utf8")) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const webHostRegistry = webHostRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset-registry")
  const webStandardRows = (parseYaml(readFileSync(join(webAppRoot, "presets", "standard.patch.yml"), "utf8")) as any[])
    .flatMap((operation) => Array.isArray(operation?.insert) ? operation.insert : [])
  const webStandardPreset = webStandardRows.find((row) => row?.name === "@deepseek-ai/dsh-agent-preset" && row?.config?.id === "standard")
  const hostStandardPreserved = webHostRegistry?.config?.default === "standard" && Boolean(webStandardPreset) && bundleRegistryAbsent && bundleStandardAbsent
  const registryInjectionRequired = Array.isArray(presetModule.default.inject) && presetModule.default.inject.includes("agentPresets")
  const accepted = bundleRegistryAbsent && bundleStandardAbsent && !registryResult.issues && rejectedMissingDefault &&
    fixtureDefaultResolved && !neutralPresetResult.issues && !presetResult.issues &&
    !instructionResult.issues && childProblem === undefined && unknownDefaultErrors.length > 0 &&
    duplicatePresetErrors.length > 0 && hostStandardPreserved && registryInjectionRequired
  return {
    accepted,
    bundleRegistryAbsent,
    bundleStandardAbsent,
    scratchRegistryAccepted: !registryResult.issues,
    absentDefaultRejected: rejectedMissingDefault,
    unknownDefaultRejected: unknownDefaultErrors.length > 0,
    duplicatePresetIdRejected: duplicatePresetErrors.length > 0,
    fixtureDefaultResolved,
    fixtureNeutralPresetAccepted: !neutralPresetResult.issues,
    hostStandardPreserved,
    registryInjectionRequired,
    presetAccepted: !presetResult.issues,
    instructionConfigAccepted: !instructionResult.issues,
    childPluginStructureAccepted: childProblem === undefined,
    scratchDefaultId: registryRow?.config?.default ?? null,
    presetId: auditorRow?.config?.id ?? null,
    instructionCandidates: instructionRow?.config?.instructionFileCandidates ?? [],
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
    let stdoutTail = ""
    let stderrTail = ""
    let stdoutTruncated = false
    let stderrTruncated = false
    let timedOut = false
    const capture = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8")
      let current = stream === "stdout" ? stdout : stderr
      let tail = stream === "stdout" ? stdoutTail : stderrTail
      let truncated = stream === "stdout" ? stdoutTruncated : stderrTruncated
      if (!truncated && Buffer.byteLength(current) + chunk.length <= maxOutputBytes) {
        current += text
      } else {
        const half = Math.floor(maxOutputBytes / 2)
        if (!truncated) {
          const combined = current + text
          current = combined.slice(0, half)
          tail = combined.slice(-half)
          truncated = true
        } else {
          tail = (tail + text).slice(-half)
        }
      }
      if (stream === "stdout") { stdout = current; stdoutTail = tail; stdoutTruncated = truncated }
      else { stderr = current; stderrTail = tail; stderrTruncated = truncated }
    }
    child.stdout.on("data", (chunk: Buffer) => capture("stdout", chunk))
    child.stderr.on("data", (chunk: Buffer) => capture("stderr", chunk))
    const timer = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child)
    }, options.timeoutMs)
    child.once("error", (error) => {
      clearTimeout(timer)
      resolveResult({ exitCode: null, signal: null, timedOut, stdout: stdoutTruncated ? `${stdout}\n<output truncated>\n${stdoutTail}` : stdout, stderr: `${stderrTruncated ? `${stderr}\n<output truncated>\n${stderrTail}` : stderr}\n${error.message}` })
    })
    child.once("close", (code, signal) => {
      clearTimeout(timer)
      resolveResult({
        exitCode: code,
        signal,
        timedOut,
        stdout: stdoutTruncated ? `${stdout}\n<output truncated>\n${stdoutTail}` : stdout,
        stderr: stderrTruncated ? `${stderr}\n<output truncated>\n${stderrTail}` : stderr,
      })
    })
  })
}

function runDsh(nodeExecutable: string, dshExecutable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; stdin?: "ignore" | "pipe" }): Promise<CommandResult> {
  // findExecutable resolves symlinks, so the DSH bin becomes lib/bin.js.
  // Invoke that script with the selected Node binary instead of relying on the
  // parent runtime's shebang handling for a directly spawned JavaScript file.
  return run(nodeExecutable, [dshExecutable, ...args], options)
}

function runDshWithPty(scriptExecutable: string, nodeExecutable: string, dshExecutable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CommandResult> {
  const command = [nodeExecutable, dshExecutable, ...args].map(shellQuote).join(" ")
  return run(scriptExecutable, ["-q", "-e", "-c", command, "/dev/null"], options)
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

function createObserverPackage(
  observerRoot: string,
  workspace: string,
  observerResult: string,
  auditorMarkdownSourceSha256: string | null,
  auditorMarkdownSourceSha1: string | null,
): void {
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
export const inject = ["tools", "skills", "sessions", "agents", "agentPresets", "sessionProjections"];
const expected = ${JSON.stringify(expectedTools)};
const auditorMarkdownSourceSha256 = ${JSON.stringify(auditorMarkdownSourceSha256)};
const auditorMarkdownSourceSha1 = ${JSON.stringify(auditorMarkdownSourceSha1)};
const sha = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const sha1 = async (path) => createHash("sha1").update(await readFile(path)).digest("hex");
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
const resultMessage = (result) => {
  if (typeof result?.error?.message === "string") return result.error.message;
  const content = Array.isArray(result?.content)
    ? result.content.filter((block) => block.type === "text").map((block) => block.text).join("\\n")
    : "";
  if (content) return content.replace(/^Error:\\s*/, "");
  return typeof result?.value === "string" ? result.value : "";
};
const runTool = async (context, callId, name, args, agent) => {
  const controller = new AbortController();
  const result = await context.tools.execute({ callId, name, arguments: args, agent, signal: controller.signal });
  return { result, message: resultMessage(result), aborted: controller.signal.aborted };
};
const modelEventCount = (session) => session.snapshotEvents().filter((event) =>
  event.type === "request/header"
).length;
const decoyOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};
${renderControlPresetSelector(e2eControlPresetId)}

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

  const sessionController = ctx.get("sessionController");
  const presetRows = await ctx.agentPresets.list();
  const auditorPresetRow = presetRows.find((preset) => preset.id === "banca-auditor");
  if (!auditorPresetRow || auditorPresetRow.broken) fail("the host AgentPresetRegistry did not load a usable banca-auditor declaration");
  const resolvedPreset = await ctx.agentPresets.resolve("banca-auditor");
  if (resolvedPreset.id !== "banca-auditor" || resolvedPreset.broken) fail("the DSH host did not validate the banca-auditor preset");
  const presetDocument = typeof ctx.agentPresets.readDocument === "function"
    ? await ctx.agentPresets.readDocument("banca-auditor")
    : undefined;
  const presetCompositionContent = typeof presetDocument?.content === "string" ? presetDocument.content : "";
  const presetCompositionHasInstructionLoader = presetCompositionContent.includes("@deepseek-ai/dsh-agent-instructions");
  const presetCompositionSha256 = presetCompositionContent.length > 0
    ? createHash("sha256").update(presetCompositionContent).digest("hex")
    : null;

  const auditorHandle = await ctx.agents.create({
    sessionId: "session-dshbanca-e2e-auditor-" + process.pid + "-" + Date.now(),
    meta: { cwd: workspace },
  });
  let unverifiedHandle;
  let controlHandle;
  let result;
  let auditorAgentId;
  let controlAgentId;
  try {
    const agent = auditorHandle.agent;
    auditorAgentId = agent.id;
    const session = agent.session;
    if (
      ctx.agents.get(agent.id) !== agent ||
      ctx.sessions.get(agent.id) !== session ||
      agent.id !== session.id ||
      session.header.cwd !== workspace
    ) fail("ctx.agents.create did not publish one live DSH Agent and matching SessionStore identity");
    if (agent.status !== "idle") fail("fresh DSH Agent was not idle before direct native ToolRuntime validation");

    const init = await runTool(ctx, "dshbanca-e2e-init", "banca_init", {}, agent);
    if (init.result.isError) fail("native banca_init execution failed for the live DSH Agent");
    const files = ["main.tex", "referencias.bib", ".banca/project.json", ".banca/state.json"];
    for (const file of files) {
      try { await readFile(join(workspace, file)); }
      catch { fail("banca_init did not create the expected synthetic project state"); }
    }
    const installedAuditorMarkdownPath = join(workspace, ".dsh", "agents", "banca-auditor.md");
    const loaderAuditorMarkdownPath = join(workspace, "banca-auditor.md");
    let installedAuditorMarkdownSha256 = null;
    let installedAuditorMarkdownSha1 = null;
    let loaderAuditorMarkdownSha256 = null;
    let loaderAuditorMarkdownSha1 = null;
    try {
      installedAuditorMarkdownSha256 = await sha(installedAuditorMarkdownPath);
      installedAuditorMarkdownSha1 = await sha1(installedAuditorMarkdownPath);
    } catch {
      // Missing installed instructions are captured as a BLOCKED/FAIL issue #3 result below.
    }
    try {
      loaderAuditorMarkdownSha256 = await sha(loaderAuditorMarkdownPath);
      loaderAuditorMarkdownSha1 = await sha1(loaderAuditorMarkdownPath);
    } catch {
      // The native loader-root candidate is independently required by issue #3.
    }

    const baselineText = "\\\\documentclass{article}\\n\\\\begin{document}\\nBASELINE_SENTINEL synthetic manuscript.\\n\\\\end{document}\\n";
    await writeFile(join(workspace, "main.tex"), baselineText, { mode: 0o600 });
    const restoreLabel = "dshbanca-issue-2-restore-sentinel";
    const snapshot = await runTool(ctx, "dshbanca-e2e-snapshot", "banca_snapshot", { label: restoreLabel }, agent);
    if (snapshot.result.isError || !snapshot.message.includes("Recovery point verified: restorable")) {
      fail("the non-auditor setup could not create a verified restorable snapshot");
    }
    const snapshotState = JSON.parse(await readFile(join(workspace, ".banca", "state.json"), "utf8"));
    const snapshotExists = Array.isArray(snapshotState.snapshots) && snapshotState.snapshots.some((row) =>
      row.id === restoreLabel || row.label === restoreLabel
    );
    if (!snapshotExists) fail("the DSHbanca state did not persist the setup snapshot used by the restore denial");

    const beforeCorrection = await readFile(join(workspace, "main.tex"), "utf8");
    const setupCorrectionArgs = {
      corrections: [{ file: "main.tex", oldText: "BASELINE_SENTINEL", newText: "CURRENT_SENTINEL" }],
      skipSnapshot: true,
    };
    const setupCorrection = await runTool(ctx, "dshbanca-e2e-setup-correction", "banca_corrigir", setupCorrectionArgs, agent);
    const currentText = await readFile(join(workspace, "main.tex"), "utf8");
    const correctionWouldMutate = beforeCorrection.includes("BASELINE_SENTINEL") &&
      setupCorrection.result.isError === false && currentText.includes("CURRENT_SENTINEL");
    if (!correctionWouldMutate) fail("the valid synthetic correction precondition did not perform its expected setup mutation");
    const restoreWouldMutate = snapshotExists && currentText !== baselineText;
    if (!restoreWouldMutate) fail("the valid snapshot restore precondition would not change the synthetic manuscript");

    const presetSelected = await ctx.agentPresets.select(agent, "banca-auditor");
    const effectivePreset = ctx.agentPresets.composedPreset(agent.ctx);
    const sessionPresetProjection = ctx.sessionProjections.stateOf(session, "agentPreset");
    if (
      presetSelected !== "banca-auditor" ||
      effectivePreset !== "banca-auditor" ||
      sessionPresetProjection !== "banca-auditor"
    ) fail("native DSH preset selection did not produce a live banca-auditor Agent composition");

    controlHandle = await ctx.agents.create({
      sessionId: "session-dshbanca-e2e-control-" + process.pid + "-" + Date.now(),
      meta: { cwd: workspace },
    });
    const controlAgent = controlHandle.agent;
    controlAgentId = controlAgent.id;
    const controlSession = controlAgent.session;
    if (ctx.agents.get(controlAgent.id) !== controlAgent || ctx.sessions.get(controlAgent.id) !== controlSession || controlAgent.id !== controlSession.id) {
      fail("the control Agent/Session was not published by native DSH registries");
    }
    await selectControlPreset(ctx, controlAgent);

    const preStepObservations = [];
    let forbiddenStepStarts = 0;
    let forbiddenAgentRequests = 0;
    ctx.on("session/event", (observedSession, event) => {
      if ((observedSession === session || observedSession === controlSession) && event.type === "step/start") forbiddenStepStarts++;
    });
    ctx.on("agent/pre-step", async (payload, next) => {
      const decision = await next();
      if (payload.agent !== agent && payload.agent !== controlAgent) return decision;
      const messages = decision.kind === "enter" ? decision.messages : [];
      const instructionMessages = messages.filter((message) => message?.source?.kind === "agent-instructions" &&
        message.source.changes?.some((change) => change?.path === "banca-auditor.md"));
      const instructionMessage = instructionMessages[0];
      preStepObservations.push({
        id: instructionMessage?.id ?? "",
        agentId: payload.agent.id,
        sessionId: payload.agent.session.id,
        step: payload.step,
        turn: payload.turn,
        role: instructionMessage?.role ?? null,
        source: instructionMessage?.source ?? null,
        instructionMessageCount: instructionMessages.length,
      });
      return { kind: "reject" };
    });
    ctx.on("agent/request", async ({ agent: requestedAgent }, next) => {
      if (requestedAgent === agent || requestedAgent === controlAgent) {
        forbiddenAgentRequests++;
        throw new Error("DSHbanca E2E fail-closed barrier: agent/request is forbidden");
      }
      return next();
    });
    for (const [probeAgent, probeLabel] of [[agent, "auditor"], [controlAgent, "control"]]) {
      probeAgent.send({
        id: "dshbanca-prestep-probe-" + probeLabel + "-" + process.pid,
        role: "user",
        content: [{ type: "text", text: "Synthetic pre-step observation only." }],
        source: { kind: "user" },
      }, "next-turn", true);
      await probeAgent.whenIdle();
    }
    const forbiddenStoredEventTypes = ["step/start", "request/header", "agent/request", "assistant/message"];
    const auditorStoredForbiddenEvents = session.snapshotEvents()
      .filter((event) => forbiddenStoredEventTypes.includes(event.type))
      .map((event) => event.type);
    const controlStoredForbiddenEvents = controlSession.snapshotEvents()
      .filter((event) => forbiddenStoredEventTypes.includes(event.type))
      .map((event) => event.type);
    if (forbiddenStepStarts !== 0 || forbiddenAgentRequests !== 0) {
      fail("pre-step observation crossed the fail-closed barrier into step/start or agent/request");
    }
    if (auditorStoredForbiddenEvents.length !== 0 || controlStoredForbiddenEvents.length !== 0) {
      fail("native Session event logs contain a forbidden lifecycle event after pre-step rejection");
    }
    const auditorPreStep = preStepObservations.find((observation) => observation.agentId === agent.id);
    const controlPreStep = preStepObservations.find((observation) => observation.agentId === controlAgent.id);
    if (!auditorPreStep || !controlPreStep) fail("native agent/pre-step was not observed for both auditor and control Agents");
    const instructionMessages = auditorPreStep.source?.kind === "agent-instructions" ? [auditorPreStep.source] : [];
    const loadedSourceSha1 = instructionMessages
      .flatMap((source) => Array.isArray(source?.changes) ? source.changes : [])
      .find((change) => change?.path === "banca-auditor.md")?.digest ?? null;

    const turnEventsBeforeGuard = modelEventCount(session);
    if (turnEventsBeforeGuard !== 0) fail("a model-facing turn/request event appeared before the guard checks");

    const correctionArgs = {
      corrections: [{ file: "main.tex", oldText: "CURRENT_SENTINEL", newText: "AUDITOR_MUTATION_MUST_NOT_RUN" }],
      skipSnapshot: true,
    };
    const restoreArgs = { snapshotId: restoreLabel, confirm: true };
    const deniedBefore = await inventory(workspace);
    const correctionAttempt = await runTool(ctx, "dshbanca-e2e-auditor-correct", "banca_corrigir", correctionArgs, agent);
    const restoreAttempt = await runTool(ctx, "dshbanca-e2e-auditor-restore", "banca_restore", restoreArgs, agent);

    let nativeBodyInvocations = 0;
    const nativeBodyMarker = ".dshbanca-native-guard-body-ran";
    const disposeNativeProbe = agent.ctx.tools.register({
      name: "banca_corrigir",
      description: "Issue #2 guard probe: this scoped body has no DSHbanca identity check and would mutate the synthetic manuscript.",
      parameters: { type: "object" },
      output: decoyOutput,
      async execute() {
        nativeBodyInvocations++;
        await writeFile(join(workspace, nativeBodyMarker), "native guard failed to stop this body\\n", { mode: 0o600 });
        await writeFile(join(workspace, "main.tex"), "NATIVE_GUARD_PROBE_MUTATED_THE_MANUSCRIPT\\n", { mode: 0o600 });
        return "native guard probe body ran";
      },
    });
    const nativeProbe = await runTool(ctx, "dshbanca-e2e-native-guard-probe", "banca_corrigir", correctionArgs, agent);
    disposeNativeProbe();

    let nativeRestoreBodyInvocations = 0;
    const nativeRestoreMarker = ".dshbanca-native-restore-guard-body-ran";
    const disposeNativeRestoreProbe = agent.ctx.tools.register({
      name: "banca_restore",
      description: "Issue #2 restore guard probe: this scoped body has no DSHbanca identity check and would restore the synthetic manuscript.",
      parameters: { type: "object" },
      output: decoyOutput,
      async execute() {
        nativeRestoreBodyInvocations++;
        await writeFile(join(workspace, nativeRestoreMarker), "native restore guard failed to stop this body\\n", { mode: 0o600 });
        await writeFile(join(workspace, "main.tex"), baselineText, { mode: 0o600 });
        return "native restore guard probe body ran";
      },
    });
    const nativeRestoreProbe = await runTool(ctx, "dshbanca-e2e-native-restore-guard-probe", "banca_restore", restoreArgs, agent);
    disposeNativeRestoreProbe();

    const afterNativeProbe = await inventory(workspace);
    const deniedAfter = afterNativeProbe;
    if (JSON.stringify(deniedBefore) !== JSON.stringify(deniedAfter)) fail("an auditor denial changed protected synthetic files or persistent state");
    if (
      nativeBodyInvocations !== 0 ||
      nativeRestoreBodyInvocations !== 0 ||
      Object.hasOwn(afterNativeProbe, nativeBodyMarker) ||
      Object.hasOwn(afterNativeProbe, nativeRestoreMarker)
    ) {
      fail("the native DSH guard did not stop the scoped mutation body before dispatch");
    }

    const auditorMutationAttempts = [
      {
        toolName: "banca_corrigir",
        dispatchCount: 1,
        argumentsValid: correctionWouldMutate,
        operationWouldMutate: correctionWouldMutate,
        isError: correctionAttempt.result.isError === true,
        message: correctionAttempt.message,
        aborted: correctionAttempt.aborted,
      },
      {
        toolName: "banca_restore",
        dispatchCount: 1,
        argumentsValid: snapshotExists && restoreArgs.confirm === true,
        operationWouldMutate: restoreWouldMutate,
        isError: restoreAttempt.result.isError === true,
        message: restoreAttempt.message,
        aborted: restoreAttempt.aborted,
      },
    ];
    if (auditorMutationAttempts.some((attempt) => !attempt.isError || attempt.aborted || !attempt.message.includes("read-only enforcement"))) {
      fail("the auditor mutation attempt was not classified as a non-aborted read-only guard denial");
    }

    const statusBefore = await inventory(workspace);
    const status = await runTool(ctx, "dshbanca-e2e-auditor-status", "banca_status", {}, agent);
    const statusAfter = await inventory(workspace);
    const statusSucceeded = status.result.isError === false && status.message.includes("main.tex");
    if (!statusSucceeded || JSON.stringify(statusBefore) !== JSON.stringify(statusAfter)) {
      fail("banca_status did not remain permitted and read-only for the real auditor Agent");
    }

    unverifiedHandle = await ctx.agents.create({
      sessionId: "session-dshbanca-e2e-unverified-subagent-" + process.pid + "-" + Date.now(),
      meta: {
        cwd: workspace,
        parentSession: agent.id,
        origin: "subagent",
        delegationDepth: 1,
      },
    });
    const unverifiedAgent = unverifiedHandle.agent;
    const unverifiedPreset = ctx.agentPresets.composedPreset(unverifiedAgent.ctx);
    if (
      ctx.agents.get(unverifiedAgent.id) !== unverifiedAgent ||
      ctx.sessions.get(unverifiedAgent.id) !== unverifiedAgent.session ||
      unverifiedAgent.session.header.origin !== "subagent"
    ) fail("unverified delegation fixture was not created as a live DSH Agent with subagent Session metadata");

    const unverifiedBefore = await inventory(workspace);
    let unverifiedBodyInvocations = 0;
    const unverifiedMarker = ".dshbanca-unverified-subagent-body-ran";
    const disposeUnverifiedProbe = unverifiedAgent.ctx.tools.register({
      name: "banca_corrigir",
      description: "Issue #2 fail-closed probe for a real subagent-origin Agent without a verified corrector preset.",
      parameters: { type: "object" },
      output: decoyOutput,
      async execute() {
        unverifiedBodyInvocations++;
        await writeFile(join(workspace, unverifiedMarker), "unverified subagent body ran\\n", { mode: 0o600 });
        await writeFile(join(workspace, "main.tex"), "UNVERIFIED_SUBAGENT_MUTATED_THE_MANUSCRIPT\\n", { mode: 0o600 });
        return "unverified subagent body ran";
      },
    });
    const unverifiedAttempt = await runTool(ctx, "dshbanca-e2e-unverified-correction", "banca_corrigir", correctionArgs, unverifiedAgent);
    disposeUnverifiedProbe();
    const unverifiedAfter = await inventory(workspace);
    if (
      unverifiedAttempt.result.isError !== true ||
      unverifiedAttempt.aborted ||
      !unverifiedAttempt.message.includes("without a verified banca-corretor preset") ||
      unverifiedBodyInvocations !== 0 ||
      Object.hasOwn(unverifiedAfter, unverifiedMarker) ||
      JSON.stringify(unverifiedBefore) !== JSON.stringify(unverifiedAfter)
    ) fail("a live subagent-origin Agent without verified corrector identity was not denied before mutation");

    const auditorEventsAfterChecks = modelEventCount(session);
    const childModelEvents = modelEventCount(unverifiedAgent.session);
    if (auditorEventsAfterChecks !== 0 || childModelEvents !== 0) fail("the profile E2E unexpectedly entered a model-facing turn");

    result = {
      lifecycle: "observer Cordis apply reached; real DSH AgentRegistry.create + AgentLoop publication; preset registry resolution and selection observed; direct ToolRuntime calls only",
      profileRuntime: true,
      session: "live DSH SessionStore Session and AgentRegistry Agent; no session.prompt, Agent.send, turn/start, or request/header event",
      hostApiSurvey: {
        agentRegistryCreate: typeof ctx.agents?.create === "function",
        toolRuntimeExecute: typeof ctx.tools?.execute === "function",
        agentPresetRegistrySelect: typeof ctx.agentPresets?.select === "function",
        agentPresetRegistryComposedPreset: typeof ctx.agentPresets?.composedPreset === "function",
        agentPresetRegistryReadDocument: typeof ctx.agentPresets?.readDocument === "function",
        sessionControllerCreate: typeof sessionController?.create === "function",
        sessionControllerPrompt: typeof sessionController?.prompt === "function",
      },
      auditorMarkdownEvidence: {
        sourcePath: "assets/dsh/agents/banca-auditor.md",
        sourceSha256: auditorMarkdownSourceSha256,
        sourceSha1: auditorMarkdownSourceSha1,
        installedPath: ".dsh/agents/banca-auditor.md",
        installedSha256: installedAuditorMarkdownSha256,
        installedSha1: installedAuditorMarkdownSha1,
        loaderCopyPath: "banca-auditor.md",
        loaderCopySha256: loaderAuditorMarkdownSha256,
        loaderCopySha1: loaderAuditorMarkdownSha1,
        hostDiscovered: loadedSourceSha1 === auditorMarkdownSourceSha1,
        presetId: "banca-auditor",
        presetDeclarationSource: "DSHbanca Cordis bundle patch",
        presetCompositionSha256,
        presetCompositionEmpty: presetCompositionContent.trim() === "[]" || presetCompositionContent.trim() === "",
        presetCompositionHasInstructionLoader,
        instructionContextMessageCount: auditorPreStep.instructionMessageCount,
        loadedSourceSha1,
        nativePreStepObserved: true,
        instructionMessageRole: auditorPreStep.role,
        instructionMessageSourceKind: auditorPreStep.source?.kind ?? null,
        instructionMessagePath: auditorPreStep.source?.changes?.find((change) => change?.digest === loadedSourceSha1)?.path ?? null,
        controlInstructionMessageCount: controlPreStep.instructionMessageCount,
        preStepEvent: { id: auditorPreStep.id, agentId: auditorPreStep.agentId, sessionId: auditorPreStep.sessionId },
        preStepEventIds: [auditorPreStep.id],
        agentAndSessionIdMatch: agent.id === session.id,
        agentRegistryContainsAgent: ctx.agents.get(agent.id) === agent,
        sessionStoreContainsSession: ctx.sessions.get(agent.id) === session,
        effectivePreset,
        sessionPresetProjection,
        syntheticContext: false,
        syntheticPresetFixture: false,
        modelCalls: auditorEventsAfterChecks,
        credentialsUsed: false,
      },
      toolNames: tools,
      exactToolSet: true,
      skillFound,
      executedTools: ["banca_init", "banca_snapshot", "banca_corrigir", "banca_restore", "banca_status"],
      statusSucceeded,
      statusReadOnly: JSON.stringify(statusBefore) === JSON.stringify(statusAfter),
      workspaceInventoryBeforeStatus: statusBefore,
      workspaceInventoryAfterStatus: statusAfter,
      agentIdentity: {
        createdVia: "ctx.agents.create",
        agentRegistryContainsAgent: true,
        sessionStoreContainsSession: true,
        agentAndSessionIdMatch: agent.id === session.id,
        presetRegisteredByHost: Boolean(auditorPresetRow && !auditorPresetRow.broken),
        presetResolvedByHost: resolvedPreset.id === "banca-auditor" && !resolvedPreset.broken,
        effectivePreset,
        sessionProjectionPreset: sessionPresetProjection,
        syntheticContext: false,
        modelTurnEvents: auditorEventsAfterChecks,
      },
      auditorMutationAttempts,
      nativeGuardProbe: {
        toolName: "banca_corrigir",
        dispatchCount: 1,
        isError: nativeProbe.result.isError === true,
        message: nativeProbe.message,
        bodyInvocations: nativeBodyInvocations,
        bodyMarkerAbsent: !Object.hasOwn(afterNativeProbe, nativeBodyMarker),
      },
      nativeRestoreGuardProbe: {
        toolName: "banca_restore",
        dispatchCount: 1,
        isError: nativeRestoreProbe.result.isError === true,
        message: nativeRestoreProbe.message,
        bodyInvocations: nativeRestoreBodyInvocations,
        bodyMarkerAbsent: !Object.hasOwn(afterNativeProbe, nativeRestoreMarker),
      },
      deniedWorkspaceInventoryBefore: deniedBefore,
      deniedWorkspaceInventoryAfter: deniedAfter,
      permittedStatus: {
        dispatched: true,
        isError: status.result.isError === true,
        outputIncludesMain: status.message.includes("main.tex"),
        inventoryBefore: statusBefore,
        inventoryAfter: statusAfter,
      },
      unverifiedDelegation: {
        agentRegistryContainsAgent: true,
        sessionStoreContainsSession: true,
        agentAndSessionIdMatch: unverifiedAgent.id === unverifiedAgent.session.id,
        sessionOrigin: unverifiedAgent.session.header.origin,
        effectivePreset: unverifiedPreset ?? null,
        attempt: {
          toolName: "banca_corrigir",
          dispatchCount: 1,
          argumentsValid: correctionWouldMutate,
          isError: unverifiedAttempt.result.isError === true,
          message: unverifiedAttempt.message,
          aborted: unverifiedAttempt.aborted,
          bodyInvocations: unverifiedBodyInvocations,
        },
        inventoryBefore: unverifiedBefore,
        inventoryAfter: unverifiedAfter,
        modelTurnEvents: childModelEvents,
      },
      agentTeardown: { auditorAgentDisposed: false, controlAgentDisposed: false, unverifiedAgentDisposed: false },
      externalActivity: {
        modelCalls: 0,
        sessionPromptCalls: 0,
        agentSendCalls: 2,
        agentRequestEvents: forbiddenAgentRequests,
        stepStartEvents: forbiddenStepStarts,
        forbiddenStoredEventTypes,
        auditorStoredForbiddenEvents,
        controlStoredForbiddenEvents,
        credentialsUsed: false,
      },
    };
  } finally {
    const disposalErrors = [];
    if (controlHandle) {
      try {
        await controlHandle.dispose();
        if (result) result.agentTeardown.controlAgentDisposed = true;
      } catch (error) {
        disposalErrors.push(error);
      }
    } else if (result) {
      result.agentTeardown.controlAgentDisposed = true;
    }
    if (unverifiedHandle) {
      try {
        await unverifiedHandle.dispose();
        if (result) result.agentTeardown.unverifiedAgentDisposed = true;
      } catch (error) {
        disposalErrors.push(error);
      }
    } else if (result) {
      result.agentTeardown.unverifiedAgentDisposed = true;
    }
    try {
      await auditorHandle.dispose();
      if (result) result.agentTeardown.auditorAgentDisposed = true;
    } catch (error) {
      disposalErrors.push(error);
    }
    if (disposalErrors.length > 0) throw new AggregateError(disposalErrors, "DSH Agent handle teardown failed");
  }
  if (!result.agentTeardown.auditorAgentDisposed || !result.agentTeardown.controlAgentDisposed || !result.agentTeardown.unverifiedAgentDisposed) {
    fail("real DSH Agent handles were not explicitly disposed");
  }
  const auditorAgentUnregistered = auditorAgentId !== undefined && ctx.agents.get(auditorAgentId) === undefined && ctx.sessions.get(auditorAgentId) === undefined
  const controlAgentUnregistered = controlAgentId !== undefined && ctx.agents.get(controlAgentId) === undefined && ctx.sessions.get(controlAgentId) === undefined
  result.agentTeardown.auditorAgentUnregistered = auditorAgentUnregistered
  result.agentTeardown.controlAgentUnregistered = controlAgentUnregistered
  if (!auditorAgentUnregistered || !controlAgentUnregistered) fail("disposed auditor/control Agent or Session remained registered");
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
  try {
    const nativePresetSchema = await validateNativePresetConfig(dshExecutable)
    report.stages.nativePresetSchema = nativePresetSchema
    if (!nativePresetSchema.accepted) {
      fail("installed DSH native preset schemas rejected the bundled auditor composition", "FAIL")
      return
    }
  } catch {
    report.stages.nativePresetSchema = { status: "BLOCKED", packageContractsAvailable: false }
    fail("installed DSH preset schema API is unavailable; native config validation cannot be claimed", "BLOCKED")
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

  const dshRoot = findDshPackageRoot(dshExecutable)
  if (!dshRoot) {
    fail("DSH executable was found but its installed @deepseek-ai/dsh package root could not be verified", "BLOCKED")
    return
  }
  const dshManifest = JSON.parse(readFileSync(join(dshRoot, "package.json"), "utf8"))
  report.versions.dsh = dshManifest.version
  report.stages.dshVersionSource = "package manifest adjacent to the resolved DSH CLI entrypoint; interactive preflight separately runs dsh --version"
  const cordisManifestPath = findPackageJson(dshRoot, "@deepseek-ai/cordis")
  const loaderManifestPath = findPackageJson(dshRoot, "@deepseek-ai/cordis-plugin-loader")
  if (!cordisManifestPath || !loaderManifestPath) {
    fail("DSH installation is missing Cordis or cordis-plugin-loader package metadata", "BLOCKED")
    return
  }
  report.versions.cordis = JSON.parse(readFileSync(cordisManifestPath, "utf8")).version
  report.versions.cordisPluginLoader = JSON.parse(readFileSync(loaderManifestPath, "utf8")).version

  const hostPackageVersions = [
    ["dshAgent", "@deepseek-ai/dsh-agent"],
    ["dshAgentLoop", "@deepseek-ai/dsh-agent-loop"],
    ["dshTools", "@deepseek-ai/dsh-tools"],
    ["dshAgentPreset", "@deepseek-ai/dsh-agent-preset"],
    ["dshAgentPresetRegistry", "@deepseek-ai/dsh-agent-preset-registry"],
    ["dshAgentInstructions", "@deepseek-ai/dsh-agent-instructions"],
    ["dshApiSessionController", "@deepseek-ai/dsh-api-session-controller"],
  ] as const
  for (const [key, packageName] of hostPackageVersions) {
    const packageManifest = findPackageJson(dshRoot, packageName)
    if (!packageManifest) {
      fail(`DSH installation is missing required host API package ${packageName}`, "BLOCKED")
      return
    }
    report.versions[key] = JSON.parse(readFileSync(packageManifest, "utf8")).version
  }

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
  report.stages.externalActivity = {
    telemetry: "DISABLED",
    modelCalls: 0,
    sessionPromptCalls: 0,
    agentSendCalls: 0,
    credentialsUsed: false,
    sdkJsonRpcRequestsSent: 0,
  }

  const setup = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--from-default-profile", "sdk", "--dump-config"], { cwd: repositoryRoot, env, timeoutMs })
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
  const auditorMarkdownSourcePath = join(repositoryRoot, "assets", "dsh", "agents", "banca-auditor.md")
  const auditorMarkdownSourceSha256 = existsSync(auditorMarkdownSourcePath) ? hashFile(auditorMarkdownSourcePath) : null
  const auditorMarkdownSourceSha1 = existsSync(auditorMarkdownSourcePath)
    ? createHash("sha1").update(readFileSync(auditorMarkdownSourcePath)).digest("hex")
    : null
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  mkdirSync(join(workspace, ".git"), { recursive: false, mode: 0o700 })
  mkdirSync(join(workspace, "capitulos"), { recursive: true, mode: 0o700 })
  writeFileSync(join(workspace, "main.tex"), "\\documentclass{article}\n\\begin{document}\nTexto acadêmico sintético de validação.\\end{document}\n", { mode: 0o600 })
  writeFileSync(join(workspace, "referencias.bib"), "@article{synthetic2026, title={Referência Sintética}, author={Pessoa, Exemplo}, year={2026}}\n", { mode: 0o600 })
  writeFileSync(join(workspace, "capitulos", "introducao.tex"), "Introdução sintética para teste do DSHbanca.\n", { mode: 0o600 })
  createObserverPackage(observerRoot, workspace, observerResult, auditorMarkdownSourceSha256, auditorMarkdownSourceSha1)
  const overlayPath = join(scratch, "observer.patch.yml")
  writeFileSync(overlayPath, buildSdkPresetOverlayPatch(observerName), { mode: 0o600 })

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

  const add = await runDsh(nodeExecutable, dshExecutable, ["plugin", "--profile", profileName, "add", "--offline", "--store-dir", dirs.pnpmStore, repositoryRoot, observerRoot], { cwd: repositoryRoot, env, timeoutMs })
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

  const scriptExecutable = findExecutable("script")
  if (!scriptExecutable) {
    fail("BLOCKED: a POSIX pseudo-terminal is required to capture the installed DSH --dump-config output", "BLOCKED")
    return
  }
  const dump = await runDshWithPty(scriptExecutable, nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath, "--dump-config"], { cwd: repositoryRoot, env, timeoutMs })
  const presetRegistryEntry = dump.stdout.includes("@deepseek-ai/dsh-agent-preset-registry") && dump.stdout.includes(`default: ${e2eControlPresetId}`)
  const auditorPresetEntry = dump.stdout.includes("@deepseek-ai/dsh-agent-preset") &&
    dump.stdout.includes("id: banca-auditor") &&
    dump.stdout.includes("@deepseek-ai/dsh-agent-instructions") &&
    dump.stdout.includes("instructionFileCandidates:") &&
    dump.stdout.includes("- banca-auditor.md")
  const controlPresetEntry = dump.stdout.includes(`id: ${e2eControlPresetId}`) && dump.stdout.includes("plugins: []")
  report.stages.composedProfile = {
    exitCode: dump.exitCode,
    stdoutBytes: Buffer.byteLength(dump.stdout),
    stderrBytes: Buffer.byteLength(dump.stderr),
    outputTruncated: dump.stdout.includes("<output truncated>") || dump.stderr.includes("<output truncated>"),
    containsDshbancaEntry: dump.stdout.includes("name: dshbanca/dsh"),
    containsObserverEntry: dump.stdout.includes(`name: ${observerName}`),
    containsPresetRegistryEntry: presetRegistryEntry,
    containsAuditorPresetEntry: auditorPresetEntry,
    containsControlPresetEntry: controlPresetEntry,
  }
  const composedEntry = dump.stdout.includes("name: dshbanca/dsh")
  if (dump.exitCode !== 0 || !composedEntry || !dump.stdout.includes(`name: ${observerName}`) || !presetRegistryEntry || !auditorPresetEntry || !controlPresetEntry) {
    fail(`The real DSH composed profile is missing a required DSHbanca, observer, scratch preset-registry, auditor-preset, or control-preset entry (exit=${dump.exitCode}, dshbanca=${composedEntry}, observer=${dump.stdout.includes(`name: ${observerName}`)}, presetRegistry=${presetRegistryEntry}, auditorPreset=${auditorPresetEntry}, controlPreset=${controlPresetEntry})`)
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
    presetRegistryEntry,
    auditorPresetEntry,
    controlPresetEntry,
  })
  if (profileErrors.length > 0) {
    fail(`Profile composition validation failed: ${profileErrors.join("; ")}`)
    return
  }

  if (process.env.DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED !== "yes") {
    report.stages.profileBoot = {
      status: "BLOCKED",
      started: false,
      reason: "new human authorization is required for the one-shot no-model Agent pre-step probe",
    }
    fail("BLOCKED: set DSHBANCA_DSH_PROFILE_LIFECYCLE_AUTHORIZED=yes only after explicit maintainer authorization; no DSH lifecycle was started", "BLOCKED")
    return
  }

  const projectBeforeBoot = inventoryTree(workspace)
  const statusBeforeBoot = repoStatus()
  const boot = await runDsh(nodeExecutable, dshExecutable, ["--profile", profileName, "--patch", overlayPath], { cwd: workspace, env, timeoutMs: bootTimeoutMs })
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
  const auditorMarkdownEvidence = observed.auditorMarkdownEvidence
  const auditorMarkdownErrors = validateAuditorMarkdownEvidence(auditorMarkdownEvidence)
  const auditorMarkdownStatus = classifyAuditorMarkdownStatus(auditorMarkdownEvidence)
  const issue2Status = errors.length === 0 ? "PASS" : "FAIL"
  report.stages.issue2IdentityReadOnly = { status: issue2Status, validationErrors: errors }
  const gateStatuses = classifyProfileGateStatuses(issue2Status, auditorMarkdownStatus)
  report.stages.gateSummary = gateStatuses
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
    agentIdentity: observed.agentIdentity,
    auditorMutationAttempts: observed.auditorMutationAttempts,
    nativeGuardProbe: observed.nativeGuardProbe,
    nativeRestoreGuardProbe: observed.nativeRestoreGuardProbe,
    deniedWorkspaceInventoryBefore: observed.deniedWorkspaceInventoryBefore,
    deniedWorkspaceInventoryAfter: observed.deniedWorkspaceInventoryAfter,
    permittedStatus: observed.permittedStatus,
    unverifiedDelegation: observed.unverifiedDelegation,
    agentTeardown: observed.agentTeardown,
    externalActivity: observed.externalActivity,
    hostApiSurvey: observed.hostApiSurvey,
  }
  report.stages.auditorMarkdown = {
    status: auditorMarkdownStatus,
    evidence: auditorMarkdownEvidence,
    validationErrors: auditorMarkdownErrors,
    hostContract: {
      agentPresetRegistry: {
        version: report.versions.dshAgentPresetRegistry,
        readDocument: "reads a declared preset's child plugin list as YAML",
        markdownAgentImportObserved: false,
      },
      agentInstructions: {
        version: report.versions.dshAgentInstructions,
        defaultCandidates: ["AGENTS.md", "CLAUDE.md"],
        configuredCandidatesMustBeBasenames: true,
        projectionHook: "agent/pre-step",
        projectionRejectedBeforeStepStart: true,
        requestBarrierInstalled: true,
      },
    },
    blocker: auditorMarkdownStatus === "BLOCKED"
      ? "Native agent/pre-step evidence is pending the separately authorized one-shot no-model probe."
      : null,
  }
  if (auditorMarkdownStatus === "FAIL") {
    fail(`Issue #3 auditor Markdown source/install integrity failed: ${auditorMarkdownErrors.join("; ")}`)
    return
  }
  if (auditorMarkdownStatus === "BLOCKED") {
    report.limitations.push("Issue #3 auditor Markdown loading is BLOCKED; this does not change the separate issue #2 identity/read-only result.")
  }
  if (errors.length > 0) {
    fail(`Real DSH runtime evidence violated the profile contract: ${errors.join("; ")}`)
    return
  }
  const projectAfterBoot = inventoryTree(workspace)
  report.stages.syntheticWorkspaceUnchangedByStatus = JSON.stringify(observed.workspaceInventoryBeforeStatus) === JSON.stringify(observed.workspaceInventoryAfterStatus)
  report.stages.syntheticWorkspaceUnchangedByDenials = JSON.stringify(observed.deniedWorkspaceInventoryBefore) === JSON.stringify(observed.deniedWorkspaceInventoryAfter)
  report.stages.syntheticWorkspaceFilesCreatedByNativeInit = Object.keys(projectAfterBoot).length > Object.keys(projectBeforeBoot).length
  report.stages.modelTurnEvents = {
    auditor: observed.agentIdentity?.modelTurnEvents,
    unverifiedSubagent: observed.unverifiedDelegation?.modelTurnEvents,
  }
  if (!report.stages.syntheticWorkspaceUnchangedByStatus || !report.stages.syntheticWorkspaceUnchangedByDenials || !report.stages.syntheticWorkspaceFilesCreatedByNativeInit) {
    fail("Expected status/denial integrity or native initialization effects were not observed")
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
  finalStatus = gateStatuses.overallStatus
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
    report.failures.push(`Could not preserve sanitized report at ${reportPathLabel}: ${error instanceof Error ? error.message : "unknown error"}`)
    process.stderr.write(`FAIL: report persistence failed (${reportPathLabel})\n`)
  }
}

const auditorMarkdownStatus = typeof report.stages.auditorMarkdown === "object" && report.stages.auditorMarkdown !== null
  ? (report.stages.auditorMarkdown as { status?: string }).status ?? "NOT_EVALUATED"
  : "NOT_EVALUATED"
process.stdout.write(`${finalStatus}: DSH native identity/read-only profile gate (#2); auditor Markdown loading (#3): ${auditorMarkdownStatus}\n`)
process.stdout.write(`Report: ${reportPathLabel}\n`)
if (report.versions.dsh) process.stdout.write(`DSH ${report.versions.dsh}; Cordis ${report.versions.cordis ?? "unknown"}; loader ${report.versions.cordisPluginLoader ?? "unknown"}; Agent ${report.versions.dshAgent ?? "unknown"}; AgentLoop ${report.versions.dshAgentLoop ?? "unknown"}; Tools ${report.versions.dshTools ?? "unknown"}; AgentPreset ${report.versions.dshAgentPreset ?? "unknown"}; PresetRegistry ${report.versions.dshAgentPresetRegistry ?? "unknown"}; SessionController ${report.versions.dshApiSessionController ?? "unknown"}; Bun ${report.versions.bun ?? "unknown"}; Node ${report.versions.node ?? "unknown"}; pnpm ${report.versions.pnpm ?? "unknown"}\n`)
for (const failure of report.failures) process.stderr.write(`${finalStatus}: ${failure}\n`)
process.exitCode = finalStatus === "PASS" ? passExitCode() : finalStatus === "BLOCKED" ? missingHostExitCode() : failureExitCode()
