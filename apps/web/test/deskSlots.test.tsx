import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeskBoardSchema, type DeskBoard, type DeskCard } from "@vision/contracts";
import {
  NO_SLOTS,
  mergeSlots,
  type BoardSlotProps,
  type CardSlotProps,
  type DeskSlots,
} from "../src/components/deskSlots.js";
import { DeskView, type DeskSend } from "../src/pages/DeskPage.js";
import { fixture } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const send: DeskSend = () => Promise.resolve({ ok: true });

const board = (change: Partial<DeskCard> = {}): DeskBoard => {
  const base = DeskBoardSchema.parse(fixture("views/desk-board.json"));
  const card = base.triage[0];
  if (card === undefined) throw new Error("the fixture has no triage card");
  return { ...base, pages: [], triage: [{ ...card, ...change }] };
};

const cardSlot = (word: string) =>
  function CardWord({ card, hub }: CardSlotProps) {
    return <p>{`${word} ${card.zip ?? ""} ${hub?.org ?? "no hub"}`}</p>;
  };
const boardSlot = (word: string) =>
  function BoardWord({ board: shown }: BoardSlotProps) {
    return <p>{`${word} ${String(shown.triage.length)}`}</p>;
  };

const every: DeskSlots = {
  rowMarks: [cardSlot("MARK")],
  aboveMessage: [cardSlot("ABOVE")],
  belowMessage: [cardSlot("BELOW")],
  afterLabels: [cardSlot("AFTER")],
  tools: [boardSlot("TOOLS")],
  triage: [boardSlot("TRIAGE")],
};

const follows = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

it("each slot renders in its place on the board and in the card panel", () => {
  render(<DeskView board={board()} send={send} slots={every} hub={null} />);
  expect(screen.getByText("TOOLS 1")).toBeTruthy();
  const triage = within(screen.getByRole("region", { name: "Triage lane" }));
  expect(triage.getByText("TRIAGE 1")).toBeTruthy();
  expect(triage.getByText("MARK 53216 no hub")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Snow on my walk/ }));
  const panel = screen.getByRole("region", { name: /Request/ });
  const words = within(panel).getByRole("region", { name: "Words of the resident" });
  const labels = within(panel).getByRole("region", { name: "Sorter labels" });
  const above = within(panel).getByText(/^ABOVE/);
  const below = within(panel).getByText(/^BELOW/);
  const after = within(panel).getByText(/^AFTER/);
  expect([
    follows(above, words),
    follows(words, below),
    follows(below, labels),
    follows(labels, after),
  ]).toEqual([true, true, true, true]);
});

it("with no slots the board shows only the demo thread parts", () => {
  render(<DeskView board={board()} send={send} slots={NO_SLOTS} />);
  expect(screen.queryByText(/TOOLS|TRIAGE|MARK/)).toBeNull();
});

it("a voicemail card names its door and shows the voice flag in plain words", () => {
  render(
    <DeskView board={board({ door: "voice", flags: ["voice_transcript"] })} send={send} slots={NO_SLOTS} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Snow on my walk/ }));
  const panel = within(screen.getByRole("region", { name: /Request/ }));
  expect(panel.getByText("Voicemail")).toBeTruthy();
  expect(panel.getByText(/Voicemail\. A person must confirm it\./)).toBeTruthy();
});

it("mergeSlots keeps the order of the teams in each place", () => {
  const one = cardSlot("ONE");
  const two = cardSlot("TWO");
  expect(mergeSlots([{ aboveMessage: [one] }, {}, { aboveMessage: [two] }]).aboveMessage).toEqual([one, two]);
});
