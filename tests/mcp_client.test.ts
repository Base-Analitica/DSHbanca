import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { join } from "node:path"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"

// inlined fake MCP server speaks JSON-RPC 2.0 over stdio
const FAKE_SERVER = `
process.stdin.setEncoding("utf-8")
let buf = ""
process.stdin.on("data", (chunk) => {
  buf += chunk
  const parts = buf.split("\\n")
  buf = parts.pop() || ""
  for (const line of parts) {
    if (!line.trim()) continue
    try {
      const msg = JSON.parse(line)
      let resp = null
      if (msg.method === "initialize") {
        resp = { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0.1.0" } } }
      } else if (msg.method === "tools/list") {
        resp = { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "get_paper_details", description: "Get paper by DOI", inputSchema: { type: "object", properties: { doi: { type: "string" } } } }] } }
      } else if (msg.method === "tools/call") {
        const doi = msg.params?.arguments?.doi || "unknown"
        resp = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify({ doi, title: "Fake Paper", authors: ["Fake Author"], year: 2023, journal: "Fake Journal" }) }] } }
      } else if (msg.method === "notifications/initialized") {
        continue
      }
      if (resp) process.stdout.write(JSON.stringify(resp) + "\\n")
    } catch {}
  }
})
`

describe("McpClient via process spawn", () => {
  const tmpDir = join(tmpdir(), "banca-mcp-test-" + Date.now())
  const scriptPath = join(tmpDir, "fake-mcp.cjs")

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true })
    writeFileSync(scriptPath, FAKE_SERVER)
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("fake MCP responds to initialize and tools/list", async () => {
    const proc = spawn("node", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] })
    const { createInterface } = await import("node:readline")
    const rl = createInterface({ input: proc.stdout! })

    const responses: any[] = []
    rl.on("line", (line) => {
      try { responses.push(JSON.parse(line)) } catch {}
    })

    // send initialize
    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) + "\n")
    await new Promise((r) => setTimeout(r, 200))

    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) + "\n")
    await new Promise((r) => setTimeout(r, 200))

    proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_paper_details", arguments: { doi: "10.1000/test" } } }) + "\n")
    await new Promise((r) => setTimeout(r, 200))

    proc.kill()
    rl.close()

    expect(responses.length).toBeGreaterThanOrEqual(2)
    const initResp = responses.find((r) => r.id === 1)
    expect(initResp).toBeDefined()
    expect(initResp.result.serverInfo.name).toBe("fake")

    const toolsResp = responses.find((r) => r.id === 2)
    expect(toolsResp).toBeDefined()
    expect(toolsResp.result.tools[0].name).toBe("get_paper_details")
  })

  test("getMcpCommand returns null by default and honors env var", async () => {
    const { getMcpCommand } = await import("../src/lib/config")
    
    // Default
    expect(getMcpCommand(tmpDir)).toBeNull()
    
    // With mcp enabled but no env var
    const { writeFileSync, mkdirSync } = await import("node:fs")
    const { join } = await import("node:path")
    mkdirSync(join(tmpDir, ".banca"), { recursive: true })
    writeFileSync(join(tmpDir, ".banca", "project.json"), JSON.stringify({
      version: 1,
      mcp: { crossrefAcademicEnabled: true }
    }))
    expect(getMcpCommand(tmpDir)).toBeNull()
    
    // With env var set to 1
    process.env.OPENBANCA_ENABLE_CROSSREF_MCP = "1"
    expect(getMcpCommand(tmpDir)).not.toBeNull()
    expect(getMcpCommand(tmpDir)).toEqual(["uvx", "--from", "crossref-academic-mcp-server", "crossref-server"])
    
    // Clean up env var
    delete process.env.OPENBANCA_ENABLE_CROSSREF_MCP
  })
})
