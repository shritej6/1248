import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import type { RequestSubmit } from "@vision/contracts";
import {
  LINK_MAX_CANDIDATES,
  LINK_THRESHOLD,
  emptyState,
  linkCandidates,
  type CardState,
  type HubState,
} from "@vision/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiJobError, type AiTools } from "../src/ai/types.js";
import { linkJob } from "../src/ai/link.js";
import type { Env, OrgHub } from "../src/orghub.js";
import {
  confirmCmd,
  exportLedger,
  freshOrg,
  join,
  jobOfCard,
  loadPlaybook,
  newCard,
  newId,
  organiser,
  send,
  sql,
  view,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const DAY = 86_400_000;
const MODEL = "@cf/test/embed";
const offEnv = { LINK_MODEL: env.LINK_MODEL, AI: env.AI };
let clock = Date.now() + 365 * DAY;

beforeEach(() => {
  clock = Date.now() + 365 * DAY;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, offEnv);
});

const PILE = "A couch and bags of garbage were dumped in the alley behind 5th Street";
const SAME_PILE = "Someone dumped a couch and trash bags in our alley off 5th Street";
const SNOW = "Please shovel the snow on my front walk this week";
const VECTORS: Record<string, number[]> = {
  [PILE]: [1, 0, 0],
  [SAME_PILE]: [0.999, 0.04, 0],
  [SNOW]: [0, 0, 1],
};

type Call = { model: string; input: unknown };

const fakeRun = (calls: Call[]) => (model: string, input: unknown) => {
  calls.push({ model, input });
  const texts = (input as { text: string[] }).text;
  return Promise.resolve({ shape: [texts.length, 3], data: texts.map((t) => VECTORS[t] ?? [0, 1, 0]) });
};

const card = (
  id: string,
  zip: string | null,
  receivedAt: number,
  more: Partial<CardState> = {},
): CardState => ({
  id,
  receivedAt,
  door: "form",
  zip,
  safeContact: true,
  sorted: null,
  confirmedAt: null,
  need: null,
  urgency: null,
  division: null,
  level: null,
  quiet: false,
  routeCode: null,
  changed: false,
  promiseAt: null,
  jobs: [],
  lang: null,
  ai: {},
  gistAt: null,
  ...more,
});

const stateOf = (cards: CardState[]): HubState => ({
  ...emptyState(),
  cards: Object.fromEntries(cards.map((c) => [c.id, c])),
});

const putVault = (s: SqlStorage, id: string, kind: string, body: string): void => {
  s.exec(
    "INSERT INTO vault (card, job, kind, from_party, body, at, forget_at) VALUES (?, NULL, ?, 'system', ?, 1, NULL)",
    id,
    kind,
    body,
  );
};

const runJob = (
  org: string,
  target: string,
  state: HubState,
  calls: Call[],
  setup: (s: SqlStorage) => void,
) =>
  sql(org, (s) => {
    setup(s);
    const tools: AiTools = { run: fakeRun(calls), model: MODEL, sql: s, state, now: clock };
    return linkJob.run(target, tools);
  });

it("the job embeds the message once and scores only open cards in the same ZIP inside 7 days", async () => {
  const org = freshOrg();
  const now = clock;
  const state = stateOf([
    card("c_new", "53216", now),
    card("c_near", "53216", now - DAY),
    card("c_far", "53206", now - DAY),
    card("c_old", "53216", now - 8 * DAY),
    card("c_novector", "53216", now - DAY),
    card("c_snow", "53216", now - DAY),
  ]);
  const calls: Call[] = [];
  const result = await runJob(org, "c_new", state, calls, (s) => {
    putVault(s, "c_new", "message_in", PILE);
    for (const id of ["c_near", "c_far", "c_old"])
      putVault(s, id, "link_vector", JSON.stringify(VECTORS[SAME_PILE]));
    putVault(s, "c_snow", "link_vector", JSON.stringify(VECTORS[SNOW]));
  });
  expect(calls).toEqual([{ model: MODEL, input: { text: [PILE], truncate_inputs: true } }]);
  expect(result).toEqual({
    type: "link.result",
    card: "c_new",
    outcome: "ok",
    matches: [{ other: "c_near", score: 0.999 }],
  });
  const stored = await sql(org, (s) =>
    s
      .exec<{ body: string }>("SELECT body FROM vault WHERE card = 'c_new' AND kind = 'link_vector'")
      .toArray(),
  );
  expect(stored.map((r) => JSON.parse(r.body) as unknown)).toEqual([VECTORS[PILE]]);
});

it("the job keeps at most 20 matches at or above the threshold, best first, rounded to 3 places", async () => {
  const org = freshOrg();
  const others = Array.from({ length: 28 }, (_, i) =>
    card(`c_${String(i).padStart(2, "0")}`, "53216", clock - DAY),
  );
  const angle = (i: number) => Math.acos(1 - ((1 - LINK_THRESHOLD) * i) / 24);
  const calls: Call[] = [];
  const result = await runJob(
    org,
    "c_new",
    stateOf([card("c_new", "53216", clock), ...others]),
    calls,
    (s) => {
      putVault(s, "c_new", "message_in", PILE);
      others.forEach((o, i) => {
        putVault(s, o.id, "link_vector", JSON.stringify([Math.cos(angle(i)), Math.sin(angle(i)), 0]));
      });
    },
  );
  const matches = result.type === "link.result" ? result.matches : [];
  expect(matches.length).toBe(20);
  expect(matches[0]).toEqual({ other: "c_00", score: 1 });
  expect(matches.every((m, i) => m.score >= LINK_THRESHOLD && m.score <= (matches[i - 1]?.score ?? 1))).toBe(
    true,
  );
  expect(matches.every((m) => Math.round(m.score * 1000) / 1000 === m.score)).toBe(true);
});

const rowsOf = <T>(rows: T[]) => ({ toArray: () => rows });

const cappedSql = (vectors: ReadonlyMap<string, number[]>, asked: string[][]): SqlStorage =>
  ({
    exec: (query: string, ...params: unknown[]) => {
      if (params.length > 100) throw new Error("too many SQL variables");
      if (query.includes("card IN")) {
        const ids = params.slice(1).map(String);
        asked.push(ids);
        return rowsOf(ids.flatMap((id) => [{ card: id, body: JSON.stringify(vectors.get(id)) }]));
      }
      return rowsOf(query.startsWith("SELECT body") ? [{ body: PILE }] : []);
    },
  }) as unknown as SqlStorage;

it("a ZIP with 250 open reports scores the newest 200 in batches under the SQL parameter limit", async () => {
  const others = Array.from({ length: 250 }, (_, i) =>
    card(`c_${String(i).padStart(3, "0")}`, "53216", clock - DAY + i),
  );
  const vectors = new Map(others.map((o, i) => [o.id, i < 50 ? [1, 0, 0] : [0.9, 0.4359, 0]]));
  const state = stateOf([card("c_new", "53216", clock), ...others]);
  const asked: string[][] = [];
  const tools: AiTools = {
    run: fakeRun([]),
    model: MODEL,
    sql: cappedSql(vectors, asked),
    state,
    now: clock,
  };
  const result = await linkJob.run("c_new", tools);
  const matches = result.type === "link.result" ? result.matches : [];
  expect(result).toMatchObject({ type: "link.result", outcome: "ok" });
  expect(LINK_MAX_CANDIDATES).toBe(200);
  expect(linkCandidates(state, "c_new")).toEqual(
    others
      .slice(50)
      .reverse()
      .map((o) => o.id),
  );
  expect(asked.every((ids) => ids.length <= 90)).toBe(true);
  expect(asked.flat().sort()).toEqual(others.slice(50).map((o) => o.id));
  expect(matches.length).toBe(20);
  expect(matches.every((m) => Number(m.other.slice(2)) >= 50 && m.score === 0.9)).toBe(true);
});

it("a card with no message text ends as empty with no model call", async () => {
  const calls: Call[] = [];
  const result = await runJob(
    freshOrg(),
    "c_new",
    stateOf([card("c_new", "53216", clock)]),
    calls,
    () => undefined,
  );
  expect(result).toEqual({ type: "link.result", card: "c_new", outcome: "empty", matches: [] });
  expect(calls).toEqual([]);
});

it("a model reply with no vector is a failed try with a typed error and no text", async () => {
  const bad: AiTools["run"] = () => Promise.resolve({ response: "I cannot help" });
  const org = freshOrg();
  const attempt = sql(org, (s) => {
    putVault(s, "c_new", "message_in", PILE);
    const tools: AiTools = {
      run: bad,
      model: MODEL,
      sql: s,
      state: stateOf([card("c_new", "53216", clock)]),
      now: clock,
    };
    return linkJob.run("c_new", tools);
  });
  await expect(attempt).rejects.toBeInstanceOf(AiJobError);
  await expect(attempt).rejects.not.toThrow(/alley/);
});

const linkHub = async (run: (model: string, input: unknown) => Promise<unknown>): Promise<string> => {
  const org = freshOrg();
  await organiser(org);
  await runInDurableObject(env.ORG.getByName(org), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, { LINK_MODEL: MODEL, AI: { run } });
  });
  return org;
};

const report = async (org: string, message: string, zip = "53216"): Promise<string> => {
  const id = newCard();
  const command: RequestSubmit = {
    type: "request.submit",
    card: id,
    door: "form",
    zip,
    safeContact: true,
    firstName: "Avery",
    contact: "resident@example.test",
    address: "1 Test St",
    message,
  };
  await runInDurableObject(env.ORG.getByName(org), (hub: OrgHub) =>
    hub.applyCommand(command, { role: "system", ref: null }),
  );
  return id;
};

const vaultKinds = (org: string, id: string) =>
  sql(org, (s) =>
    s
      .exec<{ kind: string; forget_at: number | null }>(
        "SELECT kind, forget_at FROM vault WHERE card = ? AND kind != 'person' ORDER BY id",
        id,
      )
      .toArray(),
  );

it("the alarm links two reports of one pile: a score in the ledger, the vector only in the vault", async () => {
  const calls: Call[] = [];
  const org = await linkHub(fakeRun(calls));
  const first = await report(org, PILE);
  const second = await report(org, SAME_PILE);
  await runDurableObjectAlarm(env.ORG.getByName(org));
  const { events } = await exportLedger(org);
  const proposed = events.filter((e) => e.type === "link.proposed");
  expect(proposed.map((e) => [e.card, e.data])).toEqual([[second, { other: first, score: 0.999 }]]);
  expect(JSON.stringify(events)).not.toMatch(/alley|couch|0\.04/);
  const board = JSON.stringify(await view(org, "desk"));
  expect(board).not.toMatch(/\[1,0,0\]|0\.999,0\.04/);
  expect(board).toContain(`"other":"${first}"`);
  expect((await vaultKinds(org, second)).map((r) => r.kind)).toEqual(["message_in", "link_vector"]);
});

it("the vector gets the forget date of the card when its job closes", async () => {
  const org = await linkHub(fakeRun([]));
  const id = await report(org, SNOW);
  await runDurableObjectAlarm(env.ORG.getByName(org));
  const desk = await join(org, "m_d01");
  await loadPlaybook(org);
  await send(org, desk, confirmCmd(id));
  const job = await jobOfCard(org, id);
  await send(org, desk, { id: newId(), type: "job.withdraw", job, reason: "cancelled" });
  const rows = await vaultKinds(org, id);
  const vector = rows.find((r) => r.kind === "link_vector");
  expect(vector?.forget_at).toBeGreaterThan(clock);
  expect(vector?.forget_at).toBe(rows.find((r) => r.kind === "message_in")?.forget_at);
});

it("a model that fails 3 times ends with ai.done failed and the card stays with the desk", async () => {
  const org = await linkHub(() => Promise.reject(new Error("model down")));
  const id = await report(org, PILE);
  for (let n = 0; n < 3; n += 1) {
    await runDurableObjectAlarm(env.ORG.getByName(org));
    clock += DAY;
  }
  const { events } = await exportLedger(org);
  expect(events.filter((e) => e.card === id && e.type.startsWith("ai.")).map((e) => e.data)).toEqual([
    { job: "link" },
    { job: "link", outcome: "failed" },
  ]);
  expect((await vaultKinds(org, id)).map((r) => r.kind)).toEqual(["message_in"]);
});
