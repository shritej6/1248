import {
  ForecastSchema,
  type CostEntry,
  type Month,
  type Range,
  type ReadyForecast,
} from "@vision/contracts";
import fc from "fast-check";
import { expect, it } from "vitest";
import { monthIndex, monthRange } from "../src/resources/calendar.js";
import {
  FORECAST_MONTHS,
  HOUR_VALUE_CENTS,
  HOUR_VALUE_TEXT,
  MIN_WEIGHT,
  buildForecast,
  forecastFrom,
} from "../src/resources/forecast.js";
import type { History } from "../src/resources/history.js";
import { HEATING_SHARE, SNOW_INCHES } from "../src/resources/seasons.js";
import { emptyState } from "../src/state.js";
import { playbook } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 22, 18, 0);
const FIRST = "2026-12";
const WINDOW = monthRange("2024-11", 24);

const historyOf = (need: string, jobs: (month: Month) => number, hoursPerJob = 1.5): History => ({
  from: "2024-11",
  to: "2026-10",
  syntheticMonths: 24,
  recordMonths: 0,
  needs: [
    {
      need,
      label: `Label of ${need}`,
      months: WINDOW.map((month) => ({ month, jobs: jobs(month), hours: jobs(month) * hoursPerJob })),
    },
  ],
});

const only = (forecast: ReadyForecast) => {
  const need = forecast.needs[0];
  if (need === undefined) return expect.unreachable("The forecast has no need.");
  return need;
};

const monthOf = (forecast: ReadyForecast, month: Month) =>
  only(forecast).months.find((m) => m.month === month);

const cost = (need: string, centsPerJob: number): CostEntry => ({
  need,
  centsPerJob,
  basis: "estimate",
  updatedAt: NOW,
});

it("the money and window constants are fixed", () => {
  expect(HOUR_VALUE_CENTS).toBe(3467);
  expect(HOUR_VALUE_TEXT).toBe("$34.67");
  expect(FORECAST_MONTHS).toBe(12);
  expect(MIN_WEIGHT).toBe(0.2);
});

it("a flat history of 10 jobs every month gives 10 jobs in every month, low to high", () => {
  const forecast = forecastFrom(
    historyOf("rides", () => 10),
    [],
    FIRST,
  );
  expect(forecast.months).toEqual(monthRange(FIRST, 12));
  expect(only(forecast).rule).toBe("flat");
  for (const month of only(forecast).months) expect(month.jobs).toEqual({ low: 10, likely: 10, high: 10 });
});

it("a snow history of 2 jobs for each inch peaks in January and is 0 in June", () => {
  const forecast = forecastFrom(
    historyOf("snow", (m) => 2 * (SNOW_INCHES[monthIndex(m)] ?? 0)),
    [],
    FIRST,
  );
  expect(only(forecast).rule).toBe("snow");
  expect(monthOf(forecast, "2027-01")?.jobs.likely).toBe(30);
  expect(monthOf(forecast, "2027-06")?.jobs).toEqual({ low: 0, likely: 0, high: 0 });
});

it("food with 23 jobs in the heating months and 18 in the others gives 23 in January and 18 in July", () => {
  const forecast = forecastFrom(
    historyOf("food", (m) => (HEATING_SHARE[monthIndex(m)] === 1 ? 23 : 18)),
    [],
    FIRST,
  );
  expect(only(forecast).rule).toBe("heating");
  expect(monthOf(forecast, "2027-01")?.jobs.likely).toBe(23);
  expect(monthOf(forecast, "2027-07")?.jobs.likely).toBe(18);
});

it("fewer than 4 usable months gives the band from 0.7 to 1.3", () => {
  const history = historyOf("rides", () => 10);
  const short = { ...history, needs: history.needs.map((n) => ({ ...n, months: n.months.slice(-3) })) };
  const forecast = forecastFrom(short, [], FIRST);
  for (const month of only(forecast).months) expect(month.jobs).toEqual({ low: 7, likely: 10, high: 13 });
});

it("a band from at least 4 ratios uses the 10th and 90th percentile and always holds 1", () => {
  const forecast = forecastFrom(
    historyOf("rides", (m) => (monthIndex(m) % 2 === 0 ? 8 : 12)),
    [],
    FIRST,
  );
  for (const month of only(forecast).months) expect(month.jobs).toEqual({ low: 8, likely: 10, high: 12 });
});

it("hours, the value of volunteer time and cash follow the jobs", () => {
  const forecast = forecastFrom(
    historyOf("rides", () => 10),
    [cost("rides", 2500)],
    FIRST,
  );
  const need = only(forecast);
  expect(need.hoursPerJob).toBe(1.5);
  expect(need.cost).toEqual({ centsPerJob: 2500, basis: "estimate" });
  expect(need.months[0]).toEqual({
    month: FIRST,
    jobs: { low: 10, likely: 10, high: 10 },
    hours: { low: 15, likely: 15, high: 15 },
    inKindCents: { low: 52005, likely: 52005, high: 52005 },
    cashCents: { low: 25000, likely: 25000, high: 25000 },
  });
  expect(need.total.cashCents).toEqual({ low: 300000, likely: 300000, high: 300000 });
  expect(forecast.total.inKindCents).toEqual({ low: 624060, likely: 624060, high: 624060 });
});

it("cash is null without a cost entry, and hours round to whole hours", () => {
  const forecast = forecastFrom(
    historyOf("jobs", () => 3, 4 / 3),
    [cost("rides", 2500)],
    FIRST,
  );
  const need = only(forecast);
  expect(need.cost).toBeNull();
  expect(need.total.cashCents).toBeNull();
  expect(need.hoursPerJob).toBe(1.33);
  expect(need.months[0]).toMatchObject({ hours: { low: 4, likely: 4, high: 4 }, cashCents: null });
});

it("a need with no jobs in its history forecasts 0 with 0 hours for each job", () => {
  const need = only(
    forecastFrom(
      historyOf("lawn", () => 0),
      [],
      FIRST,
    ),
  );
  expect(need.hoursPerJob).toBe(0);
  expect(need.total.jobs).toEqual({ low: 0, likely: 0, high: 0 });
});

const sum = (ranges: readonly Range[]): Range =>
  ranges.reduce((a, r) => ({ low: a.low + r.low, likely: a.likely + r.likely, high: a.high + r.high }), {
    low: 0,
    likely: 0,
    high: 0,
  });

const ordered = (r: Range | null): boolean =>
  r === null ||
  ([r.low, r.likely, r.high].every((v) => Number.isInteger(v) && v >= 0) &&
    r.low <= r.likely &&
    r.likely <= r.high);

const checkForecast = (forecast: ReadyForecast): void => {
  for (const need of forecast.needs) {
    for (const m of need.months)
      expect([m.jobs, m.hours, m.inKindCents, m.cashCents].every(ordered)).toBe(true);
    expect(need.total.jobs).toEqual(sum(need.months.map((m) => m.jobs)));
    expect(need.total.hours).toEqual(sum(need.months.map((m) => m.hours)));
  }
  expect(forecast.total.jobs).toEqual(sum(forecast.needs.map((n) => n.total.jobs)));
  expect(forecast.total.inKindCents).toEqual(sum(forecast.needs.map((n) => n.total.inKindCents)));
  expect(ForecastSchema.safeParse(forecast).success).toBe(true);
};

it("for any 24 months of jobs and every rule, ranges are ordered whole numbers and totals are sums", () => {
  const months = fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 24, maxLength: 24 });
  fc.assert(
    fc.property(
      fc.tuple(months, months, months, months),
      fc.integer({ min: 0, max: 10_000 }),
      (jobs, cents) => {
        const needs = ["snow", "food", "lawn", "rides"].map((need, k) => ({
          need,
          label: need,
          months: WINDOW.map((month, i) => ({
            month,
            jobs: jobs[k]?.[i] ?? 0,
            hours: (jobs[k]?.[i] ?? 0) * 1.7,
          })),
        }));
        const history = { ...historyOf("snow", () => 0), needs };
        checkForecast(forecastFrom(history, [cost("food", cents)], FIRST));
      },
    ),
  );
});

it("buildForecast forecasts the 12 months after the current Chicago month and is deterministic", () => {
  const input = { now: NOW, demo: true, events: [], state: emptyState(), playbook };
  const forecast = buildForecast(input, []);
  if (forecast.status !== "ready") return expect.unreachable("The demo forecast is not ready.");
  expect(forecast.months[0]).toBe("2026-12");
  expect(forecast.months.at(-1)).toBe("2027-11");
  expect(forecast.history).toEqual({ from: "2024-11", to: "2026-10", syntheticMonths: 24, recordMonths: 0 });
  expect(forecast.hourValueCents).toBe(3467);
  expect(forecast.needs).toHaveLength(13);
  expect(buildForecast(input, [])).toEqual(forecast);
  checkForecast(forecast);
});

it("buildForecast with demo off and a fresh ledger needs 12 months", () => {
  const input = { now: NOW, demo: false, events: [], state: emptyState(), playbook };
  expect(buildForecast(input, [])).toEqual({ status: "not_enough_history", recordMonths: 0, needed: 12 });
  expect(ForecastSchema.safeParse(buildForecast(input, [])).success).toBe(true);
});
