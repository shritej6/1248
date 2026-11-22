import {
  CommandSchema,
  RequestFormSchema,
  type Actor,
  type Command,
  type RequestForm,
  type RequestSubmit,
  type SystemCommand,
  ZipCentresSchema,
} from "@vision/contracts";
import { z } from "zod";
import zipCentres from "../../../data/synthetic/zip-centres.json";
import { newToken, sameSecret, tokenHash } from "./auth.js";
import { routeGoogle, type GoogleHost } from "./google.js";
import { fail, json, logEvent, readJson, rejectionResponse } from "./http.js";

const FORM_LIMIT = 5;
const FORM_WINDOW_MS = 10 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RESIDENT_TYPES: readonly string[] = ["consent.answer", "checkback.answer"];
const PARTNER_TYPES: readonly string[] = ["promise.accept", "ask.answer", "handover.got_it"];
const PartnerLinkBody = z.object({ partner: z.string(), link: z.string() });
const LINK_NEVER_ENDS = Number.MAX_SAFE_INTEGER;
const MESSAGE_LIMIT = 2000;
const EmailDoorSchema = z.strictObject({
  messageId: z.string().min(1).max(200),
  fromName: z.string().max(200),
  fromAddress: z.string().trim().min(3).max(120),
  subject: z.string().max(500),
  text: z.string().max(10_000),
});
type EmailIn = z.infer<typeof EmailDoorSchema>;
const SERVED_ZIPS = ZipCentresSchema.parse(zipCentres);

export type DoorResult = { status: number; body: unknown };

export type DoorHost = {
  org: string;
  sql: SqlStorage;
  limit: FormLimit;
  hasMembers(): boolean;
  transaction<T>(run: () => T): T;
  apply(command: Command | SystemCommand, actor: Actor): DoorResult;
  jobCard(job: string): string | null;
  jobClosed(job: string): boolean;
  sentBefore(id: string, actorRef: string): boolean;
  tracking(card: string): Response;
  partnerCard(link: PartnerLink): Response;
  doorSecret: string;
  google: GoogleHost;
};

export type PartnerLink = { job: string; partner: string };

export class FormLimit {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - FORM_WINDOW_MS);
    if (recent.length >= FORM_LIMIT) {
      this.hits.set(key, recent);
      return false;
    }
    this.hits.set(key, [...recent, now]);
    return true;
  }
}

export const submitFromForm = (form: RequestForm, card: string): RequestSubmit => ({
  type: "request.submit",
  card,
  door: "form",
  zip: form.zip,
  safeContact: form.safeContact,
  firstName: form.firstName,
  contact: form.contact,
  address: form.address.length > 0 ? form.address : null,
  message: form.message,
  ...(form.lang === undefined ? {} : { lang: form.lang }),
});

const insertTrackingLink = (sql: SqlStorage, org: string, card: string): string => {
  const token = newToken();
  sql.exec(
    "INSERT INTO links (hash, kind, card, job, partner, expires_at) VALUES (?, 'tracking', ?, NULL, NULL, ?)",
    tokenHash(token),
    card,
    LINK_NEVER_ENDS,
  );
  const path = `/${org}/t/${token}`;
  sql.exec(
    "INSERT INTO vault (card, job, kind, from_party, body, at, forget_at) VALUES (?, NULL, 'tracking_link', 'system', ?, ?, NULL)",
    card,
    path,
    Date.now(),
  );
  return path;
};

export const trackingCard = (sql: SqlStorage, token: string): string | null => {
  if (!TOKEN_PATTERN.test(token)) return null;
  const query = "SELECT card FROM links WHERE hash = ? AND kind = 'tracking' AND expires_at > ?";
  return sql.exec<{ card: string }>(query, tokenHash(token), Date.now()).toArray()[0]?.card ?? null;
};

export const insertPartnerLink = (
  sql: SqlStorage,
  org: string,
  link: PartnerLink & { card: string },
  at: number,
): void => {
  const token = newToken();
  sql.exec(
    "INSERT INTO links (hash, kind, card, job, partner, expires_at) VALUES (?, 'partner', ?, ?, ?, ?)",
    tokenHash(token),
    link.card,
    link.job,
    link.partner,
    LINK_NEVER_ENDS,
  );
  const body = JSON.stringify({ partner: link.partner, link: `/${org}/p/${token}` });
  sql.exec(
    "INSERT INTO vault (card, job, kind, from_party, body, at, forget_at) VALUES (?, ?, 'partner_link', 'system', ?, ?, NULL)",
    link.card,
    link.job,
    body,
    at,
  );
};

export const partnerLinkOf = (sql: SqlStorage, token: string): PartnerLink | null => {
  if (!TOKEN_PATTERN.test(token)) return null;
  const query = "SELECT job, partner FROM links WHERE hash = ? AND kind = 'partner' AND expires_at > ?";
  const row = sql
    .exec<{ job: string | null; partner: string | null }>(query, tokenHash(token), Date.now())
    .toArray()[0];
  return row?.job && row.partner ? { job: row.job, partner: row.partner } : null;
};

export const shownPartnerLink = (sql: SqlStorage, link: PartnerLink): string | null => {
  const rows = sql
    .exec<{ body: string }>(
      "SELECT body FROM vault WHERE job = ? AND kind = 'partner_link' ORDER BY id DESC",
      link.job,
    )
    .toArray();
  const bodies = rows.map((r) => PartnerLinkBody.parse(JSON.parse(r.body)));
  return bodies.find((b) => b.partner === link.partner)?.link ?? null;
};

const postRequest = async (request: Request, host: DoorHost): Promise<Response> => {
  if (!host.hasMembers()) return fail("not_found", "There is no such organisation.");
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!host.limit.allow(tokenHash(address), Date.now()))
    return fail("rate_limited", "Too many requests from this network. Please wait 10 minutes and try again.");
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = RequestFormSchema.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "Please check the form and try again.");
  const card = `c_${crypto.randomUUID()}`;
  return host.transaction(() => {
    const result = host.apply(submitFromForm(parsed.data, card), { role: "system", ref: null });
    if (result.status !== 200) return json(result.body, result.status);
    const tracking = insertTrackingLink(host.sql, host.org, card);
    logEvent({ op: "form", card });
    return json({ tracking }, 201);
  });
};

export const cardForMessage = (messageId: string): string => {
  const h = tokenHash(`email:${messageId}`);
  const variant = "89ab".charAt(parseInt(h.charAt(16), 16) % 4);
  return `c_${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

export const submitFromEmail = (mail: EmailIn, card: string): RequestSubmit | null => {
  const message = [mail.subject.trim(), mail.text.trim()].filter((t) => t.length > 0).join("\n");
  if (message.length === 0) return null;
  const firstName = /[\p{L}][\p{L}'-]*/u.exec(mail.fromName)?.[0].slice(0, 40) ?? "Resident";
  const zip = message.match(/\b\d{5}\b/g)?.find((candidate) => Object.hasOwn(SERVED_ZIPS, candidate)) ?? null;
  return {
    type: "request.submit",
    card,
    door: "email",
    zip,
    safeContact: true,
    firstName,
    contact: mail.fromAddress,
    address: null,
    message: message.slice(0, MESSAGE_LIMIT),
  };
};

const cardExists = (sql: SqlStorage, card: string): boolean =>
  sql.exec("SELECT 1 FROM events WHERE card = ? LIMIT 1", card).toArray().length > 0;

const postEmail = async (request: Request, host: DoorHost): Promise<Response> => {
  if (!sameSecret(request.headers.get("X-Door-Secret") ?? "", host.doorSecret))
    return fail("unauthorized", "The door secret is not right.");
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = EmailDoorSchema.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "The mail is not in the shape the mail door takes.");
  const card = cardForMessage(parsed.data.messageId);
  const submit = submitFromEmail(parsed.data, card);
  if (submit === null) return fail("invalid", "The mail has no words.");
  return host.transaction(() => {
    if (cardExists(host.sql, card)) return json({ card, repeated: true }, 200);
    const result = host.apply(submit, { role: "system", ref: null });
    if (result.status !== 200) return json(result.body, result.status);
    insertTrackingLink(host.sql, host.org, card);
    logEvent({ op: "email", card });
    return json({ card, repeated: false }, 201);
  });
};

const postTrackingCommand = async (request: Request, card: string, host: DoorHost): Promise<Response> => {
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = CommandSchema.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "The answer is not valid.");
  const command = parsed.data;
  if (!RESIDENT_TYPES.includes(command.type) || !("job" in command))
    return fail("forbidden", "This link can only answer questions about your request.");
  if (host.jobCard(command.job) !== card) return fail("not_found", "This request is not on this link.");
  if (host.jobClosed(command.job) && !host.sentBefore(command.id, card))
    return fail("wrong_state", "This request is closed.");
  const result = host.apply(command, { role: "resident", ref: card });
  return json(result.body, result.status);
};

const postPartnerCommand = async (request: Request, link: PartnerLink, host: DoorHost): Promise<Response> => {
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = CommandSchema.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "The answer is not valid.");
  const command = parsed.data;
  if (!PARTNER_TYPES.includes(command.type))
    return fail("forbidden", "This link can only answer the request it was sent for.");
  if ("job" in command && command.job !== link.job)
    return fail("not_found", "This request is not on this link.");
  const result = host.apply(command, { role: "partner", ref: link.partner });
  return json(result.body, result.status);
};

const routeLink = (
  request: Request,
  route: string,
  kind: string,
  token: string,
  host: DoorHost,
): Promise<Response> => {
  if (kind === "t") {
    const card = trackingCard(host.sql, token);
    if (card === null) return Promise.resolve(fail("not_found", "This link does not work."));
    return route === "GET " ? Promise.resolve(host.tracking(card)) : postTrackingCommand(request, card, host);
  }
  const link = partnerLinkOf(host.sql, token);
  if (link === null) return Promise.resolve(fail("not_found", "This link does not work."));
  return route === "GET " ? Promise.resolve(host.partnerCard(link)) : postPartnerCommand(request, link, host);
};

export const routeDoor = (
  request: Request,
  parts: readonly string[],
  host: DoorHost,
): Promise<Response> | null => {
  const [first, token, last, ...extra] = parts;
  if (extra.length > 0) return null;
  if (request.method === "POST" && first === "requests" && token === undefined)
    return postRequest(request, host);
  if (request.method === "POST" && first === "doors" && token === "email" && last === undefined)
    return postEmail(request, host);
  const googleAction = first === "google" && last === undefined ? token : undefined;
  if (request.method === "POST" && (googleAction === "playbook" || googleAction === "statement"))
    return routeGoogle(request, googleAction, host.google);
  if ((first !== "t" && first !== "p") || token === undefined) return null;
  const route = `${request.method} ${last ?? ""}`;
  if (route !== "GET " && route !== "POST commands") return null;
  return routeLink(request, route, first, token, host);
};
