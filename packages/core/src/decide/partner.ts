import type {
  Actor,
  DecideContext,
  Deadline,
  DeadlineKind,
  Decision,
  Effect,
  EventDraft,
  JobStatus,
  Playbook,
  Rung,
} from "@vision/contracts";
import { CLOCKS } from "../clocks.js";
import type { HubState, JobState } from "../state.js";
import { labelOf, line, mayMessage, toResident } from "./ladder.js";
import { leadGuard, rowOf, startPath, withLines } from "./plan.js";
import {
  NO_LINES,
  allow,
  join,
  refuse,
  type CommandOf,
  type Handler,
  type Handlers,
  type Lines,
} from "./result.js";

type PartnerRung = Extract<Rung, { path: "partner" }>;
type RungReason = "no" | "wait" | "silence" | "desk";

const MINUTE = 60_000;
export const PARTNER_KINDS: readonly DeadlineKind[] = ["consent", "partner_reply", "got_it"];
const MOVABLE: readonly JobStatus[] = [
  "planned",
  "consent_asked",
  "partner_asked",
  "partner_yes",
  "mismatch",
  "partly",
];

const partnerRung = (playbook: Playbook, job: JobState): PartnerRung | null => {
  const rung = playbook.rows.find((row) => row.need === job.need)?.ladder[job.rung];
  return rung?.path === "partner" ? rung : null;
};

const clearCall = (job: JobState, actor: Actor): EventDraft[] =>
  job.flags.includes("consent_call")
    ? [line(job, actor, { type: "job.flag_cleared", data: { flag: "consent_call" } })]
    : [];

export const moveRung = (
  state: HubState,
  job: JobState,
  reason: RungReason,
  actor: Actor,
  ctx: DecideContext,
): Decision => {
  const to = job.rung + 1;
  const moved: Lines = {
    events: [
      ...clearCall(job, actor),
      line(job, actor, { type: "job.rung_moved", data: { from: job.rung, to, reason } }),
    ],
    effects: [],
  };
  const next = { ...job, rung: to, partner: null, flags: job.flags.filter((f) => f !== "consent_call") };
  const toVolunteers = rowOf(ctx, job.need)?.ladder[to]?.path === "volunteers";
  if (toVolunteers && leadGuard(job, actor) !== null) return allow(moved);
  return withLines(moved, startPath(state, next, ctx, actor));
};

const askPartner = (
  state: HubState,
  job: JobState,
  partner: string,
  actor: Actor,
  ctx: DecideContext,
): Lines => {
  const reply = partnerRung(ctx.playbook, job)?.replyMinutes ?? 120;
  const slots = {
    orgName: ctx.config.orgName,
    needLabel: labelOf(ctx.playbook, job),
    zip: state.cards[job.card]?.zip ?? "",
    deadline: String(ctx.now + reply * MINUTE),
  };
  return {
    events: [line(job, actor, { type: "partner.asked", data: { partner } })],
    effects: [
      { kind: "partner_link", job: job.id, partner },
      {
        kind: "message",
        to: "partner",
        card: job.card,
        job: job.id,
        partner,
        template: "partner_ask",
        slots,
      },
    ],
  };
};

const findJob = (state: HubState, id: string): JobState | Decision =>
  state.jobs[id] ?? refuse("not_found", "This job is not on the board.");

const isJob = (found: JobState | Decision): found is JobState => "card" in found;

const consentAnswer: Handler<CommandOf<"consent.answer">> = (state, c, actor, ctx) => {
  const job = findJob(state, c.job);
  if (!isJob(job)) return job;
  if (actor.role === "resident" && actor.ref !== job.card)
    return refuse("forbidden", "This link is for another request.");
  const guard = actor.role === "resident" ? null : leadGuard(job, actor);
  if (guard) return guard;
  if (job.status !== "consent_asked" || job.partner === null)
    return refuse("wrong_state", "No question about sharing is open.");
  const answered: Lines = {
    events: [
      line(job, actor, { type: "consent.answered", data: { answer: c.answer } }),
      ...clearCall(job, actor),
    ],
    effects: [],
  };
  if (c.answer === "no") return withLines(answered, moveRung(state, job, "no", actor, ctx));
  return allow(join(answered, askPartner(state, job, job.partner, actor, ctx)));
};

const partnerJob = (state: HubState, id: string, actor: Actor, status: JobStatus): JobState | Decision => {
  const job = findJob(state, id);
  if (!isJob(job)) return job;
  if (actor.ref === null || job.partner !== actor.ref)
    return refuse("forbidden", "This link is for another partner.");
  if (job.status !== status) return refuse("wrong_state", "This step is not open for this job.");
  return job;
};

type AskAnswer = CommandOf<"ask.answer">;

const waitError = (c: AskAnswer, now: number): Decision | null => {
  if (c.waitUntil === undefined) return null;
  if (c.answer !== "wait") return refuse("invalid", "A time goes only with Wait.");
  return c.waitUntil > now ? null : refuse("invalid", "Pick a time after now.");
};

const answeredLines = (job: JobState, partner: string, c: AskAnswer, actor: Actor): Lines => {
  const time = c.waitUntil === undefined ? {} : { waitUntil: c.waitUntil };
  const reason: Effect[] =
    c.reason === undefined
      ? []
      : [{ kind: "vault.text", card: job.card, job: job.id, textKind: "partner_reason", text: c.reason }];
  return {
    events: [line(job, actor, { type: "partner.answered", data: { partner, answer: c.answer, ...time } })],
    effects: reason,
  };
};

const askAnswer: Handler<AskAnswer> = (state, c, actor, ctx) => {
  const job = partnerJob(state, c.job, actor, "partner_asked");
  if (!isJob(job) || job.partner === null)
    return isJob(job) ? refuse("wrong_state", "No partner is asked.") : job;
  const invalid = waitError(c, ctx.now);
  if (invalid) return invalid;
  const answered = answeredLines(job, job.partner, c, actor);
  if (c.answer === "yes") return allow(answered);
  return withLines(answered, moveRung(state, job, c.answer, actor, ctx));
};

const promiseAccept: Handler<CommandOf<"promise.accept">> = (state, _c, actor) => {
  if (actor.ref === null) return refuse("forbidden", "This link has no partner.");
  if (state.promises.includes(actor.ref)) return refuse("wrong_state", "The promise is already accepted.");
  return allow({
    events: [{ card: null, job: null, actor, type: "promise.accepted", data: { partner: actor.ref } }],
    effects: [],
  });
};

const gotIt: Handler<CommandOf<"handover.got_it">> = (state, c, actor) => {
  const job = partnerJob(state, c.job, actor, "partner_yes");
  if (!isJob(job) || job.partner === null)
    return isJob(job) ? refuse("wrong_state", "No partner is asked.") : job;
  if (!state.promises.includes(job.partner)) return refuse("wrong_state", "Accept the promise first.");
  const slots = { contactName: c.contactName, routeCode: state.cards[job.card]?.routeCode ?? "" };
  const message = mayMessage(state, job) ? [toResident(job, "partner_has_it", job.partner, slots)] : [];
  return allow({
    events: [line(job, actor, { type: "job.got_it", data: { partner: job.partner, date: c.date } })],
    effects: [
      { kind: "vault.text", card: job.card, job: job.id, textKind: "contact_name", text: c.contactName },
      ...message,
    ],
  });
};

const nextRung: Handler<CommandOf<"job.next_rung">> = (state, c, actor, ctx) => {
  const job = findJob(state, c.job);
  if (!isJob(job)) return job;
  if (!MOVABLE.includes(job.status))
    return refuse("wrong_state", "This job cannot move to the next rung now.");
  const guard = leadGuard(job, actor);
  if (guard) return guard;
  const ladder = rowOf(ctx, job.need)?.ladder ?? [];
  if (job.rung >= ladder.length - 1) return refuse("wrong_state", "This job is on the last rung.");
  return moveRung(state, job, "desk", actor, ctx);
};

const deadlineOf = (job: JobState, playbook: Playbook): Deadline | null => {
  const base = { card: job.card, job: job.id, page: null, step: job.rung };
  if (job.status === "consent_asked" && job.askedAt !== null && !job.flags.includes("consent_call"))
    return { ...base, kind: "consent", at: job.askedAt + CLOCKS.consent };
  if (job.status === "partner_asked" && job.askedAt !== null) {
    const reply = partnerRung(playbook, job)?.replyMinutes ?? 120;
    return { ...base, kind: "partner_reply", at: job.askedAt + reply * MINUTE };
  }
  if (job.status === "partner_yes" && job.yesAt !== null)
    return { ...base, kind: "got_it", at: job.yesAt + CLOCKS.gotIt };
  return null;
};

export const partnerDeadlines = (state: HubState, playbook: Playbook): Deadline[] =>
  Object.values(state.jobs).flatMap((job) => {
    const deadline = deadlineOf(job, playbook);
    return deadline === null ? [] : [deadline];
  });

export const firePartnerTimer = (
  state: HubState,
  deadline: Deadline,
  actor: Actor,
  ctx: DecideContext,
): Decision => {
  const job = deadline.job === null ? undefined : state.jobs[deadline.job];
  const current = job === undefined ? null : deadlineOf(job, ctx.playbook);
  const holds =
    current !== null &&
    current.kind === deadline.kind &&
    current.step === deadline.step &&
    current.at === deadline.at;
  if (job === undefined || !holds || deadline.at > ctx.now) return allow(NO_LINES);
  if (deadline.kind === "consent") {
    return allow({
      events: [line(job, actor, { type: "job.flagged", data: { flag: "consent_call" } })],
      effects: [],
    });
  }
  return moveRung(state, job, "silence", actor, ctx);
};

export const partnerHandlers: Handlers = {
  "consent.answer": consentAnswer,
  "ask.answer": askAnswer,
  "promise.accept": promiseAccept,
  "handover.got_it": gotIt,
  "job.next_rung": nextRung,
};
