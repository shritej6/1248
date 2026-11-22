import type {
  Actor,
  Config,
  CoreCommand,
  DecideContext,
  Effect,
  EventDataOf,
  EventType,
  LedgerEvent,
  MemberPublic,
  Outcome,
  Playbook,
  RejectionCode,
  SortPass,
  SystemCommand,
  Urgency,
} from "@vision/contracts";
import configFile from "../../../data/synthetic/config.json" with { type: "json" };
import membersFile from "../../../data/synthetic/members.json" with { type: "json" };
import partnersFile from "../../../data/synthetic/partners.json" with { type: "json" };
import playbookFile from "../../../data/synthetic/playbook.json" with { type: "json" };
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { decide } from "../src/decide.js";
import { evolve } from "../src/evolve.js";
import { sealEvent } from "../src/seal.js";
import { emptyState, type HubState } from "../src/state.js";

export const BASE_NOW = Date.UTC(2026, 10, 22, 15, 0, 0);

const ROLE_ALIAS = { desk: "d", organiser: "o", lead: "l", volunteer: "v" } as const;

const aliasMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const m of membersFile) {
    const letter = ROLE_ALIAS[m.roles[0] as keyof typeof ROLE_ALIAS];
    counts[letter] = (counts[letter] ?? 0) + 1;
    map.set(m.id, `m_${letter}${String(counts[letter]).padStart(2, "0")}`);
  }
  const partnerAlias = ["p_pantry", "p_rides"];
  partnersFile.forEach((p, i) => map.set(p.id, partnerAlias[i] ?? `p_${String(i + 1)}`));
  return map;
};

const ALIASES = aliasMap();

const aliased = <T>(value: T): T => {
  let text = JSON.stringify(value);
  for (const [id, alias] of ALIASES) text = text.replaceAll(id, alias);
  return JSON.parse(text) as T;
};

export const members = aliased(membersFile) as MemberPublic[];
export const playbook = aliased(playbookFile) as Playbook;
export const config: Config = { ...aliased<Config>(configFile), sorterOn: true };
export const ctx = { playbook, members };

export type AnyCommand = CoreCommand | SystemCommand;
type Lazy = (messages: Readonly<Record<string, string>>) => AnyCommand;
export type CommandStep = { command: AnyCommand | Lazy; actor: Actor; offset: number };
export type MembersStep = { members: MemberPublic[] };
export type Step = CommandStep | MembersStep;
export type Run = {
  events: LedgerEvent[];
  effects: Effect[];
  rejections: RejectionCode[];
  state: HubState;
};

const SYSTEM: Actor = { role: "system", ref: null };
const ACTORS = {
  desk: { role: "desk", ref: "m_d01" },
  lead: { role: "lead", ref: "m_l01" },
  organiser: { role: "organiser", ref: "m_o01" },
  volunteer: { role: "volunteer", ref: "m_v01" },
} as const satisfies Record<string, Actor>;
type As = { as?: keyof typeof ACTORS };

let commandCount = 0;
const cmdId = (): string => {
  commandCount += 1;
  return `cmd_${String(commandCount)}`;
};

const step = (command: AnyCommand | Lazy, actor: Actor = SYSTEM): CommandStep => ({
  command,
  actor,
  offset: 0,
});

const contextFor = (now: number): DecideContext => {
  const counters: Record<string, number> = {};
  return {
    now,
    newId: (prefix) => {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      return `${prefix}${String(counters[prefix])}`;
    },
    playbook,
    members,
    offered: {},
    zips: zipsFile,
    config,
  };
};

const commandOf = (s: CommandStep, messages: Record<string, string>): AnyCommand => {
  const command = typeof s.command === "function" ? s.command(messages) : s.command;
  if (command.type === "request.submit") messages[command.card] = command.message;
  return command;
};

const trackOffers = (offered: Record<string, string[]>, effect: Effect): void => {
  if (effect.kind === "offer") offered[effect.job] = [...(offered[effect.job] ?? []), ...effect.members];
  if (effect.kind === "offer_closed") offered[effect.job] = [];
};

export const runFrom = (from: HubState, ...steps: Step[]): Run => {
  const out: Run = { events: [], effects: [], rejections: [], state: from };
  const messages: Record<string, string> = {};
  const offered: Record<string, string[]> = {};
  let context = contextFor(BASE_NOW);
  for (const s of steps) {
    if ("members" in s) {
      context = { ...context, members: s.members };
      continue;
    }
    const now = BASE_NOW + s.offset;
    const command = commandOf(s, messages);
    const decision = decide(out.state, command, s.actor, { ...context, now, offered });
    if (!decision.ok) {
      out.rejections.push(decision.rejection.code);
      continue;
    }
    if (command.type === "playbook.load") context = { ...context, playbook: command.playbook };
    for (const draft of decision.events) {
      const line = sealEvent(draft, out.state.seq + 1, now, out.state.lastHash);
      out.events.push(line);
      out.state = evolve(out.state, line);
    }
    decision.effects.forEach((effect) => {
      trackOffers(offered, effect);
    });
    out.effects.push(...decision.effects);
  }
  return out;
};

export const run = (...steps: Step[]): Run => runFrom(emptyState(), ...steps);

export const types = (d: Run): EventType[] => d.events.map((e) => e.type);
export const effects = (d: Run): Effect[] => d.effects;
export const state = (d: Run): HubState => d.state;

export const eventData = <K extends EventType>(d: Run, type: K): EventDataOf<K> => {
  const found = d.events.filter((e) => e.type === type).at(-1);
  if (!found) throw new Error(`No ${type} event in the run`);
  return found.data as EventDataOf<K>;
};

export const reject = (last: Step, setup: Step[] = []): RejectionCode | undefined =>
  run(...setup, last).rejections.at(-1);

type SubmitOptions = { safeContact?: boolean; zip?: string | null };

export const submit = (
  card: string,
  message = "Please help me shovel my walk this week",
  options: SubmitOptions = {},
): Step =>
  step({
    type: "request.submit",
    card,
    door: "form",
    zip: options.zip === undefined ? "53216" : options.zip,
    safeContact: options.safeContact ?? true,
    firstName: "Tess",
    contact: "tess@example.test",
    address: "100 Test St",
    message,
  });

const SNOW_SERVICE = "Free services for elderly, disabled, pregnant (lawn care, snow removal)";

export const pass = (urgency: Urgency, words = "", over: Partial<SortPass> = {}): SortPass => ({
  service: SNOW_SERVICE,
  division: "No clear home",
  urgency,
  words,
  reason: "A snow job.",
  ...over,
});

export const sortResult = (
  card: string,
  passes: SortPass[] | null,
  error: "off" | "ai_down" | null = null,
): Step => step((messages) => ({ type: "sort.result", card, message: messages[card] ?? "", passes, error }));

export const sortOff = (card: string): Step => sortResult(card, null, "off");

export const confirm = (card: string, need: string, urgency: Urgency, options: As = {}): Step =>
  step(
    { id: cmdId(), type: "card.confirm", card, need, urgency, division: null },
    ACTORS[options.as ?? "desk"],
  );

export const raise = (card: string, options: As = {}): Step =>
  step({ id: cmdId(), type: "card.raise", card }, ACTORS[options.as ?? "desk"]);

export const addJob = (card: string, need: string, options: As = {}): Step =>
  step({ id: cmdId(), type: "card.add_job", card, need }, ACTORS[options.as ?? "desk"]);

type SnowOptions = { card?: string; allOff?: boolean };

export const useMembers = (list: MemberPublic[]): MembersStep => ({ members: list });

export const confirmedSnow = (options: string | SnowOptions = {}): Step[] => {
  const { card = "c_1", allOff = false } = typeof options === "string" ? { card: options } : options;
  const setup = allOff ? [useMembers(members.map((m) => ({ ...m, on: false })))] : [];
  return [...setup, submit(card), sortResult(card, [pass("low"), pass("low")]), confirm(card, "snow", "low")];
};

const SNOW_BASE = ["m_v01", "m_v02", "m_v03", "m_v04"];

export const snowVolunteers = (n: number): MemberPublic[] => {
  const extra = Array.from({ length: Math.max(0, n - SNOW_BASE.length) }, (_, i) => ({
    id: `m_s${String(i + 1).padStart(2, "0")}`,
    roles: ["volunteer" as const],
    skills: ["snow"],
    zip: "53216",
    on: true,
    lastJobAt: null,
  }));
  const on = new Set(SNOW_BASE.slice(0, n));
  const base = members.map((m) => (SNOW_BASE.includes(m.id) ? { ...m, on: on.has(m.id) } : m));
  return [...base, ...extra];
};

export const approve = (job: string, options: As = {}): Step =>
  step({ id: cmdId(), type: "job.approve", job }, ACTORS[options.as ?? "desk"]);

export const offerAgain = (job: string, options: As = {}): Step =>
  step({ id: cmdId(), type: "job.offer_again", job }, ACTORS[options.as ?? "desk"]);

export const offerTo = (job: string, member: string, options: As = {}): Step =>
  step({ id: cmdId(), type: "job.offer_to", job, member }, ACTORS[options.as ?? "desk"]);

export const accept = (job: string, member: string): Step =>
  step({ id: cmdId(), type: "offer.accept", job }, { role: "volunteer", ref: member });

export const passOffer = (job: string, member: string): Step =>
  step({ id: cmdId(), type: "offer.pass", job }, { role: "volunteer", ref: member });

export const tapFor = (
  job: string,
  member: string,
  action: "accept" | "on_my_way" | "there" | "done",
  outcome?: Outcome,
  options: As = {},
): Step =>
  step(
    { id: cmdId(), type: "job.tap_for", job, member, action, ...(outcome === undefined ? {} : { outcome }) },
    ACTORS[options.as ?? "desk"],
  );

export const offeredSnow = (n = 2, card = "c_1"): Step[] => [
  useMembers(snowVolunteers(n)),
  ...confirmedSnow(card),
  approve("j_1"),
];

const FIRST_WAVE = SNOW_BASE.slice(0, 2);

export const acceptedSnow = (member = "m_v01"): Step[] => [
  ...offeredSnow(),
  FIRST_WAVE.includes(member) ? accept("j_1", member) : tapFor("j_1", member, "accept"),
];

const volunteer = (member: string): Actor => ({ role: "volunteer", ref: member });

export const at = (offset: number, s: Step): Step => ("members" in s ? s : { ...s, offset });

export const onMyWay = (job: string, member: string): Step =>
  step({ id: cmdId(), type: "job.on_my_way", job }, volunteer(member));

export const there = (job: string, member: string): Step =>
  step({ id: cmdId(), type: "job.there", job }, volunteer(member));

export const done = (job: string, member: string, outcome: Outcome, note?: string): Step =>
  step(
    { id: cmdId(), type: "job.done", job, outcome, ...(note === undefined ? {} : { note }) },
    volunteer(member),
  );

export const help = (job: string, member: string, note?: string): Step =>
  step({ id: cmdId(), type: "job.help", job, ...(note === undefined ? {} : { note }) }, volunteer(member));

export const handOff = (job: string, member: string, note: string): Step =>
  step({ id: cmdId(), type: "job.hand_off", job, note }, volunteer(member));

type PostOptions = As & { member?: string };

export const post = (card: string, text: string, options: PostOptions = {}): Step => {
  const base = ACTORS[options.as ?? "desk"];
  const actor = options.member === undefined ? base : { ...base, ref: options.member };
  return step({ id: cmdId(), type: "thread.post", card, text }, actor);
};

export const loadPlaybook = (next: Playbook, options: As = {}): Step =>
  step({ id: cmdId(), type: "playbook.load", playbook: next }, ACTORS[options.as ?? "organiser"]);

export const setLevel = (need: string, level: 1 | 2 | 3, options: As = {}): Step =>
  step({ id: cmdId(), type: "need.set_level", need, level }, ACTORS[options.as ?? "organiser"]);

export const master = (on: boolean, options: As = {}): Step =>
  step({ id: cmdId(), type: "levels.master", on }, ACTORS[options.as ?? "organiser"]);

export const stateWithLevel = (need: string, level: 1 | 2 | 3): HubState =>
  evolve(
    emptyState(),
    sealEvent(
      { card: null, job: null, type: "need.level_set", actor: ACTORS.organiser, data: { need, level } },
      1,
      BASE_NOW,
      emptyState().lastHash,
    ),
  );
