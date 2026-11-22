import { expect, it } from "vitest";
import { cardIsQuiet, suggestedNeed } from "../src/quiet.js";
import { pass, playbook, run, sortResult, state, submit } from "./helpers.js";

const CARD = "c_0f4e6b2a-1c3d-4e5f-8a7b-9c0d1e2f3a4b";
const TEXT_SERVICE = "T.E.X.T. Tactical Extraction Team for DV / Sex Trafficking";

const sortedTo = (service: string) =>
  state(run(submit(CARD), sortResult(CARD, [pass("low", "", { service }), pass("low", "", { service })])))
    .cards[CARD];

it("the suggested need of a service is its default row", () => {
  expect(suggestedNeed(playbook, TEXT_SERVICE)).toBe("text_extraction");
  expect(suggestedNeed(playbook, null)).toBeNull();
});

it("a card the sorter sends to a quiet service is quiet before any confirm", () => {
  const card = sortedTo(TEXT_SERVICE);
  expect(card?.need ?? null).toBeNull();
  expect(card === undefined ? null : cardIsQuiet(playbook, card)).toBe(true);
});

it("a card sorted to a service with no quiet row is not quiet", () => {
  const card = sortedTo("Free services for elderly, disabled, pregnant (lawn care, snow removal)");
  expect(card === undefined ? null : cardIsQuiet(playbook, card)).toBe(false);
});
