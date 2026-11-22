import { useState } from "react";
import type { Command } from "@vision/contracts";
import type { CommandOutcome } from "../api.js";
import { classNames } from "../components/classNames.js";
import styles from "./PartnerPage.module.css";

const cx = classNames(styles);

export type SendPartner = (command: Command) => Promise<CommandOutcome>;
export type SendState =
  { kind: "open" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string };

const MOVED = new Set(["wrong_state", "not_found", "forbidden"]);

export function partnerWords(outcome: CommandOutcome): string | null {
  if (outcome.ok) return null;
  if (outcome.code === "network") return "Not sent. No connection. Try again.";
  if (MOVED.has(outcome.code)) return "This request has moved on. The card shows the latest step.";
  return "Not sent. Try again in a few minutes.";
}

export function useSend(send: SendPartner) {
  const [state, setState] = useState<SendState>({ kind: "open" });
  const run = async (command: Command) => {
    setState({ kind: "sending" });
    const message = partnerWords(await send(command));
    setState(message === null ? { kind: "sent" } : { kind: "failed", message });
  };
  return { state, run };
}

export function SendStatus({ state }: { state: SendState }) {
  if (state.kind === "sending") return <p className={cx("meta")}>Sending</p>;
  if (state.kind === "sent") return <p role="status">Sent. Thank you.</p>;
  if (state.kind === "failed") return <p role="alert">{state.message}</p>;
  return null;
}

type TextInputProps = {
  id: string;
  label: string;
  type?: "text" | "date" | "datetime-local";
  value: string;
  error: string | null;
  maxLength?: number;
  autoComplete?: string;
  onChange: (value: string) => void;
};

export function TextInput(props: TextInputProps) {
  const { id, label, type = "text", value, error, maxLength, autoComplete = "off", onChange } = props;
  const errorId = `${id}-error`;
  return (
    <div className={cx("field")}>
      <label className={cx("label")} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={cx("input", type === "text" ? "text" : "date")}
        type={type}
        value={value}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
      {error === null ? null : (
        <p id={errorId} className={cx("error")}>
          {error}
        </p>
      )}
    </div>
  );
}
