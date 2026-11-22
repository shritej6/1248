import { useId } from "react";
import { Button } from "react-aria-components";
import { writesLetter, type Match, type Resource } from "@vision/contracts";
import { classNames } from "../classNames.js";
import { StateChip, type ChipState } from "../StateChip/StateChip.js";
import type { NeedLabel } from "./CostEditor.js";
import { cautionWords, KIND_WORDS, PATH_WORDS, sourceWords, whyWords } from "./words.js";
import cards from "./Cards.module.css";
import styles from "./Resources.module.css";

const cx = classNames({ ...styles, ...cards });

function ChipList({ label, chips }: { label: string; chips: readonly ChipState[] }) {
  const id = useId();
  if (chips.length === 0) return null;
  return (
    <div className={cx("chipRow")}>
      <span id={id} className={cx("chipLabel")}>
        {label}
      </span>
      <ul className={cx("chips")} aria-labelledby={id}>
        {chips.map((chip, i) => (
          <li key={`${String(i)}-${chip.label}`}>
            <StateChip state={chip} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Score({ score }: { score: number }) {
  return (
    <div className={cx("score")}>
      <p className={cx("scoreText")}>
        <span className={cx("scoreLabel")}>Score</span>{" "}
        <span className={cx("scoreValue")}>{String(score)}</span>{" "}
        <span className={cx("scoreOf")}>of 100</span>
      </p>
      <span className={cx("meter")} aria-hidden="true">
        <span className={cx("meterFill")} style={{ width: `${String(score)}%` }} />
      </span>
    </div>
  );
}

type ItemProps = {
  match: Match;
  resource: Resource;
  labels: ReadonlyMap<string, string>;
  busy: boolean;
  onLetter: (resource: string) => void;
};

function MatchItem({ match, resource, labels, busy, onLetter }: ItemProps) {
  const titleId = useId();
  const why = match.why
    .map((w): ChipState => ({ label: whyWords(w, labels, resource), mark: "hollow_check", tone: "ok" }))
    .filter((chip) => chip.label !== "");
  const cautions = match.cautions.map((c): ChipState => ({
    label: cautionWords(c),
    mark: "triangle",
    tone: "crit",
  }));
  return (
    <li className={cx("match", match.path === "closed" ? "closed" : "")}>
      <Score score={match.score} />
      <div className={cx("matchBody")}>
        <h4 id={titleId} className={cx("name")}>
          {resource.name}
        </h4>
        <p className={cx("meta")}>
          <span className={cx("tag")}>{KIND_WORDS[resource.kind]}</span>
          <span>{PATH_WORDS[match.path]}</span>
        </p>
        <p className={cx("what")}>{resource.what}</p>
        <ChipList label="Why it fits" chips={why} />
        <ChipList label="Cautions" chips={cautions} />
        <MatchFooter resource={resource} busy={busy} onLetter={onLetter} />
      </div>
    </li>
  );
}

function MatchFooter({ resource, busy, onLetter }: Pick<ItemProps, "resource" | "busy" | "onLetter">) {
  const canWrite = writesLetter(resource);
  return (
    <div className={cx("matchFoot")}>
      <StateChip state={{ label: sourceWords(resource), mark: "dashed_diamond", tone: "dim" }} />
      <a
        className={cx("link")}
        href={resource.source.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open the source page of ${resource.name}, in a new tab`}
      >
        Open the source page
      </a>
      {canWrite ? (
        <Button
          className={cx("secondary")}
          aria-label={`Write a letter to ${resource.name}`}
          isDisabled={busy}
          onPress={() => {
            onLetter(resource.id);
          }}
        >
          Write a letter
        </Button>
      ) : null}
    </div>
  );
}

export type MatchListProps = {
  matches: readonly Match[];
  resources: readonly Resource[];
  needs: readonly NeedLabel[];
  busy: boolean;
  onLetter: (resource: string) => void;
};

export function MatchList({ matches, resources, needs, busy, onLetter }: MatchListProps) {
  const titleId = useId();
  const byId = new Map(resources.map((r) => [r.id, r]));
  const labels = new Map(needs.map((n) => [n.need, n.label]));
  return (
    <section className={cx("block")} aria-labelledby={titleId}>
      <h3 id={titleId} className={cx("heading")}>
        Matches
      </h3>
      <p className={cx("note")}>
        Code ranks each row of the catalog. Fit counts for 45 points, reach for 35 points and timing for 20
        points.
      </p>
      <ol className={cx("matches")} aria-label="Ranked matches">
        {matches.map((match) => {
          const resource = byId.get(match.resource);
          if (resource === undefined) return null;
          return (
            <MatchItem
              key={match.resource}
              match={match}
              resource={resource}
              labels={labels}
              busy={busy}
              onLetter={onLetter}
            />
          );
        })}
      </ol>
    </section>
  );
}
