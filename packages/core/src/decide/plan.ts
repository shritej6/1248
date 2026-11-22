import type { Actor, DecideContext, Decision, JobStatus, PlaybookRow } from "@vision/contracts";
import type { HubState, JobState } from "../state.js";
import { acceptBlock, openJobsByMember, pickWave } from "../wave.js";
import { startOtherRung } from "./ladder.js";
import { allow, join, refuse, type CommandOf, type Handlers, type Lines } from "./result.js";

export const AT_DESK: readonly JobStatus[] = ["planned", "mismatch", "partly"];

export const rowOf = (ctx: DecideContext, need: string): PlaybookRow | undefined =>
  ctx.playbook.rows.find((row) => row.need === need);

export const leadGuard = (job: JobState, actor: Actor): Decision | null =>
  (job.quiet || job.level === 3) && actor.role !== "lead"
    ? refuse("forbidden", "Only the lead may handle this job.")
    : null;

export const cardGuard = (state: HubState, cardId: string, actor: Actor): Decision | null => {
  const card = state.cards[cardId];
  if (card === undefined || actor.role === "lead") return null;
  const led = (job: JobState | undefined) => job !== undefined && (job.quiet || job.level === 3);
  return card.quiet || card.level === 3 || card.jobs.some((id) => led(state.jobs[id]))
    ? refuse("forbidden", "Only the lead may handle this request.")
    : null;
};

export const withLines = (before: Lines, decision: Decision): Decision =>
  decision.ok ? allow(join(before, { events: decision.events, effects: decision.effects })) : decision;

export const approvedLines = (job: JobState, actor: Actor): Lines =>
  job.approved
    ? { events: [], effects: [] }
    : { events: [{ card: job.card, job: job.id, actor, type: "job.approved", data: {} }], effects: [] };

export const sendWave = (
  state: HubState,
  job: JobState,
  ctx: DecideContext,
  wave: number,
  actor: Actor,
): Decision => {
  const card = state.cards[job.card];
  const row = rowOf(ctx, job.need);
  if (!card || !row) return refuse("not_found", "This job has no card or playbook row.");
  const picked = pickWave({
    job,
    card,
    row,
    members: ctx.members,
    offered: wave === 1 ? [] : (ctx.offered[job.id] ?? []),
    openJobs: openJobsByMember(state),
    zips: ctx.zips,
    size: ctx.config.waveSize,
  });
  const at = { card: job.card, job: job.id, actor };
  if (picked.length === 0) {
    return allow({
      events: [{ ...at, type: "job.returned", data: { reason: "no_volunteer" } }],
      effects: [],
    });
  }
  return allow({
    events: [{ ...at, type: "offer.wave_sent", data: { wave, count: picked.length } }],
    effects: [{ kind: "offer", job: job.id, members: picked }],
  });
};

export const startPath = (state: HubState, job: JobState, ctx: DecideContext, actor: Actor): Decision => {
  const rung = rowOf(ctx, job.need)?.ladder[job.rung];
  if (rung === undefined) return refuse("not_found", "This job has no path in the playbook.");
  if (rung.path === "volunteers") return sendWave(state, job, ctx, 1, actor);
  return allow(startOtherRung(state, job, rung, actor, ctx));
};

const findJob = (state: HubState, id: string, actor: Actor): JobState | Decision => {
  const job = state.jobs[id];
  if (!job) return refuse("not_found", "This job is not on the board.");
  return leadGuard(job, actor) ?? job;
};

const approve = (state: HubState, c: CommandOf<"job.approve">, actor: Actor, ctx: DecideContext) => {
  const job = findJob(state, c.job, actor);
  if ("ok" in job) return job;
  if (job.approved || job.status !== "planned")
    return refuse("wrong_state", "This plan is already approved.");
  return withLines(approvedLines(job, actor), startPath(state, job, ctx, actor));
};

export const offerAgain = (
  state: HubState,
  c: CommandOf<"job.offer_again">,
  actor: Actor,
  ctx: DecideContext,
) => {
  const job = findJob(state, c.job, actor);
  if ("ok" in job) return job;
  if (!job.approved || !AT_DESK.includes(job.status))
    return refuse("wrong_state", "Only an approved job that is back at the desk can go out again.");
  return startPath(state, job, ctx, actor);
};

const offerTo = (state: HubState, c: CommandOf<"job.offer_to">, actor: Actor, ctx: DecideContext) => {
  const job = findJob(state, c.job, actor);
  if ("ok" in job) return job;
  if (!AT_DESK.includes(job.status)) return refuse("wrong_state", "This job is not at the desk.");
  const member = ctx.members.find((m) => m.id === c.member);
  const row = rowOf(ctx, job.need);
  if (!member || !row) return refuse("not_found", "This member or need is not known.");
  const block = acceptBlock(member, job, row, openJobsByMember(state));
  if (block !== null) return refuse(block, "This member cannot take this job.");
  const at = { card: job.card, job: job.id, actor };
  return withLines(
    approvedLines(job, actor),
    allow({
      events: [{ ...at, type: "offer.wave_sent", data: { wave: 1, count: 1 } }],
      effects: [{ kind: "offer", job: job.id, members: [member.id] }],
    }),
  );
};

export const planHandlers: Handlers = {
  "job.approve": approve,
  "job.offer_again": offerAgain,
  "job.offer_to": offerTo,
};
