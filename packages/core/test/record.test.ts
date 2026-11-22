import type { EventDraft, LedgerEvent } from "@vision/contracts";
import { describe, expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { GENESIS_HASH, fold, sealEvent, statement } from "../src/index.js";
import { homeView } from "../src/views/volunteer.js";
import type { ViewContext } from "../src/views/common.js";
import { config, members, playbook } from "./helpers.js";

type Body = Pick<EventDraft, "type" | "data">;
type Step = [at: number, job: string | null, body: Body, ref?: string];

const HOUR = 3_600_000;
const nov = (day: number, hour = 12): number => Date.UTC(2026, 10, day, hour);

const sealAll = (steps: readonly Step[]): LedgerEvent[] => {
  const out: LedgerEvent[] = [];
  let prev = GENESIS_HASH;
  steps.forEach(([at, job, body, ref], i) => {
    const actor = ref === undefined ? { role: "system", ref: null } : { role: "volunteer", ref };
    const draft = { card: "c_r", job, actor, ...body } as EventDraft;
    const e = sealEvent(draft, i + 1, at, prev);
    out.push(e);
    prev = e.hash;
  });
  return out;
};

const ctx: ViewContext = {
  now: nov(20),
  newId: (prefix) => `${prefix}view`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config,
  memberRecords: [],
  partners: [],
  links: { partner: () => null },
};

const start = (): Step[] => [
  [nov(10, 9), null, { type: "card.received", data: { door: "form", zip: "53216", safeContact: true } }],
  [
    nov(10, 10),
    "j_r",
    {
      type: "job.planned",
      data: { need: "snow", path: "volunteers", rung: 0, level: 2, quiet: false, promiseAt: nov(12) },
    },
  ],
];

const visit = (member: string, from: number, hours: number): Step[] => [
  [from - HOUR, "j_r", { type: "offer.accepted", data: { member } }, member],
  [from - HOUR / 2, "j_r", { type: "job.on_my_way", data: { member } }, member],
  [from, "j_r", { type: "job.there", data: { member } }, member],
  [from + hours * HOUR, "j_r", { type: "job.done", data: { member, outcome: "done" } }, member],
];

const reopen: Step = [
  nov(11, 18),
  "j_r",
  { type: "job.reopened", data: { as: "mismatch", exclude: "m_v01" } },
];

const resent = (): LedgerEvent[] =>
  sealAll([...start(), ...visit("m_v01", nov(11, 10), 1), reopen, ...visit("m_v02", nov(13, 10), 2)]);

const recordFor = (events: readonly LedgerEvent[], member: string) =>
  homeView(fold(events), ctx, member).record;

describe("the volunteer record after a re-send", () => {
  it("each volunteer keeps the job and the hours of their own taps", () => {
    const events = resent();
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
    expect(recordFor(events, "m_v02")).toEqual({ jobsDone: 1, hours: 2.5 });
  });

  it("the statement hours are the sum of the hours of every member", () => {
    const events = resent();
    const sum = recordFor(events, "m_v01").hours + recordFor(events, "m_v02").hours;
    expect(statement(events, "2026-11").hours).toBe(sum);
  });

  it("a volunteer who only accepted the job has no job and no hours", () => {
    const events = sealAll([
      ...start(),
      [nov(11, 9), "j_r", { type: "offer.accepted", data: { member: "m_v03" } }, "m_v03"],
    ]);
    expect(recordFor(events, "m_v03")).toEqual({ jobsDone: 0, hours: 0 });
  });

  it("a hand off ends the span of the volunteer who handed off", () => {
    const events = sealAll([
      ...start(),
      ...visit("m_v01", nov(11, 10), 1).slice(0, 3),
      [nov(11, 11), "j_r", { type: "job.returned", data: { reason: "hand_off" } }, "m_v01"],
      ...visit("m_v02", nov(11, 14), 2),
    ]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
    expect(recordFor(events, "m_v02")).toEqual({ jobsDone: 1, hours: 2.5 });
    expect(statement(events, "2026-11").hours).toBe(4);
  });
});

const accepted = (member: string, at: number): Step => [
  at,
  "j_r",
  { type: "offer.accepted", data: { member } },
  member,
];
const onMyWay = (member: string, at: number): Step => [
  at,
  "j_r",
  { type: "job.on_my_way", data: { member } },
  member,
];
const there = (member: string, at: number): Step => [
  at,
  "j_r",
  { type: "job.there", data: { member } },
  member,
];
const doneAs = (member: string, at: number, outcome: "done" | "not_done"): Step => [
  at,
  "j_r",
  { type: "job.done", data: { member, outcome } },
  member,
];
const MIN = 60_000;
const t0 = nov(11, 10);

describe("the volunteer record hours run from on my way to done", () => {
  it("hours start at the on my way tap", () => {
    const events = sealAll([
      ...start(),
      accepted("m_v01", t0 - HOUR),
      onMyWay("m_v01", t0),
      there("m_v01", t0 + 30 * MIN),
      doneAs("m_v01", t0 + 90 * MIN, "done"),
    ]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
    expect(statement(events, "2026-11").hours).toBe(1.5);
  });

  it("hours start at the there tap when there is no on my way tap", () => {
    const events = sealAll([
      ...start(),
      accepted("m_v01", t0 - HOUR),
      there("m_v01", t0),
      doneAs("m_v01", t0 + 90 * MIN, "done"),
    ]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
  });

  it("an on my way tap alone counts the job and a send-back ends the span", () => {
    const events = sealAll([
      ...start(),
      accepted("m_v01", t0 - HOUR),
      onMyWay("m_v01", t0),
      [t0 + 90 * MIN, "j_r", { type: "job.rung_moved", data: { from: 0, to: 1, reason: "desk" } }],
    ]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
    expect(statement(events, "2026-11").hours).toBe(1.5);
  });
});

describe("the volunteer record after a not done tap", () => {
  it("a not done tap alone adds no job", () => {
    const events = sealAll([...start(), accepted("m_v01", t0 - HOUR), doneAs("m_v01", t0, "not_done")]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 0, hours: 0 });
  });

  it("a not done tap after on my way keeps the job and the hours", () => {
    const events = sealAll([
      ...start(),
      accepted("m_v01", t0 - HOUR),
      onMyWay("m_v01", t0),
      doneAs("m_v01", t0 + 90 * MIN, "not_done"),
    ]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
  });
});

describe("the volunteer record on a crew job", () => {
  it("a crew helper gets the job and the span of the holder when the holder taps done", () => {
    const events = sealAll([
      ...start(),
      accepted("m_v01", t0 - HOUR),
      accepted("m_v02", t0 - HOUR / 2),
      onMyWay("m_v01", t0),
      there("m_v01", t0 + 30 * MIN),
      doneAs("m_v01", t0 + 90 * MIN, "done"),
    ]);
    expect(recordFor(events, "m_v01")).toEqual({ jobsDone: 1, hours: 1.5 });
    expect(recordFor(events, "m_v02")).toEqual({ jobsDone: 1, hours: 1.5 });
    expect(statement(events, "2026-11").hours).toBe(3);
  });

  it("a crew helper gets nothing before the holder taps done", () => {
    const events = sealAll([
      ...start(),
      accepted("m_v01", t0 - HOUR),
      accepted("m_v02", t0 - HOUR / 2),
      onMyWay("m_v01", t0),
    ]);
    expect(recordFor(events, "m_v02")).toEqual({ jobsDone: 0, hours: 0 });
  });
});
