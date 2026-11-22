export type TimeZone = "America/Chicago";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const PART_FORMAT: Intl.DateTimeFormatOptions = {
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
};

const offsetAt = (instant: number, tz: TimeZone): number => {
  const parts = new Intl.DateTimeFormat("en-US", { ...PART_FORMAT, timeZone: tz }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return wall - instant;
};

const firstMidnight = (year: number, monthIndex: number, tz: TimeZone): number => {
  const wall = Date.UTC(year, monthIndex, 1);
  return wall - offsetAt(wall - offsetAt(wall, tz), tz);
};

export const monthBounds = (month: string, tz: TimeZone): { start: number; end: number } => {
  const match = MONTH.exec(month);
  if (match === null) throw new RangeError(`The month "${month}" is not in the form YYYY-MM.`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return { start: firstMidnight(year, monthIndex, tz), end: firstMidnight(year, monthIndex + 1, tz) };
};
