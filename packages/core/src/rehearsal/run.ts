import type {
  Actor,
  Config,
  CoreCommand,
  DecideContext,
  Decision,
  Deadline,
  LedgerEvent,
  MemberPublic,
  Playbook,
  Statement,
  SystemCommand,
} from "@vision/contracts";
import { decide } from "../decide.js";
import { closeDeadlines } from "../decide/close.js";
import { partnerDeadlines } from "../decide/partner.js";
import { pendingDeadlines } from "../decide/timers.js";
import { runDue } from "../deadlines.js";
import { evolve } from "../evolve.js";
import { sealEvent } from "../seal.js";
import { emptyState, type HubState } from "../state.js";
import { statement } from "../statement.js";
import {
  REHEARSAL_MESSAGE,
  VOLUNTEERS,
  inventVolunteers,
  offerReplies,
  reactTo,
  type Chances,
  type Planned,
  type RehearsalLabel,
  type World,
} from "./actors.js";
import { mulberry32, pick } from "./rng.js";

export type RehearsalInput = {
  seed: number;
  labels: RehearsalLabel[];
  source: string;
  playbook: Playbook;
  zips: DecideContext["zips"];
  config: Config;
  chances: Chances;
};

export type RehearsalResult = {
  statement: Statement;
  weak: { unmetNeeds: string[]; wavesToDesk: number; latePromises: number };
  assumptions: string[];
  requests: number;
  source: string;
};

export class RehearsalStuckError extends Error {
  constructor(readonly steps: number) {
    super(`The rehearsal did not settle after ${String(steps)} steps`);
    this.name = "RehearsalStuckError";
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY_HOURS = 12;
export const REHEARSAL_START = Date.UTC(2026, 11, 8, 13, 0, 0);
export const REHEARSAL_MONTH = "2026-12";
const HORIZON = REHEARSAL_START + 14 * 24 * HOUR;
const MAX_STEPS = 100_000;
const SYSTEM: Actor = { role: "system", ref: null };

type Queued = Planned & { order: number };

type Sim = {
  world: World;
  base: Omit<DecideContext, "now" | "offered">;
  state: HubState;
  events: LedgerEvent[];
  offered: DecideContext["offered"];
  queue: Queued[];
  added: number;
};

const counter = (): ((prefix: string) => string) => {
  const counts: Record<string, number> = {};
  return (prefix) => {
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    return `${prefix}${String(counts[prefix])}`;
  };
};

const contextAt = (sim: Sim, now: number): DecideContext => ({ ...sim.base, now, offered: sim.offered });

const enqueue = (sim: Sim, planned: readonly Planned[]): void => {
  for (const p of planned) {
    sim.added += 1;
    sim.queue.push({ ...p, order: sim.added });
  }
  sim.queue.sort((a, b) => a.at - b.at || a.order - b.order);
};

const trackOffered = (sim: Sim, decision: Extract<Decision, { ok: true }>): void => {
  for (const effect of decision.effects) {
    if (effect.kind === "offer")
      sim.offered = { ...sim.offered, [effect.job]: [...(sim.offered[effect.job] ?? []), ...effect.members] };
    if (effect.kind === "offer_closed") sim.offered = { ...sim.offered, [effect.job]: [] };
  }
};

const apply = (sim: Sim, decision: Decision, at: number): HubState => {
  if (!decision.ok) return sim.state;
  const lines = decision.events.map((draft) => {
    const line = sealEvent(draft, sim.state.seq + 1, at, sim.state.lastHash);
    sim.state = evolve(sim.state, line);
    sim.events.push(line);
    return line;
  });
  trackOffered(sim, decision);
  enqueue(sim, [
    ...lines.flatMap((line) => reactTo(sim.world, sim.state, line)),
    ...decision.effects.flatMap((effect) => offerReplies(sim.world, effect, at)),
  ]);
  return sim.state;
};

const allDeadlines = (sim: Sim): Deadline[] => [
  ...pendingDeadlines(sim.state, contextAt(sim, 0)),
  ...partnerDeadlines(sim.state, sim.base.playbook),
  ...closeDeadlines(sim.state),
];

const fireDue = (sim: Sim, now: number): void => {
  sim.state = runDue(sim.state, contextAt(sim, now), now, (decision, at) => apply(sim, decision, at));
  const extra = [...partnerDeadlines(sim.state, sim.base.playbook), ...closeDeadlines(sim.state)]
    .filter((d) => d.at <= now)
    .sort((a, b) => a.at - b.at);
  for (const deadline of extra) {
    const command: SystemCommand = { type: "timer.fired", deadline };
    apply(sim, decide(sim.state, command, SYSTEM, contextAt(sim, deadline.at)), deadline.at);
  }
};

const runAction = (sim: Sim, action: Queued): void => {
  const command: CoreCommand | SystemCommand = action.command;
  apply(sim, decide(sim.state, command, action.actor, contextAt(sim, action.at)), action.at);
};

const settle = (sim: Sim): void => {
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const due = Math.min(...allDeadlines(sim).map((d) => d.at));
    const action = sim.queue[0];
    const next = Math.min(due, action?.at ?? Number.POSITIVE_INFINITY);
    if (!Number.isFinite(next) || next > HORIZON) return;
    if (due <= next) fireDue(sim, next);
    else if (action !== undefined) {
      sim.queue.shift();
      runAction(sim, action);
    }
  }
  throw new RehearsalStuckError(MAX_STEPS);
};

const arrivals = (input: RehearsalInput, world: World): Planned[] => {
  const zips = Object.keys(input.zips).sort();
  const times = input.labels
    .map(() => REHEARSAL_START + Math.floor(world.rng() * DAY_HOURS * HOUR))
    .sort((a, b) => a - b);
  return input.labels.map((label, i) => ({
    at: times[i] ?? REHEARSAL_START,
    actor: SYSTEM,
    command: {
      type: "request.submit",
      card: `c_${label.id}`,
      door: label.door === "email" ? "email" : "form",
      zip: pick(world.rng, zips) ?? null,
      safeContact: true,
      firstName: "Resident",
      contact: "resident@example.org",
      address: null,
      message: REHEARSAL_MESSAGE,
    },
  }));
};

const percent = (n: number): string => String(Math.round(n * 100));

const assumptionsOf = (input: RehearsalInput): string[] => {
  const c = input.chances;
  return [
    `${String(input.labels.length)} requests arrive over ${String(DAY_HOURS)} hours`,
    "The sorter answers are the saved answers of the source, and both passes give the same answer",
    "The desk confirms each request with the answer key 2 to 10 minutes after the sort",
    "The desk leaves a request on the board when no need in the playbook fits it",
    `${String(VOLUNTEERS)} invented volunteers, each with 1 to 3 skills from the playbook and a ZIP from the ZIP list`,
    `${percent(c.offerYes)} percent of volunteers say yes to an offer`,
    "A volunteer who says yes is on the way in 20 minutes, there in 30 minutes and done in 55 minutes",
    "Residents say yes to sharing their request with a partner",
    `${percent(c.partnerYes)} percent of partners say yes to an ask`,
    `${percent(c.gotIt)} percent of partners who say yes confirm the hand-over in time`,
    `At the check-back, ${percent(c.checkback.yes)} percent say helped, ${percent(c.checkback.partly)} percent say partly, ${percent(c.checkback.no)} percent say not helped and ${percent(c.checkback.silent)} percent do not answer`,
    "When a job comes back with no volunteer, the desk moves it to the next rung. Other returns are offered again",
  ];
};

const startSim = (input: RehearsalInput): Sim => {
  const rng = mulberry32(input.seed);
  const desk: Actor = { role: "desk", ref: "m_rdesk" };
  const lead: Actor = { role: "lead", ref: "m_rlead" };
  const cmd = counter();
  const labels = Object.fromEntries(input.labels.map((label) => [`c_${label.id}`, label]));
  const world: World = {
    rng,
    playbook: input.playbook,
    chances: input.chances,
    labels,
    desk,
    lead,
    cmd: () => cmd("cmd_r"),
  };
  const staff: MemberPublic[] = [
    { id: "m_rdesk", roles: ["desk"], skills: [], zip: null, on: true, lastJobAt: null },
    { id: "m_rlead", roles: ["lead"], skills: [], zip: null, on: true, lastJobAt: null },
  ];
  const members = [...staff, ...inventVolunteers(rng, input.playbook, Object.keys(input.zips).sort())];
  const config: Config = { ...input.config, sorterOn: true, pageList: ["m_rdesk", "m_rlead"] };
  const base = { newId: counter(), playbook: input.playbook, members, zips: input.zips, config };
  return { world, base, state: emptyState(), events: [], offered: {}, queue: [], added: 0 };
};

export const rehearse = (input: RehearsalInput): RehearsalResult => {
  const sim = startSim(input);
  const shift: Planned = {
    at: REHEARSAL_START,
    command: { type: "shift.take", id: sim.world.cmd() },
    actor: sim.world.desk,
  };
  enqueue(sim, [shift, ...arrivals(input, sim.world)]);
  settle(sim);
  const s = statement(sim.events, REHEARSAL_MONTH);
  return {
    statement: s,
    weak: {
      unmetNeeds: [...new Set(s.unmetTable.map((row) => row.need))].sort(),
      wavesToDesk: s.wrong.noVolunteer,
      latePromises: s.wrong.latePromises,
    },
    assumptions: assumptionsOf(input),
    requests: input.labels.length,
    source: input.source,
  };
};
