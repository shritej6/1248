import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { TrackingSchema, type Decision, type LedgerEvent } from "@vision/contracts";
import { nextDeadlineAt, type HubState } from "@vision/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextForgetAt } from "../src/alarm.js";
import { trackingCard } from "../src/doors.js";
import type { Env, OrgHub } from "../src/orghub.js";
import { enqueue } from "../src/outbox.js";
import {
  confirmCmd,
  exportLedger,
  freshOrg,
  hubFetch,
  jobOfCard,
  join,
  loadPlaybook,
  newId,
  offeredSnowJob,
  organiser,
  send,
  sql,
  submitForm,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const API = "https://hub.test/api/v1/o";
const MINUTE = 60_000;
const FUTURE = 365 * 24 * 60 * MINUTE;
const DAY = 24 * 60 * MINUTE;
const GOOGLE = "https://google.test/exec";
const FIRED: ReadonlySet<string> = new Set(["offer.wave_sent", "offer.closed", "job.returned"]);

let ORG = freshOrg();
let clock = 0;
beforeEach(() => {
  ORG = freshOrg();
  clock = Date.now() + FUTURE;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, { GOOGLE_URL: "", GOOGLE_SECRET: "" });
});

const advance = (ms: number): void => {
  clock += ms;
};

const stub = (org: string) => env.ORG.getByName(org);

const runAlarm = (org: string): Promise<boolean> => runDurableObjectAlarm(stub(org));

const alarmAt = (org: string): Promise<number | null> =>
  runInDurableObject(stub(org), (_hub, state) => state.storage.getAlarm());

const jumpMinutes = async (minutes: number): Promise<Response> =>
  send(ORG, await organiser(ORG), { id: newId(), type: "clock.jump", minutes });

const vaultCount = (org: string): Promise<number> =>
  sql(org, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM vault").one().n);

const outboxCount = (org: string): Promise<number> =>
  sql(org, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n);

type HubInside = {
  state: HubState;
  transaction<T>(run: () => T): T;
  commit(decision: Extract<Decision, { ok: true }>, fromParty: string, at: number): number;
  refreshAlarm(ranAt: number | null): Promise<void>;
};

const inside = (hub: OrgHub): HubInside => hub as unknown as HubInside;

const closeHelped = (org: string, card: string, job: string): Promise<void> =>
  runInDurableObject(stub(org), async (hub: OrgHub) => {
    const h = inside(hub);
    const closed = {
      card,
      job,
      actor: { role: "system", ref: null },
      type: "job.closed",
      data: { result: "helped", reason: null },
    } as const;
    h.transaction(() => h.commit({ ok: true, events: [closed], effects: [] }, "system", hub.now()));
    await h.refreshAlarm(null);
  });

const nextDeadlineAlarm = (org: string): Promise<number | null> =>
  runInDurableObject(stub(org), (hub: OrgHub) => {
    const { state } = inside(hub);
    const at = nextDeadlineAt(state, hub.decideContext(hub.now()));
    return at === null ? null : at - state.clockOffsetMs;
  });

const runAlarmNow = (org: string): Promise<void> =>
  runInDurableObject(stub(org), (hub: OrgHub) => hub.alarm());

const linesAfter = (events: readonly LedgerEvent[], type: string): LedgerEvent[] => {
  const from = events.findIndex((e) => e.type === type);
  return from === -1 ? [] : events.slice(from + 1);
};

const postForm = (org: string): Promise<Response> =>
  hubFetch(`${API}/${org}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.40" },
    body: JSON.stringify({
      firstName: "Avery",
      contactKind: "email",
      contact: "avery@example.test",
      zip: "53216",
      message: "Snow on my walk",
      address: "1 Test St",
      safeContact: true,
      website: "",
    }),
  });

const confirmedCard = async (org: string, card: string): Promise<string> => {
  const desk = await join(org, "m_d01");
  await loadPlaybook(org);
  await send(org, desk, confirmCmd(card));
  return jobOfCard(org, card);
};

const helpedSnowCard = async (org: string): Promise<string> => {
  await organiser(org);
  const card = await submitForm(org, {
    firstName: "Avery",
    address: "1 Test St",
    message: "Snow on my walk",
  });
  await closeHelped(org, card, await confirmedCard(org, card));
  return card;
};

const helpedSnowTracking = async (org: string): Promise<string> => {
  await organiser(org);
  const { tracking } = await (await postForm(org)).json<{ tracking: string }>();
  const token = tracking.split("/t/")[1] ?? "";
  const card = await sql(org, (s) => trackingCard(s, token));
  if (card === null) throw new Error("The form gave no tracking link");
  await closeHelped(org, card, await confirmedCard(org, card));
  return tracking;
};

it("clock_jump_fires_due_timers_in_order", async () => {
  const first = await offeredSnowJob(ORG);
  advance(MINUTE);
  const second = await offeredSnowJob(ORG);
  expect((await jumpMinutes(60)).status).toBe(200);
  const fired = linesAfter((await exportLedger(ORG)).events, "clock.jumped").filter((e) => FIRED.has(e.type));
  const times = fired.map((e) => e.at);
  expect(times).toEqual([...times].sort((a, b) => a - b));
  const returned = fired.filter((e) => e.type === "job.returned").map((e) => e.job);
  expect(returned).toEqual([first.job, second.job]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await alarmAt(ORG)).toBe(await nextDeadlineAlarm(ORG));
});

it("clock_jump_fires_due_timers_in_order over two 3 day jumps of check-back", async () => {
  const { v1, job } = await offeredSnowJob(ORG);
  for (const command of [
    { type: "offer.accept", job },
    { type: "job.on_my_way", job },
    { type: "job.there", job },
    { type: "job.done", job, outcome: "done" },
  ])
    expect((await send(ORG, v1, { id: newId(), ...command })).status).toBe(200);
  expect((await jumpMinutes(4320)).status).toBe(200);
  expect((await jumpMinutes(4320)).status).toBe(200);
  const after = linesAfter((await exportLedger(ORG)).events, "clock.jumped").filter((e) => e.job === job);
  const sent = after.filter((e) => e.type === "checkback.sent");
  expect(sent.map((e) => e.data)).toEqual([{ try: 1 }, { try: 2 }, { try: 3 }]);
  const times = sent.map((e) => e.at);
  expect(times).toEqual([...times].sort((a, b) => a - b));
  expect(after.at(-1)).toMatchObject({ type: "job.closed", data: { result: "unreached" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const forget = await sql(ORG, nextForgetAt);
  const offset = await runInDurableObject(stub(ORG), (hub: OrgHub) => inside(hub).state.clockOffsetMs);
  expect(forget).not.toBeNull();
  expect(await alarmAt(ORG)).toBe((forget ?? 0) - offset);
});

it("the alarm is set to the next deadline", async () => {
  const { job } = await offeredSnowJob(ORG);
  const wave = (await exportLedger(ORG)).events.find((e) => e.type === "offer.wave_sent" && e.job === job);
  expect(wave).toBeDefined();
  expect(await alarmAt(ORG)).toBe((wave?.at ?? 0) + 5 * MINUTE);
});

it("the alarm fires a due wave clock without a person", async () => {
  const { job } = await offeredSnowJob(ORG);
  advance(5 * MINUTE);
  expect(await runAlarm(ORG)).toBe(true);
  const after = (await exportLedger(ORG)).events.filter((e) => e.job === job && FIRED.has(e.type));
  expect(after.length).toBeGreaterThan(1);
});

it("a deadline that comes due while the outbox drains still sets the alarm", async () => {
  const { job } = await offeredSnowJob(ORG);
  const wave = (await exportLedger(ORG)).events.find((e) => e.type === "offer.wave_sent" && e.job === job);
  await runInDurableObject(stub(ORG), (hub, state) => {
    Object.assign((hub as unknown as { env: Env }).env, { GOOGLE_URL: GOOGLE, GOOGLE_SECRET: "test-secret" });
    enqueue(state.storage.sql, { kind: "mail", card: null, payload: { subject: "Receipt" } }, Date.now());
  });
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (input !== GOOGLE) throw new TypeError("Unexpected outside call");
    advance(7 * MINUTE);
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  advance(MINUTE);
  await runAlarmNow(ORG);
  expect(await outboxCount(ORG)).toBe(0);
  expect(await alarmAt(ORG)).toBe((wave?.at ?? 0) + 5 * MINUTE);
});

it("a due timer that throws does not stop the outbox or the next alarm", async () => {
  const { job } = await offeredSnowJob(ORG);
  const wave = (await exportLedger(ORG)).events.find((e) => e.type === "offer.wave_sent" && e.job === job);
  const logged = vi.spyOn(console, "log");
  await runInDurableObject(stub(ORG), (hub, state) => {
    Object.assign((hub as unknown as { env: Env }).env, { GOOGLE_URL: GOOGLE, GOOGLE_SECRET: "test-secret" });
    Object.assign(hub, {
      runClocks: () => {
        throw new RangeError("bad deadline");
      },
    });
    enqueue(state.storage.sql, { kind: "mail", card: null, payload: { subject: "Receipt" } }, Date.now());
  });
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    if (input !== GOOGLE) throw new TypeError("Unexpected outside call");
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  advance(MINUTE);
  await runAlarmNow(ORG);
  expect(await outboxCount(ORG)).toBe(0);
  expect(await alarmAt(ORG)).toBe((wave?.at ?? 0) + 5 * MINUTE);
  expect(logged.mock.calls.flat().join("\n")).toContain(
    '"op":"clocks","status":"failed","error":"RangeError"',
  );
});

it("an unexpected throw in a route answers with the error shape and a 500", async () => {
  const token = await organiser(ORG);
  const r = await runInDurableObject(stub(ORG), (hub: OrgHub) => {
    Object.assign(hub, {
      exportLedger: () => {
        throw new TypeError("broken view");
      },
    });
    return hub.fetch(new Request(`${API}/${ORG}/export`, { headers: { Authorization: `Bearer ${token}` } }));
  });
  expect(r.status).toBe(500);
  expect(await r.json()).toMatchObject({ ok: false, error: { code: "internal" } });
});

it("an open request keeps its private details past the forget days", async () => {
  await organiser(ORG);
  await submitForm(ORG, { firstName: "Avery", address: "1 Test St", message: "Snow on my walk" });
  const kept = await vaultCount(ORG);
  expect(kept).toBeGreaterThan(0);
  expect(await sql(ORG, nextForgetAt)).toBeNull();
  advance(91 * DAY);
  await runAlarmNow(ORG);
  expect(await vaultCount(ORG)).toBe(kept);
  expect((await exportLedger(ORG)).events.some((e) => e.type === "vault.erased")).toBe(false);
});

it("the forget job erases a closed request 90 days after it closes and writes one line with the count", async () => {
  const card = await helpedSnowCard(ORG);
  const closedAt = (await exportLedger(ORG)).events.find(
    (e) => e.type === "job.closed" && e.card === card,
  )?.at;
  expect(await alarmAt(ORG)).toBe((closedAt ?? 0) + 90 * DAY);
  const kept = await vaultCount(ORG);
  expect(kept).toBeGreaterThan(0);
  advance(89 * DAY);
  await runAlarmNow(ORG);
  expect(await vaultCount(ORG)).toBe(kept);
  advance(DAY + MINUTE);
  await runAlarm(ORG);
  expect(await vaultCount(ORG)).toBe(0);
  const erased = (await exportLedger(ORG)).events.filter((e) => e.type === "vault.erased");
  expect(erased).toHaveLength(1);
  expect(erased[0]?.data).toMatchObject({ erased: kept });
  expect(JSON.stringify(erased)).not.toMatch(/Avery|Test St|Snow on my walk/);
});

it("a closed request that gets a new job keeps its private details while the new job is open", async () => {
  const card = await helpedSnowCard(ORG);
  const kept = await vaultCount(ORG);
  const desk = await join(ORG, "m_d01");
  expect((await send(ORG, desk, { id: newId(), type: "card.add_job", card, need: "snow" })).status).toBe(200);
  expect(await sql(ORG, nextForgetAt)).toBeNull();
  advance(91 * DAY);
  await runAlarmNow(ORG);
  expect(await vaultCount(ORG)).toBe(kept);
  const jobs = (await exportLedger(ORG)).events.filter((e) => e.type === "job.planned" && e.card === card);
  const reopened = jobs.at(-1)?.job ?? "";
  await closeHelped(ORG, card, reopened);
  const forget = await sql(ORG, (s) =>
    s
      .exec<{ at: number | null }>("SELECT DISTINCT forget_at AS at FROM vault WHERE card = ?", card)
      .toArray(),
  );
  expect(forget).toEqual([{ at: Date.now() + 90 * DAY }]);
});

it("a failed outside mail for a closed request is erased on its forget date", async () => {
  await organiser(ORG);
  const card = await submitForm(ORG, {
    firstName: "Avery",
    address: "1 Test St",
    message: "Snow on my walk",
  });
  await sql(ORG, (s) => {
    enqueue(
      s,
      { kind: "mail", card, payload: { to: "avery@example.test", text: "Snow on my walk" } },
      Date.now(),
    );
    s.exec("UPDATE outbox SET tries = 3, last_error = 'OutboxError: status 500'");
  });
  await closeHelped(ORG, card, await confirmedCard(ORG, card));
  const kept = await vaultCount(ORG);
  advance(90 * DAY + MINUTE);
  await runAlarm(ORG);
  expect(await outboxCount(ORG)).toBe(0);
  const erased = (await exportLedger(ORG)).events.filter((e) => e.type === "vault.erased");
  expect(erased[0]?.data).toMatchObject({ erased: kept + 1 });
});

it("link_after_forget_shows_closed", async () => {
  const tracking = await helpedSnowTracking(ORG);
  advance(90 * DAY + MINUTE);
  expect(await runAlarm(ORG)).toBe(true);
  const r = await hubFetch(`${API}${tracking}`);
  expect(r.status).toBe(200);
  expect(TrackingSchema.parse(await r.json())).toMatchObject({ closed: true, messages: [] });
  expect((await exportLedger(ORG)).events.some((e) => e.type === "vault.erased")).toBe(true);
});
