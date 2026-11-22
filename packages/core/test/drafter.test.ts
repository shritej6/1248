import { DRAFT_TEXT_MAX, DraftResultSchema, type DraftFacts } from "@vision/contracts";
import fc from "fast-check";
import { expect, it } from "vitest";
import {
  DRAFT_MAX_TOKENS,
  DRAFT_TRIES,
  createDrafter,
  drafterInput,
  failedDraft,
  offDraft,
  readDraftText,
  type DrafterTools,
} from "../src/resources/drafter.js";
import { DRAFT_PROMPT_SHA256, DRAFT_PROMPT_V1 } from "../src/resources/prompt.js";
import { templateDraft, withFooter } from "../src/resources/template.js";
import { sha256Hex } from "../src/seal.js";
import { uid } from "./arbitraries.js";

const MODEL = "@cf/test/draft-model";
const FACTS: DraftFacts = {
  kind: "impact_post",
  month: "2026-11",
  resource: null,
  facts: [
    { key: "org", label: "Group", text: "ComForce MKE" },
    { key: "month", label: "Month", text: "November 2026 so far" },
    { key: "new", label: "Jobs planned", text: "14" },
    { key: "helped", label: "Jobs closed as helped", text: "9" },
    { key: "unmet", label: "Jobs on the unmet shelf now", text: "3" },
    { key: "hours", label: "Volunteer hours", text: "312" },
    { key: "in_kind", label: "Value of volunteer time at $34.67 an hour", text: "$10,817" },
  ],
  claims: { c3: false, sponsor: false },
  footer: "Source: the Vision record for November 2026 so far, sealed at line 128.",
};
const GOOD = "In November 2026 so far, our volunteers helped 9 of 14 requests. Thank you to every volunteer!";
const INVENTED = "In November 2026 our volunteers helped 15 neighbours. Thank you to every volunteer!";
const QUOTED = 'In November 2026 our volunteers helped 9 of 14 requests. "Thank you," the family said.';

type Harness = { tools: DrafterTools; waits: number[]; logs: Record<string, string>[] };

const harness = (): Harness => {
  const waits: number[] = [];
  const logs: Record<string, string>[] = [];
  const tools: DrafterTools = {
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    log: (fields) => {
      logs.push(fields);
    },
  };
  return { tools, waits, logs };
};

const replies = (...list: unknown[]) => {
  const calls: { model: string; input: unknown }[] = [];
  const run = (model: string, input: unknown): Promise<unknown> => {
    calls.push({ model, input });
    const next = list[Math.min(calls.length, list.length) - 1];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { run, calls };
};

const TEMPLATE = withFooter(templateDraft(FACTS), FACTS);

it("the prompt has its tested hash", () => {
  expect(DRAFT_PROMPT_V1.split("\n")).toHaveLength(14);
  expect(DRAFT_PROMPT_V1).toContain('Answer with JSON only, in this form: {"text": "..."}');
  expect(sha256Hex(DRAFT_PROMPT_V1)).toBe(DRAFT_PROMPT_SHA256);
});

it("the model input holds the prompt and the facts as data, with a token cap and no reasoning", () => {
  const input = drafterInput(FACTS) as { messages: { role: string; content: string }[] };
  expect(input).toMatchObject({ max_tokens: 400, chat_template_kwargs: { enable_thinking: false } });
  expect(input).not.toHaveProperty("temperature");
  expect(input.messages.map((m) => m.role)).toEqual(["system", "user"]);
  expect(input.messages[0]?.content).toBe(DRAFT_PROMPT_V1);
  expect(JSON.parse(input.messages[1]?.content ?? "")).toEqual({
    kind: "impact_post",
    facts: FACTS.facts.map(({ label, text }) => ({ label, text })),
  });
  expect(input.messages[1]?.content).not.toContain("Source:");
  expect(drafterInput({ ...FACTS, kind: "funder_letter" })).toMatchObject({ max_tokens: 700 });
  expect(DRAFT_MAX_TOKENS).toEqual({ impact_post: 400, funder_letter: 700 });
});

it.each([
  ["a response object", { response: { text: GOOD } }],
  ["a response string of JSON", { response: JSON.stringify({ text: GOOD }) }],
  ["a chat choice", { choices: [{ message: { content: JSON.stringify({ text: GOOD }) } }] }],
  ["JSON inside other words", { response: `Here it is: ${JSON.stringify({ text: GOOD })} Done.` }],
])("%s that passes the guard is the AI draft with the footer", async (_name, reply) => {
  const { run, calls } = replies(reply);
  const { tools, waits } = harness();
  const outcome = await createDrafter(run, MODEL, tools)(FACTS);
  expect(outcome).toEqual({ text: `${GOOD}\n\n${FACTS.footer}`, source: "ai", flag: null, reasons: [] });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.model).toBe(MODEL);
  expect(waits).toEqual([]);
});

it("three invented numbers give the template, guard_rejected and the number reason", async () => {
  const { run, calls } = replies({ response: { text: INVENTED } });
  const { tools, waits } = harness();
  const outcome = await createDrafter(run, MODEL, tools)(FACTS);
  expect(outcome).toEqual({
    text: TEMPLATE,
    source: "template",
    flag: "guard_rejected",
    reasons: ["number"],
  });
  expect(calls).toHaveLength(DRAFT_TRIES);
  expect(waits).toEqual([250, 1000]);
});

it("the reasons of every stopped try come together in the order of the guard", async () => {
  const { run } = replies({ response: { text: QUOTED } }, new TypeError("down"), {
    response: { text: INVENTED },
  });
  const outcome = await createDrafter(run, MODEL, harness().tools)(FACTS);
  expect(outcome).toMatchObject({
    source: "template",
    flag: "guard_rejected",
    reasons: ["number", "quote", "story"],
  });
});

it("a call that throws is logged by its error name only, and three of them give ai_failed", async () => {
  const { run, calls } = replies(new TypeError("ComForce MKE helped 14"));
  const { tools, waits, logs } = harness();
  const outcome = await createDrafter(run, MODEL, tools)(FACTS);
  expect(outcome).toEqual({ text: TEMPLATE, source: "template", flag: "ai_failed", reasons: [] });
  expect(calls).toHaveLength(3);
  expect(waits).toEqual([250, 1000]);
  expect(logs).toEqual(
    Array.from({ length: 3 }, () => ({
      op: "drafter",
      model: MODEL,
      status: "call_failed",
      error: "TypeError",
    })),
  );
  expect(JSON.stringify(logs)).not.toContain("ComForce");
});

it("a reply with no text counts as no answer", async () => {
  const { run, calls } = replies({ response: { words: GOOD } }, { response: "not JSON" }, { nothing: true });
  const outcome = await createDrafter(run, MODEL, harness().tools)(FACTS);
  expect(outcome).toMatchObject({ source: "template", flag: "ai_failed", reasons: [] });
  expect(calls).toHaveLength(3);
});

it("a stopped try, then a failed call, then a good text is the AI draft", async () => {
  const { run, calls } = replies({ response: { text: INVENTED } }, new Error("busy"), {
    response: { text: GOOD },
  });
  const { tools, waits } = harness();
  expect(await createDrafter(run, MODEL, tools)(FACTS)).toMatchObject({ source: "ai", flag: null });
  expect(calls).toHaveLength(3);
  expect(waits).toEqual([250, 1000]);
});

it("the AI text is kept in the NFKC form that the guard checked", async () => {
  const wide = GOOD.replace("14", "\uFF11\uFF14");
  const { run } = replies({ response: { text: `  ${wide}  ` } });
  const outcome = await createDrafter(run, MODEL, harness().tools)(FACTS);
  expect(outcome.text).toBe(`${GOOD}\n\n${FACTS.footer}`);
});

it("the AI text is kept without the format marks that the guard removed before its checks", async () => {
  const hidden = GOOD.replace("volunteers", "volun​teers").replace("Thank", "⁠Thank­");
  const { run } = replies({ response: { text: hidden } });
  const outcome = await createDrafter(run, MODEL, harness().tools)(FACTS);
  expect(outcome).toMatchObject({ source: "ai", text: `${GOOD}\n\n${FACTS.footer}` });
});

it("readDraftText trims the text and gives null without one", () => {
  expect(readDraftText({ response: { text: `  ${GOOD}\n` } })).toBe(GOOD);
  expect(readDraftText({ response: { text: 7 } })).toBeNull();
  expect(readDraftText("text")).toBeNull();
});

it("offDraft and failedDraft are the template with the footer and their flag", () => {
  expect(offDraft(FACTS)).toEqual({ text: TEMPLATE, source: "template", flag: "ai_off", reasons: [] });
  expect(failedDraft(FACTS)).toEqual({ text: TEMPLATE, source: "template", flag: "ai_failed", reasons: [] });
});

it("any AI text gives an outcome that fits the draft.result command", async () => {
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 3000 }), async (text) => {
      const { run } = replies({ response: { text: `${GOOD} ${text}` } });
      const outcome = await createDrafter(run, MODEL, harness().tools)(FACTS);
      expect(outcome.text.length).toBeLessThanOrEqual(DRAFT_TEXT_MAX);
      expect(outcome.text.endsWith(FACTS.footer)).toBe(true);
      const command = { type: "draft.result", draft: uid("d_", 1), ...outcome };
      expect(DraftResultSchema.safeParse(command).success).toBe(true);
    }),
    { numRuns: 60 },
  );
});
