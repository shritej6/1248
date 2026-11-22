import {
  DIVISIONS,
  type Actor,
  type CoreCommand,
  type Division,
  type Effect,
  type LedgerEvent,
  type MemberPublic,
  type Playbook,
  type SystemCommand,
  type Urgency,
} from "@vision/contracts";
import { mayMessage } from "../decide/ladder.js";
import { needForService } from "../routecode.js";
import type { HubState, JobState } from "../state.js";
import { between, pick, type Rng } from "./rng.js";

export type RehearsalLabel = {
  id: string;
  door: string;
  ai: { service: string; division: string; urgency: Urgency };
  key: { service: string; urgency: Urgency };
};

export type Chances = {
  offerYes: number;
  partnerYes: number;
  gotIt: number;
  checkback: { yes: number; partly: number; no: number; silent: number };
};

export const DEFAULT_CHANCES: Chances = {
  offerYes: 0.16,
  partnerYes: 0.6,
  gotIt: 0.9,
  checkback: { yes: 0.8, partly: 0.1, no: 0.05, silent: 0.05 },
};

export const VOLUNTEERS = 40;
export const REHEARSAL_MESSAGE = "Rehearsal day request";

export type Planned = { at: number; command: CoreCommand | SystemCommand; actor: Actor };

export type World = {
  rng: Rng;
  playbook: Playbook;
  chances: Chances;
  labels: Readonly<Record<string, RehearsalLabel>>;
  desk: Actor;
  lead: Actor;
  cmd: () => string;
};

const MINUTE = 60_000;
const SYSTEM: Actor = { role: "system", ref: null };

export const inventVolunteers = (rng: Rng, playbook: Playbook, zips: readonly string[]): MemberPublic[] => {
  const skills = [...new Set(playbook.rows.map((row) => row.skill))];
  return Array.from({ length: VOLUNTEERS }, (_, i) => {
    const count = between(rng, 1, 3);
    const own = new Set<string>();
    for (let k = 0; k < count; k += 1) own.add(pick(rng, skills) ?? "");
    return {
      id: `m_rv${String(i + 1).padStart(2, "0")}`,
      roles: ["volunteer"],
      skills: [...own].filter((s) => s.length > 0).sort(),
      zip: pick(rng, zips) ?? null,
      on: true,
      lastJobAt: null,
    };
  });
};

const later = (w: World, at: number, min: number, max: number): number =>
  at + between(w.rng, min, max) * MINUTE;

const jobActor = (w: World, job: JobState): Actor => (job.quiet || job.level === 3 ? w.lead : w.desk);

const residentOr = (w: World, state: HubState, job: JobState): Actor =>
  mayMessage(state, job) ? { role: "resident", ref: job.card } : w.desk;

const sortReply = (w: World, e: LedgerEvent): Planned[] => {
  const label = e.card === null ? undefined : w.labels[e.card];
  if (e.card === null || label === undefined) return [];
  const pass = { ...label.ai, words: "", reason: "Saved answer from the sorter test" };
  const command = {
    type: "sort.result" as const,
    card: e.card,
    message: REHEARSAL_MESSAGE,
    passes: [pass, pass],
    error: null,
  };
  return [{ at: e.at + MINUTE, command, actor: SYSTEM }];
};

const divisionOf = (value: string): Division | null =>
  (DIVISIONS as readonly string[]).includes(value) ? (value as Division) : null;

const deskConfirm = (w: World, e: LedgerEvent): Planned[] => {
  const label = e.card === null ? undefined : w.labels[e.card];
  if (e.card === null || label === undefined) return [];
  const row = needForService(label.key.service, w.playbook);
  if (row === null) return [];
  const command = {
    type: "card.confirm" as const,
    id: w.cmd(),
    card: e.card,
    need: row.need,
    urgency: label.key.urgency,
    division: divisionOf(label.ai.division),
  };
  return [{ at: later(w, e.at, 2, 10), command, actor: row.quiet ? w.lead : w.desk }];
};

const pageReply = (w: World, e: LedgerEvent): Planned[] => {
  if (e.type !== "page.sent" && e.type !== "page.moved") return [];
  const actor: Actor = e.data.to === w.lead.ref ? w.lead : { role: "desk", ref: e.data.to };
  return [{ at: e.at + MINUTE, command: { type: "page.answer", id: w.cmd(), page: e.data.page }, actor }];
};

const volunteerActor = (job: JobState): Actor => ({ role: "volunteer", ref: job.holderRef });

const visitTap = (w: World, e: LedgerEvent, job: JobState): Planned[] => {
  const actor = volunteerActor(job);
  if (e.type === "offer.accepted")
    return [
      { at: later(w, e.at, 5, 20), command: { type: "job.on_my_way", id: w.cmd(), job: job.id }, actor },
    ];
  if (e.type === "job.on_my_way")
    return [{ at: later(w, e.at, 10, 30), command: { type: "job.there", id: w.cmd(), job: job.id }, actor }];
  const command = { type: "job.done" as const, id: w.cmd(), job: job.id, outcome: "done" as const };
  return [{ at: later(w, e.at, 20, 55), command, actor }];
};

const replyMinutes = (w: World, job: JobState): number => {
  const rung = w.playbook.rows.find((row) => row.need === job.need)?.ladder[job.rung];
  return rung?.path === "partner" ? rung.replyMinutes : 120;
};

const partnerReply = (
  w: World,
  state: HubState,
  e: LedgerEvent,
  job: JobState,
  partner: string,
): Planned[] => {
  const actor: Actor = { role: "partner", ref: partner };
  const at = e.at;
  const promise: Planned[] = state.promises.includes(partner)
    ? []
    : [{ at: at + 5 * MINUTE, command: { type: "promise.accept", id: w.cmd() }, actor }];
  const answer = w.rng() < w.chances.partnerYes ? ("yes" as const) : ("no" as const);
  const command = { type: "ask.answer" as const, id: w.cmd(), job: job.id, answer };
  return [...promise, { at: later(w, at, 15, Math.max(15, replyMinutes(w, job) - 5)), command, actor }];
};

const chicagoDate = (at: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(at));

const handOver = (w: World, e: LedgerEvent, job: JobState, partner: string): Planned[] => {
  if (w.rng() >= w.chances.gotIt) return [];
  const at = later(w, e.at, 60, 20 * 60);
  const command = {
    type: "handover.got_it" as const,
    id: w.cmd(),
    job: job.id,
    date: chicagoDate(at),
    contactName: "Rehearsal contact",
  };
  return [{ at, command, actor: { role: "partner", ref: partner } }];
};

const checkbackDraw = (w: World): 1 | 2 | 3 | null => {
  const { yes, partly, no } = w.chances.checkback;
  const r = w.rng();
  if (r < yes) return 1;
  if (r < yes + partly) return 2;
  return r < yes + partly + no ? 3 : null;
};

const checkbackReply = (w: World, state: HubState, e: LedgerEvent, job: JobState): Planned[] => {
  const answer = checkbackDraw(w);
  if (answer === null) return [];
  const command = { type: "checkback.answer" as const, id: w.cmd(), job: job.id, answer };
  return [{ at: later(w, e.at, 60, 12 * 60), command, actor: residentOr(w, state, job) }];
};

const deskBack = (w: World, e: LedgerEvent, job: JobState): Planned[] => {
  const nextRung = e.type === "job.returned" && e.data.reason === "no_volunteer";
  const command = nextRung
    ? { type: "job.next_rung" as const, id: w.cmd(), job: job.id }
    : { type: "job.offer_again" as const, id: w.cmd(), job: job.id };
  return [{ at: later(w, e.at, 5, 15), command, actor: jobActor(w, job) }];
};

const jobReaction = (w: World, state: HubState, e: LedgerEvent, job: JobState): Planned[] => {
  switch (e.type) {
    case "job.planned":
      return [
        {
          at: e.at + MINUTE,
          command: { type: "job.approve", id: w.cmd(), job: job.id },
          actor: jobActor(w, job),
        },
      ];
    case "offer.accepted":
    case "job.on_my_way":
    case "job.there":
      return visitTap(w, e, job);
    case "consent.asked": {
      const command = { type: "consent.answer" as const, id: w.cmd(), job: job.id, answer: "yes" as const };
      return [{ at: later(w, e.at, 30, 180), command, actor: residentOr(w, state, job) }];
    }
    case "partner.asked":
      return partnerReply(w, state, e, job, e.data.partner);
    case "partner.answered":
      return e.data.answer === "yes" ? handOver(w, e, job, e.data.partner) : [];
    case "checkback.sent":
      return checkbackReply(w, state, e, job);
    case "job.returned":
    case "job.reopened":
      return deskBack(w, e, job);
    default:
      return [];
  }
};

export const reactTo = (w: World, state: HubState, e: LedgerEvent): Planned[] => {
  if (e.type === "card.received") return sortReply(w, e);
  if (e.type === "card.sorted") return deskConfirm(w, e);
  if (e.type === "page.sent" || e.type === "page.moved") return pageReply(w, e);
  const job = e.job === null ? undefined : state.jobs[e.job];
  return job === undefined ? [] : jobReaction(w, state, e, job);
};

export const offerReplies = (w: World, effect: Effect, now: number): Planned[] => {
  if (effect.kind !== "offer") return [];
  return effect.members.flatMap((member) => {
    if (w.rng() >= w.chances.offerYes) return [];
    const command = { type: "offer.accept" as const, id: w.cmd(), job: effect.job };
    return [{ at: later(w, now, 0, 4), command, actor: { role: "volunteer", ref: member } }];
  });
};
