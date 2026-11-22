import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { effectiveLevel } from "../src/index.js";
import { master, pass, runFrom, sortResult, stateWithLevel, submit, types } from "./helpers.js";

describe("effectiveLevel", () => {
  it("level never goes down for one card", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(1 as const, 2 as const, 3 as const),
        fc.subarray(["word_list_hit", "passes_disagree"] as const),
        (lvl, flags) => {
          expect(
            effectiveLevel({ needLevel: lvl, flags, urgency: "low", quiet: false, master: false }),
          ).toBeGreaterThanOrEqual(flags.length > 0 ? Math.max(lvl, 2) : lvl);
        },
      ),
    );
  });

  it("level 1 holds only with no flag, low urgency, no quiet and the master switch off", () => {
    const base = { needLevel: 1 as const, flags: [], urgency: "low" as const, quiet: false, master: false };
    expect(effectiveLevel(base)).toBe(1);
    expect(effectiveLevel({ ...base, urgency: "high" })).toBe(2);
    expect(effectiveLevel({ ...base, master: true })).toBe(2);
    expect(effectiveLevel({ ...base, quiet: true })).toBe(3);
  });
});

describe("the master switch", () => {
  const newSnowCard = (card: string) => [submit(card), sortResult(card, [pass("low"), pass("low")])];

  it("with the master switch on, a level 1 need waits for the desk", () => {
    const d = runFrom(stateWithLevel("snow", 1), master(true), ...newSnowCard("c_3"));
    expect(types(d)).toContain("levels.master_set");
    expect(types(d)).not.toContain("card.confirmed");
  });

  it("with the master switch off again, a level 1 need goes by itself", () => {
    const d = runFrom(stateWithLevel("snow", 1), master(true), master(false), ...newSnowCard("c_3"));
    expect(types(d)).toContain("card.confirmed");
  });
});
