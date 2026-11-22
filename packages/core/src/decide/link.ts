import type { Actor, DecideContext, EventDraft } from "@vision/contracts";
import { isLeadOnly, mayLink } from "../linkscore.js";
import { cardIsQuiet } from "../quiet.js";
import { linkKey, type HubState } from "../state.js";
import { askAi, type MessageInfo, type MessageStep } from "./aiask.js";
import { cardGuard } from "./plan.js";
import { NO_LINES, allow, refuse, type CommandOf, type Handlers } from "./result.js";

const quietCard = (state: HubState, ctx: DecideContext, id: string): boolean => {
  const card = state.cards[id];
  return card !== undefined && cardIsQuiet(ctx.playbook, card);
};

const leadOnlyMessage = (state: HubState, ctx: DecideContext, info: MessageInfo): boolean => {
  const card = state.cards[info.card];
  return (
    info.quiet === true || (card !== undefined && isLeadOnly(state, card)) || quietCard(state, ctx, info.card)
  );
};

export const linkStep: MessageStep = (state, ctx, info, actor) =>
  info.zip === null || leadOnlyMessage(state, ctx, info) ? NO_LINES : askAi(ctx, "link", info.card, actor);

const proposable = (state: HubState, ctx: DecideContext, card: string, other: string): boolean =>
  mayLink(state, card, other) && !quietCard(state, ctx, other);

const proposals = (
  state: HubState,
  ctx: DecideContext,
  c: CommandOf<"link.result">,
  actor: Actor,
): EventDraft[] => {
  if (c.outcome !== "ok" || state.cards[c.card] === undefined || quietCard(state, ctx, c.card)) return [];
  const seen = new Set<string>();
  return c.matches.flatMap((match) => {
    if (seen.has(match.other) || !proposable(state, ctx, c.card, match.other)) return [];
    seen.add(match.other);
    const data = { other: match.other, score: match.score };
    return [{ card: c.card, job: null, actor, type: "link.proposed" as const, data }];
  });
};

const linkResult = (state: HubState, c: CommandOf<"link.result">, actor: Actor, ctx: DecideContext) => {
  if (state.cards[c.card] === undefined) return refuse("not_found", "This request is not on the board.");
  const done: EventDraft = {
    card: c.card,
    job: null,
    actor,
    type: "ai.done",
    data: { job: "link", outcome: c.outcome },
  };
  return allow({ events: [...proposals(state, ctx, c, actor), done], effects: [] });
};

const quietPair = (state: HubState, ctx: DecideContext, one: string, two: string): boolean =>
  quietCard(state, ctx, one) || quietCard(state, ctx, two);

const linkAnswer = (state: HubState, c: CommandOf<"link.answer">, actor: Actor, ctx: DecideContext) => {
  const link = state.links[linkKey(c.card, c.other)];
  if (link === undefined || c.card === c.other)
    return refuse("not_found", "No proposed link joins these two reports.");
  if (link.answer !== null) return refuse("wrong_state", "The desk answered this link already.");
  const guard = cardGuard(state, c.card, actor) ?? cardGuard(state, c.other, actor);
  if (guard) return guard;
  if (actor.role !== "lead" && quietPair(state, ctx, c.card, c.other))
    return refuse("forbidden", "Only the lead may handle this request.");
  const data = { other: c.other, answer: c.answer };
  return allow({ events: [{ card: c.card, job: null, actor, type: "link.answered", data }], effects: [] });
};

export const linkHandlers: Handlers = {
  "link.result": linkResult,
  "link.answer": linkAnswer,
};
