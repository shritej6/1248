import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { TemplatesSchema } from "@vision/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import templatesJson from "../../../data/synthetic/templates.json";
import { langJob } from "../src/ai/lang.js";
import { cardForMessage } from "../src/doors.js";
import type { Env } from "../src/orghub.js";
import { formatMoment, mailWords, renderTemplate, residentMessages } from "../src/render.js";
import {
  confirmCmd,
  exportLedger,
  freshOrg,
  hubFetch,
  jobOfCard,
  join,
  loadPlaybook,
  newId,
  organiser,
  send,
  sql,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const TEMPLATES = TemplatesSchema.parse(templatesJson);
const FUTURE = 365 * 24 * 60 * 60_000;
const HOUR = 60 * 60_000;
const MODEL = "@cf/test/translate";
const API = "https://hub.test/api/v1/o";
const SPANISH =
  "Buenas tardes. Tengo setenta y seis años y no puedo palear la nieve de mi banqueta en el 53216.";
const ENGLISH = "Snow on my walk in 53216 and I cannot get out of the house.";
const TRANSLATED = "Good afternoon. I am seventy six and I cannot shovel the snow on my walk.";

let ORG = freshOrg();
let clock = 0;
const logs: string[] = [];

beforeEach(async () => {
  ORG = freshOrg();
  clock = Date.now() + FUTURE;
  logs.length = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("{}")));
  await organiser(ORG);
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Calls = { model: string; input: unknown }[];

const hubWith = (vars: Partial<Env>): Promise<void> =>
  runInDurableObject(env.ORG.getByName(ORG), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, vars);
  });

const translator = async (reply: () => Promise<unknown>): Promise<Calls> => {
  const calls: Calls = [];
  const run = (model: string, input: unknown): Promise<unknown> => {
    calls.push({ model, input });
    return reply();
  };
  await hubWith({ TRANSLATE_MODEL: MODEL, AI: { run } });
  return calls;
};

const mailCard = async (message = SPANISH): Promise<string> => {
  const messageId = `es-${crypto.randomUUID()}`;
  const r = await hubFetch(`${API}/${ORG}/doors/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Door-Secret": env.DOOR_SECRET ?? "" },
    body: JSON.stringify({
      messageId,
      fromName: "Carmen Test",
      fromAddress: "carmen@example.test",
      subject: "",
      text: message,
    }),
  });
  expect(r.status).toBe(201);
  return cardForMessage(messageId);
};

type VaultRow = { kind: string; body: string; forget_at: number | null };

const vaultOf = (card: string): Promise<VaultRow[]> =>
  sql(ORG, (s) =>
    s.exec<VaultRow>("SELECT kind, body, forget_at FROM vault WHERE card = ? ORDER BY id", card).toArray(),
  );

const mailsOf = (card: string): Promise<{ to: string; subject: string; body: string }[]> =>
  sql(ORG, (s) =>
    s
      .exec<{ payload: string }>("SELECT payload FROM outbox WHERE kind = 'mail' AND card = ?", card)
      .toArray()
      .map((row) => JSON.parse(row.payload) as { to: string; subject: string; body: string }),
  );

const ledgerText = async (): Promise<string> => JSON.stringify((await exportLedger(ORG)).events);

const alarm = async (): Promise<void> => {
  await runDurableObjectAlarm(env.ORG.getByName(ORG));
  clock += HOUR;
};

const confirmed = async (card: string): Promise<string> => {
  await loadPlaybook(ORG);
  expect((await send(ORG, await join(ORG, "m_d01"), confirmCmd(card))).status).toBe(200);
  return jobOfCard(ORG, card);
};

const doneJob = async (job: string): Promise<void> => {
  const desk = await join(ORG, "m_d01");
  const volunteer = await join(ORG, "m_v01");
  expect((await send(ORG, desk, { id: newId(), type: "job.approve", job })).status).toBe(200);
  for (const command of [
    { type: "offer.accept", job },
    { type: "job.on_my_way", job },
    { type: "job.there", job },
    { type: "job.done", job, outcome: "done" },
  ])
    expect((await send(ORG, volunteer, { id: newId(), ...command })).status).toBe(200);
  const jump = { id: newId(), type: "clock.jump", minutes: 4320 };
  expect((await send(ORG, await organiser(ORG), jump)).status).toBe(200);
};

const outsByKind = async (card: string): Promise<string[]> =>
  (await vaultOf(card)).filter((row) => row.kind === "message_out").map((row) => row.body);

describe("Spanish resident messages", () => {
  it("a Spanish mail card gets the Spanish receipt in the vault and in mail, with the Spanish words", async () => {
    await hubWith({ GOOGLE_URL: "https://google.test/exec", GOOGLE_SECRET: "test-google-secret" });
    const card = await mailCard();
    await confirmed(card);
    const [receipt] = await outsByKind(card);
    expect(receipt).toContain(" recibió su solicitud de ayuda: Snow");
    expect(receipt).toMatch(/Su código es SNOW-16-\d{3}\./u);
    expect(receipt).toContain("esta página");
    expect(receipt).toContain("llame al 911");
    expect(receipt).toContain("90 días");
    expect(receipt).toMatch(/de 20\d\d, \d{1,2}:\d\d (a|p)\.m\./u);
    const [mail] = await mailsOf(card);
    expect(mail?.to).toBe("carmen@example.test");
    expect(mail?.subject).toBe("Sobre su solicitud");
    expect(mail?.body).toContain("Su página de seguimiento: http");
    expect(mail?.body).not.toContain("Your tracking page");
  });

  it("a Spanish card gets the Spanish check-back after the job is done", async () => {
    const card = await mailCard();
    await doneJob(await confirmed(card));
    const outs = await outsByKind(card);
    expect(outs.some((text) => text.startsWith("¿Le ayudaron con"))).toBe(true);
    expect(outs.some((text) => text.startsWith("Did they help"))).toBe(false);
  });

  it("an English mail card keeps the English receipt and subject", async () => {
    await hubWith({ GOOGLE_URL: "https://google.test/exec", GOOGLE_SECRET: "test-google-secret" });
    const card = await mailCard(ENGLISH);
    await confirmed(card);
    const [receipt] = await outsByKind(card);
    expect(receipt).toContain("has your request for");
    expect((await mailsOf(card))[0]?.subject).toBe("About your request");
  });
});

const residentNote = {
  kind: "message" as const,
  to: "resident" as const,
  card: "c_5e2a9c41-8b7d-4f13-a6e0-3d9c1b7f2a84",
  job: null,
  partner: null,
  slots: { needLabel: "Snow" },
};

describe("Spanish templates", () => {
  it("a template with no Spanish text falls back to English", () => {
    const [unmet] = residentMessages([{ ...residentNote, template: "unmet" }], TEMPLATES, () => "es");
    expect(unmet?.text).toContain("We could not find help for Snow yet");
    expect(unmet?.text).toContain("Follow it here: this page.");
    expect(unmet?.lang).toBe("en");
    expect(TEMPLATES.es?.unmet).toBeUndefined();
  });

  it("the Spanish receipt and check-back are human-written and carry the 90 day line", () => {
    expect(Object.keys(TEMPLATES.es ?? {}).sort()).toEqual(["checkback", "receipt"]);
    const text = renderTemplate(
      "checkback",
      { needLabel: "Snow", trackingLink: "esta página" },
      TEMPLATES,
      "es",
    );
    expect(text).toBe(
      "¿Le ayudaron con Snow? Responda 1 para sí, 2 para en parte o 3 para no: esta página. Sus datos se borran 90 días después de que se cierre la solicitud.",
    );
  });
});

describe("Spanish words in mail", () => {
  it("Spanish times use the Chicago zone and the mail words are Spanish", () => {
    const ms = Date.UTC(2026, 10, 22, 15, 0);
    expect(formatMoment(ms)).toBe("Nov 22, 2026 9:00 AM");
    expect(formatMoment(ms, "es")).toBe("22 de noviembre de 2026, 9:00 a.m.");
    expect(mailWords("es")).toEqual({
      subject: "Sobre su solicitud",
      link: "Su página de seguimiento:",
      page: "esta página",
    });
    expect(mailWords("en").page).toBe("this page");
  });
});

describe("the translation job", () => {
  it("translates the message once from Spanish to English and keeps it in the vault only", async () => {
    const calls = await translator(() => Promise.resolve({ translated_text: TRANSLATED }));
    const card = await mailCard();
    await alarm();
    expect(calls).toEqual([{ model: MODEL, input: { text: SPANISH, source_lang: "es", target_lang: "en" } }]);
    const rows = await vaultOf(card);
    const translation = rows.find((row) => row.kind === "translation");
    expect(translation?.body).toBe(TRANSLATED);
    expect(translation?.forget_at).toBe(rows.find((row) => row.kind === "message_in")?.forget_at);
    const ledger = await ledgerText();
    expect(ledger).toContain('"outcome":"ok"');
    expect(ledger).not.toContain("seventy");
    expect(logs.join("\n")).not.toContain("seventy");
  });

  it("the translation gets the forget date of the card when the job closes", async () => {
    await translator(() => Promise.resolve({ translated_text: TRANSLATED }));
    const card = await mailCard();
    await alarm();
    await doneJob(await confirmed(card));
    const jump = { id: newId(), type: "clock.jump", minutes: 4320 };
    expect((await send(ORG, await organiser(ORG), jump)).status).toBe(200);
    const rows = await vaultOf(card);
    const forget = rows.find((row) => row.kind === "message_in")?.forget_at;
    expect(forget).not.toBeNull();
    expect(rows.find((row) => row.kind === "translation")?.forget_at).toBe(forget);
  });
});

describe("the translation job and the model", () => {
  it("an English card is never sent to the model", async () => {
    const calls = await translator(() => Promise.resolve({ translated_text: TRANSLATED }));
    await mailCard(ENGLISH);
    await alarm();
    expect(calls).toEqual([]);
  });

  it("a model that fails 3 times ends with ai.done failed and no translation", async () => {
    const calls = await translator(() => Promise.reject(new Error("model down")));
    const card = await mailCard();
    for (let n = 0; n < 6; n += 1) await alarm();
    expect(calls.length).toBe(3);
    const done = (await exportLedger(ORG)).events.filter((e) => e.type === "ai.done" && e.card === card);
    expect(done.map((e) => e.data)).toEqual([{ job: "lang", outcome: "failed" }]);
    expect((await vaultOf(card)).some((row) => row.kind === "translation")).toBe(false);
  });

  it("an empty translation ends with ai.done empty", async () => {
    const calls = await translator(() => Promise.resolve({ translated_text: "  " }));
    const card = await mailCard();
    await alarm();
    expect(calls.length).toBe(1);
    const done = (await exportLedger(ORG)).events.find((e) => e.type === "ai.done" && e.card === card);
    expect(done?.data).toEqual({ job: "lang", outcome: "empty" });
  });
});

it("the job keeps the fallback for a person", () => {
  expect(langJob.fallback("c_1", "failed")).toEqual({
    type: "lang.result",
    card: "c_1",
    outcome: "failed",
    text: null,
  });
});
