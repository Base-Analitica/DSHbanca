import type { RefMetadata } from "./academic"

export interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
}

export function parseBibtex(content: string): BibEntry[] {
  const entries: BibEntry[] = []
  const entryRe = /@(\w+)\{([^,]+),([^@]+)\}/gs
  let match: RegExpExecArray | null

  while ((match = entryRe.exec(content)) !== null) {
    const type = match[1].toLowerCase()
    const key = match[2].trim()
    const rawFields = match[3]

    const fields: Record<string, string> = {}
    const fieldRe = /(\w+)\s*=\s*\{([^}]*)\}/g
    let fm: RegExpExecArray | null
    while ((fm = fieldRe.exec(rawFields)) !== null) {
      fields[fm[1].toLowerCase()] = fm[2].trim()
    }

    entries.push({ type, key, fields })
  }

  return entries
}

export function bibEntryToRef(entry: BibEntry): RefMetadata {
  const f = entry.fields

  // extract year from date field if present
  let year: number | undefined
  const dateStr = f.date || ""
  const yearMatch = dateStr.match(/\b(\d{4})\b/) || f.year?.match(/\b(\d{4})\b/)
  if (yearMatch) year = parseInt(yearMatch[1])

  // extract authors
  const authorStr = f.author || f.authors || ""
  const authors = authorStr.split(/\s+and\s+/).map((a) => a.trim()).filter(Boolean)

  // normalize DOI
  let doi = f.doi || ""
  if (doi.startsWith("https://doi.org/")) doi = doi.replace("https://doi.org/", "")
  if (doi.startsWith("http://doi.org/")) doi = doi.replace("http://doi.org/", "")

  return {
    key: entry.key,
    title: f.title || f.titulo || "",
    authors: authors.length > 0 ? authors : undefined,
    year,
    doi: doi || undefined,
    journal: f.journal || f.journaltitle || f.booktitle || "",
    volume: f.volume || "",
    pages: f.pages || "",
  }
}
