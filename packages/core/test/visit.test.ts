import { describe, expect, it } from "vitest";
import { CLOCKS } from "../src/clocks.js";
import { statement } from "../src/statement.js";
import {
  acceptedSnow,
  at,
  confirm,
  done,
  effects,
  eventData,
  handOff,
  help,
  offeredSnow,
  onMyWay,
  post,
  reject,
  run,
  sortOff,
  state,
  submit,
  tapFor,
  there,
  types,
  BASE_NOW,
} from "./helpers.js";

const lastOffer = (d: ReturnType<typeof run>) =>
  effects(d)
    .filter((e) => e.kind === "offer")
    .at(-1);

describe("visit taps", () => {
  it("on my way, there, done with outcome done waits for the check-back", () => {
    const s = state(
      run(...acceptedSnow(), onMyWay("j_1", "m_v01"), there("j_1", "m_v01"), done("j_1", "m_v01", "done")),
    );
    expect(s.jobs["j_1"]).toMatchObject({
      status: "done",
      checkback: { dueAt: BASE_NOW + CLOCKS.checkbackNormal, tries: 0, sentAt: null },
    });
  });

  it("each tap records the member who made it", () => {
    const d = run(...acceptedSnow(), onMyWay("j_1", "m_v01"), there("j_1", "m_v01"));
    expect(eventData(d, "job.on_my_way")).toEqual({ member: "m_v01" });
    expect(eventData(d, "job.there")).toEqual({ member: "m_v01" });
  });

  it("hours come from on my way to done", () => {
    const s = state(
      run(...acceptedSnow(), at(0, onMyWay("j_1", "m_v01")), at(90 * 60_000, done("j_1", "m_v01", "done"))),
    );
    expect(s.jobs["j_1"]?.hoursMs).toBe(90 * 60_000);
  });

  it("the volunteer hours in the statement come from on my way to done", () => {
    const d = run(
      ...acceptedSnow(),
      at(0, onMyWay("j_1", "m_v01")),
      at(30 * 60_000, there("j_1", "m_v01")),
      at(90 * 60_000, done("j_1", "m_v01", "done")),
    );
    expect(statement(d.events, "2026-11").hours).toBe(1.5);
  });

  it("there is allowed straight after accept and done straight after accept", () => {
    expect(state(run(...acceptedSnow(), there("j_1", "m_v01"))).jobs["j_1"]?.status).toBe("there");
    expect(state(run(...acceptedSnow(), done("j_1", "m_v01", "done"))).jobs["j_1"]?.status).toBe("done");
  });
});

describe("tap order", () => {
  it("on my way twice is the wrong state", () => {
    expect(reject(onMyWay("j_1", "m_v01"), [...acceptedSnow(), onMyWay("j_1", "m_v01")])).toBe("wrong_state");
  });

  it("there after there is the wrong state", () => {
    expect(reject(there("j_1", "m_v01"), [...acceptedSnow(), there("j_1", "m_v01")])).toBe("wrong_state");
  });

  it("a tap on a job that is only offered is refused", () => {
    expect(reject(onMyWay("j_1", "m_v01"), offeredSnow())).toBe("forbidden");
  });

  it("a tap on an unknown job is not found", () => {
    expect(reject(onMyWay("j_9", "m_v01"), acceptedSnow())).toBe("not_found");
  });

  it("only the holder can tap", () => {
    expect(reject(onMyWay("j_1", "m_v02"), acceptedSnow())).toBe("forbidden");
    expect(reject(done("j_1", "m_v02", "done"), acceptedSnow())).toBe("forbidden");
  });
});

describe("done outcomes", () => {
  it("not done returns the job to the desk", () => {
    const d = run(...acceptedSnow(), done("j_1", "m_v01", "not_done"));
    expect(eventData(d, "job.returned")).toEqual({ reason: "not_done" });
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "planned", holderRef: null, checkback: null });
  });

  it("partly done still waits for the check-back", () => {
    const d = run(...acceptedSnow(), done("j_1", "m_v01", "partly"));
    expect(eventData(d, "job.done")).toEqual({ member: "m_v01", outcome: "partly" });
    expect(state(d).jobs["j_1"]?.checkback).not.toBeNull();
  });

  it("a done note goes to the vault and not into the ledger", () => {
    const d = run(...acceptedSnow(), done("j_1", "m_v01", "done", "Salted the steps too"));
    expect(JSON.stringify(d.events)).not.toContain("Salted");
    expect(effects(d).at(-1)).toEqual({
      kind: "vault.text",
      card: "c_1",
      job: "j_1",
      textKind: "note",
      text: "Salted the steps too",
    });
  });
});

describe("hand off", () => {
  it("hand off sends a new wave without the volunteer who handed off", () => {
    const d = run(...acceptedSnow(), handOff("j_1", "m_v01", "My car broke down"));
    expect(eventData(d, "job.returned")).toEqual({ reason: "hand_off" });
    expect(state(d).jobs["j_1"]?.excluded).toContain("m_v01");
    expect(lastOffer(d)?.members).toEqual(["m_v02"]);
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "offered", wave: 1, holderRef: null });
  });

  it("hand off with nobody else returns the job to the desk", () => {
    const d = run(...offeredSnow(1), tapFor("j_1", "m_v01", "accept"), handOff("j_1", "m_v01", "Sick today"));
    expect(d.events.at(-1)).toMatchObject({ type: "job.returned", data: { reason: "no_volunteer" } });
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "planned", excluded: ["m_v01"] });
  });

  it("a volunteer who handed off cannot accept the job again", () => {
    expect(
      reject(tapFor("j_1", "m_v01", "accept"), [...acceptedSnow(), handOff("j_1", "m_v01", "Sick today")]),
    ).toBe("not_eligible");
  });

  it("note text goes to the vault and never into the ledger", () => {
    const d = run(...acceptedSnow(), handOff("j_1", "m_v01", "My car broke down"));
    expect(JSON.stringify(d.events)).not.toContain("car broke");
    expect(effects(d)).toContainEqual({
      kind: "vault.text",
      card: "c_1",
      job: "j_1",
      textKind: "note",
      text: "My car broke down",
    });
  });
});

describe("help", () => {
  it("help pages the desk and keeps the job with the volunteer", () => {
    const d = run(...acceptedSnow(), help("j_1", "m_v01", "Nobody answers the door"));
    expect(types(d).slice(-2)).toEqual(["job.help", "page.sent"]);
    expect(eventData(d, "page.sent")).toMatchObject({ reason: "help", step: 0 });
    expect(state(d).jobs["j_1"]?.status).toBe("accepted");
    expect(JSON.stringify(d.events)).not.toContain("Nobody answers");
  });

  it("only the holder can ask for help or hand off", () => {
    expect(reject(help("j_1", "m_v02"), acceptedSnow())).toBe("forbidden");
    expect(reject(handOff("j_1", "m_v02", "Not mine"), acceptedSnow())).toBe("forbidden");
  });
});

describe("thread", () => {
  it("a thread post stores the text in the vault and only the role in the ledger", () => {
    const d = run(...acceptedSnow(), post("c_1", "Gate code is 1234", { as: "desk" }));
    expect(d.events.at(-1)).toMatchObject({ type: "thread.posted", data: { byRole: "desk" } });
    expect(effects(d).at(-1)).toMatchObject({
      kind: "vault.text",
      textKind: "note",
      text: "Gate code is 1234",
    });
    expect(JSON.stringify(d.events)).not.toContain("1234");
  });

  it("the holder can post to the thread of the card", () => {
    const d = run(...acceptedSnow(), post("c_1", "I am at the side door", { as: "volunteer" }));
    expect(d.events.at(-1)).toMatchObject({ type: "thread.posted", data: { byRole: "volunteer" } });
    expect(effects(d).at(-1)).toMatchObject({ kind: "vault.text", job: "j_1" });
  });

  it("a volunteer who holds no job on the card cannot post", () => {
    expect(reject(post("c_1", "Hello", { as: "volunteer", member: "m_v02" }), acceptedSnow())).toBe(
      "forbidden",
    );
  });
});

describe("quiet thread", () => {
  it("only the lead may write on a quiet card", () => {
    const quiet = [
      submit("c_1", "text", { safeContact: false }),
      sortOff("c_1"),
      confirm("c_1", "snow", "low", { as: "lead" }),
    ];
    expect(reject(post("c_1", "Hello", { as: "desk" }), quiet)).toBe("forbidden");
    expect(run(...quiet, post("c_1", "Hello", { as: "lead" })).events.at(-1)).toMatchObject({
      type: "thread.posted",
      data: { byRole: "lead" },
    });
  });

  it("a post to an unknown card is not found", () => {
    expect(reject(post("c_9", "Hello"), acceptedSnow())).toBe("not_found");
  });
});

describe("desk taps for a volunteer", () => {
  it("the desk can tap done for a volunteer with no smartphone", () => {
    const d = run(...acceptedSnow("m_v03"), tapFor("j_1", "m_v03", "done", "done"));
    expect(d.events.at(-1)).toMatchObject({
      type: "job.done",
      actor: { role: "desk" },
      data: { member: "m_v03", outcome: "done" },
    });
  });

  it("the desk can tap on my way and there for the holder", () => {
    const d = run(
      ...acceptedSnow("m_v03"),
      tapFor("j_1", "m_v03", "on_my_way"),
      tapFor("j_1", "m_v03", "there"),
    );
    expect(types(d).slice(-2)).toEqual(["job.on_my_way", "job.there"]);
    expect(state(d).jobs["j_1"]?.status).toBe("there");
  });

  it("the desk tap done needs an outcome", () => {
    expect(reject(tapFor("j_1", "m_v03", "done"), acceptedSnow("m_v03"))).toBe("invalid");
  });

  it("the desk cannot tap for a member who does not hold the job", () => {
    expect(reject(tapFor("j_1", "m_v02", "there"), acceptedSnow())).toBe("forbidden");
  });
});
