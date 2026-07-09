import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const plugin: Plugin = async () => {
  const { bancaInit } = await import("./tools/banca_init")
  const { bancaStatus } = await import("./tools/banca_status")
  const { bancaContext } = await import("./tools/banca_context")
  const { bancaAuditar } = await import("./tools/banca_auditar")
  const { bancaCorrigir } = await import("./tools/banca_corrigir")
  const { bancaRefs } = await import("./tools/banca_refs")
  const { bancaIa } = await import("./tools/banca_ia")
  const { bancaPlagio } = await import("./tools/banca_plagio")
  const { bancaLoop } = await import("./tools/banca_loop")
  const { bancaSnapshot } = await import("./tools/banca_snapshot")
  const { bancaCompile } = await import("./tools/banca_compile")
  const { bancaChecklist } = await import("./tools/banca_checklist")
  const { bancaRestore } = await import("./tools/banca_restore")
  const { bancaValidate } = await import("./tools/banca_validate")
  const { bancaContract } = await import("./tools/banca_contract")

  return {
    tool: {
      banca_init: bancaInit,
      banca_status: bancaStatus,
      banca_context: bancaContext,
      banca_auditar: bancaAuditar,
      banca_corrigir: bancaCorrigir,
      banca_refs: bancaRefs,
      banca_ia: bancaIa,
      banca_plagio: bancaPlagio,
      banca_loop: bancaLoop,
      banca_snapshot: bancaSnapshot,
      banca_compile: bancaCompile,
      banca_checklist: bancaChecklist,
      banca_restore: bancaRestore,
      banca_validate: bancaValidate,
      banca_contract: bancaContract,
    },
    config: async (cfg) => {
      // auto-register crossref-academic MCP if not already present
      if (!cfg.mcp) cfg.mcp = {}
      if (!cfg.mcp["crossref-academic"]) {
        cfg.mcp["crossref-academic"] = {
          type: "local",
          command: ["uvx", "--from", "crossref-academic-mcp-server", "crossref-server"],
          enabled: true,
        }
      }
    },
  }
}

export default plugin
