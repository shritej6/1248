import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createSorter, SORTER_PROMPT_SHA256, type ModelRun, type SorterTools } from "@vision/core";
import {
  chicagoDate,
  loadProgress,
  predRows,
  removeProgress,
  saveProgress,
  saveResult,
  type Answer,
  type Progress,
} from "./record.js";
import { examPassed, REQUIRED_RUNS, scoreRun, type KeyRow } from "./score.js";

type Message = { id: string; text: string };
type Transport = { run: ModelRun; failed: () => string | null; reset: () => void };

export class ExamStopped extends Error {
  override readonly name = "ExamStopped";
}

const tools: SorterTools = {
  wait: async (ms) => {
    await sleep(ms);
  },
  log: (fields) => {
    console.log(JSON.stringify(fields));
  },
};
const API = "https://api.cloudflare.com/client/v4/accounts";
const dataFile = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), "utf8"));

const options = (): { model: string; runs: number } => {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((a) => a !== "--"),
    options: { model: { type: "string" }, runs: { type: "string", default: String(REQUIRED_RUNS) } },
  });
  const runs = Number(values.runs);
  if (values.model === undefined || values.model.length === 0)
    throw new ExamStopped("Give a model: --model <id>.");
  if (!Number.isInteger(runs) || runs < REQUIRED_RUNS)
    throw new ExamStopped(`Give --runs ${String(REQUIRED_RUNS)} or more.`);
  return { model: values.model, runs };
};

const workersAi = (account: string, token: string): Transport => {
  let failed: string | null = null;
  const run: ModelRun = async (model, input) => {
    const response = await fetch(`${API}/${account}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }).catch((error: unknown) => {
      failed = "The call to Workers AI failed.";
      throw error;
    });
    if (!response.ok) {
      failed = `Workers AI answered with status ${String(response.status)}.`;
      await response.body?.cancel();
      throw new ExamStopped(failed);
    }
    return ((await response.json()) as { result?: unknown }).result;
  };
  return { run, failed: () => failed, reset: () => (failed = null) };
};

const transportFromEnv = (): Transport => {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  if (account === "" || token === "")
    throw new ExamStopped("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the shell first.");
  return workersAi(account, token);
};

const answerOne = async (transport: Transport, model: string, message: Message): Promise<Answer> => {
  transport.reset();
  const answer = await createSorter(transport.run, model, tools)({ id: message.id, text: message.text });
  const failed = transport.failed();
  if ("error" in answer && failed !== null)
    throw new ExamStopped(
      `${failed} Status 429 means the free daily allowance is used up. Run the same command again later to resume.`,
    );
  return { id: message.id, ...answer };
};

const runAll = async (progress: Progress, runs: number, transport: Transport): Promise<void> => {
  const messages = dataFile("messages.json") as Message[];
  for (let r = 0; r < runs; r += 1) {
    const answers = progress.runs[r] ?? [];
    progress.runs[r] = answers;
    const done = new Set(answers.map((a) => a.id));
    for (const message of messages.filter((m) => !done.has(m.id))) {
      answers.push(await answerOne(transport, progress.model, message));
      saveProgress(progress);
      console.log(`run ${String(r + 1)}: ${String(answers.length)}/${String(messages.length)}`);
    }
  }
};

const finish = (progress: Progress): void => {
  const key = dataFile("key.json") as KeyRow[];
  const scores = progress.runs.map((answers) => scoreRun(key, predRows(answers)));
  const row = {
    model: progress.model,
    promptSha256: progress.promptSha256,
    date: chicagoDate(new Date()),
    runs: scores,
    passed: examPassed(scores),
  };
  const path = saveResult(row, progress.runs);
  removeProgress(progress.model);
  for (const [i, s] of scores.entries())
    console.log(`run ${String(i + 1)}: ${String(s.caught)} of ${String(s.emergencies)} emergencies found`);
  console.log(`${row.passed ? "passed" : "not passed"}, saved in ${path} and exam/results/record.json`);
};

const main = async (): Promise<void> => {
  const { model, runs } = options();
  const progress = loadProgress(model, SORTER_PROMPT_SHA256);
  await runAll(progress, runs, transportFromEnv());
  finish(progress);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (!(error instanceof ExamStopped)) throw error;
    console.error(`exam stopped: ${error.message}`);
    process.exitCode = 2;
  });
}
