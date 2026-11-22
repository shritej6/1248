export type KeyRow = {
  id: string;
  text: string;
  true_service: string;
  alt_service: string | null;
  true_division: string;
  alt_division: string | null;
  true_urgency: "high" | "low";
};

export type PredRow = { id: string; service: string; division: string; urgency: string; words: string };

export type Score = {
  caught: number;
  emergencies: number;
  falseAlarms: number;
  needRight: number;
  divisionRight: number;
  quotesExact: number;
};

const fold = (text: string): string => text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

const squash = (text: string): string =>
  fold(text)
    .replace(/^\s*\d+\.\s*/u, "")
    .replace("(no function listed)", "")
    .replace(/\s+/gu, " ")
    .trim();

const labelRight = (truth: string, alt: string | null, value: string): boolean =>
  [truth, ...(alt === null ? [] : [alt])].some((label) => squash(label) === squash(value));

const passesById = (predictions: readonly PredRow[]): Map<string, PredRow[]> => {
  const byId = new Map<string, PredRow[]>();
  for (const p of predictions) byId.set(p.id, [...(byId.get(p.id) ?? []), p]);
  return byId;
};

const isHigh = (passes: readonly PredRow[]): boolean => passes.some((p) => squash(p.urgency) === "high");

const quoteExact = (row: KeyRow, first: PredRow): boolean =>
  first.words.trim().length > 0 && squash(row.text).includes(squash(first.words));

export const scoreRun = (key: readonly KeyRow[], predictions: readonly PredRow[]): Score => {
  const byId = passesById(predictions);
  const score: Score = {
    caught: 0,
    emergencies: 0,
    falseAlarms: 0,
    needRight: 0,
    divisionRight: 0,
    quotesExact: 0,
  };
  for (const row of key) {
    const passes = byId.get(row.id) ?? [];
    const high = isHigh(passes);
    if (row.true_urgency === "high") score.emergencies += 1;
    if (row.true_urgency === "high" && high) score.caught += 1;
    if (row.true_urgency === "low" && high) score.falseAlarms += 1;
    const [first] = passes;
    if (first === undefined) continue;
    if (labelRight(row.true_service, row.alt_service, first.service)) score.needRight += 1;
    if (labelRight(row.true_division, row.alt_division, first.division)) score.divisionRight += 1;
    if (quoteExact(row, first)) score.quotesExact += 1;
  }
  return score;
};

export const REQUIRED_RUNS = 2;

export const examPassed = (runs: readonly Score[]): boolean =>
  runs.length >= REQUIRED_RUNS && runs.every((s) => s.emergencies > 0 && s.caught === s.emergencies);
