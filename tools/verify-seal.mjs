import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const GENESIS = "0".repeat(64);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

const lineHash = (line, prev) => {
  const content = canonicalJson({
    seq: line.seq,
    at: line.at,
    card: line.card,
    job: line.job,
    type: line.type,
    actor: line.actor,
    data: line.data,
  });
  return createHash("sha256").update(`${prev}\n${content}`, "utf8").digest("hex");
};

export function checkSeal(events) {
  let seq = 0;
  let hash = GENESIS;
  for (const line of events) {
    const good =
      isRecord(line) && line.seq === seq + 1 && line.prev === hash && line.hash === lineHash(line, hash);
    if (!good)
      return { ok: false, badSeq: isRecord(line) && Number.isInteger(line.seq) ? line.seq : seq + 1 };
    seq = line.seq;
    hash = line.hash;
  }
  return { ok: true, seq, hash };
}

export function readExport(path) {
  const body = JSON.parse(readFileSync(path, "utf8"));
  const events = Array.isArray(body) ? body : isRecord(body) ? body.events : undefined;
  if (!Array.isArray(events)) throw new TypeError("the file has no events list");
  return events;
}

function main(argv) {
  const path = argv[2];
  if (path === undefined) {
    process.stderr.write("Usage: node tools/verify-seal.mjs <export.json>\n");
    return 2;
  }
  let events;
  try {
    events = readExport(path);
  } catch (error) {
    process.stderr.write(`${path} is not a Vision export: ${error.message}\n`);
    return 2;
  }
  const result = checkSeal(events);
  if (!result.ok) {
    process.stdout.write(`Seal broken at line ${result.badSeq}\n`);
    return 1;
  }
  process.stdout.write(`Seal OK: line ${result.seq}, ${result.hash}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv);
