import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const PORT = 8799;
const ORIGIN = `http://localhost:${String(PORT)}`;

process.env.E2E_HUB_URL ??= ORIGIN;
process.env.E2E_BOOTSTRAP_CODE ??= `e2e-${randomUUID()}`;
process.env.E2E_DOOR_SECRET ??= `e2e-${randomUUID()}`;

export const MODEL_VARS = ["SORTER_MODEL", "VOICE_MODEL", "LINK_MODEL", "TRANSLATE_MODEL"] as const;

const hub = [
  "wrangler dev --local",
  `--port ${String(PORT)}`,
  "--persist-to .wrangler/e2e-state",
  `--var BOOTSTRAP_CODE:${process.env.E2E_BOOTSTRAP_CODE}`,
  `--var DOOR_SECRET:${process.env.E2E_DOOR_SECRET}`,
  `--var PUBLIC_ORIGIN:${ORIGIN}`,
  ...MODEL_VARS.map((name) => `--var ${name}:`),
].join(" ");

export default defineConfig({
  testDir: "e2e",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: ORIGIN, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm run build && cd ../hub && rm -rf .wrangler/e2e-state && pnpm exec ${hub}`,
    url: `${ORIGIN}/comforce-demo/ask`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
