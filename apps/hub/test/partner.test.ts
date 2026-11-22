import { runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { DeskBoardSchema, PartnerCardSchema, type PartnerCard } from "@vision/contracts";
import { beforeEach, expect, it } from "vitest";
import partnersJson from "../../../data/synthetic/partners.json";
import type { Env, OrgHub } from "../src/orghub.js";
import {
  errorCode,
  freshOrg,
  get,
  hubFetch,
  jobOfCard,
  join,
  loadPlaybook,
  newId,
  send,
  sql,
  submitForm,
} from "./helpers.js";

const API = "https://hub.test/api/v1/o";
const PANTRY = partnersJson[0];
const env = workerEnv as unknown as Env;

let ORG = freshOrg();
beforeEach(() => {
  ORG = freshOrg();
});

const addPartners = (org: string): Promise<void> =>
  sql(org, (s) => {
    for (const p of partnersJson)
      s.exec(
        "INSERT OR IGNORE INTO partners (id, name, contact) VALUES (?, ?, ?)",
        p.id,
        p.name,
        "p@example.test",
      );
  });

const foodJob = async (org: string, desk: string, firstName: string): Promise<string> => {
  const card = await submitForm(org, { firstName, address: null, message: "We have no food this week" });
  await send(org, desk, {
    id: newId(),
    type: "card.confirm",
    card,
    need: "food",
    urgency: "low",
    division: null,
  });
  const job = await jobOfCard(org, card);
  await send(org, desk, { id: newId(), type: "job.approve", job });
  await runInDurableObject(env.ORG.getByName(org), (hub: OrgHub) =>
    hub.applyCommand(
      { id: newId(), type: "consent.answer", job, answer: "yes" },
      { role: "resident", ref: card },
    ),
  );
  return job;
};

const deskLink = async (org: string, desk: string, job: string): Promise<string> => {
  const board = DeskBoardSchema.parse(await (await get(`${org}/views/desk`, desk)).json());
  const link = board.jobs.find((j) => j.job === job)?.partnerLink ?? null;
  if (link === null) throw new Error("The desk view has no partner link for the job");
  return link;
};

const partnerAskedTwice = async () => {
  const desk = await join(ORG, "m_d01");
  await loadPlaybook(ORG);
  await addPartners(ORG);
  const job = await foodJob(ORG, desk, "Avery");
  const otherJob = await foodJob(ORG, desk, "Rowan");
  return { desk, job, otherJob, link: await deskLink(ORG, desk, job) };
};

const partnerCommand = (link: string, command: Record<string, unknown>): Promise<Response> =>
  hubFetch(`${API}${link}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: newId(), ...command }),
  });

const partnerCard = async (link: string): Promise<PartnerCard> =>
  PartnerCardSchema.parse(await (await hubFetch(`${API}${link}`)).json());

it("a partner link answers only for its own job", async () => {
  const { link, otherJob } = await partnerAskedTwice();
  expect((await partnerCommand(link, { type: "ask.answer", job: otherJob, answer: "yes" })).status).toBe(404);
});

it("the desk view shows a partner link that opens the ask for that job only", async () => {
  const { link, job } = await partnerAskedTwice();
  expect(link).toMatch(new RegExp(`^/${ORG}/p/[A-Za-z0-9_-]{43}$`));
  const card = await partnerCard(link);
  expect(card.partner).toEqual({ id: PANTRY?.id, name: PANTRY?.name });
  expect(card.state).toBe("ask");
  expect(card.ask?.job).toBe(job);
  expect(JSON.stringify(card)).not.toContain("Avery");
});

it("the partner says yes, accepts the promise, sees the note and sends GOT IT", async () => {
  const { link, job } = await partnerAskedTwice();
  expect((await partnerCommand(link, { type: "ask.answer", job, answer: "yes" })).status).toBe(200);
  expect((await partnerCard(link)).state).toBe("promise");
  expect((await partnerCommand(link, { type: "promise.accept" })).status).toBe(200);
  const note = await partnerCard(link);
  expect(note.state).toBe("note");
  expect(note.note?.firstName).toBe("Avery");
  const gotIt = { type: "handover.got_it", job, date: "2026-11-22", contactName: "Jordan (test)" };
  expect((await partnerCommand(link, gotIt)).status).toBe(200);
});

it("a partner link refuses commands that are not for partners", async () => {
  const { link, job } = await partnerAskedTwice();
  const r = await partnerCommand(link, { type: "offer.accept", job });
  expect(r.status).toBe(403);
  expect(await errorCode(r)).toBe("forbidden");
});

it("an unknown partner link gives 404 and never a card", async () => {
  await join(ORG, "m_d01");
  const r = await hubFetch(`${API}/${ORG}/p/${"A".repeat(43)}`);
  expect(r.status).toBe(404);
});

it("the partner card shows the route code and the close date of the open step", async () => {
  const { link } = await partnerAskedTwice();
  const card = await partnerCard(link);
  expect(card.routeCode).toMatch(/^FOOD-\d{2}-\d{3}$/);
  expect(card.closesAt).toBe(card.ask?.deadline);
});

it("a partner reason goes to the vault of the card and never to the ledger", async () => {
  const { link, job } = await partnerAskedTwice();
  const reason = "Our pantry is closed for the holiday";
  const answer = { type: "ask.answer", job, answer: "no", reason };
  expect((await partnerCommand(link, answer)).status).toBe(200);
  const stored = await sql(ORG, (s) => ({
    vault: s
      .exec<{ job: string }>("SELECT job FROM vault WHERE kind = 'partner_reason' AND body = ?", reason)
      .toArray(),
    ledger: s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE data LIKE '%holiday%'").one().n,
  }));
  expect(stored.vault).toEqual([{ job }]);
  expect(stored.ledger).toBe(0);
});

it("the desk sees the partner reason and the time to ask again", async () => {
  const { link, job, otherJob, desk } = await partnerAskedTwice();
  const reason = "Our pantry is closed for the holiday";
  expect((await partnerCommand(link, { type: "ask.answer", job, answer: "no", reason })).status).toBe(200);
  const otherLink = await deskLink(ORG, desk, otherJob);
  const waitUntil = Date.now() + 86_400_000;
  const wait = { type: "ask.answer", job: otherJob, answer: "wait", waitUntil };
  expect((await partnerCommand(otherLink, wait)).status).toBe(200);
  const board = DeskBoardSchema.parse(await (await get(`${ORG}/views/desk`, desk)).json());
  const answerOf = (id: string) => board.jobs.find((j) => j.job === id)?.partnerAnswer;
  expect(answerOf(job)).toEqual({ partnerName: PANTRY?.name, answer: "no", reason, waitUntil: null });
  expect(answerOf(otherJob)).toMatchObject({ answer: "wait", reason: null, waitUntil });
});
