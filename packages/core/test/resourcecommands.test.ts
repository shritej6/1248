import { EffectSchema, LedgerEventSchema, type Actor, type SystemCommand } from "@vision/contracts";
import { expect, it } from "vitest";
import { sha256Hex } from "../src/seal.js";
import { uid } from "./arbitraries.js";
import { confirmedSnow, run, runFrom, type Step } from "./helpers.js";

const SYSTEM: Actor = { role: "system", ref: null };
const DRAFT = uid("d_", 7);
const BY = uid("m_", 3);
const TEXT = [
  "To the team at Bader Philanthropies, preliminary application,",
  "",
  "With thanks,",
  "ComForce demo",
  "",
  "Source: the Vision record for November 2026 so far, sealed at line 12.",
].join("\n");

const ask: SystemCommand = {
  type: "draft.ask",
  draft: DRAFT,
  kind: "funder_letter",
  month: "2026-11",
  resource: "bader_preliminary",
  by: BY,
};
const result: SystemCommand = {
  type: "draft.result",
  draft: DRAFT,
  text: TEXT,
  source: "template",
  flag: "guard_rejected",
  reasons: ["number", "quote"],
};
const approve: SystemCommand = { type: "draft.approve", draft: DRAFT, textHash: sha256Hex(TEXT), by: BY };

const as = (command: SystemCommand, actor: Actor = SYSTEM): Step => ({ command, actor, offset: 0 });

it("draft.ask writes draft.asked with the organiser in by, and the draft effect", () => {
  const out = run(as(ask));
  expect(out.rejections).toEqual([]);
  expect(out.events).toHaveLength(1);
  expect(out.events[0]).toMatchObject({
    card: null,
    job: null,
    actor: SYSTEM,
    type: "draft.asked",
    data: { draft: DRAFT, kind: "funder_letter", month: "2026-11", resource: "bader_preliminary", by: BY },
  });
  expect(out.effects).toEqual([{ kind: "draft", draft: DRAFT }]);
});

it("draft.result puts only the hash of the text in draft.done, and the text in the draft.text effect", () => {
  const out = run(as(result));
  expect(out.events).toHaveLength(1);
  expect(out.events[0]).toMatchObject({
    card: null,
    job: null,
    actor: SYSTEM,
    type: "draft.done",
    data: { draft: DRAFT, source: "template", flag: "guard_rejected", textHash: sha256Hex(TEXT) },
  });
  expect(JSON.stringify(out.events)).not.toContain("Bader");
  expect(out.effects).toEqual([
    {
      kind: "draft.text",
      draft: DRAFT,
      text: TEXT,
      textHash: sha256Hex(TEXT),
      source: "template",
      flag: "guard_rejected",
      reasons: ["number", "quote"],
    },
  ]);
});

it("draft.approve writes draft.approved with the hash and the member, and no effect", () => {
  const out = run(as(approve));
  expect(out.events).toHaveLength(1);
  expect(out.events[0]).toMatchObject({
    card: null,
    job: null,
    actor: SYSTEM,
    type: "draft.approved",
    data: { draft: DRAFT, textHash: sha256Hex(TEXT), by: BY },
  });
  expect(out.effects).toEqual([]);
});

it("an AI text keeps a null flag and no reasons", () => {
  const out = run(as({ ...result, source: "ai", flag: null, reasons: [] }));
  expect(out.events[0]?.data).toEqual({ draft: DRAFT, source: "ai", flag: null, textHash: sha256Hex(TEXT) });
  expect(out.effects[0]).toMatchObject({ source: "ai", flag: null, reasons: [] });
});

const REFUSED = (["organiser", "desk", "lead", "volunteer"] as const).flatMap((role) =>
  [ask, result, approve].map((command) => ({ role, type: command.type, command })),
);

it.each(REFUSED)("the role $role may not send $type", ({ role, command }) => {
  const out = run(as(command, { role, ref: BY }));
  expect(out.rejections).toEqual(["forbidden"]);
  expect(out.events).toEqual([]);
});

it("the lines and effects parse with the contract schemas", () => {
  const out = run(as(ask), as(result), as(approve));
  expect(out.events.map((e) => e.type)).toEqual(["draft.asked", "draft.done", "draft.approved"]);
  for (const e of out.events) expect(LedgerEventSchema.safeParse(e).success).toBe(true);
  for (const e of out.effects) expect(EffectSchema.safeParse(e).success).toBe(true);
});

it("folding the draft lines changes only seq and lastHash", () => {
  const before = run(...confirmedSnow()).state;
  const out = runFrom(before, as(ask), as(result), as(approve));
  expect(out.rejections).toEqual([]);
  expect(out.state.seq).toBe(before.seq + 3);
  expect(out.state.lastHash).not.toBe(before.lastHash);
  expect({ ...out.state, seq: before.seq, lastHash: before.lastHash }).toEqual(before);
});
