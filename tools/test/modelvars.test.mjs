import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const hub = JSON.parse(read("apps/hub/wrangler.json"));
const vars = hub.vars;
const models = Object.keys(vars).filter((name) => name.endsWith("_MODEL"));

test("the hub has the sorter var and one var for each AI job", () => {
  assert.deepEqual(models.sort(), [
    "DRAFT_MODEL",
    "LINK_MODEL",
    "SORTER_MODEL",
    "TRANSLATE_MODEL",
    "VOICE_MODEL",
  ]);
});

test("the sorter and the three AI jobs are on in the hub config (C64, owner decision)", () => {
  assert.equal(vars.SORTER_MODEL, "@cf/google/gemma-4-26b-a4b-it");
  assert.equal(vars.VOICE_MODEL, "@cf/openai/whisper-large-v3-turbo");
  assert.equal(vars.LINK_MODEL, "@cf/baai/bge-m3");
  assert.equal(vars.TRANSLATE_MODEL, "@cf/meta/m2m100-1.2b");
});

test("the draft job of Resources is on in the hub config (O20, owner decision)", () => {
  assert.equal(vars.DRAFT_MODEL, "@cf/google/gemma-4-26b-a4b-it");
});

test("the AI binding runs remotely, so wrangler dev without --local reaches Workers AI", () => {
  assert.deepEqual(hub.ai, { binding: "AI", remote: true });
});

test("the end-to-end hub gets every model var empty, so it never calls AI", () => {
  const config = read("apps/web/playwright.config.ts");
  const list = /MODEL_VARS = \[([^\]]*)\]/u.exec(config)?.[1] ?? "";
  const passed = [...list.matchAll(/"([A-Z_]+)"/gu)].map((m) => m[1]).sort();
  assert.deepEqual(passed, [...models].sort());
  assert.match(config, /`--var \$\{name\}:`/u);
});

test("the hub tests get every model var empty and fake the AI binding", () => {
  const config = read("apps/hub/vitest.config.ts");
  for (const name of models) assert.match(config, new RegExp(`${name}: ""`, "u"));
});

const recipe = (target) => {
  const lines = read("Makefile").split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${target}:`));
  const body = lines.slice(start + 1);
  const end = body.findIndex((line) => !line.startsWith("\t"));
  return body.slice(0, end === -1 ? body.length : end).join("\n");
};

test("make dev runs the hub with live AI and make dev-offline keeps it local", () => {
  assert.match(recipe("dev"), /wrangler dev \$\(DEV_FLAGS\)/u);
  assert.doesNotMatch(recipe("dev"), /--local/u);
  assert.match(recipe("dev-offline"), /wrangler dev --local \$\(DEV_FLAGS\)/u);
});

test("the end-to-end hub stays local, so make e2e and CI never call AI", () => {
  assert.match(read("apps/web/playwright.config.ts"), /"wrangler dev --local"/u);
});

test("the hub package dev script runs with live AI and dev-offline keeps it local", () => {
  const scripts = JSON.parse(read("apps/hub/package.json")).scripts;
  assert.equal(scripts.dev, "wrangler dev --ip 127.0.0.1 --port 8787");
  assert.equal(scripts["dev-offline"], "wrangler dev --local --ip 127.0.0.1 --port 8787");
});

test("the laptop hub listens on the laptop only, so nobody else on the network reaches the board or the AI", () => {
  const flags = read("Makefile")
    .split("\n")
    .find((line) => line.startsWith("DEV_FLAGS :="));
  assert.equal(flags, "DEV_FLAGS := --ip 127.0.0.1 --port 8787");
  for (const path of ["Makefile", "apps/hub/package.json", "tools/media/hub.mjs"])
    assert.doesNotMatch(read(path), /0\.0\.0\.0/u, path);
});
