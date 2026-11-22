import {
  CardIdSchema,
  VOICE_MAX_BYTES,
  VoiceDoorFieldsSchema,
  VoiceTypeSchema,
  VoicemailFieldsSchema,
  type Actor,
  type MemberRecord,
  type Playbook,
  type Role,
  type SystemCommand,
  type VoiceType,
  type VoicemailFields,
} from "@vision/contracts";
import { cardIsQuiet, type HubState } from "@vision/core";
import { z } from "zod";
import { sameSecret, tokenHash } from "../auth.js";
import type { DoorResult } from "../doors.js";
import { fail, json, logEvent } from "../http.js";
import { deleteAudio, joinBytes, readAudio, writeAudio } from "./audio.js";

const DESK_ROLES: readonly Role[] = ["desk", "lead"];
const FORM_OVERHEAD = 64 * 1024;
const UPLOAD_LIMIT = VOICE_MAX_BYTES + FORM_OVERHEAD;
const SYSTEM: Actor = { role: "system", ref: null };
const TOO_LARGE = "This file is over 2 MB.";
const WRONG_TYPE = "Vision takes WAV, MP3, OGG, WEBM or M4A files.";
const WRONG_FIELDS =
  "Check the voicemail fields. The callback is a phone number and a recording is at most 2 minutes.";

export type AiRouteHost = {
  org: string;
  sql: SqlStorage;
  doorSecret: string;
  member(request: Request): MemberRecord | null;
  transaction<T>(run: () => T): T;
  apply(command: SystemCommand, actor: Actor): DoorResult;
  state(): HubState;
  playbook(): Playbook;
  now(): number;
};

export type DeskCaller = { ok: true; member: MemberRecord } | { ok: false; response: Response };

export const deskCaller = (request: Request, host: AiRouteHost): DeskCaller => {
  const member = host.member(request);
  if (member === null) return { ok: false, response: fail("unauthorized", "Sign in again.") };
  if (!member.roles.some((role) => DESK_ROLES.includes(role)))
    return { ok: false, response: fail("forbidden", "Only the desk can use voicemail.") };
  return { ok: true, member };
};

export type Upload<F> = { ok: true; audio: { mime: VoiceType; bytes: Uint8Array }; fields: F };
type Parsed<F> = Upload<F> | { ok: false; response: Response };

const readBody = async (request: Request): Promise<Uint8Array | null> => {
  if (Number(request.headers.get("Content-Length") ?? "0") > UPLOAD_LIMIT) return null;
  const body = request.body as ReadableStream<Uint8Array> | null;
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > UPLOAD_LIMIT) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk.value);
  }
  return joinBytes(chunks);
};

const readForm = async (request: Request, bytes: Uint8Array): Promise<FormData | null> => {
  const type = request.headers.get("Content-Type") ?? "";
  try {
    return await new Response(bytes, { headers: { "Content-Type": type } }).formData();
  } catch (error) {
    logEvent({ op: "voicemail", status: "not_a_form", error: error instanceof Error ? error.name : "Error" });
    return null;
  }
};

const textFields = (form: FormData, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const value = form.get(key);
      return typeof value === "string" ? [[key, value]] : [];
    }),
  );

const audioPart = async (form: FormData): Promise<Upload<null>["audio"] | Response> => {
  const file = form.get("audio");
  if (file === null || typeof file === "string") return fail("invalid", "Add an audio file.");
  if (file.size > VOICE_MAX_BYTES) return fail("too_large", TOO_LARGE);
  const mime = VoiceTypeSchema.safeParse((file.type.split(";")[0] ?? "").trim().toLowerCase());
  if (!mime.success || file.size === 0) return fail("invalid", WRONG_TYPE);
  return { mime: mime.data, bytes: new Uint8Array(await file.arrayBuffer()) };
};

const parseUpload = async <F>(
  request: Request,
  schema: z.ZodType<F>,
  keys: readonly string[],
): Promise<Parsed<F>> => {
  const bytes = await readBody(request);
  if (bytes === null) return { ok: false, response: fail("too_large", TOO_LARGE) };
  const form = await readForm(request, bytes);
  if (form === null) return { ok: false, response: fail("invalid", "Send the voicemail as a form.") };
  const audio = await audioPart(form);
  if (audio instanceof Response) return { ok: false, response: audio };
  const fields = schema.safeParse(textFields(form, keys));
  if (!fields.success) return { ok: false, response: fail("invalid", WRONG_FIELDS) };
  return { ok: true, audio, fields: fields.data };
};

export const admit = (host: AiRouteHost, card: string, upload: Upload<VoicemailFields>): DoorResult => {
  writeAudio(host.sql, card, upload.audio, host.now());
  const { zip, callback } = upload.fields;
  const result = host.apply({ type: "voice.received", card, zip, callback }, SYSTEM);
  if (result.status !== 200) deleteAudio(host.sql, card);
  return result;
};

export const cardForRecording = (recordingId: string): string => {
  const h = tokenHash(`voice:${recordingId}`);
  const variant = "89ab".charAt(parseInt(h.charAt(16), 16) % 4);
  return `c_${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const DOOR_KEYS = ["recordingId", "seconds", "callback", "zip"] as const;
const DESK_KEYS = ["seconds", "callback", "zip"] as const;

const postVoiceDoor = async (request: Request, host: AiRouteHost): Promise<Response> => {
  if (!sameSecret(request.headers.get("X-Door-Secret") ?? "", host.doorSecret))
    return fail("unauthorized", "The door secret is not right.");
  const upload = await parseUpload(request, VoiceDoorFieldsSchema, DOOR_KEYS);
  if (!upload.ok) return upload.response;
  const card = cardForRecording(upload.fields.recordingId);
  return host.transaction(() => {
    if (host.state().cards[card] !== undefined) return json({ card, repeated: true }, 200);
    const result = admit(host, card, upload);
    if (result.status !== 200) return json(result.body, result.status);
    logEvent({ op: "voice_door", card });
    return json({ card, repeated: false }, 201);
  });
};

const postVoicemail = async (request: Request, host: AiRouteHost): Promise<Response> => {
  const caller = deskCaller(request, host);
  if (!caller.ok) return caller.response;
  const upload = await parseUpload(request, VoicemailFieldsSchema, DESK_KEYS);
  if (!upload.ok) return upload.response;
  const card = `c_${crypto.randomUUID()}`;
  return host.transaction(() => {
    const result = admit(host, card, upload);
    if (result.status !== 200) return json(result.body, result.status);
    logEvent({ op: "voicemail", card });
    return json({ card }, 201);
  });
};

const ledByLead = (state: HubState, playbook: Playbook, card: string): boolean => {
  const found = state.cards[card];
  if (found === undefined) return false;
  if (cardIsQuiet(playbook, found) || found.level === 3) return true;
  return found.jobs.some((id) => state.jobs[id]?.quiet === true);
};

const getAudio = (request: Request, cardId: string, host: AiRouteHost): Response => {
  const caller = deskCaller(request, host);
  if (!caller.ok) return caller.response;
  const card = CardIdSchema.safeParse(cardId);
  if (!card.success) return fail("not_found", "This voicemail is not in the vault.");
  if (ledByLead(host.state(), host.playbook(), card.data) && !caller.member.roles.includes("lead"))
    return fail("forbidden", "Only the lead may handle this request.");
  const audio = readAudio(host.sql, card.data);
  if (audio === null) return fail("not_found", "This voicemail is not in the vault.");
  return new Response(audio.bytes, { headers: { "Content-Type": audio.mime, "Cache-Control": "no-store" } });
};

export const routeAi = (
  request: Request,
  parts: readonly string[],
  host: AiRouteHost,
): Promise<Response> | null => {
  const [first, second] = parts;
  const route = `${request.method} ${first ?? ""}`;
  if (route === "POST doors" && second === "voice" && parts.length === 2) return postVoiceDoor(request, host);
  if (route === "POST voicemails" && parts.length === 1) return postVoicemail(request, host);
  if (route === "GET audio" && second !== undefined && parts.length === 2)
    return Promise.resolve(getAudio(request, second, host));
  return null;
};
