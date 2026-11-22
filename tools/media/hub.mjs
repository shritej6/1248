import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { envValue, hubEnv, parseCodes } from "./lib.mjs";

export const PORT = Number(process.env.MEDIA_PORT ?? 8787);
export const BASE = `http://localhost:${PORT}`;
export const ORG = "comforce-demo";

export function portTaken(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

export function buildWeb(root, log) {
  const out = openSync(log, "a");
  execFileSync("pnpm", ["--filter", "./apps/web", "run", "build"], {
    cwd: root,
    stdio: ["ignore", out, out],
  });
}

function writeEnv(root, runDir) {
  const own = join(root, "apps/hub/.dev.vars");
  const source = existsSync(own) ? own : join(root, "apps/hub/.dev.vars.example");
  const text = hubEnv(readFileSync(source, "utf8"), () => randomBytes(24).toString("hex"));
  const file = join(runDir, "hub.env");
  writeFileSync(file, text, { mode: 0o600 });
  return { file, bootstrap: envValue(text, "BOOTSTRAP_CODE") };
}

async function waitReady(log, child) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const text = readFileSync(log, "utf8");
    if (text.includes("Ready on")) return;
    if (child.exitCode !== null) throw new Error(`The hub stopped at start. Read ${log}.`);
    await sleep(1000);
  }
  throw new Error(`The hub was not ready in 3 minutes. Read ${log}.`);
}

export function hubArgs(port, state, envFile) {
  const flags = ["--ip", "127.0.0.1", "--port", String(port), "--persist-to", state, "--env-file", envFile];
  return [
    "--filter",
    "./apps/hub",
    "exec",
    "wrangler",
    "dev",
    ...flags,
    "--show-interactive-dev-session=false",
  ];
}

export async function startHub(root, runDir) {
  if (await portTaken(PORT)) {
    const hint = `Find it with: lsof -nP -iTCP:${PORT} -sTCP:LISTEN`;
    throw new Error(`Port ${PORT} is in use. The phones need it. Stop that hub first. ${hint}`);
  }
  const env = writeEnv(root, runDir);
  const state = join(runDir, "hub-state");
  mkdirSync(state, { recursive: true });
  const log = join(runDir, "hub.log");
  const out = openSync(log, "w");
  const child = spawn("pnpm", hubArgs(PORT, state, env.file), {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, out],
  });
  await waitReady(log, child);
  return { child, bootstrap: env.bootstrap, log };
}

export async function stopHub(hub) {
  if (hub === null || hub.child.exitCode !== null) return;
  const done = new Promise((resolve) => hub.child.once("exit", resolve));
  process.kill(-hub.child.pid, "SIGTERM");
  await Promise.race([done, sleep(10000)]);
}

export function seedHub(root, hub, runDir) {
  const env = { ...process.env, BOOTSTRAP_CODE: hub.bootstrap, HUB_URL: BASE, SEED_ORG: ORG };
  const text = execFileSync("node", ["apps/hub/scripts/seed.ts"], { cwd: root, env, encoding: "utf8" });
  writeFileSync(join(runDir, "codes.txt"), text, { mode: 0o600 });
  return parseCodes(text);
}
