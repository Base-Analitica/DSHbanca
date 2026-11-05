import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  GLOBAL_SYNTHESIS_SECTION_TITLES,
  validateAcademicSynthesisSectionOrder,
} from "../src/lib/academic_synthesis_format.js"

const titles = [...GLOBAL_SYNTHESIS_SECTION_TITLES]

function synthesisWithTitles(
  sectionTitles: readonly string[] = titles,
  lineEnding = "\n",
): string {
  return sectionTitles
    .map((title, index) => `${title}${lineEnding}Conteúdo da seção ${index + 1}.`)
    .join(lineEnding)
}

describe("academic synthesis section format", () => {
  test("matches the six numbered headings in the canonical skill", () => {
    const skill = readFileSync(
      join(import.meta.dir, "../skills/banca-avaliacao/SKILL.md"),
      "utf8",
    )
    const heading = "### Seções obrigatórias da saída global"
    const start = skill.indexOf(heading)
    expect(start).toBeGreaterThanOrEqual(0)

    const nextHeading = skill.indexOf("\n### ", start + heading.length)
    const section = skill.slice(start, nextHeading < 0 ? undefined : nextHeading)
    const skillTitles = Array.from(
      section.matchAll(/^[ \t]*\d+\.[ \t]+\*\*(.+?)\*\*[ \t]*$/gm),
      (match) => match[1],
    )

    expect(skillTitles).toEqual(titles)
    expect(skillTitles).toHaveLength(6)
  })

  test("accepts all six section titles exactly once and in order", () => {
    const result = validateAcademicSynthesisSectionOrder(synthesisWithTitles())

    expect(result.valid).toBe(true)
    expect(result.foundSections).toEqual(titles)
    expect(result.missingSections).toEqual([])
    expect(result.duplicateSections).toEqual([])
    expect(result.orderValid).toBe(true)
  })

  test("reports every omitted section", () => {
    const present = titles.filter((_, index) => index !== 1 && index !== 4)
    const result = validateAcademicSynthesisSectionOrder(synthesisWithTitles(present))

    expect(result.valid).toBe(false)
    expect(result.missingSections).toEqual([titles[1], titles[4]])
    expect(result.duplicateSections).toEqual([])
    expect(result.orderValid).toBe(false)
  })

  test("rejects a reordered set without misreporting missing or duplicate titles", () => {
    const reordered = [...titles]
    ;[reordered[1], reordered[2]] = [reordered[2], reordered[1]]
    const result = validateAcademicSynthesisSectionOrder(synthesisWithTitles(reordered))

    expect(result.valid).toBe(false)
    expect(result.missingSections).toEqual([])
    expect(result.duplicateSections).toEqual([])
    expect(result.orderValid).toBe(false)
  })

  test("reports consecutive duplicate section headings", () => {
    const duplicated = [titles[0], titles[0], ...titles.slice(1)]
    const result = validateAcademicSynthesisSectionOrder(duplicated.join("\n"))

    expect(result.valid).toBe(false)
    expect(result.missingSections).toEqual([])
    expect(result.duplicateSections).toEqual([titles[0]])
    expect(result.orderValid).toBe(false)
  })

  test("reports non-consecutive duplicate section headings", () => {
    const duplicated = [...titles, titles[3]]
    const result = validateAcademicSynthesisSectionOrder(synthesisWithTitles(duplicated))

    expect(result.valid).toBe(false)
    expect(result.missingSections).toEqual([])
    expect(result.duplicateSections).toEqual([titles[3]])
    expect(result.orderValid).toBe(false)
  })

  test("treats empty and whitespace-only text as missing every section", () => {
    for (const text of ["", " \t\r\n  "]) {
      const result = validateAcademicSynthesisSectionOrder(text)

      expect(result.valid).toBe(false)
      expect(result.foundSections).toEqual([])
      expect(result.missingSections).toEqual(titles)
      expect(result.duplicateSections).toEqual([])
      expect(result.orderValid).toBe(false)
    }
  })

  test("does not treat incidental prose mentions as section headings", () => {
    const prose = titles
      .map((title) => `A síntese menciona “${title}” como tópico, sem abrir uma seção.`)
      .join("\n")
    const result = validateAcademicSynthesisSectionOrder(prose)

    expect(result.valid).toBe(false)
    expect(result.foundSections).toEqual([])
    expect(result.missingSections).toEqual(titles)
    expect(result.duplicateSections).toEqual([])
    expect(result.orderValid).toBe(false)
  })

  test("ignores title prefixes, suffix collisions, and partial headings", () => {
    const partialHeadings = titles.map((title, index) => {
      if (index % 2 === 0) return `## ${title} — continuação`
      return `### ${title.slice(0, -1)}`
    })
    const result = validateAcademicSynthesisSectionOrder(partialHeadings.join("\n"))

    expect(result.valid).toBe(false)
    expect(result.foundSections).toEqual([])
    expect(result.missingSections).toEqual(titles)
    expect(result.duplicateSections).toEqual([])
    expect(result.orderValid).toBe(false)
  })

  test("accepts LF, CRLF, Markdown, numbering, bold, and optional trailing colons", () => {
    const markdownVariants = [
      "# Síntese global do manuscrito",
      "2. **Contradições ou tensões entre seções**",
      "### Coerência entre objetivos, método, resultados e conclusão",
      "4. Lacunas globais de argumentação ou evidência:",
      "##### __Redundâncias e inconsistências recorrentes__",
      "###### 6. **Prioridades de revisão**:",
    ]
    const lf = validateAcademicSynthesisSectionOrder(markdownVariants.join("\n"))
    const crlf = validateAcademicSynthesisSectionOrder(markdownVariants.join("\r\n"))

    for (const result of [lf, crlf]) {
      expect(result.valid).toBe(true)
      expect(result.foundSections).toEqual(titles)
      expect(result.missingSections).toEqual([])
      expect(result.duplicateSections).toEqual([])
      expect(result.orderValid).toBe(true)
    }
  })

  test("matches recognized headings case-insensitively", () => {
    const upperCaseFirstTitle = titles[0].replace("Síntese", "SÍNTESE")
    const text = synthesisWithTitles([upperCaseFirstTitle, ...titles.slice(1)])
    const result = validateAcademicSynthesisSectionOrder(text)

    expect(result.valid).toBe(true)
    expect(result.foundSections).toEqual(titles)
  })
})
