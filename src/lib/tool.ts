import { z } from "zod"

export type BancaToolContext = {
  directory: string
}

export type BancaToolResult = string | { output: string }

export type BancaToolDefinition<Args extends z.ZodRawShape> = {
  description: string
  args: Args
  execute(
    args: z.infer<z.ZodObject<Args>>,
    ctx: BancaToolContext,
  ): Promise<BancaToolResult>
}

export function defineBancaTool<Args extends z.ZodRawShape>(
  def: BancaToolDefinition<Args>,
): BancaToolDefinition<Args> {
  return def
}
