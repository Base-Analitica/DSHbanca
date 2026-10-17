import { stringify } from "yaml"

export const e2eControlPresetId = "dshbanca-e2e-control-neutral"

/** Scratch-only registry fixture for the minimal SDK profile. */
export function buildSdkPresetOverlayPatch(observerName: string): string {
  return stringify([{
    insert: [
      {
        id: "agent-preset-registry",
        name: "@deepseek-ai/dsh-agent-preset-registry",
        config: { default: e2eControlPresetId },
      },
      {
        id: e2eControlPresetId,
        name: "@deepseek-ai/dsh-agent-preset",
        config: { id: e2eControlPresetId, name: e2eControlPresetId, plugins: [] },
      },
      { id: "dshbanca-e2e-observer", name: observerName },
    ],
  }])
}
