import type { Actor, Effect, FailedSend, LedgerEvent, SortResult } from "@vision/contracts";
import { createSorter, type ModelRun, type Sorter, type Wait } from "@vision/core";
import { z } from "zod";
import { aiKind, isAiKind } from "./ai/registry.js";
import { postToGoogle } from "./google.js";
import { logEvent } from "./http.js";
import { mailWords, type ResidentMessage } from "./render.js";
import { DRAFT_KIND } from "./resources/kind.js";
import { Store } from "./store.js";

export const MAX_TRIES = 3;
const FIRST_WAIT_MS = 30_000;
const WAIT_GROWTH = 4;

export type OutboxRow = {
  id: number;
  kind: string;
  payload: string;
  tries: number;
  next_at: number;
  last_error: string | null;
};

export type Sender = (row: OutboxRow) => Promise<void>;
export type GiveUp = (row: OutboxRow) => void;

export const retryWait = (tries: number): number => FIRST_WAIT_MS * WAIT_GROWTH ** (tries - 1);

export const enqueue = (
  sql: SqlStorage,
  item: { kind: string; card: string | null; payload: unknown },
  at: number,
): void => {
  sql.exec(
    "INSERT INTO outbox (kind, card, payload, tries, next_at) VALUES (?, ?, ?, 0, ?)",
    item.kind,
    item.card,
    JSON.stringify(item.payload),
    at,
  );
};

export const nextOutboxAt = (sql: SqlStorage): number | null =>
  sql.exec<{ at: number | null }>("SELECT MIN(next_at) AS at FROM outbox WHERE tries < ?", MAX_TRIES).one()
    .at;

export const failedSends = (sql: SqlStorage): FailedSend[] =>
  sql
    .exec<FailedSend>(
      "SELECT kind, card, tries, last_error AS lastError, next_at AS at FROM outbox WHERE tries >= ? ORDER BY next_at, id",
      MAX_TRIES,
    )
    .toArray();

const dueRows = (sql: SqlStorage, now: number): OutboxRow[] =>
  sql
    .exec<OutboxRow>(
      "SELECT id, kind, payload, tries, next_at, last_error FROM outbox WHERE tries < ? AND next_at <= ? ORDER BY kind = ?, next_at, id",
      MAX_TRIES,
      now,
      DRAFT_KIND,
    )
    .toArray();

const recordFailure = (sql: SqlStorage, row: OutboxRow, error: unknown, now: number): number => {
  const tries = row.tries + 1;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : "The outside call failed.";
  const nextAt = tries < MAX_TRIES ? now + retryWait(tries) : row.next_at;
  sql.exec(
    "UPDATE outbox SET tries = ?, next_at = ?, last_error = ? WHERE id = ?",
    tries,
    nextAt,
    message,
    row.id,
  );
  logEvent({ op: "outbox", id: row.id, kind: row.kind, tries, status: "failed" });
  return tries;
};

export const drainOutbox = async (
  sql: SqlStorage,
  now: number,
  send: Sender,
  giveUp: GiveUp = () => undefined,
): Promise<number> => {
  let sent = 0;
  for (const row of dueRows(sql, now)) {
    try {
      await send(row);
      sql.exec("DELETE FROM outbox WHERE id = ?", row.id);
      sent += 1;
    } catch (error) {
      if (recordFailure(sql, row, error, now) >= MAX_TRIES) giveUp(row);
    }
    if (row.kind === DRAFT_KIND) break;
  }
  return sent;
};

type Target = { url: string; secret: string; fetcher: typeof fetch };

export const outsideSender =
  (target: Target): Sender =>
  (row) =>
    postToGoogle(target, row.kind, JSON.parse(row.payload) as Record<string, unknown>);

const LEDGER_KIND = "ledger";

const unsentLedger = (sql: SqlStorage): { start: number | null; last: number | null } =>
  sql
    .exec<{ start: number | null; last: number | null }>(
      "SELECT MIN(json_extract(payload, '$.from')) AS start, MAX(id) AS last FROM outbox WHERE kind = ?",
      LEDGER_KIND,
    )
    .one();

const ledgerSender =
  (sql: SqlStorage, target: Target): Sender =>
  async () => {
    const { start, last } = unsentLedger(sql);
    if (start === null || last === null) return;
    await postToGoogle(target, LEDGER_KIND, { lines: new Store(sql).events(start - 1) });
    sql.exec("DELETE FROM outbox WHERE kind = ? AND id <= ?", LEDGER_KIND, last);
  };

export const SORT_KIND = "sort";

export const enqueueSorts = (sql: SqlStorage, effects: readonly Effect[], at: number): void => {
  for (const e of effects) {
    if (e.kind === "sort") enqueue(sql, { kind: SORT_KIND, card: e.card, payload: { card: e.card } }, at);
    if (e.kind === "ai") enqueue(sql, { kind: aiKind(e.job), card: e.card, payload: { card: e.card } }, at);
    if (e.kind === "draft") enqueue(sql, { kind: DRAFT_KIND, card: null, payload: { draft: e.draft } }, at);
  }
};

const PAGE_SUBJECT = "Vision page: please answer now";
const PAGE_BODY = "A request needs a person now. Open Vision and answer the page.";
const EMAIL = /^[^\s@]+@[^\s@]+$/;
export const MAIL_CARDS_PER_ADDRESS = 3;
const MAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const PersonContact = z.object({ contact: z.string() });
const SafeData = z.object({ safeContact: z.boolean() });

const GMAIL: readonly string[] = ["gmail.com", "googlemail.com"];

export const mailKey = (address: string): string => {
  const lower = address.trim().toLowerCase().replace(/\.+$/, "");
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  const domain = lower.slice(at + 1);
  const local = lower.slice(0, at).split("+")[0] ?? "";
  return GMAIL.includes(domain) ? `${local.replaceAll(".", "")}@gmail.com` : `${local}@${domain}`;
};

type Mail = { kind: "mail"; card: string | null; payload: { to: string; subject: string; body: string } };

const firstText = (sql: SqlStorage, card: string, kind: string): string | null =>
  sql
    .exec<{ body: string }>(
      "SELECT body FROM vault WHERE card = ? AND kind = ? ORDER BY id LIMIT 1",
      card,
      kind,
    )
    .toArray()[0]?.body ?? null;

type Received = { seq: number; at: number; data: string };

const receivedRow = (sql: SqlStorage, card: string): Received | undefined =>
  sql
    .exec<Received>(
      "SELECT seq, at, data FROM events WHERE card = ? AND type = 'card.received' LIMIT 1",
      card,
    )
    .toArray()[0];

const earlierCardsTo = (sql: SqlStorage, to: string, received: Received): number =>
  sql
    .exec<{ body: string }>(
      "SELECT v.body FROM events e JOIN vault v ON v.card = e.card WHERE v.kind = 'person' AND e.type = 'card.received' AND e.seq <= ? AND e.at > ?",
      received.seq,
      received.at - MAIL_WINDOW_MS,
    )
    .toArray()
    .filter((row) => mailKey(PersonContact.parse(JSON.parse(row.body)).contact) === mailKey(to)).length;

const safeToMail = (sql: SqlStorage, card: string, to: string): boolean => {
  const received = receivedRow(sql, card);
  if (received === undefined || !SafeData.parse(JSON.parse(received.data)).safeContact) return false;
  return earlierCardsTo(sql, to, received) <= MAIL_CARDS_PER_ADDRESS;
};

const residentMail = (sql: SqlStorage, message: ResidentMessage, origin: string): Mail | null => {
  const person = firstText(sql, message.card, "person");
  const to = person === null ? null : PersonContact.parse(JSON.parse(person)).contact;
  if (to === null || !EMAIL.test(to) || !safeToMail(sql, message.card, to)) return null;
  const link = firstText(sql, message.card, "tracking_link");
  const words = mailWords(message.lang);
  const body = link === null ? message.text : `${message.text}\n\n${words.link} ${origin}${link}`;
  return { kind: "mail", card: message.card, payload: { to, subject: words.subject, body } };
};

const pageMail = (sql: SqlStorage, member: string): Mail | null => {
  const row = sql.exec<{ contact: string }>("SELECT contact FROM members WHERE id = ?", member).toArray()[0];
  if (row === undefined || !EMAIL.test(row.contact)) return null;
  return { kind: "mail", card: null, payload: { to: row.contact, subject: PAGE_SUBJECT, body: PAGE_BODY } };
};

const outsideMails = (sql: SqlStorage, work: OutsideWork, origin: string): Mail[] => [
  ...work.messages.flatMap((m) => residentMail(sql, m, origin) ?? []),
  ...work.effects.flatMap((e) => (e.kind === "page" ? (pageMail(sql, e.member) ?? []) : [])),
];

export type OutsideWork = {
  effects: readonly Effect[];
  lines: readonly LedgerEvent[];
  messages: readonly ResidentMessage[];
};

export const enqueueOutside = (
  sql: SqlStorage,
  work: OutsideWork,
  hub: { at: number; google: boolean; origin: string },
): void => {
  enqueueSorts(sql, work.effects, hub.at);
  if (!hub.google) return;
  const first = work.lines[0];
  if (first !== undefined)
    enqueue(sql, { kind: LEDGER_KIND, card: null, payload: { from: first.seq } }, hub.at);
  for (const mail of outsideMails(sql, work, hub.origin)) enqueue(sql, mail, hub.at);
};

export type SortHost = {
  sorter: Sorter;
  messageOf(card: string): string | null;
  apply(result: SortResult, actor: Actor): unknown;
};

export const sortSender =
  (host: SortHost): Sender =>
  async (row) => {
    const { card } = JSON.parse(row.payload) as { card: string };
    const message = host.messageOf(card);
    if (message === null) {
      logEvent({ op: "sort", id: row.id, status: "no_message" });
      return;
    }
    const answer = await host.sorter({ id: card, text: message });
    const passes = "passes" in answer ? answer.passes : null;
    const error = "error" in answer ? answer.error : null;
    host.apply({ type: "sort.result", card, message, passes, error }, { role: "system", ref: null });
  };

export const routedSender =
  (routes: { sort: Sender; ledger: Sender; outside: Sender; ai: Sender }): Sender =>
  (row) => {
    if (row.kind === SORT_KIND) return routes.sort(row);
    if (isAiKind(row.kind)) return routes.ai(row);
    return row.kind === LEDGER_KIND ? routes.ledger(row) : routes.outside(row);
  };

export type SenderEnv = {
  AI: { run: ModelRun };
  SORTER_MODEL: string;
  GOOGLE_URL?: string;
  GOOGLE_SECRET?: string;
};

const sleep: Wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const messageIn = (sql: SqlStorage, card: string): string | null =>
  sql
    .exec<{ body: string }>(
      "SELECT body FROM vault WHERE card = ? AND kind = 'message_in' ORDER BY id LIMIT 1",
      card,
    )
    .toArray()[0]?.body ?? null;

export const hubSender = (env: SenderEnv, sql: SqlStorage, apply: SortHost["apply"], ai: Sender): Sender => {
  const target: Target = {
    url: env.GOOGLE_URL ?? "",
    secret: env.GOOGLE_SECRET ?? "",
    fetcher: (input, init) => fetch(input, init),
  };
  return routedSender({
    sort: sortSender({
      sorter: createSorter((m, input) => env.AI.run(m, input), env.SORTER_MODEL, {
        wait: sleep,
        log: logEvent,
      }),
      messageOf: (card) => messageIn(sql, card),
      apply,
    }),
    ledger: ledgerSender(sql, target),
    outside: outsideSender(target),
    ai,
  });
};
