import {
  CatalogSchema,
  DEFAULT_READINESS,
  DraftFactsSchema,
  type DraftFacts,
  type FactKey,
  type Forecast,
  type Resource,
  type Statement,
} from "@vision/contracts";
import { expect, it } from "vitest";
import catalogFile from "../../../data/resources/catalog.json" with { type: "json" };
import { draftFacts, formatCount, formatDollars, type FactInput } from "../src/resources/facts.js";
import { buildForecast } from "../src/resources/forecast.js";
import { emptyState } from "../src/state.js";
import { statement } from "../src/statement.js";
import { playbook } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 22, 18, 0);
const CATALOG = CatalogSchema.parse(catalogFile);
const DEMO = buildForecast({ now: NOW, demo: true, events: [], state: emptyState(), playbook }, []);
const NO_HISTORY: Forecast = { status: "not_enough_history", recordMonths: 0, needed: 12 };

const STATEMENT: Statement = {
  ...statement([], "2026-10"),
  new: 14,
  helped: 9,
  unmet: 3,
  hours: 311.6,
  unmetTable: [{ need: "snow", zip: "53206", count: 3 }],
  seal: { seq: 128, hash: "a".repeat(64) },
};

const rowOf = (id: string): Resource => {
  const row = CATALOG.resources.find((r) => r.id === id);
  if (row === undefined) return expect.unreachable(`The catalog has no row ${id}.`);
  return row;
};

const input = (over: Partial<FactInput> = {}): FactInput => ({
  kind: "impact_post",
  orgName: "ComForce demo",
  month: "2026-10",
  partial: false,
  statement: STATEMENT,
  forecast: DEMO,
  resource: null,
  playbook,
  readiness: DEFAULT_READINESS,
  today: "2026-11-22",
  ...over,
});

const letter = (id: string, over: Partial<FactInput> = {}): DraftFacts =>
  draftFacts(input({ kind: "funder_letter", resource: rowOf(id), ...over }));

const keys = (facts: DraftFacts): FactKey[] => facts.facts.map((f) => f.key);
const textOf = (facts: DraftFacts, key: FactKey) => facts.facts.find((f) => f.key === key)?.text;

it("formatCount groups thousands and formatDollars rounds cents to whole dollars", () => {
  expect([0, 9, 1234, 100_000, 1_000_000].map(formatCount)).toEqual([
    "0",
    "9",
    "1,234",
    "100,000",
    "1,000,000",
  ]);
  expect(formatDollars(1_081_700)).toBe("$10,817");
  expect(formatDollars(1_081_750)).toBe("$10,818");
  expect(formatDollars(1_081_704)).toBe("$10,817");
  expect(formatDollars(0)).toBe("$0");
  expect(formatDollars(250_000)).toBe("$2,500");
});

it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("formatCount refuses %s with a RangeError", (n) => {
  expect(() => formatCount(n)).toThrow(RangeError);
});

it("an impact post for a full month has the seven facts with their labels", () => {
  const facts = draftFacts(input());
  expect(facts).toMatchObject({ kind: "impact_post", month: "2026-10", resource: null });
  expect(facts.facts).toEqual([
    { key: "org", label: "Group", text: "ComForce demo" },
    { key: "month", label: "Month", text: "October 2026" },
    { key: "new", label: "Jobs planned", text: "14" },
    { key: "helped", label: "Jobs closed as helped", text: "9" },
    { key: "unmet", label: "Jobs on the unmet shelf at the end of the month", text: "3" },
    { key: "hours", label: "Volunteer hours", text: "312" },
    { key: "in_kind", label: "Value of volunteer time at $34.67 an hour", text: "$10,817" },
  ]);
  expect(facts.claims).toEqual({ c3: false, sponsor: false });
  expect(facts.footer).toBe("Source: the Vision record for October 2026, sealed at line 128.");
});

it("the current month is a partial month with the unmet shelf now", () => {
  const facts = draftFacts(input({ month: "2026-11", partial: true }));
  expect(textOf(facts, "month")).toBe("November 2026 so far");
  expect(facts.facts.find((f) => f.key === "unmet")?.label).toBe("Jobs on the unmet shelf now");
  expect(facts.footer).toBe("Source: the Vision record for November 2026 so far, sealed at line 128.");
});

it("a letter to Bader has the forecast facts, the deadline, no amount and the synthetic sentence", () => {
  const facts = letter("bader_preliminary");
  expect(facts.resource).toBe("bader_preliminary");
  expect(keys(facts)).toEqual([
    "org",
    "funder",
    "month",
    "new",
    "helped",
    "hours",
    "in_kind",
    "window",
    "horizon",
    "needs",
    "forecast_jobs",
    "forecast_hours",
    "deadline",
  ]);
  expect(textOf(facts, "funder")).toBe("Bader Philanthropies, preliminary application");
  expect(textOf(facts, "window")).toBe("December 2026 to November 2027");
  expect(textOf(facts, "horizon")).toBe("12");
  expect(textOf(facts, "needs")).toBe("Youth stipend information, Community clean up, Job search help");
  expect(textOf(facts, "deadline")).toBe("30 November 2026");
  expect(facts.footer).toBe(
    "Source: the Vision record for October 2026, sealed at line 128. The forecast uses synthetic history.",
  );
});

it("the forecast facts are the sums of the totals of the fit needs", () => {
  if (DEMO.status !== "ready") return expect.unreachable("The demo forecast is not ready.");
  const fit = DEMO.needs.filter((n) => ["youth_stipend", "cleanup", "jobs"].includes(n.need));
  const jobs = fit.reduce((a, n) => ({ low: a.low + n.total.jobs.low, high: a.high + n.total.jobs.high }), {
    low: 0,
    high: 0,
  });
  const hours = fit.reduce(
    (a, n) => ({ low: a.low + n.total.hours.low, high: a.high + n.total.hours.high }),
    {
      low: 0,
      high: 0,
    },
  );
  const facts = letter("bader_preliminary");
  expect(textOf(facts, "forecast_jobs")).toBe(`${formatCount(jobs.low)} to ${formatCount(jobs.high)}`);
  expect(textOf(facts, "forecast_hours")).toBe(`${formatCount(hours.low)} to ${formatCount(hours.high)}`);
});

it("amounts and deadlines come only from opened pages", () => {
  expect(textOf(letter("safe_sound_good_neighbor"), "amount")).toBe("up to $2,500");
  expect(textOf(letter("safe_sound_good_neighbor"), "deadline")).toBeUndefined();
  expect(textOf(letter("walmart_spark_good"), "amount")).toBe("$250 to $5,000");
  expect(textOf(letter("walmart_spark_good"), "deadline")).toBe("30 November 2026");
  expect(keys(letter("brewers_community_foundation"))).not.toContain("amount");
  expect(keys(letter("brewers_community_foundation"))).not.toContain("deadline");
  expect(keys(letter("lions_lcif_emergency"))).not.toContain("amount");
});

it("the deadline fact is the next deadline from today, and none without today", () => {
  expect(textOf(letter("bader_preliminary", { today: "2026-12-01" }), "deadline")).toBe("31 May 2027");
  expect(keys(letter("bader_preliminary", { today: "2027-06-01" }))).not.toContain("deadline");
  const noToday = { ...input({ kind: "funder_letter", resource: rowOf("bader_preliminary") }) };
  delete noToday.today;
  expect(keys(draftFacts(noToday))).not.toContain("deadline");
});

it("a general row with no fit needs counts all needs", () => {
  if (DEMO.status !== "ready") return expect.unreachable("The demo forecast is not ready.");
  const facts = letter("givebutter_sponsor");
  expect(textOf(facts, "needs")).toBe("All needs");
  const { low, high } = DEMO.total.jobs;
  expect(textOf(facts, "forecast_jobs")).toBe(`${formatCount(low)} to ${formatCount(high)}`);
});

it("more than 6 fit needs show 6 and the rest as a count, and a quiet need never shows", () => {
  const many: Resource = {
    ...rowOf("bader_preliminary"),
    fit: {
      needs: ["text_extraction", "snow", "food", "shelter", "rides", "jobs", "lawn", "cleanup", "burial"],
      divisions: [],
      general: false,
    },
  };
  const facts = draftFacts(input({ kind: "funder_letter", resource: many }));
  expect(textOf(facts, "needs")).toBe(
    "Snow shovelling, Food from a pantry, Shelter for tonight, A ride to an appointment, Job search help, Lawn mowing and 2 more",
  );
  expect(JSON.stringify(facts)).not.toContain("Safety planning");
});

it("without a ready forecast a letter has no forecast facts and no synthetic sentence", () => {
  const facts = letter("bader_preliminary", { forecast: NO_HISTORY });
  expect(keys(facts)).toEqual(["org", "funder", "month", "new", "helped", "hours", "in_kind", "deadline"]);
  expect(facts.footer).toBe("Source: the Vision record for October 2026, sealed at line 128.");
});

it("the claims follow the readiness list", () => {
  const ready = { ...DEFAULT_READINESS, c3: "yes", sponsor: "signed" } as const;
  expect(draftFacts(input({ readiness: ready })).claims).toEqual({ c3: true, sponsor: true });
  expect(draftFacts(input({ readiness: { ...DEFAULT_READINESS, sponsor: "talking" } })).claims).toEqual({
    c3: false,
    sponsor: false,
  });
});

it("facts hold no ZIP and parse with the contract schema", () => {
  for (const facts of [draftFacts(input()), ...CATALOG.resources.map((r) => letter(r.id))]) {
    expect(JSON.stringify(facts)).not.toContain("53206");
    expect(DraftFactsSchema.safeParse(facts).success).toBe(true);
  }
});

it("a funder letter needs a resource", () => {
  expect(() => draftFacts(input({ kind: "funder_letter", resource: null }))).toThrow(RangeError);
  expect(draftFacts(input({ resource: rowOf("bader_preliminary") })).resource).toBeNull();
});
