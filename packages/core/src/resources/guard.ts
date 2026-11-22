import {
  DRAFT_MAX_CHARS,
  GUARD_REASONS,
  type DraftFact,
  type DraftFacts,
  type GuardReason,
} from "@vision/contracts";

export type GuardResult = { ok: true } | { ok: false; reasons: GuardReason[] };

const MIN_CHARS = 40;
const SCRUB_MIN_CHARS = 4;
const NUMBER_TOKEN = /\$?\p{Nd}[\p{Nd},]*(?:\.\p{Nd}+)?/gu;
const ASCII_NUMBER = /^\$?[0-9][0-9,]*(?:\.[0-9]+)?$/u;
const NUMBER_SUFFIX = /\p{Nd}(?:[\p{Zs}\t]?[kmbx]\b|\+)/iu;
const PERCENT = /%|\bper\s?cent\b/iu;
const NO_ONE = /\bno one\b/giu;
const NUMBER_WORD =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|dozens?|half|twice|quarters?|doubl(?:e[ds]?|ing)|tripl(?:e[ds]?|ing)|quadrupl(?:e[ds]?|ing)|halv(?:e[ds]?|ing)|\w+-?fold)\b/iu;
const QUOTE_MARK = /["`\u201C\u201D\u201E\u201F\u00AB\u00BB\u2039\u203A\u2018]/u;
const OPEN_SINGLE = /(?:^|[\s(])['\u2019]/u;
const STORY = [
  /\b(?:said|says|told|tells|recalled|recalls|remembers|testimonials?|testimony|according to)\b/iu,
  /\bin (?:his|her|their) (?:own )?words\b/iu,
  /\b(?:Mr|Mrs|Ms|Mx|Dr|Miss|Rev|Pastor)\.?\s+\p{Lu}/u,
  /\b(?:a|our)\s+(?:resident|neighbou?r|volunteer|senior|mother|father|grandmother|grandfather|family|client|man|woman|girl|boy|child)\s+(?:named|called)\b/iu,
  /\b[Nn]amed\s+\p{Lu}\p{Ll}+/u,
  /\b(?:his|her|their) name (?:is|was)\b/iu,
  /\b[Mm]eet\s+\p{Lu}\p{Ll}+/u,
  /\bstor(?:y|ies) of\b/iu,
];
const LINK = /https?:\/\/|\bwww\.|@|[\p{L}\p{N}][.\u3002]\p{L}{2,}/iu;
const FORMAT_MARK = /\p{Cf}/u;
const FORMAT_MARKS = new RegExp(FORMAT_MARK.source, "gu");
const C3_CLAIM = /501\s*\(\s*c\s*\)\s*\(\s*3\s*\)/giu;
const STATUS_CLAIM =
  /\btax[\s\p{Pd}]?exempt\b|\bdeductible\b|\bnon[\s\p{Pd}]?profit\b|\bnot[\s\p{Pd}]?for[\s\p{Pd}]?profit\b|\bcharity\b|\bcharitable status\b/iu;
const SPONSOR_CLAIM = /\bfiscal(?:ly)? sponsor(?:ed|ship)?\b/iu;
const LETTER = /\p{L}/u;

const normalNumber = (token: string): string => String(Number(token.replaceAll("$", "").replaceAll(",", "")));

const when = (holds: boolean, reason: GuardReason): GuardReason[] => (holds ? [reason] : []);

export const draftText = (text: string): string => text.replace(FORMAT_MARKS, "").normalize("NFKC");

export const unsafeFacts = (facts: DraftFacts): DraftFact[] =>
  facts.facts.filter((f) => FORMAT_MARK.test(f.text) || LINK.test(draftText(f.text)));

export const allowedNumbers = (facts: DraftFacts): Set<string> =>
  new Set(
    facts.facts.flatMap((f) =>
      Array.from(`${f.label} ${f.text}`.matchAll(NUMBER_TOKEN), (m) => normalNumber(m[0])),
    ),
  );

const numberReasons = (raw: string, facts: DraftFacts): GuardReason[] => {
  const allowed = allowedNumbers(facts);
  const text = facts.claims.c3 ? raw.replace(C3_CLAIM, " ") : raw;
  const tokens = text.match(NUMBER_TOKEN) ?? [];
  const invented = !tokens.every((t) => ASCII_NUMBER.test(t) && allowed.has(normalNumber(t)));
  return when(invented || NUMBER_SUFFIX.test(text), "number");
};

const scrub = (raw: string, facts: DraftFacts): string =>
  facts.facts
    .map((f) => f.text)
    .filter((text) => LETTER.test(text) && text.length >= SCRUB_MIN_CHARS)
    .sort((a, b) => b.length - a.length)
    .reduce((scrubbed, text) => scrubbed.split(text).join("fact"), raw);

const wordReasons = (scrubbed: string): GuardReason[] => [
  ...when(QUOTE_MARK.test(scrubbed) || OPEN_SINGLE.test(scrubbed), "quote"),
  ...when(
    STORY.some((pattern) => pattern.test(scrubbed)),
    "story",
  ),
  ...when(PERCENT.test(scrubbed), "percent"),
  ...when(NUMBER_WORD.test(scrubbed.replace(NO_ONE, "nobody")), "number_word"),
];

const claimReasons = (scrubbed: string, claims: DraftFacts["claims"]): GuardReason[] => {
  const c3 = scrubbed.search(C3_CLAIM) >= 0 || STATUS_CLAIM.test(scrubbed);
  return when((c3 && !claims.c3) || (SPONSOR_CLAIM.test(scrubbed) && !claims.sponsor), "status_claim");
};

export const guardDraft = (text: string, facts: DraftFacts): GuardResult => {
  const raw = draftText(text);
  const scrubbed = scrub(raw, facts);
  const found = new Set<GuardReason>([
    ...when(raw.trim().length < MIN_CHARS, "empty"),
    ...when(raw.length > DRAFT_MAX_CHARS[facts.kind], "too_long"),
    ...when(LINK.test(raw), "link"),
    ...numberReasons(raw, facts),
    ...wordReasons(scrubbed),
    ...claimReasons(scrubbed, facts.claims),
  ]);
  const reasons = GUARD_REASONS.filter((reason) => found.has(reason));
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
};
