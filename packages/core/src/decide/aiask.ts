import type { Actor, AiJobKey, DecideContext, Door, Lang } from "@vision/contracts";
import type { HubState } from "../state.js";
import { NO_LINES, type Lines } from "./result.js";

export type MessageInfo = {
  card: string;
  message: string;
  door: Door;
  lang: Lang | null;
  zip: string | null;
  quiet?: boolean;
};
export type MessageStep = (state: HubState, ctx: DecideContext, info: MessageInfo, actor: Actor) => Lines;

export const aiOn = (ctx: DecideContext, job: AiJobKey): boolean => ctx.config.aiOn?.[job] === true;

export const askAi = (ctx: DecideContext, job: AiJobKey, card: string, actor: Actor): Lines =>
  aiOn(ctx, job)
    ? {
        events: [{ card, job: null, actor, type: "ai.asked", data: { job } }],
        effects: [{ kind: "ai", job, card }],
      }
    : NO_LINES;
