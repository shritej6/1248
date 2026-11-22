import { existsSync, readFileSync } from "node:fs";

const WRANGLER = "apps/hub/wrangler.json";
const PROMPT = "packages/core/src/prompt.ts";
const RECORD = "exam/results/record.json";

export function examRecordProblem({ model, promptSha, rows }) {
  if (model === "") return null;
  if (promptSha === null) return `${PROMPT} has no SORTER_PROMPT_SHA256`;
  const ok = rows.some((r) => r.model === model && r.promptSha256 === promptSha && r.passed === true);
  return ok ? null : `${RECORD} has no passing row for model ${model} and prompt ${promptSha}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function promptSha() {
  if (!existsSync(PROMPT)) return null;
  const match = /SORTER_PROMPT_SHA256\s*=\s*["']([0-9a-f]{64})["']/u.exec(readFileSync(PROMPT, "utf8"));
  return match === null ? null : (match[1] ?? null);
}

function recordRows() {
  if (!existsSync(RECORD)) return [];
  const data = readJson(RECORD);
  return Array.isArray(data) ? data : (data.rows ?? []);
}

function main() {
  if (!existsSync(WRANGLER)) {
    console.log("exam: no hub yet, skipped");
    return;
  }
  const model = readJson(WRANGLER).vars?.SORTER_MODEL ?? "";
  const problem = examRecordProblem({ model, promptSha: promptSha(), rows: recordRows() });
  if (problem !== null) {
    console.error(`exam: ${problem}`);
    process.exit(1);
  }
  console.log(
    model === "" ? "exam: sorter is off, no record needed" : `exam: passing record found for ${model}`,
  );
}

if (import.meta.main) main();
