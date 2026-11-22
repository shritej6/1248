import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import type { CostSet, DraftKind, Month, ReadinessItem, ResourcesView } from "@vision/contracts";
import { dateLabel } from "@vision/core";
import {
  newDraftId,
  type ResourcesAction,
  type ResourcesClient,
  type ResourcesOutcome,
} from "../../resourcesApi.js";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import { DraftList } from "./DraftList.js";
import { ForecastPanel } from "./ForecastPanel.js";
import { MatchList } from "./MatchList.js";
import { ReadinessList } from "./ReadinessList.js";
import { NO_AI_NOTICE } from "./words.js";
import styles from "./Resources.module.css";

const cx = classNames(styles);

export const POLL_MS = 2_000;
export const POLL_MAX = 30;

type SectionError = { message: string; from: "load" | "post" };

type SectionState =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; view: ResourcesView; busy: boolean; error: SectionError | null };

type Post = (action: ResourcesAction, body: unknown) => Promise<boolean>;

function afterLoad(prev: SectionState, outcome: ResourcesOutcome): SectionState {
  if (!outcome.ok) {
    return prev.state === "ready"
      ? { ...prev, error: { message: outcome.message, from: "load" } }
      : { state: "failed", message: outcome.message };
  }
  if (prev.state !== "ready") return { state: "ready", view: outcome.view, busy: false, error: null };
  return { ...prev, view: outcome.view, error: prev.error?.from === "post" ? prev.error : null };
}

function afterPost(prev: SectionState, outcome: ResourcesOutcome): SectionState {
  if (outcome.ok) return { state: "ready", view: outcome.view, busy: false, error: null };
  return prev.state === "ready"
    ? { ...prev, busy: false, error: { message: outcome.message, from: "post" } }
    : prev;
}

const writingIds = (section: SectionState): string =>
  section.state === "ready"
    ? section.view.drafts
        .filter((d) => d.status === "writing")
        .map((d) => d.id)
        .join(" ")
    : "";

function usePoll(writing: string, load: () => void): void {
  useEffect(() => {
    if (writing === "") return undefined;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      if (count >= POLL_MAX) clearInterval(timer);
      load();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [writing, load]);
}

function useResources(client: ResourcesClient) {
  const [section, setSection] = useState<SectionState>({ state: "loading" });
  const asked = useRef(0);
  const lastPost = useRef(0);
  const load = useCallback(() => {
    asked.current += 1;
    const seq = asked.current;
    void client.load().then((outcome) => {
      if (seq > lastPost.current) setSection((prev) => afterLoad(prev, outcome));
    });
  }, [client]);
  const retry = useCallback(() => {
    setSection({ state: "loading" });
    load();
  }, [load]);
  const post = useCallback<Post>(
    async (action, body) => {
      asked.current += 1;
      lastPost.current = asked.current;
      setSection((prev) => (prev.state === "ready" ? { ...prev, busy: true, error: null } : prev));
      const outcome = await client.post(action, body);
      setSection((prev) => afterPost(prev, outcome));
      return outcome.ok;
    },
    [client],
  );
  useEffect(load, [load]);
  usePoll(writingIds(section), load);
  return { section, retry, post };
}

const factsWords = (view: ResourcesView): string => {
  const facts = `Funder facts are real and were checked on ${dateLabel(view.catalog.checked)}.`;
  const synthetic = view.forecast.status === "ready" ? view.forecast.history.syntheticMonths : 0;
  if (!view.demo) return facts;
  if (synthetic === 0) return `Demo mode. ${facts}`;
  return `Demo mode. The forecast uses ${String(synthetic)} months of synthetic history. ${facts}`;
};

function Notices({ view }: { view: ResourcesView }) {
  return (
    <ul className={cx("notices")} aria-label="Notices">
      <li className={cx("notice")}>{factsWords(view)}</li>
      <li className={cx("notice")}>{NO_AI_NOTICE}</li>
    </ul>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <p role="alert" className={cx("alert")}>
      <ShapeMark mark="triangle" />
      <span>{message}</span>
    </p>
  );
}

function useAsk(post: Post) {
  const [fresh, setFresh] = useState<string | null>(null);
  const ask = (kind: DraftKind, month: Month, resource: string | null) => {
    const draft = newDraftId();
    void post("drafts", { draft, kind, month, resource }).then((done) => {
      if (done) setFresh(draft);
    });
  };
  return { fresh, ask };
}

type ReadyProps = { view: ResourcesView; busy: boolean; error: string | null; post: Post };

function ResourcesReady({ view, busy, error, post }: ReadyProps) {
  const { fresh, ask } = useAsk(post);
  const onSet = (item: ReadinessItem, state: string) => void post("readiness", { item, state });
  return (
    <div className={cx("resources")}>
      {error === null ? null : <Problem message={error} />}
      <Notices view={view} />
      <ForecastPanel
        forecast={view.forecast}
        needs={view.needs}
        costs={view.costs}
        busy={busy}
        onSaveCost={(set: CostSet) => void post("costs", set)}
      />
      <MatchList
        matches={view.matches}
        resources={view.resources}
        needs={view.needs}
        busy={busy}
        onLetter={(resource) => {
          ask("funder_letter", view.month, resource);
        }}
      />
      <ReadinessList readiness={view.readiness} busy={busy} onSet={onSet} />
      <DraftList
        drafts={view.drafts}
        draftMonths={view.draftMonths}
        resources={view.resources}
        drafting={view.drafting}
        busy={busy}
        fresh={fresh}
        onWrite={(month) => {
          ask("impact_post", month, null);
        }}
        onApprove={(draft) => void post("approve", { draft })}
      />
    </div>
  );
}

export function ResourcesSection({ client }: { client: ResourcesClient }) {
  const { section, retry, post } = useResources(client);
  if (section.state === "loading") return <p role="status">Loading</p>;
  if (section.state === "failed") {
    return (
      <div className={cx("failed")}>
        <Problem message={section.message} />
        <Button className={cx("secondary")} onPress={retry}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <ResourcesReady
      view={section.view}
      busy={section.busy}
      error={section.error?.message ?? null}
      post={post}
    />
  );
}
