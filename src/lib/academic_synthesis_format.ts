export const GLOBAL_SYNTHESIS_SECTION_TITLES = Object.freeze([
  "Síntese global do manuscrito",
  "Contradições ou tensões entre seções",
  "Coerência entre objetivos, método, resultados e conclusão",
  "Lacunas globais de argumentação ou evidência",
  "Redundâncias e inconsistências recorrentes",
  "Prioridades de revisão",
] as const)

export type GlobalSynthesisSectionTitle =
  (typeof GLOBAL_SYNTHESIS_SECTION_TITLES)[number]

export interface AcademicSynthesisSectionOrderResult {
  valid: boolean
  foundSections: GlobalSynthesisSectionTitle[]
  missingSections: GlobalSynthesisSectionTitle[]
  duplicateSections: GlobalSynthesisSectionTitle[]
  orderValid: boolean
}

function sectionTitleOnLine(line: string): GlobalSynthesisSectionTitle | undefined {
  let candidate = line.replace(/\r$/, "").replace(/^[ \t]+|[ \t]+$/g, "")

  // Recognize the established heading forms, but only when the whole line is a title.
  candidate = candidate.replace(/^#{1,6}[ \t]*/, "")
  candidate = candidate.replace(/^\d+\.[ \t]*/, "")
  candidate = candidate.replace(/[ \t]*:[ \t]*$/, "")

  for (const marker of ["**", "__"] as const) {
    if (candidate.startsWith(marker) && candidate.endsWith(marker)) {
      candidate = candidate.slice(marker.length, -marker.length)
      break
    }
  }

  candidate = candidate.replace(/[ \t]+$/, "")
  const normalized = candidate.toLowerCase()
  return GLOBAL_SYNTHESIS_SECTION_TITLES.find(
    (title) => title.toLowerCase() === normalized,
  )
}

/**
 * Checks only the presence, uniqueness, and order of the six required heading lines.
 * It does not evaluate the truth, coherence, or quality of the section contents.
 */
export function validateAcademicSynthesisSectionOrder(
  text: string,
): AcademicSynthesisSectionOrderResult {
  const counts = new Map<GlobalSynthesisSectionTitle, number>(
    GLOBAL_SYNTHESIS_SECTION_TITLES.map((title) => [title, 0]),
  )
  const foundSections: GlobalSynthesisSectionTitle[] = []

  for (const line of text.split("\n")) {
    const title = sectionTitleOnLine(line)
    if (title === undefined) continue
    foundSections.push(title)
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }

  const missingSections = GLOBAL_SYNTHESIS_SECTION_TITLES.filter(
    (title) => counts.get(title) === 0,
  )
  const duplicateSections = GLOBAL_SYNTHESIS_SECTION_TITLES.filter(
    (title) => (counts.get(title) ?? 0) > 1,
  )
  const orderValid =
    foundSections.length === GLOBAL_SYNTHESIS_SECTION_TITLES.length &&
    GLOBAL_SYNTHESIS_SECTION_TITLES.every(
      (title, index) => foundSections[index] === title,
    )

  return {
    valid: missingSections.length === 0 && duplicateSections.length === 0 && orderValid,
    foundSections,
    missingSections,
    duplicateSections,
    orderValid,
  }
}
