import type { Lang } from "@vision/contracts";

export const SPANISH_SHARE = 0.2;
export const MIN_WORDS = 3;
export const SHORT_WORDS = 8;
export const SPANISH_MARK = /[\u00f1\u00bf\u00a1\u00e1\u00e9\u00ed\u00f3\u00fa]/iu;

export const SPANISH_WORDS: ReadonlySet<string> = new Set([
  "de",
  "la",
  "que",
  "el",
  "en",
  "y",
  "los",
  "por",
  "con",
  "para",
  "una",
  "un",
  "es",
  "las",
  "lo",
  "nos",
  "pero",
  "muy",
  "como",
  "esta",
  "este",
  "estoy",
  "tengo",
  "usted",
  "ustedes",
  "gracias",
  "necesito",
  "ayuda",
]);

const WORD = /\p{L}+(?:['\u2019]\p{L}+)*/gu;
const NAME = /^\p{Lu}\p{Ll}/u;
const SENTENCE = /[.!?\u00bf\u00a1\n]+/u;

const rawWords = (text: string): string[] => text.match(WORD) ?? [];

const fold = (word: string): string => word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export const wordsOf = (text: string): string[] => rawWords(text).map(fold);

export const spanishHits = (text: string): string[] =>
  text
    .split(SENTENCE)
    .flatMap((sentence) => rawWords(sentence).filter((word, i) => i === 0 || !NAME.test(word)))
    .map(fold)
    .filter((word) => SPANISH_WORDS.has(word));

export const spanishShare = (text: string): number => {
  const count = wordsOf(text).length;
  return count === 0 ? 0 : spanishHits(text).length / count;
};

const enoughSignal = (text: string, count: number): boolean =>
  count >= SHORT_WORDS || new Set(spanishHits(text)).size >= 2 || SPANISH_MARK.test(text);

export const detectLanguage = (text: string): Lang => {
  const count = wordsOf(text).length;
  if (count < MIN_WORDS || spanishShare(text) < SPANISH_SHARE) return "en";
  return enoughSignal(text, count) ? "es" : "en";
};
