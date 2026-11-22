import { useState } from "react";
import { Button } from "react-aria-components";
import type { OrgView } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { classNames } from "../classNames.js";
import { useDeskCommand, type DeskSend } from "../deskCommand.js";
import styles from "./DemoClock.module.css";

const cx = classNames(styles);

type Minutes = 15 | 60 | 1440 | 4320;

const JUMPS: { minutes: Minutes; label: string }[] = [
  { minutes: 15, label: "+15 min" },
  { minutes: 60, label: "+1 hour" },
  { minutes: 1440, label: "+1 day" },
  { minutes: 4320, label: "+3 days" },
];

const MINUTE_MS = 60_000;

export function offsetWords(offsetMs: number): string {
  const minutes = Math.floor(offsetMs / MINUTE_MS);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return `${String(days)} d ${String(hours)} h ${String(rest)} min ahead of real time`;
}

export type DemoClockProps = { demo: OrgView["demo"]; send: DeskSend };

export function DemoClock({ demo, send }: DemoClockProps) {
  const command = useDeskCommand(send);
  const [jumps, setJumps] = useState<string[]>([]);
  if (!demo.mode) return <p className={cx("off")}>Demo mode is off. The clock follows real time.</p>;
  const jump = async (minutes: Minutes, label: string) => {
    if (await command.run({ id: newCommandId(), type: "clock.jump", minutes })) {
      setJumps((previous) => [...previous, `Demo jump ${label}`]);
    }
  };
  return (
    <section className={cx("demo")} aria-label="Demo clock">
      <p className={cx("offset")}>{offsetWords(demo.offsetMs)}</p>
      <div className={cx("jumps")}>
        {JUMPS.map((item) => (
          <Button
            key={item.minutes}
            className={cx("secondary")}
            isDisabled={command.busy}
            onPress={() => void jump(item.minutes, item.label)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <p className={cx("hint")}>Each jump fires every clock that falls due, in order.</p>
      {command.state.kind === "failed" ? (
        <p role="alert" className={cx("error")}>
          {command.state.message}
        </p>
      ) : null}
      {jumps.length === 0 ? null : (
        <ul className={cx("trail")} aria-label="Demo jumps">
          {jumps.map((line, index) => (
            <li key={`${line}-${String(index)}`}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
