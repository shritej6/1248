import type { LedgerEvent, Month, Playbook, PlaybookRow } from "@vision/contracts";
import { monthBounds } from "../month.js";
import { mulberry32 } from "../rehearsal/rng.js";
import type { HubState } from "../state.js";
import { addMonths, chicagoMonth, monthIndex, monthRange } from "./calendar.js";
import { HEATING_SHARE, SNOW_INCHES } from "./seasons.js";

export const SYNTHETIC_SEED = 20261122;
export const HISTORY_MONTHS = 24;
export const MIN_RECORD_MONTHS = 12;
const HOUR_MS = 3_600_000;

export type HistoryMonth = { month: Month; jobs: number; hours: number };
export type NeedHistory = { need: string; label: string; months: HistoryMonth[] };
export type History = {
  from: Month;
  to: Month;
  syntheticMonths: number;
  recordMonths: number;
  needs: NeedHistory[];
};
export type NoHistory = { status: "not_enough_history"; recordMonths: number };
export type HistoryInput = {
  now: number;
  demo: boolean;
  events: readonly LedgerEvent[];
  state: HubState;
  playbook: Playbook;
};

type Synthetic = { base: (index: number) => number; hoursPerJob: number };
type Tally = Map<string, Map<string, number>>;

const flat = (value: number, hoursPerJob: number): Synthetic => ({ base: () => value, hoursPerJob });
const inside = (from: number, to: number, high: number, low: number) => (index: number) =>
  index >= from && index <= to ? high : low;
const heating = (index: number): number => HEATING_SHARE[index] ?? 0;

const SYNTHETIC = new Map<string, Synthetic>([
  ["snow", { base: (i) => 2.2 * (SNOW_INCHES[i] ?? 0), hoursPerJob: 1.5 }],
  ["lawn", { base: inside(4, 9, 12, 0), hoursPerJob: 1.5 }],
  ["food", { base: (i) => 18 * (1 + 0.3 * heating(i)), hoursPerJob: 2 }],
  ["shelter", { base: (i) => 6 * (1 + 0.8 * heating(i)), hoursPerJob: 3 }],
  ["rides", flat(10, 1.5)],
  ["jobs", flat(4, 2)],
  ["cleanup", { base: inside(3, 8, 7.5, 5), hoursPerJob: 3 }],
  ["youth_stipend", { base: inside(5, 7, 6, 3), hoursPerJob: 2 }],
  ["missing", flat(2, 4)],
  ["burial", flat(1, 2)],
  ["violence_prevention", flat(2, 2)],
  ["deescalation", flat(2, 1.5)],
  ["suicide_prevention", flat(2, 1)],
]);
const OTHER = flat(2, 1.5);

const needSeed = (seed: number, key: string): number =>
  Array.from({ length: key.length }, (_, i) => key.charCodeAt(i)).reduce(
    (h, code) => (Math.imul(h, 31) + code) >>> 0,
    seed >>> 0,
  );

export const activeNeeds = (playbook: Playbook): PlaybookRow[] => playbook.rows.filter((r) => !r.quiet);

export const syntheticMonth = (need: string, month: Month, seed = SYNTHETIC_SEED): HistoryMonth => {
  const spec = SYNTHETIC.get(need) ?? OTHER;
  const noise = mulberry32(needSeed(seed, `${need}|${month}`))();
  const jobs = Math.round(spec.base(monthIndex(month)) * (0.75 + noise * 0.5));
  return { month, jobs, hours: jobs * spec.hoursPerJob };
};

const keyOf = (need: string, month: Month): string => `${need}|${month}`;

const tallyRecord = (input: HistoryInput, active: ReadonlySet<string>): Tally => {
  const tally: Tally = new Map();
  for (const e of input.events) {
    if (e.type !== "job.planned" || e.job === null || e.data.quiet || !active.has(e.data.need)) continue;
    const job = input.state.jobs[e.job];
    if (job?.quiet === true) continue;
    const key = keyOf(e.data.need, chicagoMonth(e.at));
    const jobs = tally.get(key) ?? new Map<string, number>();
    jobs.set(e.job, (job?.hoursMs ?? 0) / HOUR_MS);
    tally.set(key, jobs);
  }
  return tally;
};

const recordMonth = (tally: Tally, need: string, month: Month): HistoryMonth => {
  const jobs = tally.get(keyOf(need, month));
  if (jobs === undefined) return { month, jobs: 0, hours: 0 };
  return { month, jobs: jobs.size, hours: [...jobs.values()].reduce((sum, h) => sum + h, 0) };
};

const recordMonthsOf = (events: readonly LedgerEvent[], span: readonly Month[]): Set<Month> => {
  const first = events[0]?.at;
  if (first === undefined) return new Set();
  return new Set(span.filter((m) => monthBounds(m, "America/Chicago").start >= first));
};

export const buildHistory = (input: HistoryInput): History | NoHistory => {
  const span = monthRange(addMonths(chicagoMonth(input.now), -HISTORY_MONTHS), HISTORY_MONTHS);
  const records = recordMonthsOf(input.events, span);
  const months = input.demo ? span : span.filter((m) => records.has(m));
  const from = months[0];
  const to = months.at(-1);
  if (from === undefined || to === undefined || (!input.demo && records.size < MIN_RECORD_MONTHS))
    return { status: "not_enough_history", recordMonths: records.size };
  const rows = activeNeeds(input.playbook);
  const tally = tallyRecord(input, new Set(rows.map((r) => r.need)));
  const needs = rows.map((row) => ({
    need: row.need,
    label: row.label,
    months: months.map((m) =>
      records.has(m) ? recordMonth(tally, row.need, m) : syntheticMonth(row.need, m),
    ),
  }));
  return { from, to, syntheticMonths: months.length - records.size, recordMonths: records.size, needs };
};
