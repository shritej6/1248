import type { Lang, SystemCommand } from "@vision/contracts";
import { z } from "zod";
import { AiJobError, type AiJob, type AiTools } from "./types.js";

const TEXT_LIMIT = 4000;
const TranslationSchema = z.object({ translated_text: z.string() });

const messageOf = (sql: SqlStorage, card: string): string | null =>
  sql
    .exec<{ body: string }>(
      "SELECT body FROM vault WHERE card = ? AND kind = 'message_in' ORDER BY id DESC LIMIT 1",
      card,
    )
    .toArray()[0]?.body ?? null;

const sourceOf = (tools: AiTools, card: string): Lang => tools.state.cards[card]?.lang ?? "es";

const translate = async (tools: AiTools, text: string, source: Lang): Promise<string> => {
  const reply = await tools.run(tools.model, { text, source_lang: source, target_lang: "en" });
  const parsed = TranslationSchema.safeParse(reply);
  if (!parsed.success) throw new AiJobError("The translation model gave no translated text.");
  return parsed.data.translated_text.trim().slice(0, TEXT_LIMIT);
};

const run = async (card: string, tools: AiTools): Promise<SystemCommand> => {
  const message = messageOf(tools.sql, card);
  const source = sourceOf(tools, card);
  if (message === null || message.trim() === "" || source === "en")
    return { type: "lang.result", card, outcome: "empty", text: null };
  const text = await translate(tools, message, source);
  return text === ""
    ? { type: "lang.result", card, outcome: "empty", text: null }
    : { type: "lang.result", card, outcome: "ok", text };
};

export const langJob: AiJob = {
  key: "lang",
  model: (env) => env.TRANSLATE_MODEL,
  run,
  fallback: (card, outcome) => ({ type: "lang.result", card, outcome, text: null }),
};
