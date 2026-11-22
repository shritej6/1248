import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { OrgViewSchema, type LedgerEvent, type OrgView } from "@vision/contracts";
import { statement } from "@vision/core";
import { ApiError, type Auth, type GoogleOutcome } from "../api.js";
import type { ResourcesClient } from "../resourcesApi.js";
import { useView, type OpenSocket, type ViewState } from "../live.js";
import { orgNameOf } from "../orgName.js";
import { readSession } from "../session.js";
import { DemoClock } from "../components/DemoClock/DemoClock.js";
import { Offline } from "../components/Offline/Offline.js";
import { MembersTable, PartnersTable, type MakeJoinCode } from "../components/PeopleTable/PeopleTable.js";
import { PlaybookTable } from "../components/PlaybookTable/PlaybookTable.js";
import { Rehearsal } from "../components/Rehearsal/Rehearsal.js";
import { ResourcesSection } from "../components/Resources/ResourcesSection.js";
import { SealCheck } from "../components/SealCheck/SealCheck.js";
import { FinishList, UnmetShelf } from "../components/ShelfList/ShelfList.js";
import { Shell } from "../components/Shell/Shell.js";
import { StatementTable } from "../components/StatementTable/StatementTable.js";
import { classNames } from "../components/classNames.js";
import type { DeskSend } from "../components/deskCommand.js";
import { useOrgActions, type AskGoogle, type LoadLedger } from "./orgActions.js";
import styles from "./OrgPage.module.css";

export type { AskGoogle, LoadLedger };

const cx = classNames(styles);

type GoogleState =
  { state: "idle" } | { state: "busy" } | { state: "done" } | { state: "failed"; message: string };

type GoogleButtonProps = { label: string; done: string; run: () => Promise<GoogleOutcome> };

function GoogleButton({ label, done, run }: GoogleButtonProps) {
  const [status, setStatus] = useState<GoogleState>({ state: "idle" });
  const press = () => {
    setStatus({ state: "busy" });
    void run().then((outcome) => {
      setStatus(outcome.ok ? { state: "done" } : { state: "failed", message: outcome.message });
    });
  };
  return (
    <>
      <Button className={cx("secondary")} isDisabled={status.state === "busy"} onPress={press}>
        {label}
      </Button>
      {status.state === "busy" ? <p role="status">Working</p> : null}
      {status.state === "done" ? <p role="status">{done}</p> : null}
      {status.state === "failed" ? (
        <p role="alert" className={cx("error")}>
          {status.message}
        </p>
      ) : null}
    </>
  );
}

type Ledger =
  { state: "loading" } | { state: "ready"; events: LedgerEvent[] } | { state: "failed"; message: string };

const MONTH_KEY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  timeZone: "America/Chicago",
});
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

export const monthOf = (at: number): string => MONTH_KEY.format(at).slice(0, 7);

function ledgerWords(error: unknown): string {
  if (error instanceof ApiError && error.code === "network")
    return "The ledger did not load. No connection. Try again.";
  if (error instanceof ApiError && (error.code === "forbidden" || error.code === "unauthorized")) {
    return "Only an organiser can read the ledger.";
  }
  return "The ledger did not load. Try again in a few minutes.";
}

function useLedger(loadLedger: LoadLedger) {
  const [ledger, setLedger] = useState<Ledger>({ state: "loading" });
  const load = useCallback(() => {
    setLedger({ state: "loading" });
    loadLedger().then(
      (events) => {
        setLedger({ state: "ready", events });
      },
      (error: unknown) => {
        setLedger({ state: "failed", message: ledgerWords(error) });
      },
    );
  }, [loadLedger]);
  useEffect(load, [load]);
  return { ledger, load };
}

function saveLedger(events: LedgerEvent[]): void {
  const blob = new Blob([JSON.stringify({ events }, null, 2)], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "vision-ledger.json";
  link.click();
  URL.revokeObjectURL(href);
}

function DownloadLedger({ events }: { events: LedgerEvent[] }) {
  return (
    <Button
      className={cx("secondary")}
      onPress={() => {
        saveLedger(events);
      }}
    >
      Download the ledger
    </Button>
  );
}

type StatementProps = { now: number; loadLedger: LoadLedger; google: AskGoogle };

function StatementSection({ now, loadLedger, google }: StatementProps) {
  const { ledger, load } = useLedger(loadLedger);
  const [month, setMonth] = useState(() => monthOf(now));
  const shown = MONTH_PATTERN.test(month) ? month : monthOf(now);
  return (
    <>
      <div className={cx("bar")}>
        <label className={cx("label")} htmlFor="statement-month">
          Month
        </label>
        <input
          id="statement-month"
          className={cx("input")}
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
          }}
        />
        <Button className={cx("secondary")} onPress={load}>
          Load again
        </Button>
        {ledger.state === "ready" ? (
          <>
            <DownloadLedger events={ledger.events} />
            <GoogleButton
              label="Save statement to Drive"
              done="The statement is on its way to Drive. A send that fails shows on the desk board."
              run={() => google("statement", { statement: statement(ledger.events, shown) })}
            />
          </>
        ) : null}
      </div>
      <LedgerBody ledger={ledger} month={shown} />
    </>
  );
}

function LedgerBody({ ledger, month }: { ledger: Ledger; month: string }) {
  if (ledger.state === "loading") return <p role="status">Loading</p>;
  if (ledger.state === "failed") {
    return (
      <p role="alert" className={cx("error")}>
        {ledger.message}
      </p>
    );
  }
  return (
    <>
      <StatementTable statement={statement(ledger.events, month)} />
      <SealCheck events={ledger.events} />
    </>
  );
}

function PlaybookSection({ view, send, google }: Pick<OrgPageViewProps, "view" | "send" | "google">) {
  return (
    <>
      <div className={cx("bar")}>
        <GoogleButton
          label="Load playbook from the sheet"
          done="The playbook from the sheet is loaded."
          run={() => google("playbook", {})}
        />
      </div>
      <PlaybookTable playbook={view.playbook} levels={view.levels} send={send} />
    </>
  );
}

function SettingsSection({ view, send }: Pick<OrgPageViewProps, "view" | "send">) {
  return (
    <>
      <DemoClock demo={view.demo} send={send} />
      <Rehearsal />
    </>
  );
}

type Section = { id: string; title: string; body: ReactNode };

export type OrgPageViewProps = {
  view: OrgView;
  send: DeskSend;
  loadLedger: LoadLedger;
  makeCode: MakeJoinCode;
  google: AskGoogle;
  resources: ResourcesClient;
};

function sections({ view, send, loadLedger, makeCode, google, resources }: OrgPageViewProps): Section[] {
  return [
    {
      id: "statement",
      title: "Statement",
      body: <StatementSection now={view.clock.now} loadLedger={loadLedger} google={google} />,
    },
    {
      id: "unmet",
      title: "Unmet",
      body: (
        <>
          <UnmetShelf jobs={view.unmet} />
          <h3 className={cx("heading")}>Finish list</h3>
          <FinishList jobs={view.finish} />
        </>
      ),
    },
    { id: "resources", title: "Resources", body: <ResourcesSection client={resources} /> },
    {
      id: "playbook",
      title: "Playbook",
      body: <PlaybookSection view={view} send={send} google={google} />,
    },
    {
      id: "volunteers",
      title: "Volunteers",
      body: <MembersTable members={view.members} now={view.clock.now} makeCode={makeCode} />,
    },
    { id: "partners", title: "Partners", body: <PartnersTable partners={view.partners} /> },
    { id: "settings", title: "Settings", body: <SettingsSection view={view} send={send} /> },
  ];
}

export function OrgPageView(props: OrgPageViewProps) {
  const list = sections(props);
  return (
    <Tabs className={cx("org")} orientation="vertical">
      <TabList className={cx("nav")} aria-label="Organiser sections">
        {list.map((item) => (
          <Tab key={item.id} id={item.id} className={cx("tab")}>
            {item.title}
          </Tab>
        ))}
      </TabList>
      {list.map((item) => (
        <TabPanel key={item.id} id={item.id} className={cx("content")}>
          <h2 className={cx("title")}>{item.title}</h2>
          {item.body}
        </TabPanel>
      ))}
    </Tabs>
  );
}

type LoadedProps = { org: string; token: string; openSocket: OpenSocket | undefined };

function OrgLoaded({ org, token, openSocket }: LoadedProps) {
  const auth = useMemo<Auth>(() => ({ kind: "session", token }), [token]);
  const options = useMemo(() => (openSocket === undefined ? {} : { openSocket }), [openSocket]);
  const { view, live, refresh } = useView(org, auth, "org", OrgViewSchema, options);
  const actions = useOrgActions(org, token, auth, refresh);
  const ready = view.state === "ready" ? view.view : null;
  return (
    <Shell
      theme="graphite"
      section="Organiser"
      live={live}
      clock={ready?.clock ?? null}
      orgName={orgNameOf(ready, org)}
    >
      {ready === null ? (
        <OrgWaiting org={org} view={view} refresh={refresh} />
      ) : (
        <OrgPageView view={ready} {...actions} />
      )}
    </Shell>
  );
}

function OrgWaiting({ org, view, refresh }: { org: string; view: ViewState<OrgView>; refresh: () => void }) {
  if (view.state === "loading") {
    return (
      <p className={cx("notice")} role="status">
        Loading
      </p>
    );
  }
  if (view.state === "failed" && view.code === "network")
    return <Offline theme="graphite" onRetry={refresh} />;
  if (view.state === "failed" && view.code === "forbidden") {
    return (
      <p className={cx("notice")}>
        This view is for organisers and leads. Ask the organiser for a join code.
      </p>
    );
  }
  return <JoinFirst org={org} />;
}

function JoinFirst({ org }: { org: string }) {
  return (
    <section className={cx("notice")}>
      <h1 className={cx("title")}>Join as an organiser first</h1>
      <p>This browser has no organiser session, or the session ended.</p>
      <a className={cx("link")} href={`/${org}/join`}>
        Type a join code
      </a>
    </section>
  );
}

export type OrgPageProps = { org: string; openSocket?: OpenSocket };

export function OrgPage({ org, openSocket }: OrgPageProps) {
  const [token] = useState(() => readSession(org));
  if (token === null) {
    return (
      <Shell theme="graphite" section="Organiser" live={null} clock={null} orgName={null}>
        <JoinFirst org={org} />
      </Shell>
    );
  }
  return <OrgLoaded org={org} token={token} openSocket={openSocket} />;
}
