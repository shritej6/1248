import type { AiJobKey, SystemCommand } from "@vision/contracts";
import type { HubState, ModelRun } from "@vision/core";

export type AiModels = {
  VOICE_MODEL: string;
  LINK_MODEL: string;
  TRANSLATE_MODEL: string;
  DRAFT_MODEL: string;
};
export type AiEnv = AiModels & { AI: { run: ModelRun } };

export type AiTools = { run: ModelRun; model: string; sql: SqlStorage; state: HubState; now: number };

export type AiJob = {
  key: AiJobKey;
  model: (env: AiModels) => string;
  run: (card: string, tools: AiTools) => Promise<SystemCommand>;
  fallback: (card: string, outcome: "failed" | "off") => SystemCommand;
};

export class AiJobError extends Error {
  override readonly name = "AiJobError";
}
