import { z } from "zod";
import { CardIdSchema, ErrorBodySchema } from "@vision/contracts";
import type { Auth, FailureCode } from "./api.js";

export const VOICE_TIMEOUT_MS = 30_000;

export type VoicemailUpload = { file: File; seconds: number; callback: string; zip: string };
export type UploadOutcome = { ok: true; card: string } | { ok: false; code: FailureCode };
export type RecordingOutcome = { ok: true; blob: Blob } | { ok: false; code: FailureCode };

const CreatedSchema = z.object({ card: CardIdSchema });

const orgPath = (org: string) => `/api/v1/o/${encodeURIComponent(org)}`;

function authHeaders(auth: Auth): Headers {
  const headers = new Headers();
  if (auth.kind === "session") headers.set("Authorization", `Bearer ${auth.token}`);
  return headers;
}

async function voiceFetch(operation: string, url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The hub did not answer in time.", "TimeoutError"));
  }, VOICE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    console.warn(`voice: ${operation} got no answer (${error instanceof Error ? error.name : "unknown"})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonOf(operation: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    console.warn(
      `voice: ${operation} answer is not JSON (${error instanceof Error ? error.name : "unknown"})`,
    );
    return null;
  }
}

async function failureOf(operation: string, response: Response): Promise<FailureCode> {
  if (response.status >= 500) return "network";
  const parsed = ErrorBodySchema.safeParse(await jsonOf(operation, response));
  return parsed.success ? parsed.data.error.code : "invalid";
}

async function blobOf(response: Response): Promise<RecordingOutcome> {
  try {
    return { ok: true, blob: await response.blob() };
  } catch (error) {
    console.warn(`voice: audio body did not arrive (${error instanceof Error ? error.name : "unknown"})`);
    return { ok: false, code: "network" };
  }
}

export async function uploadVoicemail(
  org: string,
  auth: Auth,
  upload: VoicemailUpload,
): Promise<UploadOutcome> {
  const form = new FormData();
  form.append("audio", upload.file);
  form.append("seconds", String(upload.seconds));
  form.append("callback", upload.callback);
  form.append("zip", upload.zip);
  const init: RequestInit = { method: "POST", headers: authHeaders(auth), body: form };
  const response = await voiceFetch("upload", `${orgPath(org)}/voicemails`, init);
  if (response === null) return { ok: false, code: "network" };
  if (response.status !== 201) return { ok: false, code: await failureOf("upload", response) };
  const created = CreatedSchema.safeParse(await jsonOf("upload", response));
  return created.success ? { ok: true, card: created.data.card } : { ok: false, code: "invalid" };
}

export async function fetchRecording(org: string, auth: Auth, card: string): Promise<RecordingOutcome> {
  const url = `${orgPath(org)}/audio/${encodeURIComponent(card)}`;
  const response = await voiceFetch("audio", url, { headers: authHeaders(auth) });
  if (response === null) return { ok: false, code: "network" };
  if (!response.ok) return { ok: false, code: await failureOf("audio", response) };
  return blobOf(response);
}
