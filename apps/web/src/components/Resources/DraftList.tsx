import { useId, useState } from "react";
import { Button } from "react-aria-components";
import type { DraftView, Month, Resource, ResourcesView } from "@vision/contracts";
import { monthLabel } from "@vision/core";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import { DraftCard } from "./DraftCard.js";
import { NEVER_SENDS } from "./words.js";
import cards from "./Cards.module.css";
import styles from "./Resources.module.css";

const cx = classNames({ ...styles, ...cards });

type WriteProps = {
  draftMonths: readonly Month[];
  drafting: ResourcesView["drafting"];
  busy: boolean;
  onWrite: (month: Month) => void;
};

function WriteBar({ draftMonths, drafting, busy, onWrite }: WriteProps) {
  const id = useId();
  const [month, setMonth] = useState(draftMonths[0] ?? "");
  const shown = draftMonths.includes(month) ? month : (draftMonths[0] ?? month);
  const used = `Drafts today: ${String(drafting.usedToday)} of ${String(drafting.cap)}`;
  return (
    <div className={cx("bar")}>
      <label className={cx("label")} htmlFor={id}>
        Month
      </label>
      <select
        id={id}
        className={cx("select")}
        value={shown}
        onChange={(e) => {
          setMonth(e.target.value);
        }}
      >
        {draftMonths.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <Button
        className={cx("primary")}
        isDisabled={busy}
        onPress={() => {
          onWrite(shown);
        }}
      >
        Write the impact post
      </Button>
      <p className={cx("count")} role="status">
        {used}
      </p>
    </div>
  );
}

export type DraftListProps = WriteProps & {
  drafts: readonly DraftView[];
  resources: readonly Resource[];
  fresh: string | null;
  onApprove: (draft: string) => void;
};

const funderOf = (draft: DraftView, names: ReadonlyMap<string, string>): string | null => {
  if (draft.resource === null) return null;
  return names.get(draft.resource) ?? draft.facts.find((f) => f.key === "funder")?.text ?? draft.resource;
};

export function DraftList(props: DraftListProps) {
  const titleId = useId();
  const names = new Map(props.resources.map((r) => [r.id, r.name]));
  return (
    <section className={cx("block")} aria-labelledby={titleId}>
      <h3 id={titleId} className={cx("heading")}>
        Drafts
      </h3>
      <p className={cx("never")}>
        <ShapeMark mark="hollow_check" />
        <span>{NEVER_SENDS}</span>
      </p>
      <WriteBar
        draftMonths={props.draftMonths}
        drafting={props.drafting}
        busy={props.busy}
        onWrite={props.onWrite}
      />
      {props.drafts.length === 0 ? <p className={cx("note")}>No drafts yet.</p> : null}
      <ul className={cx("drafts")}>
        {props.drafts.map((draft) => (
          <li key={draft.id}>
            <DraftCard
              draft={draft}
              resourceName={funderOf(draft, names)}
              busy={props.busy}
              fresh={draft.id === props.fresh}
              onApprove={props.onApprove}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
