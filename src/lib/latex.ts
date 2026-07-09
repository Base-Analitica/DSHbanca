import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve, relative } from "node:path"

export interface CompileResult {
  success: boolean
  output: string
  errors: string[]
  elapsedMs: number
}

export interface LatexCommand {
  command: string
  args: string[]
  label?: string
}

const ALLOWED_ENGINES = new Set(["lualatex", "xelatex", "pdflatex"])
const ALLOWED_BIB_ENGINES = new Set(["bibtex", "biber"])

export function validateEngine(engine: string): boolean {
  return ALLOWED_ENGINES.has(engine)
}

export function validateBibEngine(engine: string): boolean {
  return ALLOWED_BIB_ENGINES.has(engine)
}

export function buildCompileCommands(
  compileCommand: string[],
  mainFileAbs: string,
  cwdAbs: string
): LatexCommand[] {
  const relMain = relative(cwdAbs, mainFileAbs)
  const relMainBase = relMain.replace(/\.tex$/, "")
  const commands: LatexCommand[] = []
  for (let i = 0; i < compileCommand.length; i++) {
    const cmd = compileCommand[i]
    if (ALLOWED_ENGINES.has(cmd)) {
      commands.push({
        command: cmd,
        args: ["-interaction=nonstopmode", relMain],
        label: `${cmd} pass ${i + 1}`
      })
    } else if (ALLOWED_BIB_ENGINES.has(cmd)) {
      commands.push({
        command: cmd,
        args: [relMainBase],
        label: `${cmd} bibliography`
      })
    }
  }
  return commands
}

export function findLatexEngine(): string | null {
  for (const cmd of ["lualatex", "xelatex", "pdflatex"]) {
    try {
      const result = spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 10_000 })
      if (result.status === 0) return cmd
    } catch {
      continue
    }
  }
  return null
}

export function findBibEngine(): string | null {
  for (const cmd of ["bibtex", "biber"]) {
    try {
      const result = spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 10_000 })
      if (result.status === 0) return cmd
    } catch {
      continue
    }
  }
  return null
}

export function runCommand(cmd: LatexCommand, cwd: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(cmd.command, cmd.args, {
    cwd,
    encoding: "utf-8",
    timeout: 120_000,
  })

  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
  }
}

export function compileLatex(
  projectRoot: string,
  mainFile: string,
  steps: LatexCommand[]
): CompileResult {
  const start = Date.now()
  const allErrors: string[] = []
  const allOutput: string[] = []

  for (const step of steps) {
    if (!existsSync(resolve(projectRoot, mainFile))) {
      return { success: false, output: "", errors: [`main file not found: ${mainFile}`], elapsedMs: Date.now() - start }
    }

    const label = step.label ?? `${step.command} ${step.args.join(" ")}`
    try {
      const result = runCommand(step, projectRoot)
      allOutput.push(result.stdout)

      if (result.status !== 0) {
        const msg = result.stderr || `exit code ${result.status}`
        allErrors.push(`[${label}] ${msg}`)
        allOutput.push(result.stderr)
      }
    } catch (err: any) {
      const msg = err.message || String(err)
      allErrors.push(`[${label}] ${msg}`)
      allOutput.push(msg)
    }
  }

  return {
    success: allErrors.length === 0,
    output: allOutput.join("\n"),
    errors: allErrors,
    elapsedMs: Date.now() - start,
  }
}
