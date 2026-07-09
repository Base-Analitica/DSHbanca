import { writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export type ReportSection = {
  title: string
  body: string
}

export function generateReport(title: string, sections: ReportSection[]): string {
  const lines = [
    `# ${title}`,
    `**Gerado em:** ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ]
  for (const section of sections) {
    lines.push(`## ${section.title}`, "", section.body, "", "---", "")
  }
  return lines.join("\n")
}

export function saveReport(projectRoot: string, filename: string, content: string): string {
  const reportDir = join(projectRoot, ".banca", "reports")
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true })
  const path = join(reportDir, filename)
  writeFileSync(path, content, "utf-8")
  return path
}
