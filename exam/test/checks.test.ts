import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { VOICEMAIL_TAG, checkResultUrl, examRows, neuronsOf, writeCheckResult } from "../src/checks.js";
import { jsonText } from "../src/record.js";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("the exam key has 100 rows with 6 Spanish messages and 8 garbled voicemail transcripts", () => {
  const rows = examRows();
  const garbled = rows.filter((row) => row.tags.includes(VOICEMAIL_TAG));
  expect(rows.length).toBe(100);
  expect(rows.filter((row) => row.lang === "es").length).toBe(6);
  expect(garbled.length).toBe(8);
  expect(garbled.every((row) => row.door === "voicemail_transcript")).toBe(true);
  expect(garbled.filter((row) => row.true_urgency === "high").map((row) => row.id)).toEqual([
    "m020",
    "m033",
    "m081",
  ]);
});

it("a check result goes in its own folder under the Chicago date, never in exam/results", () => {
  const url = checkResultUrl("link-results", new Date(Date.UTC(2026, 10, 22, 3, 0)));
  expect(url.pathname.endsWith("/exam/link-results/2026-11-21.json")).toBe(true);
  expect(url.pathname.includes("/exam/results/")).toBe(false);
});

it("writeCheckResult makes the folder and writes the JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "vision-check-"));
  made.push(dir);
  const root = pathToFileURL(`${dir}/`);
  const url = writeCheckResult("voice-results", { ok: true }, new Date(Date.UTC(2026, 10, 21, 18)), root);
  expect(existsSync(url)).toBe(true);
  expect(JSON.parse(readFileSync(url, "utf8"))).toEqual({ ok: true });
});

const EM = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
const FACE = String.fromCodePoint(0x1f629);
const LITERAL = /[\u2013\u2014]|\p{Extended_Pictographic}/u;

it("jsonText stores each dash and emoji as a JSON escape and parses back the same", () => {
  const data = { reason: `fire ${EM} now`, span: `9${EN}5`, [`key ${EM}`]: [`sad ${FACE}`] };
  const text = jsonText(data);
  expect(LITERAL.test(text)).toBe(false);
  expect(text).toContain("fire \\u2014 now");
  expect(text).toContain("9\\u20135");
  expect(text).toContain("sad \\ud83d\\ude29");
  expect(text.endsWith("}\n")).toBe(true);
  expect(JSON.parse(text)).toEqual(data);
});

it("writeCheckResult stores the dashes of the model output as escapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "vision-check-"));
  made.push(dir);
  const data = { text: `a ${EM} b ${FACE}` };
  const url = writeCheckResult(
    "lang-results",
    data,
    new Date(Date.UTC(2026, 10, 21, 18)),
    pathToFileURL(`${dir}/`),
  );
  const text = readFileSync(url, "utf8");
  expect(LITERAL.test(text)).toBe(false);
  expect(JSON.parse(text)).toEqual(data);
});

it("neurons are read from the reply usage, at the top or inside the result", () => {
  expect(neuronsOf({ result: {}, usage: { neurons: 12.5 } })).toBe(12.5);
  expect(neuronsOf({ result: { usage: { neurons: 3 } } })).toBe(3);
  expect(neuronsOf({ result: {} })).toBe(0);
});
