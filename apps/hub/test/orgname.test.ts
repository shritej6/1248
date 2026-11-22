import { runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import {
  DeskBoardSchema,
  OrgAboutSchema,
  OrgViewSchema,
  PartnerCardSchema,
  TemplatesSchema,
  TrackingSchema,
  type Command,
  type Effect,
} from "@vision/contracts";
import { decide, type HubState } from "@vision/core";
import { expect, it } from "vitest";
import configJson from "../../../data/synthetic/config.json";
import templatesJson from "../../../data/synthetic/templates.json";
import { seedOrg } from "../scripts/seed.js";
import type { Env, OrgHub } from "../src/orghub.js";
import { renderTemplate } from "../src/render.js";
import {
  freshOrg,
  get,
  hubFetch,
  jobOfCard,
  join,
  newId,
  organiser,
  post,
  send,
  sql,
  submitForm,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const TEMPLATES = TemplatesSchema.parse(templatesJson);
const ORG_NAME = configJson.orgName;

const seeded = async (): Promise<string> => {
  const org = freshOrg();
  await seedOrg({ fetcher: hubFetch, base: "https://hub.test", org, bootstrapCode: env.BOOTSTRAP_CODE });
  return org;
};

const confirmed = async (org: string, need: string, message: string): Promise<string> => {
  const card = await submitForm(org, { firstName: "Avery", address: null, message });
  const desk = await join(org, "m_d01");
  await send(org, desk, { id: newId(), type: "card.confirm", card, need, urgency: "low", division: null });
  return card;
};

const sentTo = (org: string, card: string): Promise<string[]> =>
  sql(org, (s) =>
    s
      .exec<{ body: string }>(
        "SELECT body FROM vault WHERE card = ? AND kind = 'message_out' ORDER BY id",
        card,
      )
      .toArray()
      .map((r) => r.body),
  );

it("the hub keeps the organisation name the seed gives it", async () => {
  const org = await seeded();
  const name = await runInDurableObject(env.ORG.getByName(org), (hub: OrgHub) => hub.config().orgName);
  expect(name).toBe(ORG_NAME);
});

it("the first message to the resident names the organisation", async () => {
  const org = await seeded();
  const card = await confirmed(org, "snow", "Snow on my walk");
  const [receipt] = await sentTo(org, card);
  expect(receipt).toMatch(new RegExp(`^${ORG_NAME} has your request for `));
  expect(receipt).not.toContain(org);
});

it("the consent ask and the partner ask name the organisation", async () => {
  const org = await seeded();
  const card = await confirmed(org, "food", "We have no food this week");
  const job = await jobOfCard(org, card);
  await send(org, await join(org, "m_d01"), { id: newId(), type: "job.approve", job });
  const consent = (await sentTo(org, card)).find((t) => t.includes("May we share"));
  expect(consent).toMatch(new RegExp(`^${ORG_NAME} can ask `));
  const yes: Command = { id: newId(), type: "consent.answer", job, answer: "yes" };
  const effects = await runInDurableObject(env.ORG.getByName(org), (hub: OrgHub) => {
    const state = (hub as unknown as { state: HubState }).state;
    const d = decide(state, yes, { role: "resident", ref: card }, hub.decideContext(hub.now()));
    return d.ok ? d.effects : [];
  });
  const ask = effects.find(
    (e): e is Extract<Effect, { kind: "message" }> => e.kind === "message" && e.template === "partner_ask",
  );
  expect(ask).toBeDefined();
  const text = renderTemplate("partner_ask", { partnerLink: "link", ...(ask?.slots ?? {}) }, TEMPLATES);
  expect(text).toMatch(new RegExp(`^${ORG_NAME} asks for help with `));
});

it("a hub bootstrapped without a name falls back to its id", async () => {
  const org = freshOrg();
  await post(`${org}/bootstrap`, {
    code: env.BOOTSTRAP_CODE,
    name: "Quinn (test)",
    contact: "q@example.test",
  });
  const name = await runInDurableObject(env.ORG.getByName(org), (hub: OrgHub) => hub.config().orgName);
  expect(name).toBe(org);
});

it("the bootstrap refuses an organisation name that is too long", async () => {
  const org = freshOrg();
  const body = { code: env.BOOTSTRAP_CODE, name: "Quinn (test)", contact: "q@example.test" };
  const r = await post(`${org}/bootstrap`, { ...body, orgName: "x".repeat(81) });
  expect(r.status).toBe(400);
});

const API = "https://hub.test/api/v1/o";

const partnerLink = async (org: string): Promise<{ desk: string; link: string }> => {
  const card = await confirmed(org, "food", "We have no food this week");
  const job = await jobOfCard(org, card);
  const desk = await join(org, "m_d01");
  await send(org, desk, { id: newId(), type: "job.approve", job });
  await runInDurableObject(env.ORG.getByName(org), (hub: OrgHub) =>
    hub.applyCommand(
      { id: newId(), type: "consent.answer", job, answer: "yes" },
      { role: "resident", ref: card },
    ),
  );
  const board = DeskBoardSchema.parse(await (await get(`${org}/views/desk`, desk)).json());
  const link = board.jobs.find((j) => j.job === job)?.partnerLink ?? null;
  if (link === null) throw new Error("The desk view has no partner link for the job");
  return { desk, link };
};

it("the public about door gives the organisation name for the request form", async () => {
  const org = await seeded();
  const r = await hubFetch(`${API}/${org}/about`);
  expect(r.status).toBe(200);
  expect(OrgAboutSchema.parse(await r.json())).toEqual({ orgName: ORG_NAME });
  const bare = freshOrg();
  await post(`${bare}/bootstrap`, {
    code: env.BOOTSTRAP_CODE,
    name: "Quinn (test)",
    contact: "q@example.test",
  });
  expect(OrgAboutSchema.parse(await (await hubFetch(`${API}/${bare}/about`)).json())).toEqual({
    orgName: bare,
  });
});

it("the desk, organiser, partner and tracking views name the organisation", async () => {
  const org = await seeded();
  const { desk, link } = await partnerLink(org);
  expect(DeskBoardSchema.parse(await (await get(`${org}/views/desk`, desk)).json()).orgName).toBe(ORG_NAME);
  const orgView = OrgViewSchema.parse(await (await get(`${org}/views/org`, await organiser(org))).json());
  expect(orgView.orgName).toBe(ORG_NAME);
  const card = PartnerCardSchema.parse(await (await hubFetch(`${API}${link}`)).json());
  expect(card.orgName).toBe(ORG_NAME);
  const form = {
    firstName: "Avery",
    contactKind: "email",
    contact: "avery@example.test",
    zip: "53216",
    message: "Snow on my walk",
    address: "1 Test St",
    safeContact: true,
    website: "",
  };
  const posted = await hubFetch(`${API}/${org}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.40" },
    body: JSON.stringify(form),
  });
  const { tracking } = await posted.json<{ tracking: string }>();
  const view = TrackingSchema.parse(await (await hubFetch(`${API}${tracking}`)).json());
  expect(view.orgName).toBe(ORG_NAME);
});
