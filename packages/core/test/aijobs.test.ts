import type { Actor, DecideContext, RequestSubmit } from "@vision/contracts";
import { expect, it } from "vitest";
import { aiOn, askAi } from "../src/decide/aiask.js";
import { messageReady } from "../src/decide/intake.js";
import { decide } from "../src/decide.js";
import { emptyState } from "../src/state.js";
import {
  BASE_NOW,
  config,
  eventData,
  members,
  pass,
  playbook,
  run,
  runFrom,
  sortResult,
  state,
  stateWithLevel,
  types,
} from "./helpers.js";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };

const SYSTEM: Actor = { role: "system", ref: null };

const context = (over: Partial<DecideContext["config"]> = {}): DecideContext => ({
  now: BASE_NOW,
  newId: (prefix) => `${prefix}1`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config: { ...config, ...over },
});

const voiceSubmit = (card: string, message: string): RequestSubmit => ({
  type: "request.submit",
  card,
  door: "voice",
  zip: "53216",
  safeContact: true,
  firstName: "Caller",
  contact: "414-555-0100",
  address: null,
  message,
});

const step = (command: RequestSubmit) => ({ command, actor: SYSTEM, offset: 0 });

it("askAi writes ai.asked and one outbox item with only the card id when the job is on", () => {
  const ctx = context({ aiOn: { voice: true, link: false, lang: false } });
  expect(aiOn(ctx, "voice")).toBe(true);
  expect(askAi(ctx, "voice", "c_1", SYSTEM)).toEqual({
    events: [{ card: "c_1", job: null, actor: SYSTEM, type: "ai.asked", data: { job: "voice" } }],
    effects: [{ kind: "ai", job: "voice", card: "c_1" }],
  });
});

it("askAi does nothing when the model var is empty, so the system works without the job", () => {
  expect(askAi(context(), "link", "c_1", SYSTEM)).toEqual({ events: [], effects: [] });
  expect(askAi(context({ aiOn: { voice: false, link: false, lang: false } }), "lang", "c_1", SYSTEM)).toEqual(
    {
      events: [],
      effects: [],
    },
  );
});

it("a form request keeps the language the resident chose in card.received", () => {
  const d = run(step({ ...voiceSubmit("c_1", "Necesito ayuda con la nieve"), door: "form", lang: "es" }));
  expect(eventData(d, "card.received")).toEqual({
    door: "form",
    zip: "53216",
    safeContact: true,
    lang: "es",
  });
  expect(state(d).cards["c_1"]?.lang).toBe("es");
});

it("a request with no language choice has no lang field in the ledger and an unknown language", () => {
  const d = run(step({ ...voiceSubmit("c_1", "Snow on my walk"), door: "email" }));
  expect(eventData(d, "card.received")).toEqual({ door: "email", zip: "53216", safeContact: true });
  expect(state(d).cards["c_1"]?.lang).toBeNull();
});

it("with the sorter off a voice card carries the voice flag next to sorter_off", () => {
  const decision = decide(
    emptyState(),
    voiceSubmit("c_1", "My walk is icy"),
    SYSTEM,
    context({ sorterOn: false }),
  );
  const sorted = decision.ok ? decision.events.find((e) => e.type === "card.sorted") : undefined;
  expect(sorted?.data).toMatchObject({ flags: ["sorter_off", "voice_transcript"] });
});

it("a voice card on a level 1 need that the AI sorts as plain snow work waits for a person", () => {
  const d = runFrom(
    stateWithLevel("snow", 1),
    step(voiceSubmit("c_1", "Please shovel my walk")),
    sortResult("c_1", [pass("low"), pass("low")]),
  );
  expect(eventData(d, "card.sorted").flags).toEqual(["voice_transcript"]);
  expect(types(d)).not.toContain("card.confirmed");
  expect(state(d).cards["c_1"]?.level).toBeNull();
});

it("messageReady runs the sort step for a message that becomes ready later", () => {
  const lines = messageReady(
    emptyState(),
    context(),
    { card: "c_1", message: "hello", door: "voice", lang: null, zip: null },
    SYSTEM,
  );
  expect(lines.effects).toEqual([{ kind: "sort", card: "c_1" }]);
});
