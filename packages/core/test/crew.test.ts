import { describe, expect, it } from "vitest";
import type { Effect, Playbook } from "@vision/contracts";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import type { ViewContext } from "../src/views/common.js";
import { homeView } from "../src/views/volunteer.js";
import {
  BASE_NOW,
  accept,
  approve,
  config,
  confirmedSnow,
  effects,
  loadPlaybook,
  passOffer,
  playbook,
  run,
  snowVolunteers,
  state,
  types,
  useMembers,
  type Run,
  type Step,
} from "./helpers.js";

const withCrew = (crew: number): Playbook => ({
  version: "2026-11-22.crew",
  rows: playbook.rows.map((row) => (row.need === "snow" ? { ...row, crew } : row)),
});

const offeredCrew = (crew: number, volunteers: number): Step[] => [
  loadPlaybook(withCrew(crew)),
  useMembers(snowVolunteers(volunteers)),
  ...confirmedSnow("c_1"),
  approve("j_1"),
];

describe("crew jobs", () => {
  it("a crew job of 3 takes 3 accepts and then says taken", () => {
    const d = run(
      ...offeredCrew(3, 4),
      accept("j_1", "m_v01"),
      accept("j_1", "m_v02"),
      accept("j_1", "m_v03"),
      accept("j_1", "m_v04"),
    );
    expect(d.rejections).toEqual(["taken"]);
  });

  it("the first accept is the holder and the others are crew", () => {
    const d = run(
      ...offeredCrew(3, 4),
      accept("j_1", "m_v02"),
      accept("j_1", "m_v01"),
      accept("j_1", "m_v03"),
    );
    const job = state(d).jobs["j_1"];
    expect(job?.holderRef).toBe("m_v02");
    expect(job?.helpers).toEqual(["m_v01", "m_v03"]);
  });
});

describe("crew offers", () => {
  it("the offer stays open until the crew is full, then closes for the others", () => {
    const open = run(...offeredCrew(3, 4), accept("j_1", "m_v01"));
    expect(types(open)).not.toContain("offer.closed");
    const full = run(
      ...offeredCrew(3, 4),
      accept("j_1", "m_v01"),
      accept("j_1", "m_v02"),
      accept("j_1", "m_v03"),
    );
    expect(types(full).filter((t) => t === "offer.closed")).toHaveLength(1);
    expect(effects(full).at(-1)).toEqual({
      kind: "offer_closed",
      job: "j_1",
      members: ["m_v04"],
      reason: "taken",
    });
  });

  it("a member already on the crew cannot accept twice", () => {
    const d = run(...offeredCrew(3, 4), accept("j_1", "m_v01"), accept("j_1", "m_v01"));
    expect(d.rejections).toEqual(["wrong_state"]);
  });

  it("a job for one person closes the offer on the first accept", () => {
    const d = run(...offeredCrew(1, 4), accept("j_1", "m_v01"), accept("j_1", "m_v02"));
    expect(d.rejections).toEqual(["taken"]);
  });
});

describe("crew limits", () => {
  it("a volunteer on the crew of 3 open jobs cannot accept a fourth", () => {
    const d = run(
      loadPlaybook(withCrew(2)),
      useMembers(snowVolunteers(2)),
      ...["c_1", "c_2", "c_3", "c_4"].flatMap((c) => confirmedSnow(c)),
      ...["j_1", "j_2", "j_3", "j_4"].map((j) => approve(j)),
      ...["j_1", "j_2", "j_3"].flatMap((j) => [accept(j, "m_v02"), accept(j, "m_v01")]),
      accept("j_4", "m_v01"),
    );
    expect(d.rejections).toEqual(["too_many_jobs"]);
    expect(state(d).jobs["j_4"]?.holderRef).toBeNull();
  });
});

describe("crew passes", () => {
  it("after one accept on a crew of 3, another offered volunteer can still pass", () => {
    const d = run(...offeredCrew(3, 4), accept("j_1", "m_v01"), passOffer("j_1", "m_v02"));
    expect(d.rejections).toEqual([]);
    expect(effects(d).at(-1)).toEqual({ kind: "pass", job: "j_1", member: "m_v02" });
  });

  it("a member already on the crew cannot pass, and nobody can pass once the crew is full", () => {
    const onCrew = run(...offeredCrew(3, 4), accept("j_1", "m_v01"), passOffer("j_1", "m_v01"));
    expect(onCrew.rejections).toEqual(["wrong_state"]);
    const full = run(
      ...offeredCrew(3, 4),
      accept("j_1", "m_v01"),
      accept("j_1", "m_v02"),
      accept("j_1", "m_v03"),
      passOffer("j_1", "m_v04"),
    );
    expect(full.rejections).toEqual(["taken"]);
  });
});

const offeredOf = (list: readonly Effect[]): Record<string, string[]> => {
  const offered: Record<string, string[]> = {};
  for (const effect of list) {
    if (effect.kind === "offer") offered[effect.job] = [...(offered[effect.job] ?? []), ...effect.members];
    if (effect.kind === "offer_closed") offered[effect.job] = [];
  }
  return offered;
};

const crewCtx = (r: Run, crew: number): ViewContext => {
  const records = snowVolunteers(4).map((m) => ({ ...m, name: "Test Volunteer" }));
  return {
    now: BASE_NOW,
    newId: (prefix) => `${prefix}view`,
    playbook: withCrew(crew),
    members: records,
    offered: offeredOf(effects(r)),
    zips: zipsFile,
    config,
    memberRecords: records,
    partners: [],
    links: { partner: () => null },
  };
};

const offerJobs = (r: Run, crew: number, member: string): string[] =>
  homeView(state(r), crewCtx(r, crew), member).offers.map((o) => o.job);

describe("crew offers on the volunteer home", () => {
  it("after one accept on a crew of 3, another offered volunteer still sees the offer", () => {
    const r = run(...offeredCrew(3, 4), accept("j_1", "m_v01"));
    expect(offerJobs(r, 3, "m_v02")).toEqual(["j_1"]);
  });

  it("a volunteer already on the crew does not see the job as an offer", () => {
    const r = run(...offeredCrew(3, 4), accept("j_1", "m_v01"), accept("j_1", "m_v02"));
    expect(offerJobs(r, 3, "m_v01")).toEqual([]);
    expect(offerJobs(r, 3, "m_v02")).toEqual([]);
    expect(offerJobs(r, 3, "m_v03")).toEqual(["j_1"]);
  });

  it("the offer leaves the home once the crew is full or the job is for one person", () => {
    const full = run(
      ...offeredCrew(3, 4),
      accept("j_1", "m_v01"),
      accept("j_1", "m_v02"),
      accept("j_1", "m_v03"),
    );
    expect(offerJobs(full, 3, "m_v04")).toEqual([]);
    const single = run(...offeredCrew(1, 4), accept("j_1", "m_v01"));
    expect(offerJobs(single, 1, "m_v02")).toEqual([]);
  });
});
