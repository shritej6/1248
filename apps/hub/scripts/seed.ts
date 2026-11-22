import { z } from "zod";
import configJson from "../../../data/synthetic/config.json" with { type: "json" };
import membersJson from "../../../data/synthetic/members.json" with { type: "json" };
import partnersJson from "../../../data/synthetic/partners.json" with { type: "json" };
import playbookJson from "../../../data/synthetic/playbook.json" with { type: "json" };

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export type SeedOptions = { fetcher: Fetcher; base: string; org: string; bootstrapCode: string };
export type SeedCode = { name: string; roles: string[]; code: string };
export type SeedResult = { org: string; codes: SeedCode[] };

type SeedMember = (typeof membersJson)[number];
type Post = <T>(step: string, path: string, body: unknown, schema: z.ZodType<T>) => Promise<T>;

export class SeedError extends Error {
  readonly step: string;
  readonly status: number;

  constructor(step: string, status: number, message: string) {
    super(message);
    this.name = "SeedError";
    this.step = step;
    this.status = status;
  }
}

const RETRY_WAITS_MS = [500, 1000];
const SessionBody = z.object({ session: z.string(), member: z.object({ id: z.string() }) });
const IdBody = z.object({ id: z.string() });
const CodeBody = z.object({ code: z.string() });
const AnyBody = z.unknown();
const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const fetchWithRetry = async (fetcher: Fetcher, url: string, init: RequestInit): Promise<Response> => {
  for (const [attempt, delay] of [...RETRY_WAITS_MS, null].entries()) {
    try {
      return await fetcher(url, init);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (delay === null) {
        throw new SeedError(
          "connect",
          0,
          `The hub at ${url} did not answer after ${String(attempt + 1)} tries: ${reason}`,
        );
      }
      await wait(delay);
    }
  }
  throw new SeedError("connect", 0, `The hub at ${url} did not answer.`);
};

const poster = (options: SeedOptions, session: { token: string | null }): Post => {
  const root = `${options.base}/api/v1/o/${options.org}`;
  return async (step, path, body, schema) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session.token !== null) headers.Authorization = `Bearer ${session.token}`;
    const init = { method: "POST", headers, body: JSON.stringify(body) };
    const response = await fetchWithRetry(options.fetcher, `${root}/${path}`, init);
    const parsed: unknown = await response.json();
    if (!response.ok) {
      const error = ErrorBody.safeParse(parsed);
      const detail = error.success ? `${error.data.error.code}: ${error.data.error.message}` : "no detail";
      throw new SeedError(
        step,
        response.status,
        `${step} failed with ${String(response.status)} (${detail})`,
      );
    }
    return schema.parse(parsed);
  };
};

const command = <T>(post: Post, step: string, body: Record<string, unknown>, schema: z.ZodType<T>) =>
  post(step, "commands", { id: `cmd_${crypto.randomUUID()}`, ...body }, schema);

export const contactOf = (name: string): string =>
  `${name
    .replace(" (test)", "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")}@example.test`;

const firstOrganiser = (): SeedMember => {
  const found = membersJson.find((m) => m.roles.includes("organiser"));
  if (found === undefined) throw new SeedError("data", 0, "The synthetic members have no organiser.");
  return found;
};

const addMembers = async (post: Post, organiser: SeedMember, organiserId: string) => {
  const ids = new Map<SeedMember, string>([[organiser, organiserId]]);
  for (const m of membersJson.filter((x) => x !== organiser)) {
    const body = { type: "member.add", name: m.name, contact: contactOf(m.name), roles: m.roles };
    const added = await command(post, `add ${m.name}`, { ...body, skills: m.skills, zip: m.zip }, IdBody);
    ids.set(m, added.id);
  }
  return ids;
};

const turnOn = async (options: SeedOptions, post: Post, member: SeedMember, id: string) => {
  const step = `turn on ${member.name}`;
  const { code } = await command(post, step, { type: "join.create", member: id }, CodeBody);
  const volunteer = { token: null as string | null };
  const asVolunteer = poster(options, volunteer);
  volunteer.token = (await asVolunteer(step, "join", { code }, SessionBody)).session;
  await command(asVolunteer, step, { type: "member.set_on", on: true }, AnyBody);
};

const addPartners = async (post: Post): Promise<Map<string, string>> => {
  const ids = new Map<string, string>();
  for (const p of partnersJson) {
    const body = { type: "partner.add", name: p.name, contact: contactOf(p.name) };
    ids.set(p.id, (await command(post, `add ${p.name}`, body, IdBody)).id);
  }
  return ids;
};

const madeId = (ids: Map<string, string>, synthetic: string): string => {
  const made = ids.get(synthetic);
  if (made === undefined)
    throw new SeedError("data", 0, `The playbook names ${synthetic}, which the seed did not make.`);
  return made;
};

const playbookFor = (members: Map<SeedMember, string>, partners: Map<string, string>) => {
  const owners = new Map([...members].map(([m, id]) => [m.id, id]));
  const rows = playbookJson.rows.map((row) => ({
    ...row,
    owner: madeId(owners, row.owner),
    ladder: row.ladder.map((rung) =>
      "partner" in rung ? { ...rung, partner: madeId(partners, rung.partner) } : rung,
    ),
  }));
  return { ...playbookJson, rows };
};

export const seedOrg = async (options: SeedOptions): Promise<SeedResult> => {
  const session = { token: null as string | null };
  const post = poster(options, session);
  const organiser = firstOrganiser();
  const contact = contactOf(organiser.name);
  const first = { code: options.bootstrapCode, name: organiser.name, contact, orgName: configJson.orgName };
  const boot = await post("bootstrap", "bootstrap", first, SessionBody);
  session.token = boot.session;
  const ids = await addMembers(post, organiser, boot.member.id);
  const playbook = playbookFor(ids, await addPartners(post));
  await command(post, "load playbook", { type: "playbook.load", playbook }, AnyBody);
  const codes: SeedCode[] = [];
  for (const [m, id] of ids) {
    if (m.on && m.roles.includes("volunteer")) await turnOn(options, post, m, id);
    const { code } = await command(post, `code for ${m.name}`, { type: "join.create", member: id }, CodeBody);
    codes.push({ name: m.name, roles: m.roles, code });
  }
  return { org: options.org, codes };
};

export const codesText = (org: string, codes: SeedCode[]): string =>
  [
    `Vision join codes for ${org}. All people are synthetic test people.`,
    "Each code works once and ends 24 hours after the seed.",
    "",
    ...codes.map((c) => `${c.name} | ${c.roles.join(", ")} | ${c.code}`),
  ].join("\n");

type CliProcess = { env: Record<string, string | undefined>; exitCode?: number };

const runCli = async (proc: CliProcess): Promise<void> => {
  const bootstrapCode = proc.env.BOOTSTRAP_CODE ?? "";
  if (bootstrapCode.length === 0) {
    throw new SeedError("config", 0, "Set BOOTSTRAP_CODE in apps/hub/.dev.vars (copy .dev.vars.example).");
  }
  const base = proc.env.HUB_URL ?? "http://localhost:8787";
  const org = proc.env.SEED_ORG ?? configJson.org;
  const result = await seedOrg({ fetcher: (url, init) => fetch(url, init), base, org, bootstrapCode });
  console.log(codesText(result.org, result.codes));
};

const cliProcess = (globalThis as unknown as { process?: CliProcess }).process;
if (import.meta.main && cliProcess !== undefined) {
  runCli(cliProcess).catch((error: unknown) => {
    console.error(error instanceof Error ? `seed: ${error.message}` : `seed: ${String(error)}`);
    cliProcess.exitCode = 1;
  });
}
