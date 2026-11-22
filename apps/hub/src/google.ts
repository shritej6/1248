import {
  PlaybookSchema,
  StatementSchema,
  type Command,
  type LedgerEvent,
  type Playbook,
  type Statement,
} from "@vision/contracts";
import { z } from "zod";
import { fail, json, logEvent, readJson, rejectionResponse, type BodyResult } from "./http.js";

const PLAYBOOK_WAITS_MS = [250, 1_000] as const;
const StatementAsk = z.strictObject({ statement: StatementSchema });
const PlaybookAnswer = z.object({ playbook: PlaybookSchema });
const ScriptAnswer = z.object({ ok: z.boolean().optional(), error: z.string().optional() });

export class GoogleError extends Error {
  override readonly name = "GoogleError";
}

const NOT_JSON = "The Google script did not answer with JSON. Check who can open the web app.";

const readAnswer = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch (error) {
    throw new GoogleError(`${NOT_JSON} (${error instanceof Error ? error.name : "Error"})`);
  }
};

export type Google = {
  sendMail(to: string, subject: string, body: string): Promise<void>;
  appendLedger(lines: LedgerEvent[]): Promise<void>;
  writeStatement(s: Statement): Promise<void>;
  fetchPlaybook(): Promise<Playbook>;
};

export const postToGoogle = async (
  target: { url: string; secret: string; fetcher: typeof fetch },
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  if (target.url.length === 0) throw new GoogleError("No outside address is set for this hub.");
  const response = await target.fetcher(target.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: target.secret, kind }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GoogleError(`The outside call answered with status ${String(response.status)}.`);
  }
  const answer = ScriptAnswer.safeParse(await readAnswer(response));
  if (!answer.success) throw new GoogleError(NOT_JSON);
  if (answer.data.ok === false)
    throw new GoogleError(`The Google script refused the call: ${answer.data.error ?? "no reason"}.`);
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const playbookOnce = async (url: string, secret: string, fetcher: typeof fetch): Promise<Playbook> => {
  const address = new URL(url);
  address.searchParams.set("kind", "playbook");
  address.searchParams.set("secret", secret);
  const response = await fetcher(address.toString(), { method: "GET" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new GoogleError(`The playbook sheet answered with status ${String(response.status)}.`);
  }
  const parsed = PlaybookAnswer.safeParse(await readAnswer(response));
  if (!parsed.success) throw new GoogleError("The playbook sheet does not match the playbook shape.");
  return parsed.data.playbook;
};

const withRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  for (const ms of PLAYBOOK_WAITS_MS) {
    try {
      return await run();
    } catch (error) {
      logEvent({ op: "google", status: "retry", error: error instanceof Error ? error.name : "Error" });
      await wait(ms);
    }
  }
  return run();
};

export const createGoogle = (url: string, secret: string, fetcher: typeof fetch): Google => {
  const target = { url, secret, fetcher };
  return {
    sendMail: (to, subject, body) => postToGoogle(target, "mail", { to, subject, body }),
    appendLedger: (lines) => postToGoogle(target, "ledger", { lines }),
    writeStatement: (s) => postToGoogle(target, "statement", { statement: s }),
    fetchPlaybook: () => {
      if (url.length === 0) return Promise.reject(new GoogleError("No outside address is set for this hub."));
      return withRetry(() => playbookOnce(url, secret, fetcher));
    },
  };
};

export type GoogleHost = {
  google: Google | null;
  organiser(request: Request): string | null;
  apply(command: Command, actor: { role: "organiser"; ref: string }): { status: number; body: unknown };
  queueStatement(statement: Statement): Promise<void>;
};

type HubSide = Omit<GoogleHost, "google" | "organiser"> & {
  member(request: Request): { id: string; roles: readonly string[] } | null;
};

export type GoogleEnv = { GOOGLE_URL?: string; GOOGLE_SECRET?: string };

export const googleOn = (env: GoogleEnv): boolean => (env.GOOGLE_URL ?? "").length > 0;

export const hubGoogle = (env: GoogleEnv, hub: HubSide): GoogleHost => ({
  google: googleOn(env)
    ? createGoogle(env.GOOGLE_URL ?? "", env.GOOGLE_SECRET ?? "", (input, init) => fetch(input, init))
    : null,
  organiser: (request) => {
    const member = hub.member(request);
    return member?.roles.includes("organiser") === true ? member.id : null;
  },
  apply: hub.apply,
  queueStatement: hub.queueStatement,
});

const NO_GOOGLE =
  "The Google link is not set up for this hub. Ask the lead to follow the Google setup steps.";

const loadPlaybook = async (organiser: string, host: GoogleHost, google: Google): Promise<Response> => {
  try {
    const playbook = await google.fetchPlaybook();
    const command: Command = { id: `cmd_${crypto.randomUUID()}`, type: "playbook.load", playbook };
    const result = host.apply(command, { role: "organiser", ref: organiser });
    return json(result.body, result.status);
  } catch (error) {
    const known = error instanceof GoogleError ? error.message : "The Google script did not answer.";
    logEvent({
      op: "google",
      kind: "playbook",
      status: "failed",
      error: error instanceof Error ? error.name : "Error",
    });
    return fail("wrong_state", `The playbook did not load from the sheet. ${known} Try again later.`);
  }
};

const saveStatement = async (body: BodyResult, host: GoogleHost): Promise<Response> => {
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = StatementAsk.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "Load the statement again, then save it.");
  await host.queueStatement(parsed.data.statement);
  return json({ ok: true, events: 0 }, 202);
};

export const routeGoogle = async (request: Request, action: string, host: GoogleHost): Promise<Response> => {
  const organiser = host.organiser(request);
  if (organiser === null) return fail("forbidden", "Only an organiser can use the Google link.");
  if (host.google === null) return fail("wrong_state", NO_GOOGLE);
  if (action === "playbook") return loadPlaybook(organiser, host, host.google);
  return saveStatement(await readJson(request), host);
};
