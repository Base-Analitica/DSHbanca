import { resolve, sep } from "node:path"
import { existsSync, mkdirSync, readdirSync } from "node:fs"
import type { ProjectConfig } from "./config"

export interface ResolvedPaths {
  root: string
  main: string
  bib: string
  chapters: string[]
  outputDir: string
}

export function resolveManuscriptPaths(projectRoot: string, config: ProjectConfig): ResolvedPaths {
  const root = resolve(projectRoot, config.manuscript.root)
  const main = resolve(root, config.manuscript.main)
  const bib = resolve(root, config.manuscript.bib)
  const chaptersDir = resolve(root, "capitulos")
  let chapters: string[] = []
  if (existsSync(chaptersDir)) {
    chapters = readdirSync(chaptersDir)
      .filter((f) => f.endsWith(".tex"))
      .map((f) => resolve(chaptersDir, f))
  }
  const outputDir = resolve(projectRoot, config.manuscript.outputDir)
  return { root, main, bib, chapters, outputDir }
}

export function globToRegex(pattern: string): RegExp {
  let s = "^"
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
      s += "(.*/)?"
      i += 3
    } else if (c === "*" && pattern[i + 1] === "*") {
      s += ".*"
      i += 2
    } else if (c === "*") {
      s += "[^/]*"
      i += 1
    } else if (c === ".") {
      s += "\\."
      i += 1
    } else {
      s += c
      i += 1
    }
  }
  s += "$"
  return new RegExp(s)
}

export function isPathProtected(filePath: string, config: ProjectConfig): boolean {
  const normalized = filePath.replace(sep, "/")
  for (const pattern of config.protectedPaths) {
    if (globToRegex(pattern).test(normalized)) return true
  }
  return false
}

export function isPathAllowed(filePath: string, config: ProjectConfig): boolean {
  const normalized = filePath.replace(sep, "/")
  for (const pattern of config.allowedPaths) {
    if (globToRegex(pattern).test(normalized)) return true
  }
  return false
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
