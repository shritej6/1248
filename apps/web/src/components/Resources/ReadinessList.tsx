import { useId } from "react";
import { Button } from "react-aria-components";
import type { Readiness, ReadinessItem } from "@vision/contracts";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import { READINESS_ITEMS, READINESS_WORDS } from "./words.js";
import cards from "./Cards.module.css";
import styles from "./Resources.module.css";

const cx = classNames({ ...styles, ...cards });

type RowProps = {
  item: ReadinessItem;
  current: string;
  busy: boolean;
  onSet: (item: ReadinessItem, state: string) => void;
};

function ReadinessRow({ item, current, busy, onSet }: RowProps) {
  const titleId = useId();
  const words = READINESS_WORDS[item];
  const states: [string, string][] = Object.entries(words.states);
  return (
    <li className={cx("readyItem")}>
      <h4 id={titleId} className={cx("name")}>
        {words.label}
      </h4>
      <p className={cx("reason")}>{words.reason}</p>
      <div className={cx("choices")} role="group" aria-labelledby={titleId}>
        {states.map(([state, text]) => {
          const chosen = state === current;
          return (
            <Button
              key={state}
              aria-label={`Set ${words.label} to ${text}${chosen ? ", current" : ""}`}
              aria-pressed={chosen}
              className={cx("choice", chosen ? "chosen" : "")}
              isDisabled={busy}
              onPress={() => {
                if (!chosen) onSet(item, state);
              }}
            >
              {chosen ? <ShapeMark mark="filled_square" /> : null}
              {text}
            </Button>
          );
        })}
      </div>
    </li>
  );
}

export type ReadinessListProps = {
  readiness: Readiness;
  busy: boolean;
  onSet: (item: ReadinessItem, state: string) => void;
};

export function ReadinessList({ readiness, busy, onSet }: ReadinessListProps) {
  const titleId = useId();
  return (
    <section className={cx("block")} aria-labelledby={titleId}>
      <h3 id={titleId} className={cx("heading")}>
        Readiness
      </h3>
      <p className={cx("note")}>Mark the state of each item. The match uses these states.</p>
      <ul className={cx("readiness")}>
        {READINESS_ITEMS.map((item) => (
          <ReadinessRow key={item} item={item} current={readiness[item]} busy={busy} onSet={onSet} />
        ))}
      </ul>
    </section>
  );
}
