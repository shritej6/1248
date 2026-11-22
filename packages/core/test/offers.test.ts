import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  accept,
  acceptedSnow,
  addJob,
  approve,
  confirm,
  confirmedSnow,
  effects,
  eventData,
  members,
  offerAgain,
  offerTo,
  offeredSnow,
  passOffer,
  reject,
  run,
  snowVolunteers,
  sortOff,
  state,
  submit,
  tapFor,
  types,
  useMembers,
} from "./helpers.js";

const offerEffects = (d: ReturnType<typeof run>) =>
  effects(d).filter((e) => e.kind === "offer" || e.kind === "offer_closed" || e.kind === "pass");

describe("approve and waves", () => {
  it("approve starts wave 1 and sends offers without any name or address", () => {
    const d = run(...confirmedSnow(), approve("j_1"));
    expect(eventData(d, "offer.wave_sent")).toEqual({ wave: 1, count: 2 });
    expect(effects(d).find((e) => e.kind === "offer")).toEqual({
      kind: "offer",
      job: "j_1",
      members: ["m_v01", "m_v02"],
    });
    expect(JSON.stringify(offerEffects(d))).not.toMatch(/Test St|Avery|Tess/);
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "offered", approved: true, wave: 1 });
  });

  it("no eligible volunteer returns the job to the desk", () => {
    const d = run(...confirmedSnow({ allOff: true }), approve("j_1"));
    expect(eventData(d, "job.returned")).toEqual({ reason: "no_volunteer" });
    expect(types(d)).not.toContain("offer.wave_sent");
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "planned", returnReason: "no_volunteer" });
  });

  it("a job can be approved only once", () => {
    expect(reject(approve("j_1"), offeredSnow())).toBe("wrong_state");
  });

  it("an unknown job is not found", () => {
    expect(reject(approve("j_9"), confirmedSnow())).toBe("not_found");
  });

  it("a volunteer cannot approve a plan", () => {
    expect(reject(approve("j_1", { as: "volunteer" }), confirmedSnow())).toBe("forbidden");
  });
});

describe("paths and guards", () => {
  it("a job whose first rung is a partner asks the person first and sends no offer", () => {
    const d = run(...confirmedSnow(), addJob("c_1", "food"), approve("j_2"));
    expect(d.events.at(-1)).toMatchObject({ type: "consent.asked", job: "j_2" });
    expect(effects(d).filter((e) => e.kind === "offer")).toHaveLength(0);
  });

  it("a quiet job can be approved only by the lead", () => {
    const quiet = [
      submit("c_1", "text", { safeContact: false }),
      sortOff("c_1"),
      confirm("c_1", "snow", "low", { as: "lead" }),
    ];
    expect(reject(approve("j_1"), quiet)).toBe("forbidden");
    expect(types(run(...quiet, approve("j_1", { as: "lead" })))).toContain("offer.wave_sent");
  });

  it("offer again after a return starts a new wave 1", () => {
    const d = run(...confirmedSnow({ allOff: true }), approve("j_1"), useMembers(members), offerAgain("j_1"));
    expect(eventData(d, "offer.wave_sent")).toEqual({ wave: 1, count: 2 });
  });

  it("offer again needs an approved plan that is back at the desk", () => {
    expect(reject(offerAgain("j_1"), confirmedSnow())).toBe("wrong_state");
    expect(reject(offerAgain("j_1"), offeredSnow())).toBe("wrong_state");
  });
});

describe("first accept wins", () => {
  it("first accept wins and the others get offer_closed", () => {
    const d = run(...offeredSnow(), accept("j_1", "m_v01"), accept("j_1", "m_v02"));
    expect(d.rejections).toEqual(["taken"]);
    expect(effects(d).find((e) => e.kind === "offer_closed")).toMatchObject({
      members: ["m_v02"],
      reason: "taken",
    });
    expect(types(d).slice(-2)).toEqual(["offer.accepted", "offer.closed"]);
    expect(eventData(d, "offer.closed")).toEqual({ reason: "taken" });
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "accepted", holderRef: "m_v01" });
  });

  it("of many accepts exactly one succeeds", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(["m_v01", "m_v02", "m_v03"], { minLength: 2 }), (order) => {
        const d = run(...offeredSnow(3), ...order.map((m) => accept("j_1", m)));
        expect(d.rejections.filter((r) => r === "taken")).toHaveLength(order.length - 1);
        expect(d.events.filter((e) => e.type === "offer.accepted")).toHaveLength(1);
        expect(state(d).jobs["j_1"]?.holderRef).toBe(order[0]);
      }),
    );
  });
});

describe("who may accept", () => {
  it("an accept before any offer is the wrong state", () => {
    expect(reject(accept("j_1", "m_v01"), confirmedSnow())).toBe("wrong_state");
  });

  it("a volunteer without the skill cannot accept", () => {
    expect(reject(accept("j_1", "m_v05"), offeredSnow())).toBe("not_eligible");
  });

  it("a volunteer who holds 3 jobs cannot accept a fourth", () => {
    const setup = [
      useMembers(snowVolunteers(2)),
      ...["c_1", "c_2", "c_3", "c_4"].flatMap((c) => confirmedSnow(c)),
      ...["j_1", "j_2", "j_3", "j_4"].map((j) => approve(j)),
      accept("j_1", "m_v01"),
      accept("j_2", "m_v01"),
      accept("j_3", "m_v01"),
    ];
    expect(reject(accept("j_4", "m_v01"), setup)).toBe("too_many_jobs");
  });

  it("a volunteer outside the wave cannot accept", () => {
    const setup = [useMembers(snowVolunteers(4)), ...offeredSnow(2)];
    expect(reject(accept("j_1", "m_v04"), setup)).toBe("not_eligible");
  });

  it("a volunteer outside the wave cannot pass", () => {
    const setup = [useMembers(snowVolunteers(4)), ...offeredSnow(2)];
    expect(reject(passOffer("j_1", "m_v04"), setup)).toBe("not_eligible");
  });
});

describe("pass", () => {
  it("a pass writes no ledger line", () => {
    const d = run(...offeredSnow(), passOffer("j_1", "m_v02"));
    expect(d.events.slice(-1)[0]?.type).toBe("offer.wave_sent");
    expect(effects(d).slice(-1)[0]).toEqual({ kind: "pass", job: "j_1", member: "m_v02" });
  });

  it("a pass on a job that is already taken says taken", () => {
    expect(reject(passOffer("j_1", "m_v02"), acceptedSnow())).toBe("taken");
  });
});

describe("desk taps for a volunteer", () => {
  it("the desk can accept for a volunteer with no smartphone", () => {
    const d = run(...offeredSnow(), tapFor("j_1", "m_v03", "accept"));
    expect(d.events.at(-2)).toMatchObject({
      type: "offer.accepted",
      actor: { role: "desk" },
      data: { member: "m_v03" },
    });
    expect(effects(d).find((e) => e.kind === "offer_closed")).toMatchObject({
      members: ["m_v01", "m_v02"],
      reason: "taken",
    });
  });

  it("the desk can accept for a volunteer on a plan that has no wave yet", () => {
    const d = run(...confirmedSnow(), tapFor("j_1", "m_v03", "accept"));
    expect(types(d).slice(-2)).toEqual(["job.approved", "offer.accepted"]);
  });

  it("the desk cannot tap accept for a volunteer without the skill", () => {
    expect(reject(tapFor("j_1", "m_v05", "accept"), offeredSnow())).toBe("not_eligible");
  });
});

describe("named offer", () => {
  it("the desk can offer a job to one member by name, and the member must still accept", () => {
    const d = run(...confirmedSnow(), offerTo("j_1", "m_v04"));
    expect(types(d).slice(-2)).toEqual(["job.approved", "offer.wave_sent"]);
    expect(eventData(d, "offer.wave_sent")).toEqual({ wave: 1, count: 1 });
    expect(effects(d).at(-1)).toEqual({ kind: "offer", job: "j_1", members: ["m_v04"] });
    expect(state(d).jobs["j_1"]?.holderRef).toBeNull();
  });

  it("a named offer goes only to an eligible member", () => {
    expect(reject(offerTo("j_1", "m_v05"), confirmedSnow())).toBe("not_eligible");
    expect(reject(offerTo("j_1", "m_x99"), confirmedSnow())).toBe("not_found");
  });

  it("only the named member can accept a named offer", () => {
    const setup = [...confirmedSnow(), offerTo("j_1", "m_v04")];
    expect(reject(accept("j_1", "m_v01"), setup)).toBe("not_eligible");
    const d = run(...setup, accept("j_1", "m_v04"));
    expect(d.rejections).toEqual([]);
    expect(state(d).jobs["j_1"]?.holderRef).toBe("m_v04");
  });
});
