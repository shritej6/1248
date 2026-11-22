import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { modelSlug, predRows } from "../src/record.js";
import { examPassed, scoreRun, type KeyRow, type PredRow } from "../src/score.js";

const key = JSON.parse(readFileSync(new URL("../data/key.json", import.meta.url), "utf8")) as KeyRow[];

const pass = (row: KeyRow, urgency: string, words = ""): PredRow => ({
  id: row.id,
  service: row.true_service,
  division: row.true_division,
  urgency,
  words,
});

const allHighCorrect: PredRow[] = key.flatMap((row) => [
  pass(row, row.true_urgency),
  pass(row, row.true_urgency),
]);
const onePassHigh: PredRow[] = key.flatMap((row) => [pass(row, "low"), pass(row, row.true_urgency)]);

it("a run that catches every emergency on both passes passes", () => {
  expect(scoreRun(key, allHighCorrect)).toMatchObject({ caught: 24, emergencies: 24 });
  expect(examPassed([scoreRun(key, allHighCorrect), scoreRun(key, allHighCorrect)])).toBe(true);
});

it("a message is high when either pass says high", () => {
  expect(scoreRun(key, onePassHigh).caught).toBe(24);
});

it("a missing answer is a missed emergency and the exam fails", () => {
  const firstHigh = key.find((row) => row.true_urgency === "high");
  const missing = allHighCorrect.filter((p) => p.id !== firstHigh?.id);
  const score = scoreRun(key, missing);
  expect(score.caught).toBe(23);
  expect(examPassed([score, scoreRun(key, allHighCorrect)])).toBe(false);
});

it("a high answer on a low message is a false alarm", () => {
  const allHigh = key.map((row) => pass(row, "high"));
  expect(scoreRun(key, allHigh)).toMatchObject({ caught: 24, falseAlarms: 76 });
});

it("the second answer in the key counts and the first pass is scored", () => {
  const withAlt = key.filter((row) => row.alt_service !== null);
  const altRows = withAlt.map((row) => ({ ...pass(row, "low"), service: row.alt_service ?? "" }));
  expect(scoreRun(withAlt, altRows).needRight).toBe(withAlt.length);
  const wrongFirst = key.flatMap((row) => [{ ...pass(row, "low"), service: "Nothing" }, pass(row, "low")]);
  expect(scoreRun(key, wrongFirst).needRight).toBe(0);
});

it("the list number and case do not matter for a label", () => {
  const row = key[0];
  if (row === undefined) throw new Error("The key is empty.");
  const numbered = { ...pass(row, "low"), division: `1. ${row.true_division.toUpperCase()}` };
  expect(scoreRun([row], [numbered]).divisionRight).toBe(1);
});

it("a quote counts only when its words are in the message", () => {
  const row = key[0];
  if (row === undefined) throw new Error("The key is empty.");
  const exact = pass(row, "low", row.text.slice(0, 30).toUpperCase());
  expect(scoreRun([row], [exact]).quotesExact).toBe(1);
  expect(scoreRun([row], [pass(row, "low", "words that are not there")]).quotesExact).toBe(0);
});

it("an exam needs two runs to pass", () => {
  expect(examPassed([])).toBe(false);
  expect(examPassed([scoreRun(key, allHighCorrect)])).toBe(false);
});

it("an answer that is ai_down gives no pass, so its emergency counts as missed", () => {
  const sortPass = {
    service: "Other",
    division: "No clear home",
    urgency: "high" as const,
    words: "",
    reason: "r",
  };
  const rows = predRows([
    { id: "m1", passes: [sortPass, { ...sortPass, urgency: "low" }] },
    { id: "m2", error: "ai_down" },
  ]);
  expect(rows.map((r) => [r.id, r.urgency])).toEqual([
    ["m1", "high"],
    ["m1", "low"],
  ]);
});

it("a model id becomes a safe file name", () => {
  expect(modelSlug("@cf/meta/llama-3.2-1b-instruct")).toBe("cf-meta-llama-3-2-1b-instruct");
});
