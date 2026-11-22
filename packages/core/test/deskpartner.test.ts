import type { Actor, Role } from "@vision/contracts";
import { describe, expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { deskView, type VaultReader, type VaultTextLine, type ViewContext } from "../src/index.js";
import {
  BASE_NOW,
  approve,
  config,
  confirm,
  members,
  pass,
  playbook,
  run,
  sortResult,
  state,
  submit,
  type AnyCommand,
  type Run,
  type Step,
} from "./helpers.js";

const PANTRY = "p_pantry";
const HOUR = 3_600_000;
const FOOD = "Meal Programs / Pantry";
const desk = { role: "desk" as Role, member: "m_d01" };

let counter = 0;
const id = (): string => {
  counter += 1;
  return `cmd_dp${String(counter)}`;
};
const as = (command: AnyCommand, actor: Actor): Step => ({ command, actor, offset: 0 });

const partnerAsked = (): Step[] => [
  submit("c_1", "We have no food in the house this week"),
  sortResult("c_1", [pass("low", "", { service: FOOD }), pass("low", "", { service: FOOD })]),
  confirm("c_1", "food", "low"),
  approve("j_1"),
  as({ id: id(), type: "consent.answer", job: "j_1", answer: "yes" }, { role: "resident", ref: "c_1" }),
];

const answer = (kind: "no" | "wait", extra: { reason?: string; waitUntil?: number }): Step =>
  as({ id: id(), type: "ask.answer", job: "j_1", answer: kind, ...extra }, { role: "partner", ref: PANTRY });

const vaultOf = (r: Run): VaultReader => {
  const texts: VaultTextLine[] = r.effects.flatMap((e) =>
    e.kind === "vault.text"
      ? [{ at: BASE_NOW, job: e.job, textKind: e.textKind, text: e.text, from: "partner" as const }]
      : [],
  );
  return { person: () => null, texts: (card) => (card === "c_1" ? texts : []) };
};

const ctxOf = (): ViewContext => ({
  now: BASE_NOW,
  newId: (prefix) => `${prefix}view`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config,
  memberRecords: [],
  partners: [{ id: PANTRY, name: "Test Pantry" }],
  links: { partner: () => null },
});

const jobOn = (r: Run) => deskView(state(r), vaultOf(r), ctxOf(), desk).jobs[0];

describe("the partner answer on the desk", () => {
  it("the desk sees why the partner said no", () => {
    const reason = "Our pantry is closed for the holiday";
    const r = run(...partnerAsked(), answer("no", { reason }));
    expect(jobOn(r)?.partnerAnswer).toEqual({
      partnerName: "Test Pantry",
      answer: "no",
      reason,
      waitUntil: null,
    });
  });

  it("the desk sees when to ask the partner again", () => {
    const waitUntil = BASE_NOW + 48 * HOUR;
    const r = run(...partnerAsked(), answer("wait", { waitUntil }));
    expect(jobOn(r)?.partnerAnswer).toEqual({
      partnerName: "Test Pantry",
      answer: "wait",
      reason: null,
      waitUntil,
    });
  });

  it("a job no partner answered has no answer line", () => {
    expect(jobOn(run(...partnerAsked()))?.partnerAnswer).toBeNull();
  });
});
