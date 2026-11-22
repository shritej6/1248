import { describe, expect, it } from "vitest";
import type { Playbook } from "@vision/contracts";
import configFile from "../../../data/synthetic/config.json" with { type: "json" };
import labelsFile from "../../../data/synthetic/rehearsal-labels.json" with { type: "json" };
import playbookFile from "../../../data/synthetic/playbook.json" with { type: "json" };
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { DEFAULT_CHANCES, mulberry32, rehearse, type RehearsalLabel } from "../src/index.js";

const input = (seed: number) => ({
  seed,
  labels: labelsFile.labels as RehearsalLabel[],
  source: labelsFile.source,
  playbook: playbookFile as Playbook,
  zips: zipsFile,
  config: configFile,
  chances: DEFAULT_CHANCES,
});

describe("mulberry32", () => {
  it("gives the same numbers for the same seed and numbers in [0, 1)", () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    const first = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect(mulberry32(6)()).not.toBe(first[0]);
  });
});

describe("rehearse", () => {
  it("the same seed gives the same result", () => {
    expect(rehearse(input(42))).toEqual(rehearse(input(42)));
  });

  it("100 requests run and the statement balances", () => {
    const r = rehearse(input(7));
    expect(r.requests).toBe(100);
    expect(r.statement.balanced).toBe(true);
    expect(r.statement.new).toBeGreaterThan(0);
  });

  it("the result names its sources and assumptions", () => {
    const r = rehearse(input(7));
    expect(r.source).toContain("2026-11-21");
    expect(r.assumptions).toContain("16 percent of volunteers say yes to an offer");
  });

  it("jobs reach every end: helped, the unmet shelf and the desk after the waves", () => {
    const r = rehearse(input(7));
    expect(r.statement.helped).toBeGreaterThan(0);
    expect(r.statement.unmet).toBe(r.statement.unmetTable.reduce((sum, row) => sum + row.count, 0));
    expect(r.weak.unmetNeeds).toEqual([...new Set(r.statement.unmetTable.map((row) => row.need))].sort());
    expect(r.weak.wavesToDesk).toBe(r.statement.wrong.noVolunteer);
    expect(r.weak.latePromises).toBe(r.statement.wrong.latePromises);
  });

  it("no volunteer says yes means every volunteer job reaches the desk and nothing is helped by a visit", () => {
    const r = rehearse({ ...input(3), chances: { ...DEFAULT_CHANCES, offerYes: 0 } });
    expect(r.weak.wavesToDesk).toBeGreaterThan(0);
    expect(r.statement.hours).toBe(0);
    expect(r.assumptions).toContain("0 percent of volunteers say yes to an offer");
  });

  it("a different seed gives a different day", () => {
    expect(rehearse(input(1)).statement).not.toEqual(rehearse(input(2)).statement);
  });
});
