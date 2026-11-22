import {
  CAUTION_CODES,
  DEFAULT_READINESS,
  type Caution,
  type MatchPath,
  type Readiness,
  type Resource,
} from "@vision/contracts";
import { expect, it } from "vitest";
import { cautionsFor, nextDeadline } from "../src/resources/cautions.js";

const TODAY = "2026-11-22";

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

const codes = (
  resource: Resource,
  path: MatchPath = "direct",
  readiness: Readiness = DEFAULT_READINESS,
  today = TODAY,
): string[] => cautionsFor(resource, { path, readiness, today }).map((c) => c.code);

it("nextDeadline is the first deadline on or after today, or null", () => {
  const dated = row({ rolling: false, deadlines: ["2026-11-01", "2026-11-22", "2027-05-31"] });
  expect(nextDeadline(dated, TODAY)).toBe("2026-11-22");
  expect(nextDeadline(dated, "2026-11-23")).toBe("2027-05-31");
  expect(nextDeadline(dated, "2027-06-01")).toBeNull();
  expect(nextDeadline(BASE, TODAY)).toBeNull();
});

it("a plain open rolling row from an opened page checked today has no caution", () => {
  expect(cautionsFor(BASE, { path: "direct", readiness: DEFAULT_READINESS, today: TODAY })).toEqual([]);
});

const PATH_CASES: [MatchPath, string[]][] = [
  ["closed", ["closed"]],
  ["invitation_only", ["invitation_only"]],
  ["partner_applies", ["partner_applies"]],
  ["needs_501c3", ["needs_501c3"]],
  ["via_sponsor", ["needs_sponsor"]],
  ["ask_first", []],
  ["direct", []],
];

it.each(PATH_CASES)("the path %s adds %j", (path, want) => {
  expect(codes(row({ status: path === "closed" ? "closed" : "open" }), path)).toEqual(want);
});

it.each([
  ["none", "needs_sponsor"],
  ["talking", "needs_sponsor"],
  ["signed", "through_sponsor"],
] as const)("a sponsor path with the sponsor agreement %s shows %s", (sponsor, want) => {
  expect(codes(BASE, "via_sponsor", { ...DEFAULT_READINESS, sponsor })).toEqual([want]);
});

it("eligibility that is not stated shows, unless the row is closed", () => {
  expect(codes(row({}, { needs501c3: null }), "ask_first")).toEqual(["eligibility_not_stated"]);
  expect(codes(row({ status: "closed", rolling: false }, { needs501c3: null }), "closed")).toEqual([
    "closed",
  ]);
});

it("federal money needs an active UEI", () => {
  const federal = row({}, { federal: true });
  expect(codes(federal)).toEqual(["federal_uei"]);
  expect(codes(federal, "direct", { ...DEFAULT_READINESS, uei: "needed" })).toEqual(["federal_uei"]);
  expect(codes(federal, "direct", { ...DEFAULT_READINESS, uei: "active" })).toEqual([]);
});

it("a people row needs the Wisconsin DFI check first", () => {
  const people = row({ kind: "people" });
  expect(codes(people)).toEqual(["dfi_check"]);
  expect(codes(people, "direct", { ...DEFAULT_READINESS, dfi: "exempt_confirmed" })).toEqual([]);
  expect(codes(people, "direct", { ...DEFAULT_READINESS, dfi: "registered" })).toEqual([]);
  expect(codes(row({ kind: "company" }))).toEqual([]);
});

it("a deadline in 14 days or fewer shows its days, and a later one does not", () => {
  const due = (date: string) => row({ rolling: false, deadlines: [date] });
  expect(
    cautionsFor(due("2026-12-06"), { path: "direct", readiness: DEFAULT_READINESS, today: TODAY }),
  ).toEqual([{ code: "deadline_soon", days: 14 }]);
  expect(codes(due("2026-12-07"))).toEqual([]);
  expect(cautionsFor(due(TODAY), { path: "direct", readiness: DEFAULT_READINESS, today: TODAY })).toEqual([
    { code: "deadline_soon", days: 0 },
  ]);
});

it("a row that is not closed, not rolling and has no next deadline has no open deadline", () => {
  expect(codes(row({ rolling: false }))).toEqual(["no_open_deadline"]);
  expect(codes(row({ rolling: false, deadlines: ["2026-01-31"] }))).toEqual(["no_open_deadline"]);
  expect(codes(row({ status: "closed", rolling: false }), "closed")).toEqual(["closed"]);
});

it.each([
  ["old", "old_source"],
  ["search_summary", "search_summary"],
  ["secondary", "secondary_source"],
] as const)("a source of quality %s shows %s", (quality, want) => {
  expect(codes(row({ source: { ...BASE.source, quality } }))).toEqual([want]);
});

it("a source checked more than 30 days ago asks for a new check", () => {
  expect(codes(BASE, "direct", DEFAULT_READINESS, "2026-12-22")).toEqual([]);
  expect(codes(BASE, "direct", DEFAULT_READINESS, "2026-12-23")).toEqual(["check_before_apply"]);
});

it("static cautions always stay, once each, in the order of the caution codes", () => {
  const listed = row({ rolling: false, cautions: ["single_source", "no_stipends", "single_source"] });
  const out: Caution[] = cautionsFor(listed, {
    path: "via_sponsor",
    readiness: DEFAULT_READINESS,
    today: TODAY,
  });
  expect(out.map((c) => c.code)).toEqual([
    "needs_sponsor",
    "no_open_deadline",
    "no_stipends",
    "single_source",
  ]);
  const order = out.map((c) => CAUTION_CODES.indexOf(c.code));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(out.every((c) => c.code === "deadline_soon" || !("days" in c))).toBe(true);
});
