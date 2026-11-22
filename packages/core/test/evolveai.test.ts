import type { EventDraft } from "@vision/contracts";
import { expect, it } from "vitest";
import { fold } from "../src/evolve.js";
import { GENESIS_HASH, sealEvent } from "../src/seal.js";
import { emptyState, linkKey, type HubState } from "../src/state.js";

const SYSTEM = { role: "system", ref: null } as const;
const DESK = { role: "desk", ref: "m_d01" } as const;

const received = (card: string): EventDraft => ({
  card,
  job: null,
  actor: SYSTEM,
  type: "card.received",
  data: { door: "voice", zip: "53216", safeContact: true },
});

const foldDrafts = (drafts: EventDraft[]): HubState => {
  let prev = GENESIS_HASH;
  const lines = drafts.map((draft, i) => {
    const line = sealEvent(draft, i + 1, 1_000 + i, prev);
    prev = line.hash;
    return line;
  });
  return fold(lines, emptyState());
};

it("a new card starts with no AI status, an unknown language and no gist", () => {
  const card = foldDrafts([received("c_1")]).cards["c_1"];
  expect(card).toMatchObject({ lang: null, ai: {}, gistAt: null });
});

it("ai.asked marks the job pending and ai.done records the outcome", () => {
  const s = foldDrafts([
    received("c_1"),
    { card: "c_1", job: null, actor: SYSTEM, type: "ai.asked", data: { job: "voice" } },
    { card: "c_1", job: null, actor: SYSTEM, type: "ai.asked", data: { job: "link" } },
    { card: "c_1", job: null, actor: SYSTEM, type: "ai.done", data: { job: "voice", outcome: "failed" } },
  ]);
  expect(s.cards["c_1"]?.ai).toEqual({ voice: "failed", link: "pending" });
});

it("card.lang_set and card.gist_typed change only their own fields", () => {
  const s = foldDrafts([
    received("c_1"),
    { card: "c_1", job: null, actor: SYSTEM, type: "card.lang_set", data: { lang: "es" } },
    { card: "c_1", job: null, actor: DESK, type: "card.gist_typed", data: {} },
  ]);
  expect(s.cards["c_1"]).toMatchObject({ lang: "es", gistAt: 1_002, urgency: null, confirmedAt: null });
});

it("a proposed link is stored once under the sorted pair and keeps the first score", () => {
  const s = foldDrafts([
    received("c_2"),
    received("c_1"),
    { card: "c_2", job: null, actor: SYSTEM, type: "link.proposed", data: { other: "c_1", score: 0.91 } },
    { card: "c_1", job: null, actor: SYSTEM, type: "link.proposed", data: { other: "c_2", score: 0.95 } },
  ]);
  expect(Object.keys(s.links)).toEqual([linkKey("c_2", "c_1")]);
  expect(s.links["c_1|c_2"]).toEqual({
    a: "c_1",
    b: "c_2",
    score: 0.91,
    proposedAt: 1_002,
    answer: null,
    answeredAt: null,
  });
});

it("a link to a card that is not on the board, or to itself, is ignored", () => {
  const s = foldDrafts([
    received("c_1"),
    { card: "c_1", job: null, actor: SYSTEM, type: "link.proposed", data: { other: "c_9", score: 0.9 } },
    { card: "c_1", job: null, actor: SYSTEM, type: "link.proposed", data: { other: "c_1", score: 1 } },
  ]);
  expect(s.links).toEqual({});
});

it("the desk answer is kept on the link and changes nothing on either card", () => {
  const before = foldDrafts([
    received("c_1"),
    received("c_2"),
    { card: "c_1", job: null, actor: SYSTEM, type: "link.proposed", data: { other: "c_2", score: 0.9 } },
  ]);
  const s = foldDrafts([
    received("c_1"),
    received("c_2"),
    { card: "c_1", job: null, actor: SYSTEM, type: "link.proposed", data: { other: "c_2", score: 0.9 } },
    { card: "c_2", job: null, actor: DESK, type: "link.answered", data: { other: "c_1", answer: "same" } },
  ]);
  expect(s.links["c_1|c_2"]).toMatchObject({ answer: "same", answeredAt: 1_003 });
  expect(s.cards).toEqual(before.cards);
});
