import type { Actor, DecideContext, LinkResult, Playbook } from "@vision/contracts";
import { expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { decide } from "../src/decide.js";
import { messageReady } from "../src/decide/intake.js";
import { deskView } from "../src/views/desk.js";
import { cardLinks } from "../src/views/link.js";
import type { VaultReader, ViewContext, Viewer } from "../src/views/common.js";
import {
  BASE_NOW,
  addJob,
  config,
  confirm,
  loadPlaybook,
  members,
  pass,
  playbook,
  run,
  sortOff,
  sortResult,
  state,
  submit,
  type Run,
  type Step,
} from "./helpers.js";

const SYSTEM: Actor = { role: "system", ref: null };
const DESK_ACTOR: Actor = { role: "desk", ref: "m_d01" };
const LEAD_ACTOR: Actor = { role: "lead", ref: "m_l01" };
const DESK: Viewer = { role: "desk", member: "m_d01" };
const LEAD: Viewer = { role: "lead", member: "m_l01" };
const PILE = "A couch and garbage bags were dumped in the alley behind my house";
const TEXT_SERVICE = playbook.rows.find((row) => row.need === "text_extraction")?.service ?? "";

const context: DecideContext = {
  now: BASE_NOW,
  newId: (prefix) => `${prefix}1`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config: { ...config, aiOn: { voice: false, link: true, lang: false } },
};

const viewContext: ViewContext = {
  ...context,
  memberRecords: [],
  partners: [],
  links: { partner: () => null },
};
const emptyVault: VaultReader = { person: () => null, texts: () => [] };

const linkResult = (card: string, matches: LinkResult["matches"]): Step => ({
  command: { type: "link.result", card, outcome: "ok", matches },
  actor: SYSTEM,
  offset: 0,
});

const sortedTo = (card: string, service: string): Step =>
  sortResult(card, [pass("low", "", { service }), pass("low", "", { service })]);
const sortedQuiet = (card: string): Step => sortedTo(card, TEXT_SERVICE);

const LAWN_SERVICE = playbook.rows.find((row) => row.need === "lawn")?.service ?? "";
const quietLawn: Playbook = {
  version: "2026-11-22.1",
  rows: playbook.rows.map((row) => (row.need === "lawn" ? { ...row, quiet: true } : row)),
};

let answerCount = 0;
const answer = (actor: Actor): Step => {
  answerCount += 1;
  const id = `cmd_privacy_${String(answerCount)}`;
  return {
    command: { id, type: "link.answer", card: "c_2", other: "c_1", answer: "same" },
    actor,
    offset: 0,
  };
};

const proposed = (r: Run): number => r.events.filter((e) => e.type === "link.proposed").length;

const linksOn = (r: Run, viewer: Viewer, card: string, book: Playbook = playbook): string[] => {
  const board = deskView(state(r), emptyVault, { ...viewContext, playbook: book }, viewer);
  const found = [...board.emergency, ...board.triage].find((c) => c.card === card);
  return (found?.links ?? []).map((link) => link.other);
};

it("proposes nothing when the reporting card or the other card is sorted to a quiet service", () => {
  const self = run(
    submit("c_1", PILE),
    sortOff("c_1"),
    submit("c_2", PILE),
    sortedQuiet("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
  );
  const other = run(
    submit("c_1", PILE),
    sortedQuiet("c_1"),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
  );
  expect([proposed(self), proposed(other)]).toEqual([0, 0]);
});

it("proposes nothing to a level 3 card or to a card with a quiet job", () => {
  const levelThree = run(
    submit("c_1", PILE),
    sortOff("c_1"),
    confirm("c_1", "missing", "low"),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
  );
  const quietJob = run(
    submit("c_1", PILE),
    sortOff("c_1"),
    confirm("c_1", "cleanup", "low"),
    addJob("c_1", "text_extraction", { as: "lead" }),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
  );
  expect(state(levelThree).cards["c_1"]?.level).toBe(3);
  expect(Object.values(state(quietJob).jobs).some((job) => job.quiet)).toBe(true);
  expect([proposed(levelThree), proposed(quietJob)]).toEqual([0, 0]);
});

it("cardLinks hides a link whose other card became lead-only after the proposal", () => {
  const before = [
    submit("c_1", PILE),
    sortOff("c_1"),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
  ];
  expect(cardLinks(state(run(...before)), "c_2", () => true).map((l) => l.other)).toEqual(["c_1"]);
  const after = run(...before, confirm("c_1", "missing", "low"));
  expect(cardLinks(state(after), "c_2", () => true)).toEqual([]);
});

it("a sort into a quiet service after the proposal hides the link from the desk but not the lead", () => {
  const r = run(
    submit("c_1", PILE),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
    sortedQuiet("c_1"),
  );
  expect(proposed(r)).toBe(1);
  expect(linksOn(r, DESK, "c_2")).toEqual([]);
  expect(linksOn(r, LEAD, "c_2")).toEqual(["c_1"]);
  expect(JSON.stringify(deskView(state(r), emptyVault, viewContext, DESK))).not.toContain("c_1");
});

it("refuses a desk answer on a link to a quiet-service card and accepts the lead's", () => {
  const setup = [
    submit("c_1", PILE),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
    sortedQuiet("c_1"),
  ];
  expect(run(...setup, answer(DESK_ACTOR)).rejections).toEqual(["forbidden"]);
  expect(run(...setup, answer(LEAD_ACTOR)).rejections).toEqual([]);
});
it("a sort that lands on a quiet service after the proposal hides the link and the card, and the desk may not answer", () => {
  const steps = [
    submit("c_1", PILE),
    submit("c_2", PILE),
    sortOff("c_2"),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
    sortedQuiet("c_1"),
  ];
  const r = run(...steps);
  const board = JSON.stringify(deskView(state(r), emptyVault, viewContext, DESK));
  expect([proposed(r), linksOn(r, DESK, "c_2"), board.includes("c_1")]).toEqual([1, [], false]);
  expect(run(...steps, answer(DESK_ACTOR)).rejections).toEqual(["forbidden"]);
});

it("the proposal, the answer and the view agree when the suggested need of a service is not quiet", () => {
  const before = [loadPlaybook(quietLawn), submit("c_1", PILE), submit("c_2", PILE), sortOff("c_2")];
  const sortedFirst = run(
    ...before,
    sortedTo("c_1", LAWN_SERVICE),
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
  );
  const sortedAfter = [
    ...before,
    linkResult("c_2", [{ other: "c_1", score: 0.95 }]),
    sortedTo("c_1", LAWN_SERVICE),
  ];
  expect(proposed(sortedFirst)).toBe(1);
  expect(linksOn(run(...sortedAfter), DESK, "c_2", quietLawn)).toEqual(["c_1"]);
  expect(run(...sortedAfter, answer(DESK_ACTOR)).rejections).toEqual([]);
});

it("writes no ai.asked for link when a later message arrives on a card sorted to a quiet service", () => {
  const r = run(submit("c_1", PILE), sortedQuiet("c_1"));
  const info = { card: "c_1", message: PILE, door: "voice" as const, lang: null, zip: "53216" };
  const lines = messageReady(state(r), context, info, SYSTEM);
  expect(lines.events.some((e) => e.type === "ai.asked" && e.data.job === "link")).toBe(false);
});

const asked = (d: ReturnType<typeof decide>): boolean =>
  d.ok && d.events.some((e) => e.type === "ai.asked" && e.data.job === "link");

it("writes no ai.asked for link when the contact is not safe", () => {
  const command = {
    type: "request.submit" as const,
    card: "c_1",
    door: "form" as const,
    zip: "53216",
    safeContact: false,
    firstName: "Tess",
    contact: "tess@example.test",
    address: null,
    message: PILE,
  };
  expect(asked(decide(state(run()), command, SYSTEM, context))).toBe(false);
  expect(asked(decide(state(run()), { ...command, safeContact: true }, SYSTEM, context))).toBe(true);
});

it("writes no ai.asked for link when a later message arrives on a lead-only card", () => {
  const r = run(submit("c_1", PILE), sortOff("c_1"), confirm("c_1", "missing", "low"));
  const info = { card: "c_1", message: PILE, door: "voice" as const, lang: null, zip: "53216" };
  const lines = messageReady(state(r), context, info, SYSTEM);
  expect(lines.events.some((e) => e.type === "ai.asked" && e.data.job === "link")).toBe(false);
});
