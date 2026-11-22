import {
  CAUTION_CODES,
  type Caution,
  type CautionCode,
  type MatchPath,
  type Readiness,
  type Resource,
  type SourceQuality,
} from "@vision/contracts";
import { daysBetween } from "./calendar.js";

type CautionContext = { path: MatchPath; readiness: Readiness; today: string };

const SOON_DAYS = 14;
const STALE_DAYS = 30;

const PATH_CAUTIONS: Partial<Record<MatchPath, CautionCode>> = {
  closed: "closed",
  invitation_only: "invitation_only",
  partner_applies: "partner_applies",
  needs_501c3: "needs_501c3",
};

const QUALITY_CAUTIONS: Partial<Record<SourceQuality, CautionCode>> = {
  old: "old_source",
  search_summary: "search_summary",
  secondary: "secondary_source",
};

export const nextDeadline = (resource: Resource, today: string): string | null =>
  resource.deadlines.find((date) => date >= today) ?? null;

const when = (holds: boolean, code: CautionCode): CautionCode[] => (holds ? [code] : []);

const sponsorCautions = (path: MatchPath, readiness: Readiness): CautionCode[] => {
  if (path !== "via_sponsor") return [];
  return [readiness.sponsor === "signed" ? "through_sponsor" : "needs_sponsor"];
};

const rowCautions = (resource: Resource, ctx: CautionContext): CautionCode[] => {
  const open = ctx.path !== "closed";
  const pathCode = PATH_CAUTIONS[ctx.path];
  const qualityCode = QUALITY_CAUTIONS[resource.source.quality];
  return [
    ...(pathCode === undefined ? [] : [pathCode]),
    ...sponsorCautions(ctx.path, ctx.readiness),
    ...when(resource.eligibility.needs501c3 === null && open, "eligibility_not_stated"),
    ...when(resource.eligibility.federal && ctx.readiness.uei !== "active", "federal_uei"),
    ...when(resource.kind === "people" && ctx.readiness.dfi === "not_checked", "dfi_check"),
    ...when(open && !resource.rolling && nextDeadline(resource, ctx.today) === null, "no_open_deadline"),
    ...resource.cautions,
    ...(qualityCode === undefined ? [] : [qualityCode]),
    ...when(daysBetween(resource.source.checked, ctx.today) > STALE_DAYS, "check_before_apply"),
  ];
};

const soonCaution = (resource: Resource, ctx: CautionContext): Caution[] => {
  const next = nextDeadline(resource, ctx.today);
  if (next === null || ctx.path === "closed") return [];
  const days = daysBetween(ctx.today, next);
  return days <= SOON_DAYS ? [{ code: "deadline_soon", days }] : [];
};

const order = (code: CautionCode): number => CAUTION_CODES.indexOf(code);

export const cautionsFor = (resource: Resource, ctx: CautionContext): Caution[] => {
  const codes = [...new Set(rowCautions(resource, ctx))].map((code): Caution => ({ code }));
  return [...codes, ...soonCaution(resource, ctx)].sort((a, b) => order(a.code) - order(b.code));
};
