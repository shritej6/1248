import { dayTime } from "../clockTime.js";
import { classNames } from "../classNames.js";
import styles from "./Timeline.module.css";

const cx = classNames(styles);

export type TimelineStep = { word: string; at: number };
export type TimelineProps = { steps: TimelineStep[]; now: number; label: string };

function DoneMark() {
  return (
    <svg className={cx("mark")} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="6.5" />
    </svg>
  );
}

export function Timeline({ steps, now, label }: TimelineProps) {
  const last = steps.length - 1;
  return (
    <ol className={cx("steps")} aria-label={label}>
      {steps.map((step, index) => (
        <li
          key={`${step.word}-${String(step.at)}`}
          className={cx("step")}
          aria-current={index === last ? "step" : undefined}
        >
          <DoneMark />
          <span className={cx("word")}>{step.word}</span>
          <time className={cx("time")} dateTime={new Date(step.at).toISOString()}>
            {dayTime(step.at, now)}
          </time>
        </li>
      ))}
    </ol>
  );
}
