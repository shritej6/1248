import { useCallback, useId, useMemo, useState, type ReactNode, type SyntheticEvent } from "react";
import { Button } from "react-aria-components";
import { PartnerCardSchema, type PartnerCard } from "@vision/contracts";
import { newCommandId, sendCommand, type Auth } from "../api.js";
import { useView, type OpenSocket, type ViewState } from "../live.js";
import { orgNameOf } from "../orgName.js";
import { Offline } from "../components/Offline/Offline.js";
import { PromiseText } from "../components/PromiseText/PromiseText.js";
import { Shell } from "../components/Shell/Shell.js";
import { dayTime, longDate } from "../components/clockTime.js";
import { classNames } from "../components/classNames.js";
import { AskAnswer } from "./PartnerAnswer.js";
import { SendStatus, TextInput, useSend, type SendPartner } from "./PartnerSend.js";
import styles from "./PartnerPage.module.css";

const cx = classNames(styles);

export { partnerWords, type SendPartner } from "./PartnerSend.js";
export type PartnerPageProps = { org: string; token: string; openSocket?: OpenSocket };
export type PartnerViewProps = { view: PartnerCard; send: SendPartner };

type Ask = NonNullable<PartnerCard["ask"]>;
type Note = NonNullable<PartnerCard["note"]>;
type Result = NonNullable<PartnerCard["result"]>;
const GONE = new Set(["not_found", "unauthorized", "forbidden"]);
export function PartnerPage({ org, token, openSocket }: PartnerPageProps) {
  const auth = useMemo<Auth>(() => ({ kind: "partner", token }), [token]);
  const options = useMemo(() => (openSocket === undefined ? {} : { openSocket }), [openSocket]);
  const { view, live, refresh } = useView(org, auth, "partner", PartnerCardSchema, options);
  const send = useCallback<SendPartner>(
    async (command) => {
      const outcome = await sendCommand(org, auth, command);
      if (outcome.ok || outcome.code !== "network") refresh();
      return outcome;
    },
    [org, auth, refresh],
  );
  const ready = view.state === "ready" ? view.view : null;
  const orgName = orgNameOf(ready, org);
  return (
    <Shell theme="paper" section={null} live={live} clock={ready?.clock ?? null} orgName={orgName}>
      <div className={cx("page")}>
        <PartnerBody view={view} orgName={orgName} send={send} refresh={refresh} />
      </div>
    </Shell>
  );
}

type BodyProps = {
  view: ViewState<PartnerCard>;
  orgName: string | null;
  send: SendPartner;
  refresh: () => void;
};

function PartnerBody({ view, orgName, send, refresh }: BodyProps) {
  if (view.state === "ready")
    return <PartnerView view={orgName === null ? view.view : { ...view.view, orgName }} send={send} />;
  if (view.state === "loading") {
    return (
      <p className={cx("loading")} role="status">
        Loading
      </p>
    );
  }
  if (GONE.has(view.code)) return <Closed />;
  if (view.code === "network") return <Offline theme="paper" onRetry={refresh} />;
  return (
    <div className={cx("section")} role="alert">
      <p>This page did not load. Try again in a few minutes.</p>
      <Button className={cx("secondary")} onPress={refresh}>
        Try again
      </Button>
    </div>
  );
}

function Closed() {
  return (
    <section className={cx("section")}>
      <h1 className={cx("title")}>This request is closed.</h1>
    </section>
  );
}

type Frame = { routeCode: string | null; closesAt: number | null; now: number; orgName: string | null };

export function PartnerView({ view, send }: PartnerViewProps) {
  const frame: Frame = {
    routeCode: view.routeCode,
    closesAt: view.closesAt,
    now: view.clock.now,
    orgName: view.orgName ?? null,
  };
  if (view.state === "ask" && view.ask !== null) return <AskCard ask={view.ask} frame={frame} send={send} />;
  if (view.state === "promise") return <PromiseCard ask={view.ask} frame={frame} send={send} />;
  if (view.state === "note" && view.note !== null)
    return <NoteCard note={view.note} frame={frame} send={send} />;
  if (view.state === "result" && view.result !== null)
    return <ResultCard result={view.result} frame={frame} />;
  return <Closed />;
}

type HeadProps = { id: string; frame: Frame; children: ReactNode };

function CardHead({ id, frame, children }: HeadProps) {
  return (
    <header className={cx("head")}>
      <h1 id={id} className={cx("title")}>
        {children}
      </h1>
      {frame.routeCode === null ? null : <code className={cx("code")}>{frame.routeCode}</code>}
    </header>
  );
}

type Fact = { label: string; value: string };

function Facts({ facts }: { facts: Fact[] }) {
  return (
    <dl className={cx("facts")}>
      {facts.map((fact) => (
        <div key={fact.label} className={cx("fact")}>
          <dt className={cx("label")}>{fact.label}</dt>
          <dd className={cx("value")}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const zipText = (zip: string | null) => zip ?? "Not given";

function AskCard({ ask, frame, send }: { ask: Ask; frame: Frame; send: SendPartner }) {
  const { now } = frame;
  return (
    <section className={cx("section")} aria-labelledby="ask-title">
      <CardHead id="ask-title" frame={frame}>
        {frame.orgName === null ? "Can you take this?" : `${frame.orgName} asks: can you take this?`}
      </CardHead>
      <Facts
        facts={[
          { label: "Need", value: ask.needLabel },
          { label: "ZIP code", value: zipText(ask.zip) },
          { label: "Answer by", value: dayTime(ask.deadline, now) },
        ]}
      />
      <p>You see the first name and how to reach the person after you say yes and accept the promise.</p>
      <AskAnswer job={ask.job} now={now} send={send} />
      <CardFooter frame={frame} />
    </section>
  );
}

function PromiseLink({ orgName }: { orgName: string | null }) {
  const titleId = useId();
  return (
    <details>
      <summary className={cx("summary")}>Read the promise</summary>
      <section aria-labelledby={titleId}>
        <PromiseText titleId={titleId} orgName={orgName} />
      </section>
    </details>
  );
}

function CardFooter({ frame, promise = true }: { frame: Frame; promise?: boolean }) {
  return (
    <footer className={cx("footer")}>
      {promise ? <PromiseLink orgName={frame.orgName} /> : null}
      {frame.closesAt === null ? null : (
        <p className={cx("meta")}>{`This card closes on ${longDate(frame.closesAt)}.`}</p>
      )}
    </footer>
  );
}

function PromiseCard({ ask, frame, send }: { ask: Ask | null; frame: Frame; send: SendPartner }) {
  const { state, run } = useSend(send);
  const titleId = useId();
  return (
    <section className={cx("section")} aria-labelledby="promise-title">
      <CardHead id="promise-title" frame={frame}>
        Accept the promise to see the note
      </CardHead>
      {ask === null ? null : (
        <Facts
          facts={[
            { label: "Need", value: ask.needLabel },
            { label: "ZIP code", value: zipText(ask.zip) },
            { label: "Confirm GOT IT by", value: dayTime(ask.deadline, frame.now) },
          ]}
        />
      )}
      <section className={cx("box")} aria-labelledby={titleId}>
        <PromiseText titleId={titleId} orgName={frame.orgName} />
      </section>
      <p>You accept the promise one time. It covers every request we send you.</p>
      {state.kind === "sent" ? null : (
        <Button
          className={cx("primary")}
          isDisabled={state.kind === "sending"}
          onPress={() => void run({ id: newCommandId(), type: "promise.accept" })}
        >
          I accept this promise
        </Button>
      )}
      <SendStatus state={state} />
      <CardFooter frame={frame} promise={false} />
    </section>
  );
}

function NoteCard({ note, frame, send }: { note: Note; frame: Frame; send: SendPartner }) {
  return (
    <section className={cx("section")} aria-labelledby="note-title">
      <CardHead id="note-title" frame={frame}>
        Short note
      </CardHead>
      <Facts
        facts={[
          { label: "First name", value: note.firstName },
          { label: "ZIP code", value: zipText(note.zip) },
          { label: "Need", value: note.needLabel },
          { label: "Promised by", value: dayTime(note.deadline, frame.now) },
          { label: "How to reach", value: note.contact },
        ]}
      />
      <Tried tried={note.tried} />
      {note.gotIt ? (
        <p className={cx("box")} role="status">
          GOT IT is recorded. You hold this request now.
        </p>
      ) : (
        <GotItForm job={note.job} send={send} />
      )}
      <CardFooter frame={frame} />
    </section>
  );
}

function Tried({ tried }: { tried: string[] }) {
  return (
    <section className={cx("section")} aria-labelledby="tried-title">
      <h2 id="tried-title" className={cx("heading")}>
        What was tried
      </h2>
      {tried.length === 0 ? (
        <p>Nothing was tried before you.</p>
      ) : (
        <ul className={cx("tried")}>
          {tried.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

type GotItErrors = { name: string | null; date: string | null };

const NAME_ERROR = "Type the name of the person who will contact them.";
const DATE_ERROR = "Pick the date you will contact them.";
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function gotItErrors(name: string, date: string): GotItErrors {
  return {
    name: name.trim() === "" ? NAME_ERROR : null,
    date: DATE.test(date) ? null : DATE_ERROR,
  };
}

function GotItForm({ job, send }: { job: string; send: SendPartner }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<GotItErrors>({ name: null, date: null });
  const { state, run } = useSend(send);
  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = gotItErrors(name, date);
    setErrors(found);
    if (found.name !== null || found.date !== null || state.kind === "sending") return;
    void run({ id: newCommandId(), type: "handover.got_it", job, date, contactName: name.trim() });
  };
  if (state.kind === "sent") return <SendStatus state={state} />;
  return (
    <form className={cx("box", "form")} noValidate onSubmit={onSubmit} aria-labelledby="gotit-title">
      <GotItIntro />
      <TextInput
        id="gotit-name"
        label="Who will contact them?"
        value={name}
        error={errors.name}
        maxLength={80}
        autoComplete="name"
        onChange={setName}
      />
      <TextInput
        id="gotit-date"
        label="When will you contact them?"
        type="date"
        value={date}
        error={errors.date}
        onChange={setDate}
      />
      <button className={cx("primary")} type="submit" disabled={state.kind === "sending"}>
        Confirm got it
      </button>
      <SendStatus state={state} />
    </form>
  );
}

function GotItIntro() {
  return (
    <>
      <h2 id="gotit-title" className={cx("heading")}>
        GOT IT
      </h2>
      <p>Send GOT IT when your group takes this request. Then your group holds it.</p>
    </>
  );
}

const RESULT_WORDS: Partial<Record<Result["status"], string>> = {
  helped: "The person said you helped.",
  unreached: "We could not reach the person after the hand-over.",
  withdrawn: "The request was withdrawn.",
};

function ResultCard({ result, frame }: { result: Result; frame: Frame }) {
  const { asked, yes, gotIt, helped } = result.counts;
  return (
    <section className={cx("section")} aria-labelledby="result-title">
      <CardHead id="result-title" frame={frame}>
        Result
      </CardHead>
      <p>{RESULT_WORDS[result.status] ?? "This request is closed."}</p>
      <section className={cx("box")} aria-labelledby="counts-title">
        <h2 id="counts-title" className={cx("heading")}>
          {frame.orgName === null ? "Your group with us" : `Your group with ${frame.orgName}`}
        </h2>
        <p
          className={cx("counts")}
        >{`${String(asked)} asked, ${String(yes)} yes, ${String(gotIt)} GOT IT, ${String(helped)} helped`}</p>
      </section>
      <CardFooter frame={frame} />
    </section>
  );
}
