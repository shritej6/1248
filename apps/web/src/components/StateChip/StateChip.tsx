import type { ReactElement } from "react";
import type { JobStatus } from "@vision/contracts";
import { classNames } from "../classNames.js";
import styles from "./StateChip.module.css";

const cx = classNames(styles);

export type Mark =
  | "hollow_circle"
  | "half_circle"
  | "filled_circle"
  | "hollow_square"
  | "filled_square"
  | "chevron"
  | "chevron_bar"
  | "hourglass"
  | "hollow_check"
  | "filled_check"
  | "triangle"
  | "dashed_square"
  | "dashed_diamond";
export type Tone = "grey" | "strong" | "dim" | "ok" | "crit";
export type ChipState = { label: string; mark: Mark; tone: Tone };

export const CARD_NEW: ChipState = { label: "NEW", mark: "hollow_circle", tone: "grey" };
export const CARD_SORTED: ChipState = { label: "SORTED", mark: "half_circle", tone: "grey" };

const WAITING: ChipState = { label: "WAITING FOR PARTNER", mark: "hourglass", tone: "grey" };

export const JOB_STATES: Record<JobStatus, ChipState> = {
  planned: { label: "CONFIRMED", mark: "filled_circle", tone: "strong" },
  offered: { label: "OFFERED", mark: "hollow_square", tone: "strong" },
  accepted: { label: "ACCEPTED", mark: "filled_square", tone: "strong" },
  on_my_way: { label: "ON MY WAY", mark: "chevron", tone: "strong" },
  there: { label: "THERE", mark: "chevron_bar", tone: "strong" },
  done: { label: "DONE, CHECKING", mark: "hollow_check", tone: "ok" },
  consent_asked: WAITING,
  partner_asked: WAITING,
  partner_yes: WAITING,
  got_it: WAITING,
  mismatch: { label: "MISMATCH", mark: "triangle", tone: "crit" },
  partly: { label: "PARTLY DONE", mark: "hollow_check", tone: "grey" },
  unmet: { label: "UNMET", mark: "dashed_square", tone: "grey" },
  helped: { label: "HELPED", mark: "filled_check", tone: "ok" },
  unreached: { label: "UNREACHED", mark: "dashed_diamond", tone: "dim" },
  withdrawn: { label: "WITHDRAWN", mark: "dashed_diamond", tone: "dim" },
};

const SHAPES: Record<Mark, ReactElement> = {
  hollow_circle: <circle cx="4" cy="4" r="3.25" className={cx("line")} />,
  half_circle: (
    <>
      <circle cx="4" cy="4" r="3.25" className={cx("line")} />
      <path d="M4 0.75 A3.25 3.25 0 0 0 4 7.25 Z" />
    </>
  ),
  filled_circle: <circle cx="4" cy="4" r="3.5" />,
  hollow_square: <rect x="1" y="1" width="6" height="6" className={cx("line")} />,
  filled_square: <rect x="0.5" y="0.5" width="7" height="7" />,
  chevron: <polyline points="2,0.75 6,4 2,7.25" className={cx("line")} />,
  chevron_bar: (
    <>
      <polygon points="0.5,0.5 5,4 0.5,7.5" />
      <rect x="6" y="0.5" width="1.5" height="7" />
    </>
  ),
  hourglass: <polygon points="0.75,0.5 7.25,0.5 0.75,7.5 7.25,7.5" />,
  hollow_check: <polyline points="0.75,4.25 3,6.5 7.25,1.5" className={cx("line")} />,
  filled_check: (
    <>
      <circle cx="4" cy="4" r="3.75" />
      <polyline points="2,4.25 3.5,5.75 6,2.5" className={cx("cut")} />
    </>
  ),
  triangle: <polygon points="4,0.5 7.5,7.5 0.5,7.5" />,
  dashed_square: <rect x="1" y="1" width="6" height="6" className={cx("line", "dash")} />,
  dashed_diamond: <polygon points="4,0.5 7.5,4 4,7.5 0.5,4" className={cx("line", "dash")} />,
};

export function ShapeMark({ mark }: { mark: Mark }) {
  return (
    <svg className={cx("mark")} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      {SHAPES[mark]}
    </svg>
  );
}

export function StateChip({ state, emergency = false }: { state: ChipState; emergency?: boolean }) {
  return (
    <span className={cx("chip", state.tone, emergency ? "emergency" : "")}>
      <ShapeMark mark={state.mark} />
      <span className={cx("label")}>{state.label}</span>
    </span>
  );
}
