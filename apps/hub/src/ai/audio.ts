import type { VoiceType } from "@vision/contracts";

export const AUDIO_PART_BYTES = 512 * 1024;

export type StoredAudio = { mime: string; bytes: Uint8Array };

type AudioRow = { mime: string; bytes: ArrayBuffer };

export const writeAudio = (
  sql: SqlStorage,
  card: string,
  audio: { mime: VoiceType; bytes: Uint8Array },
  at: number,
): number => {
  let part = 0;
  for (let from = 0; from < audio.bytes.length; from += AUDIO_PART_BYTES) {
    sql.exec(
      "INSERT INTO vault_audio (card, part, mime, bytes, at, forget_at) VALUES (?, ?, ?, ?, ?, NULL)",
      card,
      part,
      audio.mime,
      audio.bytes.slice(from, from + AUDIO_PART_BYTES),
      at,
    );
    part += 1;
  }
  return part;
};

export const joinBytes = (chunks: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
};

export const readAudio = (sql: SqlStorage, card: string): StoredAudio | null => {
  const rows = sql
    .exec<AudioRow>("SELECT mime, bytes FROM vault_audio WHERE card = ? ORDER BY part", card)
    .toArray();
  const [first] = rows;
  if (first === undefined) return null;
  return { mime: first.mime, bytes: joinBytes(rows.map((row) => new Uint8Array(row.bytes))) };
};

export const deleteAudio = (sql: SqlStorage, card: string): void => {
  sql.exec("DELETE FROM vault_audio WHERE card = ?", card);
};
