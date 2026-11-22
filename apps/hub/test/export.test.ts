import { runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { OrgViewSchema } from "@vision/contracts";
import { verifySeal } from "@vision/core";
import { beforeEach, expect, it } from "vitest";
import type { Env, OrgHub } from "../src/orghub.js";
import {
  errorCode,
  exportLedger,
  freshOrg,
  get,
  join,
  newId,
  offeredSnowJob,
  organiser,
  send,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const API = "https://hub.test/api/v1/o";

let ORG = freshOrg();
beforeEach(() => {
  ORG = freshOrg();
});

const doneSnowJob = async (): Promise<string> => {
  const { v1, job } = await offeredSnowJob(ORG);
  for (const command of [
    { type: "offer.accept", job },
    { type: "job.on_my_way", job },
    { type: "job.there", job },
    { type: "job.done", job, outcome: "done" },
  ]) {
    const r = await send(ORG, v1, { id: newId(), ...command });
    expect(r.status).toBe(200);
  }
  return job;
};

const sendAsOrganiser = async (command: Record<string, unknown>, vars: Pick<Env, "DEMO_MODE">) => {
  const token = await organiser(ORG);
  return runInDurableObject(env.ORG.getByName(ORG), async (hub: OrgHub) => {
    const hubEnv = (hub as unknown as { env: Env }).env;
    const before = hubEnv.DEMO_MODE;
    hubEnv.DEMO_MODE = vars.DEMO_MODE;
    try {
      return await hub.fetch(
        new Request(`${API}/${ORG}/commands`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: newId(), ...command }),
        }),
      );
    } finally {
      hubEnv.DEMO_MODE = before;
    }
  });
};

it("export verifies with the seal tool", async () => {
  const job = await doneSnowJob();
  const exp = await exportLedger(ORG);
  expect(exp.events.some((e) => e.type === "job.done" && e.job === job)).toBe(true);
  expect(exp.sealed).toMatchObject({ ok: true });
  expect(verifySeal(exp.events)).toMatchObject({ ok: true });
});

it("export is only for an organiser", async () => {
  await doneSnowJob();
  const r = await get(`${ORG}/export`, await join(ORG, "m_d01"));
  expect(r.status).toBe(403);
  expect(await errorCode(r)).toBe("forbidden");
});

it("clock jump is refused when demo mode is off", async () => {
  const r = await sendAsOrganiser({ type: "clock.jump", minutes: 60 }, { DEMO_MODE: "off" });
  expect(r.status).toBe(409);
  expect(await errorCode(r)).toBe("demo_off");
});

it("clock jump moves the demo clock when demo mode is on", async () => {
  const r = await sendAsOrganiser({ type: "clock.jump", minutes: 60 }, { DEMO_MODE: "on" });
  expect(r.status).toBe(200);
  const view = OrgViewSchema.parse(await (await get(`${ORG}/views/org`, await organiser(ORG))).json());
  expect(view.demo).toEqual({ mode: true, offsetMs: 3_600_000 });
});

it("the organiser view is only for an organiser", async () => {
  const r = await get(`${ORG}/views/org`, await join(ORG, "m_d01"));
  expect(r.status).toBe(403);
});
