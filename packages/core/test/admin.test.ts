import { OrgViewSchema, type Actor, type MemberRecord, type Playbook } from "@vision/contracts";
import { describe, expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { holderOf } from "../src/holder.js";
import { orgView } from "../src/views/organiser.js";
import type { VaultReader, ViewContext } from "../src/views/common.js";
import {
  BASE_NOW,
  accept,
  approve,
  at,
  config,
  confirm,
  confirmedSnow,
  ctx,
  effects,
  eventData,
  loadPlaybook,
  master,
  members,
  offerTo,
  playbook,
  pass,
  reject,
  run,
  setLevel,
  snowVolunteers,
  sortResult,
  state,
  submit,
  types,
  useMembers,
  type Run,
  type Step,
} from "./helpers.js";

const HOUR = 3_600_000;
const DESK: Actor = { role: "desk", ref: "m_d01" };
const LEAD: Actor = { role: "lead", ref: "m_l01" };

let rungCount = 0;
const nextRung = (job: string, actor: Actor = DESK): Step => {
  rungCount += 1;
  return { command: { id: `cmd_rung${String(rungCount)}`, type: "job.next_rung", job }, actor, offset: 0 };
};
const DAY = 24 * HOUR;

const withRow = (need: string, change: Partial<Playbook["rows"][number]>, version = "2026-11-22.1") => ({
  version,
  rows: playbook.rows.map((row) => (row.need === need ? { ...row, ...change } : row)),
});

const withPromiseHours = (need: string, hours: number): Playbook => withRow(need, { promiseHours: hours });

const crisisPass = pass("low", "", { service: "Suicide Prevention" });

const confirmedLevel3 = (need: string, card = "c_1"): Step[] => [
  submit(card, "I need someone to sit with me tonight"),
  sortResult(card, [crisisPass, crisisPass]),
  confirm(card, need, "low"),
];

describe("playbook.load", () => {
  it("a new playbook version applies to new cards only", () => {
    const d = run(
      ...confirmedSnow("c_1"),
      loadPlaybook(withPromiseHours("snow", 48)),
      ...confirmedSnow("c_2"),
    );
    expect(state(d).jobs["j_1"]?.promiseAt).toBe(BASE_NOW + 24 * HOUR);
    expect(state(d).jobs["j_2"]?.promiseAt).toBe(BASE_NOW + 48 * HOUR);
    expect(eventData(d, "playbook.loaded")).toEqual({ version: "2026-11-22.1", rows: playbook.rows.length });
    expect(state(d).playbookVersion).toBe("2026-11-22.1");
  });

  it("only an organiser loads a playbook, and the same version is not loaded twice", () => {
    const next = withPromiseHours("snow", 48);
    expect(reject(loadPlaybook(next, { as: "desk" }))).toBe("forbidden");
    expect(reject(loadPlaybook(next), [loadPlaybook(next)])).toBe("wrong_state");
  });

  it("a playbook that drops the need of an open job is refused", () => {
    const next = { version: "2026-11-22.2", rows: playbook.rows.filter((row) => row.need !== "snow") };
    expect(reject(loadPlaybook(next), confirmedSnow())).toBe("wrong_state");
  });

  it("a playbook with a ladder shorter than the rung of an open job is refused", () => {
    const shorter = withRow("food", { ladder: [{ path: "unmet" }] });
    const onRung1 = [...confirmedSnow({ allOff: true }), approve("j_1"), nextRung("j_1")];
    expect(run(...onRung1).state.jobs["j_1"]?.rung).toBe(1);
    expect(reject(loadPlaybook(withRow("snow", { ladder: [{ path: "unmet" }] })), onRung1)).toBe(
      "wrong_state",
    );
    expect(run(...onRung1, loadPlaybook(shorter)).rejections).toEqual([]);
  });
});

describe("need.set_level", () => {
  it("level 1 is not earned yet, so it is refused", () => {
    expect(reject(setLevel("snow", 1))).toBe("not_earned");
  });

  it("a need set to level 3 makes new jobs level 3 and held by the lead", () => {
    const d = run(setLevel("snow", 3), ...confirmedSnow());
    expect(eventData(d, "need.level_set")).toEqual({ need: "snow", level: 3 });
    expect(state(d).jobs["j_1"]?.level).toBe(3);
    expect(holderOf(state(d), "j_1", ctx).kind).toBe("lead");
  });

  it("an unknown need or the level it already has is refused", () => {
    expect(reject(setLevel("chess", 3))).toBe("not_found");
    expect(reject(setLevel("snow", 2))).toBe("wrong_state");
    expect(reject(setLevel("snow", 3), [setLevel("snow", 3)])).toBe("wrong_state");
  });
});

describe("levels.master", () => {
  it("the master switch is set once and then refused until it changes", () => {
    const d = run(master(true));
    expect(eventData(d, "levels.master_set")).toEqual({ on: true });
    expect(state(d).levels.master).toBe(true);
    expect(reject(master(true), [master(true)])).toBe("wrong_state");
    expect(run(master(true), master(false)).state.levels.master).toBe(false);
  });
});

describe("level 3 jobs", () => {
  it("a level 3 job is held by the lead and only the lead can offer it", () => {
    const s = state(run(...confirmedLevel3("suicide_prevention")));
    expect(s.jobs["j_1"]?.level).toBe(3);
    expect(holderOf(s, "j_1", ctx).kind).toBe("lead");
    expect(reject(offerTo("j_1", "m_v11", { as: "desk" }), confirmedLevel3("suicide_prevention"))).toBe(
      "forbidden",
    );
    expect(reject(approve("j_1", { as: "desk" }), confirmedLevel3("suicide_prevention"))).toBe("forbidden");
  });

  it("the lead offers a level 3 job to one trained member by name, and that member must accept", () => {
    const d = run(...confirmedLevel3("suicide_prevention"), offerTo("j_1", "m_v11", { as: "lead" }));
    expect(effects(d).at(-1)).toEqual({ kind: "offer", job: "j_1", members: ["m_v11"] });
    expect(state(d).jobs["j_1"]?.status).toBe("offered");
    const taken = run(
      ...confirmedLevel3("suicide_prevention"),
      offerTo("j_1", "m_v11", { as: "lead" }),
      accept("j_1", "m_v11"),
    );
    expect(state(taken).jobs["j_1"]?.holderRef).toBe("m_v11");
  });

  it("the lead cannot offer a level 3 job to a member without the skill", () => {
    expect(reject(offerTo("j_1", "m_v07", { as: "lead" }), confirmedLevel3("suicide_prevention"))).toBe(
      "not_eligible",
    );
  });

  it("the lead starts a wave to trained members only", () => {
    const d = run(...confirmedLevel3("suicide_prevention"), approve("j_1", { as: "lead" }));
    expect(types(d)).toContain("offer.wave_sent");
    expect(effects(d).at(-1)).toMatchObject({ kind: "offer", job: "j_1" });
    const offered = effects(d).at(-1);
    expect(offered?.kind === "offer" ? [...offered.members].sort() : []).toEqual(["m_v11", "m_v12"]);
  });
});

const records: MemberRecord[] = members.map((m, i) => ({ ...m, name: `Test Member ${String(i + 1)}` }));

const viewCtx = (now = BASE_NOW): ViewContext => ({
  now,
  newId: (prefix) => `${prefix}view`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config,
  memberRecords: records,
  partners: [{ id: "p_pantry", name: "Test Pantry" }],
  links: { partner: () => null },
});

const emptyVault: VaultReader = { person: () => null, texts: () => [] };

const ID = /"(c|j|m|p|pg)_([a-z0-9]+)"/g;
const asUuid = (_: string, prefix: string, short: string): string => {
  const hex = Array.from(short, (c) => c.charCodeAt(0).toString(16))
    .join("")
    .padStart(12, "0")
    .slice(-12);
  return `"${prefix}_00000000-0000-4000-8000-${hex}"`;
};
const matchesSchema = (value: unknown): void => {
  OrgViewSchema.parse(JSON.parse(JSON.stringify(value).replace(ID, asUuid)));
};

const viewOf = (d: Run, now = BASE_NOW) => orgView(state(d), emptyVault, viewCtx(now));

describe("orgView", () => {
  it("shows the playbook, each need with its level and record, and the master switch", () => {
    const d = run(setLevel("snow", 3), master(true), ...confirmedSnow());
    const view = viewOf(d);
    matchesSchema(view);
    expect(view.playbook).toBe(playbook);
    expect(view.levels.master).toBe(true);
    expect(view.levels.needs.find((n) => n.need === "snow")).toEqual({
      need: "snow",
      level: 3,
      clean: 1,
      changed: 0,
      canEarn: false,
    });
    expect(view.levels.needs.find((n) => n.need === "suicide_prevention")?.level).toBe(3);
    expect(view.members).toBe(records);
    expect(view.demo).toEqual({ mode: config.demoMode, offsetMs: 0 });
  });
});

describe("orgView lists", () => {
  it("lists unmet jobs and started jobs by the days since the last tap", () => {
    const shelved = [useMembers(snowVolunteers(0)), ...confirmedSnow("c_1"), approve("j_1"), nextRung("j_1")];
    const started = [
      useMembers(snowVolunteers(2)),
      ...confirmedSnow("c_2"),
      approve("j_2"),
      at(DAY, accept("j_2", "m_v01")),
      ...confirmedSnow("c_3"),
      approve("j_3"),
      accept("j_3", "m_v02"),
    ];
    const view = viewOf(run(...shelved, ...started), BASE_NOW + 3 * DAY);
    matchesSchema(view);
    expect(view.unmet.map((j) => j.job)).toEqual(["j_1"]);
    expect(view.finish.map((j) => [j.job, j.daysSinceTap])).toEqual([
      ["j_3", 3],
      ["j_2", 2],
    ]);
  });

  it("keeps quiet jobs off the organiser lists", () => {
    const quiet = [
      useMembers(snowVolunteers(0)),
      submit("c_1", "Please help me shovel my walk this week", { safeContact: false }),
      sortResult("c_1", [pass("low"), pass("low")]),
      confirm("c_1", "snow", "low", { as: "lead" }),
      approve("j_1", { as: "lead" }),
      nextRung("j_1", LEAD),
    ];
    const d = run(...quiet);
    expect(state(d).jobs["j_1"]?.status).toBe("unmet");
    expect(viewOf(d).unmet).toEqual([]);
  });
});
