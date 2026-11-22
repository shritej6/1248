import type {
  Actor,
  DecideContext,
  Division,
  Door,
  EventDataOf,
  Flag,
  PlaybookRow,
  Service,
  Urgency,
} from "@vision/contracts";
import { effectiveLevel } from "../level.js";
import { dropToTwo, isAiLow, isSeriousMiss, levelOf, spotCheckDue } from "../needrecord.js";
import { QUIET_CODE, needForService, routeCode } from "../routecode.js";
import { checkSort, type SortCheck } from "../sort.js";
import type { CardState, HubState } from "../state.js";
import { WORD_LIST } from "../wordlist.js";
import type { MessageStep } from "./aiask.js";
import { langStep } from "./lang.js";
import { linkStep } from "./link.js";
import { cardGuard } from "./plan.js";
import { NO_LINES, allow, join, refuse, type CommandOf, type Handlers, type Lines } from "./result.js";

type PageReason = EventDataOf<"page.sent">["reason"];

const HOUR = 3_600_000;
const NO_DIVISION: Division = "No clear home";

export const pageOrder = (state: HubState, ctx: DecideContext): string[] => [
  ...new Set([...(state.deskOnShift === null ? [] : [state.deskOnShift]), ...ctx.config.pageList]),
];

export const pageCard = (
  state: HubState,
  ctx: DecideContext,
  card: string,
  reason: PageReason,
  actor: Actor,
): Lines => {
  const to = pageOrder(state, ctx)[0];
  if (to === undefined) return NO_LINES;
  const page = ctx.newId("pg_");
  return {
    events: [{ card, job: null, actor, type: "page.sent", data: { page, to, reason, step: 0 } }],
    effects: [{ kind: "page", page, member: to }],
  };
};

const rowFor = (need: string, ctx: DecideContext): PlaybookRow | undefined =>
  ctx.playbook.rows.find((row) => row.need === need);

const isPaged = (state: HubState, card: string): boolean =>
  Object.values(state.pages).some((page) => page.card === card);

const nextNumber = (state: HubState, code: string): number =>
  Object.values(state.cards).filter((c) => c.routeCode?.startsWith(`${code}-`) === true).length + 1;

const sortedLines = (card: string, check: SortCheck, actor: Actor): Lines => {
  const data = {
    source: check.source,
    service: check.service as Service | null,
    division: check.division as Division | null,
    urgency: check.urgency,
    flags: check.flags,
  };
  return {
    events: [{ card, job: null, actor, type: "card.sorted", data }],
    effects: check.quotes.map((text) => ({ kind: "vault.text", card, job: null, textKind: "quote", text })),
  };
};

const sortPage = (state: HubState, ctx: DecideContext, card: string, check: SortCheck, actor: Actor) => {
  const hit = check.source === "none" && check.flags.includes("word_list_hit");
  const reason: PageReason | null = check.urgency === "high" ? "high" : hit ? "sorter_down_hit" : null;
  return reason === null || isPaged(state, card) ? NO_LINES : pageCard(state, ctx, card, reason, actor);
};

const sortLines = (state: HubState, ctx: DecideContext, card: string, check: SortCheck, actor: Actor) =>
  join(sortedLines(card, check, actor), sortPage(state, ctx, card, check, actor));

const lateSortLines = (
  state: HubState,
  ctx: DecideContext,
  card: CardState,
  check: SortCheck,
  actor: Actor,
): Lines => {
  const raise = check.urgency === "high" && card.urgency !== "high";
  const raised: Lines = raise
    ? {
        events: [{ card: card.id, job: null, actor, type: "card.raised", data: { to: "high" } }],
        effects: [],
      }
    : NO_LINES;
  return join(sortedLines(card.id, check, actor), raised, sortPage(state, ctx, card.id, check, actor));
};

type Plan = {
  card: CardState;
  row: PlaybookRow;
  urgency: Urgency;
  flags: readonly Flag[];
  actor: Actor;
};

export const planJob = (state: HubState, ctx: DecideContext, plan: Plan): Lines => {
  const quiet = plan.card.quiet || plan.row.quiet;
  const level = effectiveLevel({
    needLevel: levelOf(state, plan.row),
    flags: plan.flags,
    urgency: plan.urgency,
    quiet,
    master: state.levels.master,
  });
  const data = {
    need: plan.row.need,
    path: plan.row.ladder[0]?.path ?? "unmet",
    rung: 0,
    level,
    quiet,
    promiseAt: ctx.now + plan.row.promiseHours * HOUR,
  };
  return {
    events: [{ card: plan.card.id, job: ctx.newId("j_"), actor: plan.actor, type: "job.planned", data }],
    effects: [],
  };
};

type Confirm = Plan & { division: Division | null; zip: string | null; changed: boolean };

const receiptLines = (ctx: DecideContext, c: Confirm, code: string, promiseAt: number): Lines => ({
  events: [{ card: c.card.id, job: null, actor: c.actor, type: "receipt.sent", data: { promiseAt } }],
  effects: [
    {
      kind: "message",
      to: "resident",
      card: c.card.id,
      job: null,
      partner: null,
      template: "receipt",
      slots: {
        orgName: ctx.config.orgName,
        routeCode: code,
        needLabel: c.row.label,
        promiseAt: String(promiseAt),
      },
    },
  ],
});

const confirmLines = (state: HubState, ctx: DecideContext, c: Confirm): Lines => {
  const quiet = c.card.quiet || c.row.quiet;
  const level = effectiveLevel({
    needLevel: levelOf(state, c.row),
    flags: c.flags,
    urgency: c.urgency,
    quiet,
    master: state.levels.master,
  });
  const prefix = quiet || level === 3 ? QUIET_CODE : c.row.code;
  const code = routeCode(prefix, c.zip, nextNumber(state, prefix));
  const data = { need: c.row.need, urgency: c.urgency, division: c.division, level, quiet, routeCode: code };
  const confirmed: Lines = {
    events: [
      {
        card: c.card.id,
        job: null,
        actor: c.actor,
        type: "card.confirmed",
        data: { ...data, changed: c.changed },
      },
    ],
    effects: [],
  };
  const receipt = quiet ? NO_LINES : receiptLines(ctx, c, code, ctx.now + c.row.promiseHours * HOUR);
  const page =
    c.urgency === "high" && !isPaged(state, c.card.id)
      ? pageCard(state, ctx, c.card.id, "high", c.actor)
      : NO_LINES;
  return join(confirmed, receipt, planJob(state, ctx, c), page);
};

const doorFlags = (door: Door, flags: readonly Flag[]): readonly Flag[] =>
  door === "voice" && !flags.includes("voice_transcript") ? [...flags, "voice_transcript"] : flags;

const withDoorFlag = (door: Door, check: SortCheck): SortCheck => ({
  ...check,
  flags: [...doorFlags(door, check.flags)],
});

const cardFlags = (card: CardState): readonly Flag[] => doorFlags(card.door, card.sorted?.flags ?? []);

const sortStep: MessageStep = (state, ctx, info, actor) => {
  if (ctx.config.sorterOn) return { events: [], effects: [{ kind: "sort", card: info.card }] };
  const check = checkSort({ message: info.message, passes: null, error: "off", wordList: WORD_LIST });
  return sortLines(state, ctx, info.card, withDoorFlag(info.door, check), actor);
};

const MESSAGE_STEPS: readonly MessageStep[] = [sortStep, linkStep, langStep];

export const messageReady: MessageStep = (state, ctx, info, actor) =>
  join(...MESSAGE_STEPS.map((step) => step(state, ctx, info, actor)));

const submit = (state: HubState, c: CommandOf<"request.submit">, actor: Actor, ctx: DecideContext) => {
  if (state.cards[c.card]) return refuse("wrong_state", "This request is already on the board.");
  const lang = c.lang === undefined ? {} : { lang: c.lang };
  const data = { door: c.door, zip: c.zip, safeContact: c.safeContact, ...lang };
  const received: Lines = {
    events: [{ card: c.card, job: null, actor, type: "card.received", data }],
    effects: [
      { kind: "vault.person", card: c.card, firstName: c.firstName, contact: c.contact, address: c.address },
      { kind: "vault.text", card: c.card, job: null, textKind: "message_in", text: c.message },
    ],
  };
  const info = {
    card: c.card,
    message: c.message,
    door: c.door,
    lang: c.lang ?? null,
    zip: c.zip,
    quiet: !c.safeContact,
  };
  return allow(join(received, messageReady(state, ctx, info, actor)));
};

const autoRow = (state: HubState, ctx: DecideContext, card: CardState, check: SortCheck) => {
  const row = needForService(check.service, ctx.playbook);
  if (row === null || card.urgency === "high") return null;
  if (check.urgency !== "low" || check.flags.length > 0) return null;
  const level = effectiveLevel({
    needLevel: levelOf(state, row),
    flags: [],
    urgency: "low",
    quiet: card.quiet || row.quiet,
    master: state.levels.master,
  });
  return level === 1 ? row : null;
};

const withSpotCheck = (state: HubState, ctx: DecideContext, card: CardState, check: SortCheck): SortCheck => {
  const row = autoRow(state, ctx, card, check);
  return row !== null && spotCheckDue(state, row, ctx.playbook)
    ? { ...check, flags: [...check.flags, "spot_check"] }
    : check;
};

const autoConfirm = (
  state: HubState,
  ctx: DecideContext,
  card: CardState,
  check: SortCheck,
  actor: Actor,
) => {
  const row = autoRow(state, ctx, card, check);
  if (row === null || check.urgency !== "low") return NO_LINES;
  const plan = { card, row, urgency: check.urgency, flags: check.flags, actor };
  return confirmLines(state, ctx, {
    ...plan,
    division: check.division as Division | null,
    zip: card.zip,
    changed: false,
  });
};

const sortResult = (state: HubState, c: CommandOf<"sort.result">, actor: Actor, ctx: DecideContext) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This request is not on the board.");
  if (card.sorted !== null) return refuse("wrong_state", "This request is sorted.");
  const check = checkSort({ message: c.message, passes: c.passes, error: c.error, wordList: WORD_LIST });
  const sorted = withDoorFlag(card.door, check);
  if (card.confirmedAt !== null) return allow(lateSortLines(state, ctx, card, sorted, actor));
  const spot = withSpotCheck(state, ctx, card, sorted);
  return allow(join(sortLines(state, ctx, c.card, spot, actor), autoConfirm(state, ctx, card, spot, actor)));
};

const deskChanged = (
  card: CardState,
  need: string,
  urgency: Urgency,
  division: Division | null,
  ctx: DecideContext,
) => {
  const sorted = card.sorted;
  if (sorted === null || sorted.source !== "ai") return false;
  const suggested = needForService(sorted.service, ctx.playbook)?.need ?? null;
  const sameDivision = (division ?? NO_DIVISION) === (sorted.division ?? NO_DIVISION);
  return urgency !== sorted.urgency || need !== suggested || !sameDivision;
};

const quietGuard = (card: CardState, row: PlaybookRow, actor: Actor) =>
  (card.quiet || row.quiet) && actor.role !== "lead"
    ? refuse("forbidden", "Only the lead may handle a quiet request.")
    : null;

const confirm = (state: HubState, c: CommandOf<"card.confirm">, actor: Actor, ctx: DecideContext) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This request is not on the board.");
  if (card.confirmedAt !== null) return refuse("wrong_state", "This request is already confirmed.");
  const row = rowFor(c.need, ctx);
  if (!row) return refuse("invalid", "This need is not in the playbook.");
  const guard = quietGuard(card, row, actor);
  if (guard) return guard;
  const changed = deskChanged(card, row.need, c.urgency, c.division, ctx);
  const flags = cardFlags(card);
  const input = { card, row, urgency: c.urgency, flags, actor, division: c.division, changed };
  const miss: Lines = {
    events: isSeriousMiss(card, c.urgency) ? dropToTwo(state, row, actor) : [],
    effects: [],
  };
  return allow(join(confirmLines(state, ctx, { ...input, zip: c.zip ?? card.zip }), miss));
};

const raiseMiss = (state: HubState, ctx: DecideContext, card: CardState, actor: Actor): Lines => {
  const row = card.need === null ? undefined : rowFor(card.need, ctx);
  if (row === undefined || !isAiLow(card)) return NO_LINES;
  return { events: dropToTwo(state, row, actor), effects: [] };
};

const raise = (state: HubState, c: CommandOf<"card.raise">, actor: Actor, ctx: DecideContext) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This request is not on the board.");
  const guard = cardGuard(state, card.id, actor);
  if (guard) return guard;
  if ((card.urgency ?? card.sorted?.urgency) === "high")
    return refuse("wrong_state", "This request is already high.");
  const raised: Lines = {
    events: [{ card: card.id, job: null, actor, type: "card.raised", data: { to: "high" } }],
    effects: [],
  };
  return allow(
    join(raised, raiseMiss(state, ctx, card, actor), pageCard(state, ctx, card.id, "high", actor)),
  );
};

const addJob = (state: HubState, c: CommandOf<"card.add_job">, actor: Actor, ctx: DecideContext) => {
  const card = state.cards[c.card];
  if (!card) return refuse("not_found", "This request is not on the board.");
  if (card.confirmedAt === null) return refuse("wrong_state", "Confirm the request first.");
  const row = rowFor(c.need, ctx);
  if (!row) return refuse("invalid", "This need is not in the playbook.");
  const guard = quietGuard(card, row, actor);
  if (guard) return guard;
  const open = card.jobs.some((id) => {
    const job = state.jobs[id];
    return job !== undefined && job.need === row.need && job.closedAt === null;
  });
  if (open) return refuse("wrong_state", "This request already has an open job for this need.");
  const plan = { card, row, urgency: card.urgency ?? "low", flags: cardFlags(card), actor };
  return allow(planJob(state, ctx, plan));
};

export const intakeHandlers: Handlers = {
  "request.submit": submit,
  "sort.result": sortResult,
  "card.confirm": confirm,
  "card.raise": raise,
  "card.add_job": addJob,
};
