import {
  DeadlineKindSchema,
  type Actor,
  type DecideContext,
  type Decision,
  type Deadline,
  type DeadlineKind,
} from "@vision/contracts";
import { CLOCKS } from "../clocks.js";
import type { CardState, HubState, JobState, PageState } from "../state.js";
import { closeDeadlines } from "./close.js";
import { pageCard, pageOrder } from "./intake.js";
import { partnerDeadlines } from "./partner.js";
import { sendWave } from "./plan.js";
import { NO_LINES, allow, refuse, type CommandOf, type Handlers, type Lines } from "./result.js";

type Fire = (state: HubState, deadline: Deadline, actor: Actor, ctx: DecideContext) => Decision;

const KIND_ORDER: readonly DeadlineKind[] = DeadlineKindSchema.options;

const isPaged = (state: HubState, card: string): boolean =>
  Object.values(state.pages).some((page) => page.card === card);

const forCard = (card: CardState, at: number): Deadline => ({
  kind: "desk_confirm",
  at,
  card: card.id,
  job: null,
  page: null,
  step: 0,
});

const forJob = (kind: DeadlineKind, job: JobState, at: number, step = 0): Deadline => ({
  kind,
  at,
  card: job.card,
  job: job.id,
  page: null,
  step,
});

const forPage = (page: PageState): Deadline => ({
  kind: "page_answer",
  at: (page.movedAt ?? page.sentAt) + CLOCKS.pageAnswer,
  card: page.card,
  job: null,
  page: page.id,
  step: page.step,
});

const waitsForConfirm = (state: HubState, card: CardState): boolean =>
  card.sorted !== null &&
  card.confirmedAt === null &&
  card.sorted.flags.includes("word_list_hit") &&
  !isPaged(state, card.id);

const cardDeadlines = (state: HubState, ctx: DecideContext): Deadline[] => {
  if (pageOrder(state, ctx).length === 0) return [];
  const cards = Object.values(state.cards).filter((card) => waitsForConfirm(state, card));
  const pages = Object.values(state.pages).filter((page) => page.answeredAt === null);
  return [...cards.map((card) => forCard(card, card.receivedAt + CLOCKS.deskConfirm)), ...pages.map(forPage)];
};

const jobDeadline = (job: JobState): Deadline | null => {
  if (job.status === "offered" && job.waveAt !== null)
    return forJob("wave", job, job.waveAt + CLOCKS.waveWait, job.wave);
  if (job.status === "accepted" && job.acceptedAt !== null)
    return forJob("claim", job, job.acceptedAt + CLOCKS.claim);
  if (job.status === "there" && job.thereAt !== null && !job.flags.includes("visit_check"))
    return forJob("visit", job, job.thereAt + CLOCKS.visit);
  return null;
};

const byDue = (a: Deadline, b: Deadline): number => {
  const key = (d: Deadline): string => `${d.job ?? ""}|${d.page ?? ""}|${d.card}`;
  const tie = key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  return a.at - b.at || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.step - b.step || tie;
};

export const pendingDeadlines = (state: HubState, ctx: DecideContext): Deadline[] => {
  const jobs = Object.values(state.jobs).flatMap((job) => {
    const deadline = jobDeadline(job);
    return deadline === null ? [] : [deadline];
  });
  const ladder = [...partnerDeadlines(state, ctx.playbook), ...closeDeadlines(state)];
  return [...cardDeadlines(state, ctx), ...jobs, ...ladder].sort(byDue);
};

const sameDeadline = (a: Deadline, b: Deadline): boolean =>
  a.kind === b.kind &&
  a.at === b.at &&
  a.card === b.card &&
  a.job === b.job &&
  a.page === b.page &&
  a.step === b.step;

const movePage: Fire = (state, deadline, actor, ctx) => {
  const page = deadline.page === null ? undefined : state.pages[deadline.page];
  const order = pageOrder(state, ctx);
  const moves = Math.floor((ctx.now - deadline.at) / CLOCKS.pageAnswer) + 1;
  const to = order[(order.indexOf(page?.to ?? "") + moves) % order.length];
  if (page === undefined || to === undefined) return allow(NO_LINES);
  const step = page.step + moves;
  return allow({
    events: [{ card: page.card, job: null, actor, type: "page.moved", data: { page: page.id, to, step } }],
    effects: [{ kind: "page", page: page.id, member: to }],
  });
};

const confirmTimeout: Fire = (state, deadline, actor, ctx) =>
  allow(pageCard(state, ctx, deadline.card, "flag_timeout", actor));

const expireLines = (job: JobState, ctx: DecideContext, actor: Actor): Lines => {
  const at = { card: job.card, job: job.id, actor };
  const members = ctx.offered[job.id] ?? [];
  return {
    events: [
      { ...at, type: "offer.closed", data: { reason: "no_volunteer" } },
      { ...at, type: "job.returned", data: { reason: "no_volunteer" } },
    ],
    effects: members.length === 0 ? [] : [{ kind: "offer_closed", job: job.id, members, reason: "expired" }],
  };
};

const nextWave: Fire = (state, deadline, actor, ctx) => {
  const job = deadline.job === null ? undefined : state.jobs[deadline.job];
  if (job === undefined) return allow(NO_LINES);
  if (job.wave < ctx.config.maxWaves) {
    const wave = sendWave(state, job, ctx, job.wave + 1, actor);
    if (wave.ok && wave.events.some((e) => e.type === "offer.wave_sent")) return wave;
  }
  return allow(expireLines(job, ctx, actor));
};

const jobLine =
  (line: "claim" | "visit"): Fire =>
  (state, deadline, actor) => {
    const job = deadline.job === null ? undefined : state.jobs[deadline.job];
    if (job === undefined) return allow(NO_LINES);
    const at = { card: job.card, job: job.id, actor };
    const event =
      line === "claim"
        ? { ...at, type: "job.returned" as const, data: { reason: "claim_expired" as const } }
        : { ...at, type: "job.flagged" as const, data: { flag: "visit_check" as const } };
    return allow({ events: [event], effects: [] });
  };

const FIRE: Partial<Record<DeadlineKind, Fire>> = {
  desk_confirm: confirmTimeout,
  page_answer: movePage,
  wave: nextWave,
  claim: jobLine("claim"),
  visit: jobLine("visit"),
};

const timerFired = (state: HubState, c: CommandOf<"timer.fired">, actor: Actor, ctx: DecideContext) => {
  const { deadline } = c;
  if (deadline.at > ctx.now) return refuse("wrong_state", "This clock is not due yet.");
  const live = pendingDeadlines(state, ctx).some((pending) => sameDeadline(pending, deadline));
  const fire = FIRE[deadline.kind];
  return live && fire !== undefined ? fire(state, deadline, actor, ctx) : allow(NO_LINES);
};

export const timerHandlers: Handlers = {
  "timer.fired": timerFired,
};
