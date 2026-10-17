import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { prepareRealPathForWrite, resolveInsideRoot } from "./safe_paths"

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
  const target = prepareRealPathForWrite(
    projectRoot,
    resolveInsideRoot(projectRoot, join(".banca", "reports", filename)),
  )
  writeFileSync(target, content, "utf-8")
  return target
}
