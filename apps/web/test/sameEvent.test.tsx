import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DeskBoardSchema,
  type Command,
  type DeskBoard,
  type DeskCard,
  type DeskLink,
} from "@vision/contracts";
import { clockTime } from "../src/components/clockTime.js";
import { mergeSlots } from "../src/components/deskSlots.js";
import { linkSlots } from "../src/components/SameEvent/slots.js";
import { DeskView, type DeskSend } from "../src/pages/DeskPage.js";
import { fixture } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SLOTS = mergeSlots([linkSlots]);
const A = "c_11111111-1111-4111-8111-111111111111";
const B = "c_22222222-2222-4222-8222-222222222222";
const C = "c_33333333-3333-4333-8333-333333333333";
const AT_A = 1795334100000;
const AT_B = AT_A + 20 * 60_000;

const base = DeskBoardSchema.parse(fixture("views/desk-board.json"));
const template = base.triage[0];
if (template === undefined) throw new Error("the fixture has no triage card");

const link = (other: string, otherReceivedAt: number, more: Partial<DeskLink> = {}): DeskLink => ({
  other,
  score: 0.91,
  answer: null,
  otherZip: "53216",
  otherReceivedAt,
  otherUrgency: "low",
  ...more,
});

const card = (id: string, message: string, receivedAt: number, more: Partial<DeskCard> = {}): DeskCard => ({
  ...template,
  card: id,
  message,
  quotes: [],
  receivedAt,
  ...more,
});

const board = (a: Partial<DeskCard> = {}, b: Partial<DeskCard> = {}, extra: Partial<DeskBoard> = {}) => ({
  ...base,
  pages: [],
  emergency: [],
  triage: [
    card(A, "A couch and bags dumped in the alley behind 5th Street", AT_A, { links: [link(B, AT_B)], ...a }),
    card(B, "Somebody left a couch and trash in our alley off 5th", AT_B, { links: [link(A, AT_A)], ...b }),
  ],
  ...extra,
});

const recorder = () => {
  const sent: Command[] = [];
  const send: DeskSend = (command) => {
    sent.push(command);
    return Promise.resolve({ ok: true });
  };
  return { sent, send };
};

const openCard = (words: RegExp) => {
  fireEvent.click(screen.getByRole("button", { name: words }));
  return within(screen.getByRole("region", { name: /Request/ }));
};

it("both cards of a proposed link show Same event? on their row", () => {
  render(<DeskView board={board()} send={recorder().send} slots={SLOTS} />);
  const triage = within(screen.getByRole("region", { name: "Triage lane" }));
  expect(triage.getAllByText("Same event?").length).toBe(2);
});

it("the card panel names the other report by ZIP, time and score", () => {
  render(<DeskView board={board()} send={recorder().send} slots={SLOTS} />);
  const panel = openCard(/couch and bags/);
  const section = within(panel.getByRole("region", { name: "Same event?" }));
  expect(
    section.getByText(
      `This may be the same event as a report from ZIP 53216 at ${clockTime(AT_B)}. Score 0.91.`,
    ),
  ).toBeTruthy();
  expect(section.getByRole("button", { name: "Open side by side" })).toBeTruthy();
});

it("Same event sends link.answer with the answer same", async () => {
  const { sent, send } = recorder();
  render(<DeskView board={board()} send={send} slots={SLOTS} />);
  fireEvent.click(openCard(/couch and bags/).getByRole("button", { name: "Same event" }));
  await waitFor(() => {
    expect(sent).toEqual([
      { id: expect.any(String) as unknown, type: "link.answer", card: A, other: B, answer: "same" },
    ]);
  });
});

it("Not the same sends link.answer with the answer not_same", async () => {
  const { sent, send } = recorder();
  render(<DeskView board={board()} send={send} slots={SLOTS} />);
  fireEvent.click(openCard(/Somebody left/).getByRole("button", { name: "Not the same" }));
  await waitFor(() => {
    expect(sent.map((c) => (c.type === "link.answer" ? [c.card, c.other, c.answer] : null))).toEqual([
      [B, A, "not_same"],
    ]);
  });
});

it("Open side by side shows the words of both reports", () => {
  render(<DeskView board={board()} send={recorder().send} slots={SLOTS} />);
  fireEvent.click(openCard(/couch and bags/).getByRole("button", { name: "Open side by side" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText("A couch and bags dumped in the alley behind 5th Street")).toBeTruthy();
  expect(dialog.getByText("Somebody left a couch and trash in our alley off 5th")).toBeTruthy();
});

it("an answered link shows the desk answer and no buttons or row mark", () => {
  const answered = board(
    { links: [link(B, AT_B, { answer: "same" })] },
    { links: [link(A, AT_A, { answer: "not_same" })] },
  );
  render(<DeskView board={answered} send={recorder().send} slots={SLOTS} />);
  expect(screen.queryByText("Same event?")).toBeNull();
  const panel = openCard(/couch and bags/);
  expect(panel.getByText("Same event. The desk confirmed it.")).toBeTruthy();
  expect(panel.queryByRole("button", { name: "Same event" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Somebody left/ }));
  expect(
    within(screen.getByRole("region", { name: /Request/ })).getByText("Not the same. The desk confirmed it."),
  ).toBeTruthy();
});

it("a failed link job tells the desk to read the reports itself", () => {
  render(
    <DeskView board={board({ links: [], ai: { link: "failed" } })} send={recorder().send} slots={SLOTS} />,
  );
  expect(
    openCard(/couch and bags/).getByText("The same-event check did not run. Read the reports yourself."),
  ).toBeTruthy();
});

it("a confirmed group shows in the Triage lane with its highest urgency in words and with the mark", () => {
  const grouped = board({}, {}, { eventGroups: [{ cards: [A, B, C], highest: "high" }] });
  render(<DeskView board={grouped} send={recorder().send} slots={SLOTS} />);
  const triage = within(screen.getByRole("region", { name: "Triage lane" }));
  const group = within(triage.getByRole("group", { name: "3 reports, one event" }));
  expect(group.getByText("3 reports, one event")).toBeTruthy();
  const high = group.getByText("Highest urgency: High");
  expect(high.closest("p")?.querySelector("svg polygon")).not.toBeNull();
  expect(high.closest("p")?.className).toMatch(/crit/);
});

it("a group with no high card shows no critical line", () => {
  const grouped = board({}, {}, { eventGroups: [{ cards: [A, B], highest: "low" }] });
  render(<DeskView board={grouped} send={recorder().send} slots={SLOTS} />);
  expect(screen.getByText("2 reports, one event")).toBeTruthy();
  expect(screen.queryByText("Highest urgency: High")).toBeNull();
  expect(screen.getByText("Highest urgency: Low")).toBeTruthy();
});
