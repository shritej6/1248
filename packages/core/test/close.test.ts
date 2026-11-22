import type { Actor } from "@vision/contracts";
import { describe, expect, it } from "vitest";
import { checkbackAskView, closeDeadlines, isMismatch } from "../src/index.js";
import {
  BASE_NOW,
  accept,
  acceptedSnow,
  approve,
  confirm,
  confirmedSnow,
  done,
  effects,
  eventData,
  offerAgain,
  offeredSnow,
  pass,
  playbook,
  reject,
  run,
  runFrom,
  snowVolunteers,
  sortResult,
  state,
  submit,
  types,
  useMembers,
  type AnyCommand,
  type Run,
  type Step,
} from "./helpers.js";

const HOUR = 3_600_000;
const DESK: Actor = { role: "desk", ref: "m_d01" };
const LEAD: Actor = { role: "lead", ref: "m_l01" };
const SYSTEM: Actor = { role: "system", ref: null };
const ACTORS = { desk: DESK, lead: LEAD, volunteer: { role: "volunteer", ref: "m_v01" } } as const;
type As = { as?: keyof typeof ACTORS };

let counter = 0;
const id = (): string => {
  counter += 1;
  return `cmd_k${String(counter)}`;
};
const as = (command: AnyCommand, actor: Actor, offset = 0): Step => ({ command, actor, offset });

const checkback = (job: string, answer: 1 | 2 | 3, actor: Actor = { role: "resident", ref: "c_1" }): Step =>
  as({ id: id(), type: "checkback.answer", job, answer }, actor);
const withdraw = (job: string, reason: "cancelled" | "duplicate", options: As = {}): Step =>
  as({ id: id(), type: "job.withdraw", job, reason }, ACTORS[options.as ?? "desk"]);
const clearFlag = (job: string, options: As = {}): Step =>
  as({ id: id(), type: "job.clear_flag", job, flag: "checkback_call" }, ACTORS[options.as ?? "desk"]);

const doneSnow = (options: { safeContact?: boolean } = {}): Step[] => {
  if (options.safeContact !== false) return [...acceptedSnow(), done("j_1", "m_v01", "done")];
  return [
    submit("c_1", "Please help me shovel my walk this week", { safeContact: false }),
    sortResult("c_1", [pass("low"), pass("low")]),
    confirm("c_1", "snow", "low", { as: "lead" }),
    approve("j_1", { as: "lead" }),
    accept("j_1", "m_v01"),
    done("j_1", "m_v01", "done"),
  ];
};

const fireAt = (d: Run, ms: number): Run => {
  const now = BASE_NOW + ms;
  const due = closeDeadlines(d.state).filter((x) => x.at <= now);
  const next = runFrom(d.state, ...due.map((deadline) => as({ type: "timer.fired", deadline }, SYSTEM, ms)));
  return { ...next, events: [...d.events, ...next.events], effects: [...d.effects, ...next.effects] };
};

const runTimers = (setup: Step[], ...at: number[]): Run => at.reduce(fireAt, run(...setup));

const checkbackSent = (): Step[] => doneSnow();
const sentRun = (...more: Step[]): Run => {
  const d = runTimers(checkbackSent(), 72 * HOUR);
  const next = runFrom(d.state, ...more);
  return { ...next, events: [...d.events, ...next.events], effects: [...d.effects, ...next.effects] };
};

describe("the check-back answer", () => {
  it("answer 1 closes the job as helped", () => {
    expect(eventData(sentRun(checkback("j_1", 1)), "job.closed")).toEqual({ result: "helped", reason: null });
  });

  it("answer 3 after DONE is a mismatch that leaves out the first volunteer", () => {
    const d = sentRun(checkback("j_1", 3), offerAgain("j_1"));
    expect(eventData(d, "job.reopened")).toEqual({ as: "mismatch", exclude: "m_v01" });
    const offers = effects(d).filter((e) => e.kind === "offer");
    expect(offers.at(-1)?.kind === "offer" ? offers.at(-1)?.members : []).not.toContain("m_v01");
    expect(offers.length).toBeGreaterThan(1);
  });

  it("a mismatch marks the card red while the job is open", () => {
    const d = sentRun(checkback("j_1", 3), offerAgain("j_1"));
    expect(isMismatch(state(d), "j_1")).toBe(true);
    expect(isMismatch(state(sentRun(checkback("j_1", 1))), "j_1")).toBe(false);
  });

  it("answer 2 returns the job to the desk as partly", () => {
    expect(state(sentRun(checkback("j_1", 2))).jobs["j_1"]?.status).toBe("partly");
  });

  it("the desk can answer for the person after a phone call", () => {
    expect(eventData(sentRun(checkback("j_1", 1, DESK)), "job.closed")).toMatchObject({ result: "helped" });
  });

  it("a resident link for another card cannot answer", () => {
    expect(sentRun(checkback("j_1", 1, { role: "resident", ref: "c_9" })).rejections).toEqual(["forbidden"]);
  });

  it("an answer before DONE is refused, so one key never closes a job", () => {
    expect(reject(checkback("j_1", 1), acceptedSnow())).toBe("wrong_state");
  });
});

describe("the check-back clocks", () => {
  it("the question goes out 3 days after DONE with a fixed message", () => {
    const d = runTimers(doneSnow(), 72 * HOUR);
    expect(eventData(d, "checkback.sent")).toEqual({ try: 1 });
    expect(effects(d).find((e) => e.kind === "message" && e.template === "checkback")).toMatchObject({
      to: "resident",
      slots: { needLabel: playbook.rows.find((r) => r.need === "snow")?.label },
    });
  });

  it("the question does not go out before the time", () => {
    expect(types(runTimers(doneSnow(), 72 * HOUR - 1))).not.toContain("checkback.sent");
  });

  it("three silent tries close the job as unreached, never helped", () => {
    const d = runTimers(doneSnow(), 72 * HOUR, 96 * HOUR, 120 * HOUR, 144 * HOUR);
    expect(d.events.filter((e) => e.type === "checkback.sent")).toHaveLength(3);
    expect(eventData(d, "job.closed")).toEqual({ result: "unreached", reason: null });
    expect(closeDeadlines(state(d))).toEqual([]);
  });

  it("a card with unsafe contact gets a call task, not a message", () => {
    const d = runTimers(doneSnow({ safeContact: false }), 72 * HOUR);
    expect(eventData(d, "job.flagged")).toEqual({ flag: "checkback_call" });
    expect(effects(d).filter((e) => e.kind === "message" && e.template === "checkback")).toHaveLength(0);
  });

  it("the tracking page shows the check-back question only after it is sent", () => {
    const ctx = { playbook };
    expect(checkbackAskView(state(run(...doneSnow())), ctx, "c_1")).toBeNull();
    expect(checkbackAskView(state(runTimers(doneSnow(), 72 * HOUR)), ctx, "c_1")).toEqual({
      job: "j_1",
      needLabel: playbook.rows.find((r) => r.need === "snow")?.label,
    });
  });
});

describe("withdraw and flags", () => {
  it("only a person withdraws a job", () => {
    expect(reject(withdraw("j_1", "duplicate", { as: "volunteer" }), offeredSnow())).toBe("forbidden");
  });

  it("withdraw closes the job and takes the offer off the phones", () => {
    const d = run(...offeredSnow(), withdraw("j_1", "cancelled"));
    expect(eventData(d, "job.closed")).toEqual({ result: "withdrawn", reason: "cancelled" });
    expect(effects(d).find((e) => e.kind === "offer_closed")).toMatchObject({
      job: "j_1",
      reason: "expired",
    });
  });

  it("a closed job cannot be withdrawn", () => {
    expect(sentRun(checkback("j_1", 1), withdraw("j_1", "duplicate")).rejections).toEqual(["wrong_state"]);
  });

  it("the lead clears a call task, and a missing flag is refused", () => {
    const d = runTimers(doneSnow({ safeContact: false }), 72 * HOUR);
    expect(runFrom(state(d), clearFlag("j_1", { as: "lead" })).events.map((e) => e.type)).toEqual([
      "job.flag_cleared",
    ]);
    expect(runFrom(state(d), clearFlag("j_1")).rejections).toEqual(["forbidden"]);
    expect(reject(clearFlag("j_1"), doneSnow())).toBe("wrong_state");
  });
});

describe("offer again from the unmet shelf", () => {
  it("starts the ladder again from the top", () => {
    const shelved = run(
      ...confirmedSnow({ allOff: true }),
      approve("j_1"),
      as({ id: id(), type: "job.next_rung", job: "j_1" }, DESK),
      useMembers(snowVolunteers(2)),
    );
    expect(state(shelved).jobs["j_1"]?.status).toBe("unmet");
    const d = runFrom(state(shelved), offerAgain("j_1"));
    expect(eventData(d, "job.rung_moved")).toEqual({ from: 1, to: 0, reason: "desk" });
    expect(types(d)).toContain("offer.wave_sent");
  });
});
