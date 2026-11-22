import { ErrorBodySchema, ResourcesViewSchema, type ResourcesView } from "@vision/contracts";
import { FETCH_TIMEOUT_MS, type Auth, type FailureCode } from "./api.js";

export type ResourcesAction = "costs" | "readiness" | "drafts" | "approve";
export type ResourcesOutcome =
  { ok: true; view: ResourcesView } | { ok: false; code: FailureCode; message: string };
export type ResourcesClient = {
  load: () => Promise<ResourcesOutcome>;
  post: (action: ResourcesAction, body: unknown) => Promise<ResourcesOutcome>;
};

const NETWORK: ResourcesOutcome = {
  ok: false,
  code: "network",
  message: "Vision could not reach the hub. Check the connection and try again.",
};
const UNREADABLE: ResourcesOutcome = {
  ok: false,
  code: "invalid",
  message: "The hub sent an answer that Vision cannot read.",
};

const orgPath = (org: string) => `/api/v1/o/${encodeURIComponent(org)}`;

const errorName = (error: unknown): string =>
  error instanceof Error || error instanceof DOMException ? error.name : "unknown";

function headersFor(auth: Auth, hasBody: boolean): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (hasBody) headers.set("Content-Type", "application/json");
  if (auth.kind === "session") headers.set("Authorization", `Bearer ${auth.token}`);
  return headers;
}

async function resourcesFetch(operation: string, url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The hub did not answer in time.", "TimeoutError"));
  }, FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    console.warn(`resources: ${operation} got no answer (${errorName(error)})`);
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
      `resources: ${operation} answer ${String(response.status)} is not JSON (${errorName(error)})`,
    );
    return null;
  }
}

function outcomeOf(operation: string, response: Response, body: unknown): ResourcesOutcome {
  if (response.ok) {
    const view = ResourcesViewSchema.safeParse(body);
    if (view.success) return { ok: true, view: view.data };
    console.warn(`resources: ${operation} answer does not match the contract`);
    return UNREADABLE;
  }
  const failure = ErrorBodySchema.safeParse(body);
  if (failure.success)
    return { ok: false, code: failure.data.error.code, message: failure.data.error.message };
  return response.status >= 500 ? NETWORK : UNREADABLE;
}

export function newDraftId(): string {
  return `d_${crypto.randomUUID()}`;
}

export function resourcesClient(org: string, auth: Auth): ResourcesClient {
  const base = `${orgPath(org)}/resources`;
  const run = async (operation: string, url: string, init: RequestInit): Promise<ResourcesOutcome> => {
    const response = await resourcesFetch(operation, url, init);
    if (response === null) return NETWORK;
    return outcomeOf(operation, response, await jsonOf(operation, response));
  };
  return {
    load: () => run("load", base, { headers: headersFor(auth, false) }),
    post: (action, body) =>
      run(action, `${base}/${action}`, {
        method: "POST",
        headers: headersFor(auth, true),
        body: JSON.stringify(body),
      }),
  };
}
