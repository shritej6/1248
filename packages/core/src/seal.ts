import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { EventDraft, Hasher, LedgerEvent } from "@vision/contracts";
import { canonicalJson } from "./canonical.js";

export type SealCheck = { ok: true; seq: number; hash: string } | { ok: false; badSeq: number };

export const GENESIS_HASH = "0".repeat(64);

export const sha256Hex: Hasher = (text) => bytesToHex(sha256(utf8ToBytes(text)));

const lineHash = (line: Omit<LedgerEvent, "prev" | "hash">, prev: string): string =>
  sha256Hex(
    `${prev}\n${canonicalJson({
      seq: line.seq,
      at: line.at,
      card: line.card,
      job: line.job,
      type: line.type,
      actor: line.actor,
      data: line.data,
    })}`,
  );

export const sealEvent = (draft: EventDraft, seq: number, at: number, prev: string): LedgerEvent => {
  const line = { ...draft, seq, at } as Omit<LedgerEvent, "prev" | "hash">;
  return { ...line, prev, hash: lineHash(line, prev) } as LedgerEvent;
};

export const verifySeal = (events: readonly LedgerEvent[]): SealCheck => {
  let seq = 0;
  let hash = GENESIS_HASH;
  for (const event of events) {
    if (event.seq !== seq + 1 || event.prev !== hash || event.hash !== lineHash(event, event.prev)) {
      return { ok: false, badSeq: event.seq };
    }
    seq = event.seq;
    hash = event.hash;
  }
  return { ok: true, seq, hash };
};
