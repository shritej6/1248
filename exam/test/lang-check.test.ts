import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { CheckAi } from "../src/checks.js";
import { examRows } from "../src/checks.js";
import { LANG_MAX_NEURONS, SPANISH_IDS, detectRows, runLangCheck, saveLangCheck } from "../src/lang-check.js";
import { KEY_FACTS, checkFidelity } from "../src/lang-facts.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Call = { model: string; input: unknown };

const fakeAi = (reply: (call: Call) => unknown): CheckAi & { calls: Call[] } => {
  const calls: Call[] = [];
  let used = 0;
  return {
    calls,
    json: (model, input) => {
      calls.push({ model, input });
      used += 2;
      return Promise.resolve(reply({ model, input }));
    },
    bytes: () => Promise.reject(new Error("no audio in the lang check")),
    neurons: () => used,
  };
};

it("the detector finds the 6 Spanish exam messages and marks no English message Spanish", () => {
  const result = detectRows(examRows());
  expect(result.found).toEqual([...SPANISH_IDS]);
  expect(result.missed).toEqual([]);
  expect(result.falseSpanish).toEqual([]);
  expect(result.checked).toBe(100);
});

it("a row the key calls Spanish that the detector misses is reported", () => {
  const rows = examRows().map((row) =>
    row.id === "m062" ? { ...row, text: "I need English classes" } : row,
  );
  expect(detectRows(rows).missed).toEqual(["m062"]);
});

const FAITHFUL =
  "EN We have no heat and a baby, with the oven on. No car, food for 5 people, papers, a place to stay. " +
  "English classes. Snow, I am 76 and live alone. 414-555-0136 414-555-0190 414-555-0188 414-555-0171";

it("the check translates each Spanish message once from Spanish to English and counts neurons", async () => {
  const ai = fakeAi(() => ({ translated_text: FAITHFUL }));
  const result = await runLangCheck(
    ai,
    "@cf/meta/m2m100-1.2b",
    examRows(),
    new Date(Date.UTC(2026, 10, 21, 18)),
  );
  expect(ai.calls).toHaveLength(6);
  expect(ai.calls.every((call) => call.model === "@cf/meta/m2m100-1.2b")).toBe(true);
  expect(ai.calls[0]?.input).toMatchObject({ source_lang: "es", target_lang: "en" });
  expect(result.translations.map((t) => t.id)).toEqual([...SPANISH_IDS]);
  expect(result.translations.every((t) => t.translation === FAITHFUL)).toBe(true);
  expect(result).toMatchObject({ date: "2026-11-21", found: 6, expected: 6, falseSpanish: 0, neurons: 12 });
  expect(result.fidelity.every((f) => f.lost.length === 0)).toBe(true);
  expect(result.safetyLost).toBe(0);
  expect(result.passed).toBe(true);
  expect(LANG_MAX_NEURONS).toBeLessThanOrEqual(300);
});

it("a reply with no translated text is kept as an empty translation and fails the check", async () => {
  const ai = fakeAi(() => ({ wrong: true }));
  const result = await runLangCheck(ai, "@cf/test/model", examRows(), new Date(Date.UTC(2026, 10, 21, 18)));
  expect(result.translations.every((t) => t.translation === "")).toBe(true);
  expect(result.passed).toBe(false);
});

it("the result goes in exam/lang-results under the Chicago date", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vision-lang-"));
  made.push(dir);
  const ai = fakeAi(() => ({ translated_text: "text" }));
  const at = new Date(Date.UTC(2026, 10, 22, 3, 0));
  const result = await runLangCheck(ai, "@cf/test/model", examRows(), at);
  const url = saveLangCheck(result, at, pathToFileURL(`${dir}/`));
  expect(url.pathname.endsWith("/lang-results/2026-11-21.json")).toBe(true);
  expect(JSON.parse(readFileSync(url, "utf8"))).toEqual(JSON.parse(JSON.stringify(result)));
});

it("each Spanish exam message has key facts, and each fact is kept or lost by its own result", () => {
  expect(Object.keys(KEY_FACTS)).toEqual([...SPANISH_IDS]);
  expect(checkFidelity("m079", "Yes, please. A food box for 5 people. I don't have a car.")).toEqual({
    id: "m079",
    kept: ["food", "no car", "5 people"],
    lost: [],
    safetyLost: [],
  });
  expect(checkFidelity("m079", "Yes, please. A box.").lost).toEqual(["food", "no car", "5 people"]);
});

it("a translation that loses the open oven of m060 fails the check", async () => {
  const lostOven =
    "Since Thursday night, the apartment heating is not served. I have a three-month-old baby and we are " +
    "sleeping in the kitchen with the oven attached. 414-555-0190.";
  expect(checkFidelity("m060", lostOven)).toMatchObject({
    lost: ["oven on for heat"],
    safetyLost: ["oven on for heat"],
  });
  const ai = fakeAi((call) => ({
    translated_text: (call.input as { text: string }).text.includes("horno") ? lostOven : FAITHFUL,
  }));
  const result = await runLangCheck(ai, "@cf/test/model", examRows(), new Date(Date.UTC(2026, 10, 21, 18)));
  expect(result.safetyLost).toBe(1);
  expect(result.fidelity.find((f) => f.id === "m060")?.safetyLost).toEqual(["oven on for heat"]);
  expect(result.passed).toBe(false);
});
