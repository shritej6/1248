import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import {
  DRAFT_DAILY_CAP,
  DraftFactsSchema,
  ResourcesViewSchema,
  type DraftFacts,
  type DraftView,
  type ResourcesView,
} from "@vision/contracts";
import { addMonths, drafterInput, sha256Hex } from "@vision/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env, OrgHub } from "../src/orghub.js";
import { giveUpDraft, type DraftJobHost } from "../src/resources/job.js";
import { DRAFT_KIND } from "../src/resources/kind.js";
import { exportLedger, freshOrg, get, loadPlaybook, newId, post, send, sql } from "./helpers.js";

const env = workerEnv as unknown as Env;
const AI = env.AI;
const HOUR = 60 * 60_000;
const FUTURE = 365 * 24 * HOUR;
const MODEL = "@cf/test/draft";
const ORGANISER = "Quinn Organiser (test)";
const GOOD =
  "Our volunteers answered every request for help that came in. Thank you to each of them for the care they gave.";
const INVENTED = "We helped 15 neighbours this month with warm meals and rides to the doctor.";
const NOT_READY = "This draft is not ready, or it is approved already.";
const NO_LETTER =
  "This resource does not take a letter. Vision writes to grants and companies that are not closed.";
const UNSAFE = "A name in the record holds a web address or a hidden mark, so Vision will not draft from it.";
const SYSTEM = { role: "system", ref: null };

type Calls = { model: string; input: unknown }[];
type Signed = { token: string; member: string };

let ORG = freshOrg();
let clock = 0;
let ME: Signed = { token: "", member: "" };
const logs: string[] = [];

const signUp = async (): Promise<Signed> => {
  const r = await post(`${ORG}/bootstrap`, {
    code: env.BOOTSTRAP_CODE,
    name: ORGANISER,
    contact: "organiser@example.test",
    orgName: "ComForce MKE",
  });
  const body = await r.json<{ session: string; member: { id: string } }>();
  return { token: body.session, member: body.member.id };
};

beforeEach(async () => {
  ORG = freshOrg();
  clock = Date.now() + FUTURE;
  logs.length = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  ME = await signUp();
  await loadPlaybook(ORG);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, { DRAFT_MODEL: "", AI, GOOGLE_URL: "", GOOGLE_SECRET: "" });
});

const hubWith = (vars: Partial<Env>): Promise<void> =>
  runInDurableObject(env.ORG.getByName(ORG), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, vars);
  });

const model = async (reply: () => Promise<unknown>): Promise<Calls> => {
  const calls: Calls = [];
  const run = (id: string, input: unknown): Promise<unknown> => {
    calls.push({ model: id, input });
    return reply();
  };
  await hubWith({ DRAFT_MODEL: MODEL, AI: { run } });
  return calls;
};

const newDraft = (): string => `d_${crypto.randomUUID()}`;
const impact = (month: string, draft = newDraft()) => ({ draft, kind: "impact_post", month, resource: null });
const ask = (body: unknown): Promise<Response> => post(`${ORG}/resources/drafts`, body, ME.token);
const approve = (draft: string): Promise<Response> => post(`${ORG}/resources/approve`, { draft }, ME.token);

const current = async (): Promise<ResourcesView> =>
  ResourcesViewSchema.parse(await (await get(`${ORG}/resources`, ME.token)).json());

const draftIn = async (draft: string): Promise<DraftView | undefined> =>
  (await current()).drafts.find((d) => d.id === draft);

const alarm = async (): Promise<void> => {
  expect(await runDurableObjectAlarm(env.ORG.getByName(ORG))).toBe(true);
};

const asked = async (): Promise<string> => {
  const draft = newDraft();
  expect((await ask(impact((await current()).month, draft))).status).toBe(201);
  return draft;
};

const written = async (): Promise<DraftView> => {
  const draft = await asked();
  await alarm();
  const view = await draftIn(draft);
  if (view === undefined) throw new Error("The draft is not in the view");
  return view;
};

const factsOf = (draft: string): Promise<DraftFacts> =>
  sql(ORG, (s) => {
    const row = s.exec<{ facts: string }>("SELECT facts FROM resource_drafts WHERE id = ?", draft).one();
    return DraftFactsSchema.parse(JSON.parse(row.facts) as unknown);
  });

const draftLines = async () => (await exportLedger(ORG)).events.filter((e) => e.type.startsWith("draft."));

const textLines = (text: string | null): string[] =>
  (text ?? "").split("\n").filter((line) => line.length > 20);

const failure = async (r: Response): Promise<{ status: number; code: string; message: string }> => {
  const body = await r.json<{ error: { code: string; message: string } }>();
  return { status: r.status, code: body.error.code, message: body.error.message };
};

const jobHost = (hub: OrgHub, state: DurableObjectState): DraftJobHost => ({
  env: { DRAFT_MODEL: "", AI },
  sql: state.storage.sql,
  apply: (command, actor) => hub.applyCommand(command, actor),
});

describe("the draft job with DRAFT_MODEL empty", () => {
  it("an impact post is the fixed template with the flag ai_off, and the ledger holds the hash only", async () => {
    const month = (await current()).month;
    const draft = newDraft();
    const r = await ask(impact(month, draft));
    expect(r.status).toBe(201);
    const writing = ResourcesViewSchema.parse(await r.json()).drafts.find((d) => d.id === draft);
    expect(writing).toMatchObject({ status: "writing", kind: "impact_post", month, text: null });
    await alarm();
    const ready = await draftIn(draft);
    expect(ready).toMatchObject({ status: "ready", source: "template", flag: "ai_off", reasons: [] });
    const text = ready?.text ?? "";
    expect(text).toContain("ComForce MKE");
    expect(ready?.textHash).toBe(sha256Hex(text));
    const lines = await draftLines();
    expect(lines.map((e) => e.type)).toEqual(["draft.asked", "draft.done"]);
    expect(lines.map((e) => e.actor)).toEqual([SYSTEM, SYSTEM]);
    expect(lines[0]?.data).toEqual({ draft, kind: "impact_post", month, resource: null, by: ME.member });
    expect(lines[1]?.data).toEqual({ draft, source: "template", flag: "ai_off", textHash: sha256Hex(text) });
    const ledger = JSON.stringify((await exportLedger(ORG)).events);
    for (const line of textLines(text)) {
      expect(ledger).not.toContain(line);
      expect(logs.join("\n")).not.toContain(line);
    }
  });
});

it("with the Google mirror on, only ledger lines leave the hub and none of them carries the draft text", async () => {
  const bodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    return Promise.resolve(new Response("{}"));
  });
  await hubWith({ GOOGLE_URL: "https://google.test/exec", GOOGLE_SECRET: "test-google-secret" });
  const ready = await written();
  await alarm();
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) {
    expect(JSON.parse(body)).toMatchObject({ kind: "ledger" });
    for (const line of textLines(ready.text)) expect(body).not.toContain(line);
  }
});

describe("the draft job with a model", () => {
  it("a reply that passes the guard is the AI text with the footer, after one call with the facts", async () => {
    const calls = await model(() => Promise.resolve({ response: { text: GOOD } }));
    const ready = await written();
    const facts = await factsOf(ready.id);
    expect(ready).toMatchObject({ status: "ready", source: "ai", flag: null, reasons: [] });
    expect(ready.text).toBe(`${GOOD}\n\n${facts.footer}`);
    expect(calls).toEqual([{ model: MODEL, input: drafterInput(facts) }]);
  });

  it("a reply with an invented number is stopped on each of 3 calls and the draft is the template", async () => {
    const calls = await model(() => Promise.resolve({ response: { text: INVENTED } }));
    const ready = await written();
    const flagged = { status: "ready", source: "template", flag: "guard_rejected", reasons: ["number"] };
    expect(ready).toMatchObject(flagged);
    expect(calls).toHaveLength(3);
    expect(ready.text).not.toContain(INVENTED);
  });

  it("a model that fails on every call gives the template with the flag ai_failed", async () => {
    const calls = await model(() => Promise.reject(new Error("model down")));
    const ready = await written();
    expect(ready).toMatchObject({ status: "ready", source: "template", flag: "ai_failed", reasons: [] });
    expect(calls).toHaveLength(3);
  });
});

describe("approving a draft", () => {
  it("approve needs a ready draft, writes draft.approved with the hash and the member, and works once", async () => {
    const draft = await asked();
    expect(await failure(await approve(draft))).toEqual({
      status: 409,
      code: "wrong_state",
      message: NOT_READY,
    });
    await alarm();
    const r = await approve(draft);
    expect(r.status).toBe(200);
    const view = ResourcesViewSchema.parse(await r.json()).drafts.find((d) => d.id === draft);
    expect(view).toMatchObject({ status: "approved", approvedAt: clock });
    expect(view?.approvedBy).toEqual({ member: ME.member, name: ORGANISER });
    const approved = (await draftLines()).filter((e) => e.type === "draft.approved");
    expect(approved.map((e) => e.data)).toEqual([
      { draft, textHash: sha256Hex(view?.text ?? ""), by: ME.member },
    ]);
    expect(await failure(await approve(draft))).toEqual({
      status: 409,
      code: "wrong_state",
      message: NOT_READY,
    });
    expect((await draftLines()).filter((e) => e.type === "draft.approved")).toHaveLength(1);
  });

  it("a draft that is not here gives 404", async () => {
    const missing = { status: 404, code: "not_found", message: "This draft is not here." };
    expect(await failure(await approve(newDraft()))).toEqual(missing);
  });
});

describe("asking for a draft", () => {
  it("the same ask twice gives one draft.asked line, and another ask with the same id gives 400", async () => {
    const body = impact((await current()).month);
    expect((await ask(body)).status).toBe(201);
    const again = await ask(body);
    expect(again.status).toBe(200);
    expect(ResourcesViewSchema.parse(await again.json()).drafts.map((d) => d.id)).toEqual([body.draft]);
    expect((await draftLines()).filter((e) => e.type === "draft.asked")).toHaveLength(1);
    const letter = { ...body, kind: "funder_letter", resource: "bader_preliminary" };
    const used = { status: 400, code: "invalid", message: "This draft id is already used." };
    expect(await failure(await ask(letter))).toEqual(used);
    expect((await current()).drafting.usedToday).toBe(1);
  });

  it("a letter names a catalog row, a post names none, and the month is the current one or a recent one", async () => {
    const month = (await current()).month;
    const letter = (resource: string | null) => ({
      draft: newDraft(),
      kind: "funder_letter",
      month,
      resource,
    });
    expect((await ask(letter(null))).status).toBe(400);
    expect((await ask({ ...impact(month), resource: "bader_preliminary" })).status).toBe(400);
    const unknown = { status: 404, code: "not_found", message: "This resource is not in the catalog." };
    expect(await failure(await ask(letter("no_such_fund")))).toEqual(unknown);
    const old = {
      status: 400,
      code: "invalid",
      message: "Pick the current month or a recent month with records.",
    };
    expect(await failure(await ask(impact(addMonths(month, -6))))).toEqual(old);
    const good = letter("bader_preliminary");
    expect((await ask(good)).status).toBe(201);
    const view = await draftIn(good.draft);
    expect(view).toMatchObject({ kind: "funder_letter", resource: "bader_preliminary", status: "writing" });
    expect(view?.facts.map((f) => f.key)).toContain("funder");
  });
});

describe("asks that the hub refuses", () => {
  it("a letter to a closed row, a people row or a goods row gives 400 and uses none of the day", async () => {
    const month = (await current()).month;
    const refused = { status: 400, code: "invalid", message: NO_LETTER };
    for (const resource of ["united_way_urgent_need", "every_org_sponsor", "taproot_plus"]) {
      const body = { draft: newDraft(), kind: "funder_letter", month, resource };
      expect(await failure(await ask(body)), resource).toEqual(refused);
    }
    expect((await current()).drafting.usedToday).toBe(0);
    expect(await draftLines()).toEqual([]);
  });

  it("a group name with a web address or a hidden mark gives 400 and writes no draft", async () => {
    const month = (await current()).month;
    for (const name of ["ComForce MKE, give at comforce.org", "Com\u200BForce MKE"]) {
      await sql(ORG, (s) => s.exec("UPDATE org SET name = ? WHERE id = 1", name));
      expect(await failure(await ask(impact(month))), name).toEqual({
        status: 400,
        code: "invalid",
        message: UNSAFE,
      });
    }
    expect((await current()).drafts).toEqual([]);
    expect(await draftLines()).toEqual([]);
  });
});

it("the 21st ask on one Chicago day gives 429, and a day later an ask works again", async () => {
  const month = (await current()).month;
  const ids: string[] = [];
  for (let n = 0; n < DRAFT_DAILY_CAP; n += 1) {
    const body = impact(month);
    ids.push(body.draft);
    expect((await ask(body)).status).toBe(201);
  }
  expect((await current()).drafts.map((d) => d.id)).toEqual(ids.toReversed());
  const capped = {
    status: 429,
    code: "rate_limited",
    message: "Vision writes at most 20 drafts a day. Try again tomorrow.",
  };
  expect(await failure(await ask(impact(month)))).toEqual(capped);
  expect((await current()).drafting).toEqual({ cap: DRAFT_DAILY_CAP, usedToday: DRAFT_DAILY_CAP });
  clock += 26 * HOUR;
  const later = await current();
  expect(later.drafting.usedToday).toBe(0);
  expect((await ask(impact(later.month))).status).toBe(201);
});

it("a demo clock jump of a day keeps the cap, which counts the real Chicago day", async () => {
  const jump = () => send(ORG, ME.token, { id: newId(), type: "clock.jump", minutes: 1440 });
  expect((await jump()).status).toBe(200);
  const month = (await current()).month;
  for (let n = 0; n < DRAFT_DAILY_CAP; n += 1) expect((await ask(impact(month))).status).toBe(201);
  expect((await jump()).status).toBe(200);
  const later = await current();
  expect(later.drafting.usedToday).toBe(DRAFT_DAILY_CAP);
  expect((await failure(await ask(impact(later.month)))).status).toBe(429);
});

it("a letter asked before a funder deadline carries the deadline fact of the catalog row", async () => {
  clock = Date.UTC(2027, 4, 1, 17, 0);
  const month = (await current()).month;
  const draft = newDraft();
  expect((await ask({ draft, kind: "funder_letter", month, resource: "bader_preliminary" })).status).toBe(
    201,
  );
  const deadline = (await draftIn(draft))?.facts.find((f) => f.key === "deadline");
  expect(deadline).toEqual({
    key: "deadline",
    label: "Next deadline on the funder page",
    text: "31 May 2027",
  });
});

describe("giving up on a draft", () => {
  it("giveUpDraft on a draft that is still writing gives the template with the flag ai_failed", async () => {
    const draft = await asked();
    await runInDurableObject(env.ORG.getByName(ORG), (hub, state) => {
      giveUpDraft(jobHost(hub, state), { id: 1, kind: DRAFT_KIND, payload: JSON.stringify({ draft }) });
    });
    const ready = await draftIn(draft);
    expect(ready).toMatchObject({ status: "ready", source: "template", flag: "ai_failed", reasons: [] });
    expect((await draftLines()).map((e) => e.type)).toEqual(["draft.asked", "draft.done"]);
  });

  it("a row with a bad payload or a finished draft changes nothing", async () => {
    const ready = await written();
    await runInDurableObject(env.ORG.getByName(ORG), (hub, state) => {
      giveUpDraft(jobHost(hub, state), { id: 1, kind: DRAFT_KIND, payload: JSON.stringify({ card: "c_1" }) });
      giveUpDraft(jobHost(hub, state), {
        id: 2,
        kind: DRAFT_KIND,
        payload: JSON.stringify({ draft: ready.id }),
      });
    });
    expect(await draftIn(ready.id)).toEqual(ready);
    expect((await draftLines()).map((e) => e.type)).toEqual(["draft.asked", "draft.done"]);
    expect(logs.some((line) => line.includes('"status":"bad_payload"'))).toBe(true);
  });
});
