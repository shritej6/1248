import { useState } from "react";
import type { Command } from "@vision/contracts";
import type { CommandOutcome } from "../api.js";

export type DeskSend = (command: Command) => Promise<CommandOutcome>;
export type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string };

export function deskFailureWords(outcome: CommandOutcome): string | null {
  if (outcome.ok) return null;
  switch (outcome.code) {
    case "network":
      return "Not sent. No connection. Try again.";
    case "wrong_state":
    case "not_found":
      return "Not sent. This changed on the hub. The board shows the new state.";
    case "taken":
      return "Not sent. Someone else took it first.";
    case "forbidden":
    case "unauthorized":
      return "Not sent. Your account cannot do this. Ask the organiser.";
    default:
      return `Not sent. The hub refused it (${outcome.code}).`;
  }
}

export function useDeskCommand(send: DeskSend, onSent?: () => void) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const run = async (command: Command): Promise<boolean> => {
    setState({ kind: "sending" });
    const message = deskFailureWords(await send(command));
    setState(message === null ? { kind: "idle" } : { kind: "failed", message });
    if (message === null) onSent?.();
    return message === null;
  };
  return { state, run, busy: state.kind === "sending" };
}
