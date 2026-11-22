import type { Actor, AiOutcome } from "@vision/contracts";
import { detectLanguage } from "../language.js";
import type { HubState } from "../state.js";
import { askAi, type MessageInfo, type MessageStep } from "./aiask.js";
import { NO_LINES, allow, join, refuse, type CommandOf, type Handlers, type Lines } from "./result.js";

const knownLang = (state: HubState, info: MessageInfo) => info.lang ?? state.cards[info.card]?.lang ?? null;

const langSet = (card: string, actor: Actor): Lines => ({
  events: [{ card, job: null, actor, type: "card.lang_set", data: { lang: "es" } }],
  effects: [],
});

export const langStep: MessageStep = (state, ctx, info, actor) => {
  const known = knownLang(state, info);
  const lang = known ?? detectLanguage(info.message);
  if (lang === "en") return NO_LINES;
  return join(known === null ? langSet(info.card, actor) : NO_LINES, askAi(ctx, "lang", info.card, actor));
};

const translationOf = (c: CommandOf<"lang.result">): string | null =>
  c.outcome === "ok" && c.text !== null && c.text.trim() !== "" ? c.text.trim() : null;

const langResult = (state: HubState, c: CommandOf<"lang.result">, actor: Actor) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This request is not on the board.");
  if (card.ai.lang !== "pending") return refuse("wrong_state", "This request waits for no translation.");
  const text = translationOf(c);
  const outcome: AiOutcome = c.outcome === "ok" && text === null ? "empty" : c.outcome;
  const done: Lines = {
    events: [{ card: c.card, job: null, actor, type: "ai.done", data: { job: "lang", outcome } }],
    effects:
      text === null ? [] : [{ kind: "vault.text", card: c.card, job: null, textKind: "translation", text }],
  };
  return allow(done);
};

export const langHandlers: Handlers = { "lang.result": langResult };
