import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, checkSeal } from "../verify-seal.mjs";

const TOOL = fileURLToPath(new URL("../verify-seal.mjs", import.meta.url));
const GENESIS = "0".repeat(64);
const FIRST = "6c82816773556b22e0549df95344d0c9cf5155ede9a857eb1fa75f4c8a806411";
const SECOND = "b0eca2feed6a436e31eb8ae656cc101971f4c0c3a4da6ee97e2279ea649b65d5";

const lines = () => [
  {
    card: "c_1",
    job: null,
    actor: { role: "system", ref: null },
    type: "card.received",
    data: { door: "form", zip: "53216", safeContact: true },
    seq: 1,
    at: 1800000000000,
    prev: GENESIS,
    hash: FIRST,
  },
  {
    card: "c_1",
    job: "j_1",
    actor: { role: "desk", ref: "m_1" },
    type: "job.closed",
    data: { result: "withdrawn", reason: "duplicate" },
    seq: 2,
    at: 1800000060000,
    prev: FIRST,
    hash: SECOND,
  },
];

const exportFile = (body) => {
  const path = join(mkdtempSync(join(tmpdir(), "seal-")), "export.json");
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  return path;
};

const runTool = (path) => spawnSync(process.execPath, [TOOL, path], { encoding: "utf8" });

test("canonical json sorts keys and drops undefined fields", () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null], c: undefined }), '{"a":[true,null],"b":1}');
});

test("lines sealed by the hub pass with the same fingerprints", () => {
  assert.deepEqual(checkSeal(lines()), { ok: true, seq: 2, hash: SECOND });
});

test("an empty ledger passes at line 0", () => {
  assert.deepEqual(checkSeal([]), { ok: true, seq: 0, hash: GENESIS });
});

test("a changed line breaks the seal at that line", () => {
  const changed = lines();
  changed[0].data.zip = "53206";
  assert.deepEqual(checkSeal(changed), { ok: false, badSeq: 1 });
});

test("a removed line breaks the seal at the next line", () => {
  assert.deepEqual(checkSeal(lines().slice(1)), { ok: false, badSeq: 2 });
});

test("the tool prints Seal OK for a good export", () => {
  const out = execFileSync(process.execPath, [TOOL, exportFile({ events: lines(), sealed: {} })], {
    encoding: "utf8",
  });
  assert.equal(out.trim(), `Seal OK: line 2, ${SECOND}`);
});

test("the tool prints the broken line and exits 1", () => {
  const changed = lines();
  changed[1].data.result = "helped";
  const result = runTool(exportFile({ events: changed }));
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "Seal broken at line 2");
});

test("the tool refuses a file that is not an export and exits 2", () => {
  const result = runTool(exportFile("not json"));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not a Vision export/u);
});
