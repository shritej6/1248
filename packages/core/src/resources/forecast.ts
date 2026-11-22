import type {
  CostEntry,
  Forecast,
  ForecastMonth,
  Month,
  NeedForecast,
  Range,
  ReadyForecast,
} from "@vision/contracts";
import { addMonths, chicagoMonth, monthIndex, monthRange } from "./calendar.js";
import {
  MIN_RECORD_MONTHS,
  buildHistory,
  type History,
  type HistoryInput,
  type HistoryMonth,
  type NeedHistory,
} from "./history.js";
import { seasonRule, seasonWeights } from "./seasons.js";

export const HOUR_VALUE_CENTS = 3467;
export const HOUR_VALUE_TEXT = "$34.67";
export const FORECAST_MONTHS = 12;
export const MIN_WEIGHT = 0.2;

const LEVEL_MONTHS = 12;
const BAND_MIN_RATIOS = 4;
const DEFAULT_BAND: Band = { low: 0.7, high: 1.3 };

type Band = { low: number; high: number };

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

const addRange = (a: Range, b: Range): Range => ({
  low: a.low + b.low,
  likely: a.likely + b.likely,
  high: a.high + b.high,
});

const sumRanges = (ranges: readonly Range[]): Range =>
  ranges.reduce(addRange, { low: 0, likely: 0, high: 0 });

const mapRange = (range: Range, change: (value: number) => number): Range => ({
  low: change(range.low),
  likely: change(range.likely),
  high: change(range.high),
});

const weightOf = (weights: readonly number[], month: Month): number => weights[monthIndex(month)] ?? 0;

const levelOf = (months: readonly HistoryMonth[], weights: readonly number[]): number => {
  const usable = months
    .slice(-LEVEL_MONTHS)
    .filter((m) => weightOf(weights, m.month) >= MIN_WEIGHT)
    .map((m) => m.jobs / weightOf(weights, m.month));
  return usable.length === 0 ? 0 : sum(usable) / usable.length;
};

const nearestRank = (sorted: readonly number[], percent: number): number => {
  const rank = Math.ceil((percent * sorted.length) / 100) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 1;
};

const bandOf = (months: readonly HistoryMonth[], weights: readonly number[], level: number): Band => {
  const ratios = months.flatMap((m) => {
    const expected = level * weightOf(weights, m.month);
    return weightOf(weights, m.month) >= MIN_WEIGHT && expected > 0 ? [m.jobs / expected] : [];
  });
  if (ratios.length < BAND_MIN_RATIOS) return DEFAULT_BAND;
  const sorted = [...ratios].sort((a, b) => a - b);
  return { low: Math.min(1, nearestRank(sorted, 10)), high: Math.max(1, nearestRank(sorted, 90)) };
};

const hoursPerJobOf = (months: readonly HistoryMonth[]): number => {
  const jobs = sum(months.map((m) => m.jobs));
  return jobs === 0 ? 0 : sum(months.map((m) => m.hours)) / jobs;
};

const monthForecast = (
  month: Month,
  expected: number,
  band: Band,
  hoursPerJob: number,
  cost: CostEntry | null,
): ForecastMonth => {
  const likely = Math.round(expected);
  const jobs = {
    low: Math.min(likely, Math.floor(expected * band.low)),
    likely,
    high: Math.max(likely, Math.ceil(expected * band.high)),
  };
  const hours = mapRange(jobs, (n) => Math.round(n * hoursPerJob));
  return {
    month,
    jobs,
    hours,
    inKindCents: mapRange(hours, (h) => h * HOUR_VALUE_CENTS),
    cashCents: cost === null ? null : mapRange(jobs, (n) => n * cost.centsPerJob),
  };
};

const needForecast = (need: NeedHistory, cost: CostEntry | null, months: readonly Month[]): NeedForecast => {
  const rule = seasonRule(need.need);
  const weights = seasonWeights(rule, need.months);
  const level = levelOf(need.months, weights);
  const band = bandOf(need.months, weights, level);
  const hoursPerJob = hoursPerJobOf(need.months);
  const rows = months.map((m) => monthForecast(m, level * weightOf(weights, m), band, hoursPerJob, cost));
  return {
    need: need.need,
    label: need.label,
    rule,
    hoursPerJob: Math.round(hoursPerJob * 100) / 100,
    cost: cost === null ? null : { centsPerJob: cost.centsPerJob, basis: cost.basis },
    months: rows,
    total: {
      jobs: sumRanges(rows.map((r) => r.jobs)),
      hours: sumRanges(rows.map((r) => r.hours)),
      inKindCents: sumRanges(rows.map((r) => r.inKindCents)),
      cashCents:
        cost === null ? null : sumRanges(rows.flatMap((r) => (r.cashCents === null ? [] : [r.cashCents]))),
    },
  };
};

export const forecastFrom = (history: History, costs: readonly CostEntry[], first: Month): ReadyForecast => {
  const months = monthRange(first, FORECAST_MONTHS);
  const needs = history.needs.map((need) =>
    needForecast(need, costs.find((c) => c.need === need.need) ?? null, months),
  );
  const { from, to, syntheticMonths, recordMonths } = history;
  return {
    status: "ready",
    history: { from, to, syntheticMonths, recordMonths },
    hourValueCents: HOUR_VALUE_CENTS,
    months,
    needs,
    total: {
      jobs: sumRanges(needs.map((n) => n.total.jobs)),
      hours: sumRanges(needs.map((n) => n.total.hours)),
      inKindCents: sumRanges(needs.map((n) => n.total.inKindCents)),
    },
  };
};

export const buildForecast = (input: HistoryInput, costs: readonly CostEntry[]): Forecast => {
  const history = buildHistory(input);
  if ("status" in history)
    return { status: "not_enough_history", recordMonths: history.recordMonths, needed: MIN_RECORD_MONTHS };
  return forecastFrom(history, costs, addMonths(chicagoMonth(input.now), 1));
};
