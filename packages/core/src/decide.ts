import { commandRoles, type Actor, type DecideContext, type Decision } from "@vision/contracts";
import { adminHandlers } from "./decide/admin.js";
import { intakeHandlers } from "./decide/intake.js";
import { langHandlers } from "./decide/lang.js";
import { linkHandlers } from "./decide/link.js";
import { offerHandlers } from "./decide/offers.js";
import { planHandlers } from "./decide/plan.js";
import { resourceHandlers } from "./decide/resources.js";
import { CLOSE_KINDS, closeHandlers, fireCloseTimer } from "./decide/close.js";
import { PARTNER_KINDS, firePartnerTimer, partnerHandlers } from "./decide/partner.js";
import { timerHandlers } from "./decide/timers.js";
import { visitHandlers } from "./decide/visit.js";
import { voiceHandlers } from "./decide/voice.js";
import { refuse, type AnyCommand, type CommandOf, type Handler, type Handlers } from "./decide/result.js";
import type { HubState } from "./state.js";

const SYSTEM_TYPES: readonly string[] = [
  "request.submit",
  "sort.result",
  "timer.fired",
  "vault.erased",
  "voice.received",
  "voice.result",
  "link.result",
  "lang.result",
  "draft.ask",
  "draft.result",
  "draft.approve",
];

const baseTimer = timerHandlers["timer.fired"] as Handler<CommandOf<"timer.fired">>;

const timerFired: Handler<CommandOf<"timer.fired">> = (state, c, actor, ctx) => {
  if (CLOSE_KINDS.includes(c.deadline.kind)) return fireCloseTimer(state, c.deadline, actor, ctx);
  if (PARTNER_KINDS.includes(c.deadline.kind)) return firePartnerTimer(state, c.deadline, actor, ctx);
  return baseTimer(state, c, actor, ctx);
};

const handlers: Handlers = {
  ...intakeHandlers,
  ...partnerHandlers,
  ...planHandlers,
  ...offerHandlers,
  ...visitHandlers,
  ...closeHandlers,
  ...adminHandlers,
  ...voiceHandlers,
  ...linkHandlers,
  ...langHandlers,
  ...resourceHandlers,
  "timer.fired": timerFired,
};

const mayAct = (command: AnyCommand, actor: Actor): boolean => {
  if (SYSTEM_TYPES.includes(command.type)) return actor.role === "system";
  const roles: readonly string[] = commandRoles[command.type as keyof typeof commandRoles];
  return roles.includes(actor.role);
};

export const decide = (state: HubState, command: AnyCommand, actor: Actor, ctx: DecideContext): Decision => {
  const handle = handlers[command.type] as Handler<AnyCommand> | undefined;
  if (handle === undefined) return refuse("invalid", "This command is not known.");
  if (!mayAct(command, actor)) return refuse("forbidden", "Your role may not do this.");
  return handle(state, command, actor, ctx);
};
