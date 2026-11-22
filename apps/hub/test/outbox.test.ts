import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enqueue, retryWait, type OutboxRow } from "../src/outbox.js";
import type { Env } from "../src/orghub.js";
import { DeskBoardSchema } from "@vision/contracts";
import { freshOrg, get, organiser, sql } from "./helpers.js";

const env = workerEnv as unknown as Env;
const GOOGLE = "https://google.test/exec";
const MINUTE = 60_000;
const FUTURE = 365 * 24 * 60 * MINUTE;

type FakeGoogle = { calls: number; bodies: unknown[] };

let ORG = freshOrg();
let clock = 0;
beforeEach(async () => {
  ORG = freshOrg();
  clock = Date.now() + FUTURE;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await organiser(ORG);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, { GOOGLE_URL: "", GOOGLE_SECRET: "" });
});

const stub = (org: string) => env.ORG.getByName(org);

const fakeGoogle = (status: number): FakeGoogle => {
  const google: FakeGoogle = { calls: 0, bodies: [] };
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (input !== GOOGLE || typeof init?.body !== "string") throw new TypeError("Unexpected outside call");
    google.calls += 1;
    google.bodies.push(JSON.parse(init.body) as unknown);
    return Promise.resolve(new Response("{}", { status }));
  });
  return google;
};

const useGoogle = (url: string): Promise<void> =>
  runInDurableObject(stub(ORG), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, {
      GOOGLE_URL: url,
      GOOGLE_SECRET: "test-google-secret",
    });
  });

const sendMailThroughOutbox = (url = GOOGLE): Promise<void> =>
  useGoogle(url).then(() =>
    runInDurableObject(stub(ORG), async (_hub, state) => {
      const payload = { to: "resident@example.test", subject: "Receipt" };
      enqueue(state.storage.sql, { kind: "mail", card: null, payload }, Date.now());
      await state.storage.setAlarm(Date.now());
    }),
  );

const runAlarmTimes = async (times: number): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await runDurableObjectAlarm(stub(ORG));
    clock += 10 * MINUTE;
  }
};

const outboxRows = (): Promise<OutboxRow[]> =>
  sql(ORG, (s) => s.exec<OutboxRow>("SELECT * FROM outbox ORDER BY id").toArray());

it("a failing outside call is tried 3 times and then kept with its error", async () => {
  const google = fakeGoogle(500);
  await sendMailThroughOutbox();
  await runAlarmTimes(4);
  expect(google.calls).toBe(3);
  const [row] = await outboxRows();
  expect(row?.tries).toBe(3);
  expect(row?.last_error).toMatch(/status 500/);
});

it("the organiser sees a send that failed 3 times on the board, without its private payload", async () => {
  fakeGoogle(500);
  await sendMailThroughOutbox();
  await runAlarmTimes(4);
  const [row] = await outboxRows();
  const r = await get(`${ORG}/views/desk`, await organiser(ORG));
  expect(r.status).toBe(200);
  const body: unknown = await r.json();
  expect(DeskBoardSchema.parse(body).failedSends).toEqual([
    { kind: "mail", card: null, tries: 3, lastError: row?.last_error, at: row?.next_at },
  ]);
  expect(row?.last_error).toMatch(/status 500/);
  expect(JSON.stringify(body)).not.toMatch(/resident@example\.test|Receipt/);
});

it("a sent row leaves the outbox and carries its kind and the secret", async () => {
  const google = fakeGoogle(200);
  await sendMailThroughOutbox();
  await runAlarmTimes(1);
  expect(google.calls).toBe(1);
  expect(google.bodies[0]).toMatchObject({ secret: "test-google-secret", kind: "mail", subject: "Receipt" });
  expect(await outboxRows()).toEqual([]);
});

it("a failed row waits before the next try", async () => {
  const google = fakeGoogle(503);
  await sendMailThroughOutbox();
  const start = Date.now();
  await runDurableObjectAlarm(stub(ORG));
  expect(await outboxRows()).toMatchObject([{ tries: 1, next_at: start + 30_000 }]);
  await runInDurableObject(stub(ORG), (hub) => hub.alarm());
  expect(google.calls).toBe(1);
});

it("the waits grow from 30 seconds to 2 and 8 minutes", () => {
  expect([1, 2, 3].map(retryWait)).toEqual([30_000, 2 * MINUTE, 8 * MINUTE]);
});

it("a hub with no outside address keeps the row with a clear error and makes no call", async () => {
  const google = fakeGoogle(200);
  await sendMailThroughOutbox("");
  await runAlarmTimes(1);
  expect(google.calls).toBe(0);
  const [row] = await outboxRows();
  expect(row?.tries).toBe(1);
  expect(row?.last_error).toMatch(/No outside address/);
});
