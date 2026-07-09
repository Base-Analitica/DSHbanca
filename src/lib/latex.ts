import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

export interface CompileResult {
  success: boolean
  output: string
  errors: string[]
  elapsedMs: number
}

export function findLatexEngine(): string | null {
  for (const cmd of ["lualatex", "xelatex", "pdflatex"]) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" })
      return cmd
    } catch { }
  }
  return null
}

export function findBibEngine(): string | null {
  for (const cmd of ["bibtex", "biber"]) {
    try {
      execSync(`${cmd} --version`, { stdio: "ignore" })
      return cmd
    } catch { }
  }
  return null
}

export function compileLatex(projectRoot: string, mainFile: string, command: string[]): CompileResult {
  const start = Date.now()
  const allErrors: string[] = []
  const allOutput: string[] = []

  for (const step of command) {
    if (!existsSync(resolve(projectRoot, mainFile))) {
      return { success: false, output: "", errors: [`main file not found: ${mainFile}`], elapsedMs: Date.now() - start }
    }
    try {
      const out = execSync(step, { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"], timeout: 120_000 })
      allOutput.push(out.toString())
    } catch (err: any) {
      const msg = err.stderr?.toString() || err.message || String(err)
      allErrors.push(`[${step}] ${msg}`)
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
