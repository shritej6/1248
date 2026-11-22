import { runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { ResourcesViewSchema, type Match, type NeedForecast, type ResourcesView } from "@vision/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/orghub.js";
import {
  errorCode,
  freshOrg,
  get,
  hubFetch,
  join,
  loadPlaybook,
  memberFor,
  organiser,
  post,
  sql,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const BASE = "https://hub.test/api/v1/o";
const ACTIONS = ["costs", "readiness", "drafts", "approve"] as const;

let ORG = freshOrg();
let TOKEN = "";
const outside: unknown[] = [];

beforeEach(async () => {
  ORG = freshOrg();
  outside.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    outside.push(input);
    return Promise.reject(new TypeError("Unexpected outside call"));
  });
  await loadPlaybook(ORG);
  TOKEN = await organiser(ORG);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, { DEMO_MODE: "on" });
});

const hubWith = (vars: Partial<Env>): Promise<void> =>
  runInDurableObject(env.ORG.getByName(ORG), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, vars);
  });

const resources = async (token = TOKEN): Promise<ResourcesView> => {
  const r = await get(`${ORG}/resources`, token);
  expect(r.status).toBe(200);
  return ResourcesViewSchema.parse(await r.json());
};

const act = (action: string, body: unknown, token = TOKEN): Promise<Response> =>
  post(`${ORG}/resources/${action}`, body, token);

const viewOf = async (r: Response): Promise<ResourcesView> => {
  expect(r.status).toBe(200);
  return ResourcesViewSchema.parse(await r.json());
};

const needOf = (view: ResourcesView, need: string): NeedForecast => {
  const found =
    view.forecast.status === "ready" ? view.forecast.needs.find((n) => n.need === need) : undefined;
  if (found === undefined) throw new Error(`The forecast has no need ${need}`);
  return found;
};

const matchOf = (view: ResourcesView, resource: string): Match => {
  const found = view.matches.find((m) => m.resource === resource);
  if (found === undefined) throw new Error(`The view has no match for ${resource}`);
  return found;
};

const failure = async (r: Response): Promise<{ status: number; code: string; message: string }> => {
  const body = await r.json<{ error: { code: string; message: string } }>();
  return { status: r.status, code: body.error.code, message: body.error.message };
};

describe("only an organiser can use Resources", () => {
  it("a call with no session gets 401", async () => {
    const r = await hubFetch(`${BASE}/${ORG}/resources`);
    expect(await failure(r)).toEqual({ status: 401, code: "unauthorized", message: "Sign in again." });
  });

  it("a volunteer and a desk member get 403", async () => {
    for (const alias of ["m_v01", "m_d01"]) {
      const r = await get(`${ORG}/resources`, await join(ORG, alias));
      const forbidden = { status: 403, code: "forbidden", message: "Only an organiser can use Resources." };
      expect(await failure(r)).toEqual(forbidden);
    }
  });

  it("the role check runs before the body is read, for every action", async () => {
    const desk = await join(ORG, "m_d01");
    for (const action of ACTIONS) expect((await act(action, "not a body", desk)).status).toBe(403);
    for (const action of ACTIONS) expect((await act(action, { draft: "x" }, "")).status).toBe(401);
  });

  it("the organiser gets a view that parses with the contract", async () => {
    const view = await resources();
    expect(view.needs.map((n) => n.need)).not.toContain("text_extraction");
    expect(view.drafting).toEqual({ cap: 20, usedToday: 0 });
    expect(view.drafts).toEqual([]);
  });
});

describe("the forecast and demo mode", () => {
  it("demo mode gives a ready forecast from 24 synthetic months for the 13 active needs", async () => {
    const view = await resources();
    expect(view.demo).toBe(true);
    if (view.forecast.status !== "ready") throw new Error("The demo forecast is not ready");
    expect(view.forecast.history).toMatchObject({ syntheticMonths: 24, recordMonths: 0 });
    expect(view.forecast.needs).toHaveLength(13);
    expect(view.needs).toHaveLength(13);
  });

  it("with demo mode off a fresh record has no forecast, and the matches still come back", async () => {
    await hubWith({ DEMO_MODE: "off" });
    const view = await resources();
    expect(view.demo).toBe(false);
    expect(view.forecast).toEqual({ status: "not_enough_history", recordMonths: 0, needed: 12 });
    expect(view.matches.length).toBeGreaterThan(0);
  });
});

describe("unit costs", () => {
  it("a unit cost for snow gives cash on snow only, and null clears it", async () => {
    const set = await viewOf(await act("costs", { need: "snow", centsPerJob: 2500, basis: "estimate" }));
    expect(set.costs).toMatchObject([{ need: "snow", centsPerJob: 2500, basis: "estimate" }]);
    const snow = needOf(set, "snow");
    expect(snow.cost).toEqual({ centsPerJob: 2500, basis: "estimate" });
    for (const month of snow.months) expect(month.cashCents?.likely).toBe(month.jobs.likely * 2500);
    expect(needOf(set, "food").total.cashCents).toBeNull();
    const cleared = await viewOf(await act("costs", { need: "snow", centsPerJob: null, basis: "estimate" }));
    expect(cleared.costs).toEqual([]);
    expect(needOf(cleared, "snow").total.cashCents).toBeNull();
  });

  it("a cost from receipts replaces the estimate", async () => {
    await act("costs", { need: "snow", centsPerJob: 2500, basis: "estimate" });
    const view = await viewOf(await act("costs", { need: "snow", centsPerJob: 3100, basis: "receipts" }));
    expect(view.costs).toMatchObject([{ need: "snow", centsPerJob: 3100, basis: "receipts" }]);
  });

  it("a quiet need, an unknown need and a bad amount give 400", async () => {
    const quiet = await act("costs", { need: "text_extraction", centsPerJob: 100, basis: "estimate" });
    const notInPlaybook = { status: 400, code: "invalid", message: "This need is not in the playbook." };
    expect(await failure(quiet)).toEqual(notInPlaybook);
    const unknown = await act("costs", { need: "no_such_need", centsPerJob: 100, basis: "estimate" });
    expect(await failure(unknown)).toEqual(notInPlaybook);
    const bad = await act("costs", { need: "snow", centsPerJob: -1, basis: "estimate" });
    expect(await failure(bad)).toEqual({
      status: 400,
      code: "invalid",
      message: "The request is not valid.",
    });
    expect((await resources()).costs).toEqual([]);
  });
});

describe("the readiness list", () => {
  it("a signed sponsor turns the Givebutter path to the sponsor with reach 0.9", async () => {
    const before = matchOf(await resources(), "givebutter_sponsor");
    expect(before).toMatchObject({ path: "via_sponsor", parts: { reach: 0.6 } });
    expect(before.cautions.map((c) => c.code)).toContain("needs_sponsor");
    const view = await viewOf(await act("readiness", { item: "sponsor", state: "signed" }));
    expect(view.readiness).toEqual({ sponsor: "signed", dfi: "not_checked", c3: "no", uei: "not_needed" });
    const after = matchOf(view, "givebutter_sponsor");
    expect(after.parts.reach).toBe(0.9);
    expect(after.cautions.map((c) => c.code)).toContain("through_sponsor");
    expect(after.cautions.map((c) => c.code)).not.toContain("needs_sponsor");
  });

  it("a state that the item does not have gives 400 and changes nothing", async () => {
    expect(await errorCode(await act("readiness", { item: "sponsor", state: "yes" }))).toBe("invalid");
    expect((await resources()).readiness.sponsor).toBe("none");
  });
});

describe("who set a cost or a readiness item", () => {
  const setters = (): Promise<{ costs: unknown[]; readiness: unknown[] }> =>
    sql(ORG, (s) => ({
      costs: s.exec("SELECT need, updated_by FROM resource_costs ORDER BY need").toArray(),
      readiness: s.exec("SELECT item, updated_by FROM resource_readiness ORDER BY item").toArray(),
    }));

  it("each row keeps the organiser who set it last", async () => {
    const first = await sql(ORG, (s) =>
      s.exec<{ id: string }>("SELECT id FROM members WHERE roles LIKE '%organiser%'").one(),
    );
    await viewOf(await act("costs", { need: "snow", centsPerJob: 2500, basis: "estimate" }));
    await viewOf(await act("readiness", { item: "sponsor", state: "signed" }));
    expect(await setters()).toEqual({
      costs: [{ need: "snow", updated_by: first.id }],
      readiness: [{ item: "sponsor", updated_by: first.id }],
    });
    const second = memberFor("m_o01").id;
    const token = await join(ORG, "m_o01");
    await viewOf(await act("costs", { need: "snow", centsPerJob: 3100, basis: "receipts" }, token));
    await viewOf(await act("readiness", { item: "sponsor", state: "talking" }, token));
    expect(await setters()).toEqual({
      costs: [{ need: "snow", updated_by: second }],
      readiness: [{ item: "sponsor", updated_by: second }],
    });
  });
});

describe("the Resources routes", () => {
  it("a path that is not a Resources route gives 404", async () => {
    expect((await get(`${ORG}/resources/anything`, TOKEN)).status).toBe(404);
    expect((await act("anything", {})).status).toBe(404);
    expect((await post(`${ORG}/resources`, {}, TOKEN)).status).toBe(404);
  });

  it("Resources never calls a site outside the hub", async () => {
    await resources();
    await act("costs", { need: "snow", centsPerJob: 2500, basis: "estimate" });
    await act("readiness", { item: "dfi", state: "registered" });
    expect(outside).toEqual([]);
  });
});
