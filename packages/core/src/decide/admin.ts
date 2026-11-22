import type { Actor, DecideContext, Playbook } from "@vision/contracts";
import { isClosed } from "../holder.js";
import { hasEarned, levelOf, recordOf } from "../needrecord.js";
import type { HubState, JobState } from "../state.js";
import { allow, refuse, type CommandOf, type Handlers } from "./result.js";

const MINUTE = 60_000;

const takeShift = (state: HubState, _c: CommandOf<"shift.take">, actor: Actor) => {
  if (actor.ref === null) return refuse("forbidden", "Sign in to take the shift.");
  if (state.deskOnShift === actor.ref) return refuse("wrong_state", "You are already on shift.");
  return allow({
    events: [{ card: null, job: null, actor, type: "shift.taken", data: { member: actor.ref } }],
    effects: [],
  });
};

const ANSWER_ANY_PAGE: readonly string[] = ["desk", "lead", "organiser"];

const answerPage = (state: HubState, c: CommandOf<"page.answer">, actor: Actor) => {
  const page = state.pages[c.page];
  if (!page) return refuse("not_found", "This page is not known.");
  if (page.answeredAt !== null) return refuse("wrong_state", "This page is already answered.");
  if (actor.ref === null) return refuse("forbidden", "Sign in to answer a page.");
  if (page.to !== actor.ref && !ANSWER_ANY_PAGE.includes(actor.role))
    return refuse("forbidden", "Only a person on the page list may answer this page.");
  return allow({
    events: [
      { card: page.card, job: null, actor, type: "page.answered", data: { page: page.id, by: actor.ref } },
    ],
    effects: [],
  });
};

const jumpClock = (_state: HubState, c: CommandOf<"clock.jump">, actor: Actor, ctx: DecideContext) => {
  if (!ctx.config.demoMode) return refuse("demo_off", "The demo clock is off.");
  return allow({
    events: [{ card: null, job: null, actor, type: "clock.jumped", data: { byMs: c.minutes * MINUTE } }],
    effects: [],
  });
};

const orgLine = (actor: Actor) => ({ card: null, job: null, actor });

const strandsJob = (job: JobState, next: Playbook): boolean => {
  const row = next.rows.find((r) => r.need === job.need);
  return row === undefined || job.rung >= row.ladder.length;
};

const loadPlaybook = (state: HubState, c: CommandOf<"playbook.load">, actor: Actor) => {
  const { version, rows } = c.playbook;
  if (state.playbookVersion === version) return refuse("wrong_state", "This playbook version is loaded.");
  const open = Object.values(state.jobs).filter((job) => !isClosed(job.status));
  if (open.some((job) => strandsJob(job, c.playbook)))
    return refuse("wrong_state", "An open job needs a need or a path that this playbook drops.");
  return allow({
    events: [{ ...orgLine(actor), type: "playbook.loaded", data: { version, rows: rows.length } }],
    effects: [],
  });
};

const setLevel = (state: HubState, c: CommandOf<"need.set_level">, actor: Actor, ctx: DecideContext) => {
  const row = ctx.playbook.rows.find((r) => r.need === c.need);
  if (!row) return refuse("not_found", "This need is not in the playbook.");
  if (c.level === 1 && !hasEarned(recordOf(state, row.need)))
    return refuse("not_earned", "This need has not earned level 1.");
  if (levelOf(state, row) === c.level) return refuse("wrong_state", "This need is already at this level.");
  return allow({
    events: [{ ...orgLine(actor), type: "need.level_set", data: { need: row.need, level: c.level } }],
    effects: [],
  });
};

const setMaster = (state: HubState, c: CommandOf<"levels.master">, actor: Actor) => {
  if (state.levels.master === c.on) return refuse("wrong_state", "The master switch is already set.");
  return allow({
    events: [{ ...orgLine(actor), type: "levels.master_set", data: { on: c.on } }],
    effects: [],
  });
};

export const adminHandlers: Handlers = {
  "shift.take": takeShift,
  "page.answer": answerPage,
  "clock.jump": jumpClock,
  "playbook.load": loadPlaybook,
  "need.set_level": setLevel,
  "levels.master": setMaster,
};
