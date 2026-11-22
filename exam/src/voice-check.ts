import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs, promisify } from "node:util";
import { WORD_LIST, checkSort, createSorter, wordListHit } from "@vision/core";
import { z } from "zod";
import {
  CheckStopped,
  VOICEMAIL_TAG,
  cloudflareAi,
  examRows,
  writeCheckResult,
  type CheckAi,
  type ExamRow,
} from "./checks.js";
import { chicagoDate } from "./record.js";

export const NEURON_BUDGET = 600;
export const DEFAULT_VOICE_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const AURA_MODEL = "@cf/deepgram/aura-2-en";
export const AURA_NEURONS_PER_CHAR = 690 / 253;
export const EMERGENCY_IDS = ["m020", "m033", "m081"];
const SAY_VOICE = "Samantha";
const DEMO_FILE = new URL("../../data/synthetic/voicemail-demo.mp3", import.meta.url);
const SpeechReplySchema = z.object({ text: z.string() });
const run = promisify(execFile);

export type Speech = { name: string; speak(text: string): Promise<{ bytes: Uint8Array; neurons: number }> };
export type Wer = { words: number; errors: number; rate: number };
export type SortLabel = "high" | "low" | "ai_down";
export type MessageResult = Wer & {
  id: string;
  trueUrgency: ExamRow["true_urgency"];
  transcript: string;
  wordListInOriginal: boolean;
  wordListInTranscript: boolean;
  sorter: SortLabel | null;
  found: boolean;
};
export type VoiceCheckInput = {
  ai: CheckAi;
  speech: Speech;
  voiceModel: string;
  sorterModel: string | null;
  demo: Uint8Array | null;
};

export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

export const wordErrorRate = (reference: string, hypothesis: string): Wer => {
  const ref = wordsOf(reference);
  const hyp = wordsOf(hypothesis);
  let row = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (const [i, word] of ref.entries()) {
    const next = [i + 1];
    for (const [j, heard] of hyp.entries()) {
      const swap = (row[j] ?? 0) + (word === heard ? 0 : 1);
      next.push(Math.min((row[j + 1] ?? 0) + 1, (next[j] ?? 0) + 1, swap));
    }
    row = next;
  }
  const errors = row[hyp.length] ?? 0;
  return { words: ref.length, errors, rate: errors / Math.max(1, ref.length) };
};

export const speechInput = (bytes: Uint8Array): { audio: string; vad_filter: true } => ({
  audio: Buffer.from(bytes).toString("base64"),
  vad_filter: true,
});

const transcribe = async (ai: CheckAi, model: string, bytes: Uint8Array): Promise<string> => {
  const reply = SpeechReplySchema.safeParse(await ai.json(model, speechInput(bytes)));
  if (!reply.success) throw new CheckStopped(`The speech model ${model} gave no transcript.`);
  return reply.data.text.trim();
};

export const auraSpeech = (ai: CheckAi, budget: number): Speech => {
  let spent = 0;
  return {
    name: AURA_MODEL,
    speak: async (text) => {
      const cost = text.length * AURA_NEURONS_PER_CHAR;
      if (ai.neurons() + spent + cost > budget)
        throw new CheckStopped(
          `Speech for ${String(text.length)} characters costs about ${cost.toFixed(0)} neurons.`,
        );
      const bytes = await ai.bytes(AURA_MODEL, { text, speaker: "luna" });
      spent += cost;
      return { bytes, neurons: cost };
    },
  };
};

export const saySpeech = (): Speech => ({
  name: `macOS say, voice ${SAY_VOICE}, 16 kHz WAV`,
  speak: async (text) => {
    const dir = mkdtempSync(join(tmpdir(), "vision-voice-"));
    try {
      const [script, wav] = [join(dir, "text.txt"), join(dir, "speech.wav")];
      writeFileSync(script, text);
      await run("say", [
        "-v",
        SAY_VOICE,
        "--file-format=WAVE",
        "--data-format=LEI16@16000",
        "-o",
        wav,
        "-f",
        script,
      ]);
      return { bytes: new Uint8Array(readFileSync(wav)), neurons: 0 };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

const sortLabel = async (ai: CheckAi, model: string, row: ExamRow, text: string): Promise<SortLabel> => {
  const tools = { wait: (ms: number) => sleep(ms).then(() => undefined), log: () => undefined };
  const answer = await createSorter((m, input) => ai.json(m, input), model, tools)({ id: row.id, text });
  if ("error" in answer) return "ai_down";
  const check = checkSort({ message: text, passes: answer.passes, error: null, wordList: WORD_LIST });
  return check.urgency === "high" ? "high" : "low";
};

type Heard = { row: ExamRow; transcript: string };

const hearAll = async (input: VoiceCheckInput, rows: readonly ExamRow[]) => {
  const heard: Heard[] = [];
  let speech = 0;
  for (const row of rows) {
    const spoken = await input.speech.speak(row.text);
    speech += spoken.neurons;
    heard.push({ row, transcript: await transcribe(input.ai, input.voiceModel, spoken.bytes) });
    console.log(`voice check: ${row.id} transcribed`);
  }
  return { heard, speech };
};

const judge = async (input: VoiceCheckInput, { row, transcript }: Heard): Promise<MessageResult> => {
  const sorter =
    input.sorterModel === null ? null : await sortLabel(input.ai, input.sorterModel, row, transcript);
  const wordListInTranscript = wordListHit(transcript, WORD_LIST);
  return {
    id: row.id,
    trueUrgency: row.true_urgency,
    transcript,
    ...wordErrorRate(row.text, transcript),
    wordListInOriginal: wordListHit(row.text, WORD_LIST),
    wordListInTranscript,
    sorter,
    found: wordListInTranscript || sorter === "high",
  };
};

const overallOf = (messages: readonly MessageResult[]): Wer => {
  const words = messages.reduce((sum, m) => sum + m.words, 0);
  const errors = messages.reduce((sum, m) => sum + m.errors, 0);
  return { words, errors, rate: errors / Math.max(1, words) };
};

const emergenciesOf = (messages: readonly MessageResult[]) => {
  const ids = (pick: (m: MessageResult) => boolean) =>
    messages.filter((m) => EMERGENCY_IDS.includes(m.id) && pick(m)).map((m) => m.id);
  const foundInTranscript = ids((m) => m.found);
  return {
    ids: EMERGENCY_IDS,
    foundInOriginal: ids((m) => m.wordListInOriginal),
    foundInTranscript,
    allFound: EMERGENCY_IDS.every((id) => foundInTranscript.includes(id)),
  };
};

const demoOf = async (input: VoiceCheckInput) => {
  if (input.demo === null) return null;
  const transcript = await transcribe(input.ai, input.voiceModel, input.demo);
  return { transcript, wordListHit: wordListHit(transcript, WORD_LIST) };
};

export const runVoiceCheck = async (input: VoiceCheckInput) => {
  const rows = examRows().filter((row) => row.tags.includes(VOICEMAIL_TAG));
  const { heard, speech } = await hearAll(input, rows);
  const demo = await demoOf(input);
  const transcription = input.ai.neurons();
  const messages: MessageResult[] = [];
  for (const item of heard) messages.push(await judge(input, item));
  const total = input.ai.neurons() + speech;
  const sorter = input.ai.neurons() - transcription;
  return {
    date: chicagoDate(new Date()),
    voiceModel: input.voiceModel,
    speech: input.speech.name,
    auraEstimate: Math.round(rows.reduce((sum, row) => sum + row.text.length, 0) * AURA_NEURONS_PER_CHAR),
    sorterModel: input.sorterModel,
    messages,
    overall: overallOf(messages),
    emergencies: emergenciesOf(messages),
    demo,
    neurons: { speech, transcription, sorter, total },
  };
};

const options = () =>
  parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: {
      sorter: { type: "string" },
      speech: { type: "string", default: "say" },
      model: { type: "string", default: DEFAULT_VOICE_MODEL },
    },
  }).values;

const main = async (): Promise<void> => {
  const opts = options();
  const ai = cloudflareAi(NEURON_BUDGET);
  const speech = opts.speech === "aura" ? auraSpeech(ai, NEURON_BUDGET) : saySpeech();
  const demo = new Uint8Array(readFileSync(DEMO_FILE));
  const result = await runVoiceCheck({
    ai,
    speech,
    voiceModel: opts.model,
    sorterModel: opts.sorter ?? null,
    demo,
  });
  const url = writeCheckResult("voice-results", result, new Date());
  const { overall, emergencies, neurons } = result;
  console.log(`word error rate ${overall.rate.toFixed(3)} over ${String(overall.words)} words`);
  console.log(`emergencies found after transcription: ${emergencies.foundInTranscript.join(", ") || "none"}`);
  console.log(`neurons used: ${neurons.total.toFixed(1)}, saved in ${url.pathname}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (!(error instanceof CheckStopped)) throw error;
    console.error(`voice check stopped: ${error.message}`);
    process.exitCode = 2;
  });
}
