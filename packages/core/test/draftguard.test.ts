import { GUARD_REASONS, type DraftFacts, type GuardReason } from "@vision/contracts";
import fc from "fast-check";
import { expect, it } from "vitest";
import { formatCount, formatDollars } from "../src/resources/facts.js";
import { allowedNumbers, draftText, guardDraft, unsafeFacts } from "../src/resources/guard.js";
import { templateDraft } from "../src/resources/template.js";

const FACTS: DraftFacts = {
  kind: "impact_post",
  month: "2026-11",
  resource: null,
  facts: [
    { key: "org", label: "Group", text: "ComForce MKE" },
    { key: "month", label: "Month", text: "November 2026" },
    { key: "new", label: "Jobs planned", text: "14" },
    { key: "helped", label: "Jobs closed as helped", text: "9" },
    { key: "unmet", label: "Jobs on the unmet shelf at the end of the month", text: "3" },
    { key: "hours", label: "Volunteer hours", text: "312" },
    { key: "in_kind", label: "Value of volunteer time at $34.67 an hour", text: "$10,817" },
  ],
  claims: { c3: false, sponsor: false },
  footer: "Source: the Vision record for November 2026, sealed at line 128.",
};
const C3: DraftFacts = { ...FACTS, claims: { c3: true, sponsor: false } };
const SPONSOR: DraftFacts = { ...FACTS, claims: { c3: false, sponsor: true } };
const DATED: DraftFacts = {
  ...FACTS,
  facts: [
    ...FACTS.facts,
    { key: "horizon", label: "Forecast months", text: "12" },
    { key: "deadline", label: "Next deadline on the funder page", text: "30 November 2026" },
  ],
};
const BASE = "In November 2026 our volunteers helped 9 of 14 requests and gave 312 hours.";

type Case = { name: string; text: string; want: GuardReason[]; facts?: DraftFacts; alone?: boolean };

const CASES: Case[] = [
  { name: "the template", text: templateDraft(FACTS), want: [], alone: true },
  { name: "facts only, free order", text: BASE, want: [], alone: true },
  { name: "invented number", text: "We helped 15 neighbours.", want: ["number"] },
  { name: "percent sign", text: "Help rose 20%.", want: ["number", "percent"] },
  { name: "percent word", text: "That is up 9 percent.", want: ["percent"] },
  { name: "spelled number", text: "We helped twelve families.", want: ["number_word"] },
  { name: "dozen", text: "We cleared a dozen homes.", want: ["number_word"] },
  { name: "twice", text: "We did twice as many.", want: ["number_word"] },
  { name: "no one", text: "No one waited alone this month.", want: [] },
  { name: "ASCII quote", text: '"It was cold," the family said.', want: ["quote", "story"] },
  { name: "curly quote", text: "\u201CThank you\u201D", want: ["quote"] },
  { name: "guillemets", text: "\u00ABmerci\u00BB", want: ["quote"] },
  { name: "opening single quote", text: "'Thank you' from all of us.", want: ["quote"] },
  { name: "apostrophe", text: "ComForce MKE's volunteers did it.", want: [] },
  { name: "honorific", text: "Mrs. Johnson told us.", want: ["story"] },
  { name: "named", text: "We met a neighbour named Rosa.", want: ["story"] },
  { name: "own words", text: "In her own words, it helped.", want: ["story"] },
  { name: "meet", text: "Meet Dana, a volunteer.", want: ["story"] },
  { name: "meet, no name", text: "Come and meet the team.", want: [] },
  { name: "according to", text: "It helped, according to the family.", want: ["story"] },
  { name: "testimonial", text: "We got a testimonial from a resident.", want: ["story"] },
  { name: "ZIP", text: "Most help went to 53206.", want: ["number"] },
  { name: "year not in facts", text: "We have helped since 2019.", want: ["number"] },
  { name: "money normalised", text: "Time worth $10817 was given.", want: [] },
  { name: "money rounded", text: "Time worth $10.8K was given.", want: ["number"] },
  { name: "fullwidth digits", text: "\uFF11\uFF15 homes", want: ["number"] },
  { name: "fullwidth digits of a fact", text: "\uFF11\uFF14 requests", want: [] },
  { name: "Arabic-Indic digits", text: "\u0661\u0665 homes", want: ["number"] },
  { name: "www link", text: "See www.comforce.org today.", want: ["link"] },
  { name: "https link", text: "See https://x.org today.", want: ["link"] },
  { name: "email address", text: "Write to help@x.org today.", want: ["link"] },
  { name: "bare domain", text: "Give at comforce.org today.", want: ["link"] },
  { name: "short link with no scheme", text: "Give at bit.ly/comforce-give now.", want: ["link"] },
  { name: "upper case bare domain", text: "Give at COMFORCE.ORG now.", want: ["link"] },
  { name: "backtick quote", text: "A neighbour wrote `you saved my winter` to us.", want: ["quote"] },
  { name: "501(c)(3), claim false", text: "ComForce MKE is a 501(c)(3).", want: ["number", "status_claim"] },
  { name: "501(c)(3), claim true", text: "ComForce MKE is a 501(c)(3).", want: [], facts: C3 },
  { name: "tax-deductible", text: "Gifts are tax-deductible.", want: ["status_claim"] },
  { name: "nonprofit", text: "Support our nonprofit.", want: ["status_claim"] },
  { name: "fiscal sponsor, false", text: "We are fiscally sponsored.", want: ["status_claim"] },
  { name: "fiscal sponsor, true", text: "We are fiscally sponsored.", want: [], facts: SPONSOR },
  { name: "24/7", text: "We help 24/7.", want: ["number"] },
];

const ADVERSARIAL: Case[] = [
  { name: "fullwidth percent", text: "Help rose \uFF12\uFF10\uFF05.", want: ["number", "percent"] },
  { name: "superscript digit", text: "We cleared 312 m\u00B2 of snow.", want: ["number"] },
  { name: "number glued to letters", text: "It was the COVID19 winter.", want: ["number"] },
  { name: "ordinal", text: "It was our 5th winter.", want: ["number"] },
  { name: "phone number", text: "Call 414-555-0100 for help.", want: ["number"] },
  { name: "fact with a wrong decimal", text: "Time worth $10,817.50 was given.", want: ["number"] },
  { name: "fact rate from a label", text: "Each hour counts at $34.67.", want: [] },
  { name: "per cent with a space", text: "That is 9 per cent more.", want: ["percent"] },
  { name: "a few hundred", text: "A few hundred homes were cleared.", want: ["number_word"] },
  { name: "half", text: "Half of the work was snow.", want: ["number_word"] },
  { name: "honorific with no period", text: "Mr Smith thanked us.", want: ["story"] },
  { name: "her name was", text: "Her name was hidden.", want: ["story"] },
  { name: "stories of", text: "We share stories of hope.", want: ["story"] },
  {
    name: "closing single quote as an opening quote",
    text: "\u2019Thank you\u2019 from all of us.",
    want: ["quote"],
  },
  { name: "fullwidth quotation mark", text: "\uFF02Thank you\uFF02", want: ["quote"] },
  { name: "upper case link", text: "See HTTP://X.ORG now.", want: ["link"] },
  { name: "tax exempt", text: "We are tax exempt.", want: ["status_claim"] },
  { name: "registered charity", text: "We are a registered charity.", want: ["status_claim"] },
  { name: "charitable status", text: "Our charitable status is new.", want: ["status_claim"] },
  {
    name: "tax claim when the 501(c)(3) claim holds",
    text: "Gifts are tax-deductible.",
    want: [],
    facts: C3,
  },
  {
    name: "sponsor claim when only the 501(c)(3) claim holds",
    text: "We are fiscally sponsored.",
    want: ["status_claim"],
    facts: C3,
  },
  { name: "everyone and someone", text: "Everyone and someone helped.", want: [] },
];

const HIDDEN: Case[] = [
  { name: "zero-width space in https", text: "See h\u200Bttps://x.example now.", want: ["link"] },
  { name: "zero-width space after www", text: "See www\u200B.comforce.example now.", want: ["link"] },
  { name: "zero-width space in nonprofit", text: "Support our non\u200Bprofit.", want: ["status_claim"] },
  { name: "zero-width space in said", text: "A volunteer s\u200Baid it helped.", want: ["story"] },
  { name: "soft hyphen in nonprofit", text: "Support our non\u00ADprofit.", want: ["status_claim"] },
  { name: "format mark before an accent", text: "Meet E\u200B\u0301mile, a volunteer.", want: ["story"] },
  { name: "ideographic full stop in a domain", text: "Give at comforce\u3002org now.", want: ["link"] },
];

const NOT_LINKS: Case[] = [
  { name: "a decimal is a number, not a link", text: "A ride takes 1.5 hours.", want: ["number"] },
  { name: "e.g.", text: "We bring food, e.g. a box from a pantry.", want: [] },
  { name: "a.m. and p.m.", text: "We start at 9 a.m. and stop at 3 p.m. each day.", want: [] },
  { name: "U.S.", text: "We are a U.S. group of neighbours.", want: [] },
  { name: "St. Louis", text: "Our crew trained in St. Louis last year.", want: [] },
  { name: "Ph.D", text: "A Ph.D student joined the crew.", want: [] },
];

const INFLATED: Case[] = [
  { name: "fact number with K+", text: "We have served 12K+ neighbours.", want: ["number"], facts: DATED },
  { name: "fact number with k", text: "Help reached 30k residents.", want: ["number"], facts: DATED },
  { name: "fact number times x", text: "Requests went up 9x.", want: ["number"] },
  { name: "fact number with a plus", text: "We sent 3+ volunteers to each home.", want: ["number"] },
  { name: "fact number with a spaced M", text: "We reached 14 M homes.", want: ["number"] },
  {
    name: "12 months and 30 November",
    text: "For the 12 months to 30 November 2026 we plan more.",
    want: [],
    facts: DATED,
  },
  { name: "doubled", text: "Requests doubled this winter.", want: ["number_word"] },
  { name: "tripled", text: "The crew tripled in size.", want: ["number_word"] },
  { name: "quadrupled", text: "The crew quadrupled in size.", want: ["number_word"] },
  { name: "halved", text: "Wait times halved.", want: ["number_word"] },
  { name: "twofold", text: "It was a twofold rise.", want: ["number_word"] },
  { name: "fact number fold", text: "It was a 12-fold rise.", want: ["number_word"], facts: DATED },
  { name: "charity", text: "ComForce MKE is a charity.", want: ["status_claim"] },
  { name: "charity when the 501(c)(3) claim holds", text: "ComForce MKE is a charity.", want: [], facts: C3 },
  { name: "not-for-profit", text: "We are a not-for-profit.", want: ["status_claim"] },
  { name: "not for profit", text: "We are a not for profit group.", want: ["status_claim"] },
  { name: "non profit with a space", text: "We are a non profit group.", want: ["status_claim"] },
  { name: "deductible", text: "Your gift is deductible.", want: ["status_claim"] },
  { name: "registered charity", text: "We are a registered charity.", want: ["status_claim"] },
  {
    name: "working with charities is not a claim",
    text: "We work with local charities and pantries.",
    want: [],
  },
  { name: "fact number with a tab and a K", text: "We reached 14\tK homes.", want: ["number"] },
];

const FALSE_REJECTS: Case[] = [
  { name: "each one of", text: "Each one of our volunteers helped.", want: ["number_word"] },
  { name: "meet a funder", text: "We would like to meet Bader Philanthropies.", want: ["story"] },
  { name: "unfold", text: "We watch the winter unfold.", want: ["number_word"] },
  { name: "no space after a full stop", text: "Our volunteers helped.Thank you all.", want: ["link"] },
];

const reasonsOf = (c: Case): GuardReason[] => {
  const result = guardDraft(c.alone === true ? c.text : `${BASE} ${c.text}`, c.facts ?? FACTS);
  return result.ok ? [] : result.reasons;
};

it("the base sentence passes alone, so each case adds only its own reasons", () => {
  expect(guardDraft(BASE, FACTS)).toEqual({ ok: true });
});

it.each(CASES)("$name", (c) => {
  expect(reasonsOf(c)).toEqual(c.want);
});

it.each(ADVERSARIAL)("adversarial: $name", (c) => {
  expect(reasonsOf(c)).toEqual(c.want);
});

it.each(HIDDEN)("hidden mark: $name", (c) => {
  expect(reasonsOf(c)).toEqual(c.want);
});

it.each(NOT_LINKS)("not a link: $name", (c) => {
  expect(reasonsOf(c)).toEqual(c.want);
});

it.each(INFLATED)("inflated or claimed: $name", (c) => {
  expect(reasonsOf(c)).toEqual(c.want);
});

it.each(FALSE_REJECTS)("known false reject: $name", (c) => {
  expect(reasonsOf(c)).toEqual(c.want);
});

it("draftText removes format marks and gives the NFKC form, and a second pass changes nothing", () => {
  expect(draftText("\uFF11\uFF14 h\u200Bomes\u00AD")).toBe("14 homes");
  fc.assert(
    fc.property(fc.string({ unit: "binary" }), (text) => {
      const once = draftText(text);
      expect(draftText(once)).toBe(once);
      expect(/\p{Cf}/u.test(once)).toBe(false);
    }),
  );
});

it("unsafeFacts names a fact text with a link, a bare domain or a format mark", () => {
  const withOrg = (text: string): DraftFacts => ({
    ...FACTS,
    facts: FACTS.facts.map((f) => (f.key === "org" ? { ...f, text } : f)),
  });
  expect(unsafeFacts(FACTS)).toEqual([]);
  for (const text of [
    "Food, give at comforce-help.org",
    "help@x.example",
    "https://x.example",
    "Com\u200BForce",
  ])
    expect(
      unsafeFacts(withOrg(text)).map((f) => f.key),
      text,
    ).toEqual(["org"]);
  for (const text of ["St. Louis Helpers", "ComForce U.S.", "One Love MKE"])
    expect(unsafeFacts(withOrg(text)), text).toEqual([]);
});

it("a text over the limit of its kind is too long", () => {
  const long = Array.from({ length: 20 }, () => BASE).join(" ");
  expect(long.length).toBeGreaterThan(1200);
  expect(guardDraft(long, FACTS)).toEqual({ ok: false, reasons: ["too_long"] });
  expect(guardDraft(long, { ...FACTS, kind: "funder_letter" })).toEqual({ ok: true });
  expect(guardDraft(`${long} ${long}`, { ...FACTS, kind: "funder_letter" })).toEqual({
    ok: false,
    reasons: ["too_long"],
  });
});

it("a text under 40 characters is empty", () => {
  expect(guardDraft("x".repeat(39), FACTS)).toEqual({ ok: false, reasons: ["empty"] });
  expect(guardDraft(`   ${"x".repeat(39)}   `, FACTS)).toEqual({ ok: false, reasons: ["empty"] });
  expect(guardDraft("x".repeat(40), FACTS)).toEqual({ ok: true });
});

it("reasons are unique and in the order of GUARD_REASONS", () => {
  const text = `${BASE} Mrs. Johnson said 15% of twelve homes, "thanks" www.x.org, our nonprofit.`;
  const result = guardDraft(text, FACTS);
  expect(result).toEqual({
    ok: false,
    reasons: ["number", "percent", "number_word", "quote", "story", "link", "status_claim"],
  });
  if (!result.ok) expect(result.reasons).toEqual(GUARD_REASONS.filter((r) => result.reasons.includes(r)));
});

it("allowedNumbers holds the normal form of every number in the labels and texts", () => {
  expect([...allowedNumbers(FACTS)].sort()).toEqual(["10817", "14", "2026", "3", "312", "34.67", "9"].sort());
});

it("a fact text with a number word or a quote word is scrubbed, so the name of the group passes", () => {
  const org = (text: string): DraftFacts => ({
    ...FACTS,
    facts: FACTS.facts.map((f) => (f.key === "org" ? { ...f, text } : f)),
  });
  expect(guardDraft(`${BASE} One Love MKE thanks every volunteer.`, org("One Love MKE"))).toEqual({
    ok: true,
  });
  expect(guardDraft(`${BASE} Mom's Kitchen thanks every volunteer.`, org("Mom's Kitchen"))).toEqual({
    ok: true,
  });
  expect(guardDraft(`${BASE} One Love MKE thanks every volunteer.`, FACTS)).toEqual({
    ok: false,
    reasons: ["number_word"],
  });
});

it("a scrubbed fact cannot hide part of a longer number", () => {
  const range: DraftFacts = {
    ...FACTS,
    facts: [...FACTS.facts, { key: "forecast_jobs", label: "Forecast jobs", text: "240 to 410" }],
  };
  expect(guardDraft(`${BASE} The forecast is 240 to 410 jobs.`, range)).toEqual({ ok: true });
  expect(guardDraft(`${BASE} The forecast is 240 to 4100 jobs.`, range)).toEqual({
    ok: false,
    reasons: ["number"],
  });
});

const postFacts = (n: readonly number[], cents: number, partial: boolean): DraftFacts => ({
  ...FACTS,
  facts: [
    { key: "org", label: "Group", text: "ComForce MKE" },
    { key: "month", label: "Month", text: partial ? "November 2026 so far" : "October 2026" },
    { key: "new", label: "Jobs planned", text: formatCount(n[0] ?? 0) },
    { key: "helped", label: "Jobs closed as helped", text: formatCount(n[1] ?? 0) },
    {
      key: "unmet",
      label: partial ? "Jobs on the unmet shelf now" : "Jobs on the unmet shelf at the end of the month",
      text: formatCount(n[2] ?? 0),
    },
    { key: "hours", label: "Volunteer hours", text: formatCount(n[3] ?? 0) },
    { key: "in_kind", label: "Value of volunteer time at $34.67 an hour", text: formatDollars(cents) },
  ],
});

const range = (low: number, high: number): string => `${formatCount(low)} to ${formatCount(high)}`;

const letterFacts = (n: readonly number[], cents: number, min: number | null): DraftFacts => ({
  ...FACTS,
  kind: "funder_letter",
  resource: "bader_preliminary",
  facts: [
    { key: "org", label: "Group", text: "ComForce MKE" },
    { key: "funder", label: "Funder", text: "Bader Philanthropies, preliminary application" },
    ...postFacts(n, cents, false).facts.filter((f) => f.key !== "org" && f.key !== "unmet"),
    { key: "window", label: "Forecast window", text: "December 2026 to November 2027" },
    { key: "horizon", label: "Forecast months", text: "12" },
    {
      key: "needs",
      label: "Needs that this funder fits",
      text: "Snow shovelling, Food from a pantry and 2 more",
    },
    {
      key: "forecast_jobs",
      label: "Forecast jobs in these needs, low to high",
      text: range(n[4] ?? 0, n[5] ?? 0),
    },
    {
      key: "forecast_hours",
      label: "Forecast volunteer hours in these needs, low to high",
      text: range(n[6] ?? 0, n[7] ?? 0),
    },
    {
      key: "amount",
      label: "Award size on the funder page",
      text:
        min === null
          ? `up to ${formatDollars(cents * 2)}`
          : `${formatDollars(min * 100)} to ${formatDollars(cents * 2)}`,
    },
    { key: "deadline", label: "Next deadline on the funder page", text: "30 November 2026" },
  ],
});

it("for random fact numbers the fixed template passes the guard, for both kinds", () => {
  const counts = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 8, maxLength: 8 });
  const cents = fc.integer({ min: 0, max: 10_000_000 });
  const min = fc.option(fc.integer({ min: 0, max: 100_000 }));
  fc.assert(
    fc.property(counts, cents, min, fc.boolean(), (n, c, m, partial) => {
      for (const facts of [postFacts(n, c, partial), letterFacts(n, c, m)])
        expect(guardDraft(templateDraft(facts), facts)).toEqual({ ok: true });
    }),
  );
});
