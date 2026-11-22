import { runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { TemplatesSchema, type Actor, type SystemCommand } from "@vision/contracts";
import { emptyState } from "@vision/core";
import { describe, expect, it } from "vitest";
import templatesJson from "../../../data/synthetic/templates.json";
import { aiGiveUp, aiKind, aiOn, aiSender, type AiHost } from "../src/ai/registry.js";
import { eraseDue, nextForgetAt } from "../src/alarm.js";
import { submitFromForm } from "../src/doors.js";
import { drainOutbox, enqueueSorts, MAX_TRIES, type OutboxRow } from "../src/outbox.js";
import type { Env } from "../src/orghub.js";
import { residentMessages } from "../src/render.js";
import { DRAFT_KIND } from "../src/resources/kind.js";
import { Store } from "../src/store.js";
import { freshOrg, hubFetch, join, newCard, organiser, sql } from "./helpers.js";

const env = workerEnv as unknown as Env;
const BASE = "https://hub.test/api/v1/o";
const CARD = "c_5e2a9c41-8b7d-4f13-a6e0-3d9c1b7f2a84";
const NO_MODELS = { VOICE_MODEL: "", LINK_MODEL: "", TRANSLATE_MODEL: "", DRAFT_MODEL: "" };

type Applied = { command: SystemCommand; actor: Actor };

const fakeHost = (models: Partial<typeof NO_MODELS>, applied: Applied[]): AiHost => ({
  env: { ...NO_MODELS, ...models, AI: { run: () => Promise.reject(new Error("no model in tests")) } },
  sql: {} as SqlStorage,
  state: emptyState,
  now: () => 0,
  apply: (command, actor) => applied.push({ command, actor }),
});

const row = (kind: string, tries = 0): OutboxRow => ({
  id: 1,
  kind,
  payload: JSON.stringify({ card: CARD }),
  tries,
  next_at: 0,
  last_error: null,
});

describe("the off switch of each AI job", () => {
  it("hub tests run with every model var empty, so each job is off", async () => {
    const org = freshOrg();
    await organiser(org);
    const config = await runInDurableObject(env.ORG.getByName(org), (hub) => hub.config());
    expect(config.aiOn).toEqual({ voice: false, link: false, lang: false });
    expect(config.sorterOn).toBe(false);
  });

  it("a job is on when its model var holds a model id", () => {
    expect(aiOn({ ...NO_MODELS, LINK_MODEL: "@cf/baai/bge-m3" })).toEqual({
      voice: false,
      link: true,
      lang: false,
    });
  });

  it("an AI row whose model was switched off falls back to a person with the outcome off", async () => {
    const applied: Applied[] = [];
    await aiSender(fakeHost({}, applied))(row(aiKind("voice")));
    expect(applied).toEqual([
      {
        command: { type: "voice.result", card: CARD, outcome: "off", text: null },
        actor: { role: "system", ref: null },
      },
    ]);
  });
});

it("an ai effect waits in the outbox under its job kind with only the card id", async () => {
  const org = freshOrg();
  const rows = await sql(org, (s) => {
    enqueueSorts(s, [{ kind: "ai", job: "link", card: CARD }], 5);
    return s
      .exec<{ kind: string; card: string; payload: string }>("SELECT kind, card, payload FROM outbox")
      .toArray();
  });
  expect(rows).toEqual([{ kind: "ai.link", card: CARD, payload: JSON.stringify({ card: CARD }) }]);
});

it("after the third failed try the job falls back to a person with the outcome failed", async () => {
  const org = freshOrg();
  const gaveUp: OutboxRow[] = [];
  await sql(org, async (s) => {
    enqueueSorts(s, [{ kind: "ai", job: "lang", card: CARD }], 0);
    for (let n = 0; n < MAX_TRIES; n += 1) {
      await drainOutbox(
        s,
        10 ** 12 + n * 10 ** 9,
        () => Promise.reject(new Error("model down")),
        (r) => gaveUp.push(r),
      );
      expect(gaveUp.length).toBe(n === MAX_TRIES - 1 ? 1 : 0);
    }
  });
  const applied: Applied[] = [];
  const host = fakeHost({}, applied);
  const [first] = gaveUp;
  if (first !== undefined) aiGiveUp(host)(first);
  expect(applied.map((a) => a.command)).toEqual([
    { type: "lang.result", card: CARD, outcome: "failed", text: null },
  ]);
});

it("the give-up hook leaves rows that are not AI jobs alone", () => {
  const applied: Applied[] = [];
  aiGiveUp(fakeHost({}, applied))(row("mail", MAX_TRIES));
  expect(applied).toEqual([]);
});

it("a draft effect waits in the outbox under the draft kind with only the draft id", async () => {
  const draft = "d_0b7e5a2c-4f1d-4c3a-9e8b-6a5d4c3b2a19";
  const rows = await sql(freshOrg(), (s) => {
    enqueueSorts(s, [{ kind: "draft", draft }], 5);
    return s
      .exec<{ kind: string; card: string | null; payload: string }>("SELECT kind, card, payload FROM outbox")
      .toArray();
  });
  expect(rows).toEqual([{ kind: DRAFT_KIND, card: null, payload: JSON.stringify({ draft }) }]);
});

it("the give-up hook hands a draft row to the draft job, which leaves a row with a bad payload alone", () => {
  const applied: Applied[] = [];
  expect(() => {
    aiGiveUp(fakeHost({}, applied))(row(DRAFT_KIND, MAX_TRIES));
  }).not.toThrow();
  expect(applied).toEqual([]);
});

describe("the vault for the AI jobs", () => {
  it("voicemail audio has a forget date and the alarm erases it", async () => {
    const org = freshOrg();
    const result = await sql(org, (s) => {
      s.exec(
        "INSERT INTO vault_audio (card, part, mime, bytes, at, forget_at) VALUES (?, 0, 'audio/mpeg', ?, 1, 50)",
        CARD,
        new Uint8Array([1, 2, 3]),
      );
      const next = nextForgetAt(s);
      const erased = eraseDue(s, 60);
      const left = s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM vault_audio").one().n;
      return { next, erased, left };
    });
    expect(result).toEqual({ next: 50, erased: { due: 60, erased: 1 }, left: 0 });
  });

  it("the vault reader never hands link vectors to a view", async () => {
    const org = freshOrg();
    const kinds = await sql(org, (s) => {
      for (const kind of ["message_in", "link_vector"])
        s.exec(
          "INSERT INTO vault (card, job, kind, from_party, body, at, forget_at) VALUES (?, NULL, ?, 'system', '[0.1]', 1, NULL)",
          CARD,
          kind,
        );
      return new Store(s)
        .vaultReader()
        .texts(CARD)
        .map((t) => t.textKind);
    });
    expect(kinds).toEqual(["message_in"]);
  });
});

const receipt = {
  kind: "message" as const,
  to: "resident" as const,
  card: CARD,
  job: null,
  partner: null,
  template: "receipt" as const,
  slots: { orgName: "ComForce demo", routeCode: "SNOW-16-001", needLabel: "Snow", promiseAt: "0" },
};
const base = TemplatesSchema.parse(templatesJson);

it("a Spanish card gets the Spanish template when one exists", () => {
  const es = {
    receipt: {
      text: "Codigo {routeCode} {orgName} {needLabel} {promiseAt} {trackingLink} 90",
      slots: base.receipt.slots,
    },
  };
  const [message] = residentMessages([receipt], { ...base, es }, () => "es");
  expect(message).toMatchObject({
    lang: "es",
    text: expect.stringContaining("Codigo SNOW-16-001") as unknown,
  });
});

it("a Spanish card with no Spanish template gets the English one", () => {
  const [message] = residentMessages([receipt], { ...base, es: {} }, () => "es");
  expect(message?.text).toContain("has your request");
  expect(message?.lang).toBe("en");
});

it("the request form passes the chosen language to the card", () => {
  const form = {
    firstName: "Rosa",
    contactKind: "email" as const,
    contact: "rosa@example.test",
    zip: "53216",
    message: "Necesito ayuda",
    address: "",
    safeContact: true,
    website: "" as const,
  };
  expect(submitFromForm({ ...form, lang: "es" }, newCard()).lang).toBe("es");
  expect("lang" in submitFromForm(form, newCard())).toBe(false);
});

describe("the voicemail routes check who calls", () => {
  const call = (path: string, init: RequestInit = {}) => hubFetch(`${BASE}/${path}`, init);

  it("the phone door needs the door secret", async () => {
    const org = freshOrg();
    await organiser(org);
    const r = await call(`${org}/doors/voice`, { method: "POST", headers: { "X-Door-Secret": "wrong" } });
    expect(r.status).toBe(401);
  });

  it("the desk upload and the audio need a desk session", async () => {
    const org = freshOrg();
    const volunteer = await join(org, "m_v01");
    expect((await call(`${org}/voicemails`, { method: "POST" })).status).toBe(401);
    const asVolunteer = { headers: { Authorization: `Bearer ${volunteer}` } };
    expect((await call(`${org}/voicemails`, { method: "POST", ...asVolunteer })).status).toBe(403);
    expect((await call(`${org}/audio/${CARD}`, asVolunteer)).status).toBe(403);
  });
});
