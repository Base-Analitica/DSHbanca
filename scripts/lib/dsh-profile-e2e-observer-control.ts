/** JavaScript serialized into the scratch observer; it must not close over runner scope. */
export function renderControlPresetSelector(presetId: string): string {
  return `const e2eControlPresetId = ${JSON.stringify(presetId)};
export async function selectControlPreset(ctx, controlAgent) {
  const selected = await ctx.agentPresets.select(controlAgent, e2eControlPresetId);
  if (selected !== e2eControlPresetId || ctx.agentPresets.composedPreset(controlAgent.ctx) !== e2eControlPresetId) {
    throw new Error("DSHbanca profile E2E observer: control Agent did not retain the isolated empty control preset");
  }
  return selected;
}`
}
