import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { StatementSchema, type EventDraft, type LedgerEvent } from "@vision/contracts";
import { GENESIS_HASH, monthBounds, sealEvent, statement } from "../src/index.js";
import { arbHistory } from "./arbitraries.js";

type Body = Pick<EventDraft, "type" | "data">;
type Step = [at: number, card: string | null, job: string | null, body: Body];

const SYSTEM = { role: "system", ref: null } as const;
const HOUR = 3_600_000;
const nov = (day: number, hour = 12): number => Date.UTC(2026, 10, day, hour);
const oct = (day: number, hour = 12): number => Date.UTC(2026, 9, day, hour);

const sealAll = (steps: readonly Step[]): LedgerEvent[] => {
  const out: LedgerEvent[] = [];
  let prev = GENESIS_HASH;
  steps.forEach(([at, card, job, body], i) => {
    const e = sealEvent({ card, job, actor: SYSTEM, ...body } as EventDraft, i + 1, at, prev);
    out.push(e);
    prev = e.hash;
  });
  return out;
};

const received = (at: number, card: string, zip: string): Step => [
  at,
  card,
  null,
  { type: "card.received", data: { door: "form", zip, safeContact: true } },
];

const planned = (at: number, card: string, job: string, need: string, promiseAt: number): Step => [
  at,
  card,
  job,
  { type: "job.planned", data: { need, path: "volunteers", rung: 0, level: 2, quiet: false, promiseAt } },
];

const visit = (card: string, job: string, from: number, to: number): Step[] => [
  [from - HOUR, card, job, { type: "offer.accepted", data: { member: "m_v01" } }],
  [from - HOUR / 2, card, job, { type: "job.on_my_way", data: { member: "m_v01" } }],
  [from, card, job, { type: "job.there", data: { member: "m_v01" } }],
  [to, card, job, { type: "job.done", data: { member: "m_v01", outcome: "done" } }],
];

const answer = (at: number, card: string, job: string, value: 1 | 3): Step => [
  at,
  card,
  job,
  { type: "checkback.answered", data: { answer: value } },
];

const closed = (at: number, card: string, job: string, result: "helped" | "withdrawn"): Step => [
  at,
  card,
  job,
  { type: "job.closed", data: { result, reason: result === "withdrawn" ? "cancelled" : null } },
];

const octoberSteps = (): Step[] => [
  received(oct(5), "c_old", "53206"),
  planned(oct(5, 13), "c_old", "j_old", "snow", oct(7)),
  closed(oct(6), "c_old", "j_old", "withdrawn"),
];

const novemberSteps = (): Step[] => [
  received(nov(2, 9), "c_a", "53216"),
  [nov(2, 10), "c_a", null, { type: "card.confirmed", data: confirmedData(true) }],
  planned(nov(2, 11), "c_a", "j_a", "snow", nov(4)),
  ...visit("c_a", "j_a", nov(3, 10), nov(3, 12)),
  answer(nov(4, 9), "c_a", "j_a", 1),
  closed(nov(4, 10), "c_a", "j_a", "helped"),
  received(nov(5, 9), "c_b", "53206"),
  [nov(5, 9), "c_b", null, { type: "page.moved", data: { page: "pg_1", to: "m_d2", step: 1 } }],
  planned(nov(5, 10), "c_b", "j_b", "food", nov(7)),
  [nov(5, 11), "c_b", "j_b", { type: "job.unmet", data: {} }],
  received(nov(10, 9), "c_c", "53216"),
  planned(nov(10, 10), "c_c", "j_c", "snow", nov(12)),
  ...visit("c_c", "j_c", nov(11, 10), nov(11, 11)),
  answer(nov(12, 9), "c_c", "j_c", 3),
  [nov(12, 9), "c_c", "j_c", { type: "job.reopened", data: { as: "mismatch", exclude: "m_v01" } }],
  [nov(20), null, null, { type: "vault.erased", data: { due: nov(20), erased: 4 } }],
];

function confirmedData(changed: boolean): EventDraft["data"] {
  return {
    need: "snow",
    urgency: "low",
    division: null,
    level: 2,
    quiet: false,
    routeCode: "SNOW-16-001",
    changed,
  };
}

const demoMonthEvents = (): LedgerEvent[] =>
  sealAll([
    ...octoberSteps(),
    ...novemberSteps(),
    received(Date.UTC(2026, 11, 2), "c_dec", "53216"),
    planned(Date.UTC(2026, 11, 2, 1), "c_dec", "j_dec", "snow", Date.UTC(2026, 11, 4)),
  ]);

const spread = (events: readonly LedgerEvent[], stepMs: number): LedgerEvent[] =>
  events.map((e, i) => ({ ...e, at: oct(20) + i * stepMs }));

describe("month bounds in Milwaukee time", () => {
  it("November 2026 starts at 05:00 UTC and ends at 06:00 UTC because of the time change", () => {
    expect(monthBounds("2026-11", "America/Chicago")).toEqual({
      start: Date.UTC(2026, 10, 1, 5),
      end: Date.UTC(2026, 11, 1, 6),
    });
  });

  it("December runs to the first of January of the next year", () => {
    expect(monthBounds("2026-12", "America/Chicago")).toEqual({
      start: Date.UTC(2026, 11, 1, 6),
      end: Date.UTC(2027, 0, 1, 6),
    });
  });

  it("March 2027 ends one hour earlier in UTC because summer time starts", () => {
    expect(monthBounds("2027-03", "America/Chicago").end).toBe(Date.UTC(2027, 3, 1, 5));
  });

  it("a month that is not YYYY-MM is refused", () => {
    expect(() => monthBounds("2026-13", "America/Chicago")).toThrow(RangeError);
    expect(() => monthBounds("Nov 2026", "America/Chicago")).toThrow(RangeError);
  });
});

describe("statement balance", () => {
  it("the statement always balances", () => {
    fc.assert(
      fc.property(arbHistory(), (events) => {
        const s = statement(events, "2026-11");
        expect(s.openAtStart + s.new).toBe(s.helped + s.unreached + s.withdrawn + s.unmet + s.stillOpen);
        expect(s.balanced).toBe(true);
      }),
    );
  });

  it("the statement balances when the history crosses the month edges", () => {
    fc.assert(
      fc.property(arbHistory(), fc.integer({ min: HOUR, max: 72 * HOUR }), (history, stepMs) => {
        const s = statement(spread(history, stepMs), "2026-11");
        expect(s.openAtStart + s.new).toBe(s.helped + s.unreached + s.withdrawn + s.unmet + s.stillOpen);
        expect(s.promise.kept).toBeLessThanOrEqual(s.promise.due);
        expect(StatementSchema.safeParse(s).success).toBe(true);
      }),
    );
  });
});

describe("statement for a known month", () => {
  it("a known month gives known figures", () => {
    const s = statement(demoMonthEvents(), "2026-11");
    expect(s).toMatchObject({ new: 3, helped: 1, unmet: 1, stillOpen: 1, wrong: { mismatches: 1 } });
  });

  it("a known month gives the other figures from the ledger alone", () => {
    const events = demoMonthEvents();
    const s = statement(events, "2026-11");
    const lastInMonth = events.filter((e) => e.at < Date.UTC(2026, 11, 1, 6)).at(-1);
    expect(s).toMatchObject({
      openAtStart: 0,
      unreached: 0,
      withdrawn: 0,
      balanced: true,
      wrong: { mismatches: 1, latePromises: 2, deskChanges: 1, pagesMoved: 1, noVolunteer: 0 },
      promise: { kept: 1, due: 3 },
      unmetTable: [{ need: "food", zip: "53206", count: 1 }],
      hours: 4,
      erased: { erased: 4, due: 4 },
      seal: { seq: lastInMonth?.seq, hash: lastInMonth?.hash },
    });
    expect(StatementSchema.parse(s)).toEqual(s);
  });
});

describe("statement edges", () => {
  it("a job open at the start and closed in the month counts once on each side", () => {
    const events = sealAll([
      received(oct(28), "c_x", "53216"),
      planned(oct(28, 13), "c_x", "j_x", "snow", nov(3)),
      ...visit("c_x", "j_x", nov(2, 10), nov(2, 12)),
      closed(nov(4), "c_x", "j_x", "helped"),
    ]);
    expect(statement(events, "2026-11")).toMatchObject({ openAtStart: 1, new: 0, helped: 1, stillOpen: 0 });
    expect(statement(events, "2026-10")).toMatchObject({ openAtStart: 0, new: 1, helped: 0, stillOpen: 1 });
  });

  it("an empty ledger gives zero figures and the first fingerprint", () => {
    const s = statement([], "2026-11");
    expect(s).toMatchObject({ openAtStart: 0, new: 0, hours: 0, balanced: true });
    expect(s.seal).toEqual({ seq: 0, hash: GENESIS_HASH });
  });

  it("each figure has a method sentence", () => {
    expect(Object.keys(statement([], "2026-11").method)).toEqual(
      expect.arrayContaining([
        "openAtStart",
        "new",
        "helped",
        "unreached",
        "withdrawn",
        "unmet",
        "stillOpen",
        "promise",
        "hours",
        "erased",
      ]),
    );
  });
});

describe("statement promises in a month still running", () => {
  it("a promise later than the last ledger line is not yet due and is not late", () => {
    const events = sealAll([
      received(nov(20, 9), "c_f", "53216"),
      planned(nov(20, 10), "c_f", "j_f", "snow", nov(28)),
      received(nov(21, 9), "c_g", "53206"),
    ]);
    expect(statement(events, "2026-11")).toMatchObject({
      promise: { kept: 0, due: 0 },
      wrong: { latePromises: 0 },
    });
  });

  it("a promise kept early counts before its time comes, and a missed one counts once the ledger passes it", () => {
    const early = sealAll([
      received(nov(20, 9), "c_f", "53216"),
      planned(nov(20, 10), "c_f", "j_f", "snow", nov(28)),
      ...visit("c_f", "j_f", nov(21, 10), nov(21, 11)),
    ]);
    expect(statement(early, "2026-11").promise).toEqual({ kept: 1, due: 1 });
    const missed = sealAll([
      received(nov(20, 9), "c_f", "53216"),
      planned(nov(20, 10), "c_f", "j_f", "snow", nov(28)),
      received(nov(29, 9), "c_g", "53206"),
    ]);
    expect(statement(missed, "2026-11")).toMatchObject({
      promise: { kept: 0, due: 1 },
      wrong: { latePromises: 1 },
    });
  });
});

const tap = (at: number, card: string, job: string, member: string, step: "there" | "done"): Step =>
  step === "there"
    ? [at, card, job, { type: "job.there", data: { member } }]
    : [at, card, job, { type: "job.done", data: { member, outcome: "done" } }];

const resentSnow = (secondDone: number): Step[] => [
  received(nov(10, 9), "c_r", "53216"),
  planned(nov(10, 10), "c_r", "j_r", "snow", nov(12)),
  [nov(11, 9), "c_r", "j_r", { type: "offer.accepted", data: { member: "m_v01" } }],
  tap(nov(11, 10), "c_r", "j_r", "m_v01", "there"),
  tap(nov(11, 11), "c_r", "j_r", "m_v01", "done"),
  [nov(11, 14), "c_r", "j_r", { type: "job.reopened", data: { as: "mismatch", exclude: "m_v01" } }],
  [secondDone - 3 * HOUR, "c_r", "j_r", { type: "offer.accepted", data: { member: "m_v02" } }],
  tap(secondDone - 2 * HOUR, "c_r", "j_r", "m_v02", "there"),
  tap(secondDone, "c_r", "j_r", "m_v02", "done"),
];

describe("statement promises after a re-send", () => {
  it("a re-sent job that is finished after its promise time is late and not kept", () => {
    const s = statement(sealAll(resentSnow(nov(13, 12))), "2026-11");
    expect(s).toMatchObject({ promise: { kept: 0, due: 1 }, wrong: { latePromises: 1, mismatches: 1 } });
    expect(s.balanced).toBe(true);
  });

  it("a re-sent job that is finished again before its promise time is kept", () => {
    const s = statement(sealAll(resentSnow(nov(11, 23))), "2026-11");
    expect(s).toMatchObject({ promise: { kept: 1, due: 1 }, wrong: { latePromises: 0 } });
  });

  it("a job done once on time and not re-sent is kept", () => {
    const events = sealAll([
      received(nov(10, 9), "c_k", "53216"),
      planned(nov(10, 10), "c_k", "j_k", "snow", nov(12)),
      [nov(11, 9), "c_k", "j_k", { type: "offer.accepted", data: { member: "m_v01" } }],
      tap(nov(11, 10), "c_k", "j_k", "m_v01", "there"),
      tap(nov(11, 11), "c_k", "j_k", "m_v01", "done"),
      received(nov(14, 9), "c_z", "53206"),
    ]);
    expect(statement(events, "2026-11")).toMatchObject({ promise: { kept: 1, due: 1 } });
  });

  it("a job reopened before a promise that is still in the future is not counted", () => {
    const events = sealAll(resentSnow(nov(13, 12)).slice(0, 6));
    expect(statement(events, "2026-11")).toMatchObject({
      promise: { kept: 0, due: 0 },
      wrong: { latePromises: 0 },
    });
  });
});
