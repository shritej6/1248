import { z } from "zod";
import {
  CommandResponseSchema,
  ErrorBodySchema,
  JoinResponseSchema,
  LedgerEventSchema,
  OrgAboutSchema,
  type Command,
  type JoinResponse,
  type LedgerEvent,
  type RejectionCode,
  type RequestForm,
} from "@vision/contracts";

export type Auth = { kind: "session"; token: string } | { kind: "track" | "partner"; token: string };
export type FailureCode = RejectionCode | "network";
export type CommandOutcome = { ok: true } | { ok: false; code: FailureCode };
export type JoinOutcome = ({ ok: true } & JoinResponse) | { ok: false; code: FailureCode };
export type RequestOutcome = { ok: true; tracking: string } | { ok: false; code: FailureCode };
export type OrgNameOutcome = { ok: true; orgName: string } | { ok: false; code: FailureCode };
export type JoinCodeOutcome = { ok: true; joinCode: string } | { ok: false; code: FailureCode };
export type ViewName = "desk" | "org" | "home" | "job" | "tracking" | "partner";
export type ViewQuery = Record<string, string>;

export class ApiError extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export const RETRY_WAITS = [300, 900] as const;
export const FETCH_TIMEOUT_MS = 10_000;

type Attempt<T> = { done: true; value: T } | { done: false };
type Result<T> = { ok: true; value: T } | { ok: false; code: FailureCode };

const NETWORK = { ok: false, code: "network" } as const;

const orgPath = (org: string) => `/api/v1/o/${encodeURIComponent(org)}`;

function basePath(org: string, auth: Auth): string {
  if (auth.kind === "session") return orgPath(org);
  return `${orgPath(org)}/${auth.kind === "track" ? "t" : "p"}/${encodeURIComponent(auth.token)}`;
}

function viewUrl(org: string, auth: Auth, name: ViewName, query: ViewQuery | undefined): string {
  const path = auth.kind === "session" ? `${basePath(org, auth)}/views/${name}` : basePath(org, auth);
  const search = new URLSearchParams(query).toString();
  return search === "" ? path : `${path}?${search}`;
}

function headersFor(auth: Auth | null, hasBody: boolean): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (hasBody) headers.set("Content-Type", "application/json");
  if (auth?.kind === "session") headers.set("Authorization", `Bearer ${auth.token}`);
  return headers;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function tryFetch(operation: string, url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The hub did not answer in time.", "TimeoutError"));
  }, FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`api: ${operation} got no answer (${name})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(operation: string, response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`api: ${operation} answer ${String(response.status)} is not JSON (${name})`);
    return null;
  }
}

async function withRetry<T>(attempt: () => Promise<Attempt<T>>, fallback: T): Promise<T> {
  for (let i = 0; i <= RETRY_WAITS.length; i += 1) {
    const result = await attempt();
    if (result.done) return result.value;
    const wait = RETRY_WAITS[i];
    if (wait !== undefined) await sleep(wait);
  }
  return fallback;
}

function rejectionCode(body: unknown): FailureCode {
  const parsed = ErrorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : "invalid";
}

function commandOutcome(body: unknown): CommandOutcome {
  const parsed = CommandResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, code: "invalid" };
  return parsed.data.ok ? { ok: true } : { ok: false, code: parsed.data.error.code };
}

export function newCommandId(): string {
  return `cmd_${crypto.randomUUID()}`;
}

const unsettledIds = new Map<string, string>();

export async function sendCommand(org: string, auth: Auth, command: Command): Promise<CommandOutcome> {
  const operation = `command ${command.type}`;
  const key = JSON.stringify([basePath(org, auth), { ...command, id: null }]);
  const sent: Command = { ...command, id: unsettledIds.get(key) ?? command.id };
  const init: RequestInit = {
    method: "POST",
    headers: headersFor(auth, true),
    body: JSON.stringify(sent),
  };
  const outcome = await withRetry<CommandOutcome>(async () => {
    const response = await tryFetch(operation, `${basePath(org, auth)}/commands`, init);
    if (response === null || response.status >= 500) return { done: false };
    return { done: true, value: commandOutcome(await readJson(operation, response)) };
  }, NETWORK);
  if (!outcome.ok && outcome.code === "network") unsettledIds.set(key, sent.id);
  else unsettledIds.delete(key);
  return outcome;
}

export async function getView<T>(
  org: string,
  auth: Auth,
  name: ViewName,
  schema: z.ZodType<T>,
  query?: ViewQuery,
): Promise<T> {
  const operation = `view ${name}`;
  const url = viewUrl(org, auth, name, query);
  const result = await withRetry<Result<T>>(async () => {
    const response = await tryFetch(operation, url, { headers: headersFor(auth, false) });
    if (response === null || response.status >= 500) return { done: false };
    const body = await readJson(operation, response);
    if (!response.ok) return { done: true, value: { ok: false, code: rejectionCode(body) } };
    const parsed = schema.safeParse(body);
    return {
      done: true,
      value: parsed.success ? { ok: true, value: parsed.data } : { ok: false, code: "invalid" },
    };
  }, NETWORK);
  if (result.ok) return result.value;
  const message =
    result.code === "invalid"
      ? `The view ${name} does not match its contract.`
      : `The view ${name} failed: ${result.code}.`;
  throw new ApiError(result.code, message);
}

const JoinCodeSchema = z.object({ ok: z.literal(true), code: z.string().min(1) });

export async function createJoinCode(org: string, token: string, member: string): Promise<JoinCodeOutcome> {
  const auth: Auth = { kind: "session", token };
  const command: Command = { id: newCommandId(), type: "join.create", member };
  const init: RequestInit = {
    method: "POST",
    headers: headersFor(auth, true),
    body: JSON.stringify(command),
  };
  return withRetry<JoinCodeOutcome>(async () => {
    const response = await tryFetch("join code", `${orgPath(org)}/commands`, init);
    if (response === null || response.status >= 500) return { done: false };
    const body = await readJson("join code", response);
    if (!response.ok) return { done: true, value: { ok: false, code: rejectionCode(body) } };
    const parsed = JoinCodeSchema.safeParse(body);
    return {
      done: true,
      value: parsed.success ? { ok: true, joinCode: parsed.data.code } : { ok: false, code: "invalid" },
    };
  }, NETWORK);
}

const LedgerExportSchema = z.object({ events: z.array(LedgerEventSchema) });

export async function getLedger(org: string, token: string): Promise<LedgerEvent[]> {
  const url = `${orgPath(org)}/export`;
  const auth: Auth = { kind: "session", token };
  const result = await withRetry<Result<LedgerEvent[]>>(async () => {
    const response = await tryFetch("export", url, { headers: headersFor(auth, false) });
    if (response === null || response.status >= 500) return { done: false };
    const body = await readJson("export", response);
    if (!response.ok) return { done: true, value: { ok: false, code: rejectionCode(body) } };
    const parsed = LedgerExportSchema.safeParse(body);
    return {
      done: true,
      value: parsed.success ? { ok: true, value: parsed.data.events } : { ok: false, code: "invalid" },
    };
  }, NETWORK);
  if (result.ok) return result.value;
  throw new ApiError(result.code, `The ledger export failed: ${result.code}.`);
}

export async function joinOrg(org: string, code: string): Promise<JoinOutcome> {
  const init: RequestInit = {
    method: "POST",
    headers: headersFor(null, true),
    body: JSON.stringify({ code }),
  };
  const response = await tryFetch("join", `${orgPath(org)}/join`, init);
  if (response === null) return NETWORK;
  const body = await readJson("join", response);
  if (!response.ok) return { ok: false, code: response.status >= 500 ? "network" : rejectionCode(body) };
  const parsed = JoinResponseSchema.safeParse(body);
  return parsed.success ? { ok: true, ...parsed.data } : { ok: false, code: "invalid" };
}

export async function getOrgName(org: string): Promise<OrgNameOutcome> {
  const response = await tryFetch("about", `${orgPath(org)}/about`, { headers: headersFor(null, false) });
  if (response === null || response.status >= 500) return NETWORK;
  const body = await readJson("about", response);
  if (!response.ok) return { ok: false, code: rejectionCode(body) };
  const parsed = OrgAboutSchema.safeParse(body);
  return parsed.success ? { ok: true, orgName: parsed.data.orgName } : { ok: false, code: "invalid" };
}

const RequestCreatedSchema = z.strictObject({ tracking: z.string().min(1) });

export async function submitRequest(org: string, form: RequestForm): Promise<RequestOutcome> {
  const init: RequestInit = {
    method: "POST",
    headers: headersFor(null, true),
    body: JSON.stringify(form),
  };
  const response = await tryFetch("request", `${orgPath(org)}/requests`, init);
  if (response === null || response.status >= 500) return NETWORK;
  const body = await readJson("request", response);
  if (response.status !== 201) return { ok: false, code: rejectionCode(body) };
  const parsed = RequestCreatedSchema.safeParse(body);
  return parsed.success ? { ok: true, tracking: parsed.data.tracking } : { ok: false, code: "invalid" };
}

export type GoogleAction = "playbook" | "statement";
export type GoogleOutcome = { ok: true } | { ok: false; code: FailureCode; message: string };

const GOOGLE_NETWORK: GoogleOutcome = {
  ok: false,
  code: "network",
  message: "No connection to the hub. Try again.",
};

function googleFailure(body: unknown): GoogleOutcome {
  const parsed = ErrorBodySchema.safeParse(body);
  if (!parsed.success)
    return { ok: false, code: "invalid", message: "The hub answer was not clear. Try again." };
  return { ok: false, code: parsed.data.error.code, message: parsed.data.error.message };
}

export async function askGoogle(
  org: string,
  token: string,
  action: GoogleAction,
  body: Record<string, unknown>,
): Promise<GoogleOutcome> {
  const operation = `google ${action}`;
  const init: RequestInit = {
    method: "POST",
    headers: headersFor({ kind: "session", token }, true),
    body: JSON.stringify(body),
  };
  return withRetry<GoogleOutcome>(async () => {
    const response = await tryFetch(operation, `${orgPath(org)}/google/${action}`, init);
    if (response === null || response.status >= 500) return { done: false };
    const answer = await readJson(operation, response);
    return { done: true, value: response.ok ? { ok: true } : googleFailure(answer) };
  }, GOOGLE_NETWORK);
}
