import type { Month, SeasonRule } from "@vision/contracts";
import { monthIndex } from "./calendar.js";

type MonthJobs = { month: Month; jobs: number };

const CALENDAR = Array.from({ length: 12 }, (_, i) => i);

export const SNOW_INCHES: readonly number[] = [14.9, 11.8, 6.7, 2.1, 0, 0, 0, 0, 0, 0.3, 2.5, 10.4];
export const SNOW_MEAN = 48.7 / 12;
export const HEATING_SHARE: readonly number[] = [1, 1, 1, 1, 0.48, 0, 0, 0, 0, 1, 1, 1];

const RULES = new Map<string, SeasonRule>([
  ["snow", "snow"],
  ["shelter", "heating"],
  ["food", "heating"],
  ["lawn", "history"],
  ["cleanup", "history"],
  ["youth_stipend", "history"],
]);

export const seasonRule = (need: string): SeasonRule => RULES.get(need) ?? "flat";

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

const ratio = (months: readonly MonthJobs[], keep: (index: number) => boolean, all: number): number => {
  const picked = months.filter((m) => keep(monthIndex(m.month)));
  return picked.length === 0 ? 1 : mean(picked.map((m) => m.jobs)) / all;
};

export const seasonWeights = (rule: SeasonRule, months: readonly MonthJobs[]): number[] => {
  if (rule === "snow") return SNOW_INCHES.map((inches) => inches / SNOW_MEAN);
  const all = mean(months.map((m) => m.jobs));
  if (rule === "flat" || all === 0) return CALENDAR.map(() => 1);
  if (rule === "heating") {
    const inside = ratio(months, (i) => HEATING_SHARE[i] === 1, all);
    const outside = ratio(months, (i) => HEATING_SHARE[i] === 0, all);
    return HEATING_SHARE.map((share) => share * inside + (1 - share) * outside);
  }
  return CALENDAR.map((i) => ratio(months, (index) => index === i, all));
};
