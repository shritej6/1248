import { expect, it } from "vitest";
import type { CheckAi } from "../src/checks.js";
import {
  AURA_NEURONS_PER_CHAR,
  EMERGENCY_IDS,
  auraSpeech,
  runVoiceCheck,
  wordErrorRate,
  wordsOf,
  type Speech,
} from "../src/voice-check.js";

const VOICE = "@cf/openai/whisper-large-v3-turbo";

type Call = { model: string; input: unknown };

const fakeAi = (answer: (call: Call) => unknown, neuronsPerCall = 5): CheckAi & { calls: Call[] } => {
  const calls: Call[] = [];
  return {
    calls,
    json: (model, input) => {
      calls.push({ model, input });
      return Promise.resolve(answer({ model, input }));
    },
    bytes: () => Promise.reject(new Error("no bytes in tests")),
    neurons: () => calls.length * neuronsPerCall,
  };
};

const textSpeech = (): Speech & { said: string[] } => {
  const said: string[] = [];
  return {
    said,
    name: "test",
    speak: (text) => {
      said.push(text);
      return Promise.resolve({ bytes: new TextEncoder().encode(text), neurons: 0 });
    },
  };
};

const spoken = (input: unknown): string =>
  Buffer.from((input as { audio: string }).audio, "base64").toString("utf8");

it("words are folded to lower case with no punctuation, and numbers keep their digits", () => {
  expect(wordsOf("Hi, my NUMBER is 414-555-0132. Thank you!")).toEqual([
    "hi",
    "my",
    "number",
    "is",
    "414",
    "555",
    "0132",
    "thank",
    "you",
  ]);
});

it("the word error rate counts substitutions, deletions and insertions over the reference words", () => {
  expect(wordErrorRate("the cat sat on the mat", "the cat sat on the mat")).toEqual({
    words: 6,
    errors: 0,
    rate: 0,
  });
  expect(wordErrorRate("the cat sat on the mat", "the bat sat on mat")).toEqual({
    words: 6,
    errors: 2,
    rate: 2 / 6,
  });
  expect(wordErrorRate("no heat", "there is no heat at all")).toMatchObject({ errors: 4, rate: 2 });
  expect(wordErrorRate("", "")).toEqual({ words: 0, errors: 0, rate: 0 });
});

it("the check speaks the 8 voicemail messages, transcribes each once and finds the emergencies", async () => {
  const speech = textSpeech();
  const ai = fakeAi((call) => ({ text: spoken(call.input) }));
  const result = await runVoiceCheck({ ai, speech, voiceModel: VOICE, sorterModel: null, demo: null });
  expect(speech.said.length).toBe(8);
  expect(ai.calls.map((c) => c.model)).toEqual(Array.from({ length: 8 }, () => VOICE));
  expect(ai.calls[0]?.input).toMatchObject({ vad_filter: true });
  expect(result.overall.rate).toBe(0);
  expect(result.emergencies.ids).toEqual(EMERGENCY_IDS);
  expect(result.emergencies.foundInOriginal).toEqual(["m020", "m033"]);
  expect(result.emergencies.foundInTranscript).toEqual(["m020", "m033"]);
  expect(result.emergencies.allFound).toBe(false);
  expect(result.sorterModel).toBeNull();
  expect(result.neurons.total).toBe(40);
});

it("a garbled transcript gives a word error rate and can lose a word list hit", async () => {
  const ai = fakeAi((call) => ({ text: spoken(call.input).replace("no heat", "know heat") }));
  const result = await runVoiceCheck({
    ai,
    speech: textSpeech(),
    voiceModel: VOICE,
    sorterModel: null,
    demo: null,
  });
  const m020 = result.messages.find((m) => m.id === "m020");
  expect(m020?.errors).toBe(1);
  expect([m020?.wordListInOriginal, m020?.wordListInTranscript, m020?.found]).toEqual([true, false, false]);
  expect(result.overall.errors).toBe(1);
  expect(result.emergencies.foundInTranscript).toEqual(["m033"]);
});

it("with a sorter model the check sorts each transcript and a high answer counts as found", async () => {
  const pass = (urgency: "high" | "low") => ({
    response: JSON.stringify({
      service: "Other",
      division: "No clear home",
      urgency,
      words: "",
      reason: "test",
    }),
  });
  const ai = fakeAi((call) => (call.model === VOICE ? { text: spoken(call.input) } : pass("high")));
  const result = await runVoiceCheck({
    ai,
    speech: textSpeech(),
    voiceModel: VOICE,
    sorterModel: "@cf/test/sorter",
    demo: null,
  });
  expect(result.sorterModel).toBe("@cf/test/sorter");
  expect(result.messages.every((m) => m.sorter === "high")).toBe(true);
  expect(result.emergencies.foundInTranscript).toEqual(EMERGENCY_IDS);
  expect(result.emergencies.allFound).toBe(true);
});

it("the demo voicemail is transcribed once and checked with the word list", async () => {
  const ai = fakeAi(() => ({ text: "There is a gas smell in the kitchen." }));
  const demo = new Uint8Array([1, 2, 3]);
  const result = await runVoiceCheck({
    ai,
    speech: textSpeech(),
    voiceModel: VOICE,
    sorterModel: null,
    demo,
  });
  expect(ai.calls.length).toBe(9);
  expect(result.demo).toEqual({ transcript: "There is a gas smell in the kitchen.", wordListHit: true });
});

it("speech from aura-2-en is refused before any call when its cost would pass the budget", async () => {
  const ai = fakeAi(() => ({ text: "" }));
  const speech = auraSpeech(ai, 600);
  const long = "a".repeat(Math.ceil(600 / AURA_NEURONS_PER_CHAR) + 1);
  await expect(speech.speak(long)).rejects.toThrow(/neurons/);
  expect(ai.calls).toEqual([]);
});
