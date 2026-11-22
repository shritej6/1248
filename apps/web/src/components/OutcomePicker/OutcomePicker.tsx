import { useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import type { Outcome } from "@vision/contracts";
import { classNames } from "../classNames.js";
import { ShapeMark } from "../StateChip/StateChip.js";
import styles from "./OutcomePicker.module.css";

const cx = classNames(styles);

const TITLE = "What happened?";

export const OUTCOME_CHOICES: { outcome: Outcome; label: string }[] = [
  { outcome: "done", label: "Done as asked" },
  { outcome: "partly", label: "Part done" },
  { outcome: "not_done", label: "Could not do it" },
];

type ChoicesProps = { picked: Outcome | null; onPick: (outcome: Outcome) => void };

function OutcomeChoices({ picked, onPick }: ChoicesProps) {
  return (
    <span className={cx("choices")} role="group" aria-label={TITLE}>
      {OUTCOME_CHOICES.map((choice) => {
        const isPicked = picked === choice.outcome;
        return (
          <button
            key={choice.outcome}
            type="button"
            className={cx("choice")}
            aria-pressed={isPicked}
            onClick={() => {
              onPick(choice.outcome);
            }}
          >
            {isPicked ? <ShapeMark mark="hollow_check" /> : null}
            {choice.label}
          </button>
        );
      })}
    </span>
  );
}

type ActionsProps = { picked: Outcome | null; onSend: (outcome: Outcome) => void; onClose: () => void };

function OutcomeActions({ picked, onSend, onClose }: ActionsProps) {
  return (
    <>
      <div className={cx("actions")}>
        <Button
          className={cx("primary")}
          isDisabled={picked === null}
          onPress={() => {
            if (picked !== null) onSend(picked);
          }}
        >
          Send
        </Button>
        <Button className={cx("ghost")} onPress={onClose}>
          Cancel
        </Button>
      </div>
      {picked === null ? <p className={cx("muted")}>Pick what happened first</p> : null}
    </>
  );
}

export type OutcomePickerProps = {
  note: string;
  onSend: (outcome: Outcome) => void;
  onClose: () => void;
};

export function OutcomePicker({ note, onSend, onClose }: OutcomePickerProps) {
  const [picked, setPicked] = useState<Outcome | null>(null);
  return (
    <ModalOverlay
      className={cx("overlay")}
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal className={cx("modal")}>
        <Dialog className={cx("dialog")}>
          <Heading slot="title" className={cx("title")}>
            {TITLE}
          </Heading>
          <p className={cx("muted")}>{note}</p>
          <OutcomeChoices picked={picked} onPick={setPicked} />
          <OutcomeActions picked={picked} onSend={onSend} onClose={onClose} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
