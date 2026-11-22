import type {
  Actor,
  CoreCommand,
  DecideContext,
  Decision,
  Effect,
  EventDraft,
  RejectionCode,
  SystemCommand,
} from "@vision/contracts";
import type { HubState } from "../state.js";

export type AnyCommand = CoreCommand | SystemCommand;
export type CommandOf<K extends AnyCommand["type"]> = Extract<AnyCommand, { type: K }>;
export type Handler<C extends AnyCommand> = (
  state: HubState,
  command: C,
  actor: Actor,
  ctx: DecideContext,
) => Decision;
export type Handlers = { [K in AnyCommand["type"]]?: Handler<CommandOf<K>> };
export type Lines = { events: EventDraft[]; effects: Effect[] };

export const NO_LINES: Lines = { events: [], effects: [] };

export const join = (...parts: Lines[]): Lines => ({
  events: parts.flatMap((p) => p.events),
  effects: parts.flatMap((p) => p.effects),
});

export const allow = (lines: Lines): Decision => ({ ok: true, events: lines.events, effects: lines.effects });

export const refuse = (code: RejectionCode, message: string): Decision => ({
  ok: false,
  rejection: { code, message },
});
