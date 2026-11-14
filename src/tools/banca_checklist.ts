import { existsSync, readFileSync } from "node:fs"
import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { loadConfig } from "../lib/config"
import { resolveManuscriptPaths } from "../lib/paths"

/**
 * Lexical presence of the three fixed structural LaTeX markers checked by
 * `banca_checklist`. Recognition is intentionally shallow: it only distinguishes
 * real control words outside unescaped `%` comments from look-alikes such as
 * commented commands or longer command names with the same prefix. It does not
 * expand macros, interpret verbatim/literal environments or custom catcodes,
 * follow includes, or validate the manuscript structure.
 */
interface StructuralMarkers {
  documentclass: boolean
  /** `\begin{abstract}` (with normal TeX trivia before the argument) or `\resumo`. */
  abstract: boolean
  tableofcontents: boolean
}

/** ASCII letters, the characters a TeX control word is made of. */
function isControlWordLetter(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z")
}

/** Unescaped TeX whitespace, including the line breaks TeX skips after a control word. */
function isTexWhitespace(char: string): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "\n" ||
    char === "\r" ||
    char === "\f" ||
    char === "\v"
  )
}

/**
 * Skip normal TeX trivia between a control word and its argument: whitespace
 * and unescaped `%` comments, which end at the line break. Escaped `\%` is not
 * trivia and is left for the caller, because the backslash pair is consumed
 * while scanning.
 */
function skipTrivia(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (isTexWhitespace(char)) {
      index += 1
      continue
    }
    if (char === "%") {
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }
    break
  }
  return index
}

/**
 * Scan LaTeX source for the three structural markers, single-pass and lexical.
 *
 * The scan honors the normal lexical role of a backslash: it starts either a
 * control word (a maximal run of ASCII letters) or a control symbol (exactly one
 * following character). That makes `\%` a literal percent sign instead of a
 * comment, `\\` a line break instead of a dangling command introducer, and
 * `\tableofcontentsFake` a different control word from `\tableofcontents`.
 * An unescaped `%` starts a comment up to the end of the line, so a command
 * written inside a comment is not a marker. CRLF line endings need no special
 * case: `\r` is skipped as trivia and the comment ends at `\n`.
 *
 * Deliberately unsupported: macro expansion, `\input`/`\include` following,
 * verbatim/literal environments, custom catcodes, conditionals, and any
 * syntactic validation beyond these lexical forms.
 */
function scanStructuralMarkers(text: string): StructuralMarkers {
  const markers: StructuralMarkers = {
    documentclass: false,
    abstract: false,
    tableofcontents: false,
  }

  let index = 0
  while (index < text.length) {
    const char = text[index]

    if (char === "%") {
      // Unescaped percent: the comment runs to the end of the line.
      while (index < text.length && text[index] !== "\n") index += 1
      continue
    }

    if (char !== "\\") {
      index += 1
      continue
    }

    const next = index + 1
    if (next >= text.length) break

    // Control symbol (`\%`, `\\`, `\{`, `\ `...): the backslash consumes
    // exactly one following character, never a command name.
    if (!isControlWordLetter(text[next])) {
      index = next + 1
      continue
    }

    // Control word: maximal run of ASCII letters.
    let wordEnd = next
    while (wordEnd < text.length && isControlWordLetter(text[wordEnd])) wordEnd += 1
    const name = text.slice(next, wordEnd)

    if (name === "documentclass") {
      markers.documentclass = true
    } else if (name === "tableofcontents") {
      markers.tableofcontents = true
    } else if (name === "resumo") {
      markers.abstract = true
    } else if (name === "begin" && !markers.abstract) {
      // `\begin{abstract}` is the environment alternative of the abstract
      // check. The environment name is matched exactly as `{abstract}`; normal
      // trivia (spaces/comments) may separate the command from its argument.
      const argument = skipTrivia(text, wordEnd)
      if (text.startsWith("{abstract}", argument)) markers.abstract = true
    }

    index = wordEnd
  }

  return markers
}

export const bancaChecklist = defineBancaTool({
  description: "Verify delivery checklist.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const config = loadConfig(root)
    const paths = resolveManuscriptPaths(root, config)

    const mainExists = existsSync(paths.main)
    const checks: Array<{ item: string; ok: boolean }> = [
      { item: "Main file", ok: mainExists },
      { item: "Bib file", ok: existsSync(paths.bib) },
      { item: "Chapters", ok: paths.chapters.length > 0 },
    ]

    const markers: StructuralMarkers | null = mainExists
      ? scanStructuralMarkers(readFileSync(paths.main, "utf-8"))
      : null
    if (markers) {
      checks.push({ item: "documentclass", ok: markers.documentclass })
      checks.push({ item: "abstract/resumo", ok: markers.abstract })
      checks.push({ item: "toc", ok: markers.tableofcontents })
    }

    const ok = checks.filter(c => c.ok).length
    const fail = checks.filter(c => !c.ok)
    const lines = [
      `Checklist: ${ok}/${checks.length}`,
      ...fail.map(c => `  ✗ ${c.item}`),
    ]
    if (!markers) {
      // The reduced denominator must not be presented as full coverage.
      lines.push(
        "LaTeX markers not evaluated: documentclass, abstract/resumo, toc (main file missing).",
      )
    }
    lines.push(
      "Scope: structural lexical checklist of configured manuscript files and fixed LaTeX markers in the main file only; no macro expansion, verbatim environments, includes, or full TeX interpretation.",
      "Limits: not LaTeX compilation, not an exhaustive manuscript audit, not ABNT compliance, and not approval, institutional delivery, or scientific quality.",
    )
    return lines.join("\n")
  },
})
