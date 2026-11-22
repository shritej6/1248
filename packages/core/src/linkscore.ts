import { LINK_WINDOW_DAYS } from "@vision/contracts";
import { z } from "zod";
import { isClosed } from "./holder.js";
import { linkKey, type CardState, type HubState } from "./state.js";

export const LINK_THRESHOLD = 0.75;
export const LINK_MAX_MATCHES = 20;
export const LINK_MAX_CANDIDATES = 200;
export const LINK_WINDOW_MS = LINK_WINDOW_DAYS * 86_400_000;

export const VectorSchema = z.array(z.number()).min(1);
const EmbeddingReplySchema = z.object({ data: z.array(VectorSchema) });

export type Vector = z.infer<typeof VectorSchema>;
export type LinkMatch = { other: string; score: number };

export const cosine = (a: readonly number[], b: readonly number[]): number => {
  if (a.length === 0 || a.length !== b.length) return 0;
  const sums = a.reduce(
    (acc, x, i) => {
      const y = b[i] ?? 0;
      return { dot: acc.dot + x * y, aa: acc.aa + x * x, bb: acc.bb + y * y };
    },
    { dot: 0, aa: 0, bb: 0 },
  );
  return sums.aa === 0 || sums.bb === 0 ? 0 : sums.dot / Math.sqrt(sums.aa * sums.bb);
};

export const roundScore = (score: number): number => Math.round(score * 1000) / 1000;

export const linkScore = (a: readonly number[], b: readonly number[]): number =>
  roundScore(Math.min(1, Math.max(0, cosine(a, b))));

export const embedInput = (texts: readonly string[]): { text: string[]; truncate_inputs: true } => ({
  text: [...texts],
  truncate_inputs: true,
});

export const vectorsOf = (reply: unknown, count: number): Vector[] | null => {
  const parsed = EmbeddingReplySchema.safeParse(reply);
  return parsed.success && parsed.data.data.length === count ? parsed.data.data : null;
};

export const bestMatches = (matches: readonly LinkMatch[]): LinkMatch[] =>
  matches
    .filter((match) => match.score >= LINK_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.other.localeCompare(b.other))
    .slice(0, LINK_MAX_MATCHES);

export const isOpenCard = (state: HubState, card: CardState): boolean =>
  card.jobs.length === 0 || card.jobs.some((id) => !isClosed(state.jobs[id]?.status ?? "withdrawn"));

export const isLeadOnly = (state: HubState, card: CardState): boolean =>
  card.quiet ||
  card.level === 3 ||
  card.jobs.some((id) => {
    const job = state.jobs[id];
    return job !== undefined && (job.quiet || job.level === 3);
  });

const mayJoin = (state: HubState, card: CardState): boolean =>
  card.zip !== null && isOpenCard(state, card) && !isLeadOnly(state, card);

export const mayLink = (state: HubState, one: string, two: string): boolean => {
  const a = state.cards[one];
  const b = state.cards[two];
  if (a === undefined || b === undefined || one === two) return false;
  if (!mayJoin(state, a) || !mayJoin(state, b) || a.zip !== b.zip) return false;
  return (
    Math.abs(a.receivedAt - b.receivedAt) <= LINK_WINDOW_MS && state.links[linkKey(one, two)] === undefined
  );
};

export const linkCandidates = (state: HubState, card: string): string[] =>
  Object.values(state.cards)
    .filter((other) => mayLink(state, card, other.id))
    .sort((x, y) => y.receivedAt - x.receivedAt || x.id.localeCompare(y.id))
    .slice(0, LINK_MAX_CANDIDATES)
    .map((other) => other.id);
