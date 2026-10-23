import { z } from "zod"
import { defineBancaTool } from "../lib/tool"
import { validateConfig } from "../lib/config"
export const bancaValidate = defineBancaTool({
  description: "Validate .banca/project.json against schema.",
  args: {
    projectRoot: z.string().optional().describe("Project root (default: cwd)"),
  },
  execute: async (args, ctx) => {
    const root = args.projectRoot || ctx.directory
    const result = validateConfig(root)
    if (result.valid) return "✓ config valid"
    return `✗ config invalid:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`
  },
})
