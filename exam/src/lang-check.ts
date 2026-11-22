import { MIN_WORDS, SHORT_WORDS, SPANISH_SHARE, detectLanguage } from "@vision/core";
import { z } from "zod";
import {
  CheckStopped,
  cloudflareAi,
  examRows,
  writeCheckResult,
  type CheckAi,
  type ExamRow,
} from "./checks.js";
import { checkFidelity, type Fidelity } from "./lang-facts.js";
import { chicagoDate } from "./record.js";

export const SPANISH_IDS = ["m008", "m040", "m060", "m062", "m071", "m079"] as const;
export const LANG_MAX_NEURONS = 200;
const DEFAULT_MODEL = "@cf/meta/m2m100-1.2b";
const TranslationSchema = z.object({ translated_text: z.string() });

export type Detection = { checked: number; found: string[]; missed: string[]; falseSpanish: string[] };
export type Translation = { id: string; text: string; translation: string };
export type LangCheck = {
  date: string;
  model: string;
  rule: { spanishShare: number; minWords: number; shortWords: number };
  checked: number;
  expected: number;
  found: number;
  falseSpanish: number;
  foundIds: string[];
  missedIds: string[];
  falseSpanishIds: string[];
  translations: Translation[];
  fidelity: Fidelity[];
  safetyLost: number;
  neurons: number;
  passed: boolean;
};

export const detectRows = (rows: readonly ExamRow[]): Detection => {
  const spanish = rows.filter((row) => detectLanguage(row.text) === "es");
  return {
    checked: rows.length,
    found: spanish.filter((row) => row.lang === "es").map((row) => row.id),
    missed: rows.filter((row) => row.lang === "es" && !spanish.includes(row)).map((row) => row.id),
    falseSpanish: spanish.filter((row) => row.lang !== "es").map((row) => row.id),
  };
};

const translate = async (ai: CheckAi, model: string, row: ExamRow): Promise<Translation> => {
  const reply = await ai.json(model, { text: row.text, source_lang: "es", target_lang: "en" });
  const parsed = TranslationSchema.safeParse(reply);
  return {
    id: row.id,
    text: row.text,
    translation: parsed.success ? parsed.data.translated_text.trim() : "",
  };
};

export const runLangCheck = async (
  ai: CheckAi,
  model: string,
  rows: readonly ExamRow[],
  at: Date,
): Promise<LangCheck> => {
  const detection = detectRows(rows);
  const spanish = rows.filter((row) => row.lang === "es");
  const translations: Translation[] = [];
  for (const row of spanish) translations.push(await translate(ai, model, row));
  const found = detection.found.length;
  const allTranslated = translations.every((t) => t.translation !== "");
  const fidelity = translations.map((t) => checkFidelity(t.id, t.translation));
  const safetyLost = fidelity.reduce((sum, f) => sum + f.safetyLost.length, 0);
  return {
    date: chicagoDate(at),
    model,
    rule: { spanishShare: SPANISH_SHARE, minWords: MIN_WORDS, shortWords: SHORT_WORDS },
    checked: detection.checked,
    expected: spanish.length,
    found,
    falseSpanish: detection.falseSpanish.length,
    foundIds: detection.found,
    missedIds: detection.missed,
    falseSpanishIds: detection.falseSpanish,
    translations,
    fidelity,
    safetyLost,
    neurons: ai.neurons(),
    passed:
      found === spanish.length && detection.falseSpanish.length === 0 && allTranslated && safetyLost === 0,
  };
};

export const saveLangCheck = (result: LangCheck, at: Date, root?: URL): URL =>
  writeCheckResult("lang-results", result, at, root);

const main = async (): Promise<void> => {
  const fromEnv = process.env.TRANSLATE_MODEL ?? "";
  const model = fromEnv === "" ? DEFAULT_MODEL : fromEnv;
  const at = new Date();
  const result = await runLangCheck(cloudflareAi(LANG_MAX_NEURONS), model, examRows(), at);
  const url = saveLangCheck(result, at);
  console.log(`detector: ${String(result.found)} of ${String(result.expected)} Spanish messages found`);
  console.log(`detector: ${String(result.falseSpanish)} English messages marked Spanish`);
  console.log(`translations: ${String(result.translations.length)}, neurons used: ${String(result.neurons)}`);
  console.log(`translations: ${String(result.safetyLost)} safety facts lost`);
  console.log(`${result.passed ? "passed" : "not passed"}, saved in ${url.pathname}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (!(error instanceof CheckStopped)) throw error;
    console.error(`lang check stopped: ${error.message}`);
    process.exitCode = 2;
  });
}
