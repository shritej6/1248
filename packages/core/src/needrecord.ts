import type { Actor, EventDraft, Level, Playbook, PlaybookRow, Urgency } from "@vision/contracts";
import { needForService } from "./routecode.js";
import type { CardState, HubState, NeedRecord } from "./state.js";

export const EARN_AFTER_CLEAN = 60;
export const SPOT_CHECK_EVERY = 10;

const EMPTY: NeedRecord = { clean: 0, changed: 0, serious: 0 };

export const recordOf = (state: HubState, need: string): NeedRecord => state.needRecords[need] ?? EMPTY;

export const levelOf = (state: HubState, row: PlaybookRow): Level =>
  state.levels.needs[row.need] ?? row.level;

export const hasEarned = (record: NeedRecord): boolean => record.clean >= EARN_AFTER_CLEAN;

export const canEarn = (state: HubState, row: PlaybookRow): boolean =>
  levelOf(state, row) !== 1 && hasEarned(recordOf(state, row.need));

export const isAiLow = (card: CardState): boolean =>
  card.sorted?.source === "ai" && card.sorted.urgency === "low";

export const isSeriousMiss = (card: CardState, urgency: Urgency): boolean =>
  urgency === "high" && isAiLow(card);

export const afterConfirm = (record: NeedRecord, changed: boolean, serious: boolean): NeedRecord => ({
  clean: changed ? 0 : record.clean + 1,
  changed: changed ? record.changed + 1 : record.changed,
  serious: serious ? record.serious + 1 : record.serious,
});

export const afterRaise = (record: NeedRecord): NeedRecord => ({
  ...record,
  clean: 0,
  serious: record.serious + 1,
});

export const dropToTwo = (state: HubState, row: PlaybookRow, actor: Actor): EventDraft[] =>
  levelOf(state, row) === 1
    ? [{ card: null, job: null, actor, type: "need.level_set", data: { need: row.need, level: 2 } }]
    : [];

const isSpotCheck = (card: CardState, row: PlaybookRow, playbook: Playbook): boolean =>
  card.sorted?.flags.includes("spot_check") === true &&
  needForService(card.sorted.service, playbook)?.need === row.need;

const levelOneCards = (state: HubState, row: PlaybookRow, playbook: Playbook): number =>
  Object.values(state.cards).filter(
    (card) => (card.level === 1 && card.need === row.need) || isSpotCheck(card, row, playbook),
  ).length;

export const spotCheckDue = (state: HubState, row: PlaybookRow, playbook: Playbook): boolean =>
  (levelOneCards(state, row, playbook) + 1) % SPOT_CHECK_EVERY === 0;
