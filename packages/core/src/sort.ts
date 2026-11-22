import { DIVISIONS, SERVICES, type Flag, type SortPass, type Urgency } from "@vision/contracts";

export type SortInput = {
  message: string;
  passes: SortPass[] | null;
  error: "off" | "ai_down" | null;
  wordList: readonly string[];
};

export type SortCheck = {
  source: "ai" | "none";
  service: string | null;
  division: string | null;
  urgency: Urgency | null;
  quotes: string[];
  flags: Flag[];
};

const fold = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

export const wordListHit = (message: string, wordList: readonly string[]): boolean => {
  const text = fold(message);
  return wordList.some((word) => word.length > 0 && text.includes(fold(word)));
};

const OTHER_SERVICE = "Other";
const NO_DIVISION = "No clear home";

const onList = (list: readonly string[], value: string): boolean => list.includes(value);

const known = (pass: SortPass): boolean => onList(SERVICES, pass.service) && onList(DIVISIONS, pass.division);

const fit = (pass: SortPass): SortPass => ({
  ...pass,
  service: onList(SERVICES, pass.service) ? pass.service : OTHER_SERVICE,
  division: onList(DIVISIONS, pass.division) ? pass.division : NO_DIVISION,
});

const answered = (input: SortInput): [SortPass, ...SortPass[]] | null => {
  if (input.error !== null || input.passes === null) return null;
  const [first, ...rest] = input.passes.map(fit);
  return first === undefined ? null : [first, ...rest];
};

const noAnswer = (input: SortInput): SortCheck => ({
  source: "none",
  service: null,
  division: null,
  urgency: null,
  quotes: [],
  flags: [
    input.error === "off" ? "sorter_off" : "ai_down",
    ...(wordListHit(input.message, input.wordList) ? (["word_list_hit"] as const) : []),
  ],
});

export const checkSort = (input: SortInput): SortCheck => {
  const passes = answered(input);
  if (passes === null) return noAnswer(input);
  const [first] = passes;
  const urgency: Urgency = passes.some((p) => p.urgency === "high") ? "high" : "low";
  const words = [...new Set(passes.map((p) => p.words.trim()).filter((w) => w.length > 0))];
  const message = fold(input.message);
  const quotes = words.filter((w) => message.includes(fold(w)));
  const flags: Flag[] = [];
  const offList = !(input.passes ?? []).every(known);
  if (offList || passes.some((p) => p.service !== first.service || p.division !== first.division)) {
    flags.push("passes_disagree");
  }
  if (quotes.length < words.length) flags.push("quote_not_found");
  if (urgency === "low" && wordListHit(input.message, input.wordList)) flags.push("word_list_hit");
  return { source: "ai", service: first.service, division: first.division, urgency, quotes, flags };
};
