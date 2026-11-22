import { useEffect } from "react";
import { Button } from "react-aria-components";
import type { DeskCard, PageView } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { CLOCK_LIMITS, ClockText } from "../ClockText/ClockText.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import { classNames } from "../classNames.js";
import { useDeskCommand, type DeskSend, type SendState } from "../deskCommand.js";
import type { DeskSound } from "../deskSound.js";
import styles from "./PageAlert.module.css";

const cx = classNames(styles);

export const PAGE_SOUND_MS = 6_000;
const TITLE_FLASH_MS = 1_000;
const PAGE_LIMIT = CLOCK_LIMITS["Page answer"] ?? 3 * 60_000;

export type PageAlertProps = {
  page: PageView;
  card: DeskCard | null;
  more: number;
  now: number;
  sound: DeskSound | null;
  send: DeskSend;
  onAnswered: (page: string) => void;
};

function usePageSignals(sound: DeskSound | null): void {
  useEffect(() => {
    const title = document.title;
    let flash = false;
    sound?.playPage();
    const tone = setInterval(() => sound?.playPage(), PAGE_SOUND_MS);
    const blink = setInterval(() => {
      flash = !flash;
      document.title = flash ? "PAGE" : title;
    }, TITLE_FLASH_MS);
    return () => {
      clearInterval(tone);
      clearInterval(blink);
      document.title = title;
    };
  }, [sound]);
}

const reasonWords = (reason: string) => (reason === "high" ? "High urgency" : reason.replace(/_/gu, " "));

type BodyProps = Pick<PageAlertProps, "page" | "card" | "more" | "now"> & {
  answer: () => void;
  state: SendState;
};

function PageBody({ page, card, more, now, answer, state }: BodyProps) {
  const busy = state.kind === "sending";
  return (
    <div className={cx("body")}>
      <p id="page-words" className={cx("quote")}>
        {card === null ? "Open the emergency lane to read the request." : card.message}
      </p>
      <p className={cx("line")}>
        <span>{`Paged to ${page.to}. Moves to the next person in`}</span>
        <ClockText label={null} dueAt={page.sentAt + PAGE_LIMIT} now={now} limitMs={PAGE_LIMIT} />
      </p>
      <Button className={cx("answer")} autoFocus isDisabled={busy} onPress={answer}>
        Got it
      </Button>
      {busy ? <p className={cx("muted")}>Waiting for hub receipt</p> : null}
      {state.kind === "failed" ? (
        <p role="alert" className={cx("error")}>
          {state.message}
        </p>
      ) : null}
      {more > 0 ? <p className={cx("muted")}>{`${String(more)} more waiting`}</p> : null}
    </div>
  );
}

export function PageAlert({ page, card, more, now, sound, send, onAnswered }: PageAlertProps) {
  const command = useDeskCommand(send, () => {
    onAnswered(page.page);
  });
  usePageSignals(sound);
  const zip = card?.zip ?? null;
  const answer = () => void command.run({ id: newCommandId(), type: "page.answer", page: page.page });
  return (
    <div className={cx("overlay")}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="page-title"
        aria-describedby="page-words"
        className={cx("dialog")}
      >
        <header className={cx("band")}>
          <ShapeMark mark="triangle" />
          <h2 id="page-title" className={cx("title")}>
            Emergency page
          </h2>
          <code>{zip === null ? "no ZIP" : `ZIP ${zip}`}</code>
          <span>{reasonWords(page.reason)}</span>
        </header>
        <PageBody page={page} card={card} more={more} now={now} answer={answer} state={command.state} />
      </div>
    </div>
  );
}
