import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LedgerEventSchema, type EventDraft } from "@vision/contracts";
import { CLOCKS, emptyState, evolve, fold, verifySeal } from "../src/index.js";
import { BASE_AT, IDS, arbHistory, cardScript, seal, uid, type CardSpec } from "./arbitraries.js";

const spec = (over: Partial<CardSpec>): CardSpec => ({
  need: "snow",
  urgency: "low",
  changed: false,
  safeContact: true,
  choices: [],
  ...over,
});

const jobDraft = (type: "job.on_my_way" | "job.there", job: string): EventDraft => ({
  card: IDS.card,
  job,
  type,
  actor: { role: "volunteer", ref: IDS.v01 },
  data: { member: IDS.v01 },
});

describe("fold", () => {
  it("arbitrary histories are valid sealed ledger lines", () => {
    fc.assert(
      fc.property(arbHistory(), (events) => {
        for (const e of events) expect(LedgerEventSchema.safeParse(e).success).toBe(true);
        expect(verifySeal(events).ok).toBe(true);
      }),
    );
  });

  it("fold of all events equals step by step evolve", () => {
    fc.assert(
      fc.property(arbHistory(), (events) => {
        expect(fold(events)).toEqual(events.reduce(evolve, emptyState()));
      }),
    );
  });

  it("fold from a state continues where it stopped", () => {
    fc.assert(
      fc.property(arbHistory(), fc.nat(), (events, cut) => {
        const k = cut % (events.length + 1);
        expect(fold(events.slice(k), fold(events.slice(0, k)))).toEqual(fold(events));
      }),
    );
  });

  it("the state keeps the last seq and hash of the ledger", () => {
    fc.assert(
      fc.property(arbHistory(), (events) => {
        const s = fold(events);
        expect(s.seq).toBe(events.at(-1)?.seq);
        expect(s.lastHash).toBe(events.at(-1)?.hash);
      }),
    );
  });
});

describe("evolve purity", () => {
  it("evolve never changes the state it is given", () => {
    fc.assert(
      fc.property(arbHistory(), (events) => {
        const before = fold(events.slice(0, -1));
        const copy = JSON.parse(JSON.stringify(before)) as unknown;
        const last = events.at(-1);
        if (last) evolve(before, last);
        expect(before).toEqual(copy);
      }),
    );
  });

  it("an empty ledger folds to the empty state", () => {
    expect(fold([])).toEqual(emptyState());
    expect(emptyState().seq).toBe(0);
  });
});

describe("evolve of cards", () => {
  it("a received and confirmed card holds the confirm data and counts the need", () => {
    const s = fold(seal(cardScript(1, spec({ changed: true }))));
    const card = s.cards[IDS.card];
    expect(card).toMatchObject({
      door: "form",
      zip: "53216",
      need: "snow",
      level: 2,
      routeCode: "SNOW-16-001",
    });
    expect(card?.jobs).toEqual([IDS.job]);
    expect(s.counters["snow"]).toBe(1);
    expect(s.needRecords["snow"]).toEqual({ clean: 0, changed: 1, serious: 0 });
  });

  it("a clean confirm adds to the clean run of the need", () => {
    const s = fold(seal([...cardScript(1, spec({})), ...cardScript(2, spec({}))]));
    expect(s.needRecords["snow"]).toEqual({ clean: 2, changed: 0, serious: 0 });
  });

  it("a card where contact is not safe is quiet", () => {
    const s = fold(seal(cardScript(1, spec({ safeContact: false }))));
    expect(s.cards[IDS.card]?.quiet).toBe(true);
    expect(s.jobs[IDS.job]?.quiet).toBe(true);
  });

  it("a high card records its page and the answer", () => {
    const s = fold(seal(cardScript(1, spec({ urgency: "high" }))));
    expect(s.pages[uid("pg_", 1)]).toMatchObject({ to: IDS.desk2, step: 1, answeredBy: IDS.desk2 });
  });
});

describe("evolve of jobs", () => {
  it("a planned job starts at the desk with the promise time", () => {
    const s = fold(seal(cardScript(1, spec({}))));
    expect(s.jobs[IDS.job]).toMatchObject({
      status: "planned",
      path: "volunteers",
      rung: 0,
      holderRef: null,
    });
    expect(s.jobs[IDS.job]?.promiseAt).toBe(BASE_AT + 48 * 3_600_000);
  });

  it("accept, on my way, there and done record the volunteer, the hours and the check-back", () => {
    const s = fold(seal(cardScript(1, spec({ urgency: "high", choices: [0, 0, 0, 0, 0] }))));
    const job = s.jobs[IDS.job];
    expect(job).toMatchObject({ status: "done", holderRef: IDS.v01 });
    expect(job?.hoursMs).toBe(2 * 60_000);
    expect(job?.checkback).toEqual({
      dueAt: (job?.doneAt ?? 0) + CLOCKS.checkbackUrgent,
      tries: 0,
      sentAt: null,
    });
  });

  it("a low card waits three days for the check-back", () => {
    const s = fold(seal(cardScript(1, spec({ choices: [0, 0, 0, 0, 0] }))));
    const job = s.jobs[IDS.job];
    expect(job?.checkback?.dueAt).toBe((job?.doneAt ?? 0) + CLOCKS.checkbackNormal);
  });
});

describe("evolve after the visit", () => {
  it("a no after done reopens as mismatch and leaves out the volunteer", () => {
    const s = fold(seal(cardScript(1, spec({ choices: [0, 0, 0, 0, 0, 0, 3] }))));
    expect(s.jobs[IDS.job]).toMatchObject({ status: "mismatch", excluded: [IDS.v01], holderRef: null });
  });

  it("a yes after done closes the job as helped", () => {
    const s = fold(seal(cardScript(1, spec({ choices: [0, 0, 0, 0, 0, 0, 1] }))));
    expect(s.jobs[IDS.job]).toMatchObject({ status: "helped", checkback: null });
    expect(s.jobs[IDS.job]?.closedAt).not.toBeNull();
  });

  it("the partner path ends with the partner holding the job", () => {
    const s = fold(seal(cardScript(1, spec({ need: "food", choices: [2, 0, 0, 0] }))));
    expect(s.jobs[IDS.job]).toMatchObject({ status: "got_it", path: "partner", holderRef: IDS.pantry });
    expect(s.promises).toEqual([IDS.pantry]);
  });

  it("a returned job goes back to the desk with the reason", () => {
    const s = fold(seal(cardScript(1, spec({ choices: [0, 0, 2] }))));
    expect(s.jobs[IDS.job]).toMatchObject({
      status: "planned",
      holderRef: null,
      returnReason: "claim_expired",
    });
  });

  it("an event for an unknown job is ignored but still moves the seq", () => {
    const events = seal([...cardScript(1, spec({})), jobDraft("job.there", uid("j_", 99))]);
    const s = fold(events);
    expect(s.jobs[uid("j_", 99)]).toBeUndefined();
    expect(s.seq).toBe(events.length);
  });
});

describe("evolve of the organisation", () => {
  it("shift, clock, levels and playbook lines change the state", () => {
    const actor = { role: "organiser" as const, ref: IDS.owner };
    const s = fold(
      seal([
        { card: null, job: null, type: "shift.taken", actor, data: { member: IDS.desk2 } },
        { card: null, job: null, type: "clock.jumped", actor, data: { byMs: 60_000 } },
        { card: null, job: null, type: "clock.jumped", actor, data: { byMs: 120_000 } },
        { card: null, job: null, type: "levels.master_set", actor, data: { on: true } },
        { card: null, job: null, type: "need.level_set", actor, data: { need: "snow", level: 1 } },
        { card: null, job: null, type: "playbook.loaded", actor, data: { version: "v9", rows: 13 } },
      ]),
    );
    expect(s).toMatchObject({ deskOnShift: IDS.desk2, clockOffsetMs: 180_000, playbookVersion: "v9" });
    expect(s.levels).toEqual({ master: true, needs: { snow: 1 } });
  });
});
