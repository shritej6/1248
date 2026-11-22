import type { Actor, AiOutcome, DecideContext } from "@vision/contracts";
import { isClosed } from "../holder.js";
import type { CardState, HubState } from "../state.js";
import { askAi } from "./aiask.js";
import { messageReady } from "./intake.js";
import { cardGuard } from "./plan.js";
import { allow, join, refuse, type CommandOf, type Handlers, type Lines } from "./result.js";

const CALLER = "Caller";

const done = (card: string, outcome: AiOutcome, actor: Actor): Lines => ({
  events: [{ card, job: null, actor, type: "ai.done", data: { job: "voice", outcome } }],
  effects: [],
});

const finished = (state: HubState, card: CardState): boolean => {
  const jobs = card.jobs.flatMap((id) => state.jobs[id] ?? []);
  return jobs.length > 0 && jobs.every((job) => isClosed(job.status));
};

const messageLines = (state: HubState, ctx: DecideContext, card: CardState, text: string, actor: Actor) =>
  join(
    { events: [], effects: [{ kind: "vault.text", card: card.id, job: null, textKind: "message_in", text }] },
    messageReady(
      state,
      ctx,
      { card: card.id, message: text, door: "voice", lang: card.lang, zip: card.zip },
      actor,
    ),
  );

const received = (state: HubState, c: CommandOf<"voice.received">, actor: Actor, ctx: DecideContext) => {
  if (state.cards[c.card]) return refuse("wrong_state", "This voicemail is already on the board.");
  const lines: Lines = {
    events: [
      {
        card: c.card,
        job: null,
        actor,
        type: "card.received",
        data: { door: "voice", zip: c.zip, safeContact: true },
      },
    ],
    effects: [
      { kind: "vault.person", card: c.card, firstName: CALLER, contact: c.callback ?? "", address: null },
    ],
  };
  return allow(join(lines, askAi(ctx, "voice", c.card, actor)));
};

const result = (state: HubState, c: CommandOf<"voice.result">, actor: Actor, ctx: DecideContext) => {
  const card = state.cards[c.card];
  if (card?.door !== "voice") return refuse("not_found", "This voicemail is not on the board.");
  if (card.ai.voice !== "pending")
    return refuse("wrong_state", "This voicemail is not waiting for a transcript.");
  const text = c.text?.trim() ?? "";
  if (c.outcome !== "ok") return allow(done(card.id, c.outcome, actor));
  if (text.length === 0) return allow(done(card.id, "empty", actor));
  if (finished(state, card)) return allow(done(card.id, "ok", actor));
  return allow(join(done(card.id, "ok", actor), messageLines(state, ctx, card, text, actor)));
};

const gistBlocked = (state: HubState, card: CardState): string | null => {
  if (card.door !== "voice") return "Only a voicemail takes a typed gist.";
  if (finished(state, card)) return "This request is closed.";
  if (card.ai.voice === "ok") return "This voicemail has a transcript.";
  if (card.ai.voice === "pending") return "The transcript of this voicemail is on the way.";
  return card.gistAt === null ? null : "This voicemail has a gist.";
};

const gist = (state: HubState, c: CommandOf<"voice.gist">, actor: Actor, ctx: DecideContext) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This request is not on the board.");
  const blocked = gistBlocked(state, card);
  if (blocked !== null) return refuse("wrong_state", blocked);
  const guard = cardGuard(state, card.id, actor);
  if (guard) return guard;
  const typed: Lines = {
    events: [{ card: card.id, job: null, actor, type: "card.gist_typed", data: {} }],
    effects: [],
  };
  return allow(join(typed, messageLines(state, ctx, card, c.text, actor)));
};

export const voiceHandlers: Handlers = {
  "voice.received": received,
  "voice.result": result,
  "voice.gist": gist,
};
