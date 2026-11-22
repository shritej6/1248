import { useId, type ReactNode } from "react";
import type { ClockView } from "@vision/contracts";
import type { LiveHandle } from "../../live.js";
import type { Theme } from "../../router.js";
import { clockTime } from "../clockTime.js";
import { Offline } from "../Offline/Offline.js";
import { classNames } from "../classNames.js";
import styles from "./Shell.module.css";

const cx = classNames(styles);

export type ShellProps = {
  theme: Theme;
  section: string | null;
  live: LiveHandle | null;
  clock: ClockView | null;
  orgName: string | null;
  children: ReactNode;
};

const LIVE_WORDS = { live: "Live", connecting: "Connecting", offline: "Offline" } as const;

function StatusMark({ status }: { status: LiveHandle["status"] }) {
  return (
    <svg className={cx("mark")} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      {status === "offline" ? (
        <polygon points="4,0.5 7.5,7.5 0.5,7.5" />
      ) : (
        <circle cx="4" cy="4" r="3.25" className={status === "live" ? undefined : cx("hollow")} />
      )}
    </svg>
  );
}

export function ConnectionChip({ live }: { live: LiveHandle }) {
  const since = live.status === "offline" && live.since !== null ? ` since ${clockTime(live.since)}` : "";
  return (
    <span className={cx("chip", live.status)} role="status">
      <StatusMark status={live.status} />
      <span className={cx("label")}>{LIVE_WORDS[live.status]}</span>
      {since === "" ? null : <span className={cx("since")}>{since}</span>}
    </span>
  );
}

export function DemoClockBar({ clock }: { clock: ClockView }) {
  const pattern = useId();
  return (
    <div className={cx("demo")} role="note" aria-label="Demo clock is on">
      <svg className={cx("stripes")} aria-hidden="true" focusable="false">
        <defs>
          <pattern
            id={pattern}
            width="16"
            height="16"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect className={cx("stripe")} width="8" height="16" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${pattern})`} />
      </svg>
      <span className={cx("demoBox")}>
        <span className={cx("demoLabel")}>Demo clock</span>
        <span>
          sim <time>{clockTime(clock.now)}</time>
        </span>
        <span>
          real <time>{clockTime(clock.now - clock.offsetMs)}</time>
        </span>
      </span>
    </div>
  );
}

export function Shell({ theme, section, live, clock, orgName, children }: ShellProps) {
  return (
    <div className={cx("shell")}>
      {clock !== null && clock.offsetMs > 0 ? <DemoClockBar clock={clock} /> : null}
      <header className={cx(theme)}>
        {orgName === null ? null : <span className={cx("product")}>{orgName}</span>}
        {section === null ? null : <span className={cx("section")}>{section}</span>}
        <span className={cx("spacer")} />
        {live === null ? null : <ConnectionChip live={live} />}
      </header>
      {live?.status === "offline" ? <Offline theme={theme} onRetry={live.retry} /> : null}
      <main className={cx("main")}>{children}</main>
    </div>
  );
}
