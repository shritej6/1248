import { describe, expect, it } from "vitest";
import type {
  Actor,
  Config,
  Deadline,
  DecideContext,
  Decision,
  Effect,
  MemberPublic,
} from "@vision/contracts";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { CLOCKS } from "../src/clocks.js";
import { decide } from "../src/decide.js";
import { TimerBacklogError, dueDeadlines, nextDeadlineAt, runDue } from "../src/deadlines.js";
import { evolve } from "../src/evolve.js";
import { holderOf } from "../src/holder.js";
import { sealEvent } from "../src/seal.js";
import { emptyState, type HubState } from "../src/state.js";
import {
  BASE_NOW,
  acceptedSnow,
  approve,
  config,
  confirm,
  ctx,
  done,
  eventData,
  members,
  offeredSnow,
  onMyWay,
  pass,
  playbook,
  run,
  sortResult,
  state,
  submit,
  there,
  types,
  type AnyCommand,
  type CommandStep,
  type Run,
  type Step,
} from "./helpers.js";

type Advance = { advance: number };
type TimedStep = Step | Advance;
type TimerRun = Run & { firedKinds: Deadline[] };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const advance = (ms: number): Advance => ({ advance: ms });

const command = (body: AnyCommand, actor: Actor): CommandStep => ({ command: body, actor, offset: 0 });

let commandCount = 0;
const cmdId = (): string => {
  commandCount += 1;
  return `cmd_t${String(commandCount)}`;
};

const ORGANISER: Actor = { role: "organiser", ref: "m_o01" };

const jump = (minutes: 15 | 60 | 1440 | 4320): CommandStep =>
  command({ id: cmdId(), type: "clock.jump", minutes }, ORGANISER);

const takeShift = (member: string): CommandStep =>
  command({ id: cmdId(), type: "shift.take" }, { role: "desk", ref: member });

const answerPage = (page: string, member: string): CommandStep =>
  command({ id: cmdId(), type: "page.answer", page }, { role: "desk", ref: member });

const trackOffers = (offered: Record<string, string[]>, effect: Effect): void => {
  if (effect.kind === "offer") offered[effect.job] = [...(offered[effect.job] ?? []), ...effect.members];
  if (effect.kind === "offer_closed") offered[effect.job] = [];
};

type Runner = {
  out: TimerRun;
  now: number;
  people: MemberPublic[];
  messages: Record<string, string>;
  offered: Record<string, string[]>;
  context: (now: number) => DecideContext;
};

const makeRunner = (over: Partial<Config>): Runner => {
  const counters: Record<string, number> = {};
  const runner: Runner = {
    out: { events: [], effects: [], rejections: [], state: emptyState(), firedKinds: [] },
    now: BASE_NOW,
    people: members,
    messages: {},
    offered: {},
    context: (now) => ({
      now,
      newId: (prefix) => {
        counters[prefix] = (counters[prefix] ?? 0) + 1;
        return `${prefix}${String(counters[prefix])}`;
      },
      playbook,
      members: runner.people,
      offered: { ...runner.offered },
      zips: zipsFile,
      config: { ...config, ...over },
    }),
  };
  return runner;
};

const apply = (r: Runner, decision: Decision, at: number): HubState => {
  if (!decision.ok) {
    r.out.rejections.push(decision.rejection.code);
    return r.out.state;
  }
  for (const draft of decision.events) {
    const line = sealEvent(draft, r.out.state.seq + 1, at, r.out.state.lastHash);
    r.out.events.push(line);
    r.out.state = evolve(r.out.state, line);
  }
  decision.effects.forEach((effect) => {
    trackOffers(r.offered, effect);
  });
  r.out.effects.push(...decision.effects);
  return r.out.state;
};

const settle = (r: Runner): void => {
  r.out.state = runDue(r.out.state, r.context(r.now), r.now, (decision, at, deadline) => {
    r.out.firedKinds.push(deadline);
    return apply(r, decision, at);
  });
};

const runStep = (r: Runner, s: TimedStep): void => {
  if ("advance" in s) {
    r.now += s.advance;
    return;
  }
  if ("members" in s) {
    r.people = s.members;
    return;
  }
  const body = typeof s.command === "function" ? s.command(r.messages) : s.command;
  if (body.type === "request.submit") r.messages[body.card] = body.message;
  const decision = decide(r.out.state, body, s.actor, r.context(r.now));
  apply(r, decision, r.now);
  if (decision.ok && body.type === "clock.jump") r.now += body.minutes * MINUTE;
};

const runTimersWith = (over: Partial<Config>, ...steps: TimedStep[]): TimerRun => {
  const r = makeRunner(over);
  for (const s of steps) {
    runStep(r, s);
    if (!("members" in s)) settle(r);
  }
  return r.out;
};

const runTimers = (...steps: TimedStep[]): TimerRun => runTimersWith({}, ...steps);

const reject = (last: TimedStep, setup: TimedStep[], over: Partial<Config>) =>
  runTimersWith(over, ...setup, last).rejections.at(-1);

const pagedHigh = (card = "c_1"): Step[] => [submit(card), sortResult(card, [pass("high"), pass("high")])];

const wordListHitLow = (card = "c_1"): Step[] => [
  submit(card, "There was a fire in the kitchen last night and the walk needs shovelling"),
  sortResult(card, [pass("low"), pass("low")]),
];

const doneSnowAndPagedCard = (): Step[] => [
  ...acceptedSnow(),
  done("j_1", "m_v01", "done"),
  ...pagedHigh("c_2"),
];

const fullContext = (now: number): DecideContext => ({
  now,
  newId: (prefix) => `${prefix}x`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config,
});

describe("page clocks", () => {
  it("an unanswered page moves to the next person after 3 minutes", () => {
    const d = runTimers(...pagedHigh(), advance(3 * MINUTE));
    expect(eventData(d, "page.moved")).toMatchObject({ step: 1, to: "m_d02" });
    expect(d.effects.flatMap((e) => (e.kind === "page" ? [e.member] : []))).toEqual(["m_d01", "m_d02"]);
  });

  it("a page does not move before its 3 minutes are over", () => {
    expect(types(runTimers(...pagedHigh(), advance(3 * MINUTE - 1)))).not.toContain("page.moved");
  });

  it("the page list wraps around after the last person", () => {
    const step = advance(3 * MINUTE);
    const d = runTimers(...pagedHigh(), step, step, step, step);
    const moved = d.events.filter((e) => e.type === "page.moved").map((e) => e.data);
    expect(moved.map((m) => ("to" in m ? m.to : null))).toEqual(["m_d02", "m_o01", "m_l01", "m_d01"]);
  });

  it("a page left unanswered through a long wait moves once, to the person it is with now", () => {
    const d = runTimers(...pagedHigh(), advance(13 * MINUTE));
    const moved = d.events.filter((e) => e.type === "page.moved");
    expect(moved.map((e) => e.data)).toEqual([{ page: "pg_1", to: "m_d01", step: 4 }]);
    expect(moved[0]?.at).toBe(BASE_NOW + 12 * MINUTE);
    expect(d.effects.flatMap((e) => (e.kind === "page" ? [e.member] : []))).toEqual(["m_d01", "m_d01"]);
  });

  it("an answered page stops moving", () => {
    const d = runTimers(...pagedHigh(), answerPage("pg_1", "m_d01"), advance(30 * MINUTE));
    expect(types(d)).toContain("page.answered");
    expect(types(d)).not.toContain("page.moved");
    expect(state(d).pages["pg_1"]).toMatchObject({ answeredBy: "m_d01" });
  });

  it("a page answered twice is the wrong state, and an unknown page is not found", () => {
    expect(reject(answerPage("pg_1", "m_d02"), [...pagedHigh(), answerPage("pg_1", "m_d01")], {})).toBe(
      "wrong_state",
    );
    expect(reject(answerPage("pg_9", "m_d01"), pagedHigh(), {})).toBe("not_found");
  });
});

describe("who may answer a page", () => {
  it("a volunteer who was not paged cannot answer the page", () => {
    const volunteerAnswer = command(
      { id: cmdId(), type: "page.answer", page: "pg_1" },
      { role: "volunteer", ref: "m_v01" },
    );
    expect(reject(volunteerAnswer, pagedHigh(), {})).toBe("forbidden");
  });
});

describe("desk confirm clock", () => {
  it("a word list hit that nobody confirms pages the list after 15 minutes", () => {
    const early = runTimers(...wordListHitLow(), advance(CLOCKS.deskConfirm - 1));
    expect(types(early)).not.toContain("page.sent");
    const d = runTimers(...wordListHitLow(), advance(CLOCKS.deskConfirm));
    expect(eventData(d, "page.sent")).toMatchObject({ reason: "flag_timeout", step: 0 });
  });

  it("a card with no word list hit gets no desk confirm page", () => {
    const d = runTimers(submit("c_1"), sortResult("c_1", [pass("low"), pass("low")]), advance(HOUR));
    expect(types(d)).not.toContain("page.sent");
    expect(d.firedKinds.map((f) => f.kind)).not.toContain("desk_confirm");
  });
});

describe("wave clock", () => {
  it("a wave with no accept sends wave 2 after 5 minutes and returns to the desk after wave 3", () => {
    const d = runTimers(...offeredSnow(30), advance(5 * MINUTE), advance(5 * MINUTE), advance(5 * MINUTE));
    expect(d.events.filter((e) => e.type === "offer.wave_sent").map((e) => e.data)).toHaveLength(3);
    expect(eventData(d, "job.returned")).toEqual({ reason: "no_volunteer" });
    expect(eventData(d, "offer.closed")).toEqual({ reason: "no_volunteer" });
    const closed = d.effects.find((e) => e.kind === "offer_closed");
    expect(closed).toMatchObject({ job: "j_1", reason: "expired" });
    expect(closed?.kind === "offer_closed" ? closed.members : []).toHaveLength(30);
  });

  it("wave 2 goes to new volunteers only", () => {
    const d = runTimers(...offeredSnow(30), advance(5 * MINUTE));
    const offers = d.effects.flatMap((e) => (e.kind === "offer" ? [e.members] : []));
    expect(offers).toHaveLength(2);
    expect(offers[1]?.some((m) => offers[0]?.includes(m))).toBe(false);
  });

  it("a wave with nobody left closes the offers and returns the job", () => {
    const d = runTimers(...offeredSnow(2), advance(5 * MINUTE));
    expect(eventData(d, "job.returned")).toEqual({ reason: "no_volunteer" });
    expect(d.effects.find((e) => e.kind === "offer_closed")).toMatchObject({ members: ["m_v01", "m_v02"] });
  });
});

describe("claim and visit clocks", () => {
  it("an accept with no on my way for 2 hours returns the job", () => {
    expect(eventData(runTimers(...acceptedSnow(), advance(2 * HOUR)), "job.returned")).toEqual({
      reason: "claim_expired",
    });
  });

  it("on my way stops the claim clock", () => {
    const d = runTimers(...acceptedSnow(), onMyWay("j_1", "m_v01"), advance(5 * HOUR));
    expect(types(d)).not.toContain("job.returned");
  });

  it("an hour at the door with no done gives the desk a check task once", () => {
    const d = runTimers(...acceptedSnow(), there("j_1", "m_v01"), advance(CLOCKS.visit), advance(HOUR));
    expect(d.events.filter((e) => e.type === "job.flagged").map((e) => e.data)).toEqual([
      { flag: "visit_check" },
    ]);
  });
});

describe("clock jumps", () => {
  it("jump_fires_in_order: a 3 day jump fires each due timer once in due order", () => {
    const d = runTimers(...doneSnowAndPagedCard(), jump(4320));
    const fired = d.firedKinds;
    expect(fired.length).toBeGreaterThan(0);
    expect(fired).toEqual([...fired].sort((a, b) => a.at - b.at));
    expect(new Set(fired.map((f) => `${f.kind}:${f.job ?? f.page ?? ""}:${String(f.step)}`)).size).toBe(
      fired.length,
    );
    const now = BASE_NOW + 4320 * MINUTE;
    expect(dueDeadlines(state(d), fullContext(now), now)).toEqual([]);
    expect(nextDeadlineAt(state(d), fullContext(now))).toBeGreaterThan(now);
    expect(d.effects.filter((e) => e.kind === "page").length).toBeLessThanOrEqual(4);
  });

  it.each([
    ["at once", [] as TimedStep[]],
    ["a minute apart", [advance(MINUTE)]],
  ])("a 3 day jump with two unanswered pages sent %s clears every clock", (_label, gap) => {
    const d = runTimers(...pagedHigh("c_1"), ...gap, ...pagedHigh("c_2"), jump(4320));
    const now = BASE_NOW + 4320 * MINUTE;
    expect(dueDeadlines(state(d), fullContext(now), now)).toEqual([]);
    expect(nextDeadlineAt(state(d), fullContext(now))).toBeGreaterThan(now);
    expect(d.effects.filter((e) => e.kind === "page").length).toBeLessThanOrEqual(8);
  });

  it("each fired line carries the due time of its clock", () => {
    const d = runTimers(...offeredSnow(30), jump(60));
    const waves = d.events.filter((e) => e.type === "offer.wave_sent").map((e) => e.at - BASE_NOW);
    expect(waves).toEqual([0, 5 * MINUTE, 10 * MINUTE]);
  });
});

describe("check-back and partner clocks on the hub alarm", () => {
  it("a 3 day jump after DONE sends the check-back question", () => {
    const d = runTimers(...acceptedSnow(), done("j_1", "m_v01", "done"), jump(4320));
    expect(eventData(d, "checkback.sent")).toEqual({ try: 1 });
    expect(d.firedKinds.map((f) => f.kind)).toContain("checkback");
  });

  it("a day without a sharing answer gives the desk a call task", () => {
    const food = pass("low", "", { service: "Meal Programs / Pantry" });
    const d = runTimers(
      submit("c_1", "We have no food in the house this week"),
      sortResult("c_1", [food, food]),
      confirm("c_1", "food", "low"),
      approve("j_1"),
      jump(1440),
    );
    expect(eventData(d, "job.flagged")).toEqual({ flag: "consent_call" });
    expect(d.firedKinds.map((f) => f.kind)).toContain("consent");
  });
});

describe("the clock run limit", () => {
  it("a clock run that keeps finding new due clocks stops with a backlog error", () => {
    const s = state(run(...pagedHigh()));
    const now = BASE_NOW + HOUR;
    const bump = (h: HubState): HubState => {
      const page = h.pages["pg_1"];
      return page === undefined ? h : { ...h, pages: { ...h.pages, pg_1: { ...page, step: page.step + 1 } } };
    };
    let current = s;
    const loop = (): HubState =>
      runDue(s, fullContext(now), now, () => {
        current = bump(current);
        return current;
      });
    expect(loop).toThrow(TimerBacklogError);
  });

  it("a jump over several clocks fires them in due order and leaves the next one pending", () => {
    const d = runTimers(...offeredSnow(30, "c_1"), ...wordListHitLow("c_2"), jump(1440));
    const kinds = d.firedKinds.map((f) => f.kind);
    expect(kinds.slice(0, 4)).toEqual(["wave", "wave", "desk_confirm", "wave"]);
    expect(d.firedKinds).toEqual([...d.firedKinds].sort((a, b) => a.at - b.at));
    const now = BASE_NOW + 1440 * MINUTE;
    expect(dueDeadlines(state(d), fullContext(now), now)).toEqual([]);
    expect(nextDeadlineAt(state(d), fullContext(now))).toBeGreaterThan(now);
  });
});

describe("the timer command", () => {
  it("a timer whose condition no longer holds adds nothing", () => {
    const s = state(run(...acceptedSnow(), onMyWay("j_1", "m_v01")));
    const deadline: Deadline = {
      kind: "claim",
      at: BASE_NOW + CLOCKS.claim,
      card: "c_1",
      job: "j_1",
      page: null,
      step: 0,
    };
    const now = BASE_NOW + 3 * HOUR;
    const d = decide(s, { type: "timer.fired", deadline }, { role: "system", ref: null }, fullContext(now));
    expect(d).toEqual({ ok: true, events: [], effects: [] });
  });

  it("only the system fires a timer", () => {
    const s = state(run(...acceptedSnow()));
    const deadline: Deadline = {
      kind: "claim",
      at: BASE_NOW + CLOCKS.claim,
      card: "c_1",
      job: "j_1",
      page: null,
      step: 0,
    };
    const d = decide(s, { type: "timer.fired", deadline }, ORGANISER, fullContext(BASE_NOW + 3 * HOUR));
    expect(d).toMatchObject({ ok: false, rejection: { code: "forbidden" } });
  });
});

describe("demo clock", () => {
  it("clock jump is refused when demo mode is off", () => {
    expect(reject(jump(60), [], { demoMode: false })).toBe("demo_off");
  });

  it("a clock jump writes one ledger line with the jump in milliseconds", () => {
    const d = runTimers(jump(60));
    expect(eventData(d, "clock.jumped")).toEqual({ byMs: HOUR });
    expect(state(d).clockOffsetMs).toBe(HOUR);
  });

  it("only an organiser jumps the clock", () => {
    const d = runTimers(
      command({ id: cmdId(), type: "clock.jump", minutes: 60 }, { role: "desk", ref: "m_d01" }),
    );
    expect(d.rejections).toEqual(["forbidden"]);
  });
});

describe("shift", () => {
  it("taking the shift makes the new desk person the holder of every desk job", () => {
    const s = state(run(...offeredSnow(), takeShift("m_d02")));
    expect(holderOf(s, "j_1", ctx)).toEqual({ kind: "desk", member: "m_d02" });
    expect(s.deskOnShift).toBe("m_d02");
  });

  it("the person on shift is paged first", () => {
    const d = run(takeShift("m_d02"), ...pagedHigh());
    expect(eventData(d, "page.sent")).toMatchObject({ to: "m_d02" });
  });

  it("taking the shift you already hold is the wrong state", () => {
    expect(run(takeShift("m_d02"), takeShift("m_d02")).rejections).toEqual(["wrong_state"]);
  });
});

describe("next deadline", () => {
  it("nextDeadlineAt is the earliest pending deadline", () => {
    const s = state(run(...offeredSnow()));
    expect(nextDeadlineAt(s, fullContext(BASE_NOW))).toBe((s.jobs["j_1"]?.waveAt ?? 0) + 5 * MINUTE);
  });

  it("nextDeadlineAt is null when nothing waits", () => {
    expect(nextDeadlineAt(emptyState(), fullContext(BASE_NOW))).toBeNull();
  });
});
