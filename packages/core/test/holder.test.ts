import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CHECKBACK_TRIES, CLOCKS, fold, holderOf, isClosed } from "../src/index.js";
import { IDS, arbHistory, ctx, withJob } from "./arbitraries.js";

describe("holder", () => {
  it("every open job has exactly one holder and a closed job has none", () => {
    fc.assert(
      fc.property(arbHistory(), (events) => {
        const s = fold(events);
        for (const j of Object.values(s.jobs))
          expect(holderOf(s, j.id, ctx).kind === "none").toBe(isClosed(j.status));
      }),
    );
  });

  it("an accepted job is held by the volunteer and a got_it job by the partner", () => {
    expect(holderOf(withJob("accepted", IDS.v01), IDS.job, ctx)).toEqual({
      kind: "volunteer",
      member: IDS.v01,
    });
    expect(holderOf(withJob("got_it", IDS.pantry), IDS.job, ctx)).toEqual({
      kind: "partner",
      partner: IDS.pantry,
    });
    expect(holderOf(withJob("unmet", null), IDS.job, ctx)).toEqual({ kind: "owner", member: IDS.owner });
  });

  it("the desk person on shift holds a job that waits at the desk", () => {
    const s = { ...withJob("partner_yes", null), deskOnShift: IDS.desk };
    expect(holderOf(s, IDS.job, ctx)).toEqual({ kind: "desk", member: IDS.desk });
    expect(holderOf(withJob("done", IDS.v01), IDS.job, ctx)).toEqual({ kind: "desk", member: null });
  });
});

describe("holder rules for lead and closed jobs", () => {
  it("a lead holds a level 3 or quiet job that is not with a volunteer or partner", () => {
    expect(holderOf(withJob("planned", null, "text_extraction"), IDS.job, ctx)).toEqual({
      kind: "lead",
      member: IDS.lead,
    });
    expect(holderOf(withJob("unmet", null, "text_extraction"), IDS.job, ctx)).toEqual({
      kind: "lead",
      member: IDS.lead,
    });
    expect(holderOf(withJob("there", IDS.v02, "text_extraction"), IDS.job, ctx)).toEqual({
      kind: "volunteer",
      member: IDS.v02,
    });
  });

  it("a closed or unknown job has no holder", () => {
    for (const status of ["helped", "unreached", "withdrawn"] as const) {
      expect(holderOf(withJob(status, IDS.v01), IDS.job, ctx)).toEqual({ kind: "none" });
    }
    expect(holderOf(withJob("planned", null), "j_missing", ctx)).toEqual({ kind: "none" });
  });

  it("only helped, unreached and withdrawn are closed", () => {
    expect(["helped", "unreached", "withdrawn"].every((s) => isClosed(s as "helped"))).toBe(true);
    expect(isClosed("mismatch")).toBe(false);
    expect(isClosed("unmet")).toBe(false);
  });
});

describe("clocks", () => {
  it("the defaults match spec 7", () => {
    const minute = 60_000;
    const hour = 60 * minute;
    expect(CLOCKS).toEqual({
      deskConfirm: 15 * minute,
      pageAnswer: 3 * minute,
      waveWait: 5 * minute,
      claim: 2 * hour,
      visit: 60 * minute,
      consent: 24 * hour,
      gotIt: 24 * hour,
      checkbackUrgent: 24 * hour,
      checkbackNormal: 72 * hour,
      checkbackReply: 24 * hour,
    });
    expect(CHECKBACK_TRIES).toBe(3);
  });
});
