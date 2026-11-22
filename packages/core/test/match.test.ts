import {
  CatalogSchema,
  DEFAULT_READINESS,
  MatchSchema,
  type Forecast,
  type Match,
  type MatchPath,
  type Readiness,
  type Resource,
} from "@vision/contracts";
import fc from "fast-check";
import { expect, it } from "vitest";
import catalogFile from "../../../data/resources/catalog.json" with { type: "json" };
import { monthRange } from "../src/resources/calendar.js";
import { buildForecast, forecastFrom } from "../src/resources/forecast.js";
import { MATCH_WEIGHTS, matchPath, matchResources } from "../src/resources/match.js";
import { emptyState } from "../src/state.js";
import { playbook } from "./helpers.js";

const TODAY = "2026-11-22";
const NOW = Date.UTC(2026, 10, 22, 18, 0);
const CATALOG = CatalogSchema.parse(catalogFile);
const DEMO = buildForecast({ now: NOW, demo: true, events: [], state: emptyState(), playbook }, []);
const NO_HISTORY: Forecast = { status: "not_enough_history", recordMonths: 0, needed: 12 };

const BASE: Resource = {
  id: "test_row",
  name: "Test row",
  kind: "grant",
  what: "A row for the tests.",
  amount: null,
  inKind: null,
  eligibility: {
    needs501c3: false,
    sponsorOk: null,
    residentGroupOk: null,
    invitationOnly: false,
    partnerApplies: false,
    federal: false,
  },
  status: "open",
  rolling: true,
  deadlines: [],
  fit: { needs: [], divisions: [], general: true },
  cautions: [],
  source: { url: "https://example.org/test", checked: TODAY, quality: "opened" },
};

const row = (over: Partial<Resource> = {}, eligibility: Partial<Resource["eligibility"]> = {}): Resource => ({
  ...BASE,
  ...over,
  eligibility: { ...BASE.eligibility, ...eligibility },
});

const flatForecast = (perMonth: Record<string, number>): Forecast =>
  forecastFrom(
    {
      from: "2024-11",
      to: "2026-10",
      syntheticMonths: 24,
      recordMonths: 0,
      needs: Object.entries(perMonth).map(([need, jobs]) => ({
        need,
        label: need,
        months: monthRange("2024-11", 24).map((month) => ({ month, jobs, hours: jobs })),
      })),
    },
    [],
    "2026-12",
  );

const matchOf = (
  resource: Resource,
  readiness: Readiness = DEFAULT_READINESS,
  forecast: Forecast = flatForecast({ rides: 10, jobs: 30 }),
): Match => {
  const [match] = matchResources({ resources: [resource], forecast, playbook, readiness, today: TODAY });
  if (match === undefined) return expect.unreachable("matchResources gave no match.");
  return match;
};

it("the weights are points that add up to 100", () => {
  expect(MATCH_WEIGHTS).toEqual({ fit: 45, reach: 35, timing: 20 });
});

it("fit 0.5, reach 1 and timing 1 score 78, because 77.5 rounds up", () => {
  const match = matchOf(BASE);
  expect(match.parts).toEqual({ fit: 0.5, reach: 1, timing: 1 });
  expect(match.score).toBe(78);
});

const C3_YES: Readiness = { ...DEFAULT_READINESS, c3: "yes" };
const SIGNED: Readiness = { ...DEFAULT_READINESS, sponsor: "signed" };
const PATHS: [string, Resource, Readiness, MatchPath, number][] = [
  [
    "closed",
    row({ status: "closed", rolling: false }, { invitationOnly: true }),
    DEFAULT_READINESS,
    "closed",
    0,
  ],
  [
    "invitation only",
    row({}, { invitationOnly: true, partnerApplies: true }),
    DEFAULT_READINESS,
    "invitation_only",
    0.2,
  ],
  ["a partner applies", row({}, { partnerApplies: true, needs501c3: true }), C3_YES, "partner_applies", 0.4],
  ["own 501(c)(3)", row({}, { needs501c3: true, sponsorOk: true }), C3_YES, "direct", 1],
  ["sponsor, none", row({}, { needs501c3: true, sponsorOk: true }), DEFAULT_READINESS, "via_sponsor", 0.6],
  [
    "sponsor, talking",
    row({}, { needs501c3: true, sponsorOk: true }),
    { ...SIGNED, sponsor: "talking" },
    "via_sponsor",
    0.6,
  ],
  ["sponsor, signed", row({}, { needs501c3: true, sponsorOk: true }), SIGNED, "via_sponsor", 0.9],
  ["needs 501(c)(3)", row({}, { needs501c3: true, sponsorOk: null }), SIGNED, "needs_501c3", 0.1],
  ["not stated", row({}, { needs501c3: null }), DEFAULT_READINESS, "ask_first", 0.5],
  ["open to all", row(), DEFAULT_READINESS, "direct", 1],
];

it.each(PATHS)("the path for %s", (_name, resource, readiness, path, reach) => {
  expect(matchPath(resource, readiness)).toBe(path);
  const match = matchOf(resource, readiness);
  expect(match.path).toBe(path);
  expect(match.parts.reach).toBe(reach);
});

const dated = (date: string): Resource => row({ rolling: false, deadlines: ["2026-01-15", date] });
const TIMING: [string, Resource, number][] = [
  ["closed", row({ status: "closed", rolling: false }), 0],
  ["rolling", row(), 1],
  ["no deadline", row({ rolling: false }), 0.1],
  ["only a past deadline", row({ rolling: false, deadlines: ["2026-11-21"] }), 0.1],
  ["a deadline today", dated(TODAY), 0.7],
  ["a deadline in 7 days", dated("2026-11-29"), 0.7],
  ["a deadline in 8 days", dated("2026-11-30"), 1],
  ["a deadline in 120 days", dated("2027-03-22"), 1],
  ["a deadline in 121 days", dated("2027-03-23"), 0.6],
];

it.each(TIMING)("the timing for %s", (_name, resource, timing) => {
  expect(matchOf(resource).parts.timing).toBe(timing);
});

it("the next deadline of a match is the first one on or after today", () => {
  expect(matchOf(dated("2026-11-30")).nextDeadline).toBe("2026-11-30");
  expect(matchOf(row()).nextDeadline).toBeNull();
});

it("fit is the share of the forecast jobs in the fit needs, and general support counts at least half", () => {
  const rides = row({ fit: { needs: ["rides", "rides"], divisions: [], general: false } });
  expect(matchOf(rides).parts.fit).toBe(0.25);
  expect(matchOf({ ...rides, fit: { ...rides.fit, general: true } }).parts.fit).toBe(0.5);
  const both = row({ fit: { needs: ["rides", "jobs"], divisions: [], general: true } });
  expect(matchOf(both).parts.fit).toBe(1);
  expect(matchOf(rides, DEFAULT_READINESS, flatForecast({ rides: 0, jobs: 0 })).parts.fit).toBe(0);
});

it("without a forecast, fit is the share of the active needs that the row fits", () => {
  const fits = row({ fit: { needs: ["snow", "food", "text_extraction"], divisions: [], general: false } });
  expect(matchOf(fits, DEFAULT_READINESS, NO_HISTORY).parts.fit).toBeCloseTo(2 / 13, 12);
  expect(matchOf(fits, DEFAULT_READINESS, NO_HISTORY).why[0]).toEqual({
    code: "fits_needs",
    needs: ["snow", "food"],
  });
});

it("the reasons come in a fixed order and leave out what does not hold", () => {
  const full = row(
    {
      rolling: false,
      deadlines: ["2027-01-31"],
      amount: { min: null, max: 2500 },
      inKind: "Free tools",
      fit: { needs: ["rides", "jobs", "lawn", "text_extraction"], divisions: [], general: true },
    },
    { residentGroupOk: true, sponsorOk: true },
  );
  const forecast = flatForecast({ rides: 10, jobs: 0 });
  expect(matchOf(full, DEFAULT_READINESS, forecast).why).toEqual([
    { code: "fits_needs", needs: ["rides"] },
    { code: "general_support" },
    { code: "resident_group_ok" },
    { code: "sponsor_ok" },
    { code: "deadline", date: "2027-01-31" },
    { code: "amount" },
    { code: "in_kind" },
  ]);
  expect(matchOf(row({ fit: { needs: [], divisions: [], general: false } })).why).toEqual([
    { code: "rolling" },
  ]);
  expect(matchOf(row({ status: "closed", rolling: true })).why).toEqual([{ code: "general_support" }]);
});

it("matches sort by score, then the sooner deadline with none last, then the name", () => {
  const out = matchResources({
    resources: [
      row({ id: "row_c", name: "C row", status: "closed", rolling: false }),
      row({ id: "row_b", name: "B row" }),
      row({ id: "row_a", name: "A row" }),
      row({ id: "row_late", name: "Late row", rolling: false, deadlines: ["2026-12-15"] }),
      row({ id: "row_soon", name: "Soon row", rolling: false, deadlines: ["2026-12-10"] }),
    ],
    forecast: flatForecast({ rides: 10 }),
    playbook,
    readiness: DEFAULT_READINESS,
    today: TODAY,
  });
  expect(out.map((m) => m.resource)).toEqual(["row_soon", "row_late", "row_a", "row_b", "row_c"]);
  expect(out.at(-1)?.score).toBe(0);
});

const STATES: Readiness[] = (["none", "talking", "signed"] as const).flatMap((sponsor) =>
  (["not_checked", "exempt_confirmed", "registered"] as const).flatMap((dfi) =>
    (["no", "applied", "yes"] as const).flatMap((c3) =>
      (["not_needed", "needed", "active"] as const).map((uei) => ({ sponsor, dfi, c3, uei })),
    ),
  ),
);

const checkRules = (matches: readonly Match[], resources: readonly Resource[]): void => {
  for (const match of matches) {
    const resource = resources.find((r) => r.id === match.resource);
    const codes = match.cautions.map((c) => c.code);
    expect(resource?.cautions.every((c) => codes.includes(c))).toBe(true);
    if (match.path === "via_sponsor")
      expect(codes.includes("needs_sponsor") || codes.includes("through_sponsor")).toBe(true);
    if (resource?.status === "closed") expect(codes).toContain("closed");
    expect(Number.isInteger(match.score) && match.score >= 0 && match.score <= 100).toBe(true);
    expect(MatchSchema.safeParse(match).success).toBe(true);
  }
};

it("for all 81 readiness states and every catalog row, the caution rules hold", () => {
  expect(STATES).toHaveLength(81);
  for (const readiness of STATES) {
    const matches = matchResources({
      resources: CATALOG.resources,
      forecast: DEMO,
      playbook,
      readiness,
      today: TODAY,
    });
    expect(matches).toHaveLength(CATALOG.resources.length);
    checkRules(matches, CATALOG.resources);
  }
});

it("for any readiness, forecast and day, the caution rules hold", () => {
  const day = fc
    .integer({ min: 0, max: 900 })
    .map((n) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10));
  const forecast = fc.constantFrom(DEMO, NO_HISTORY, flatForecast({ rides: 3, food: 0 }));
  fc.assert(
    fc.property(fc.constantFrom(...STATES), forecast, day, (readiness, f, today) => {
      checkRules(
        matchResources({ resources: CATALOG.resources, forecast: f, playbook, readiness, today }),
        CATALOG.resources,
      );
    }),
  );
});

const demoMatches = (today = TODAY, readiness: Readiness = DEFAULT_READINESS): Match[] =>
  matchResources({ resources: CATALOG.resources, forecast: DEMO, playbook, readiness, today });

const cautionsOf = (matches: readonly Match[], id: string) =>
  matches.find((m) => m.resource === id)?.cautions;

it("with the real catalog and the demo forecast, Good Neighbor comes first and United Way last", () => {
  const matches = demoMatches();
  expect(matches[0]?.resource).toBe("safe_sound_good_neighbor");
  expect(matches.at(-1)).toMatchObject({ resource: "united_way_urgent_need", score: 0, path: "closed" });
  expect(cautionsOf(matches, "bader_preliminary")).toContainEqual({ code: "deadline_soon", days: 8 });
  expect(cautionsOf(matches, "bader_preliminary")).toContainEqual({ code: "eligibility_not_stated" });
  expect(cautionsOf(matches, "walmart_spark_good")).toEqual(
    expect.arrayContaining([{ code: "deadline_soon", days: 8 }, { code: "conflicting_source" }]),
  );
  const scores = matches.map((m) => m.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));
});

it("a signed sponsor agreement moves the sponsor rows up and changes their caution", () => {
  const before = demoMatches();
  const after = demoMatches(TODAY, { ...DEFAULT_READINESS, sponsor: "signed" });
  const score = (matches: readonly Match[], id: string) => matches.find((m) => m.resource === id)?.score ?? 0;
  expect(score(after, "givebutter_sponsor")).toBeGreaterThan(score(before, "givebutter_sponsor"));
  expect(cautionsOf(before, "givebutter_sponsor")).toContainEqual({ code: "needs_sponsor" });
  expect(cautionsOf(after, "givebutter_sponsor")).toContainEqual({ code: "through_sponsor" });
  expect(after.find((m) => m.resource === "givebutter_sponsor")?.parts.reach).toBe(0.9);
});

it("every row asks for a new check of its source after 30 days", () => {
  const later = demoMatches("2026-12-23");
  expect(later.every((m) => m.cautions.some((c) => c.code === "check_before_apply"))).toBe(true);
  expect(demoMatches().some((m) => m.cautions.some((c) => c.code === "check_before_apply"))).toBe(false);
});
