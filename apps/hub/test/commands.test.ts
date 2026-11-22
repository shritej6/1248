import { DeskBoardSchema, LedgerEventSchema } from "@vision/contracts";
import { beforeEach, expect, it } from "vitest";
import { Store } from "../src/store.js";
import {
  accept,
  confirmCmd,
  createJoinCode,
  errorCode,
  evict,
  exportLedger,
  join,
  ledgerLength,
  memberFor,
  newCard,
  newId,
  offeredSnowJob,
  organiser,
  send,
  sql,
  submitForm,
  view,
  freshOrg,
} from "./helpers.js";

let ORG = freshOrg();
beforeEach(() => {
  ORG = freshOrg();
});

it("commands_resend_returns_first_result", async () => {
  const t = await join(ORG, "m_d01");
  const cmd = { id: "cmd_7f9c0d1e-1111-4111-8111-111111111111", type: "shift.take" };
  const a = await send(ORG, t, cmd);
  const b = await send(ORG, t, cmd);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(await b.json()).toEqual(await a.json());
  expect(await ledgerLength(ORG)).toBe(1);
});

it("two_accepts_one_wins", async () => {
  const { v1, v2, job } = await offeredSnowJob(ORG);
  const [a, b] = await Promise.all([send(ORG, v1, accept(job)), send(ORG, v2, accept(job))]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  const loser = [a, b].find((r) => r.status === 409);
  expect(loser && (await errorCode(loser))).toBe("taken");
});

it("no session gives 401 and a wrong role gives 403", async () => {
  expect((await send(ORG, "bad", { id: newId(), type: "shift.take" })).status).toBe(401);
  const v = await join(ORG, "m_v01");
  expect((await send(ORG, v, confirmCmd(newCard()))).status).toBe(403);
});

it("restart rebuilds state from the snapshot", async () => {
  const taken = await send(ORG, await join(ORG, "m_d01"), { id: newId(), type: "shift.take" });
  expect(taken.status).toBe(200);
  await taken.json();
  const board = async (): Promise<unknown> => {
    const { clock, ...rest } = DeskBoardSchema.parse(await view(ORG, "desk"));
    return { ...rest, offsetMs: clock.offsetMs };
  };
  const before = await board();
  await evict(ORG);
  expect(await board()).toEqual(before);
});

it("ledger_has_no_pii", async () => {
  await submitForm(ORG, { firstName: "Avery", address: "1 Test St", message: "Snow on my walk" });
  const ledger = await exportLedger(ORG);
  expect(ledger.events.length).toBeGreaterThan(0);
  expect(JSON.stringify(ledger)).not.toMatch(/Avery|Test St|Snow on my walk/);
});

it("a body over 16 KB is refused with too_large", async () => {
  const t = await join(ORG, "m_d01");
  const r = await send(ORG, t, {
    id: newId(),
    type: "thread.post",
    card: newCard(),
    text: "a".repeat(17 * 1024),
  });
  expect(r.status).toBe(413);
});

it("restart continues the sealed ledger from the snapshot", async () => {
  await submitForm(ORG, { firstName: "Avery", address: "1 Test St", message: "Snow on my walk" });
  const first = await ledgerLength(ORG);
  await evict(ORG);
  await submitForm(ORG, { firstName: "Blake", address: null, message: "Ice on the steps" });
  const ledger = await exportLedger(ORG);
  expect(ledger.events).toHaveLength(first * 2);
  expect(ledger.sealed.ok).toBe(true);
});

it("a reused command id from another member or for another type is refused", async () => {
  const o = await organiser(ORG);
  const id = newId();
  const first = await send(ORG, o, {
    id,
    type: "partner.add",
    name: "Test Pantry",
    contact: "p@example.test",
  });
  expect(first.status).toBe(200);
  const other = await send(ORG, o, {
    id,
    type: "member.add",
    name: "T",
    contact: "t@example.test",
    roles: ["volunteer"],
    skills: [],
    zip: null,
  });
  expect(other.status).toBe(400);
  const desk = await join(ORG, "m_d01");
  const stolen = await send(ORG, desk, { ...confirmCmd(newCard()), id });
  expect(stolen.status).toBe(400);
  expect(JSON.stringify(await stolen.json())).not.toMatch(/p_/);
});

it("a resent join.create does not show the code again or keep it", async () => {
  const o = await organiser(ORG);
  const member = memberFor("m_v01").id;
  await createJoinCode(ORG, "m_v01");
  const cmd = { id: newId(), type: "join.create", member };
  const first = await send(ORG, o, cmd);
  const { code } = await first.json<{ code: string }>();
  const again = await send(ORG, o, cmd);
  expect(again.status).toBe(409);
  const stored = await sql(ORG, (s) => s.exec<{ body: string }>("SELECT body FROM commands").toArray());
  expect(JSON.stringify(await again.json()) + JSON.stringify(stored)).not.toContain(code);
});

it("a pass is not kept and a taken job keeps no offer rows", async () => {
  const { v1, v2, job } = await offeredSnowJob(ORG);
  expect((await send(ORG, v1, { id: newId(), type: "offer.pass", job })).status).toBe(200);
  const columns = await sql(ORG, (s) => s.exec<{ name: string }>("PRAGMA table_info(offers)").toArray());
  expect(columns.map((c) => c.name)).not.toContain("passed_at");
  expect((await send(ORG, v2, accept(job))).status).toBe(200);
  const rows = await sql(
    ORG,
    (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM offers WHERE job = ?", job).one().n,
  );
  expect(rows).toBe(0);
});

it.each([
  ["job.returned", { reason: "no_volunteer" }],
  ["job.unmet", {}],
  ["job.closed", { result: "withdrawn", reason: "cancelled" }],
] as const)("a job that ends with %s keeps no offer rows", async (type, data) => {
  const { job } = await offeredSnowJob(ORG);
  const count = (s: SqlStorage): number =>
    s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM offers WHERE job = ?", job).one().n;
  expect(await sql(ORG, count)).toBeGreaterThan(0);
  const left = await sql(ORG, (s) => {
    const store = new Store(s);
    const sent = store.events().find((e) => e.job === job && e.type === "offer.wave_sent");
    if (sent === undefined) throw new Error("The snow job has no wave");
    store.noteAccepts([LedgerEventSchema.parse({ ...sent, type, data })]);
    return count(s);
  });
  expect(left).toBe(0);
});

it("a volunteer sees the offer of a wave on the home view", async () => {
  const { job } = await offeredSnowJob(ORG);
  const home = (await view(ORG, "home", "m_v01")) as { member: { name: string }; offers: { job: string }[] };
  expect(home.member.name).toBe(memberFor("m_v01").name);
  expect(home.offers.map((o) => o.job)).toEqual([job]);
});

it("the desk view lists the volunteers with no contact", async () => {
  await join(ORG, "m_v01");
  const volunteer = memberFor("m_v01");
  const board = DeskBoardSchema.parse(await view(ORG, "desk"));
  expect(board.volunteers).toContainEqual({
    member: volunteer.id,
    name: volunteer.name,
    skills: volunteer.skills,
    zone: volunteer.zip,
    on: volunteer.on,
    openJobs: 0,
  });
  expect(board.volunteers.map((v) => v.member)).not.toContain(memberFor("m_d01").id);
  expect(JSON.stringify(board.volunteers)).not.toContain("@example.test");
});

it.each(["done", "partly", "not_done"] as const)(
  "the desk tap done for a volunteer keeps the outcome %s on the ledger",
  async (outcome) => {
    const { v1, job } = await offeredSnowJob(ORG);
    expect((await send(ORG, v1, accept(job))).status).toBe(200);
    const desk = await join(ORG, "m_d01");
    const member = memberFor("m_v01").id;
    for (const action of ["on_my_way", "there"] as const) {
      expect((await send(ORG, desk, { id: newId(), type: "job.tap_for", job, member, action })).status).toBe(
        200,
      );
    }
    const done = { id: newId(), type: "job.tap_for", job, member, action: "done", outcome };
    expect((await send(ORG, desk, done)).status).toBe(200);
    const line = (await exportLedger(ORG)).events.find((e) => e.job === job && e.type === "job.done");
    expect(line?.data).toEqual({ member, outcome });
  },
);
