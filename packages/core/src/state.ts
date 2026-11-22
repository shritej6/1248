import type {
  AiJobKey,
  AiStatus,
  Door,
  EventDataOf,
  Flag,
  JobFlag,
  JobStatus,
  Lang,
  Level,
  LinkAnswer,
  Rung,
  Urgency,
} from "@vision/contracts";
import { GENESIS_HASH } from "./seal.js";

export type SortedState = {
  source: "ai" | "none";
  service: string | null;
  division: string | null;
  urgency: Urgency | null;
  flags: Flag[];
};

export type CardState = {
  id: string;
  receivedAt: number;
  door: Door;
  zip: string | null;
  safeContact: boolean;
  sorted: SortedState | null;
  confirmedAt: number | null;
  need: string | null;
  urgency: Urgency | null;
  division: string | null;
  level: Level | null;
  quiet: boolean;
  routeCode: string | null;
  changed: boolean;
  promiseAt: number | null;
  jobs: string[];
  lang: Lang | null;
  ai: CardAi;
  gistAt: number | null;
};

export type CardAi = Partial<Record<AiJobKey, AiStatus>>;

export type LinkState = {
  a: string;
  b: string;
  score: number;
  proposedAt: number;
  answer: LinkAnswer | null;
  answeredAt: number | null;
};

export type JobState = {
  id: string;
  card: string;
  need: string;
  path: Rung["path"];
  rung: number;
  level: Level;
  quiet: boolean;
  status: JobStatus;
  approved: boolean;
  wave: number;
  waveAt: number | null;
  holderRef: string | null;
  helpers: string[];
  excluded: string[];
  flags: JobFlag[];
  returnReason: string | null;
  createdAt: number;
  promiseAt: number;
  acceptedAt: number | null;
  onMyWayAt: number | null;
  thereAt: number | null;
  doneAt: number | null;
  askedAt: number | null;
  yesAt: number | null;
  gotItAt: number | null;
  checkback: { dueAt: number; tries: number; sentAt: number | null } | null;
  closedAt: number | null;
  hoursMs: number;
  partner: string | null;
  partnerAnswer?: PartnerAnswerState;
  taps?: Record<string, MemberTaps>;
};

export type MemberTaps = { startAt: number | null; hoursMs: number; counted: boolean };

export type PartnerAnswerState = {
  partner: string;
  answer: "yes" | "no" | "wait";
  at: number;
  waitUntil: number | null;
};

export type PageState = {
  id: string;
  card: string;
  to: string;
  reason: EventDataOf<"page.sent">["reason"];
  step: number;
  sentAt: number;
  movedAt: number | null;
  answeredAt: number | null;
  answeredBy: string | null;
};

export type NeedRecord = { clean: number; changed: number; serious: number };

export type PartnerCounts = { asked: number; yes: number; gotIt: number; helped: number };

export type HubState = {
  seq: number;
  lastHash: string;
  cards: Record<string, CardState>;
  jobs: Record<string, JobState>;
  pages: Record<string, PageState>;
  deskOnShift: string | null;
  levels: { master: boolean; needs: Record<string, Level> };
  playbookVersion: string | null;
  clockOffsetMs: number;
  promises: string[];
  counters: Record<string, number>;
  needRecords: Record<string, NeedRecord>;
  partnerCounts: Record<string, PartnerCounts>;
  mismatches: Record<string, number>;
  links: Record<string, LinkState>;
};

export const STATE_SHAPE = 4;

export const linkKey = (one: string, two: string): string => (one < two ? `${one}|${two}` : `${two}|${one}`);

export const emptyState = (): HubState => ({
  seq: 0,
  lastHash: GENESIS_HASH,
  cards: {},
  jobs: {},
  pages: {},
  deskOnShift: null,
  levels: { master: false, needs: {} },
  playbookVersion: null,
  clockOffsetMs: 0,
  promises: [],
  counters: {},
  needRecords: {},
  partnerCounts: {},
  mismatches: {},
  links: {},
});
