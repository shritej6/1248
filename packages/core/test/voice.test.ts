import type {
  Actor,
  Config,
  DecideContext,
  Effect,
  LedgerEvent,
  RejectionCode,
  SortPass,
} from "@vision/contracts";
import { expect, it } from "vitest";
import { decide } from "../src/decide.js";
import type { AnyCommand } from "../src/decide/result.js";
import { evolve } from "../src/evolve.js";
import { sealEvent } from "../src/seal.js";
import { emptyState, type HubState } from "../src/state.js";
import { BASE_NOW, config, members, pass, playbook, stateWithLevel } from "./helpers.js";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };

const SYSTEM: Actor = { role: "system", ref: null };
const DESK: Actor = { role: "desk", ref: "m_d01" };
const CARD = "c_7b1d2e44-9a0c-4f3e-8d21-5c6b7a8e9f01";
const CALLBACK = "414-555-0177";
const TRANSCRIPT = "Hi this is Ruthie. Please shovel my walk. There is a gas smell in the kitchen.";
const GIST = "Snow on the front walk. Gas smell in the kitchen since last night.";
const ON = { voice: true, link: false, lang: false };
const OFF = { aiOn: undefined, sorterOn: false };

type Run = { state: HubState; events: LedgerEvent[]; effects: Effect[]; rejections: RejectionCode[] };
type Step = { command: AnyCommand; actor?: Actor };

const contextOf = (over: Partial<Config>): DecideContext => ({
  now: BASE_NOW,
  newId: (prefix) => `${prefix}1`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config: { ...config, aiOn: ON, ...over },
});

const runFrom = (from: HubState, over: Partial<Config>, ...steps: Step[]): Run => {
  const out: Run = { state: from, events: [], effects: [], rejections: [] };
  for (const s of steps) {
    const decision = decide(out.state, s.command, s.actor ?? SYSTEM, contextOf(over));
    if (!decision.ok) {
      out.rejections.push(decision.rejection.code);
      continue;
    }
    for (const draft of decision.events) {
      const line = sealEvent(draft, out.state.seq + 1, BASE_NOW, out.state.lastHash);
      out.events.push(line);
      out.state = evolve(out.state, line);
    }
    out.effects.push(...decision.effects);
  }
  return out;
};

const run = (over: Partial<Config>, ...steps: Step[]): Run => runFrom(emptyState(), over, ...steps);

const received = (callback: string | null = CALLBACK): Step => ({
  command: { type: "voice.received", card: CARD, zip: "53216", callback },
});
const result = (outcome: "ok" | "empty" | "failed" | "off", text: string | null = null): Step => ({
  command: { type: "voice.result", card: CARD, outcome, text },
});
const gist = (text = GIST, actor: Actor = DESK): Step => ({
  command: { id: "cmd_gist", type: "voice.gist", card: CARD, text },
  actor,
});
const sortResult = (message: string, passes: SortPass[]): Step => ({
  command: { type: "sort.result", card: CARD, message, passes, error: null },
});
const formCard: Step = {
  command: {
    type: "request.submit",
    card: CARD,
    door: "form",
    zip: "53216",
    safeContact: true,
    firstName: "Tess",
    contact: "tess@example.test",
    address: null,
    message: "Snow on my walk",
  },
};

const types = (r: Run): string[] => r.events.map((e) => e.type);
const vaultTexts = (r: Run): string[] =>
  r.effects.flatMap((e) => (e.kind === "vault.text" && e.textKind === "message_in" ? [e.text] : []));
const personOf = (r: Run): Effect | undefined => r.effects.find((e) => e.kind === "vault.person");

it("voice.received puts the card on the board at once with door voice, no language and no message", () => {
  const r = run({}, received());
  expect(r.events.find((e) => e.type === "card.received")?.data).toEqual({
    door: "voice",
    zip: "53216",
    safeContact: true,
  });
  expect(r.state.cards[CARD]?.lang).toBeNull();
  expect(vaultTexts(r)).toEqual([]);
  expect(personOf(r)).toEqual({
    kind: "vault.person",
    card: CARD,
    firstName: "Caller",
    contact: CALLBACK,
    address: null,
  });
});

it("voice.received asks the voice job only when the job is on", () => {
  const on = run({}, received());
  expect(types(on)).toEqual(["card.received", "ai.asked"]);
  expect(on.effects).toContainEqual({ kind: "ai", job: "voice", card: CARD });
  expect(on.state.cards[CARD]?.ai.voice).toBe("pending");
  const off = run({ aiOn: { voice: false, link: false, lang: false } }, received());
  expect(types(off)).toEqual(["card.received"]);
  expect(off.effects.some((e) => e.kind === "ai")).toBe(false);
  expect(types(run(OFF, received()))).toEqual(["card.received"]);
});

it("voice.received keeps an empty contact when the desk typed no callback number", () => {
  expect(personOf(run({}, received(null)))).toMatchObject({ firstName: "Caller", contact: "" });
});

it("voice.received refuses a card that is already on the board and refuses a person as the sender", () => {
  expect(run({}, received(), received()).rejections).toEqual(["wrong_state"]);
  expect(run({}, { ...received(), actor: DESK }).rejections).toEqual(["forbidden"]);
});

it("an ok transcript becomes the message in the vault and goes to the sorter", () => {
  const r = run({ sorterOn: true }, received(), result("ok", TRANSCRIPT));
  expect(r.events.at(-1)?.type).toBe("ai.done");
  expect(r.events.at(-1)?.data).toEqual({ job: "voice", outcome: "ok" });
  expect(vaultTexts(r)).toEqual([TRANSCRIPT]);
  expect(r.effects).toContainEqual({ kind: "sort", card: CARD });
  expect(r.state.cards[CARD]?.ai.voice).toBe("ok");
});

it("with the sorter off the word list reads the transcript and raises the hidden danger", () => {
  const r = run({ sorterOn: false }, received(), result("ok", TRANSCRIPT));
  expect(r.events.find((e) => e.type === "card.sorted")?.data).toMatchObject({
    source: "none",
    flags: ["sorter_off", "word_list_hit", "voice_transcript"],
  });
  expect(types(r)).toContain("page.sent");
});

it.each(["empty", "failed", "off"] as const)("the voice outcome %s adds only ai.done", (outcome) => {
  const r = run({ sorterOn: false }, received(), result(outcome));
  expect(types(r)).toEqual(["card.received", "ai.asked", "ai.done"]);
  expect(r.events.at(-1)?.data).toEqual({ job: "voice", outcome });
  expect(vaultTexts(r)).toEqual([]);
  expect(r.state.cards[CARD]?.ai.voice).toBe(outcome);
});

it("an ok voice answer with only spaces counts as empty", () => {
  const r = run({ sorterOn: false }, received(), result("ok", "   "));
  expect(r.events.at(-1)?.data).toEqual({ job: "voice", outcome: "empty" });
  expect(vaultTexts(r)).toEqual([]);
});

it("voice.result refuses a card with no pending transcript", () => {
  expect(run({}, result("ok", TRANSCRIPT)).rejections).toEqual(["not_found"]);
  expect(run({}, formCard, result("ok", TRANSCRIPT)).rejections).toEqual(["not_found"]);
  expect(run({}, received(), result("failed"), result("ok", TRANSCRIPT)).rejections).toEqual(["wrong_state"]);
  expect(run(OFF, received(), result("ok", TRANSCRIPT)).rejections).toEqual(["wrong_state"]);
});

it("the desk types the gist when the transcript failed, and the word list reads it", () => {
  const r = run({ sorterOn: false }, received(), result("failed"), gist());
  expect(types(r).slice(3)).toEqual(["card.gist_typed", "card.sorted", "page.sent"]);
  expect(vaultTexts(r)).toEqual([GIST]);
  expect(r.state.cards[CARD]?.gistAt).toBe(BASE_NOW);
  expect(r.events.find((e) => e.type === "card.sorted")?.data).toMatchObject({
    flags: ["sorter_off", "word_list_hit", "voice_transcript"],
  });
});

it("voice.gist works with the voice job off, and the lead may type it too", () => {
  expect(types(run(OFF, received(), gist()))).toContain("card.gist_typed");
  const lead: Actor = { role: "lead", ref: "m_l01" };
  expect(types(run(OFF, received(), gist(GIST, lead)))).toContain("card.gist_typed");
});

it("voice.gist refuses a card that is not a voicemail, has a transcript, waits for one or has a gist", () => {
  expect(run({}, formCard, gist()).rejections).toEqual(["wrong_state"]);
  expect(run({}, received(), result("ok", TRANSCRIPT), gist()).rejections).toEqual(["wrong_state"]);
  expect(run({}, received(), gist()).rejections).toEqual(["wrong_state"]);
  expect(run(OFF, received(), gist(), gist()).rejections).toEqual(["wrong_state"]);
  expect(run({}, gist()).rejections).toEqual(["not_found"]);
});

it("voice.gist refuses a volunteer", () => {
  const volunteer: Actor = { role: "volunteer", ref: "m_v01" };
  expect(run(OFF, received(), gist(GIST, volunteer)).rejections).toEqual(["forbidden"]);
});

it("no ledger line of the voice flow holds the transcript, the gist or the callback number", () => {
  const lines = [
    ...run({ sorterOn: false }, received(), result("ok", TRANSCRIPT)).events,
    ...run({ sorterOn: false }, received(), result("failed"), gist()).events,
  ];
  const ledger = JSON.stringify(lines);
  for (const secret of [TRANSCRIPT, GIST, CALLBACK, "Ruthie", "gas smell", "Caller"])
    expect(ledger).not.toContain(secret);
});

it("a voice card on a level 1 need that the AI sorts as plain snow work waits for a person", () => {
  const message = "Please shovel my walk";
  const r = runFrom(
    stateWithLevel("snow", 1),
    { sorterOn: true },
    received(),
    result("ok", message),
    sortResult(message, [pass("low"), pass("low")]),
  );
  expect(r.events.find((e) => e.type === "card.sorted")?.data).toMatchObject({
    flags: ["voice_transcript"],
  });
  expect(types(r)).not.toContain("card.confirmed");
  expect(r.state.cards[CARD]?.level).toBeNull();
});

const confirmSnow: Step = {
  command: {
    id: "cmd_confirm",
    type: "card.confirm",
    card: CARD,
    need: "snow",
    urgency: "low",
    division: null,
  },
  actor: DESK,
};
const withdraw: Step = {
  command: { id: "cmd_withdraw", type: "job.withdraw", job: "j_1", reason: "cancelled" },
  actor: DESK,
};
const plannedLevel = (r: Run) => r.events.find((e) => e.type === "job.planned")?.data.level;

it("a voice card the desk confirms before any transcript or gist still gets a level 2 job", () => {
  const r = runFrom(stateWithLevel("snow", 1), OFF, received(), confirmSnow);
  expect(r.rejections).toEqual([]);
  expect(r.state.cards[CARD]?.sorted).toBeNull();
  expect(plannedLevel(r)).toBe(2);
  expect(r.state.cards[CARD]?.level).toBe(2);
});

it("a transcript that comes after the job is withdrawn writes only ai.done and starts no work", () => {
  const r = runFrom(
    stateWithLevel("snow", 1),
    {},
    received(),
    confirmSnow,
    withdraw,
    result("ok", TRANSCRIPT),
  );
  expect(r.rejections).toEqual([]);
  expect(r.events.at(-1)?.type).toBe("ai.done");
  expect(types(r)).not.toContain("card.sorted");
  expect(types(r)).not.toContain("page.sent");
  expect(vaultTexts(r)).toEqual([]);
  expect(r.effects.some((e) => e.kind === "sort" || (e.kind === "ai" && e.job !== "voice"))).toBe(false);
});

it("voice.gist refuses a voicemail whose jobs are all closed", () => {
  const r = runFrom(stateWithLevel("snow", 1), OFF, received(), confirmSnow, withdraw, gist());
  expect(r.rejections).toEqual(["wrong_state"]);
  expect(types(r)).not.toContain("card.gist_typed");
});
