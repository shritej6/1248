import { LINK_THRESHOLD, embedInput, linkScore, roundScore, vectorsOf } from "@vision/core";
import { z } from "zod";
import {
  CheckStopped,
  cloudflareAi,
  examRows,
  writeCheckResult,
  type CheckAi,
  type ExamRow,
} from "./checks.js";
import { chicagoDate } from "./record.js";

export const LINK_CHECK_MODEL = "@cf/baai/bge-m3";
const MAX_NEURONS = 200;
const STEP = 0.001;
const SWEEP_FROM = 0.7;
const SWEEP_STEPS = 21;

const MetaNeuronsSchema = z.object({ meta: z.object({ neurons: z.number().nonnegative() }) });

export const metaNeurons = (reply: unknown): number => {
  const parsed = MetaNeuronsSchema.safeParse(reply);
  return parsed.success ? parsed.data.meta.neurons : 0;
};

export type PairKind = "same_event" | "look_alike" | "two_groups" | "unlabelled";
export type ScoredPair = { a: string; b: string; kind: PairKind; score: number };
export type ThresholdChoice = { threshold: number; truePairs: number; found: number; recall: number };
type Meta = { model: string; neurons: number; date: string };

export const pairKind = (one: ExamRow, two: ExamRow): PairKind => {
  if (one.event_group !== null && one.event_group === two.event_group) return "same_event";
  if (one.near_miss_partner === two.id || two.near_miss_partner === one.id) return "look_alike";
  return one.event_group !== null && two.event_group !== null ? "two_groups" : "unlabelled";
};

export const anyOtherEvent = (pair: ScoredPair): boolean => pair.kind !== "same_event";
export const labelledOnly = (pair: ScoredPair): boolean =>
  pair.kind === "look_alike" || pair.kind === "two_groups";

export const scorePairs = (rows: readonly ExamRow[], vectors: readonly (readonly number[])[]): ScoredPair[] =>
  rows.flatMap((one, i) =>
    rows.slice(i + 1).map((two, k) => ({
      a: one.id,
      b: two.id,
      kind: pairKind(one, two),
      score: linkScore(vectors[i] ?? [], vectors[i + 1 + k] ?? []),
    })),
  );

export const chooseThreshold = (
  scored: readonly ScoredPair[],
  isFalse: (pair: ScoredPair) => boolean = anyOtherEvent,
): ThresholdChoice => {
  const falseScores = scored.filter(isFalse).map((pair) => pair.score);
  const threshold = Math.min(1, roundScore(Math.max(0, ...falseScores) + STEP));
  const truePairs = scored.filter((pair) => pair.kind === "same_event");
  const found = truePairs.filter((pair) => pair.score >= threshold).length;
  const recall = truePairs.length === 0 ? 0 : roundScore(found / truePairs.length);
  return { threshold, truePairs: truePairs.length, found, recall };
};

const countKind = (pairs: readonly ScoredPair[], kind: PairKind): number =>
  pairs.filter((pair) => pair.kind === kind).length;

export const operatingPoint = (scored: readonly ScoredPair[], threshold: number) => {
  const proposed = scored.filter((pair) => pair.score >= threshold);
  const truePairs = countKind(scored, "same_event");
  const found = countKind(proposed, "same_event");
  return {
    threshold,
    truePairs,
    found,
    recall: truePairs === 0 ? 0 : roundScore(found / truePairs),
    wrongPairs: proposed.length - found,
    lookAlike: countKind(proposed, "look_alike"),
    twoGroups: countKind(proposed, "two_groups"),
    unlabelled: countKind(proposed, "unlabelled"),
  };
};

const sweep = (scored: readonly ScoredPair[]) =>
  Array.from({ length: SWEEP_STEPS }, (_, i) => roundScore(SWEEP_FROM + i * 0.01)).map((threshold) => {
    const { found, wrongPairs, lookAlike, twoGroups, unlabelled } = operatingPoint(scored, threshold);
    return { threshold, found, wrongPairs, lookAlike, twoGroups, unlabelled };
  });

const pairOut = (pair: ScoredPair) => ({ a: pair.a, b: pair.b, score: pair.score });

const ranked = (scored: readonly ScoredPair[], kind: PairKind) =>
  scored
    .filter((pair) => pair.kind === kind)
    .sort((x, y) => y.score - x.score)
    .slice(0, 5)
    .map(pairOut);

const urgentPairs = (rows: readonly ExamRow[], scored: readonly ScoredPair[], threshold: number) => {
  const high = new Set(rows.filter((row) => row.true_urgency === "high").map((row) => row.id));
  return scored
    .filter((pair) => pair.kind === "same_event" && (high.has(pair.a) || high.has(pair.b)))
    .map((pair) => ({ ...pairOut(pair), linked: pair.score >= threshold }));
};

const STRICT_RULE =
  "A true pair has the same event_group. Every other pair is a false join: a near_miss_partner pair, two event groups, or a message with no event group, which is its own event.";
const LABELLED_RULE = "As the strict rule, but a pair with a message with no event group is not counted.";
export const ownerRule = (threshold: number): string =>
  `The owner set LINK_THRESHOLD to ${String(threshold)} on 2026-11-21. A person answers each proposed link, and a wrong one costs one tap on Not the same.`;

const evidence = (rows: readonly ExamRow[], scored: readonly ScoredPair[], threshold: number) => ({
  lookAlikes: scored.filter((pair) => pair.kind === "look_alike").map(pairOut),
  highestTwoGroups: ranked(scored, "two_groups"),
  highestUnlabelled: ranked(scored, "unlabelled"),
  sameEvent: scored
    .filter((pair) => pair.kind === "same_event")
    .sort((x, y) => y.score - x.score)
    .map(pairOut),
  sameEventWithHigh: urgentPairs(rows, scored, threshold),
});

export const linkReport = (rows: readonly ExamRow[], vectors: readonly (readonly number[])[], meta: Meta) => {
  const scored = scorePairs(rows, vectors);
  const choice = chooseThreshold(scored);
  const falseJoins = scored.filter((pair) => anyOtherEvent(pair) && pair.score >= choice.threshold);
  return {
    check: "link",
    model: meta.model,
    date: meta.date,
    messages: rows.length,
    pairs: scored.length,
    rule: STRICT_RULE,
    ...choice,
    falseJoins: falseJoins.length,
    labelledRule: { rule: LABELLED_RULE, ...chooseThreshold(scored, labelledOnly) },
    operatingPoint: { rule: ownerRule(LINK_THRESHOLD), ...operatingPoint(scored, LINK_THRESHOLD) },
    sweep: sweep(scored),
    ...evidence(rows, scored, LINK_THRESHOLD),
    neurons: meta.neurons,
    usageReported: meta.neurons > 0,
  };
};

export type LinkReport = ReturnType<typeof linkReport>;

export const runLinkCheck = async (
  rows: readonly ExamRow[],
  ai: CheckAi,
  model: string,
  at: Date,
): Promise<LinkReport> => {
  const reply = await ai.json(model, embedInput(rows.map((row) => row.text)));
  const vectors = vectorsOf(reply, rows.length);
  if (vectors === null) throw new CheckStopped(`The model did not give ${String(rows.length)} vectors.`);
  const neurons = roundScore(Math.max(ai.neurons(), metaNeurons(reply)));
  return linkReport(rows, vectors, { model, neurons, date: chicagoDate(at) });
};

const main = async (): Promise<void> => {
  const named = process.env.LINK_MODEL ?? "";
  const model = named === "" ? LINK_CHECK_MODEL : named;
  const at = new Date();
  const report = await runLinkCheck(examRows(), cloudflareAi(MAX_NEURONS), model, at);
  const url = writeCheckResult("link-results", report, at);
  console.log(`threshold ${String(report.threshold)}, false joins ${String(report.falseJoins)}`);
  console.log(
    `recall ${String(report.recall)} (${String(report.found)} of ${String(report.truePairs)} true pairs)`,
  );
  const owner = report.operatingPoint;
  console.log(
    `at ${String(owner.threshold)}: ${String(owner.found)} of ${String(owner.truePairs)} true pairs, ${String(owner.wrongPairs)} wrong pairs`,
  );
  console.log(
    `wrong pairs: ${String(owner.lookAlike)} look-alike, ${String(owner.twoGroups)} two groups, ${String(owner.unlabelled)} no event group`,
  );
  console.log(`neurons ${String(report.neurons)}, saved in ${url.pathname}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (!(error instanceof CheckStopped)) throw error;
    console.error(`link check stopped: ${error.message}`);
    process.exitCode = 2;
  });
}
