import type { Month } from "@vision/contracts";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DAY_MS = 86_400_000;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const CHICAGO_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" });

const parseMonth = (month: string): { year: number; index: number } => {
  const match = MONTH.exec(month);
  if (match === null) throw new RangeError(`The month "${month}" is not in the form YYYY-MM.`);
  return { year: Number(match[1]), index: Number(match[2]) - 1 };
};

const parseDate = (date: string): number => {
  const match = DATE.exec(date);
  const at = match === null ? Number.NaN : Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (match === null || new Date(at).getUTCDate() !== Number(match[3]))
    throw new RangeError(`The date "${date}" is not a real date in the form YYYY-MM-DD.`);
  return at;
};

const nameOf = (index: number): string => MONTH_NAMES[index] ?? "";

export const chicagoDate = (at: number): string => CHICAGO_DATE.format(new Date(at));

export const chicagoMonth = (at: number): Month => chicagoDate(at).slice(0, 7);

export const addMonths = (month: Month, n: number): Month => {
  const { year, index } = parseMonth(month);
  if (!Number.isInteger(n)) throw new RangeError(`The step ${String(n)} is not a whole number of months.`);
  const total = year * 12 + index + n;
  const nextYear = Math.floor(total / 12);
  return `${String(nextYear).padStart(4, "0")}-${String(total - nextYear * 12 + 1).padStart(2, "0")}`;
};

export const monthRange = (from: Month, count: number): Month[] => {
  parseMonth(from);
  return Array.from({ length: count }, (_, i) => addMonths(from, i));
};

export const monthIndex = (month: Month): number => parseMonth(month).index;

export const monthLabel = (month: Month): string => {
  const { year, index } = parseMonth(month);
  return `${nameOf(index)} ${String(year)}`;
};

export const dateLabel = (date: string): string => {
  const at = new Date(parseDate(date));
  return `${String(at.getUTCDate())} ${nameOf(at.getUTCMonth())} ${String(at.getUTCFullYear())}`;
};

export const daysBetween = (from: string, to: string): number =>
  Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
