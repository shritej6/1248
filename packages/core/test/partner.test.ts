import type { Actor, PartnerRecord } from "@vision/contracts";
import { describe, expect, it } from "vitest";
import partnersFile from "../../../data/synthetic/partners.json" with { type: "json" };
import {
  consentAskView,
  emptyState,
  evolve,
  holderOf,
  partnerDeadlines,
  partnerView,
  sealEvent,
  type HubState,
  type PartnerVault,
} from "../src/index.js";
import {
  BASE_NOW,
  addJob,
  approve,
  confirm,
  ctx,
  effects,
  eventData,
  offerAgain,
  pass,
  playbook,
  reject,
  run,
  runFrom,
  sortResult,
  state,
  stateWithLevel,
  submit,
  types,
  type AnyCommand,
  type Run,
  type Step,
} from "./helpers.js";

const PANTRY = "p_pantry";
const RIDES = "p_rides";
const FOOD = "Meal Programs / Pantry";
const RIDES_SERVICE = "Transportation Service";

const DESK: Actor = { role: "desk", ref: "m_d01" };
const LEAD: Actor = { role: "lead", ref: "m_l01" };
const SYSTEM: Actor = { role: "system", ref: null };
const resident = (card: string): Actor => ({ role: "resident", ref: card });
const partnerActor = (partner: string): Actor => ({ role: "partner", ref: partner });

let counter = 0;
const id = (): string => {
  counter += 1;
  return `cmd_p${String(counter)}`;
};
const as = (command: AnyCommand, actor: Actor, offset = 0): Step => ({ command, actor, offset });

const nextRung = (job: string): Step => as({ id: id(), type: "job.next_rung", job }, DESK);
const consent = (job: string, answer: "yes" | "no", card = "c_1"): Step =>
  as({ id: id(), type: "consent.answer", job, answer }, resident(card));
type AnswerLine = { reason?: string; waitUntil?: number };
const askAnswer = (
  job: string,
  answer: "yes" | "no" | "wait",
  partner = PANTRY,
  extra: AnswerLine = {},
): Step => as({ id: id(), type: "ask.answer", job, answer, ...extra }, partnerActor(partner));
const promiseAccept = (partner: string): Step =>
  as({ id: id(), type: "promise.accept" }, partnerActor(partner));
const gotIt = (job: string, date: string, contactName: string, partner = PANTRY): Step =>
  as({ id: id(), type: "handover.got_it", job, date, contactName }, partnerActor(partner));

const foodPass = (service = FOOD) => pass("low", "", { service });

const confirmedFood = (options: { safeContact?: boolean } = {}): Step[] => [
  submit("c_1", "We have no food in the house this week", options),
  sortResult("c_1", [foodPass(), foodPass()]),
  confirm("c_1", "food", "low", { as: options.safeContact === false ? "lead" : "desk" }),
];
const consentAsked = (): Step[] => [...confirmedFood(), approve("j_1")];
const partnerAsked = (): Step[] => [...consentAsked(), consent("j_1", "yes")];
const partnerYes = (): Step[] => [...partnerAsked(), askAnswer("j_1", "yes")];
const gotItFood = (): Step[] => [
  ...partnerYes(),
  promiseAccept(PANTRY),
  gotIt("j_1", "2026-11-22", "Jordan (test)"),
];

const ridesAsked = (card: string, job: string): Step[] => [
  submit(card, "I need a ride to the clinic on Monday"),
  sortResult(card, [foodPass(RIDES_SERVICE), foodPass(RIDES_SERVICE)]),
  confirm(card, "rides", "low"),
  nextRung(job),
  consent(job, "yes", card),
];

const partners: PartnerRecord[] = [
  { id: PANTRY, name: partnersFile[0]?.name ?? "" },
  { id: RIDES, name: partnersFile[1]?.name ?? "" },
];
const viewCtx = { now: BASE_NOW, playbook, partners, forgetDays: 90, orgName: "Test Group demo" };
const HOUR = 3_600_000;

const vaultOf = (d: Run): PartnerVault => ({
  person: (card) => {
    const found = d.effects.find((e) => e.kind === "vault.person" && e.card === card);
    return found?.kind === "vault.person"
      ? { firstName: found.firstName, contact: found.contact, address: found.address }
      : null;
  },
});
const emptyVault: PartnerVault = { person: () => null };

const applyLines = (from: HubState, lines: { type: string; job: string; data: object }[]): HubState =>
  lines.reduce(
    (s, line) =>
      evolve(
        s,
        sealEvent(
          { card: "c_1", job: line.job, actor: SYSTEM, type: line.type, data: line.data } as never,
          s.seq + 1,
          BASE_NOW,
          s.lastHash,
        ),
      ),
    from,
  );

const checkbackAnswered = (from: HubState, job: string, answer: 1 | 2 | 3): HubState =>
  applyLines(from, [
    { type: "checkback.sent", job, data: { try: 1 } },
    { type: "checkback.answered", job, data: { answer } },
    { type: "job.closed", job, data: { result: "helped", reason: null } },
  ]);

const fireAfter = (d: Run, ms: number): Run => {
  const now = BASE_NOW + ms;
  const due = partnerDeadlines(d.state, playbook).filter((x) => x.at <= now);
  const next = runFrom(d.state, ...due.map((deadline) => as({ type: "timer.fired", deadline }, SYSTEM, ms)));
  return { ...next, events: [...d.events, ...next.events], effects: [...d.effects, ...next.effects] };
};

describe("partner rung start", () => {
  it("a partner rung asks the person first", () => {
    const d = run(...consentAsked());
    expect(eventData(d, "consent.asked")).toEqual({ partner: PANTRY });
    expect(effects(d).find((e) => e.kind === "message" && e.template !== "receipt")).toMatchObject({
      to: "resident",
      template: "consent_ask",
      partner: PANTRY,
    });
  });

  it("a card with no safe contact gets a call task for the desk and no message", () => {
    const d = run(...confirmedFood({ safeContact: false }), approve("j_1", { as: "lead" }));
    expect(eventData(d, "job.flagged")).toEqual({ flag: "consent_call" });
    expect(effects(d).filter((e) => e.kind === "message")).toHaveLength(0);
  });
});

describe("consent from the person", () => {
  it("no from the person moves to the next rung", () => {
    expect(eventData(run(...consentAsked(), consent("j_1", "no")), "job.rung_moved")).toMatchObject({
      reason: "no",
      to: 1,
    });
  });

  it("yes from the person asks the partner by a link and a fixed message", () => {
    const d = run(...partnerAsked());
    expect(eventData(d, "partner.asked")).toEqual({ partner: PANTRY });
    expect(effects(d)).toEqual(
      expect.arrayContaining([
        { kind: "partner_link", job: "j_1", partner: PANTRY },
        expect.objectContaining({ kind: "message", to: "partner", template: "partner_ask" }),
      ]),
    );
  });

  it("a resident link for another card cannot answer", () => {
    expect(reject(consent("j_1", "yes", "c_9"), consentAsked())).toBe("forbidden");
  });
});

describe("the partner card and the hand-over", () => {
  it("the partner sees the ask without the promise, and the note only after promise, consent and yes", () => {
    const d1 = run(...partnerAsked());
    expect(partnerView(state(d1), vaultOf(d1), viewCtx, PANTRY, "j_1")).toMatchObject({
      state: "ask",
      note: null,
    });
    const d2 = run(...partnerAsked(), askAnswer("j_1", "yes"));
    expect(partnerView(state(d2), vaultOf(d2), viewCtx, PANTRY, "j_1")).toMatchObject({
      state: "promise",
      note: null,
    });
    const d3 = run(...partnerAsked(), askAnswer("j_1", "yes"), promiseAccept(PANTRY));
    expect(partnerView(state(d3), vaultOf(d3), viewCtx, PANTRY, "j_1").note).toMatchObject({
      job: "j_1",
      gotIt: false,
      firstName: "Tess",
      zip: "53216",
      contact: "tess@example.test",
    });
  });

  it("another partner sees only a closed card", () => {
    const d = run(...partnerAsked());
    expect(partnerView(state(d), vaultOf(d), viewCtx, RIDES, "j_1").state).toBe("closed");
  });
});

describe("the hand-over", () => {
  it("got it makes the partner the holder and tells the person who has it", () => {
    const d = run(...gotItFood());
    expect(holderOf(state(d), "j_1", ctx)).toEqual({ kind: "partner", partner: PANTRY });
    expect(effects(d).find((e) => e.kind === "message" && e.template === "partner_has_it")).toBeDefined();
    expect(JSON.stringify(d.events)).not.toContain("Jordan");
    expect(partnerView(state(d), vaultOf(d), viewCtx, PANTRY, "j_1").note).toMatchObject({ gotIt: true });
  });

  it("got it before the promise is refused", () => {
    expect(reject(gotIt("j_1", "2026-11-22", "Jordan (test)"), partnerYes())).toBe("wrong_state");
  });

  it("a partner that was not asked cannot answer", () => {
    expect(reject(askAnswer("j_1", "yes", RIDES), partnerAsked())).toBe("forbidden");
  });

  it("wait from the partner moves the job on", () => {
    expect(eventData(run(...partnerAsked(), askAnswer("j_1", "wait")), "job.rung_moved")).toMatchObject({
      reason: "wait",
      from: 0,
      to: 1,
    });
  });
});

describe("partner clocks and the ladder", () => {
  it("partner silence for the reply time moves the job on, and the last rung is unmet", () => {
    const d = fireAfter(run(...ridesAsked("c_1", "j_1")), 120 * 60_000);
    expect(types(d)).toEqual(expect.arrayContaining(["job.rung_moved", "job.unmet"]));
    expect(eventData(d, "job.rung_moved")).toMatchObject({ reason: "silence" });
    expect(state(d).jobs["j_1"]?.status).toBe("unmet");
  });

  it("partner silence before the reply time does nothing", () => {
    const d = fireAfter(run(...ridesAsked("c_1", "j_1")), 119 * 60_000);
    expect(types(d).filter((t) => t === "job.rung_moved")).toHaveLength(1);
  });

  it("no consent answer for 24 hours gives the desk a call task", () => {
    const d = fireAfter(run(...consentAsked()), 24 * 3_600_000);
    expect(eventData(d, "job.flagged")).toEqual({ flag: "consent_call" });
  });

  it("no got it for 24 hours after yes moves the job on", () => {
    const d = fireAfter(run(...partnerYes(), promiseAccept(PANTRY)), 24 * 3_600_000);
    expect(eventData(d, "job.rung_moved")).toMatchObject({ reason: "silence", to: 1 });
  });

  it("the desk can move a job to the next rung", () => {
    const d = run(...confirmedFood(), nextRung("j_1"));
    expect(eventData(d, "job.rung_moved")).toMatchObject({ reason: "desk", from: 0, to: 1 });
  });
});

describe("the partner result and the tracking question", () => {
  it("after the check-back the partner sees the result and only its own counts", () => {
    const d = run(...gotItFood(), ...ridesAsked("c_2", "j_2"));
    const s = checkbackAnswered(state(d), "j_1", 1);
    expect(partnerView(s, vaultOf(d), viewCtx, PANTRY, "j_1")).toMatchObject({
      state: "result",
      result: { status: "helped", counts: { asked: 1, yes: 1, gotIt: 1, helped: 1 } },
    });
  });

  it("closed_job_shows_closed_only on the partner card", () => {
    const s = checkbackAnswered(state(run(...gotItFood())), "j_1", 1);
    expect(partnerView(s, emptyVault, viewCtx, PANTRY, "j_1")).toMatchObject({
      state: "closed",
      ask: null,
      note: null,
      result: null,
    });
  });

  it("the tracking page shows the consent question with the partner name", () => {
    expect(consentAskView(state(run(...consentAsked())), viewCtx, "c_1")).toEqual({
      job: "j_1",
      partnerName: partners[0]?.name,
      needLabel: "Food from a pantry",
    });
    expect(consentAskView(state(run(...partnerAsked())), viewCtx, "c_1")).toBeNull();
  });

  it("an empty state has no partner deadlines", () => {
    expect(partnerDeadlines(emptyState(), playbook)).toEqual([]);
  });
});

describe("a quiet or level 3 job on the partner ladder waits for the lead", () => {
  const level3 = stateWithLevel("food", 3);
  const level3Asked = (): Step[] => [
    submit("c_1", "We have no food in the house this week"),
    sortResult("c_1", [foodPass(), foodPass()]),
    confirm("c_1", "food", "low", { as: "lead" }),
    approve("j_1", { as: "lead" }),
  ];
  const quietAsked = (): Step[] => [...confirmedFood({ safeContact: false }), approve("j_1", { as: "lead" })];
  const deskConsent = (answer: "yes" | "no"): Step =>
    as({ id: id(), type: "consent.answer", job: "j_1", answer }, DESK);
  const leadConsent = (answer: "yes" | "no"): Step =>
    as({ id: id(), type: "consent.answer", job: "j_1", answer }, LEAD);

  it("a partner No on a level 3 job moves the rung but sends no wave until the lead says so", () => {
    const d = runFrom(level3, ...level3Asked(), consent("j_1", "yes"), askAnswer("j_1", "no"));
    expect(eventData(d, "job.rung_moved")).toMatchObject({ reason: "no", to: 1 });
    expect(types(d)).not.toContain("offer.wave_sent");
    expect(effects(d).filter((e) => e.kind === "offer")).toEqual([]);
    expect(state(d).jobs["j_1"]).toMatchObject({ status: "planned", rung: 1 });
    expect(types(runFrom(state(d), offerAgain("j_1", { as: "lead" })))).toContain("offer.wave_sent");
  });

  it("a resident No on a quiet job sends no wave, a lead No does", () => {
    const d = run(...quietAsked(), leadConsent("no"));
    expect(eventData(d, "job.rung_moved")).toMatchObject({ reason: "no", to: 1 });
    expect(types(d)).toContain("offer.wave_sent");
    const r = run(...quietAsked(), consent("j_1", "no"));
    expect(eventData(r, "job.rung_moved")).toMatchObject({ reason: "no", to: 1 });
    expect(types(r)).not.toContain("offer.wave_sent");
  });

  it("the desk cannot answer the sharing question on a quiet or level 3 job, the lead can", () => {
    expect(reject(deskConsent("yes"), quietAsked())).toBe("forbidden");
    expect(runFrom(level3, ...level3Asked(), deskConsent("yes")).rejections).toEqual(["forbidden"]);
    expect(reject(leadConsent("yes"), quietAsked())).toBeUndefined();
  });
});

describe("the partner card header and footer", () => {
  it("the card carries the route code and closes at the end of the open step", () => {
    const asked = run(...partnerAsked());
    const askCard = partnerView(state(asked), vaultOf(asked), viewCtx, PANTRY, "j_1");
    expect(askCard).toMatchObject({ routeCode: "FOOD-16-001", closesAt: askCard.ask?.deadline });
    const promised = run(...partnerYes());
    const promiseCard = partnerView(state(promised), vaultOf(promised), viewCtx, PANTRY, "j_1");
    expect(promiseCard).toMatchObject({ routeCode: "FOOD-16-001", closesAt: BASE_NOW + 24 * HOUR });
    const noted = run(...partnerYes(), promiseAccept(PANTRY));
    expect(partnerView(state(noted), vaultOf(noted), viewCtx, PANTRY, "j_1").closesAt).toBe(
      BASE_NOW + 24 * HOUR,
    );
  });

  it("after GOT IT the close date waits for the check-back, then it is the forget date", () => {
    const d = run(...gotItFood());
    expect(partnerView(state(d), vaultOf(d), viewCtx, PANTRY, "j_1").closesAt).toBeNull();
    const s = checkbackAnswered(state(d), "j_1", 1);
    expect(partnerView(s, vaultOf(d), viewCtx, PANTRY, "j_1")).toMatchObject({
      state: "result",
      routeCode: "FOOD-16-001",
      closesAt: BASE_NOW + 90 * 24 * HOUR,
    });
  });

  it("a closed card has no route code and no close date", () => {
    const d = run(...partnerAsked());
    expect(partnerView(state(d), vaultOf(d), viewCtx, RIDES, "j_1")).toMatchObject({
      routeCode: null,
      closesAt: null,
    });
  });
});

describe("the partner card close date on a card with two needs", () => {
  it("on a card with two needs the close date is the forget date of the whole card", () => {
    const d = run(...gotItFood(), addJob("c_1", "rides"));
    const partnerDone = checkbackAnswered(state(d), "j_1", 1);
    expect(partnerView(partnerDone, vaultOf(d), viewCtx, PANTRY, "j_1")).toMatchObject({
      state: "result",
      closesAt: null,
    });
    const later = BASE_NOW + 5 * 24 * HOUR;
    const draft = {
      card: "c_1",
      job: "j_2",
      actor: SYSTEM,
      type: "job.closed" as const,
      data: { result: "withdrawn" as const, reason: null },
    };
    const allDone = evolve(partnerDone, sealEvent(draft, partnerDone.seq + 1, later, partnerDone.lastHash));
    expect(partnerView(allDone, vaultOf(d), viewCtx, PANTRY, "j_1").closesAt).toBe(later + 90 * 24 * HOUR);
  });
});

describe("the partner answer line", () => {
  it("the reason goes to the vault for the desk and never to the ledger", () => {
    const reason = "Our pantry is closed for the holiday";
    const d = run(...partnerAsked(), askAnswer("j_1", "no", PANTRY, { reason }));
    expect(effects(d)).toContainEqual({
      kind: "vault.text",
      card: "c_1",
      job: "j_1",
      textKind: "partner_reason",
      text: reason,
    });
    expect(JSON.stringify(d.events)).not.toContain("holiday");
  });

  it("a wait keeps the time to ask again in the ledger", () => {
    const waitUntil = BASE_NOW + 48 * HOUR;
    const d = run(...partnerAsked(), askAnswer("j_1", "wait", PANTRY, { waitUntil }));
    expect(eventData(d, "partner.answered")).toEqual({ partner: PANTRY, answer: "wait", waitUntil });
  });

  it("a time is refused on yes or no and when it is not after now", () => {
    const later = BASE_NOW + HOUR;
    expect(reject(askAnswer("j_1", "no", PANTRY, { waitUntil: later }), partnerAsked())).toBe("invalid");
    expect(reject(askAnswer("j_1", "wait", PANTRY, { waitUntil: BASE_NOW }), partnerAsked())).toBe("invalid");
  });
});
