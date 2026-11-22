import { describe, expect, it } from "vitest";
import type { Actor } from "@vision/contracts";
import {
  approve,
  confirm,
  confirmedSnow,
  offerAgain,
  offerTo,
  post,
  raise,
  runFrom,
  sortOff,
  stateWithLevel,
  submit,
  tapFor,
  type AnyCommand,
  type Step,
} from "./helpers.js";
import { emptyState, type HubState } from "../src/state.js";

type As = { as: "desk" | "lead" };
type Row = { name: string; send: (options: As) => Step; lead: "ok" | "wrong_state" };

const SENDERS: Record<As["as"], Actor> = {
  desk: { role: "desk", ref: "m_d01" },
  lead: { role: "lead", ref: "m_l01" },
};
const answer = (command: AnyCommand, o: As): Step => ({ command, actor: SENDERS[o.as], offset: 0 });

const quietSetup: Step[] = [
  submit("c_1", "text", { safeContact: false }),
  sortOff("c_1"),
  confirm("c_1", "snow", "low", { as: "lead" }),
];

const jobs: { name: string; from: HubState; setup: Step[] }[] = [
  { name: "a quiet job", from: emptyState(), setup: quietSetup },
  { name: "a level 3 job", from: stateWithLevel("snow", 3), setup: confirmedSnow() },
];

const rows: Row[] = [
  { name: "card.raise", send: (o) => raise("c_1", o), lead: "ok" },
  { name: "thread.post", send: (o) => post("c_1", "Hello", o), lead: "ok" },
  { name: "job.approve", send: (o) => approve("j_1", o), lead: "ok" },
  { name: "job.offer_again", send: (o) => offerAgain("j_1", o), lead: "wrong_state" },
  { name: "job.offer_to", send: (o) => offerTo("j_1", "m_v01", o), lead: "ok" },
  { name: "job.tap_for", send: (o) => tapFor("j_1", "m_v01", "accept", undefined, o), lead: "ok" },
  {
    name: "consent.answer",
    send: (o) => answer({ id: "cmd_g_consent", type: "consent.answer", job: "j_1", answer: "yes" }, o),
    lead: "wrong_state",
  },
  {
    name: "checkback.answer",
    send: (o) => answer({ id: "cmd_g_checkback", type: "checkback.answer", job: "j_1", answer: 1 }, o),
    lead: "wrong_state",
  },
];

const OTHERS: Actor[] = [
  { role: "desk", ref: "m_d01" },
  { role: "volunteer", ref: "m_v01" },
  { role: "partner", ref: "p_pantry" },
];

const asActor = (s: Step, actor: Actor): Step => ("members" in s ? s : { ...s, actor });

const last = (from: HubState, setup: Step[], s: Step) => {
  const d = runFrom(from, ...setup, s);
  return { rejected: d.rejections.length > 0 ? d.rejections.at(-1) : undefined, d };
};

describe("only the lead handles a quiet or level 3 job", () => {
  describe.each(jobs)("$name", ({ from, setup }) => {
    it("the setup leaves one job that the lead must handle", () => {
      const job = runFrom(from, ...setup).state.jobs["j_1"];
      expect(job !== undefined && (job.quiet || job.level === 3)).toBe(true);
    });

    it.each(rows)("$name is forbidden for the desk, a member and a partner", ({ send }) => {
      for (const actor of OTHERS) {
        expect(last(from, setup, asActor(send({ as: "desk" }), actor)).rejected).toBe("forbidden");
      }
    });

    it.each(rows)("$name works for the lead", ({ send, lead }) => {
      const { rejected } = last(from, setup, send({ as: "lead" }));
      expect(rejected).toBe(lead === "ok" ? undefined : lead);
    });
  });
});
