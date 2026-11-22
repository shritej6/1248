import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeskBoardSchema, type DeskBoard, type DeskCard } from "@vision/contracts";
import { langSlots } from "../src/components/Translation/slots.js";
import { mergeSlots } from "../src/components/deskSlots.js";
import { DeskView, type DeskSend } from "../src/pages/DeskPage.js";
import { spanishDayTime, spanishLongDate, spanishStep } from "../src/pages/spanish.js";
import { fixture } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const send: DeskSend = () => Promise.resolve({ ok: true });
const ORIGINAL = "Tengo setenta y seis años y no puedo palear la nieve";
const TRANSLATED = "I am seventy six and I cannot shovel the snow";

const board = (change: Partial<DeskCard>): DeskBoard => {
  const base = DeskBoardSchema.parse(fixture("views/desk-board.json"));
  const card = base.triage[0];
  if (card === undefined) throw new Error("the fixture has no triage card");
  return { ...base, pages: [], triage: [{ ...card, message: ORIGINAL, ...change }] };
};

const openCard = (change: Partial<DeskCard>) => {
  render(<DeskView board={board(change)} send={send} slots={mergeSlots([langSlots])} hub={null} />);
  const triage = within(screen.getByRole("region", { name: "Triage lane" }));
  fireEvent.click(screen.getByRole("button", { name: /Tengo setenta/ }));
  return { triage, panel: within(screen.getByRole("region", { name: /Request/ })) };
};

describe("the Spanish chip on a desk row", () => {
  it("a Spanish card shows the chip ES", () => {
    const { triage } = openCard({ lang: "es" });
    expect(triage.getByText("ES")).toBeTruthy();
  });

  it("an English card or a card with no language shows no chip", () => {
    openCard({ lang: "en" });
    expect(screen.queryByText("ES")).toBeNull();
    cleanup();
    openCard({});
    expect(screen.queryByText("ES")).toBeNull();
  });
});

describe("the machine translation under the original", () => {
  it("shows the label and the translation below the words of the resident", () => {
    const { panel } = openCard({ lang: "es", ai: { lang: "ok" }, translation: TRANSLATED });
    const section = panel.getByRole("region", { name: "Machine translation" });
    expect(
      within(section).getByText(
        "Machine translation from Spanish. It can miss or change words, so check the original above before you decide.",
      ),
    ).toBeTruthy();
    expect(within(section).getByText(TRANSLATED)).toBeTruthy();
    const words = panel.getByRole("region", { name: "Words of the resident" });
    expect(words.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(words.textContent).toContain(ORIGINAL);
  });

  it("says the translation is on the way while the job waits", () => {
    const { panel } = openCard({ lang: "es", ai: { lang: "pending" }, translation: null });
    expect(panel.getByText("The machine translation is on the way.")).toBeTruthy();
  });

  it.each(["failed", "empty"] as const)("a %s job tells the desk to read the original", (status) => {
    const { panel } = openCard({ lang: "es", ai: { lang: status }, translation: null });
    expect(
      panel.getByText("The machine translation did not work. Read the original or ask a Spanish speaker."),
    ).toBeTruthy();
  });

  it("shows nothing when the job is off or the card is English", () => {
    openCard({ lang: "es", ai: { lang: "off" }, translation: null });
    expect(screen.queryByText(/machine translation/i)).toBeNull();
    cleanup();
    openCard({ lang: "en", ai: { lang: "ok" }, translation: TRANSLATED });
    expect(screen.queryByText(/machine translation/i)).toBeNull();
  });
});

describe("the warning under the machine translation", () => {
  it("warns under the translation that the AI urgency comes from the original words", () => {
    const { panel } = openCard({ lang: "es", ai: { lang: "ok" }, translation: TRANSLATED });
    const section = panel.getByRole("region", { name: "Machine translation" });
    const warning = within(section).getByText(
      "Machine translation can drop details. The AI urgency comes from the original words.",
    );
    const text = within(section).getByText(TRANSLATED);
    expect(text.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["has no sort", null],
    ["has only the word list sort", { service: null, division: null, urgency: "high", source: "none" }],
  ] as const)("names no AI urgency when the card %s", (_name, sorted) => {
    const { panel } = openCard({ lang: "es", ai: { lang: "ok" }, translation: TRANSLATED, sorted });
    const section = panel.getByRole("region", { name: "Machine translation" });
    expect(within(section).getByText("Machine translation can drop details.")).toBeTruthy();
    expect(section.textContent).not.toContain("AI urgency");
  });

  it("shows no warning when there is no translation", () => {
    openCard({ lang: "es", ai: { lang: "pending" }, translation: null });
    expect(screen.queryByText(/can drop details/)).toBeNull();
  });
});

describe("Spanish times and steps for the resident", () => {
  const now = Date.UTC(2026, 10, 22, 18, 0);

  it("dates and times are Spanish in the Chicago zone", () => {
    expect(spanishDayTime(Date.UTC(2026, 10, 22, 15, 0), now)).toBe("Hoy 9:00 a.m.");
    expect(spanishLongDate(Date.UTC(2026, 11, 21, 18))).toBe("21 de diciembre de 2026");
  });

  it("each tracking step has Spanish words, and a partner keeps its name", () => {
    expect(spanishStep("Received")).toBe("Recibida");
    expect(spanishStep("A volunteer has it")).toBe("Una persona voluntaria la tiene");
    expect(spanishStep("Northside Pantry (test) has it")).toBe("Northside Pantry (test) la tiene");
    expect(spanishStep("Something new")).toBe("Something new");
  });
});
