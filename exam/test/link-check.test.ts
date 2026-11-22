import { readdirSync, readFileSync } from "node:fs";
import { LINK_THRESHOLD } from "@vision/core";
import { expect, it } from "vitest";
import type { CheckAi, ExamRow } from "../src/checks.js";
import {
  chooseThreshold,
  linkReport,
  operatingPoint,
  ownerRule,
  pairKind,
  runLinkCheck,
  scorePairs,
} from "../src/link-check.js";

const row = (id: string, over: Partial<ExamRow> = {}): ExamRow => ({
  id,
  door: "email",
  lang: "en",
  text: `text of ${id}`,
  true_urgency: "low",
  event_group: null,
  run_group: null,
  near_miss_partner: null,
  tags: [],
  ...over,
});

const ROWS = [
  row("m1", { event_group: "E1" }),
  row("m2", { event_group: "E1", true_urgency: "high" }),
  row("m3", { event_group: "E1" }),
  row("m4", { event_group: "E2" }),
  row("m5", { near_miss_partner: "m6" }),
  row("m6", { near_miss_partner: "m5" }),
  row("m7"),
];
const VECTORS = [
  [1, 0, 0],
  [0.99, 0.1, 0],
  [0.8, 0.6, 0],
  [0.95, 0.31, 0],
  [0, 1, 0],
  [0, 0.97, 0.24],
  [0, 0.9, 0.44],
];

it("a pair is the same event, a look-alike, two event groups or unlabelled", () => {
  const [m1, m2, , m4, m5, m6, m7] = ROWS;
  if (!m1 || !m2 || !m4 || !m5 || !m6 || !m7) throw new Error("rows missing");
  expect(pairKind(m1, m2)).toBe("same_event");
  expect(pairKind(m5, m6)).toBe("look_alike");
  expect(pairKind(m1, m4)).toBe("two_groups");
  expect(pairKind(m1, m7)).toBe("unlabelled");
  expect(pairKind(m6, m7)).toBe("unlabelled");
});

it("every pair is scored once with the score the hub uses", () => {
  const scored = scorePairs(ROWS, VECTORS);
  expect(scored.length).toBe(21);
  expect(scored.find((p) => p.a === "m1" && p.b === "m2")?.score).toBe(0.995);
});

it("the threshold is the lowest one with zero false joins, and recall counts the true pairs it keeps", () => {
  const scored = scorePairs(ROWS, VECTORS);
  const choice = chooseThreshold(scored);
  const falseAbove = scored.filter((p) => p.kind !== "same_event" && p.score >= choice.threshold);
  expect(falseAbove).toEqual([]);
  const lower = Math.round((choice.threshold - 0.001) * 1000) / 1000;
  expect(scored.some((p) => p.kind !== "same_event" && p.score >= lower)).toBe(true);
  expect(choice).toEqual({ threshold: 0.979, truePairs: 3, found: 1, recall: 0.333 });
});

it("the report gives the threshold, the recall and the look-alike scores, and no message text", () => {
  const report = linkReport(ROWS, VECTORS, { model: "@cf/test/embed", neurons: 4.5, date: "2026-11-21" });
  expect(report).toMatchObject({
    check: "link",
    model: "@cf/test/embed",
    date: "2026-11-21",
    messages: 7,
    threshold: 0.979,
    falseJoins: 0,
    recall: 0.333,
    neurons: 4.5,
  });
  expect(report.lookAlikes).toEqual([{ a: "m5", b: "m6", score: 0.971 }]);
  expect(report.labelledRule).toMatchObject({ threshold: 0.978, found: 1, recall: 0.333 });
  expect(report.sameEvent.map((p) => p.score)).toEqual([0.995, 0.856, 0.8]);
  expect(report.sameEventWithHigh.map((p) => p.linked)).toEqual([true, true]);
  expect(JSON.stringify(report)).not.toContain("text of");
});

it("the operating point counts the true pairs found and splits the wrong pairs by kind", () => {
  const scored = scorePairs(ROWS, VECTORS);
  expect(operatingPoint(scored, 0.9)).toEqual({
    threshold: 0.9,
    truePairs: 3,
    found: 1,
    recall: 0.333,
    wrongPairs: 5,
    lookAlike: 1,
    twoGroups: 3,
    unlabelled: 1,
  });
  expect(operatingPoint(scored, 0.75)).toMatchObject({ found: 3, wrongPairs: 6, unlabelled: 2 });
});

it("the report gives the owner's operating point at LINK_THRESHOLD and a sweep from 0.7 to 0.9", () => {
  const report = linkReport(ROWS, VECTORS, { model: "@cf/test/embed", neurons: 4.5, date: "2026-11-21" });
  const owner = operatingPoint(scorePairs(ROWS, VECTORS), LINK_THRESHOLD);
  expect(report.operatingPoint).toMatchObject(owner);
  expect(report.operatingPoint.rule).toBe(ownerRule(LINK_THRESHOLD));
  expect(report.operatingPoint.rule).toContain("Not the same");
  expect(report.sweep.map((row) => row.threshold)).toEqual(
    Array.from({ length: 21 }, (_, i) => Math.round((0.7 + i * 0.01) * 1000) / 1000),
  );
  const atOwner = report.sweep.find((row) => row.threshold === LINK_THRESHOLD);
  const { found, wrongPairs, lookAlike, twoGroups, unlabelled } = owner;
  expect(atOwner).toEqual({ threshold: LINK_THRESHOLD, found, wrongPairs, lookAlike, twoGroups, unlabelled });
  expect(report.sweep.every((row, i) => row.found <= (report.sweep[i - 1]?.found ?? Infinity))).toBe(true);
});

it("the check embeds every message in one batch and stops on a reply of the wrong size", async () => {
  const calls: unknown[] = [];
  const ai: CheckAi = {
    json: (_model, input) => {
      calls.push(input);
      return Promise.resolve({ shape: [7, 3], data: VECTORS });
    },
    bytes: () => Promise.reject(new Error("not used")),
    neurons: () => 4.5,
  };
  const report = await runLinkCheck(ROWS, ai, "@cf/test/embed", new Date(Date.UTC(2026, 10, 21, 18)));
  expect(calls).toEqual([{ text: ROWS.map((r) => r.text), truncate_inputs: true }]);
  expect(report.threshold).toBe(0.979);
  const short: CheckAi = { ...ai, json: () => Promise.resolve({ data: [[1]] }) };
  await expect(runLinkCheck(ROWS, short, "@cf/test/embed", new Date())).rejects.toThrow(/vectors/);
});

it("the check records the neurons that the embedding reply gives in its meta", async () => {
  const ai: CheckAi = {
    json: () => Promise.resolve({ shape: [7, 3], data: VECTORS, meta: { neurons: 0.31849 } }),
    bytes: () => Promise.reject(new Error("not used")),
    neurons: () => 0,
  };
  const report = await runLinkCheck(ROWS, ai, "@cf/test/embed", new Date());
  expect([report.neurons, report.usageReported]).toEqual([0.318, true]);
});

it("LINK_THRESHOLD in the code is the operating point of the newest saved link check", () => {
  const folder = new URL("../link-results/", import.meta.url);
  const newest = readdirSync(folder)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .at(-1);
  if (newest === undefined) throw new Error("no saved link check");
  const saved = JSON.parse(readFileSync(new URL(newest, folder), "utf8")) as {
    falseJoins: number;
    operatingPoint?: { threshold: number };
  };
  expect(saved.falseJoins).toBe(0);
  expect(LINK_THRESHOLD).toBe(0.75);
  expect(saved.operatingPoint?.threshold).toBe(LINK_THRESHOLD);
});

it("the owner rule names the threshold it was given", () => {
  expect(ownerRule(0.6)).toContain("LINK_THRESHOLD to 0.6 on");
  expect(ownerRule(LINK_THRESHOLD)).toContain(`LINK_THRESHOLD to ${String(LINK_THRESHOLD)} on`);
});
