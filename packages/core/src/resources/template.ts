import type { DraftFacts, FactKey } from "@vision/contracts";

const POST_LINES: readonly FactKey[] = ["new", "helped", "unmet", "hours", "in_kind"];
const LETTER_LINES: readonly FactKey[] = ["new", "helped", "hours", "in_kind"];

const textOf = (facts: DraftFacts, key: FactKey): string | null =>
  facts.facts.find((f) => f.key === key)?.text ?? null;

const lineOf = (facts: DraftFacts, key: FactKey): string[] => {
  const found = facts.facts.find((f) => f.key === key);
  return found === undefined ? [] : [`${found.label}: ${found.text}`];
};

const sentence = (text: string | null, make: (text: string) => string): string[] =>
  text === null ? [] : [make(text)];

const impactPost = (facts: DraftFacts): string =>
  [
    `${textOf(facts, "org") ?? ""} in ${textOf(facts, "month") ?? ""}:`,
    ...POST_LINES.flatMap((key) => lineOf(facts, key)),
    "Thank you to every volunteer. Each figure comes from the sealed Vision record.",
  ].join("\n");

const forecastLine = (facts: DraftFacts): string[] => {
  const horizon = textOf(facts, "horizon");
  const window = textOf(facts, "window");
  const needs = textOf(facts, "needs");
  const jobs = textOf(facts, "forecast_jobs");
  const hours = textOf(facts, "forecast_hours");
  if (horizon === null || window === null || needs === null || jobs === null || hours === null) return [];
  return [
    `For the ${horizon} months from ${window}, our forecast for ${needs} is ${jobs} jobs and ${hours} volunteer hours.`,
  ];
};

const addressee = (funder: string): string => {
  const name = funder.split(",")[0]?.trim() ?? "";
  return name.length > 0 ? name : funder;
};

const funderLetter = (facts: DraftFacts): string => {
  const org = textOf(facts, "org") ?? "";
  const funder = textOf(facts, "funder") ?? "";
  const page = [
    ...forecastLine(facts),
    ...sentence(textOf(facts, "amount"), (amount) => `Your page lists awards of ${amount}.`),
    ...sentence(textOf(facts, "deadline"), (deadline) => `Your page lists the next deadline as ${deadline}.`),
  ];
  const record = [
    `In ${textOf(facts, "month") ?? ""}, the record shows:`,
    ...LETTER_LINES.flatMap((k) => lineOf(facts, k)),
  ];
  return [
    `To the team at ${addressee(funder)},`,
    `${org} is a volunteer group in Milwaukee. We record each request for help, each job and each volunteer hour in Vision, a sealed record.`,
    record.join("\n"),
    ...(page.length > 0 ? [page.join("\n")] : []),
    `We would like to ask whether ${org} can apply to ${funder}. Can we talk about the next steps?`,
    `With thanks,\n${org}`,
  ].join("\n\n");
};

export const templateDraft = (facts: DraftFacts): string =>
  facts.kind === "impact_post" ? impactPost(facts) : funderLetter(facts);

export const withFooter = (body: string, facts: DraftFacts): string => `${body.trim()}\n\n${facts.footer}`;
