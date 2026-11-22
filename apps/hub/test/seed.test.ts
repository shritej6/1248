import { env as workerEnv } from "cloudflare:workers";
import { MemberRecordSchema } from "@vision/contracts";
import { expect, it } from "vitest";
import { z } from "zod";
import membersJson from "../../../data/synthetic/members.json";
import partnersJson from "../../../data/synthetic/partners.json";
import { SeedError, codesText, seedOrg } from "../scripts/seed.js";
import type { Env } from "../src/orghub.js";
import { exportLedger, freshOrg, hubFetch, joinWith, sql } from "./helpers.js";

const env = workerEnv as unknown as Env;
const MEMBERS = z.array(MemberRecordSchema).parse(membersJson);
const seedFor = (org: string) =>
  seedOrg({ fetcher: hubFetch, base: "https://hub.test", org, bootstrapCode: env.BOOTSTRAP_CODE });

type MemberRow = { name: string; roles: string; on_duty: number };

it("the seed loads 16 members, 2 partners and the 14 playbook rows", async () => {
  const org = freshOrg();
  await seedFor(org);
  const members = await sql(org, (s) =>
    s.exec<MemberRow>("SELECT name, roles, on_duty FROM members").toArray(),
  );
  expect(members.map((m) => m.name).sort()).toEqual(MEMBERS.map((m) => m.name).sort());
  const partners = await sql(org, (s) => s.exec<{ name: string }>("SELECT name FROM partners").toArray());
  expect(partners.map((p) => p.name).sort()).toEqual(partnersJson.map((p) => p.name).sort());
  const rows = await sql(org, (s) => s.exec<{ rows: string }>("SELECT rows FROM playbook").one().rows);
  expect(JSON.parse(rows)).toHaveLength(14);
  const loaded = (await exportLedger(org)).events.find((e) => e.type === "playbook.loaded");
  expect(loaded?.data).toMatchObject({ rows: 14 });
});

type IdRow = { id: string; name: string };

it("the seed points the playbook at the partners and owners it made", async () => {
  const org = freshOrg();
  await seedFor(org);
  const partners = await sql(org, (s) => s.exec<IdRow>("SELECT id, name FROM partners").toArray());
  const members = await sql(org, (s) => s.exec<IdRow>("SELECT id, name FROM members").toArray());
  const rows = await sql(org, (s) => s.exec<{ rows: string }>("SELECT rows FROM playbook").one().rows);
  const parsed = z
    .array(z.object({ owner: z.string(), ladder: z.array(z.object({ partner: z.string().optional() })) }))
    .parse(JSON.parse(rows));
  const ladderPartners = parsed.flatMap((r) => r.ladder.flatMap((rung) => rung.partner ?? []));
  expect(ladderPartners.length).toBeGreaterThan(0);
  const partnerIds = new Set(partners.map((p) => p.id));
  expect(ladderPartners.every((id) => partnerIds.has(id))).toBe(true);
  const memberIds = new Set(members.map((m) => m.id));
  expect(parsed.every((r) => memberIds.has(r.owner))).toBe(true);
});

it("the seed turns on the volunteers who are on in the synthetic data", async () => {
  const org = freshOrg();
  await seedFor(org);
  const members = await sql(org, (s) =>
    s.exec<MemberRow>("SELECT name, roles, on_duty FROM members").toArray(),
  );
  const onNow = members.filter((m) => m.on_duty === 1).map((m) => m.name);
  const expected = MEMBERS.filter((m) => m.on && m.roles.includes("volunteer")).map((m) => m.name);
  expect(onNow.sort()).toEqual(expected.sort());
  expect(onNow).toEqual(expect.arrayContaining(["Avery Snow (test)", "Blake Frost (test)"]));
});

it("each member gets one join code that signs in once", async () => {
  const org = freshOrg();
  const { codes } = await seedFor(org);
  expect(codes).toHaveLength(16);
  for (const entry of codes) {
    const r = await joinWith(org, entry.code);
    expect(r.status).toBe(200);
    const body = await r.json<{ member: { roles: string[] } }>();
    expect(body.member.roles).toEqual(entry.roles);
  }
  expect(
    codesText(org, codes)
      .split("\n")
      .filter((l) => l.includes("(test)")),
  ).toHaveLength(16);
});

it("a second seed of the same organisation stops with a clear error", async () => {
  const org = freshOrg();
  await seedFor(org);
  await expect(seedFor(org)).rejects.toBeInstanceOf(SeedError);
  const count = await sql(org, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n);
  expect(count).toBe(16);
});
