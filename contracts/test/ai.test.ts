import { describe, expect, it } from "vitest";
import {
  ConfigSchema,
  DeskBoardSchema,
  EffectSchema,
  LedgerEventSchema,
  RequestFormSchema,
  SystemCommandSchema,
  TrackingSchema,
  VOICE_MAX_SECONDS,
  VoiceDoorFieldsSchema,
  VoicemailFieldsSchema,
  eventData,
} from "../src/index.js";

const CARD = "c_5e2a9c41-8b7d-4f13-a6e0-3d9c1b7f2a84";
const OTHER = "c_7a1d3f92-4e6b-4c08-b5a7-1f3e9d2c6b84";

describe("the voicemail fields", () => {
  it("an empty ZIP and an empty callback become null", () => {
    expect(VoicemailFieldsSchema.parse({ zip: "", callback: " ", seconds: "42" })).toEqual({
      zip: null,
      callback: null,
      seconds: 42,
    });
  });
  it("missing optional fields are null", () => {
    expect(VoicemailFieldsSchema.parse({ seconds: 10 })).toEqual({ zip: null, callback: null, seconds: 10 });
  });
  it("a recording longer than 2 minutes or a bad ZIP is refused", () => {
    expect(VoicemailFieldsSchema.safeParse({ seconds: VOICE_MAX_SECONDS + 1 }).success).toBe(false);
    expect(VoicemailFieldsSchema.safeParse({ zip: "5321", seconds: 10 }).success).toBe(false);
  });
  it("the callback is a phone number, so an email address is refused", () => {
    const parsed = VoicemailFieldsSchema.parse({ callback: "+1 (414) 555-0177", seconds: 10 });
    expect(parsed.callback).toBe("+1 (414) 555-0177");
    for (const callback of ["ruthie@example.test", "call me", "--"])
      expect(VoicemailFieldsSchema.safeParse({ callback, seconds: 10 }).success, callback).toBe(false);
    const command = { type: "voice.received", card: CARD, zip: null, callback: "ruthie@example.test" };
    expect(SystemCommandSchema.safeParse(command).success).toBe(false);
  });
  it("the phone door needs a recording id for a safe second send", () => {
    expect(VoiceDoorFieldsSchema.safeParse({ seconds: 10 }).success).toBe(false);
    expect(VoiceDoorFieldsSchema.parse({ recordingId: "rec-1", seconds: 10 }).recordingId).toBe("rec-1");
  });
});

describe("the AI job commands and events", () => {
  it("the four system commands of the AI jobs parse", () => {
    for (const command of [
      { type: "voice.received", card: CARD, zip: "53216", callback: "414-555-0100" },
      { type: "voice.result", card: CARD, outcome: "ok", text: "Please clear my steps" },
      { type: "link.result", card: CARD, outcome: "ok", matches: [{ other: OTHER, score: 0.93 }] },
      { type: "lang.result", card: CARD, outcome: "failed", text: null },
    ])
      expect(SystemCommandSchema.safeParse(command).success, command.type).toBe(true);
  });
  it("a link score above 1 is refused", () => {
    const command = {
      type: "link.result",
      card: CARD,
      outcome: "ok",
      matches: [{ other: OTHER, score: 1.2 }],
    };
    expect(SystemCommandSchema.safeParse(command).success).toBe(false);
  });
  it("the ledger events of the AI jobs hold no free text", () => {
    expect(eventData["link.proposed"].safeParse({ other: OTHER, score: 0.9, text: "x" }).success).toBe(false);
    expect(eventData["ai.done"].safeParse({ job: "voice", outcome: "ok", transcript: "x" }).success).toBe(
      false,
    );
    expect(eventData["card.gist_typed"].safeParse({ text: "x" }).success).toBe(false);
  });
});

describe("the AI job ledger lines and effects", () => {
  it("an old card.received line with no language still parses", () => {
    const line = {
      seq: 1,
      at: 1,
      card: CARD,
      job: null,
      type: "card.received",
      actor: { role: "system", ref: null },
      data: { door: "email", zip: null, safeContact: true },
      prev: "0".repeat(64),
      hash: "1".repeat(64),
    };
    expect(LedgerEventSchema.safeParse(line).success).toBe(true);
  });
  it("the ai effect holds only the job and the card id", () => {
    expect(EffectSchema.safeParse({ kind: "ai", job: "link", card: CARD }).success).toBe(true);
    expect(EffectSchema.safeParse({ kind: "ai", job: "link", card: CARD, text: "x" }).success).toBe(false);
  });
});

describe("views and config", () => {
  it("a config with no AI switches still parses", () => {
    const config = {
      org: "comforce-demo",
      orgName: "ComForce demo",
      pageList: [],
      waveSize: 10,
      maxWaves: 3,
      demoMode: true,
      forgetDays: 90,
      sorterOn: false,
    };
    expect(ConfigSchema.safeParse(config).success).toBe(true);
    expect(
      ConfigSchema.safeParse({ ...config, aiOn: { voice: true, link: false, lang: true } }).success,
    ).toBe(true);
  });
  it("the request form takes an optional language", () => {
    const form = {
      firstName: "Rosa",
      contactKind: "email",
      contact: "rosa@example.test",
      zip: "53216",
      message: "Necesito ayuda",
      address: "",
      safeContact: true,
      website: "",
    };
    expect(RequestFormSchema.parse({ ...form, lang: "es" }).lang).toBe("es");
    expect(RequestFormSchema.safeParse({ ...form, lang: "fr" }).success).toBe(false);
  });
  it("the desk board and tracking view take the new optional fields", () => {
    const shape = DeskBoardSchema.shape;
    expect(shape.eventGroups.safeParse([{ cards: [CARD, OTHER], highest: "high" }]).success).toBe(true);
    expect(shape.eventGroups.safeParse([{ cards: [CARD], highest: null }]).success).toBe(false);
    expect(TrackingSchema.shape.lang.safeParse("es").success).toBe(true);
  });
});
