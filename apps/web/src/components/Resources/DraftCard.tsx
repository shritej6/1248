import { useEffect, useId, useRef, useState } from "react";
import { Button } from "react-aria-components";
import type { DraftFact, DraftView } from "@vision/contracts";
import { monthLabel } from "@vision/core";
import { classNames } from "../classNames.js";
import { StateChip } from "../StateChip/StateChip.js";
import {
  AI_WORDS,
  DRAFT_KIND_WORDS,
  DRAFT_STATUS_CHIPS,
  FLAG_WORDS,
  reasonsWords,
  TEMPLATE_WORDS,
} from "./words.js";
import cards from "./Cards.module.css";
import styles from "./Resources.module.css";

const cx = classNames({ ...styles, ...cards });

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "unknown");

function titleOf(draft: DraftView, resourceName: string | null): string {
  const month = monthLabel(draft.month);
  return resourceName === null
    ? `${DRAFT_KIND_WORDS[draft.kind]}, ${month}`
    : `${DRAFT_KIND_WORDS[draft.kind]} to ${resourceName}, ${month}`;
}

function DraftSource({ draft }: { draft: DraftView }) {
  if (draft.source === null) return null;
  const words =
    draft.source === "ai" ? AI_WORDS : draft.flag === null ? TEMPLATE_WORDS : FLAG_WORDS[draft.flag];
  return (
    <div className={cx("source")}>
      <span className={cx("tag")}>{draft.source === "ai" ? "AI" : "Template"}</span>
      <p>{words}</p>
      {draft.reasons.length === 0 ? null : <p className={cx("note")}>{reasonsWords(draft.reasons)}</p>}
    </div>
  );
}

function FactList({ facts }: { facts: readonly DraftFact[] }) {
  return (
    <details className={cx("details")}>
      <summary className={cx("summary")}>Facts the draft may use</summary>
      <dl className={cx("facts")}>
        {facts.map((fact) => (
          <div key={fact.key} className={cx("fact")}>
            <dt>{fact.label}</dt>
            <dd className={cx("num")}>{fact.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function saveText(draft: DraftView, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `vision-${draft.kind}-${draft.month}.txt`;
  link.click();
  URL.revokeObjectURL(href);
}

type CopyState = "idle" | "copied" | "failed";

function CopyText({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const copy = () => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => {
          setState("copied");
        },
        (error: unknown) => {
          console.warn(`resources: copy did not work (${errorName(error)})`);
          setState("failed");
        },
      );
  };
  return (
    <>
      <Button className={cx("secondary")} onPress={copy}>
        Copy text
      </Button>
      {state === "copied" ? (
        <span role="status" className={cx("okText")}>
          Copied
        </span>
      ) : null}
      {state === "failed" ? (
        <span role="alert" className={cx("error")}>
          Copy did not work. Select the text and copy it.
        </span>
      ) : null}
    </>
  );
}

function Approved({ draft, text }: { draft: DraftView; text: string }) {
  return (
    <div className={cx("approved")}>
      <p>{`Approved by ${draft.approvedBy?.name ?? "an organiser"}`}</p>
      <p className={cx("note")}>
        Fingerprint in the ledger <code className={cx("hash")}>{(draft.textHash ?? "").slice(0, 12)}</code>
      </p>
      <div className={cx("actions")}>
        <CopyText text={text} />
        <Button
          className={cx("secondary")}
          onPress={() => {
            saveText(draft, text);
          }}
        >
          Download text
        </Button>
      </div>
    </div>
  );
}

type ActionProps = { draft: DraftView; busy: boolean; onApprove: (draft: string) => void };

function DraftActions({ draft, busy, onApprove }: ActionProps) {
  if (draft.text === null) return null;
  if (draft.status === "approved") return <Approved draft={draft} text={draft.text} />;
  if (draft.status !== "ready") return null;
  return (
    <div className={cx("approve")}>
      <p className={cx("note")}>
        Read the text and the facts first. Approve puts your name and a fingerprint of the text in the ledger.
      </p>
      <Button
        className={cx("primary")}
        isDisabled={busy}
        onPress={() => {
          onApprove(draft.id);
        }}
      >
        Approve
      </Button>
    </div>
  );
}

function useFreshFocus(fresh: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (fresh) ref.current?.focus();
  }, [fresh]);
  return ref;
}

export type DraftCardProps = {
  draft: DraftView;
  resourceName: string | null;
  busy: boolean;
  fresh: boolean;
  onApprove: (draft: string) => void;
};

export function DraftCard({ draft, resourceName, busy, fresh, onApprove }: DraftCardProps) {
  const titleId = useId();
  const ref = useFreshFocus(fresh);
  return (
    <article ref={ref} tabIndex={-1} className={cx("draft")} aria-labelledby={titleId}>
      <header className={cx("draftHead")}>
        <h4 id={titleId} className={cx("name")}>
          {titleOf(draft, resourceName)}
        </h4>
        <span role="status">
          <StateChip state={DRAFT_STATUS_CHIPS[draft.status]} />
        </span>
      </header>
      <DraftSource draft={draft} />
      <FactList facts={draft.facts} />
      {draft.text === null ? (
        <p className={cx("note")}>Vision is writing the draft. The text shows here in a few seconds.</p>
      ) : (
        <pre className={cx("text")}>{draft.text}</pre>
      )}
      <DraftActions draft={draft} busy={busy} onApprove={onApprove} />
    </article>
  );
}
