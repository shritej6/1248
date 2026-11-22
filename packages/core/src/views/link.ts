import type { DeskLink, EventGroup, Urgency } from "@vision/contracts";
import { isLeadOnly } from "../linkscore.js";
import type { CardState, HubState, LinkState } from "../state.js";

export {
  LINK_MAX_CANDIDATES,
  LINK_MAX_MATCHES,
  LINK_THRESHOLD,
  LINK_WINDOW_MS,
  bestMatches,
  cosine,
  embedInput,
  linkCandidates,
  linkScore,
  mayLink,
  roundScore,
  vectorsOf,
  VectorSchema,
  type LinkMatch,
  type Vector,
} from "../linkscore.js";

const urgencyOf = (card: CardState): Urgency | null => card.urgency ?? card.sorted?.urgency ?? null;

export type Shown = (card: CardState) => boolean;

const deskLink = (state: HubState, card: string, link: LinkState, shown: Shown): DeskLink[] => {
  const other = state.cards[link.a === card ? link.b : link.a];
  if (other === undefined || isLeadOnly(state, other) || !shown(other)) return [];
  return [
    {
      other: other.id,
      score: link.score,
      answer: link.answer,
      otherZip: other.zip,
      otherReceivedAt: other.receivedAt,
      otherUrgency: urgencyOf(other),
    },
  ];
};

export const cardLinks = (state: HubState, card: string, shown: Shown): DeskLink[] =>
  Object.values(state.links)
    .filter((link) => link.a === card || link.b === card)
    .sort((x, y) => y.score - x.score || x.proposedAt - y.proposedAt)
    .flatMap((link) => deskLink(state, card, link, shown));

const rootOf = (parents: Map<string, string>, card: string): string => {
  const parent = parents.get(card) ?? card;
  return parent === card ? card : rootOf(parents, parent);
};

const sameParents = (state: HubState, shown: ReadonlySet<string>): Map<string, string> => {
  const parents = new Map<string, string>();
  for (const link of Object.values(state.links)) {
    if (link.answer !== "same" || !shown.has(link.a) || !shown.has(link.b)) continue;
    const [a, b] = [rootOf(parents, link.a), rootOf(parents, link.b)];
    if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
  }
  return parents;
};

const highestOf = (cards: readonly CardState[]): Urgency | null => {
  const levels = cards.map(urgencyOf);
  if (levels.includes("high")) return "high";
  return levels.includes("low") ? "low" : null;
};

export const eventGroups = (state: HubState, shown: readonly string[]): EventGroup[] => {
  const parents = sameParents(state, new Set(shown));
  const groups = new Map<string, CardState[]>();
  for (const id of shown) {
    const card = state.cards[id];
    if (card === undefined) continue;
    const root = rootOf(parents, id);
    groups.set(root, [...(groups.get(root) ?? []), card]);
  }
  return [...groups.values()]
    .filter((cards) => cards.length >= 2)
    .map((cards) => [...cards].sort((x, y) => x.receivedAt - y.receivedAt || x.id.localeCompare(y.id)))
    .sort((x, y) => (x[0]?.receivedAt ?? 0) - (y[0]?.receivedAt ?? 0))
    .map((cards) => ({ cards: cards.map((card) => card.id), highest: highestOf(cards) }));
};
