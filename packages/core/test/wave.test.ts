import { describe, expect, it } from "vitest";
import type { MemberPublic, PlaybookRow } from "@vision/contracts";
import zips from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { milesBetween, pickWave, type WaveInput } from "../src/wave.js";
import type { CardState, JobState } from "../src/state.js";
import { playbook } from "./helpers.js";

const snowRow = playbook.rows.find((r) => r.need === "snow") as PlaybookRow;

const job = (over: Partial<JobState> = {}): JobState => ({
  id: "j_1",
  card: "c_1",
  need: "snow",
  path: "volunteers",
  rung: 0,
  level: 2,
  quiet: false,
  status: "planned",
  approved: true,
  wave: 0,
  waveAt: null,
  holderRef: null,
  helpers: [],
  excluded: [],
  flags: [],
  returnReason: null,
  createdAt: 0,
  promiseAt: 0,
  acceptedAt: null,
  onMyWayAt: null,
  thereAt: null,
  doneAt: null,
  askedAt: null,
  yesAt: null,
  gotItAt: null,
  checkback: null,
  closedAt: null,
  hoursMs: 0,
  partner: null,
  ...over,
});

const card = (zip: string | null): CardState => ({
  id: "c_1",
  receivedAt: 0,
  door: "form",
  zip,
  safeContact: true,
  sorted: null,
  confirmedAt: 0,
  need: "snow",
  urgency: "low",
  division: null,
  level: 2,
  quiet: false,
  routeCode: "SNOW-16-001",
  changed: false,
  promiseAt: 0,
  jobs: ["j_1"],
  lang: null,
  ai: {},
  gistAt: null,
});

const vol = (id: string, zip: string | null, over: Partial<MemberPublic> = {}): MemberPublic => ({
  id,
  roles: ["volunteer"],
  skills: ["snow"],
  zip,
  on: true,
  lastJobAt: null,
  ...over,
});

const volunteers = (n: number): MemberPublic[] => [
  ...Array.from({ length: n - 1 }, (_, i) => vol(`m_far${String(i)}`, i % 2 === 0 ? "53202" : "53204")),
  vol("m_near_waited_less", "53216", { lastJobAt: 5_000 }),
  vol("m_near_waited_longest", "53216", { lastJobAt: 1_000 }),
];

const waveInput = (over: Partial<WaveInput> = {}): WaveInput => ({
  job: job(),
  card: card("53216"),
  row: snowRow,
  members: [],
  offered: [],
  openJobs: {},
  zips,
  size: 10,
  ...over,
});

describe("pickWave", () => {
  it("wave picks the nearest 10 eligible volunteers, longest wait first on a tie", () => {
    const picked = pickWave(waveInput({ members: volunteers(14), size: 10 }));
    expect(picked).toHaveLength(10);
    expect(picked[0]).toBe("m_near_waited_longest");
    expect(picked[1]).toBe("m_near_waited_less");
  });

  it("a member who never had a job has waited longest", () => {
    const members = [vol("m_had", "53216", { lastJobAt: 1 }), vol("m_never", "53216")];
    expect(pickWave(waveInput({ members }))).toEqual(["m_never", "m_had"]);
  });
});

describe("who is skipped", () => {
  it("wave skips off, wrong skill, excluded, already offered and members with 3 open jobs", () => {
    const off = vol("m_off", "53216", { on: false });
    const wrongSkill = vol("m_wrong", "53216", { skills: ["food"] });
    const excluded = vol("m_excluded", "53216");
    const offered = vol("m_offered", "53216");
    const busy3 = vol("m_busy", "53216");
    const desk = vol("m_desk", "53216", { roles: ["desk"] });
    const ok = vol("m_ok", "53216");
    const picked = pickWave(
      waveInput({
        job: job({ excluded: [excluded.id] }),
        members: [off, wrongSkill, excluded, offered, busy3, desk, ok],
        offered: [offered.id],
        openJobs: { [busy3.id]: 3, [ok.id]: 2 },
      }),
    );
    expect(picked).toEqual([ok.id]);
  });

  it("an unknown ZIP sorts last", () => {
    const members = [vol("m_unknown", "99999"), vol("m_none", null), vol("m_far", "53202")];
    expect(pickWave(waveInput({ members }))).toEqual(["m_far", "m_none", "m_unknown"]);
  });

  it("a card with no ZIP keeps the longest wait order", () => {
    const members = [vol("m_b", "53202", { lastJobAt: 9 }), vol("m_a", "53216", { lastJobAt: 3 })];
    expect(pickWave(waveInput({ card: card(null), members }))).toEqual(["m_a", "m_b"]);
  });
});

describe("milesBetween", () => {
  it("is zero for the same ZIP and rounds to half a mile", () => {
    expect(milesBetween("53216", "53216", zips)).toBe(0);
    const miles = milesBetween("53216", "53202", zips);
    expect(miles).not.toBeNull();
    expect(((miles ?? 0) * 2) % 1).toBe(0);
    expect(miles).toBeGreaterThan(3);
    expect(miles).toBeLessThan(6);
  });

  it("is null when a ZIP is missing or unknown", () => {
    expect(milesBetween(null, "53216", zips)).toBeNull();
    expect(milesBetween("53216", "99999", zips)).toBeNull();
  });
});
