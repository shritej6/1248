import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Env } from "../src/orghub.js";
import { exportLedger, freshOrg, organiser, sql, submitForm } from "./helpers.js";

const env = workerEnv as unknown as Env;
const FUTURE = 365 * 24 * 60 * 60_000;
const offEnv = { SORTER_MODEL: env.SORTER_MODEL, AI: env.AI };

beforeEach(() => {
  const clock = Date.now() + FUTURE;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, offEnv);
});

const goodPass = {
  id: "c_1",
  service: "Free services for elderly, disabled, pregnant (lawn care, snow removal)",
  division: "No clear home",
  urgency: "low",
  words: "",
  reason: "A request to clear snow.",
};
type FakeAi = { calls: string[] };

const sorterHub = async (reply: unknown): Promise<{ org: string; ai: FakeAi }> => {
  const org = freshOrg();
  await organiser(org);
  const ai: FakeAi = { calls: [] };
  const run = (model: string): Promise<unknown> => {
    ai.calls.push(model);
    return Promise.resolve(reply);
  };
  await runInDurableObject(env.ORG.getByName(org), (hub) => {
    const hubEnv = (hub as unknown as { env: Env }).env;
    Object.assign(hubEnv, { SORTER_MODEL: "@cf/test/model", AI: { run } });
  });
  return { org, ai };
};

const sortRows = (org: string): Promise<{ kind: string; card: string; payload: string }[]> =>
  sql(org, (s) =>
    s
      .exec<{ kind: string; card: string; payload: string }>("SELECT kind, card, payload FROM outbox")
      .toArray(),
  );

const sortedOf = async (org: string, card: string): Promise<unknown> =>
  (await exportLedger(org)).events.find((e) => e.type === "card.sorted" && e.card === card)?.data;

it("with the sorter on a new card waits in the outbox as a sort item with no message text", async () => {
  const { org } = await sorterHub({ response: JSON.stringify(goodPass) });
  const card = await submitForm(org, {
    firstName: "Avery",
    address: "1 Test St",
    message: "Snow on my walk",
  });
  const rows = await sortRows(org);
  expect(rows).toEqual([{ kind: "sort", card, payload: JSON.stringify({ card }) }]);
  expect(await sortedOf(org, card)).toBeUndefined();
});

it("the alarm sends the sort item to the model and records the answer as a sort result", async () => {
  const { org, ai } = await sorterHub({ response: JSON.stringify(goodPass) });
  const card = await submitForm(org, {
    firstName: "Avery",
    address: "1 Test St",
    message: "Snow on my walk",
  });
  await runDurableObjectAlarm(env.ORG.getByName(org));
  expect(ai.calls).toEqual(["@cf/test/model", "@cf/test/model"]);
  expect(await sortedOf(org, card)).toMatchObject({
    source: "ai",
    urgency: "low",
    service: goodPass.service,
  });
  expect(await sortRows(org)).toEqual([]);
});

it("a model that never answers in JSON leaves the card with the desk as ai_down", async () => {
  const { org } = await sorterHub({ response: "I cannot help with that" });
  const card = await submitForm(org, { firstName: "Avery", address: null, message: "Snow on my walk" });
  await runDurableObjectAlarm(env.ORG.getByName(org));
  expect(await sortedOf(org, card)).toMatchObject({ source: "none", flags: ["ai_down"] });
});

it("with the sorter off no sort item is made", async () => {
  const org = freshOrg();
  await organiser(org);
  await submitForm(org, { firstName: "Avery", address: null, message: "Snow on my walk" });
  expect(await sortRows(org)).toEqual([]);
});
