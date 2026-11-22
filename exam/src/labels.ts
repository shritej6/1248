import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Urgency = "high" | "low";
type KeyRow = { id: string; door: string; true_service: string; true_urgency: Urgency };
type SavedRow = { id: string; service: string; division: string; urgency: Urgency };
type RehearsalLabel = {
  id: string;
  door: string;
  ai: { service: string; division: string; urgency: Urgency };
  key: { service: string; urgency: Urgency };
};

const SOURCE = "Sorter test of 2026-11-21, small model, run 1";

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const readJson = (path: string): unknown => JSON.parse(readFileSync(at(path), "utf8"));

export const toLabels = (key: readonly KeyRow[], saved: readonly SavedRow[]): RehearsalLabel[] =>
  key.map((row) => {
    const answer = saved.find((s) => s.id === row.id);
    if (answer === undefined) throw new Error(`No saved answer for message ${row.id}`);
    return {
      id: row.id,
      door: row.door,
      ai: { service: answer.service, division: answer.division, urgency: answer.urgency },
      key: { service: row.true_service, urgency: row.true_urgency },
    };
  });

const key = readJson("../data/key.json") as KeyRow[];
const saved = readJson("../data/saved-small1.json") as SavedRow[];
const out = { source: SOURCE, labels: toLabels(key, saved) };
writeFileSync(at("../../data/synthetic/rehearsal-labels.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`rehearsal labels: ${String(out.labels.length)} written`);
