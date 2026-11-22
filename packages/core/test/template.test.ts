import {
  CatalogSchema,
  DEFAULT_READINESS,
  writesLetter,
  type DraftFacts,
  type Forecast,
  type Statement,
} from "@vision/contracts";
import { expect, it } from "vitest";
import catalogFile from "../../../data/resources/catalog.json" with { type: "json" };
import { draftFacts, type FactInput } from "../src/resources/facts.js";
import { buildForecast } from "../src/resources/forecast.js";
import { guardDraft } from "../src/resources/guard.js";
import { templateDraft, withFooter } from "../src/resources/template.js";
import { emptyState } from "../src/state.js";
import { statement } from "../src/statement.js";
import { playbook } from "./helpers.js";

const NOW = Date.UTC(2026, 10, 22, 18, 0);
const CATALOG = CatalogSchema.parse(catalogFile);
const DEMO = buildForecast({ now: NOW, demo: true, events: [], state: emptyState(), playbook }, []);
const NO_HISTORY: Forecast = { status: "not_enough_history", recordMonths: 0, needed: 12 };
const STATEMENT: Statement = {
  ...statement([], "2026-11"),
  new: 14,
  helped: 9,
  unmet: 3,
  hours: 312,
  seal: { seq: 128, hash: "a".repeat(64) },
};

const base: FactInput = {
  kind: "impact_post",
  orgName: "ComForce MKE",
  month: "2026-11",
  partial: false,
  statement: STATEMENT,
  forecast: DEMO,
  resource: null,
  playbook,
  readiness: DEFAULT_READINESS,
  today: "2026-11-22",
};

const LETTER_ROWS = CATALOG.resources.filter(writesLetter);
const letters = (forecast: Forecast): DraftFacts[] =>
  LETTER_ROWS.map((resource) => draftFacts({ ...base, kind: "funder_letter", resource, forecast }));

const ALL: DraftFacts[] = [
  draftFacts(base),
  draftFacts({ ...base, partial: true }),
  ...letters(DEMO),
  ...letters(NO_HISTORY),
];

it("the impact post template is the group, the month and one line for each figure", () => {
  expect(templateDraft(draftFacts(base))).toBe(
    [
      "ComForce MKE in November 2026:",
      "Jobs planned: 14",
      "Jobs closed as helped: 9",
      "Jobs on the unmet shelf at the end of the month: 3",
      "Volunteer hours: 312",
      "Value of volunteer time at $34.67 an hour: $10,817",
      "Thank you to every volunteer. Each figure comes from the sealed Vision record.",
    ].join("\n"),
  );
});

it("the funder letter template asks whether the group can apply and signs with its name", () => {
  const resource = CATALOG.resources.find((r) => r.id === "walmart_spark_good") ?? null;
  const facts = draftFacts({ ...base, kind: "funder_letter", resource, forecast: NO_HISTORY });
  expect(templateDraft(facts)).toBe(
    [
      "To the team at Walmart Spark Good Local Grants,",
      "",
      "ComForce MKE is a volunteer group in Milwaukee. We record each request for help, each job and each volunteer hour in Vision, a sealed record.",
      "",
      "In November 2026, the record shows:",
      "Jobs planned: 14",
      "Jobs closed as helped: 9",
      "Volunteer hours: 312",
      "Value of volunteer time at $34.67 an hour: $10,817",
      "",
      "Your page lists awards of $250 to $5,000.",
      "Your page lists the next deadline as 30 November 2026.",
      "",
      "We would like to ask whether ComForce MKE can apply to Walmart Spark Good Local Grants. Can we talk about the next steps?",
      "",
      "With thanks,",
      "ComForce MKE",
    ].join("\n"),
  );
});

it("the letter greets the funder by the name before the first comma and asks about the whole row", () => {
  const resource = CATALOG.resources.find((r) => r.id === "bader_preliminary") ?? null;
  const text = templateDraft(draftFacts({ ...base, kind: "funder_letter", resource, forecast: NO_HISTORY }));
  expect(text.split("\n")[0]).toBe("To the team at Bader Philanthropies,");
  expect(text).toContain(
    "We would like to ask whether ComForce MKE can apply to Bader Philanthropies, preliminary application.",
  );
});

it("the forecast line names the window, the needs and the ranges", () => {
  const resource = CATALOG.resources.find((r) => r.id === "bader_preliminary") ?? null;
  const facts = draftFacts({ ...base, kind: "funder_letter", resource });
  const text = (key: string) => facts.facts.find((f) => f.key === key)?.text ?? "";
  expect(templateDraft(facts)).toContain(
    `For the 12 months from December 2026 to November 2027, our forecast for ${text("needs")} is ${text("forecast_jobs")} jobs and ${text("forecast_hours")} volunteer hours.`,
  );
});

it("a letter with no optional line has no empty paragraph", () => {
  const resource = CATALOG.resources.find((r) => r.id === "brewers_community_foundation") ?? null;
  const text = templateDraft(draftFacts({ ...base, kind: "funder_letter", resource, forecast: NO_HISTORY }));
  expect(text).not.toContain("\n\n\n");
  expect(text).not.toContain("Your page");
});

it("every template holds every fact text and passes the guard", () => {
  for (const facts of ALL) {
    const text = templateDraft(facts);
    for (const fact of facts.facts) expect(text).toContain(fact.text);
    expect(guardDraft(text, facts)).toEqual({ ok: true });
  }
});

it("every template passes the guard when the readiness list makes both claims", () => {
  const readiness = { ...DEFAULT_READINESS, c3: "yes", sponsor: "signed" } as const;
  for (const resource of LETTER_ROWS) {
    const facts = draftFacts({ ...base, kind: "funder_letter", resource, readiness });
    expect(guardDraft(templateDraft(facts), facts)).toEqual({ ok: true });
  }
});

it("withFooter trims the body and adds the footer after one empty line", () => {
  const facts = draftFacts(base);
  expect(withFooter("  Body text.\n\n", facts)).toBe(
    "Body text.\n\nSource: the Vision record for November 2026, sealed at line 128.",
  );
  expect(withFooter(templateDraft(facts), facts).endsWith(facts.footer)).toBe(true);
});
