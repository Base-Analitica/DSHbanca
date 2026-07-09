import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"

let seq = 0

export interface McpTool {
  name: string
  description?: string
  inputSchema?: any
}

export class McpClient {
  private proc: ChildProcess | null = null
  private rl: ReturnType<typeof createInterface> | null = null
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private closed = false

  constructor(
    private cmd: string[],
    private timeoutMs: number = 15000,
  ) {}

  async start(): Promise<void> {
    const [command, ...args] = this.cmd
    this.proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] })
    this.closed = false

    this.rl = createInterface({ input: this.proc.stdout! })
    this.rl.on("line", (line: string) => {
      let msg: any
      try { msg = JSON.parse(line) } catch { return }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!
        clearTimeout(p.timer)
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    })

    this.proc.on("error", (err) => {
      if (!this.closed) {
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err) }
        this.pending.clear()
      }
    })

    this.proc.on("exit", () => {
      if (!this.closed) {
        for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("MCP process exited")) }
        this.pending.clear()
      }
    })

    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "opencode-banca", version: "0.1.0" },
    })
    await this.send("notifications/initialized", {})
  }

  private send(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++seq
      const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP timeout after ${this.timeoutMs}ms: ${method}`))
      }, this.timeoutMs)

      this.pending.set(id, { resolve, reject, timer })
      this.proc?.stdin?.write(msg)
    })
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.send("tools/list", {})
    return result?.tools || []
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    const result = await this.send("tools/call", { name, arguments: args })
    return result
  }

  async close(): Promise<void> {
    this.closed = true
    for (const [, p] of this.pending) clearTimeout(p.timer)
    this.pending.clear()
    this.proc?.kill()
    this.proc = null
    this.rl = null
  }
}

export async function withMcp<T>(cmd: string[], fn: (mcp: McpClient) => Promise<T>, timeoutMs?: number): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const client = new McpClient(cmd, timeoutMs)
  try {
    await client.start()
    const data = await fn(client)
    return { ok: true, data }
  } catch (err: any) {
    return { ok: false, error: err.message }
  } finally {
    await client.close().catch(() => {})
  }
}
