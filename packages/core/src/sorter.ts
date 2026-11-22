import { SortPassSchema, UrgencySchema, type SortPass } from "@vision/contracts";
import { z } from "zod";
import { SORTER_PROMPT_V1 } from "./prompt.js";

export type ModelRun = (model: string, input: unknown) => Promise<unknown>;
export type Wait = (ms: number) => Promise<void>;
export type SortAnswer = { passes: SortPass[] } | { error: "ai_down" };
export type Sorter = (message: { id: string; text: string }) => Promise<SortAnswer>;
export type SorterLog = (fields: Record<string, string>) => void;
export type SorterTools = { wait: Wait; log: SorterLog };

export const SORT_PASSES = 2;
export const SORT_TRIES = 3;
const MAX_TOKENS = 300;
const FIRST_WAIT_MS = 250;
const WAIT_GROWTH = 4;

const ReplyPassSchema = z.object({
  ...SortPassSchema.shape,
  urgency: z
    .string()
    .transform((u) => u.trim().toLowerCase())
    .pipe(UrgencySchema),
});
const ReplySchema = z.union([
  z.object({ response: z.union([z.string(), z.record(z.string(), z.unknown())]) }),
  z.object({ choices: z.tuple([z.object({ message: z.object({ content: z.string() }) })], z.unknown()) }),
]);

const objectText = (text: string): unknown => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

export const replyObject = (reply: unknown): unknown => {
  const parsed = ReplySchema.safeParse(reply);
  if (!parsed.success) return null;
  const body = "response" in parsed.data ? parsed.data.response : parsed.data.choices[0].message.content;
  return typeof body === "string" ? objectText(body) : body;
};

export const readPass = (reply: unknown): SortPass | null => {
  const pass = ReplyPassSchema.safeParse(replyObject(reply));
  if (!pass.success) return null;
  const { service, division, urgency, words, reason } = pass.data;
  return { service, division, urgency, words, reason };
};

const callOnce = async (
  run: ModelRun,
  model: string,
  input: unknown,
  log: SorterLog,
): Promise<SortPass | null> => {
  try {
    return readPass(await run(model, input));
  } catch (error) {
    log({
      op: "sorter",
      model,
      status: "call_failed",
      error: error instanceof Error ? error.name : "Error",
    });
    return null;
  }
};

const onePass = async (
  run: ModelRun,
  model: string,
  input: unknown,
  tools: SorterTools,
): Promise<SortPass | null> => {
  for (let tries = 1; tries <= SORT_TRIES; tries += 1) {
    const pass = await callOnce(run, model, input, tools.log);
    if (pass !== null) return pass;
    if (tries < SORT_TRIES) await tools.wait(FIRST_WAIT_MS * WAIT_GROWTH ** (tries - 1));
  }
  return null;
};

export const sorterInput = (message: { id: string; text: string }): unknown => ({
  messages: [
    { role: "system", content: SORTER_PROMPT_V1 },
    { role: "user", content: JSON.stringify({ id: message.id, text: message.text }) },
  ],
  max_tokens: MAX_TOKENS,
  chat_template_kwargs: { enable_thinking: false },
});

export const createSorter =
  (run: ModelRun, model: string, tools: SorterTools): Sorter =>
  async (message) => {
    const input = sorterInput(message);
    const passes: SortPass[] = [];
    for (let n = 0; n < SORT_PASSES; n += 1) {
      const pass = await onePass(run, model, input, tools);
      if (pass === null) return { error: "ai_down" };
      passes.push(pass);
    }
    return { passes };
  };
