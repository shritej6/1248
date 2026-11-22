import { clockTime } from "../clockTime.js";
import { classNames } from "../classNames.js";
import styles from "./ClockText.module.css";

const cx = classNames(styles);

export type ClockTone = "normal" | "late" | "overdue";
export type Countdown = { text: string; tone: ClockTone };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const LATE_SHARE = 0.75;

export const CLOCK_LIMITS: Record<string, number> = {
  "Desk confirm": 15 * MINUTE,
  "Page answer": 3 * MINUTE,
  "Wave wait": 5 * MINUTE,
  "Start travel": 2 * HOUR,
  "Visit safety": HOUR,
  "Consent wait": 24 * HOUR,
  "Partner reply": 2 * HOUR,
  "GOT IT wait": 24 * HOUR,
};

const pad = (value: number) => String(value).padStart(2, "0");

function span(ms: number): string {
  if (ms >= HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    return `${String(Math.floor(minutes / 60))}:${pad(minutes % 60)} h`;
  }
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

export function countdown(dueAt: number, now: number, limitMs: number | null): Countdown {
  const left = dueAt - now;
  if (left < 0) return { text: `+${span(-left)}`, tone: "overdue" };
  const late = limitMs !== null && left <= limitMs * (1 - LATE_SHARE);
  return { text: span(left), tone: late ? "late" : "normal" };
}

const TONE_WORDS: Record<ClockTone, string | null> = { normal: null, late: "LATE", overdue: "OVERDUE" };

export type ClockTextProps = {
  label: string | null;
  dueAt: number;
  now: number;
  limitMs?: number | null;
  syncedAt?: number | null;
};

export function ClockText({ label, dueAt, now, limitMs, syncedAt = null }: ClockTextProps) {
  const limit = limitMs === undefined ? (label === null ? null : (CLOCK_LIMITS[label] ?? null)) : limitMs;
  const { text, tone } = countdown(dueAt, now, limit);
  const word = TONE_WORDS[tone];
  return (
    <span className={cx("clock", tone, syncedAt === null ? "" : "stale")}>
      {label === null ? null : <span className={cx("label")}>{label}</span>}
      <time className={cx("value")} dateTime={new Date(dueAt).toISOString()}>
        {text}
      </time>
      <span className={cx("word")} aria-live="polite">
        {word}
      </span>
      {syncedAt === null ? null : <span className={cx("sync")}>last sync {clockTime(syncedAt)}</span>}
    </span>
  );
}
