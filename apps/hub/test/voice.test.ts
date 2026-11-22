import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { VOICE_MAX_BYTES, type DeskBoard, type DeskCard } from "@vision/contracts";
import { emptyState } from "@vision/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AUDIO_PART_BYTES, readAudio, writeAudio } from "../src/ai/audio.js";
import { admit, type AiRouteHost } from "../src/ai/routes.js";
import { eraseDue } from "../src/alarm.js";
import type { Env } from "../src/orghub.js";
import { voiceJob } from "../src/ai/voice.js";
import {
  errorCode,
  exportLedger,
  freshOrg,
  hubFetch,
  join,
  loadPlaybook,
  newId,
  organiser,
  send,
  sql,
  view,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const BASE = "https://hub.test/api/v1/o";
const TRANSCRIPT = "Hi this is Ruthie. Please shovel my walk. There is a gas smell in the kitchen.";
const CALLBACK = "414-555-0177";
const offEnv = { VOICE_MODEL: env.VOICE_MODEL, SORTER_MODEL: env.SORTER_MODEL, AI: env.AI };
const MINUTE = 60_000;

let clock = Date.now();
beforeEach(() => {
  clock = Date.now() + 365 * 24 * 60 * MINUTE;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, offEnv);
});

type Fields = Record<string, string>;
type Audio = { bytes: Uint8Array; type: string };

const audioOf = (size = 4000, type = "audio/mpeg"): Audio => ({
  bytes: Uint8Array.from({ length: size }, (_, i) => i % 251),
  type,
});

const formOf = (audio: Audio | null, fields: Fields): FormData => {
  const form = new FormData();
  if (audio !== null) form.append("audio", new File([audio.bytes], "voicemail.mp3", { type: audio.type }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
};

const upload = (org: string, token: string, audio: Audio | null, fields: Fields = {}) =>
  hubFetch(`${BASE}/${org}/voicemails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formOf(audio, { seconds: "30", ...fields }),
  });

const phoneDoor = (org: string, recordingId: string, secret = env.DOOR_SECRET ?? "") =>
  hubFetch(`${BASE}/${org}/doors/voice`, {
    method: "POST",
    headers: { "X-Door-Secret": secret },
    body: formOf(audioOf(), { recordingId, seconds: "45", callback: CALLBACK, zip: "53216" }),
  });

const deskHub = async (): Promise<{ org: string; desk: string }> => {
  const org = freshOrg();
  await organiser(org);
  await loadPlaybook(org);
  return { org, desk: await join(org, "m_d01") };
};

const cardOf = async (r: Response): Promise<string> => (await r.json<{ card: string }>()).card;

const boardCard = async (org: string, card: string): Promise<DeskCard | undefined> => {
  const board = (await view(org, "desk")) as DeskBoard;
  return [...board.triage, ...board.emergency].find((c) => c.card === card);
};

const audioRows = (org: string, card: string) =>
  sql(org, (s) =>
    s
      .exec<{ part: number; size: number; forget: number | null }>(
        "SELECT part, length(bytes) AS size, forget_at AS forget FROM vault_audio WHERE card = ? ORDER BY part",
        card,
      )
      .toArray(),
  );

const voiceModel = async (org: string, run: (model: string, input: unknown) => Promise<unknown>) => {
  await runInDurableObject(env.ORG.getByName(org), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, { VOICE_MODEL: "@cf/test/whisper", AI: { run } });
  });
};

it("the desk adds a voicemail and the card is on the board at once as a voicemail with no words", async () => {
  const { org, desk } = await deskHub();
  const r = await upload(org, desk, audioOf(), { callback: CALLBACK, zip: "53216" });
  expect(r.status).toBe(201);
  const card = await cardOf(r);
  expect(await boardCard(org, card)).toMatchObject({ door: "voice", zip: "53216", message: "" });
  const received = (await exportLedger(org)).events.find((e) => e.type === "card.received");
  expect(received?.data).toEqual({ door: "voice", zip: "53216", safeContact: true });
  expect(await audioRows(org, card)).toEqual([{ part: 0, size: 4000, forget: null }]);
});

it("the upload checks the size, the type and the length of the recording", async () => {
  const { org, desk } = await deskHub();
  const big = await upload(org, desk, audioOf(VOICE_MAX_BYTES + 1));
  expect([big.status, await errorCode(big)]).toEqual([413, "too_large"]);
  const wav = await upload(org, desk, audioOf(1000, "audio/flac"));
  expect([wav.status, await errorCode(wav)]).toEqual([400, "invalid"]);
  const long = await upload(org, desk, audioOf(), { seconds: "121" });
  expect([long.status, await errorCode(long)]).toEqual([400, "invalid"]);
  const none = await upload(org, desk, null);
  expect([none.status, await errorCode(none)]).toEqual([400, "invalid"]);
  const zip = await upload(org, desk, audioOf(), { zip: "12" });
  expect([zip.status, await errorCode(zip)]).toEqual([400, "invalid"]);
  expect((await exportLedger(org)).events.some((e) => e.type === "card.received")).toBe(false);
  expect(await sql(org, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM vault_audio").one().n)).toBe(
    0,
  );
});

it("a file of exactly 2 MB is taken and stored in parts of at most 512 KiB", async () => {
  const { org, desk } = await deskHub();
  const r = await upload(org, desk, audioOf(VOICE_MAX_BYTES, "audio/wav"));
  expect(r.status).toBe(201);
  const rows = await audioRows(org, await cardOf(r));
  expect(rows.map((row) => row.size)).toEqual([
    AUDIO_PART_BYTES,
    AUDIO_PART_BYTES,
    AUDIO_PART_BYTES,
    AUDIO_PART_BYTES,
  ]);
});

it("the phone door takes a recording once, and a second send of the same recording adds no card", async () => {
  const org = freshOrg();
  await organiser(org);
  const first = await phoneDoor(org, "rec-0001");
  expect(first.status).toBe(201);
  const body = await first.json<{ card: string; repeated: boolean }>();
  expect(body.repeated).toBe(false);
  const again = await phoneDoor(org, "rec-0001");
  expect([again.status, await again.json()]).toEqual([200, { card: body.card, repeated: true }]);
  const cards = (await exportLedger(org)).events.filter((e) => e.type === "card.received");
  expect(cards.map((e) => e.card)).toEqual([body.card]);
  expect((await audioRows(org, body.card)).length).toBe(1);
  expect((await phoneDoor(org, "rec-0002", "wrong")).status).toBe(401);
});

it("the desk gets the audio back with its type and no caching, and a volunteer does not", async () => {
  const { org, desk } = await deskHub();
  const audio = audioOf(AUDIO_PART_BYTES + 10, "audio/ogg");
  const card = await cardOf(await upload(org, desk, audio));
  const r = await hubFetch(`${BASE}/${org}/audio/${card}`, { headers: { Authorization: `Bearer ${desk}` } });
  expect(r.status).toBe(200);
  expect(r.headers.get("Content-Type")).toBe("audio/ogg");
  expect(r.headers.get("Cache-Control")).toBe("no-store");
  const body = new Uint8Array(await r.arrayBuffer());
  expect(body.length).toBe(audio.bytes.length);
  expect(audio.bytes.findIndex((b, i) => body[i] !== b)).toBe(-1);
  const volunteer = await join(org, "m_v01");
  const denied = await hubFetch(`${BASE}/${org}/audio/${card}`, {
    headers: { Authorization: `Bearer ${volunteer}` },
  });
  expect(denied.status).toBe(403);
  const unknown = await hubFetch(`${BASE}/${org}/audio/c_00000000-0000-4000-8000-000000000000`, {
    headers: { Authorization: `Bearer ${desk}` },
  });
  expect(unknown.status).toBe(404);
});

it("audio rows get the card forget date when the job closes, and the alarm erases them", async () => {
  const { org, desk } = await deskHub();
  const card = await cardOf(await upload(org, desk, audioOf()));
  await send(org, desk, { id: newId(), type: "voice.gist", card, text: "Snow on the walk" });
  await send(org, desk, {
    id: newId(),
    type: "card.confirm",
    card,
    need: "snow",
    urgency: "low",
    division: null,
  });
  const job = (await exportLedger(org)).events.find((e) => e.type === "job.planned")?.job ?? "";
  await send(org, desk, { id: newId(), type: "job.withdraw", job, reason: "cancelled" });
  const [row] = await audioRows(org, card);
  expect(row?.forget).toBeGreaterThan(clock);
  const erased = await sql(org, (s) => eraseDue(s, (row?.forget ?? 0) + 1));
  expect(erased?.erased).toBeGreaterThan(0);
  expect(await audioRows(org, card)).toEqual([]);
});

it("writeAudio and readAudio keep the parts in order and the type", async () => {
  const org = freshOrg();
  const bytes = Uint8Array.from({ length: AUDIO_PART_BYTES * 2 + 7 }, (_, i) => i % 251);
  const read = await sql(org, (s) => {
    expect(writeAudio(s, "c_x", { mime: "audio/webm", bytes }, 5)).toBe(3);
    return readAudio(s, "c_x");
  });
  expect(read?.mime).toBe("audio/webm");
  expect(read?.bytes.length).toBe(bytes.length);
  expect(bytes.findIndex((b, i) => read?.bytes[i] !== b)).toBe(-1);
  expect(await sql(org, (s) => readAudio(s, "c_none"))).toBeNull();
});

it("the voice job sends the audio to the model once and returns the transcript", async () => {
  const org = freshOrg();
  const calls: { model: string; input: unknown }[] = [];
  const run = (model: string, input: unknown) => {
    calls.push({ model, input });
    return Promise.resolve({ text: `  ${TRANSCRIPT} ` });
  };
  const result = await sql(org, (s) => {
    writeAudio(s, "c_x", { mime: "audio/mpeg", bytes: new Uint8Array([104, 105]) }, 1);
    return voiceJob.run("c_x", { run, model: "@cf/test/whisper", sql: s, state: emptyState(), now: 1 });
  });
  expect(result).toEqual({ type: "voice.result", card: "c_x", outcome: "ok", text: TRANSCRIPT });
  expect(calls).toEqual([{ model: "@cf/test/whisper", input: { audio: "aGk=", vad_filter: true } }]);
});

it("the voice job gives empty for no words, failed for no audio and throws on a model error", async () => {
  const org = freshOrg();
  const tools = (run: (model: string, input: unknown) => Promise<unknown>, s: SqlStorage) => ({
    run,
    model: "@cf/test/whisper",
    sql: s,
    state: emptyState(),
    now: 1,
  });
  const out = await sql(org, async (s) => {
    writeAudio(s, "c_x", { mime: "audio/mpeg", bytes: new Uint8Array([1]) }, 1);
    const empty = await voiceJob.run(
      "c_x",
      tools(() => Promise.resolve({ text: " " }), s),
    );
    const missing = await voiceJob.run(
      "c_none",
      tools(() => Promise.resolve({ text: "x" }), s),
    );
    const thrown = await voiceJob
      .run(
        "c_x",
        tools(() => Promise.resolve({ words: [] }), s),
      )
      .then(
        () => "no error",
        (error: unknown) => (error instanceof Error ? error.name : "unknown"),
      );
    return { empty: empty, missing: missing, thrown };
  });
  expect(out).toEqual({
    empty: { type: "voice.result", card: "c_x", outcome: "empty", text: null },
    missing: { type: "voice.result", card: "c_none", outcome: "failed", text: null },
    thrown: "AiJobError",
  });
});

it("with the job on, the alarm transcribes the voicemail and the word list reads it", async () => {
  const { org, desk } = await deskHub();
  await voiceModel(org, () => Promise.resolve({ text: TRANSCRIPT }));
  const logs = vi.spyOn(console, "log");
  const card = await cardOf(await upload(org, desk, audioOf(), { callback: CALLBACK }));
  await runDurableObjectAlarm(env.ORG.getByName(org));
  const shown = await boardCard(org, card);
  expect(shown).toMatchObject({ message: TRANSCRIPT, ai: { voice: "ok" } });
  expect(shown?.flags).toEqual(["sorter_off", "word_list_hit", "voice_transcript"]);
  const lines = JSON.stringify((await exportLedger(org)).events);
  const logged = JSON.stringify(logs.mock.calls);
  for (const secret of [TRANSCRIPT, CALLBACK, "gas smell"]) {
    expect(lines).not.toContain(secret);
    expect(logged).not.toContain(secret);
  }
});

it("a model that fails 3 times ends with ai.done failed and the desk types the gist", async () => {
  const { org, desk } = await deskHub();
  await voiceModel(org, () => Promise.reject(new Error("speech model down")));
  const card = await cardOf(await upload(org, desk, audioOf()));
  for (let n = 0; n < 3; n += 1) {
    await runDurableObjectAlarm(env.ORG.getByName(org));
    clock += 10 * MINUTE;
  }
  const done = (await exportLedger(org)).events.filter((e) => e.type === "ai.done");
  expect(done.map((e) => e.data)).toEqual([{ job: "voice", outcome: "failed" }]);
  expect(await boardCard(org, card)).toMatchObject({ ai: { voice: "failed" }, message: "" });
  const r = await send(org, desk, { id: newId(), type: "voice.gist", card, text: "Snow on the walk" });
  expect(r.status).toBe(200);
  expect((await boardCard(org, card))?.message).toBe("Snow on the walk");
});

it("a hub with no AI binding gives the voicemail to the desk at once, with no retries", async () => {
  const { org, desk } = await deskHub();
  await voiceModel(org, () => Promise.reject(new Error("Binding AI needs to be run remotely")));
  const card = await cardOf(await upload(org, desk, audioOf()));
  await runDurableObjectAlarm(env.ORG.getByName(org));
  expect(await boardCard(org, card)).toMatchObject({ ai: { voice: "failed" }, message: "" });
  const left = await sql(
    org,
    (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'ai.voice'").one().n,
  );
  expect(left).toBe(0);
  const r = await send(org, desk, { id: newId(), type: "voice.gist", card, text: "Snow on the walk" });
  expect(r.status).toBe(200);
});

const audioAs = (org: string, card: string, token: string) =>
  hubFetch(`${BASE}/${org}/audio/${card}`, { headers: { Authorization: `Bearer ${token}` } });

const confirmAs = (org: string, token: string, card: string, need: string) =>
  send(org, token, { id: newId(), type: "card.confirm", card, need, urgency: "low", division: null });

it.each([
  ["a quiet need", "text_extraction"],
  ["a level 3 need", "missing"],
])("only the lead may play the voicemail of a card on %s", async (_label, need) => {
  const { org, desk } = await deskHub();
  const lead = await join(org, "m_l01");
  const audio = audioOf(1200, "audio/ogg");
  const card = await cardOf(await upload(org, desk, audio));
  expect((await audioAs(org, card, desk)).status).toBe(200);
  expect((await confirmAs(org, lead, card, need)).status).toBe(200);
  const denied = await audioAs(org, card, desk);
  expect([denied.status, await errorCode(denied)]).toEqual([403, "forbidden"]);
  const played = await audioAs(org, card, lead);
  expect(played.status).toBe(200);
  expect(new Uint8Array(await played.arrayBuffer())).toEqual(audio.bytes);
});

const quietPass = {
  id: "c_1",
  service: "T.E.X.T. Tactical Extraction Team for DV / Sex Trafficking",
  division: "No clear home",
  urgency: "high",
  words: "",
  reason: "The caller asks for a safe way out.",
};

const voiceAndSorter = async (org: string) => {
  const run = (model: string): Promise<unknown> =>
    Promise.resolve(
      model === "@cf/test/whisper" ? { text: TRANSCRIPT } : { response: JSON.stringify(quietPass) },
    );
  await runInDurableObject(env.ORG.getByName(org), (hub) => {
    const hubEnv = (hub as unknown as { env: Env }).env;
    Object.assign(hubEnv, { VOICE_MODEL: "@cf/test/whisper", SORTER_MODEL: "@cf/test/sorter", AI: { run } });
  });
};

it("only the lead may play a voicemail the sorter sends to a quiet service, before any confirm", async () => {
  const { org, desk } = await deskHub();
  const lead = await join(org, "m_l01");
  await voiceAndSorter(org);
  const card = await cardOf(await upload(org, desk, audioOf()));
  for (let n = 0; n < 3; n += 1) await runDurableObjectAlarm(env.ORG.getByName(org));
  const events = (await exportLedger(org)).events.filter((e) => e.card === card);
  expect(events.find((e) => e.type === "card.sorted")?.data).toMatchObject({ service: quietPass.service });
  expect(events.some((e) => e.type === "card.confirmed")).toBe(false);
  expect(await boardCard(org, card)).toBeUndefined();
  const denied = await audioAs(org, card, desk);
  expect([denied.status, await errorCode(denied)]).toEqual([403, "forbidden"]);
  expect((await audioAs(org, card, lead)).status).toBe(200);
});

it("a voicemail with an email address as the callback is refused and sends no mail", async () => {
  const { org, desk } = await deskHub();
  const outbox = () => sql(org, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n);
  const before = await outbox();
  const r = await upload(org, desk, audioOf(), { callback: "ruthie@example.test" });
  expect([r.status, await errorCode(r)]).toEqual([400, "invalid"]);
  const door = await hubFetch(`${BASE}/${org}/doors/voice`, {
    method: "POST",
    headers: { "X-Door-Secret": env.DOOR_SECRET ?? "" },
    body: formOf(audioOf(), { recordingId: "rec-mail", seconds: "45", callback: "ruthie@example.test" }),
  });
  expect(door.status).toBe(400);
  expect((await exportLedger(org)).events.some((e) => e.type === "card.received")).toBe(false);
  expect(await outbox()).toBe(before);
});

it("a voicemail the core refuses leaves no audio in the vault", async () => {
  const org = freshOrg();
  const card = "c_7b1d2e44-9a0c-4f3e-8d21-5c6b7a8e9f01";
  const rows = await sql(org, (s) => {
    const host: AiRouteHost = {
      org,
      sql: s,
      doorSecret: "",
      member: () => null,
      transaction: (run) => run(),
      apply: () => ({ status: 409, body: { error: { code: "wrong_state" } } }),
      state: () => emptyState(),
      playbook: () => ({ version: "none", rows: [] }),
      now: () => clock,
    };
    const upload = { ok: true as const, audio: { mime: "audio/mpeg" as const, bytes: audioOf().bytes } };
    const result = admit(host, card, { ...upload, fields: { zip: null, callback: null, seconds: 30 } });
    expect(result.status).toBe(409);
    return s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM vault_audio").one().n;
  });
  expect(rows).toBe(0);
});
