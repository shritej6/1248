import { setTimeout as sleep } from "node:timers/promises";
import type { DraftFacts, DraftFlag, DraftKind, DraftSource, GuardReason } from "@vision/contracts";
import { DRAFT_PROMPT_SHA256, createDrafter, type DrafterTools, type ModelRun } from "@vision/core";
import { CheckStopped, cloudflareAi, writeCheckResult, type CheckAi } from "./checks.js";
import { DRAFT_CHECK_FACTS } from "./draft-facts.js";
import { chicagoDate } from "./record.js";

export const DRAFT_MAX_NEURONS = 500;
export const DRAFT_DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const DRAFT_MIN_AI_SHARE = 0.5;

export type DraftCheckRow = {
  id: string;
  kind: DraftKind;
  source: DraftSource;
  flag: DraftFlag | null;
  reasons: GuardReason[];
  calls: number;
  text: string;
};
export type DraftCheck = {
  date: string;
  model: string;
  promptSha256: string;
  rows: DraftCheckRow[];
  aiShare: number;
  calls: number;
  neurons: number;
  passed: boolean;
};

type Counter = { run: ModelRun; calls: () => number; stopped: () => CheckStopped | null };

const LIVE_TOOLS: DrafterTools = {
  wait: async (ms) => {
    await sleep(ms);
  },
  log: (fields) => {
    console.log(JSON.stringify(fields));
  },
};

const countingRun = (ai: CheckAi): Counter => {
  let calls = 0;
  let stopped: CheckStopped | null = null;
  const run: ModelRun = async (model, input) => {
    calls += 1;
    try {
      return await ai.json(model, input);
    } catch (error) {
      if (error instanceof CheckStopped) stopped = error;
      throw error;
    }
  };
  return { run, calls: () => calls, stopped: () => stopped };
};

const draftRow = async (
  ai: CheckAi,
  model: string,
  tools: DrafterTools,
  set: { id: string; facts: DraftFacts },
): Promise<DraftCheckRow> => {
  const counter = countingRun(ai);
  const outcome = await createDrafter(counter.run, model, tools)(set.facts);
  const stop = counter.stopped();
  if (stop !== null) throw stop;
  const { text, source, flag, reasons } = outcome;
  return { id: set.id, kind: set.facts.kind, source, flag, reasons, calls: counter.calls(), text };
};

export const runDraftCheck = async (
  ai: CheckAi,
  model: string,
  at: Date,
  tools: DrafterTools = LIVE_TOOLS,
): Promise<DraftCheck> => {
  const rows: DraftCheckRow[] = [];
  for (const set of DRAFT_CHECK_FACTS) rows.push(await draftRow(ai, model, tools, set));
  const aiShare = rows.filter((row) => row.source === "ai").length / rows.length;
  const neurons = ai.neurons();
  return {
    date: chicagoDate(at),
    model,
    promptSha256: DRAFT_PROMPT_SHA256,
    rows,
    aiShare,
    calls: rows.reduce((sum, row) => sum + row.calls, 0),
    neurons,
    passed: neurons <= DRAFT_MAX_NEURONS && aiShare >= DRAFT_MIN_AI_SHARE,
  };
};

export const saveDraftCheck = (result: DraftCheck, at: Date, root?: URL): URL =>
  writeCheckResult("draft-results", result, at, root);

const rowLine = (row: DraftCheckRow): string => {
  const reasons = row.reasons.length === 0 ? "" : `, guard: ${row.reasons.join(" ")}`;
  return `${row.id}: ${row.source}, flag ${row.flag ?? "none"}, ${String(row.calls)} calls${reasons}`;
};

const main = async (): Promise<void> => {
  const fromEnv = process.env.DRAFT_MODEL ?? "";
  const model = fromEnv === "" ? DRAFT_DEFAULT_MODEL : fromEnv;
  const at = new Date();
  const result = await runDraftCheck(cloudflareAi(DRAFT_MAX_NEURONS), model, at);
  const url = saveDraftCheck(result, at);
  for (const row of result.rows) console.log(rowLine(row));
  console.log(`drafts: ${String(result.rows.length)}, AI share ${String(result.aiShare)}`);
  console.log(`model calls: ${String(result.calls)}, neurons used: ${String(result.neurons)}`);
  console.log(`${result.passed ? "passed" : "not passed"}, saved in ${url.pathname}`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (!(error instanceof CheckStopped)) throw error;
    console.error(`draft check stopped: ${error.message}`);
    process.exitCode = 2;
  });
}
