import { useSyncExternalStore } from "react";
import type { DeskBoard } from "@vision/contracts";

const shown: { board: DeskBoard | null } = { board: null };
const listeners = new Set<() => void>();

export function publishBoard(board: DeskBoard): void {
  if (shown.board === board) return;
  shown.board = board;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = (): DeskBoard | null => shown.board;

export function useShownBoard(): DeskBoard | null {
  return useSyncExternalStore(subscribe, current, current);
}
