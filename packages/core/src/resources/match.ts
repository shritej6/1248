import type {
  Forecast,
  Match,
  MatchPath,
  Playbook,
  Readiness,
  Resource,
  Why,
  WhyCode,
} from "@vision/contracts";
import { daysBetween } from "./calendar.js";
import { cautionsFor, nextDeadline } from "./cautions.js";
import { activeNeeds } from "./history.js";

export const MATCH_WEIGHTS = { fit: 45, reach: 35, timing: 20 } as const;

type MatchInput = {
  resources: readonly Resource[];
  forecast: Forecast;
  playbook: Playbook;
  readiness: Readiness;
  today: string;
};
type Route = { path: MatchPath; reach: number };
type Ranked = { name: string; match: Match };

const routeOf = (resource: Resource, readiness: Readiness): Route => {
  const e = resource.eligibility;
  if (resource.status === "closed") return { path: "closed", reach: 0 };
  if (e.invitationOnly) return { path: "invitation_only", reach: 0.2 };
  if (e.partnerApplies) return { path: "partner_applies", reach: 0.4 };
  if (e.needs501c3 === true && readiness.c3 === "yes") return { path: "direct", reach: 1 };
  if (e.needs501c3 === true && e.sponsorOk === true)
    return { path: "via_sponsor", reach: readiness.sponsor === "signed" ? 0.9 : 0.6 };
  if (e.needs501c3 === true) return { path: "needs_501c3", reach: 0.1 };
  if (e.needs501c3 === null) return { path: "ask_first", reach: 0.5 };
  return { path: "direct", reach: 1 };
};

export const matchPath = (resource: Resource, readiness: Readiness): MatchPath =>
  routeOf(resource, readiness).path;

const sum = (values: readonly number[]): number => values.reduce((total, v) => total + v, 0);

const likelyOf = (forecast: Forecast, need: string): number =>
  forecast.status === "ready" ? (forecast.needs.find((n) => n.need === need)?.total.jobs.likely ?? 0) : 0;

const shareOf = (needs: readonly string[], forecast: Forecast, active: ReadonlySet<string>): number => {
  const ready = forecast.status === "ready";
  const all = ready ? sum(forecast.needs.map((n) => n.total.jobs.likely)) : active.size;
  const part = ready
    ? sum(needs.map((n) => likelyOf(forecast, n)))
    : needs.filter((n) => active.has(n)).length;
  return all === 0 ? 0 : part / all;
};

const fitOf = (resource: Resource, forecast: Forecast, active: ReadonlySet<string>): number => {
  const share = shareOf([...new Set(resource.fit.needs)], forecast, active);
  return Math.min(1, Math.max(0, resource.fit.general ? Math.max(0.5, share) : share));
};

const timingOf = (resource: Resource, next: string | null, today: string): number => {
  if (resource.status === "closed") return 0;
  if (resource.rolling) return 1;
  if (next === null) return 0.1;
  const days = daysBetween(today, next);
  if (days <= 7) return 0.7;
  return days <= 120 ? 1 : 0.6;
};

const scoreOf = (route: Route, fit: number, timing: number): number =>
  route.path === "closed"
    ? 0
    : Math.round(MATCH_WEIGHTS.fit * fit + MATCH_WEIGHTS.reach * route.reach + MATCH_WEIGHTS.timing * timing);

const fitNeedsOf = (resource: Resource, forecast: Forecast, active: ReadonlySet<string>): string[] =>
  [...new Set(resource.fit.needs)].filter(
    (need) => active.has(need) && (forecast.status !== "ready" || likelyOf(forecast, need) > 0),
  );

const reason = (holds: boolean, code: WhyCode): Why[] => (holds ? [{ code }] : []);

const whyOf = (resource: Resource, next: string | null, fitNeeds: string[]): Why[] => [
  ...(fitNeeds.length > 0 ? [{ code: "fits_needs" as const, needs: fitNeeds }] : []),
  ...reason(resource.fit.general, "general_support"),
  ...reason(resource.eligibility.residentGroupOk === true, "resident_group_ok"),
  ...reason(resource.eligibility.sponsorOk === true, "sponsor_ok"),
  ...reason(resource.rolling && resource.status !== "closed", "rolling"),
  ...(next === null ? [] : [{ code: "deadline" as const, date: next }]),
  ...reason(resource.amount !== null, "amount"),
  ...reason(resource.inKind !== null, "in_kind"),
];

const matchOne = (resource: Resource, input: MatchInput, active: ReadonlySet<string>): Match => {
  const route = routeOf(resource, input.readiness);
  const next = nextDeadline(resource, input.today);
  const fit = fitOf(resource, input.forecast, active);
  const timing = timingOf(resource, next, input.today);
  return {
    resource: resource.id,
    score: scoreOf(route, fit, timing),
    parts: { fit, reach: route.reach, timing },
    path: route.path,
    nextDeadline: next,
    why: whyOf(resource, next, fitNeedsOf(resource, input.forecast, active)),
    cautions: cautionsFor(resource, { path: route.path, readiness: input.readiness, today: input.today }),
  };
};

const byDeadline = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

const byRank = (a: Ranked, b: Ranked): number =>
  b.match.score - a.match.score ||
  byDeadline(a.match.nextDeadline, b.match.nextDeadline) ||
  a.name.localeCompare(b.name);

export const matchResources = (input: MatchInput): Match[] => {
  const active = new Set(activeNeeds(input.playbook).map((row) => row.need));
  return input.resources
    .map((resource): Ranked => ({ name: resource.name, match: matchOne(resource, input, active) }))
    .sort(byRank)
    .map((ranked) => ranked.match);
};
