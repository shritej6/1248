import type {
  Actor,
  DecideContext,
  Deadline,
  DeadlineKind,
  Decision,
  EventDraft,
  JobStatus,
} from "@vision/contracts";
import { CHECKBACK_TRIES } from "../clocks.js";
import { isClosed } from "../holder.js";
import type { HubState, JobState } from "../state.js";
import { labelOf, line, mayMessage, toResident } from "./ladder.js";
import { leadGuard, offerAgain, startPath, withLines } from "./plan.js";
import {
  NO_LINES,
  allow,
  refuse,
  type CommandOf,
  type Handler,
  type Handlers,
  type Lines,
} from "./result.js";

type Answer = 1 | 2 | 3;
type Try = 1 | 2 | 3;

export const CLOSE_KINDS: readonly DeadlineKind[] = ["checkback", "checkback_reply"];
const KEYED: readonly JobStatus[] = ["done", "got_it"];

const findJob = (state: HubState, id: string): JobState | Decision =>
  state.jobs[id] ?? refuse("not_found", "This job is not on the board.");

const isJob = (found: JobState | Decision): found is JobState => "card" in found;

const clearCall = (job: JobState, actor: Actor): EventDraft[] =>
  job.flags.includes("checkback_call")
    ? [line(job, actor, { type: "job.flag_cleared", data: { flag: "checkback_call" } })]
    : [];

const closeLine = (job: JobState, actor: Actor, result: "helped" | "unreached"): EventDraft =>
  line(job, actor, { type: "job.closed", data: { result, reason: null } });

const answerLines = (job: JobState, answer: Answer, actor: Actor): EventDraft => {
  if (answer === 1) return closeLine(job, actor, "helped");
  if (answer === 2) return line(job, actor, { type: "job.reopened", data: { as: "partly", exclude: null } });
  const exclude = job.status === "done" ? job.holderRef : null;
  return line(job, actor, { type: "job.reopened", data: { as: "mismatch", exclude } });
};

const checkbackAnswer: Handler<CommandOf<"checkback.answer">> = (state, c, actor) => {
  const job = findJob(state, c.job);
  if (!isJob(job)) return job;
  if (actor.role === "resident" && actor.ref !== job.card)
    return refuse("forbidden", "This link is for another request.");
  const guard = actor.role === "resident" ? null : leadGuard(job, actor);
  if (guard) return guard;
  if (!KEYED.includes(job.status) || job.checkback === null)
    return refuse("wrong_state", "No check-back question is open for this job.");
  return allow({
    events: [
      line(job, actor, { type: "checkback.answered", data: { answer: c.answer } }),
      ...clearCall(job, actor),
      answerLines(job, c.answer, actor),
    ],
    effects: [],
  });
};

const openJob = (state: HubState, id: string, actor: Actor): JobState | Decision => {
  const job = findJob(state, id);
  if (!isJob(job)) return job;
  if (isClosed(job.status)) return refuse("wrong_state", "This job is already closed.");
  return leadGuard(job, actor) ?? job;
};

const withdraw: Handler<CommandOf<"job.withdraw">> = (state, c, actor, ctx) => {
  const job = openJob(state, c.job, actor);
  if (!isJob(job)) return job;
  const offered = job.status === "offered" ? (ctx.offered[job.id] ?? []) : [];
  return allow({
    events: [line(job, actor, { type: "job.closed", data: { result: "withdrawn", reason: c.reason } })],
    effects:
      offered.length === 0
        ? []
        : [{ kind: "offer_closed", job: job.id, members: offered, reason: "expired" }],
  });
};

const clearFlag: Handler<CommandOf<"job.clear_flag">> = (state, c, actor) => {
  const job = openJob(state, c.job, actor);
  if (!isJob(job)) return job;
  if (!job.flags.includes(c.flag)) return refuse("wrong_state", "This job does not have that flag.");
  return allow({
    events: [line(job, actor, { type: "job.flag_cleared", data: { flag: c.flag } })],
    effects: [],
  });
};

const restartLadder = (state: HubState, job: JobState, actor: Actor, ctx: DecideContext): Decision => {
  const guard = leadGuard(job, actor);
  if (guard) return guard;
  const moved: Lines = {
    events: [line(job, actor, { type: "job.rung_moved", data: { from: job.rung, to: 0, reason: "desk" } })],
    effects: [],
  };
  const top: JobState = { ...job, status: "planned", rung: 0, partner: null };
  return withLines(moved, startPath(state, top, ctx, actor));
};

const offerAgainFromShelf: Handler<CommandOf<"job.offer_again">> = (state, c, actor, ctx) => {
  const job = state.jobs[c.job];
  if (job?.status === "unmet") return restartLadder(state, job, actor, ctx);
  return offerAgain(state, c, actor, ctx);
};

const deadlineOf = (job: JobState): Deadline | null => {
  if (!KEYED.includes(job.status) || job.checkback === null) return null;
  const { dueAt, tries, sentAt } = job.checkback;
  const kind = sentAt === null ? "checkback" : "checkback_reply";
  return { kind, at: dueAt, card: job.card, job: job.id, page: null, step: tries };
};

export const closeDeadlines = (state: HubState): Deadline[] =>
  Object.values(state.jobs).flatMap((job) => {
    const deadline = deadlineOf(job);
    return deadline === null ? [] : [deadline];
  });

const askAgain = (state: HubState, job: JobState, next: Try, actor: Actor, ctx: DecideContext): Lines => {
  const sent = line(job, actor, { type: "checkback.sent", data: { try: next } });
  if (mayMessage(state, job)) {
    const slots = { needLabel: labelOf(ctx.playbook, job) };
    return { events: [sent], effects: [toResident(job, "checkback", null, slots)] };
  }
  const flag: EventDraft[] = job.flags.includes("checkback_call")
    ? []
    : [line(job, actor, { type: "job.flagged", data: { flag: "checkback_call" } })];
  return { events: [sent, ...flag], effects: [] };
};

export const fireCloseTimer = (
  state: HubState,
  deadline: Deadline,
  actor: Actor,
  ctx: DecideContext,
): Decision => {
  const job = deadline.job === null ? undefined : state.jobs[deadline.job];
  const current = job === undefined ? null : deadlineOf(job);
  const holds =
    current !== null &&
    current.kind === deadline.kind &&
    current.step === deadline.step &&
    current.at === deadline.at;
  if (job === undefined || current === null || !holds || deadline.at > ctx.now) return allow(NO_LINES);
  if (current.step >= CHECKBACK_TRIES)
    return allow({ events: [...clearCall(job, actor), closeLine(job, actor, "unreached")], effects: [] });
  return allow(askAgain(state, job, (current.step + 1) as Try, actor, ctx));
};

export const closeHandlers: Handlers = {
  "checkback.answer": checkbackAnswer,
  "job.withdraw": withdraw,
  "job.clear_flag": clearFlag,
  "job.offer_again": offerAgainFromShelf,
};
