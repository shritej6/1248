import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env as workerEnv, exports as workerExports } from "cloudflare:workers";
import {
  DeskBoardSchema,
  JobCardSchema,
  LedgerEventSchema,
  MemberRecordSchema,
  PlaybookSchema,
  VolunteerHomeSchema,
  type LedgerEvent,
  type RequestSubmit,
} from "@vision/contracts";
import { z } from "zod";
import membersJson from "../../../data/synthetic/members.json";
import playbookJson from "../../../data/synthetic/playbook.json";
import { sessionStore } from "../src/auth.js";
import type { Env, OrgHub } from "../src/orghub.js";

const env = workerEnv as unknown as Env;
const worker = (workerExports as unknown as { default: Fetcher }).default;

export const hubFetch = (url: string, init?: RequestInit): Promise<Response> => worker.fetch(url, init);

const BASE = "https://hub.test/api/v1/o";
const MEMBERS = z.array(MemberRecordSchema).parse(membersJson);
const PLAYBOOK = PlaybookSchema.parse(playbookJson);
const ALIAS_ROLE = { d: "desk", v: "volunteer", o: "organiser", l: "lead" } as const;

const ExportSchema = z.object({ events: z.array(LedgerEventSchema), sealed: z.object({ ok: z.boolean() }) });
type Export = { events: LedgerEvent[]; sealed: { ok: boolean } };
const VIEW_SCHEMAS = { desk: DeskBoardSchema, home: VolunteerHomeSchema, job: JobCardSchema } as const;

export const newId = (): string => `cmd_${crypto.randomUUID()}`;
export const freshOrg = (): string => `comforce-${crypto.randomUUID().slice(0, 8)}`;
export const newCard = (): string => `c_${crypto.randomUUID()}`;

export const memberFor = (alias: string): z.infer<typeof MemberRecordSchema> => {
  const match = /^m_([dvol])(\d{2})$/.exec(alias);
  const role = match ? ALIAS_ROLE[match[1] as keyof typeof ALIAS_ROLE] : undefined;
  const found = role ? MEMBERS.filter((m) => m.roles.includes(role))[Number(match?.[2]) - 1] : undefined;
  if (found === undefined) throw new Error(`No synthetic member for ${alias}`);
  return found;
};

const stub = (org: string) => env.ORG.getByName(org);

export const post = (path: string, body: unknown, token?: string): Promise<Response> =>
  hubFetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

export const get = (path: string, token: string): Promise<Response> =>
  hubFetch(`${BASE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });

export const bootstrap = async (org: string): Promise<string> => {
  const r = await post(`${org}/bootstrap`, {
    code: env.BOOTSTRAP_CODE,
    name: "Quinn Organiser (test)",
    contact: "organiser@example.test",
  });
  const body = await r.json<{ session: string }>();
  return body.session;
};

export const sql = <T>(org: string, run: (s: SqlStorage) => T): Promise<T> =>
  runInDurableObject(stub(org), (_hub, state) => run(state.storage.sql));

export const organiser = async (org: string): Promise<string> => {
  const id = await sql(
    org,
    (s) =>
      s.exec<{ id: string }>("SELECT id FROM members WHERE roles LIKE '%organiser%'").toArray()[0]?.id ??
      null,
  );
  if (id === null) return bootstrap(org);
  return sql(org, (s) => sessionStore(s).createSession(id, Date.now()));
};

export const send = (org: string, token: string, command: unknown): Promise<Response> =>
  post(`${org}/commands`, command, token);

const ensureMember = async (org: string, alias: string): Promise<string> => {
  await organiser(org);
  const m = memberFor(alias);
  await sql(org, (s) =>
    s.exec(
      "INSERT OR IGNORE INTO members (id, name, contact, roles, skills, zip, on_duty, last_job_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
      m.id,
      m.name,
      `${alias}@example.test`,
      JSON.stringify(m.roles),
      JSON.stringify(m.skills),
      m.zip,
      m.on ? 1 : 0,
    ),
  );
  return m.id;
};

export const createJoinCode = async (org: string, alias: string): Promise<string> => {
  const id = await ensureMember(org, alias);
  const r = await send(org, await organiser(org), { id: newId(), type: "join.create", member: id });
  return (await r.json<{ code: string }>()).code;
};

export const joinWith = (org: string, code: string): Promise<Response> => post(`${org}/join`, { code });

export const join = async (org: string, alias: string): Promise<string> => {
  const r = await joinWith(org, await createJoinCode(org, alias));
  return (await r.json<{ session: string }>()).session;
};

export const ledgerLength = (org: string): Promise<number> =>
  sql(org, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").one().n);

export const exportLedger = async (org: string): Promise<Export> => {
  const r = await get(`${org}/export`, await organiser(org));
  return ExportSchema.parse(await r.json());
};

export const view = async (
  org: string,
  name: keyof typeof VIEW_SCHEMAS,
  alias = "m_d01",
  query = "",
): Promise<unknown> => {
  const r = await get(`${org}/views/${name}${query}`, await join(org, alias));
  return VIEW_SCHEMAS[name].parse(await r.json());
};

export const evict = (org: string): Promise<void> => evictDurableObject(stub(org));

export const errorCode = async (r: Response): Promise<string> =>
  (await r.json<{ error: { code: string } }>()).error.code;

type FormFields = { firstName: string; address: string | null; message: string };

export const submitForm = async (org: string, fields: FormFields): Promise<string> => {
  const card = newCard();
  const command: RequestSubmit = {
    type: "request.submit",
    card,
    door: "form",
    zip: "53216",
    safeContact: true,
    contact: "resident@example.test",
    ...fields,
  };
  await runInDurableObject(stub(org), (hub: OrgHub) =>
    hub.applyCommand(command, { role: "system", ref: null }),
  );
  return card;
};

export const accept = (job: string) => ({ id: newId(), type: "offer.accept", job });
export const confirmCmd = (card: string) => ({
  id: newId(),
  type: "card.confirm",
  card,
  need: "snow",
  urgency: "low",
  division: null,
});

export const jobOfCard = async (org: string, card: string): Promise<string> => {
  const planned = (await exportLedger(org)).events.find((e) => e.type === "job.planned" && e.card === card);
  if (planned?.job == null) throw new Error("The snow card has no planned job");
  return planned.job;
};

export const loadPlaybook = (org: string): Promise<void> =>
  sql(org, (s) => {
    s.exec(
      "INSERT OR REPLACE INTO playbook (version, rows, loaded_at) VALUES (?, ?, ?)",
      PLAYBOOK.version,
      JSON.stringify(PLAYBOOK.rows),
      Date.now(),
    );
  });

export const offeredSnowJob = async (org: string): Promise<{ v1: string; v2: string; job: string }> => {
  const [desk, v1, v2] = [await join(org, "m_d01"), await join(org, "m_v01"), await join(org, "m_v02")];
  await loadPlaybook(org);
  const card = await submitForm(org, {
    firstName: "Avery",
    address: "1 Test St",
    message: "Snow on my walk",
  });
  await send(org, desk, confirmCmd(card));
  const job = await jobOfCard(org, card);
  await send(org, desk, { id: newId(), type: "job.approve", job });
  return { v1, v2, job };
};
