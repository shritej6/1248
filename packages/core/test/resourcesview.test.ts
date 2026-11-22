import {
  CatalogSchema,
  DEFAULT_READINESS,
  DRAFT_DAILY_CAP,
  DRAFT_LIST_MAX,
  ResourcesViewSchema,
  type CostEntry,
  type DraftView,
  type LedgerEvent,
} from "@vision/contracts";
import { expect, it } from "vitest";
import catalogFile from "../../../data/resources/catalog.json" with { type: "json" };
import { monthBounds } from "../src/month.js";
import { draftMonths, resourcesView, type ResourcesInput } from "../src/resources/view.js";
import { emptyState } from "../src/state.js";
import { uid } from "./arbitraries.js";
import { confirmedSnow, playbook, run } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 22, 18, 0);
const CATALOG = CatalogSchema.parse(catalogFile);
const LEDGER = run(...confirmedSnow()).events;

const input = (over: Partial<ResourcesInput> = {}): ResourcesInput => ({
  now: NOW,
  demo: true,
  events: [],
  state: emptyState(),
  playbook,
  orgName: "ComForce MKE",
  catalog: CATALOG,
  readiness: DEFAULT_READINESS,
  costs: [],
  drafts: [],
  usedToday: 0,
  ...over,
});

const startingAt = (at: number): LedgerEvent[] => LEDGER.map((e, i) => ({ ...e, at: at + i * 60_000 }));
const endOf = (month: string): number => monthBounds(month, "America/Chicago").end;

const draft = (n: number): DraftView => ({
  id: uid("d_", n),
  kind: "impact_post",
  month: "2026-11",
  resource: null,
  status: "ready",
  source: "template",
  flag: "ai_off",
  reasons: [],
  facts: [],
  text: `Draft ${String(n)}`,
  textHash: "a".repeat(64),
  createdAt: NOW - n * 60_000,
  approvedAt: null,
  approvedBy: null,
});

it("the demo view of an empty ledger at noon in Chicago parses with the contract schema", () => {
  const view = resourcesView(input());
  expect(ResourcesViewSchema.safeParse(view).success).toBe(true);
  expect(view).toMatchObject({ today: "2026-11-22", month: "2026-11", demo: true, draftMonths: ["2026-11"] });
  expect(view.catalog).toEqual({ version: CATALOG.version, checked: CATALOG.checked });
  expect(view.resources).toEqual(CATALOG.resources);
  expect(view.sponsors).toEqual(CATALOG.sponsors);
  expect(view.forecast.status).toBe("ready");
  expect(view.matches).toHaveLength(CATALOG.resources.length);
  expect(view.matches[0]?.resource).toBe("safe_sound_good_neighbor");
  expect(view.readiness).toEqual(DEFAULT_READINESS);
  expect(view.drafting).toEqual({ cap: DRAFT_DAILY_CAP, usedToday: 0 });
});

it("with demo off the forecast waits for history and the matches still come back", () => {
  const view = resourcesView(input({ demo: false }));
  expect(view.forecast).toEqual({ status: "not_enough_history", recordMonths: 0, needed: 12 });
  expect(view.matches).toHaveLength(CATALOG.resources.length);
  expect(view.matches.every((m) => m.score >= 0 && m.score <= 100)).toBe(true);
  expect(ResourcesViewSchema.safeParse(view).success).toBe(true);
});

it("the needs are the active playbook rows with their labels", () => {
  const view = resourcesView(input());
  const active = playbook.rows.filter((row) => !row.quiet);
  expect(view.needs).toEqual(active.map((row) => ({ need: row.need, label: row.label })));
  expect(view.needs.map((n) => n.need)).not.toContain("text_extraction");
  expect(view.needs).toHaveLength(13);
});

it("draftMonths keeps a month only when the ledger starts before its end", () => {
  expect(draftMonths([], NOW)).toEqual(["2026-11"]);
  expect(draftMonths(LEDGER, NOW)).toEqual(["2026-11"]);
  expect(draftMonths(startingAt(endOf("2026-10") - 1), NOW)).toEqual(["2026-11", "2026-10"]);
  expect(draftMonths(startingAt(endOf("2026-10")), NOW)).toEqual(["2026-11"]);
  expect(draftMonths(startingAt(Date.UTC(2026, 3, 1)), NOW)).toEqual(["2026-11", "2026-10", "2026-09"]);
});

it("draftMonths turns the year and reads the month in Chicago time", () => {
  const january = Date.UTC(2027, 0, 15, 18);
  expect(draftMonths(startingAt(Date.UTC(2026, 5, 1)), january)).toEqual(["2027-01", "2026-12", "2026-11"]);
  const lateNovember = Date.UTC(2026, 11, 1, 5, 0);
  expect(draftMonths([], lateNovember)).toEqual(["2026-11"]);
  expect(resourcesView(input({ now: lateNovember }))).toMatchObject({
    today: "2026-11-30",
    month: "2026-11",
  });
});

it("the view shows the first 50 drafts and the drafts used today", () => {
  const drafts = Array.from({ length: DRAFT_LIST_MAX + 10 }, (_, i) => draft(i + 1));
  const view = resourcesView(input({ drafts, usedToday: 7 }));
  expect(view.drafts).toEqual(drafts.slice(0, DRAFT_LIST_MAX));
  expect(view.drafting).toEqual({ cap: DRAFT_DAILY_CAP, usedToday: 7 });
  expect(ResourcesViewSchema.safeParse(view).success).toBe(true);
});

it("the costs pass through and price the forecast", () => {
  const costs: CostEntry[] = [{ need: "snow", centsPerJob: 2500, basis: "estimate", updatedAt: NOW }];
  const view = resourcesView(input({ costs, readiness: { ...DEFAULT_READINESS, c3: "yes" } }));
  expect(view.costs).toEqual(costs);
  expect(view.readiness.c3).toBe("yes");
  if (view.forecast.status !== "ready") return expect.unreachable("The demo forecast is not ready.");
  expect(view.forecast.needs.find((n) => n.need === "snow")?.cost).toEqual({
    centsPerJob: 2500,
    basis: "estimate",
  });
  expect(ResourcesViewSchema.safeParse(view).success).toBe(true);
});
