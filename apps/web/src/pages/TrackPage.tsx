import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "react-aria-components";
import { TrackingSchema, type Command, type Tracking } from "@vision/contracts";
import { newCommandId, sendCommand, type Auth, type CommandOutcome, type FailureCode } from "../api.js";
import { useView, type OpenSocket, type ViewState } from "../live.js";
import { orgNameOf } from "../orgName.js";
import { Call911 } from "../components/Call911/Call911.js";
import { Offline } from "../components/Offline/Offline.js";
import { Shell } from "../components/Shell/Shell.js";
import { Timeline } from "../components/Timeline/Timeline.js";
import { dayTime, longDate } from "../components/clockTime.js";
import { classNames } from "../components/classNames.js";
import styles from "./TrackPage.module.css";
import { TRACK_ES, type TrackWords } from "./spanish.js";

const cx = classNames(styles);

export const REFRESH_MS = 60_000;

export type SendAnswer = (command: Command) => Promise<CommandOutcome>;
export type TrackPageProps = { org: string; token: string; openSocket?: OpenSocket };
export type TrackViewProps = { view: Tracking; send: SendAnswer };

const GONE = new Set(["not_found", "unauthorized", "forbidden"]);

export function answerWords(outcome: CommandOutcome, words: TrackWords = TRACK_EN): string | null {
  return outcome.ok ? null : words.answerFailure(outcome.code);
}

function englishAnswerFailure(code: FailureCode): string {
  if (code === "network") return "Not sent. No connection. Try again.";
  if (code === "wrong_state" || code === "not_found") return "This question is closed.";
  return "Not sent. Try again in a few minutes.";
}

export const TRACK_EN: TrackWords = {
  lang: "en",
  title: "Your request",
  noCode: "Your request code comes after a person reads your request.",
  stepsLabel: "Steps of your request",
  step: (word) => word,
  day: dayTime,
  deletedOn: (date) => `This record is deleted on ${date}.`,
  date: longDate,
  messagesTitle: "Messages to you",
  consentTitle: "May we share?",
  consentText: (partnerName, needLabel) =>
    `${partnerName} can help with ${needLabel}. May we give them your first name, your ZIP code and what you need?`,
  shareYes: "Yes, share",
  shareNo: "No, do not share",
  checkbackTitle: "Did they help?",
  checkbackText: (needLabel) => `Your request: ${needLabel}.`,
  helpedYes: "Yes",
  helpedPartly: "Partly",
  helpedNo: "No",
  sent: "Sent. Thank you.",
  sending: "Sending",
  answerFailure: englishAnswerFailure,
  danger: "In danger now?",
  call: "Call 911.",
};

const trackWords = (view: Tracking): TrackWords => (view.lang === "es" ? TRACK_ES : TRACK_EN);

function useRefreshWhileVisible(refresh: () => void): void {
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => {
      if (visible()) refresh();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (visible()) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);
}

export function TrackPage({ org, token, openSocket }: TrackPageProps) {
  const auth = useMemo<Auth>(() => ({ kind: "track", token }), [token]);
  const options = useMemo(() => (openSocket === undefined ? {} : { openSocket }), [openSocket]);
  const { view, live, refresh } = useView(org, auth, "tracking", TrackingSchema, options);
  useRefreshWhileVisible(refresh);
  const send = useCallback<SendAnswer>(
    async (command) => {
      const outcome = await sendCommand(org, auth, command);
      if (outcome.ok) refresh();
      return outcome;
    },
    [org, auth, refresh],
  );
  const ready = view.state === "ready" ? view.view : null;
  return (
    <Shell
      theme="paper"
      section={null}
      live={live}
      clock={ready?.clock ?? null}
      orgName={orgNameOf(ready, org)}
    >
      <div className={cx("page")}>
        <TrackBody view={view} send={send} refresh={refresh} />
      </div>
    </Shell>
  );
}

function TrackBody({
  view,
  send,
  refresh,
}: {
  view: ViewState<Tracking>;
  send: SendAnswer;
  refresh: () => void;
}) {
  if (view.state === "ready") return <TrackView view={view.view} send={send} />;
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
      <Call911 />
    </section>
  );
}

export function TrackView({ view, send }: TrackViewProps) {
  if (view.closed) return <Closed />;
  const now = view.clock.now;
  const words = trackWords(view);
  const steps = view.steps.map((step) => ({ ...step, word: words.step(step.word) }));
  return (
    <section className={cx("section")} aria-labelledby="track-title" lang={words.lang}>
      <h1 id="track-title" className={cx("title")}>
        {words.title}
      </h1>
      {view.routeCode === null ? (
        <p className={cx("meta")}>{words.noCode}</p>
      ) : (
        <p className={cx("code")}>{view.routeCode}</p>
      )}
      {steps.length === 0 ? null : <Timeline steps={steps} now={now} label={words.stepsLabel} />}
      {view.consentAsk === null ? null : (
        <ConsentAsk key={view.consentAsk.job} ask={view.consentAsk} send={send} words={words} />
      )}
      {view.checkbackAsk === null ? null : (
        <CheckbackAsk key={view.checkbackAsk.job} ask={view.checkbackAsk} send={send} words={words} />
      )}
      <Messages messages={view.messages} now={now} words={words} />
      <Call911 danger={words.danger} call={words.call} />
      {view.forgetAt === null ? null : (
        <p className={cx("meta")}>{words.deletedOn(words.date(view.forgetAt))}</p>
      )}
    </section>
  );
}

type MessagesProps = { messages: Tracking["messages"]; now: number; words: TrackWords };

function Messages({ messages, now, words }: MessagesProps) {
  if (messages.length === 0) return null;
  return (
    <section className={cx("section")} aria-labelledby="messages-title">
      <h2 id="messages-title" className={cx("heading")}>
        {words.messagesTitle}
      </h2>
      <ul className={cx("messages")}>
        {messages.map((message) => (
          <li key={`${String(message.at)}-${message.text}`} className={cx("message")}>
            <time className={cx("meta")} dateTime={new Date(message.at).toISOString()}>
              {words.day(message.at, now)}
            </time>
            <p>{message.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Choice = { label: string; primary: boolean; command: () => Command };
type AnswerState =
  { kind: "open" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

type AnswerBoxProps = { title: string; text: string; choices: Choice[]; send: SendAnswer; words: TrackWords };

function AnswerBox({ title, text, choices, send, words }: AnswerBoxProps) {
  const [state, setState] = useState<AnswerState>({ kind: "open" });
  const answer = async (choice: Choice) => {
    setState({ kind: "sending" });
    const message = answerWords(await send(choice.command()), words);
    setState(message === null ? { kind: "sent" } : { kind: "failed", message });
  };
  return (
    <section className={cx("ask")} aria-label={title}>
      <h2 className={cx("heading")}>{title}</h2>
      <p>{text}</p>
      {state.kind === "sent" ? (
        <p role="status">{words.sent}</p>
      ) : (
        <Choices choices={choices} disabled={state.kind === "sending"} onAnswer={answer} />
      )}
      {state.kind === "sending" ? <p className={cx("meta")}>{words.sending}</p> : null}
      {state.kind === "failed" ? <p role="alert">{state.message}</p> : null}
    </section>
  );
}

type ChoicesProps = { choices: Choice[]; disabled: boolean; onAnswer: (choice: Choice) => Promise<void> };

function Choices({ choices, disabled, onAnswer }: ChoicesProps) {
  return (
    <div className={cx("choices")}>
      {choices.map((choice) => (
        <Button
          key={choice.label}
          className={cx(choice.primary ? "primary" : "secondary")}
          isDisabled={disabled}
          onPress={() => void onAnswer(choice)}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}

type ConsentProps = { ask: NonNullable<Tracking["consentAsk"]>; send: SendAnswer; words: TrackWords };

function ConsentAsk({ ask, send, words }: ConsentProps) {
  const command = (answer: "yes" | "no") => (): Command => ({
    id: newCommandId(),
    type: "consent.answer",
    job: ask.job,
    answer,
  });
  return (
    <AnswerBox
      title={words.consentTitle}
      text={words.consentText(ask.partnerName, ask.needLabel)}
      choices={[
        { label: words.shareYes, primary: true, command: command("yes") },
        { label: words.shareNo, primary: false, command: command("no") },
      ]}
      send={send}
      words={words}
    />
  );
}

type CheckbackProps = { ask: NonNullable<Tracking["checkbackAsk"]>; send: SendAnswer; words: TrackWords };

function CheckbackAsk({ ask, send, words }: CheckbackProps) {
  const command = (answer: 1 | 2 | 3) => (): Command => ({
    id: newCommandId(),
    type: "checkback.answer",
    job: ask.job,
    answer,
  });
  return (
    <AnswerBox
      title={words.checkbackTitle}
      text={words.checkbackText(ask.needLabel)}
      choices={[
        { label: words.helpedYes, primary: true, command: command(1) },
        { label: words.helpedPartly, primary: false, command: command(2) },
        { label: words.helpedNo, primary: false, command: command(3) },
      ]}
      send={send}
      words={words}
    />
  );
}
