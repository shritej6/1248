import { useEffect } from "react";
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { DeskBoard, DeskCard, DeskLink, EventGroup, LinkAnswer } from "@vision/contracts";
import { newCommandId } from "../../api.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import { classNames } from "../classNames.js";
import { clockTime } from "../clockTime.js";
import { useDeskCommand, type DeskSend } from "../deskCommand.js";
import type { BoardSlotProps, CardSlotProps } from "../deskSlots.js";
import { publishBoard, useShownBoard } from "./boardStore.js";
import styles from "./SameEvent.module.css";

const cx = classNames(styles);

const QUESTION = "Same event?";
const FAILED = "The same-event check did not run. Read the reports yourself.";
const ANSWER_WORDS: Record<LinkAnswer, string> = {
  same: "Same event. The desk confirmed it.",
  not_same: "Not the same. The desk confirmed it.",
};

const zipWords = (zip: string | null): string => (zip === null ? "no ZIP" : `ZIP ${zip}`);

const linkLine = (link: DeskLink): string =>
  `This may be the same event as a report from ${zipWords(link.otherZip)} at ${clockTime(link.otherReceivedAt)}. Score ${String(link.score)}.`;

const waitingCards = (board: DeskBoard | null): DeskCard[] =>
  board === null ? [] : [...board.emergency, ...board.triage];

export function SameEventMark({ card }: CardSlotProps) {
  const open = (card.links ?? []).some((link) => link.answer === null);
  return open ? <span className={cx("mark")}>{QUESTION}</span> : null;
}

function Side({ title, card }: { title: string; card: DeskCard | undefined }) {
  return (
    <section className={cx("side")} aria-label={title}>
      <span className={cx("heading")}>{title}</span>
      {card === undefined ? (
        <p className={cx("muted")}>This report is not waiting on the board now.</p>
      ) : (
        <>
          <span className={cx("muted")}>{`${zipWords(card.zip)} at ${clockTime(card.receivedAt)}`}</span>
          <p className={cx("quote")}>{card.message}</p>
        </>
      )}
    </section>
  );
}

function SideBySide({ card, link }: { card: DeskCard; link: DeskLink }) {
  const board = useShownBoard();
  const other = waitingCards(board).find((item) => item.card === link.other);
  return (
    <DialogTrigger>
      <Button className={cx("secondary")}>Open side by side</Button>
      <ModalOverlay className={cx("overlay")} isDismissable>
        <Modal className={cx("modal")}>
          <Dialog className={cx("dialog")}>
            {({ close }) => (
              <>
                <Heading slot="title" className={cx("title")}>
                  {QUESTION}
                </Heading>
                <div className={cx("sides")}>
                  <Side title="This report" card={card} />
                  <Side title="The other report" card={other} />
                </div>
                <div className={cx("actions")}>
                  <Button className={cx("ghost")} onPress={close}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

type LinkRowProps = { card: DeskCard; link: DeskLink; send: DeskSend };
type AnswerProps = { busy: boolean; onAnswer: (answer: LinkAnswer) => void };

function AnswerButtons({ busy, onAnswer }: AnswerProps) {
  return (
    <>
      <Button
        className={cx("secondary")}
        isDisabled={busy}
        onPress={() => {
          onAnswer("same");
        }}
      >
        Same event
      </Button>
      <Button
        className={cx("secondary")}
        isDisabled={busy}
        onPress={() => {
          onAnswer("not_same");
        }}
      >
        Not the same
      </Button>
    </>
  );
}

function LinkRow({ card, link, send }: LinkRowProps) {
  const command = useDeskCommand(send);
  const answer = (value: LinkAnswer) => {
    void command.run({
      id: newCommandId(),
      type: "link.answer",
      card: card.card,
      other: link.other,
      answer: value,
    });
  };
  return (
    <div className={cx("link")}>
      <p>{linkLine(link)}</p>
      {link.answer === null ? (
        <div className={cx("actions")}>
          <SideBySide card={card} link={link} />
          <AnswerButtons busy={command.busy} onAnswer={answer} />
        </div>
      ) : (
        <p className={cx("answered")}>{ANSWER_WORDS[link.answer]}</p>
      )}
      {command.state.kind === "failed" ? (
        <p role="alert" className={cx("error")}>
          {command.state.message}
        </p>
      ) : null}
    </div>
  );
}

export function SameEventSection({ card, send }: CardSlotProps) {
  const links = card.links ?? [];
  const failed = card.ai?.link === "failed";
  if (links.length === 0 && !failed) return null;
  return (
    <section className={cx("section")} aria-label={QUESTION}>
      <h3 className={cx("heading")}>{QUESTION}</h3>
      {failed ? <p className={cx("muted")}>{FAILED}</p> : null}
      {links.map((link) => (
        <LinkRow key={link.other} card={card} link={link} send={send} />
      ))}
    </section>
  );
}

function HighestLine({ highest }: { highest: EventGroup["highest"] }) {
  if (highest === "high") {
    return (
      <p className={cx("crit")}>
        <ShapeMark mark="triangle" />
        <span>Highest urgency: High</span>
      </p>
    );
  }
  return highest === "low" ? <p className={cx("muted")}>Highest urgency: Low</p> : null;
}

function GroupLine({ group, board }: { group: EventGroup; board: DeskBoard }) {
  const title = `${String(group.cards.length)} reports, one event`;
  const waiting = waitingCards(board);
  return (
    <div role="group" aria-label={title} className={cx("group")}>
      <p className={cx("groupHead")}>{title}</p>
      <HighestLine highest={group.highest} />
      <ul className={cx("members")}>
        {group.cards.map((id) => {
          const card = waiting.find((item) => item.card === id);
          const words =
            card === undefined
              ? "A confirmed report"
              : `${zipWords(card.zip)} at ${clockTime(card.receivedAt)}`;
          return <li key={id}>{words}</li>;
        })}
      </ul>
    </div>
  );
}

export function EventGroups({ board }: BoardSlotProps) {
  useEffect(() => {
    publishBoard(board);
  }, [board]);
  return (
    <>
      {(board.eventGroups ?? []).map((group) => (
        <GroupLine key={group.cards.join(" ")} group={group} board={board} />
      ))}
    </>
  );
}
