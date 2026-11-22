import { z } from "zod";
import { readAudio } from "./audio.js";
import { AiJobError, type AiJob } from "./types.js";

const MAX_TEXT = 4000;
const BASE64_CHUNK = 0x8000;
const SpeechReplySchema = z.object({ text: z.string() });

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let from = 0; from < bytes.length; from += BASE64_CHUNK)
    binary += String.fromCharCode(...bytes.subarray(from, from + BASE64_CHUNK));
  return btoa(binary);
};

export const speechInput = (bytes: Uint8Array): { audio: string; vad_filter: true } => ({
  audio: toBase64(bytes),
  vad_filter: true,
});

export const voiceJob: AiJob = {
  key: "voice",
  model: (env) => env.VOICE_MODEL,
  run: async (card, tools) => {
    const audio = readAudio(tools.sql, card);
    if (audio === null) return { type: "voice.result", card, outcome: "failed", text: null };
    const reply = SpeechReplySchema.safeParse(await tools.run(tools.model, speechInput(audio.bytes)));
    if (!reply.success) throw new AiJobError("The speech model gave no transcript.");
    const text = reply.data.text.trim().slice(0, MAX_TEXT);
    return text.length === 0
      ? { type: "voice.result", card, outcome: "empty", text: null }
      : { type: "voice.result", card, outcome: "ok", text };
  },
  fallback: (card, outcome) => ({ type: "voice.result", card, outcome, text: null }),
};
