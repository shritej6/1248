import type { EventType, LedgerEvent } from "@vision/contracts";
import { linkKey, type CardState, type HubState, type LinkState } from "./state.js";

type EventOf<K extends EventType> = Extract<LedgerEvent, { type: K }>;

const updateCard = (state: HubState, id: string | null, change: (card: CardState) => CardState): HubState => {
  const card = id === null ? undefined : state.cards[id];
  return card ? { ...state, cards: { ...state.cards, [card.id]: change(card) } } : state;
};

const setLink = (state: HubState, link: LinkState): HubState => ({
  ...state,
  links: { ...state.links, [linkKey(link.a, link.b)]: link },
});

const proposed = (state: HubState, e: EventOf<"link.proposed">): HubState => {
  const { other, score } = e.data;
  if (e.card === null || e.card === other || !state.cards[e.card] || !state.cards[other]) return state;
  if (state.links[linkKey(e.card, other)]) return state;
  const [a, b] = e.card < other ? [e.card, other] : [other, e.card];
  return setLink(state, { a, b, score, proposedAt: e.at, answer: null, answeredAt: null });
};

const answered = (state: HubState, e: EventOf<"link.answered">): HubState => {
  const link = e.card === null ? undefined : state.links[linkKey(e.card, e.data.other)];
  return link ? setLink(state, { ...link, answer: e.data.answer, answeredAt: e.at }) : state;
};

export const aiHandlers = {
  "card.lang_set": (s: HubState, e: EventOf<"card.lang_set">) =>
    updateCard(s, e.card, (card) => ({ ...card, lang: e.data.lang })),
  "card.gist_typed": (s: HubState, e: EventOf<"card.gist_typed">) =>
    updateCard(s, e.card, (card) => ({ ...card, gistAt: e.at })),
  "ai.asked": (s: HubState, e: EventOf<"ai.asked">) =>
    updateCard(s, e.card, (card) => ({ ...card, ai: { ...card.ai, [e.data.job]: "pending" } })),
  "ai.done": (s: HubState, e: EventOf<"ai.done">) =>
    updateCard(s, e.card, (card) => ({ ...card, ai: { ...card.ai, [e.data.job]: e.data.outcome } })),
  "link.proposed": proposed,
  "link.answered": answered,
};
