import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { SortPass } from "@vision/contracts";
import type { PredRow, Score } from "./score.js";

export type Answer = { id: string; passes: SortPass[] } | { id: string; error: "ai_down" };
export type Progress = { model: string; promptSha256: string; runs: Answer[][] };
export type RecordRow = { model: string; promptSha256: string; date: string; runs: Score[]; passed: boolean };

const RESULTS = new URL("../results/", import.meta.url);
const RECORD = new URL("record.json", RESULTS);

const ESCAPED = /[\u2013\u2014]|\p{Extended_Pictographic}/gu;

const escapeUnits = (text: string): string =>
  Array.from(
    { length: text.length },
    (_, i) => `\\u${text.charCodeAt(i).toString(16).padStart(4, "0")}`,
  ).join("");

export const jsonText = (data: unknown): string =>
  `${JSON.stringify(data, null, 2).replace(ESCAPED, escapeUnits)}\n`;

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, "utf8"));
const writeJson = (url: URL, data: unknown): void => {
  writeFileSync(url, jsonText(data));
};

export const modelSlug = (model: string): string =>
  model
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

export const chicagoDate = (at: Date): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(at);

const partialUrl = (model: string): URL => new URL(`${modelSlug(model)}.partial.json`, RESULTS);

export const loadProgress = (model: string, promptSha256: string): Progress => {
  const url = partialUrl(model);
  if (!existsSync(url)) return { model, promptSha256, runs: [] };
  const saved = readJson(url) as Progress;
  return saved.promptSha256 === promptSha256 ? saved : { model, promptSha256, runs: [] };
};

export const saveProgress = (progress: Progress): void => {
  writeJson(partialUrl(progress.model), progress);
};

export const removeProgress = (model: string): void => {
  rmSync(partialUrl(model), { force: true });
};

export const predRows = (answers: readonly Answer[]): PredRow[] =>
  answers.flatMap((a) => ("passes" in a ? a.passes.map((p) => ({ id: a.id, ...p })) : []));

export const readRecord = (): RecordRow[] => (existsSync(RECORD) ? (readJson(RECORD) as RecordRow[]) : []);

export const saveResult = (row: RecordRow, answers: readonly Answer[][]): string => {
  const name = `${row.date}-${modelSlug(row.model)}.json`;
  writeJson(new URL(name, RESULTS), { ...row, answers });
  writeJson(RECORD, [...readRecord(), row]);
  return `exam/results/${name}`;
};
