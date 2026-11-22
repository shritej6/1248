import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CommandSchema,
  CommandTypeSchema,
  ConfigSchema,
  DeskBoardSchema,
  DIVISIONS,
  LedgerEventSchema,
  MemberRecordSchema,
  OrgAboutSchema,
  PartnerCardSchema,
  PartnerRecordSchema,
  PlaybookSchema,
  RejectionCodeSchema,
  RequestFormSchema,
  SERVICES,
  TemplatesSchema,
  TrackingSchema,
  VolunteerHomeSchema,
  ZipCentresSchema,
  commandRoles,
  rejectionStatus,
} from "../src/index.js";

const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const playbook = () => json("../../data/synthetic/playbook.json") as { rows: Record<string, unknown>[] };
const cmdId = "cmd_3f0c1a52-7d2e-4b8a-9c61-0e5d4f7a2b19";
const jobId = "j_9b2e4c71-5a3d-4f60-8e17-2c4d6a8b0f35";
const ledgerLine = {
  seq: 1,
  at: 1795000000000,
  card: "c_1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  job: null,
  type: "card.received",
  actor: { role: "resident", ref: null },
  data: { door: "form", zip: "53216", safeContact: true },
  prev: "0".repeat(64),
  hash: "a".repeat(64),
};

describe("schemas", () => {
  it("there are 13 services and Other", () => {
    expect(SERVICES).toHaveLength(14);
    expect(SERVICES.at(-1)).toBe("Other");
  });
  it("there are 9 divisions and No clear home", () => {
    expect(DIVISIONS).toHaveLength(10);
    expect(DIVISIONS.at(-1)).toBe("No clear home");
  });
  it("a playbook whose last rung is not unmet is rejected", () => {
    const pb = playbook();
    expect(PlaybookSchema.safeParse(pb).success).toBe(true);
    const first = pb.rows[0];
    if (first) first.ladder = [{ path: "volunteers" }];
    expect(PlaybookSchema.safeParse(pb).success).toBe(false);
  });
  it("a playbook with two defaults for one service is rejected", () => {
    const pb = playbook();
    for (const row of pb.rows) if (row.need === "lawn") row.defaultForService = true;
    expect(PlaybookSchema.safeParse(pb).success).toBe(false);
  });
  it("a playbook row at level 1 is rejected", () => {
    const pb = playbook();
    const first = pb.rows[0];
    if (first) first.level = 1;
    expect(PlaybookSchema.safeParse(pb).success).toBe(false);
  });
  it("the synthetic playbook covers every service except Other", () => {
    const covered = new Set(playbook().rows.map((r) => r.service));
    expect([...covered].sort()).toEqual(SERVICES.filter((s) => s !== "Other").sort());
  });
});

describe("boundary rules", () => {
  it("form rejects a filled trap field and a 2001 character message", () => {
    const ok = {
      firstName: "Avery",
      contactKind: "email",
      contact: "a@example.test",
      zip: "53216",
      message: "Snow on my walk",
      address: "1 Test St",
      safeContact: true,
      website: "",
    };
    expect(RequestFormSchema.safeParse(ok).success).toBe(true);
    expect(RequestFormSchema.safeParse({ ...ok, website: "x" }).success).toBe(false);
    expect(RequestFormSchema.safeParse({ ...ok, message: "a".repeat(2001) }).success).toBe(false);
  });
  it("an offer view with an address field is rejected", () => {
    const home = json("../fixtures/views/home-with-offer.json") as { offers: Record<string, unknown>[] };
    const offer = home.offers[0];
    if (offer) offer.address = "1 Test St";
    expect(VolunteerHomeSchema.safeParse(home).success).toBe(false);
  });
});

describe("commands", () => {
  it("a command id must be cmd_ and a UUID v4", () => {
    expect(CommandSchema.safeParse({ id: cmdId, type: "offer.accept", job: jobId }).success).toBe(true);
    expect(CommandSchema.safeParse({ id: "cmd_1", type: "offer.accept", job: jobId }).success).toBe(false);
    expect(CommandSchema.safeParse({ id: cmdId, type: "offer.accept", job: "c_x" }).success).toBe(false);
  });
  it("a clock jump only takes the four fixed sizes", () => {
    expect(CommandSchema.safeParse({ id: cmdId, type: "clock.jump", minutes: 4320 }).success).toBe(true);
    expect(CommandSchema.safeParse({ id: cmdId, type: "clock.jump", minutes: 30 }).success).toBe(false);
  });
  it("a thread post longer than 500 characters is rejected", () => {
    const card = "c_1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const post = { id: cmdId, type: "thread.post", card, text: "a".repeat(501) };
    expect(CommandSchema.safeParse(post).success).toBe(false);
  });
  it("a card confirm only takes a known division", () => {
    const card = "c_1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const confirm = {
      id: cmdId,
      type: "card.confirm",
      card,
      need: "snow",
      urgency: "low",
      division: "Pet Division",
    };
    expect(CommandSchema.safeParse(confirm).success).toBe(true);
    expect(CommandSchema.safeParse({ ...confirm, division: null }).success).toBe(true);
    expect(CommandSchema.safeParse({ ...confirm, division: "Jane Doe 1 Main St" }).success).toBe(false);
  });
  it("every command type has its senders", () => {
    for (const type of CommandTypeSchema.options) expect(commandRoles[type].length).toBeGreaterThan(0);
    expect(commandRoles["offer.accept"]).toEqual(["volunteer"]);
    expect(commandRoles["promise.accept"]).toEqual(["partner"]);
  });
});

describe("partner answer", () => {
  it("a partner answer takes one plain line of at most 140 characters and a time", () => {
    const answer = { id: cmdId, type: "ask.answer", job: jobId, answer: "wait" };
    const ok = (extra: object) => CommandSchema.safeParse({ ...answer, ...extra }).success;
    expect(ok({})).toBe(true);
    expect(ok({ reason: "a".repeat(140), waitUntil: 1795341600000 })).toBe(true);
    expect(ok({ reason: "a".repeat(141) })).toBe(false);
    expect(ok({ reason: "" })).toBe(false);
    expect(ok({ reason: "Full today\nTry Monday" })).toBe(false);
    expect(ok({ waitUntil: -1 })).toBe(false);
  });
  it("a partner answer line never reaches the ledger", () => {
    const partner = "p_b1f72c2d-3f04-4b3f-8a39-12d7de1493e9";
    const line = { ...ledgerLine, job: jobId, type: "partner.answered" };
    const data = { partner, answer: "wait", waitUntil: 1795341600000 };
    expect(LedgerEventSchema.safeParse({ ...line, data }).success).toBe(true);
    expect(LedgerEventSchema.safeParse({ ...line, data: { ...data, reason: "Full today" } }).success).toBe(
      false,
    );
  });
});

describe("partner answer on the desk", () => {
  it("a desk job may carry the last partner answer, and an older job without it still parses", () => {
    const board = json("../fixtures/views/desk-board.json") as { jobs: Record<string, unknown>[] };
    const job = board.jobs[0] ?? {};
    const jobs = DeskBoardSchema.shape.jobs.element;
    const answer = { partnerName: "Test Pantry", answer: "no", reason: "Closed today", waitUntil: null };
    expect(jobs.safeParse({ ...job, partnerAnswer: answer }).success).toBe(true);
    expect(jobs.safeParse(job).success).toBe(true);
    expect(Object.hasOwn(job, "partnerAnswer")).toBe(true);
    const older = Object.fromEntries(Object.entries(job).filter(([key]) => key !== "partnerAnswer"));
    expect(jobs.safeParse(older).success).toBe(true);
    expect(jobs.safeParse({ ...job, partnerAnswer: { ...answer, answer: "maybe" } }).success).toBe(false);
  });
});

describe("errors and ledger", () => {
  it("every rejection code has an HTTP status", () => {
    for (const code of RejectionCodeSchema.options) expect(rejectionStatus[code]).toBeGreaterThanOrEqual(400);
    expect(rejectionStatus.invalid).toBe(400);
    expect(rejectionStatus.taken).toBe(409);
    expect(rejectionStatus.rate_limited).toBe(429);
  });
  it("a ledger line with a name in its data is rejected", () => {
    const line = ledgerLine;
    expect(LedgerEventSchema.safeParse(line).success).toBe(true);
    expect(LedgerEventSchema.safeParse({ ...line, data: { ...line.data, firstName: "Avery" } }).success).toBe(
      false,
    );
  });
  it("a ledger line whose actor ref is free text is rejected", () => {
    const line = { ...ledgerLine, actor: { role: "desk", ref: "m_2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d" } };
    expect(LedgerEventSchema.safeParse(line).success).toBe(true);
    const freeText = { role: "resident", ref: "Jane Doe 1 Main St 414-555-0100" };
    expect(LedgerEventSchema.safeParse({ ...line, actor: freeText }).success).toBe(false);
  });
});

describe("synthetic data", () => {
  it("config, members, partners, zips and templates parse", () => {
    expect(ConfigSchema.safeParse(json("../../data/synthetic/config.json")).success).toBe(true);
    expect(MemberRecordSchema.array().safeParse(json("../../data/synthetic/members.json")).success).toBe(
      true,
    );
    expect(PartnerRecordSchema.array().safeParse(json("../../data/synthetic/partners.json")).success).toBe(
      true,
    );
    expect(ZipCentresSchema.safeParse(json("../../data/synthetic/zip-centres.json")).success).toBe(true);
    expect(TemplatesSchema.safeParse(json("../../data/synthetic/templates.json")).success).toBe(true);
  });
  it("exactly two snow volunteers are on, both in 53216", () => {
    const members = MemberRecordSchema.array().parse(json("../../data/synthetic/members.json"));
    const on = members.filter((m) => m.roles.includes("volunteer") && m.skills.includes("snow") && m.on);
    expect(on.map((m) => m.zip)).toEqual(["53216", "53216"]);
    expect(members.every((m) => m.name.endsWith("(test)"))).toBe(true);
  });
  it("every template says details are deleted after 90 days", () => {
    const { es, ...english } = TemplatesSchema.parse(json("../../data/synthetic/templates.json"));
    for (const t of Object.values(english)) expect(t.text).toContain("90 days");
    for (const t of Object.values(es ?? {})) expect(t.text).toContain("90");
    expect(english.receipt.text).toContain("In an emergency, call 911.");
  });
  it("a Spanish template must have the slots of the English one", () => {
    const templates = json("../../data/synthetic/templates.json") as Record<string, unknown>;
    const es = { checkback: { text: "Responda aqui: {trackingLink}. 90 dias.", slots: ["trackingLink"] } };
    expect(TemplatesSchema.safeParse({ ...templates, es }).success).toBe(false);
    const right = {
      checkback: { text: "{needLabel} {trackingLink} 90 dias", slots: ["needLabel", "trackingLink"] },
    };
    expect(TemplatesSchema.safeParse({ ...templates, es: right }).success).toBe(true);
  });
});

describe("desk volunteers", () => {
  const board = () => json("../fixtures/views/desk-board.json") as Record<string, unknown>;
  const firstVolunteer = (b: Record<string, unknown>): Record<string, unknown> =>
    (b["volunteers"] as Record<string, unknown>[])[0] ?? {};
  it("the desk board needs the volunteer list", () => {
    const { volunteers, ...rest } = board();
    expect(Array.isArray(volunteers)).toBe(true);
    expect(DeskBoardSchema.safeParse(rest).success).toBe(false);
  });
  it("a desk volunteer cannot carry a contact or an address", () => {
    for (const extra of [{ contact: "a@example.test" }, { address: "1 Test St" }]) {
      const b = board();
      const v = { ...firstVolunteer(b), ...extra };
      expect(DeskBoardSchema.safeParse({ ...b, volunteers: [v] }).success).toBe(false);
    }
  });
});

describe("organisation name in views", () => {
  const views = [
    { schema: DeskBoardSchema, file: "desk-board.json" },
    { schema: TrackingSchema, file: "tracking-open.json" },
    { schema: PartnerCardSchema, file: "partner-ask.json" },
  ];
  it("each web view carries the organisation name and still parses without it", () => {
    for (const { schema, file } of views) {
      const { orgName, ...rest } = json(`../fixtures/views/${file}`) as Record<string, unknown>;
      expect(orgName, file).toBe("ComForce demo");
      expect(schema.safeParse(rest).success, file).toBe(true);
      expect(schema.safeParse({ ...rest, orgName: "x".repeat(81) }).success, file).toBe(false);
    }
  });
  it("the about answer names the organisation and nothing else", () => {
    expect(OrgAboutSchema.parse({ orgName: "ComForce demo" })).toEqual({ orgName: "ComForce demo" });
    expect(OrgAboutSchema.safeParse({ orgName: "" }).success).toBe(false);
    expect(OrgAboutSchema.safeParse({ orgName: "ComForce demo", org: "comforce-demo" }).success).toBe(false);
  });
});
