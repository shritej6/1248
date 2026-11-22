import type { Actor, DecideContext, Decision, Effect, JobStatus, Outcome } from "@vision/contracts";
import type { HubState, JobState } from "../state.js";
import { HELD_STATUSES } from "../wave.js";
import { pageCard } from "./intake.js";
import { tapAccept } from "./offers.js";
import { cardGuard, leadGuard, startPath } from "./plan.js";
import { allow, join, refuse, type CommandOf, type Handler, type Handlers, type Lines } from "./result.js";

type Tap = "on_my_way" | "there" | "done";
type Held = { job: JobState; member: string };

const TAP_FROM: Record<Tap, readonly JobStatus[]> = {
  on_my_way: ["accepted"],
  there: ["accepted", "on_my_way"],
  done: HELD_STATUSES,
};

const notHolder = (): Decision => refuse("forbidden", "Only the volunteer who holds this job can do this.");

const heldBy = (state: HubState, jobId: string, member: string | null): Held | Decision => {
  const job = state.jobs[jobId];
  if (!job) return refuse("not_found", "This job is not on the board.");
  if (member === null || job.holderRef !== member || !HELD_STATUSES.includes(job.status)) return notHolder();
  return { job, member };
};

const noteLines = (job: JobState, note: string | undefined): Lines => ({
  events: [],
  effects:
    note === undefined
      ? []
      : [{ kind: "vault.text", card: job.card, job: job.id, textKind: "note", text: note }],
});

const tapLines = (held: Held, tap: Tap, outcome: Outcome | undefined, actor: Actor): Decision => {
  const { job, member } = held;
  if (!TAP_FROM[tap].includes(job.status))
    return refuse("wrong_state", "This step does not fit the job now.");
  const at = { card: job.card, job: job.id, actor };
  if (tap === "on_my_way")
    return allow({ events: [{ ...at, type: "job.on_my_way", data: { member } }], effects: [] });
  if (tap === "there")
    return allow({ events: [{ ...at, type: "job.there", data: { member } }], effects: [] });
  if (outcome === undefined) return refuse("invalid", "Say what happened before you tap done.");
  const doneLine = { ...at, type: "job.done" as const, data: { member, outcome } };
  if (outcome !== "not_done") return allow({ events: [doneLine], effects: [] });
  return allow({
    events: [doneLine, { ...at, type: "job.returned", data: { reason: "not_done" } }],
    effects: [],
  });
};

const withNote = (decision: Decision, job: JobState, note: string | undefined): Decision =>
  decision.ok
    ? allow(join({ events: decision.events, effects: decision.effects }, noteLines(job, note)))
    : decision;

const volunteerTap =
  (tap: Exclude<Tap, "done">): Handler<CommandOf<"job.on_my_way" | "job.there">> =>
  (state, c, actor) => {
    const held = heldBy(state, c.job, actor.ref);
    return "ok" in held ? held : tapLines(held, tap, undefined, actor);
  };

const doneTap = (state: HubState, c: CommandOf<"job.done">, actor: Actor) => {
  const held = heldBy(state, c.job, actor.ref);
  if ("ok" in held) return held;
  return withNote(tapLines(held, "done", c.outcome, actor), held.job, c.note);
};

const help = (state: HubState, c: CommandOf<"job.help">, actor: Actor, ctx: DecideContext) => {
  const held = heldBy(state, c.job, actor.ref);
  if ("ok" in held) return held;
  const { job, member } = held;
  const helpLine: Lines = {
    events: [{ card: job.card, job: job.id, actor, type: "job.help", data: { member } }],
    effects: [],
  };
  return allow(join(helpLine, pageCard(state, ctx, job.card, "help", actor), noteLines(job, c.note)));
};

const handOff = (state: HubState, c: CommandOf<"job.hand_off">, actor: Actor, ctx: DecideContext) => {
  const held = heldBy(state, c.job, actor.ref);
  if ("ok" in held) return held;
  const { job, member } = held;
  const returned = join(
    {
      events: [{ card: job.card, job: job.id, actor, type: "job.returned", data: { reason: "hand_off" } }],
      effects: [],
    },
    noteLines(job, c.note),
  );
  const excluded = job.excluded.includes(member) ? job.excluded : [...job.excluded, member];
  const back: JobState = { ...job, status: "planned", holderRef: null, wave: 0, waveAt: null, excluded };
  const next = startPath(state, back, ctx, actor);
  return allow(next.ok ? join(returned, { events: next.events, effects: next.effects }) : returned);
};

const tapFor = (state: HubState, c: CommandOf<"job.tap_for">, actor: Actor, ctx: DecideContext) => {
  if (c.action === "accept") return tapAccept(state, c, actor, ctx);
  const job = state.jobs[c.job];
  if (!job) return refuse("not_found", "This job is not on the board.");
  const guard = leadGuard(job, actor);
  if (guard) return guard;
  const held = heldBy(state, c.job, c.member);
  return "ok" in held ? held : tapLines(held, c.action, c.outcome, actor);
};

const threadJob = (state: HubState, card: string, member: string | null): string | null =>
  Object.values(state.jobs).find(
    (j) => j.card === card && member !== null && j.holderRef === member && HELD_STATUSES.includes(j.status),
  )?.id ?? null;

const postThread = (state: HubState, c: CommandOf<"thread.post">, actor: Actor) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This card is not on the board.");
  const job = threadJob(state, card.id, actor.ref);
  if (actor.role === "volunteer" && job === null)
    return refuse("forbidden", "Only the holder of a job may write here.");
  const guard = actor.role === "volunteer" ? null : cardGuard(state, card.id, actor);
  if (guard) return guard;
  const effect: Effect = { kind: "vault.text", card: card.id, job, textKind: "note", text: c.text };
  return allow({
    events: [{ card: card.id, job, actor, type: "thread.posted", data: { byRole: actor.role } }],
    effects: [effect],
  });
};

export const visitHandlers: Handlers = {
  "job.on_my_way": volunteerTap("on_my_way"),
  "job.there": volunteerTap("there"),
  "job.done": doneTap,
  "job.help": help,
  "job.hand_off": handOff,
  "job.tap_for": tapFor,
  "thread.post": postThread,
};
