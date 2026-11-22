const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
});

export function clockTime(at: number): string {
  return TIME.format(at).replace(/\s/gu, " ");
}

const DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/Chicago",
});
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Chicago" });
const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/Chicago",
});
const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Chicago",
});
const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

export function dayTime(at: number, now: number): string {
  const time = clockTime(at);
  if (DAY_KEY.format(at) === DAY_KEY.format(now)) return `Today ${time}`;
  if (Math.abs(now - at) <= WEEK_MS) return `${WEEKDAY.format(at)} ${time}`;
  return `${MONTH_DAY.format(at)} ${time}`;
}

export function longDate(at: number): string {
  return FULL_DATE.format(at);
}

export function dateTime(at: number): string {
  return `${MONTH_DAY.format(at)} ${clockTime(at)}`;
}
