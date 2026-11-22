import type {
  Actor,
  AiOn,
  DecideContext,
  Effect,
  EventDraft,
  LangResult,
  RejectionCode,
  RequestSubmit,
} from "@vision/contracts";
import { describe, expect, it } from "vitest";
import { langStep } from "../src/decide/lang.js";
import { decide } from "../src/decide.js";
import {
  MIN_WORDS,
  SHORT_WORDS,
  SPANISH_SHARE,
  detectLanguage,
  spanishHits,
  spanishShare,
  wordsOf,
} from "../src/language.js";
import { evolve } from "../src/evolve.js";
import { sealEvent } from "../src/seal.js";
import { emptyState, type HubState } from "../src/state.js";
import { BASE_NOW, config, eventData, members, playbook, run, state, types } from "./helpers.js";
import keyFile from "../../../exam/data/key.json" with { type: "json" };
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };

const SYSTEM: Actor = { role: "system", ref: null };
const ALL_ON: AiOn = { voice: true, link: true, lang: true };
const LANG_ONLY: AiOn = { voice: false, link: false, lang: true };
const CARD = "c_1";
const SPANISH = "Buenas tardes. No tengo carro y necesito ayuda con la nieve de mi banqueta, por favor.";
const ENGLISH = "Good afternoon. I have no car and I need help with the snow on my walk, please.";

const context = (aiOn?: AiOn): DecideContext => ({
  now: BASE_NOW,
  newId: (prefix) => `${prefix}1`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config: { ...config, sorterOn: false, ...(aiOn === undefined ? {} : { aiOn }) },
});

const submit = (over: Partial<RequestSubmit> = {}): RequestSubmit => ({
  type: "request.submit",
  card: CARD,
  door: "email",
  zip: "53216",
  safeContact: true,
  firstName: "Tess",
  contact: "tess@example.test",
  address: null,
  message: SPANISH,
  ...over,
});

type Fold = { s: HubState; events: EventDraft[]; effects: Effect[]; rejection: RejectionCode | null };

const langRun = (aiOn: AiOn | undefined, ...commands: (RequestSubmit | LangResult)[]): Fold => {
  const out: Fold = { s: emptyState(), events: [], effects: [], rejection: null };
  for (const command of commands) {
    const d = decide(out.s, command, SYSTEM, context(aiOn));
    if (!d.ok) return { ...out, rejection: d.rejection.code };
    for (const draft of d.events)
      out.s = evolve(out.s, sealEvent(draft, out.s.seq + 1, BASE_NOW, out.s.lastHash));
    out.events.push(...d.events);
    out.effects.push(...d.effects);
  }
  return out;
};

describe("detectLanguage", () => {
  it("finds Spanish in a long and a short Spanish text", () => {
    expect(detectLanguage(SPANISH)).toBe("es");
    expect(detectLanguage("Sí, por favor, una caja de comida.")).toBe("es");
  });

  it("keeps English for long and short English texts", () => {
    expect(detectLanguage(ENGLISH)).toBe("en");
    expect(detectLanguage("No heat. Help me.")).toBe("en");
  });

  it("does not count words that English also uses often, such as no and me", () => {
    expect(spanishShare("No, no, help me now")).toBe(0);
  });

  it("folds accents, so Spanish without accents is still Spanish", () => {
    expect(spanishShare("Está la nieve en el jardín")).toBe(spanishShare("Esta la nieve en el jardin"));
    expect(detectLanguage("ESTA LA NIEVE EN EL JARDIN DE MI CASA")).toBe("es");
  });

  it("gives English for empty or very short text", () => {
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage("   ")).toBe("en");
    expect(detectLanguage("de la")).toBe("en");
    expect(MIN_WORDS).toBeGreaterThan(2);
  });

  it("marks a mixed text by its share of Spanish function words", () => {
    expect(detectLanguage(`Forwarded from the page inbox, can someone read this? ${SPANISH}`)).toBe("es");
    expect(detectLanguage(`${ENGLISH} ${ENGLISH} Gracias.`)).toBe("en");
  });

  it("finds 6 of 6 Spanish exam messages and marks no English exam message Spanish", () => {
    const found = keyFile.filter((row) => detectLanguage(row.text) === "es").map((row) => row.id);
    expect(found).toEqual(keyFile.filter((row) => row.lang === "es").map((row) => row.id));
    expect(found).toEqual(["m008", "m040", "m060", "m062", "m071", "m079"]);
    expect(SPANISH_SHARE).toBe(0.2);
  });
});

describe("detectLanguage and short English texts with names", () => {
  it.each([
    "Ride for Al to clinic",
    "Su is sick, need soup",
    "O'Neil needs a ride",
    "Snow on SE side",
    "Food at El Rey please",
    "Need help at La Causa",
    "Al and Su need a ride to church",
    "Ride from El Rey to La Causa",
    "Les and Del need a ride",
    "Clinic is 2 mi away",
  ])("keeps %s English", (text) => {
    expect(detectLanguage(text)).toBe("en");
  });

  it("keeps an apostrophe inside a word, so O'Neil is one word", () => {
    expect(wordsOf("O'Neil and O’Hara")).toEqual(["o'neil", "and", "o’hara"]);
  });

  it("does not count a capitalised word in the middle of a sentence", () => {
    expect(spanishHits("Ride from El Rey to La Causa")).toEqual([]);
    expect(spanishHits("La nieve. El carro")).toEqual(["la", "el"]);
  });

  it("needs two different Spanish words or a Spanish mark in a short text", () => {
    expect(detectLanguage("Tengo frio en casa")).toBe("es");
    expect(detectLanguage("Necesito ayuda, por favor")).toBe("es");
    expect(detectLanguage("Bring the de-icer")).toBe("en");
    expect(detectLanguage("Que pasa, friend")).toBe("en");
    expect(detectLanguage("¿Que pasa, friend?")).toBe("es");
    expect(SHORT_WORDS).toBe(8);
  });
});

describe("langStep", () => {
  it("sets the language of a Spanish mail card and asks for a translation when the job is on", () => {
    const r = langRun(LANG_ONLY, submit());
    expect(r.events.filter((e) => e.type === "card.lang_set")).toEqual([
      { card: CARD, job: null, actor: SYSTEM, type: "card.lang_set", data: { lang: "es" } },
    ]);
    expect(r.effects).toContainEqual({ kind: "ai", job: "lang", card: CARD });
    expect(r.s.cards[CARD]?.lang).toBe("es");
    expect(r.s.cards[CARD]?.ai.lang).toBe("pending");
  });

  it("leaves a short English mail card with a Spanish-looking name in English", () => {
    const r = langRun(LANG_ONLY, submit({ message: "Ride for Al to clinic" }));
    expect(r.events.map((e) => e.type)).not.toContain("card.lang_set");
    expect(r.effects).not.toContainEqual({ kind: "ai", job: "lang", card: CARD });
    expect(r.s.cards[CARD]?.lang ?? "en").toBe("en");
  });

  it("sets the language but asks nothing when the translation job is off", () => {
    const r = langRun(undefined, submit());
    expect(r.events.map((e) => e.type)).toContain("card.lang_set");
    expect(r.events.map((e) => e.type)).not.toContain("ai.asked");
    expect(r.s.cards[CARD]?.lang).toBe("es");
  });

  it("writes nothing for an English card, even with every job on", () => {
    const lines = langStep(
      emptyState(),
      context(ALL_ON),
      { card: CARD, message: ENGLISH, door: "email", lang: null, zip: "53216" },
      SYSTEM,
    );
    expect(lines).toEqual({ events: [], effects: [] });
  });
});

describe("langStep and a known language", () => {
  it("never changes the choice of the resident on a form card", () => {
    const english = langRun(LANG_ONLY, submit({ door: "form", lang: "en" }));
    expect(english.events.map((e) => e.type)).not.toContain("card.lang_set");
    expect(english.events.map((e) => e.type)).not.toContain("ai.asked");
    expect(english.s.cards[CARD]?.lang).toBe("en");
    const spanish = langRun(LANG_ONLY, submit({ door: "form", lang: "es", message: ENGLISH }));
    expect(spanish.events.map((e) => e.type)).not.toContain("card.lang_set");
    expect(spanish.effects).toContainEqual({ kind: "ai", job: "lang", card: CARD });
  });

  it("does not set the language again when the card already has one", () => {
    const s = langRun(undefined, submit()).s;
    const lines = langStep(
      s,
      context(LANG_ONLY),
      { card: CARD, message: SPANISH, door: "voice", lang: null, zip: "53216" },
      SYSTEM,
    );
    expect(lines.events.map((e) => e.type)).toEqual(["ai.asked"]);
  });

  it("writes no text in any ledger line", () => {
    const r = langRun(LANG_ONLY, submit());
    expect(JSON.stringify(r.events)).not.toContain("nieve");
  });
});

const result = (outcome: LangResult["outcome"], text: string | null): LangResult => ({
  type: "lang.result",
  card: CARD,
  outcome,
  text,
});

describe("lang.result", () => {
  it("an ok result adds the translation to the vault and writes ai.done with no text", () => {
    const r = langRun(LANG_ONLY, submit(), result("ok", "I have no car and I need help."));
    expect(r.rejection).toBeNull();
    expect(r.events.at(-1)).toEqual({
      card: CARD,
      job: null,
      actor: SYSTEM,
      type: "ai.done",
      data: { job: "lang", outcome: "ok" },
    });
    expect(r.effects.at(-1)).toEqual({
      kind: "vault.text",
      card: CARD,
      job: null,
      textKind: "translation",
      text: "I have no car and I need help.",
    });
    expect(r.s.cards[CARD]?.ai.lang).toBe("ok");
  });

  it("an ok result with no text counts as empty and adds nothing to the vault", () => {
    const r = langRun(LANG_ONLY, submit(), result("ok", "  "));
    expect(r.events.at(-1)?.data).toEqual({ job: "lang", outcome: "empty" });
    expect(r.effects.filter((e) => JSON.stringify(e).includes("translation"))).toEqual([]);
  });
});

describe("lang.result with no translation", () => {
  it.each(["failed", "off", "empty"] as const)("a %s result writes only ai.done", (outcome) => {
    const before = langRun(LANG_ONLY, submit());
    const r = langRun(LANG_ONLY, submit(), result(outcome, null));
    expect(r.events.slice(before.events.length)).toEqual([
      { card: CARD, job: null, actor: SYSTEM, type: "ai.done", data: { job: "lang", outcome } },
    ]);
    expect(r.effects.length).toBe(before.effects.length);
  });

  it("refuses a result for an unknown card or a card that waits for no translation", () => {
    expect(langRun(LANG_ONLY, result("ok", "text")).rejection).toBe("not_found");
    expect(langRun(undefined, submit(), result("ok", "text")).rejection).toBe("wrong_state");
    expect(langRun(LANG_ONLY, submit(), result("ok", "a"), result("ok", "b")).rejection).toBe("wrong_state");
  });

  it("only the system may send a result", () => {
    const d = decide(emptyState(), result("ok", "text"), { role: "desk", ref: "m_d01" }, context(LANG_ONLY));
    expect(d.ok ? null : d.rejection.code).toBe("forbidden");
  });
});

it("the run helpers fold a Spanish card into state with its language", () => {
  const r = run({ command: submit(), actor: SYSTEM, offset: 0 });
  expect(types(r)).toContain("card.lang_set");
  expect(eventData(r, "card.lang_set")).toEqual({ lang: "es" });
  expect(state(r).cards[CARD]?.lang).toBe("es");
});
