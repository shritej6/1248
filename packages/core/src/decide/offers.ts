import type { Actor, DecideContext, Decision, Effect } from "@vision/contracts";
import type { HubState, JobState } from "../state.js";
import { HELD_STATUSES, acceptBlock, crewOf, crewOpen, crewSize, openJobsByMember } from "../wave.js";
import { AT_DESK, approvedLines, leadGuard, rowOf, withLines } from "./plan.js";
import { allow, refuse, type CommandOf, type Handlers, type Lines } from "./result.js";

const notOffered = (job: JobState): Decision =>
  HELD_STATUSES.includes(job.status)
    ? refuse("taken", "Taken. Thank you.")
    : refuse("wrong_state", "This job is not offered now.");

const wasOffered = (ctx: DecideContext, job: JobState, member: string): boolean =>
  (ctx.offered[job.id] ?? []).includes(member);

const closedFor = (ctx: DecideContext, job: JobState, crew: readonly string[]): Effect[] => {
  const others = (ctx.offered[job.id] ?? []).filter((m) => !crew.includes(m));
  return others.length === 0 ? [] : [{ kind: "offer_closed", job: job.id, members: others, reason: "taken" }];
};

const acceptLines = (ctx: DecideContext, job: JobState, member: string, actor: Actor): Lines => {
  const at = { card: job.card, job: job.id, actor };
  const accepted = { ...at, type: "offer.accepted" as const, data: { member } };
  const crew = [...crewOf(job), member];
  const offerOpen = job.status === "offered" || crewOpen(ctx, job);
  if (!offerOpen || crew.length < crewSize(ctx, job)) return { events: [accepted], effects: [] };
  return {
    events: [accepted, { ...at, type: "offer.closed", data: { reason: "taken" } }],
    effects: closedFor(ctx, job, crew),
  };
};

const acceptFor = (
  state: HubState,
  ctx: DecideContext,
  job: JobState,
  memberId: string,
  actor: Actor,
): Decision => {
  const member = ctx.members.find((m) => m.id === memberId);
  const row = rowOf(ctx, job.need);
  if (!member || !row) return refuse("not_found", "This member or need is not known.");
  const block = acceptBlock(member, job, row, openJobsByMember(state));
  if (block !== null) return refuse(block, "This member cannot take this job.");
  return allow(acceptLines(ctx, job, member.id, actor));
};

const accept = (state: HubState, c: CommandOf<"offer.accept">, actor: Actor, ctx: DecideContext) => {
  const job = state.jobs[c.job];
  if (!job) return refuse("not_found", "This job is not on the board.");
  if (job.status !== "offered" && !crewOpen(ctx, job)) return notOffered(job);
  if (actor.ref === null) return refuse("forbidden", "Sign in to accept a job.");
  if (crewOf(job).includes(actor.ref)) return refuse("wrong_state", "You are already on this job.");
  if (!wasOffered(ctx, job, actor.ref)) return refuse("not_eligible", "This job was not offered to you.");
  return acceptFor(state, ctx, job, actor.ref, actor);
};

const passOffer = (state: HubState, c: CommandOf<"offer.pass">, actor: Actor, ctx: DecideContext) => {
  const job = state.jobs[c.job];
  if (!job) return refuse("not_found", "This job is not on the board.");
  if (job.status !== "offered" && !crewOpen(ctx, job)) return notOffered(job);
  if (actor.ref === null) return refuse("forbidden", "Sign in to pass on a job.");
  if (crewOf(job).includes(actor.ref)) return refuse("wrong_state", "You are already on this job.");
  if (!wasOffered(ctx, job, actor.ref)) return refuse("not_eligible", "This job was not offered to you.");
  return allow({ events: [], effects: [{ kind: "pass", job: job.id, member: actor.ref }] });
};

export const tapAccept = (state: HubState, c: CommandOf<"job.tap_for">, actor: Actor, ctx: DecideContext) => {
  const job = state.jobs[c.job];
  if (!job) return refuse("not_found", "This job is not on the board.");
  const guard = leadGuard(job, actor);
  if (guard) return guard;
  if (job.status !== "offered" && !AT_DESK.includes(job.status)) return notOffered(job);
  const before = job.status === "offered" ? { events: [], effects: [] } : approvedLines(job, actor);
  return withLines(before, acceptFor(state, ctx, job, c.member, actor));
};

export const offerHandlers: Handlers = {
  "offer.accept": accept,
  "offer.pass": passOffer,
};
