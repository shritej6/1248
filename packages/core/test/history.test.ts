import type { Actor, EventDraft, LedgerEvent } from "@vision/contracts";
import { expect, it } from "vitest";
import {
  HISTORY_MONTHS,
  MIN_RECORD_MONTHS,
  SYNTHETIC_SEED,
  activeNeeds,
  buildHistory,
  syntheticMonth,
  type History,
  type HistoryInput,
  type NoHistory,
} from "../src/resources/history.js";
import {
  HEATING_SHARE,
  SNOW_INCHES,
  SNOW_MEAN,
  seasonRule,
  seasonWeights,
} from "../src/resources/seasons.js";
import { GENESIS_HASH, sealEvent } from "../src/seal.js";
import { emptyState, type HubState, type JobState } from "../src/state.js";
import { IDS, uid, withJob } from "./arbitraries.js";
import { playbook } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 22, 18, 0);
const SYSTEM: Actor = { role: "system", ref: null };
const JOB_A = uid("j_", 101);
const JOB_B = uid("j_", 102);
const JOB_C = uid("j_", 103);
const JOB_D = uid("j_", 104);

const input = (over: Partial<HistoryInput> = {}): HistoryInput => ({
  now: NOW,
  demo: true,
  events: [],
  state: emptyState(),
  playbook,
  ...over,
});

const ready = (result: History | NoHistory): History => {
  if ("status" in result) return expect.unreachable("The history is not ready.");
  return result;
};

const line = (seq: number, at: number, draft: EventDraft): LedgerEvent =>
  sealEvent(draft, seq, at, GENESIS_HASH);

const shift = (seq: number, at: number): LedgerEvent =>
  line(seq, at, { card: null, job: null, actor: SYSTEM, type: "shift.taken", data: { member: IDS.desk } });

const planned = (seq: number, at: number, job: string, need: string, quiet: boolean): LedgerEvent =>
  line(seq, at, {
    card: IDS.card,
    job,
    actor: SYSTEM,
    type: "job.planned",
    data: { need, path: "volunteers", rung: 0, level: 2, quiet, promiseAt: at },
  });

const jobWithHours = (id: string, hoursMs: number): JobState => {
  const base = withJob("helped", null).jobs[IDS.job];
  if (base === undefined) return expect.unreachable("withJob plans one job.");
  return { ...base, id, hoursMs };
};

const monthOf = (history: History, need: string, month: string) =>
  history.needs.find((n) => n.need === need)?.months.find((m) => m.month === month);

it("the window is 24 months and a forecast needs 12 record months", () => {
  expect(HISTORY_MONTHS).toBe(24);
  expect(MIN_RECORD_MONTHS).toBe(12);
  expect(SYNTHETIC_SEED).toBe(20261122);
});

it("activeNeeds leaves out quiet rows and keeps the playbook order", () => {
  const needs = activeNeeds(playbook).map((r) => r.need);
  expect(needs).toHaveLength(13);
  expect(needs).not.toContain("text_extraction");
  expect(needs).toEqual(playbook.rows.filter((r) => !r.quiet).map((r) => r.need));
});

it("demo mode with an empty ledger gives 24 synthetic months for the 13 active needs", () => {
  const history = ready(buildHistory(input()));
  expect(history).toMatchObject({ from: "2024-11", to: "2026-10", syntheticMonths: 24, recordMonths: 0 });
  expect(history.needs).toHaveLength(13);
  expect(history.needs.map((n) => n.need)).not.toContain("text_extraction");
  expect(history.needs[0]).toMatchObject({ need: "shelter", label: "Shelter for tonight" });
  for (const need of history.needs) {
    expect(need.months.map((m) => m.month)).toEqual(history.needs[0]?.months.map((m) => m.month));
    expect(need.months).toHaveLength(24);
  }
  expect(monthOf(history, "snow", "2026-01")).toEqual(syntheticMonth("snow", "2026-01"));
});

it("demo off with an empty ledger has not enough history", () => {
  expect(buildHistory(input({ demo: false }))).toEqual({ status: "not_enough_history", recordMonths: 0 });
});

it("a ledger that starts on 2025-12-15 has the record months 2026-01 to 2026-10", () => {
  const events = [shift(1, Date.UTC(2025, 11, 15, 18, 0))];
  const demo = ready(buildHistory(input({ events })));
  expect(demo).toMatchObject({ from: "2024-11", to: "2026-10", syntheticMonths: 14, recordMonths: 10 });
  expect(monthOf(demo, "snow", "2026-01")).toEqual({ month: "2026-01", jobs: 0, hours: 0 });
  expect(monthOf(demo, "snow", "2025-12")).toEqual(syntheticMonth("snow", "2025-12"));
  expect(buildHistory(input({ events, demo: false }))).toEqual({
    status: "not_enough_history",
    recordMonths: 10,
  });
});

it("a ledger line exactly at the start of a month makes that month a record month", () => {
  const events = [shift(1, Date.UTC(2025, 9, 1, 5, 0))];
  expect(buildHistory(input({ events, demo: false }))).toMatchObject({
    from: "2025-10",
    to: "2026-10",
    syntheticMonths: 0,
    recordMonths: 13,
  });
});

const recordLedger = (): LedgerEvent[] => [
  shift(1, Date.UTC(2024, 9, 15, 17, 0)),
  planned(2, Date.UTC(2026, 0, 10, 18, 0), JOB_A, "snow", false),
  planned(3, Date.UTC(2026, 0, 11, 18, 0), JOB_A, "snow", false),
  planned(4, Date.UTC(2026, 0, 12, 18, 0), JOB_B, "snow", true),
  planned(5, Date.UTC(2026, 1, 1, 5, 30), JOB_C, "food", false),
  planned(6, Date.UTC(2026, 1, 5, 18, 0), JOB_D, "text_extraction", false),
];

const recordState = (): HubState => ({
  ...emptyState(),
  jobs: {
    [JOB_A]: jobWithHours(JOB_A, 7_200_000),
    [JOB_B]: jobWithHours(JOB_B, 3_600_000),
    [JOB_C]: jobWithHours(JOB_C, 5_400_000),
  },
});

it("the record counts each job once in its Chicago month, and quiet work never counts", () => {
  const history = ready(buildHistory(input({ demo: false, events: recordLedger(), state: recordState() })));
  expect(history).toMatchObject({ from: "2024-11", to: "2026-10", syntheticMonths: 0, recordMonths: 24 });
  expect(monthOf(history, "snow", "2026-01")).toEqual({ month: "2026-01", jobs: 1, hours: 2 });
  expect(monthOf(history, "food", "2026-01")).toEqual({ month: "2026-01", jobs: 1, hours: 1.5 });
  expect(monthOf(history, "food", "2026-02")).toEqual({ month: "2026-02", jobs: 0, hours: 0 });
  expect(history.needs.map((n) => n.need)).not.toContain("text_extraction");
  const total = history.needs.flatMap((n) => n.months).reduce((sum, m) => sum + m.jobs, 0);
  expect(total).toBe(2);
});

it("in demo mode the record months use the record, not the generator", () => {
  const history = ready(buildHistory(input({ events: recordLedger(), state: recordState() })));
  expect(history).toMatchObject({ syntheticMonths: 0, recordMonths: 24 });
  expect(monthOf(history, "snow", "2025-12")).toEqual({ month: "2025-12", jobs: 0, hours: 0 });
});

const BASES: Record<string, { base: (i: number) => number; hoursPerJob: number }> = {
  snow: { base: (i) => 2.2 * (SNOW_INCHES[i] ?? 0), hoursPerJob: 1.5 },
  lawn: { base: (i) => (i >= 4 && i <= 9 ? 12 : 0), hoursPerJob: 1.5 },
  food: { base: (i) => 18 * (1 + 0.3 * (HEATING_SHARE[i] ?? 0)), hoursPerJob: 2 },
  shelter: { base: (i) => 6 * (1 + 0.8 * (HEATING_SHARE[i] ?? 0)), hoursPerJob: 3 },
  rides: { base: () => 10, hoursPerJob: 1.5 },
  jobs: { base: () => 4, hoursPerJob: 2 },
  cleanup: { base: (i) => (i >= 3 && i <= 8 ? 7.5 : 5), hoursPerJob: 3 },
  youth_stipend: { base: (i) => (i >= 5 && i <= 7 ? 6 : 3), hoursPerJob: 2 },
  missing: { base: () => 2, hoursPerJob: 4 },
  burial: { base: () => 1, hoursPerJob: 2 },
  violence_prevention: { base: () => 2, hoursPerJob: 2 },
  deescalation: { base: () => 2, hoursPerJob: 1.5 },
  suicide_prevention: { base: () => 2, hoursPerJob: 1 },
  pets: { base: () => 2, hoursPerJob: 1.5 },
};

const MONTHS = Array.from({ length: 36 }, (_, i) => {
  const year = 2024 + Math.floor((10 + i) / 12);
  return `${String(year)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}`;
});

it.each(Object.entries(BASES))("syntheticMonth for %s is seeded and stays inside its base", (need, spec) => {
  for (const month of MONTHS) {
    const value = syntheticMonth(need, month);
    const base = spec.base(Number(month.slice(5)) - 1);
    expect(syntheticMonth(need, month)).toEqual(value);
    expect(syntheticMonth(need, month, SYNTHETIC_SEED)).toEqual(value);
    expect(value.month).toBe(month);
    expect(Number.isInteger(value.jobs)).toBe(true);
    expect(value.jobs).toBeGreaterThanOrEqual(Math.floor(base * 0.75));
    expect(value.jobs).toBeLessThanOrEqual(Math.ceil(base * 1.25));
    expect(value.hours).toBeCloseTo(value.jobs * spec.hoursPerJob, 9);
  }
});

it("another seed gives another synthetic history", () => {
  const values = (seed: number) => MONTHS.map((m) => syntheticMonth("food", m, seed).jobs);
  expect(values(SYNTHETIC_SEED)).not.toEqual(values(SYNTHETIC_SEED + 1));
  expect(syntheticMonth("snow", "2025-07").jobs).toBe(0);
});

const WINDOW = MONTHS.slice(0, 24);
const shaped = (jobs: (index: number) => number) =>
  WINDOW.map((month) => ({ month, jobs: jobs(Number(month.slice(5)) - 1), hours: 0 }));

it.each([
  ["snow", "snow"],
  ["shelter", "heating"],
  ["food", "heating"],
  ["lawn", "history"],
  ["cleanup", "history"],
  ["youth_stipend", "history"],
  ["rides", "flat"],
  ["constructor", "flat"],
])("the season rule of %s is %s", (need, rule) => {
  expect(seasonRule(need)).toBe(rule);
});

it("snow weights follow the snowfall normals and average 1", () => {
  const weights = seasonWeights("snow", []);
  expect(SNOW_MEAN).toBeCloseTo(48.7 / 12, 12);
  expect(weights).toEqual(SNOW_INCHES.map((inches) => inches / SNOW_MEAN));
  expect(weights.reduce((sum, w) => sum + w, 0)).toBeCloseTo(12, 9);
});

it("heating weights compare the heating months with the summer months and mix May", () => {
  const weights = seasonWeights(
    "heating",
    shaped((i) => (HEATING_SHARE[i] === 1 ? 23 : 18)),
  );
  const all = (14 * 23 + 10 * 18) / 24;
  expect(weights[0]).toBeCloseTo(23 / all, 12);
  expect(weights[6]).toBeCloseTo(18 / all, 12);
  expect(weights[4]).toBeCloseTo(0.48 * (23 / all) + 0.52 * (18 / all), 12);
  expect(
    seasonWeights(
      "heating",
      shaped((i) => (HEATING_SHARE[i] === 1 ? 5 : 0)),
    )[6],
  ).toBe(0);
});

it("a heating group with no month gives the weight 1", () => {
  const winterOnly = shaped(() => 4).filter((m) => HEATING_SHARE[Number(m.month.slice(5)) - 1] === 1);
  const weights = seasonWeights("heating", winterOnly);
  expect(weights[0]).toBe(1);
  expect(weights[6]).toBe(1);
});

it("history weights use the same calendar month of the history, and 1 with no sample", () => {
  const lawn = seasonWeights(
    "history",
    shaped((i) => (i >= 4 && i <= 9 ? 12 : 0)),
  );
  expect(lawn).toEqual([0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0]);
  const short = seasonWeights("history", shaped(() => 3).slice(0, 2));
  expect(short.filter((w) => w === 1)).toHaveLength(12);
});

it("flat weights and a history of only zeros give 1 for every month, except snow", () => {
  expect(
    seasonWeights(
      "flat",
      shaped((i) => i),
    ),
  ).toEqual(Array.from({ length: 12 }, () => 1));
  for (const rule of ["heating", "history", "flat"] as const)
    expect(
      seasonWeights(
        rule,
        shaped(() => 0),
      ),
    ).toEqual(Array.from({ length: 12 }, () => 1));
  expect(
    seasonWeights(
      "snow",
      shaped(() => 0),
    )[6],
  ).toBe(0);
});
