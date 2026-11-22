import { runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { TemplatesSchema, TrackingSchema, type Decision } from "@vision/contracts";
import templatesJson from "../../../data/synthetic/templates.json";
import type { Env, OrgHub } from "../src/orghub.js";
import { renderTemplate } from "../src/render.js";
import {
  confirmCmd,
  errorCode,
  exportLedger,
  freshOrg,
  hubFetch,
  jobOfCard,
  join,
  ledgerLength,
  loadPlaybook,
  newId,
  organiser,
  send,
  sql,
} from "./helpers.js";

const TEMPLATES = TemplatesSchema.parse(templatesJson);
const API = "https://hub.test/api/v1/o";

const validForm = {
  firstName: "Avery",
  contactKind: "email",
  contact: "avery@example.test",
  zip: "53216",
  message: "Snow on my walk",
  address: "1 Test St",
  safeContact: true,
  website: "",
};

let ORG = freshOrg();
beforeEach(async () => {
  ORG = freshOrg();
  await organiser(ORG);
});

const postForm = (org: string, form: unknown, ip = "198.51.100.7"): Promise<Response> =>
  hubFetch(`${API}/${org}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(form),
  });

const trackingOf = async (r: Response): Promise<string> => (await r.json<{ tracking: string }>()).tracking;

const getTracking = (tracking: string): Promise<Response> => hubFetch(`${API}${tracking}`);

const trackingCommand = (tracking: string, command: Record<string, unknown>): Promise<Response> =>
  hubFetch(`${API}${tracking}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: newId(), ...command }),
  });

const lastCard = async (org: string): Promise<string> => {
  const card = (await exportLedger(org)).events.filter((e) => e.type === "card.received").at(-1)?.card;
  if (card == null) throw new Error("No card was received");
  return card;
};

type Tracked = { tracking: string; card: string; job: string };

const newTracking = async (ip: string): Promise<Tracked> => {
  await loadPlaybook(ORG);
  const tracking = await trackingOf(await postForm(ORG, validForm, ip));
  const card = await lastCard(ORG);
  await send(ORG, await join(ORG, "m_d01"), confirmCmd(card));
  return { tracking, card, job: await jobOfCard(ORG, card) };
};

it("a valid form returns a tracking link that opens the tracking view", async () => {
  const r = await postForm(ORG, validForm);
  expect(r.status).toBe(201);
  const tracking = await trackingOf(r);
  expect(tracking).toMatch(new RegExp(`^/${ORG}/t/[A-Za-z0-9_-]{43}$`));
  const view = await getTracking(tracking);
  expect(view.status).toBe(200);
  expect(TrackingSchema.parse(await view.json()).closed).toBe(false);
});

it("the sixth form from one address in 10 minutes gets 429", async () => {
  for (let i = 0; i < 5; i++) expect((await postForm(ORG, validForm, "203.0.113.9")).status).toBe(201);
  expect((await postForm(ORG, validForm, "203.0.113.9")).status).toBe(429);
  expect((await postForm(ORG, validForm, "203.0.113.10")).status).toBe(201);
});

it("a filled trap field and a 2001 character message are refused", async () => {
  expect((await postForm(ORG, { ...validForm, website: "x" })).status).toBe(400);
  expect((await postForm(ORG, { ...validForm, message: "a".repeat(2001) })).status).toBe(400);
  expect((await exportLedger(ORG)).events).toHaveLength(0);
});

it("a form for an organisation with no members is refused", async () => {
  expect((await postForm(freshOrg(), validForm)).status).toBe(404);
});

it("a tracking link cannot answer for another card", async () => {
  const a = await newTracking("198.51.100.21");
  const b = await newTracking("198.51.100.22");
  const r = await trackingCommand(a.tracking, { type: "checkback.answer", job: b.job, answer: 1 });
  expect(r.status).toBe(404);
});

it("a tracking link sends only the answers of the resident", async () => {
  const a = await newTracking("198.51.100.23");
  expect(
    (await trackingCommand(a.tracking, { type: "job.withdraw", job: a.job, reason: "cancelled" })).status,
  ).toBe(403);
});

type Committer = {
  transaction<T>(run: () => T): T;
  commit(decision: Extract<Decision, { ok: true }>, fromParty: string, at: number): number;
};

const closeJob = (org: string, card: string, job: string): Promise<void> =>
  runInDurableObject((workerEnv as unknown as Env).ORG.getByName(org), (hub: OrgHub) => {
    const h = hub as unknown as Committer;
    const closed = {
      card,
      job,
      actor: { role: "system", ref: null },
      type: "job.closed",
      data: { result: "helped", reason: null },
    } as const;
    h.transaction(() => h.commit({ ok: true, events: [closed], effects: [] }, "system", hub.now()));
  });

it("a tracking link cannot replay the stored result of a member command", async () => {
  const a = await newTracking("198.51.100.25");
  const desk = await join(ORG, "m_d01");
  const id = newId();
  const first = await send(ORG, desk, { id, type: "shift.take" });
  expect(first.status).toBe(200);
  const memberBody = JSON.stringify(await first.json());
  const r = await trackingCommand(a.tracking, { id, type: "checkback.answer", job: a.job, answer: 1 });
  expect(r.status).toBe(400);
  expect(JSON.stringify(await r.json())).not.toBe(memberBody);
});

it("a tracking link refuses an answer once the job is closed", async () => {
  const a = await newTracking("198.51.100.26");
  await closeJob(ORG, a.card, a.job);
  const r = await trackingCommand(a.tracking, { type: "checkback.answer", job: a.job, answer: 1 });
  expect(r.status).toBe(409);
  expect(await errorCode(r)).toBe("wrong_state");
  expect((await getTracking(a.tracking)).status).toBe(200);
});

const askedCheckback = async (ip: string): Promise<Tracked> => {
  const a = await newTracking(ip);
  const volunteer = await join(ORG, "m_v01");
  await send(ORG, await join(ORG, "m_d01"), { id: newId(), type: "job.approve", job: a.job });
  for (const command of [
    { type: "offer.accept", job: a.job },
    { type: "job.on_my_way", job: a.job },
    { type: "job.there", job: a.job },
    { type: "job.done", job: a.job, outcome: "done" },
  ])
    expect((await send(ORG, volunteer, { id: newId(), ...command })).status).toBe(200);
  await send(ORG, await organiser(ORG), { id: newId(), type: "clock.jump", minutes: 4320 });
  return a;
};

it("a resent check-back answer that closed the job returns the first result", async () => {
  const a = await askedCheckback("198.51.100.27");
  const answer = { id: newId(), type: "checkback.answer", job: a.job, answer: 1 };
  const first = await trackingCommand(a.tracking, answer);
  expect(first.status).toBe(200);
  const firstBody = JSON.stringify(await first.json());
  const length = await ledgerLength(ORG);
  const again = await trackingCommand(a.tracking, answer);
  expect(again.status).toBe(200);
  expect(JSON.stringify(await again.json())).toBe(firstBody);
  expect(await ledgerLength(ORG)).toBe(length);
});

it("a closed job opened by its tracking link shows no step, ask or message", async () => {
  const a = await newTracking("198.51.100.28");
  await closeJob(ORG, a.card, a.job);
  const tracking = TrackingSchema.parse(await (await getTracking(a.tracking)).json());
  expect(tracking).toMatchObject({ closed: true, messages: [] });
  expect(tracking.forgetAt).not.toBeNull();
  expect(JSON.stringify(tracking)).not.toMatch(/SNOW-16|Your code/);
});

it("an unknown tracking link is not found and shows no detail", async () => {
  const r = await getTracking(`/${ORG}/t/${"A".repeat(43)}`);
  expect(r.status).toBe(404);
  expect(await r.text()).not.toMatch(/Avery|Test St/);
});

it("the form door keeps the name, address and message out of the ledger", async () => {
  expect((await postForm(ORG, validForm)).status).toBe(201);
  const ledger = await exportLedger(ORG);
  expect(ledger.events.map((e) => e.type)).toContain("card.received");
  expect(JSON.stringify(ledger)).not.toMatch(/Avery|Test St|Snow on my walk|avery@example/);
});

it("the receipt to a resident becomes a message on the tracking page", async () => {
  const a = await newTracking("198.51.100.24");
  const rows = await sql(ORG, (s) =>
    s
      .exec<{ body: string; from_party: string }>(
        "SELECT body, from_party FROM vault WHERE card = ? AND kind = 'message_out'",
        a.card,
      )
      .toArray(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.from_party).toBe("system");
  expect(rows[0]?.body).toMatch(/Your code is SNOW-16-\d{3}\./);
  expect(rows[0]?.body).toMatch(/by [A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)\./);
  expect(rows[0]?.body).not.toMatch(/[{}]/);
});

describe("renderTemplate", () => {
  it("fills every slot of a template", () => {
    const text = renderTemplate(
      "checkback",
      { needLabel: "Snow shovelling", trackingLink: "this page" },
      TEMPLATES,
    );
    expect(text).toBe(
      "Did they help with Snow shovelling? Answer 1 for yes, 2 for partly, 3 for no: this page. Your details are deleted 90 days after the request closes.",
    );
  });
  it("refuses a template with a missing slot", () => {
    expect(() => renderTemplate("checkback", { needLabel: "Snow shovelling" }, TEMPLATES)).toThrow(
      /trackingLink/,
    );
  });
});
