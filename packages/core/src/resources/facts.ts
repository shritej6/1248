import type {
  DraftFact,
  DraftFacts,
  DraftKind,
  FactKey,
  Forecast,
  Month,
  Playbook,
  Range,
  Readiness,
  Resource,
  Statement,
} from "@vision/contracts";
import { dateLabel, monthLabel } from "./calendar.js";
import { nextDeadline } from "./cautions.js";
import { HOUR_VALUE_CENTS, HOUR_VALUE_TEXT } from "./forecast.js";
import { activeNeeds } from "./history.js";

export type FactInput = {
  kind: DraftKind;
  orgName: string;
  month: Month;
  partial: boolean;
  statement: Statement;
  forecast: Forecast;
  resource: Resource | null;
  playbook: Playbook;
  readiness: Readiness;
  today?: string;
};

type Scope = { text: string; needs: ReadonlySet<string> };

const MAX_NEEDS = 6;
const FACT_TEXT_MAX = 200;
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

export const formatCount = (n: number): string => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RangeError(`The count ${String(n)} is not a whole number.`);
  return String(n).replace(THOUSANDS, ",");
};

export const formatDollars = (cents: number): string => `$${formatCount(Math.round(cents / 100))}`;

const fact = (key: FactKey, label: string, text: string): DraftFact => ({ key, label, text });

const recordFacts = (input: FactInput): DraftFact[] => {
  const hours = Math.round(input.statement.hours);
  const unmet = input.partial
    ? "Jobs on the unmet shelf now"
    : "Jobs on the unmet shelf at the end of the month";
  return [
    fact("new", "Jobs planned", formatCount(input.statement.new)),
    fact("helped", "Jobs closed as helped", formatCount(input.statement.helped)),
    ...(input.kind === "impact_post" ? [fact("unmet", unmet, formatCount(input.statement.unmet))] : []),
    fact("hours", "Volunteer hours", formatCount(hours)),
    fact(
      "in_kind",
      `Value of volunteer time at ${HOUR_VALUE_TEXT} an hour`,
      formatDollars(hours * HOUR_VALUE_CENTS),
    ),
  ];
};

const listText = (labels: readonly string[], shown: number): string => {
  const rest = labels.length - shown;
  return `${labels.slice(0, shown).join(", ")}${rest > 0 ? ` and ${String(rest)} more` : ""}`;
};

const needsText = (labels: readonly string[]): string => {
  const most = Math.min(MAX_NEEDS, labels.length);
  const counts = Array.from({ length: most }, (_, i) => most - i);
  return listText(labels, counts.find((shown) => listText(labels, shown).length <= FACT_TEXT_MAX) ?? 1);
};

const scopeOf = (resource: Resource, playbook: Playbook): Scope | null => {
  const active = activeNeeds(playbook);
  const rows = [...new Set(resource.fit.needs)].flatMap(
    (need) => active.find((row) => row.need === need) ?? [],
  );
  if (rows.length > 0)
    return { text: needsText(rows.map((r) => r.label)), needs: new Set(rows.map((r) => r.need)) };
  return resource.fit.general ? { text: "All needs", needs: new Set(active.map((r) => r.need)) } : null;
};

const span = (ranges: readonly Range[]): string => {
  const low = ranges.reduce((total, r) => total + r.low, 0);
  const high = ranges.reduce((total, r) => total + r.high, 0);
  return `${formatCount(low)} to ${formatCount(high)}`;
};

const forecastFacts = (input: FactInput, resource: Resource): DraftFact[] => {
  const forecast = input.forecast;
  if (forecast.status !== "ready") return [];
  const scope = scopeOf(resource, input.playbook);
  const first = forecast.months[0];
  const last = forecast.months.at(-1);
  if (scope === null || first === undefined || last === undefined) return [];
  const chosen = forecast.needs.filter((n) => scope.needs.has(n.need));
  return [
    fact("window", "Forecast window", `${monthLabel(first)} to ${monthLabel(last)}`),
    fact("horizon", "Forecast months", String(forecast.months.length)),
    fact("needs", "Needs that this funder fits", scope.text),
    fact("forecast_jobs", "Forecast jobs in these needs, low to high", span(chosen.map((n) => n.total.jobs))),
    fact(
      "forecast_hours",
      "Forecast volunteer hours in these needs, low to high",
      span(chosen.map((n) => n.total.hours)),
    ),
  ];
};

const amountText = (amount: NonNullable<Resource["amount"]>): string =>
  amount.min === null
    ? `up to ${formatDollars(amount.max * 100)}`
    : `${formatDollars(amount.min * 100)} to ${formatDollars(amount.max * 100)}`;

const pageFacts = (resource: Resource, today: string | undefined): DraftFact[] => {
  if (resource.source.quality !== "opened") return [];
  const next = today === undefined ? null : nextDeadline(resource, today);
  return [
    ...(resource.amount === null
      ? []
      : [fact("amount", "Award size on the funder page", amountText(resource.amount))]),
    ...(next === null ? [] : [fact("deadline", "Next deadline on the funder page", dateLabel(next))]),
  ];
};

const footerOf = (input: FactInput, monthText: string, withForecast: boolean): string => {
  const source = `Source: the Vision record for ${monthText}, sealed at line ${String(input.statement.seal.seq)}.`;
  const synthetic = input.forecast.status === "ready" && input.forecast.history.syntheticMonths > 0;
  return withForecast && synthetic ? `${source} The forecast uses synthetic history.` : source;
};

export const draftFacts = (input: FactInput): DraftFacts => {
  const letter = input.kind === "funder_letter";
  if (letter && input.resource === null)
    throw new RangeError("A funder letter needs a resource from the catalog.");
  const resource = letter ? input.resource : null;
  const monthText = `${monthLabel(input.month)}${input.partial ? " so far" : ""}`;
  const forecast = resource === null ? [] : forecastFacts(input, resource);
  return {
    kind: input.kind,
    month: input.month,
    resource: resource?.id ?? null,
    facts: [
      fact("org", "Group", input.orgName),
      ...(resource === null ? [] : [fact("funder", "Funder", resource.name)]),
      fact("month", "Month", monthText),
      ...recordFacts(input),
      ...forecast,
      ...(resource === null ? [] : pageFacts(resource, input.today)),
    ],
    claims: { c3: input.readiness.c3 === "yes", sponsor: input.readiness.sponsor === "signed" },
    footer: footerOf(input, monthText, forecast.length > 0),
  };
};
