import {
  DeskBoardSchema,
  JobCardSchema,
  TrackingSchema,
  VolunteerHomeSchema,
  type MemberRecord,
  type Role,
} from "@vision/contracts";
import { describe, expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { sealEvent } from "../src/seal.js";
import { evolve } from "../src/evolve.js";
import { deskView } from "../src/views/desk.js";
import { homeView, jobView } from "../src/views/volunteer.js";
import { trackingView } from "../src/views/tracking.js";
import type { VaultReader, ViewContext } from "../src/views/common.js";
import type { HubState } from "../src/state.js";
import {
  BASE_NOW,
  acceptedSnow,
  at,
  config,
  done,
  members,
  offeredSnow,
  onMyWay,
  pass,
  playbook,
  run,
  snowVolunteers,
  sortResult,
  state,
  submit,
  there,
  type Run,
} from "./helpers.js";

type Texts = ReturnType<VaultReader["texts"]>;

const vaultOf = (r: Run): VaultReader => {
  const people: Record<string, ReturnType<VaultReader["person"]>> = {};
  const texts: Record<string, Texts> = {};
  for (const effect of r.effects) {
    if (effect.kind === "vault.person") {
      const { firstName, contact, address } = effect;
      people[effect.card] = { firstName, contact, address };
    }
    if (effect.kind === "vault.text") {
      const from = effect.textKind === "note" ? "volunteer" : "resident";
      const line = {
        at: BASE_NOW,
        job: effect.job,
        textKind: effect.textKind,
        text: effect.text,
        from,
      } as const;
      texts[effect.card] = [...(texts[effect.card] ?? []), line];
    }
  }
  return { person: (card) => people[card] ?? null, texts: (card) => texts[card] ?? [] };
};

const ID = /"(c|j|m|p|pg)_([a-z0-9]+)"/g;
const asUuid = (_: string, prefix: string, short: string): string => {
  const hex = Array.from(short, (c) => c.charCodeAt(0).toString(16))
    .join("")
    .padStart(12, "0")
    .slice(-12);
  return `"${prefix}_00000000-0000-4000-8000-${hex}"`;
};

const parsed = <T>(schema: { parse(value: unknown): unknown }, value: T): T => {
  schema.parse(JSON.parse(JSON.stringify(value).replace(ID, asUuid)));
  return value;
};

const emptyVault: VaultReader = { person: () => null, texts: () => [] };

const offeredOf = (r: Run): Record<string, string[]> => {
  const offered: Record<string, string[]> = {};
  for (const effect of r.effects) {
    if (effect.kind === "offer") offered[effect.job] = [...(offered[effect.job] ?? []), ...effect.members];
    if (effect.kind === "offer_closed") offered[effect.job] = [];
  }
  return offered;
};

const memberRecords = snowVolunteers(2).map((m) => ({
  ...m,
  name: (members as unknown as MemberRecord[]).find((r) => r.id === m.id)?.name ?? "Test Volunteer",
}));

const ctxOf = (r: Run, now = BASE_NOW): ViewContext => ({
  now,
  newId: (prefix) => `${prefix}view`,
  playbook,
  members: memberRecords,
  offered: offeredOf(r),
  zips: zipsFile,
  config,
  memberRecords,
  partners: [{ id: "p_pantry", name: "Test Pantry" }],
  links: { partner: () => null },
});

const desk = { role: "desk" as Role, member: "m_d01" };
const lead = { role: "lead" as Role, member: "m_l01" };

const closeJob = (s: HubState, job: string): HubState => {
  const draft = {
    card: "c_1",
    job,
    type: "job.closed" as const,
    actor: { role: "system" as const, ref: null },
    data: { result: "helped" as const, reason: null },
  };
  return evolve(s, sealEvent(draft, s.seq + 1, BASE_NOW + 1000, s.lastHash));
};

const quietCard = () => [
  submit("c_1", "Please help me get out of the house safely", { safeContact: false }),
  sortResult("c_1", [pass("low"), pass("low")]),
];

describe("volunteer views", () => {
  it("offer views hold no name and no address", () => {
    const r = run(...offeredSnow());
    const home = homeView(state(r), ctxOf(r), "m_v02");
    expect(parsed(VolunteerHomeSchema, home).offers).toHaveLength(1);
    expect(JSON.stringify(home)).not.toMatch(/Tess|Test St|tess@example/);
  });

  it("the job card goes only to its holder", () => {
    const r = run(...acceptedSnow());
    const s = state(r);
    const card = jobView(s, vaultOf(r), ctxOf(r), "m_v01", "j_1");
    expect(parsed(JobCardSchema, card)).toMatchObject({ firstName: "Tess", address: "100 Test St" });
    expect(card).toMatchObject({ actions: ["on_my_way", "there", "done", "help", "hand_off"] });
    const other = jobView(s, vaultOf(r), ctxOf(r), "m_v02", "j_1");
    expect(Object.keys(other).sort()).toEqual(["code", "message"]);
    expect(other).toMatchObject({ code: "forbidden" });
    expect(jobView(s, vaultOf(r), ctxOf(r), "m_v01", "j_9")).toMatchObject({ code: "not_found" });
  });

  it("the home view lists held jobs and the record from taps", () => {
    const r = run(
      ...acceptedSnow(),
      at(60_000, onMyWay("j_1", "m_v01")),
      at(120_000, there("j_1", "m_v01")),
      at(3_660_000, done("j_1", "m_v01", "done")),
    );
    const home = parsed(VolunteerHomeSchema, homeView(state(r), ctxOf(r), "m_v01"));
    expect(home.record).toEqual({ jobsDone: 1, hours: 1 });
    expect(home.offers).toEqual([]);
  });
});

describe("desk view", () => {
  it("the desk sees a quiet card only as a count, and the lead sees it in full", () => {
    const r = run(...quietCard());
    const s = state(r);
    const board = parsed(DeskBoardSchema, deskView(s, vaultOf(r), ctxOf(r), desk));
    expect(board.quietCount).toBe(1);
    expect(JSON.stringify(board)).not.toContain("get out of the house");
    expect(deskView(s, vaultOf(r), ctxOf(r), lead).triage.some((c) => c.quiet)).toBe(true);
  });

  it("a job past its promise time is marked late on the desk", () => {
    const r = run(...offeredSnow());
    const s = state(r);
    const promiseAt = s.jobs["j_1"]?.promiseAt ?? 0;
    const late = parsed(DeskBoardSchema, deskView(s, vaultOf(r), ctxOf(r, promiseAt + 1), desk));
    expect(late.jobs[0]?.promiseLate).toBe(true);
    expect(late.jobs[0]?.clock?.label).toBe("Wave wait");
    expect(deskView(s, vaultOf(r), ctxOf(r), desk).jobs[0]?.promiseLate).toBe(false);
  });

  it("a desk card shows the quoted words and the message as plain text", () => {
    const r = run(
      submit("c_1", "<script>x</script> not breathing"),
      sortResult("c_1", [pass("high", "not breathing"), pass("high")]),
    );
    const b = parsed(DeskBoardSchema, deskView(state(r), vaultOf(r), ctxOf(r), desk));
    expect(b.emergency[0]).toMatchObject({
      message: "<script>x</script> not breathing",
      quotes: ["not breathing"],
    });
  });

  it("the holder on the desk board is named for the desk", () => {
    const r = run(...acceptedSnow());
    const job = deskView(state(r), vaultOf(r), ctxOf(r), desk).jobs[0];
    expect(job?.holder.kind).toBe("volunteer");
    expect(job?.holder.name).toBe(memberRecords.find((m) => m.id === "m_v01")?.name);
  });
});

describe("desk clocks", () => {
  it("a DONE job shows its check-back clock on the desk board", () => {
    const r = run(...acceptedSnow(), done("j_1", "m_v01", "done"));
    const dueAt = state(r).jobs["j_1"]?.checkback?.dueAt;
    const job = parsed(DeskBoardSchema, deskView(state(r), vaultOf(r), ctxOf(r), desk)).jobs[0];
    expect(dueAt).toBeDefined();
    expect(job?.clock).toEqual({ label: "Check-back", dueAt });
  });
});

describe("desk need choices", () => {
  it("the desk board offers every playbook need when no card is waiting", () => {
    const r = run(...acceptedSnow());
    const board = parsed(DeskBoardSchema, deskView(state(r), vaultOf(r), ctxOf(r), desk));
    expect([...board.emergency, ...board.triage]).toEqual([]);
    expect(board.jobs).toHaveLength(1);
    expect(board.needOptions).toEqual(playbook.rows.map((row) => ({ need: row.need, label: row.label })));
  });
});

describe("desk volunteers", () => {
  it("the desk board lists each volunteer with skills, zone, switch and open jobs", () => {
    const r = run(...acceptedSnow());
    const board = parsed(DeskBoardSchema, deskView(state(r), vaultOf(r), ctxOf(r), desk));
    const held = board.volunteers.find((v) => v.member === "m_v01");
    const record = memberRecords.find((m) => m.id === "m_v01");
    expect(held).toEqual({
      member: "m_v01",
      name: record?.name,
      skills: record?.skills,
      zone: record?.zip,
      on: record?.on,
      openJobs: 1,
    });
    expect(board.volunteers.find((v) => v.member === "m_v02")?.openJobs).toBe(0);
  });

  it("the volunteer list holds only volunteers, on first, and no contact or address", () => {
    const r = run(...acceptedSnow());
    const extra: MemberRecord = { ...(memberRecords[0] as MemberRecord), id: "m_d09", roles: ["desk"] };
    const ctx = { ...ctxOf(r), memberRecords: [...memberRecords, extra] };
    const board = deskView(state(r), vaultOf(r), ctx, desk);
    expect(board.volunteers.map((v) => v.member)).not.toContain("m_d09");
    const on = board.volunteers.map((v) => v.on);
    expect(on).toEqual([...on].sort((a, b) => Number(b) - Number(a)));
    expect(JSON.stringify(board.volunteers)).not.toMatch(/contact|address|Test St|example/);
  });
});

describe("privacy across views", () => {
  it("a card sorted to the extraction service is quiet even when contact is safe", () => {
    const service = playbook.rows.find((row) => row.need === "text_extraction")?.service ?? "";
    const r = run(
      submit("c_1", "He watches my phone, I need to leave"),
      sortResult("c_1", [pass("low", "", { service }), pass("low", "", { service })]),
    );
    const s = state(r);
    const board = parsed(DeskBoardSchema, deskView(s, vaultOf(r), ctxOf(r), desk));
    expect(board.quietCount).toBe(1);
    expect(board.triage).toEqual([]);
    expect(JSON.stringify(board)).not.toContain("watches my phone");
    const shown = deskView(s, vaultOf(r), ctxOf(r), lead).triage;
    expect(shown.map((c) => [c.card, c.quiet])).toEqual([["c_1", true]]);
  });

  it("tracking shows only messages sent to the resident", () => {
    const r = run(...acceptedSnow());
    const vault: VaultReader = {
      person: () => null,
      texts: () => [
        { at: BASE_NOW, job: null, textKind: "message_out", text: "We have your request.", from: "system" },
        {
          at: BASE_NOW,
          job: null,
          textKind: "partner_ask",
          text: "Can you help in 53206? Open the link",
          from: "system",
        },
        { at: BASE_NOW, job: null, textKind: "message_in", text: "Please clear my walk", from: "resident" },
      ],
    };
    const t = parsed(TrackingSchema, trackingView(state(r), vault, ctxOf(r), "c_1"));
    expect(t.messages).toEqual([{ at: BASE_NOW, text: "We have your request." }]);
  });
});

describe("tracking view", () => {
  it("tracking shows status words and times, never a volunteer name", () => {
    const r = run(...acceptedSnow(), onMyWay("j_1", "m_v01"));
    const t = parsed(TrackingSchema, trackingView(state(r), vaultOf(r), ctxOf(r), "c_1"));
    expect(t.steps.map((x) => x.word)).toEqual(["Received", "Sorted", "A volunteer has it", "On the way"]);
    const name = memberRecords.find((m) => m.id === "m_v01")?.name ?? "m_v01";
    expect(JSON.stringify(t)).not.toContain("m_v01");
    expect(JSON.stringify(t)).not.toContain(name);
  });

  it("closed_job_shows_closed_only", () => {
    const r = run(...acceptedSnow(), there("j_1", "m_v01"), done("j_1", "m_v01", "done"));
    const vault: VaultReader = {
      person: () => null,
      texts: () => [
        { at: BASE_NOW, job: null, textKind: "message_out", text: "Food Bank North has it.", from: "system" },
      ],
    };
    const t = parsed(TrackingSchema, trackingView(closeJob(state(r), "j_1"), vault, ctxOf(r), "c_1"));
    expect(t).toMatchObject({ closed: true, consentAsk: null, checkbackAsk: null, messages: [] });
    expect(t).toMatchObject({ routeCode: null, steps: [] });
    expect(t.forgetAt).toBe(BASE_NOW + 1000 + config.forgetDays * 86_400_000);
  });

  it("an unknown or forgotten card shows closed with no detail", () => {
    const t = parsed(TrackingSchema, trackingView(state(run()), emptyVault, ctxOf(run()), "c_9"));
    expect(t).toMatchObject({ closed: true, routeCode: null, steps: [], messages: [] });
  });
});
