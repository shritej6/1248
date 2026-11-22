import type { Actor, DecideContext, LinkResult, SystemCommand } from "@vision/contracts";
import { expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { decide } from "../src/decide.js";
import { holderOf } from "../src/holder.js";
import { LINK_THRESHOLD, cosine, linkScore, vectorsOf } from "../src/linkscore.js";
import { statement } from "../src/statement.js";
import { linkKey, type HubState } from "../src/state.js";
import { deskView } from "../src/views/desk.js";
import { cardLinks, eventGroups } from "../src/views/link.js";
import type { VaultReader, ViewContext } from "../src/views/common.js";
import {
  BASE_NOW,
  at,
  config,
  confirmedSnow,
  members,
  playbook,
  raise,
  run,
  runFrom,
  sortOff,
  state,
  submit,
  types,
  type Run,
  type Step,
} from "./helpers.js";

const SYSTEM: Actor = { role: "system", ref: null };
const DESK = { role: "desk", ref: "m_d01" } as const;
const DAY = 86_400_000;
const PILE = "A couch and garbage bags were dumped in the alley behind my house";

const context = (link: boolean): DecideContext => ({
  now: BASE_NOW,
  newId: (prefix) => `${prefix}1`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config: { ...config, aiOn: { voice: false, link, lang: false } },
});

const systemStep = (command: SystemCommand, offset = 0): Step => ({ command, actor: SYSTEM, offset });

const linkResult = (card: string, matches: LinkResult["matches"], outcome: LinkResult["outcome"] = "ok") =>
  systemStep({ type: "link.result", card, outcome, matches });

let answerCount = 0;
const answer = (card: string, other: string, value: "same" | "not_same", actor: Actor = DESK): Step => {
  answerCount += 1;
  const id = `cmd_link_${String(answerCount)}`;
  return { command: { id, type: "link.answer", card, other, answer: value }, actor, offset: 0 };
};

const reported = (card: string, zip = "53216", offset = 0): Step[] => [
  at(offset, submit(card, PILE, { zip })),
  at(offset, sortOff(card)),
];

const proposedPairs = (r: Run): [string | null, string, number][] =>
  r.events.filter((e) => e.type === "link.proposed").map((e) => [e.card, e.data.other, e.data.score]);

it("cosine gives 1 for the same direction, 0 for a right angle and -1 for the opposite", () => {
  expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  expect(cosine([1, 0], [0, 1])).toBe(0);
  expect(cosine([1, 0], [-1, 0])).toBe(-1);
});

it("cosine gives 0 for an empty, a zero or a mismatched vector", () => {
  expect(cosine([], [])).toBe(0);
  expect(cosine([0, 0], [1, 1])).toBe(0);
  expect(cosine([1, 2], [1, 2, 3])).toBe(0);
});

it("the link score is the cosine kept between 0 and 1 and rounded to 3 places", () => {
  expect(linkScore([1, 0], [-1, 0])).toBe(0);
  expect(linkScore([1, 0.2], [1, 0.25])).toBe(0.999);
  expect(LINK_THRESHOLD).toBeGreaterThan(0);
  expect(LINK_THRESHOLD).toBeLessThanOrEqual(1);
});

it("vectorsOf reads the embedding reply and refuses a reply of the wrong count", () => {
  expect(
    vectorsOf(
      {
        shape: [2, 2],
        data: [
          [1, 0],
          [0, 1],
        ],
      },
      2,
    ),
  ).toEqual([
    [1, 0],
    [0, 1],
  ]);
  expect(vectorsOf({ data: [[1, 0]] }, 2)).toBeNull();
  expect(vectorsOf({ response: "no" }, 1)).toBeNull();
  expect(vectorsOf({ data: [[]] }, 1)).toBeNull();
});

const submitCommand = (zip: string | null) => ({
  type: "request.submit" as const,
  card: "c_1",
  door: "form" as const,
  zip,
  safeContact: true,
  firstName: "Tess",
  contact: "tess@example.test",
  address: null,
  message: PILE,
});

it("asks the link job for a ready message with a ZIP when the job is on", () => {
  const d = decide({ ...state(run()) }, submitCommand("53216"), SYSTEM, context(true));
  expect(d.ok ? d.events.filter((e) => e.type === "ai.asked").map((e) => e.data) : null).toEqual([
    { job: "link" },
  ]);
  expect(d.ok ? d.effects.filter((e) => e.kind === "ai") : null).toEqual([
    { kind: "ai", job: "link", card: "c_1" },
  ]);
});

it("does not ask for a message with no ZIP, or when the job is off", () => {
  const noZip = decide(state(run()), submitCommand(null), SYSTEM, context(true));
  const off = decide(state(run()), submitCommand("53216"), SYSTEM, context(false));
  for (const d of [noZip, off]) expect(d.ok ? d.effects.some((e) => e.kind === "ai") : true).toBe(false);
});

it("proposes a link with the score and no text, then writes ai.done", () => {
  const r = run(...reported("c_1"), ...reported("c_2"), linkResult("c_2", [{ other: "c_1", score: 0.93 }]));
  expect(proposedPairs(r)).toEqual([["c_2", "c_1", 0.93]]);
  expect(types(r).slice(-2)).toEqual(["link.proposed", "ai.done"]);
  expect(r.events.at(-1)?.data).toEqual({ job: "link", outcome: "ok" });
  expect(JSON.stringify(r.events)).not.toContain("alley");
  expect(r.effects.filter((e) => e.kind === "vault.text" && e.textKind !== "message_in")).toEqual([]);
});

it("drops a match that is closed, in another ZIP, older than 7 days, itself, unknown or linked already", () => {
  const r = run(
    ...confirmedSnow("c_closed"),
    {
      command: { id: "cmd_w", type: "job.withdraw", job: "j_1", reason: "cancelled" },
      actor: DESK,
      offset: 0,
    },
    ...reported("c_far", "53206"),
    ...reported("c_old", "53216", -8 * DAY),
    ...reported("c_linked"),
    ...reported("c_1"),
    linkResult("c_1", [{ other: "c_linked", score: 0.9 }]),
    linkResult("c_1", [
      { other: "c_closed", score: 0.99 },
      { other: "c_far", score: 0.99 },
      { other: "c_old", score: 0.99 },
      { other: "c_1", score: 1 },
      { other: "c_nobody", score: 0.99 },
      { other: "c_linked", score: 0.97 },
    ]),
  );
  expect(proposedPairs(r)).toEqual([["c_1", "c_linked", 0.9]]);
  expect(r.events.filter((e) => e.type === "ai.done").length).toBe(2);
});

it("keeps a match inside 7 days and proposes each pair once", () => {
  const r = run(
    ...reported("c_2", "53216", -6 * DAY),
    ...reported("c_1"),
    linkResult("c_1", [
      { other: "c_2", score: 0.91 },
      { other: "c_2", score: 0.92 },
    ]),
  );
  expect(proposedPairs(r)).toEqual([["c_1", "c_2", 0.91]]);
});

it("writes only ai.done for the outcomes failed, off and empty", () => {
  for (const outcome of ["failed", "off", "empty"] as const) {
    const r = run(
      ...reported("c_1"),
      ...reported("c_2"),
      linkResult("c_2", [{ other: "c_1", score: 0.99 }], outcome),
    );
    expect(types(r).slice(-1)).toEqual(["ai.done"]);
    expect(proposedPairs(r)).toEqual([]);
    expect(state(r).cards["c_2"]?.ai.link).toBe(outcome);
  }
});

it("refuses a result for a card that is not on the board and a result from a person", () => {
  expect(run(linkResult("c_9", [])).rejections).toEqual(["not_found"]);
  const fromDesk = {
    command: { type: "link.result", card: "c_1", outcome: "ok", matches: [] },
    actor: DESK,
    offset: 0,
  };
  expect(run(...reported("c_1"), fromDesk as Step).rejections).toEqual(["forbidden"]);
});

it("never proposes a link to a quiet card, which only the lead sees", () => {
  const r = run(
    submit("c_q", PILE, { safeContact: false }),
    sortOff("c_q"),
    ...reported("c_1"),
    linkResult("c_1", [{ other: "c_q", score: 0.99 }]),
  );
  expect(proposedPairs(r)).toEqual([]);
});

const linked = (...more: Step[]): Run =>
  run(...reported("c_1"), ...reported("c_2"), linkResult("c_2", [{ other: "c_1", score: 0.93 }]), ...more);

it("refuses an answer when no proposed link joins the two cards", () => {
  expect(run(...reported("c_1"), ...reported("c_2"), answer("c_1", "c_2", "same")).rejections).toEqual([
    "not_found",
  ]);
  expect(linked(answer("c_1", "c_9", "same")).rejections).toEqual(["not_found"]);
});

it("refuses a second answer for the same link", () => {
  expect(linked(answer("c_1", "c_2", "same"), answer("c_2", "c_1", "not_same")).rejections).toEqual([
    "wrong_state",
  ]);
});

it("refuses an answer from a volunteer and accepts one from the lead", () => {
  const volunteer: Actor = { role: "volunteer", ref: "m_v01" };
  expect(linked(answer("c_1", "c_2", "same", volunteer)).rejections).toEqual(["forbidden"]);
  expect(linked(answer("c_1", "c_2", "same", { role: "lead", ref: "m_l01" })).rejections).toEqual([]);
});

it("writes only link.answered and changes no card, job, urgency, holder or statement line", () => {
  for (const value of ["same", "not_same"] as const) {
    const before = run(
      ...confirmedSnow("c_1"),
      ...reported("c_2"),
      raise("c_2"),
      linkResult("c_2", [{ other: "c_1", score: 0.93 }]),
    );
    const after = runFrom(state(before), answer("c_1", "c_2", value));
    expect(types(after)).toEqual(["link.answered"]);
    expect(after.events[0]?.data).toEqual({ other: "c_2", answer: value });
    expect(after.effects).toEqual([]);
    expect(state(after).cards).toEqual(state(before).cards);
    expect(state(after).jobs).toEqual(state(before).jobs);
    expect(holderOf(state(after), "j_1", context(true))).toEqual(
      holderOf(state(before), "j_1", context(true)),
    );
    const lines = (events: Run["events"]) => ({ ...statement(events, "2026-11"), seal: null });
    expect(lines([...before.events, ...after.events])).toEqual(lines(before.events));
    expect(state(after).links[linkKey("c_1", "c_2")]?.answer).toBe(value);
  }
});

const emptyVault: VaultReader = { person: () => null, texts: () => [] };
const viewContext: ViewContext = {
  ...context(true),
  memberRecords: [],
  partners: [],
  links: { partner: () => null },
};

const chain = (...more: Step[]): Run =>
  run(
    ...reported("c_a"),
    ...reported("c_b", "53216", DAY / 24),
    ...reported("c_c", "53216", DAY / 12),
    ...reported("c_d", "53216", DAY / 6),
    linkResult("c_b", [{ other: "c_a", score: 0.95 }]),
    linkResult("c_c", [{ other: "c_b", score: 0.92 }]),
    linkResult("c_d", [{ other: "c_c", score: 0.91 }]),
    ...more,
  );

it("cardLinks gives each link of a card with the other ZIP, time, urgency and answer", () => {
  const r = chain(raise("c_a"), answer("c_a", "c_b", "same"));
  const received = state(r).cards["c_a"]?.receivedAt;
  expect(cardLinks(state(r), "c_b", () => true)).toEqual([
    {
      other: "c_a",
      score: 0.95,
      answer: "same",
      otherZip: "53216",
      otherReceivedAt: received,
      otherUrgency: "high",
    },
    {
      other: "c_c",
      score: 0.92,
      answer: null,
      otherZip: "53216",
      otherReceivedAt: state(r).cards["c_c"]?.receivedAt,
      otherUrgency: null,
    },
  ]);
  expect(cardLinks(state(r), "c_nobody", () => true)).toEqual([]);
});

it("eventGroups joins a chain of same answers into one group with the highest urgency", () => {
  const r = chain(raise("c_c"), answer("c_a", "c_b", "same"), answer("c_b", "c_c", "same"));
  expect(eventGroups(state(r), ["c_a", "c_b", "c_c", "c_d"])).toEqual([
    { cards: ["c_a", "c_b", "c_c"], highest: "high" },
  ]);
});

it("a not_same answer, an open question or a card not shown makes no group", () => {
  const r = chain(answer("c_a", "c_b", "not_same"), answer("c_c", "c_d", "same"));
  expect(eventGroups(state(r), ["c_a", "c_b", "c_c", "c_d"])).toEqual([
    { cards: ["c_c", "c_d"], highest: null },
  ]);
  expect(eventGroups(state(r), ["c_a", "c_b", "c_c"])).toEqual([]);
});

it("a high card in a group stays in the Emergency lane and keeps its own urgency", () => {
  const r = chain(raise("c_b"), answer("c_a", "c_b", "same"), answer("c_b", "c_c", "same"));
  const board = deskView(state(r), emptyVault, viewContext, { role: "desk", member: "m_d01" });
  expect(board.emergency.map((card) => card.card)).toEqual(["c_b"]);
  expect(board.triage.map((card) => card.card)).toEqual(["c_a", "c_c", "c_d"]);
  expect(board.eventGroups).toEqual([{ cards: ["c_a", "c_b", "c_c"], highest: "high" }]);
  expect(board.triage.map((card) => card.sorted?.urgency ?? null)).toEqual([null, null, null]);
});

it("a link never lowers, merges or closes a card", () => {
  const before = chain(raise("c_b"));
  const after = runFrom(state(before), answer("c_a", "c_b", "same"), answer("c_b", "c_c", "same"));
  const cards = (s: HubState) => Object.keys(s.cards).sort();
  expect(cards(state(after))).toEqual(cards(state(before)));
  expect(state(after).cards).toEqual(state(before).cards);
});
