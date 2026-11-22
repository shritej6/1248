import { emptyState, fold, statement, type HubState } from "@vision/core";
import { beforeEach, expect, it } from "vitest";
import { Store } from "../src/store.js";
import { exportLedger, freshOrg, memberFor, newId, offeredSnowJob, send, sql } from "./helpers.js";

let ORG = freshOrg();
beforeEach(() => {
  ORG = freshOrg();
});

const workSnowJob = async (): Promise<string> => {
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

const withoutTaps = (state: HubState): string =>
  JSON.stringify(state, (key, value: unknown) => (key === "taps" ? undefined : value));

const loadAfterOldSnapshot = (old: HubState): Promise<HubState> =>
  sql(ORG, (s) => {
    s.exec("INSERT OR REPLACE INTO snapshot (id, seq, state) VALUES (1, ?, ?)", old.seq, withoutTaps(old));
    return new Store(s).loadState();
  });

const tappedHours = (state: HubState): number => {
  const ms = Object.values(state.jobs)
    .flatMap((job) => Object.values(job.taps ?? {}))
    .reduce((sum, taps) => sum + taps.hoursMs, 0);
  return Math.round((ms / 3_600_000) * 100) / 100;
};

it("a snapshot from before the tap record is rebuilt from the ledger so the record matches the statement", async () => {
  const job = await workSnowJob();
  const events = (await exportLedger(ORG)).events;
  const full = fold(events, emptyState());
  const loaded = await loadAfterOldSnapshot(full);
  expect(loaded).toEqual(full);
  expect(loaded.jobs[job]?.taps?.[memberFor("m_v01").id]).toBeDefined();
  const month = new Date(events[events.length - 1]?.at ?? 0).toISOString().slice(0, 7);
  expect(statement(events, month).hours).toBe(tappedHours(loaded));
});

it("a snapshot of the current shape is used as is", async () => {
  await workSnowJob();
  const loaded = await sql(ORG, (s) => new Store(s).loadState());
  expect(loaded).toEqual(fold((await exportLedger(ORG)).events, emptyState()));
});

it("a snapshot of shape 3, from before the AI jobs, is rebuilt so every card has its AI fields", async () => {
  await workSnowJob();
  const full = fold((await exportLedger(ORG)).events, emptyState());
  const without = (value: object, keys: readonly string[]) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
  const cards = Object.fromEntries(
    Object.entries(full.cards).map(([id, card]) => [id, without(card, ["lang", "ai", "gistAt"])]),
  );
  const loaded = await sql(ORG, (s) => {
    const snap = JSON.stringify({ shape: 3, state: { ...without(full, ["links"]), cards } });
    s.exec("INSERT OR REPLACE INTO snapshot (id, seq, state) VALUES (1, ?, ?)", full.seq, snap);
    return new Store(s).loadState();
  });
  expect(loaded).toEqual(full);
  expect(loaded.links).toEqual({});
  expect(Object.values(loaded.cards).map((card) => [card.lang, card.ai])).toEqual(
    Object.values(full.cards).map(() => [null, {}]),
  );
});
