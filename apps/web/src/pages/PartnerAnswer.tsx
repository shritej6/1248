import { useId, useState } from "react";
import { Button } from "react-aria-components";
import { newCommandId } from "../api.js";
import { classNames } from "../components/classNames.js";
import { SendStatus, TextInput, useSend, type SendPartner } from "./PartnerSend.js";
import styles from "./PartnerPage.module.css";

const cx = classNames(styles);

type Field = "reason" | "time";
type Choice = { label: string; answer: "yes" | "no" | "wait"; primary: boolean; field: Field };
export type AnswerLine = { reason?: string; waitUntil?: number };
export type LineResult = { ok: true; line: AnswerLine } | { ok: false; error: string };

const CHOICES: Choice[] = [
  { label: "Yes, we can take it", answer: "yes", primary: true, field: "reason" },
  { label: "Wait, ask again later", answer: "wait", primary: false, field: "time" },
  { label: "No, we cannot", answer: "no", primary: false, field: "reason" },
];

const FIELD_LABEL: Record<Field, string> = {
  reason: "Reason, one line (optional)",
  time: "Ask again after (optional)",
};

export const REASON_MAX = 140;
const TIME_ERROR = "Pick a time after now.";

export function answerLine(field: Field, value: string, now: number): LineResult {
  const text = value.replace(/\p{Cc}+/gu, " ").trim();
  if (text === "") return { ok: true, line: {} };
  if (field === "reason") return { ok: true, line: { reason: text.slice(0, REASON_MAX) } };
  const at = new Date(text).getTime();
  if (Number.isNaN(at) || at <= now) return { ok: false, error: TIME_ERROR };
  return { ok: true, line: { waitUntil: at } };
}

type AskAnswerProps = { job: string; now: number; send: SendPartner };

export function AskAnswer({ job, now, send }: AskAnswerProps) {
  const { state, run } = useSend(send);
  const [picked, setPicked] = useState<Choice | null>(null);
  const disabled = state.kind === "sending";
  const answer = (choice: Choice, line: AnswerLine) => {
    void run({ id: newCommandId(), type: "ask.answer", job, answer: choice.answer, ...line });
  };
  return (
    <>
      {state.kind === "sent" ? null : picked === null ? (
        <Choices disabled={disabled} onPick={setPicked} />
      ) : (
        <ConfirmAnswer
          key={picked.answer}
          choice={picked}
          now={now}
          disabled={disabled}
          onSend={(line) => {
            answer(picked, line);
          }}
          onChange={() => {
            setPicked(null);
          }}
        />
      )}
      <SendStatus state={state} />
    </>
  );
}

function Choices({ disabled, onPick }: { disabled: boolean; onPick: (choice: Choice) => void }) {
  return (
    <div className={cx("choices")}>
      {CHOICES.map((choice) => (
        <Button
          key={choice.answer}
          className={cx(choice.primary ? "primary" : "secondary")}
          isDisabled={disabled}
          onPress={() => {
            onPick(choice);
          }}
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}

type ConfirmProps = {
  choice: Choice;
  now: number;
  disabled: boolean;
  onSend: (line: AnswerLine) => void;
  onChange: () => void;
};

function ConfirmAnswer({ choice, now, disabled, onSend, onChange }: ConfirmProps) {
  const id = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    const result = answerLine(choice.field, value, now);
    setError(result.ok ? null : result.error);
    if (result.ok) onSend(result.line);
  };
  return (
    <div className={cx("box", "form")}>
      <p>{`Your answer: ${choice.label}.`}</p>
      <TextInput
        id={`${id}-line`}
        label={FIELD_LABEL[choice.field]}
        type={choice.field === "time" ? "datetime-local" : "text"}
        value={value}
        error={error}
        {...(choice.field === "reason" ? { maxLength: REASON_MAX } : {})}
        onChange={setValue}
      />
      <div className={cx("choices")}>
        <Button className={cx("primary")} isDisabled={disabled} onPress={send}>
          Send answer
        </Button>
        <Button className={cx("secondary")} isDisabled={disabled} onPress={onChange}>
          Change answer
        </Button>
      </div>
    </div>
  );
}
