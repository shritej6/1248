import { z } from "zod";
import { DateSchema, DraftIdSchema, HashSchema, MemberIdSchema, TimeSchema } from "./ids.js";
import { DivisionSchema, NeedSchema } from "./needs.js";
import { MonthSchema } from "./statement.js";

const count = z.number().int().nonnegative();
const share = z.number().min(0).max(1);
const maybe = z.boolean().nullable();

export const DRAFT_DAILY_CAP = 20;
export const DRAFT_LIST_MAX = 50;
export const DRAFT_TEXT_MAX = 3000;
export const DRAFT_MAX_CHARS = { impact_post: 1200, funder_letter: 2400 } as const;
export const CENTS_PER_JOB_MAX = 10_000_000;

export const ResourceIdSchema = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/);
export const ResourceKindSchema = z.enum(["grant", "people", "company", "goods_skills"]);
export const SourceQualitySchema = z.enum(["opened", "search_summary", "secondary", "old"]);
export const ResourceStatusSchema = z.enum(["open", "between_cycles", "closed", "unknown"]);

export const STATIC_CAUTIONS = [
  "resident_group_only",
  "no_stipends",
  "match_required",
  "no_equipment",
  "no_business_account",
  "board_rules",
  "one_grant_a_year",
  "area_limited",
  "not_free",
  "platform_fees",
  "funding_uncertain",
  "ask_contact_first",
  "amount_unverified",
  "activity_unconfirmed",
  "conflicting_source",
  "single_source",
] as const;

export const CAUTION_CODES = [
  "closed",
  "invitation_only",
  "partner_applies",
  "needs_501c3",
  "needs_sponsor",
  "through_sponsor",
  "eligibility_not_stated",
  "federal_uei",
  "dfi_check",
  "deadline_soon",
  "no_open_deadline",
  ...STATIC_CAUTIONS,
  "old_source",
  "search_summary",
  "secondary_source",
  "check_before_apply",
] as const;

export const StaticCautionSchema = z.enum(STATIC_CAUTIONS);
export const CautionCodeSchema = z.enum(CAUTION_CODES);

export const SourceSchema = z.strictObject({
  url: z
    .string()
    .max(300)
    .regex(/^https:\/\/[^\s"'<>]+$/),
  checked: DateSchema,
  quality: SourceQualitySchema,
});

export const AmountSchema = z
  .strictObject({ min: count.nullable(), max: count })
  .refine((a) => a.min === null || a.min <= a.max, { message: "The lowest award is above the highest." });

export const EligibilitySchema = z.strictObject({
  needs501c3: maybe,
  sponsorOk: maybe,
  residentGroupOk: maybe,
  invitationOnly: z.boolean(),
  partnerApplies: z.boolean(),
  federal: z.boolean(),
});

export const FitSchema = z.strictObject({
  needs: z.array(NeedSchema).max(14),
  divisions: z.array(DivisionSchema).max(10),
  general: z.boolean(),
});

export const ResourceSchema = z.strictObject({
  id: ResourceIdSchema,
  name: z.string().min(1).max(80),
  kind: ResourceKindSchema,
  what: z.string().min(1).max(240),
  amount: AmountSchema.nullable(),
  inKind: z.string().min(1).max(80).nullable(),
  eligibility: EligibilitySchema,
  status: ResourceStatusSchema,
  rolling: z.boolean(),
  deadlines: z.array(DateSchema).max(8),
  fit: FitSchema,
  cautions: z.array(StaticCautionSchema).max(10),
  source: SourceSchema,
});

const LETTER_KINDS: ReadonlySet<ResourceKind> = new Set(["grant", "company"]);

export const writesLetter = (resource: Pick<Resource, "kind" | "status">): boolean =>
  LETTER_KINDS.has(resource.kind) && resource.status !== "closed";

export const SponsorSchema = z.strictObject({
  id: ResourceIdSchema,
  name: z.string().min(1).max(80),
  place: z.string().min(1).max(40),
  fee: z.string().min(1).max(160),
  note: z.string().min(1).max(200),
  source: SourceSchema,
});

type CatalogRows = { resources: z.infer<typeof ResourceSchema>[]; sponsors: z.infer<typeof SponsorSchema>[] };

const catalogIssues = (catalog: CatalogRows): string[] => {
  const ids = [...catalog.resources.map((r) => r.id), ...catalog.sponsors.map((s) => s.id)];
  const issues = ids
    .filter((id, i) => ids.indexOf(id) !== i)
    .map((id) => `The id ${id} appears more than once.`);
  for (const r of catalog.resources) {
    const sorted = [...r.deadlines].sort((a, b) => a.localeCompare(b));
    if (sorted.join() !== r.deadlines.join()) issues.push(`The deadlines of ${r.id} are not in order.`);
    if (r.status === "closed" && (r.rolling || r.deadlines.length > 0))
      issues.push(`The closed row ${r.id} has dates.`);
  }
  return issues;
};

export const CatalogSchema = z
  .strictObject({
    version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/),
    checked: DateSchema,
    resources: z.array(ResourceSchema).min(1).max(60),
    sponsors: z.array(SponsorSchema).max(10),
  })
  .superRefine((catalog, ctx) => {
    for (const message of catalogIssues(catalog)) ctx.addIssue({ code: "custom", message });
  });

export const SponsorStateSchema = z.enum(["none", "talking", "signed"]);
export const DfiStateSchema = z.enum(["not_checked", "exempt_confirmed", "registered"]);
export const C3StateSchema = z.enum(["no", "applied", "yes"]);
export const UeiStateSchema = z.enum(["not_needed", "needed", "active"]);
export const ReadinessItemSchema = z.enum(["sponsor", "dfi", "c3", "uei"]);
export const ReadinessSchema = z.strictObject({
  sponsor: SponsorStateSchema,
  dfi: DfiStateSchema,
  c3: C3StateSchema,
  uei: UeiStateSchema,
});
export const ReadinessSetSchema = z.discriminatedUnion("item", [
  z.strictObject({ item: z.literal("sponsor"), state: SponsorStateSchema }),
  z.strictObject({ item: z.literal("dfi"), state: DfiStateSchema }),
  z.strictObject({ item: z.literal("c3"), state: C3StateSchema }),
  z.strictObject({ item: z.literal("uei"), state: UeiStateSchema }),
]);
export const DEFAULT_READINESS: z.infer<typeof ReadinessSchema> = {
  sponsor: "none",
  dfi: "not_checked",
  c3: "no",
  uei: "not_needed",
};

export const CostBasisSchema = z.enum(["estimate", "receipts"]);
const centsPerJob = z.number().int().min(0).max(CENTS_PER_JOB_MAX);
export const CostEntrySchema = z.strictObject({
  need: NeedSchema,
  centsPerJob,
  basis: CostBasisSchema,
  updatedAt: TimeSchema,
});
export const CostSetSchema = z.strictObject({
  need: NeedSchema,
  centsPerJob: centsPerJob.nullable(),
  basis: CostBasisSchema,
});

export const RangeSchema = z
  .strictObject({ low: count, likely: count, high: count })
  .refine((r) => r.low <= r.likely && r.likely <= r.high, {
    message: "A range goes from low to likely to high.",
  });
export const SeasonRuleSchema = z.enum(["snow", "heating", "history", "flat"]);
const amounts = {
  jobs: RangeSchema,
  hours: RangeSchema,
  inKindCents: RangeSchema,
  cashCents: RangeSchema.nullable(),
};
export const ForecastMonthSchema = z.strictObject({ month: MonthSchema, ...amounts });
export const NeedForecastSchema = z.strictObject({
  need: NeedSchema,
  label: z.string().min(1).max(60),
  rule: SeasonRuleSchema,
  hoursPerJob: z.number().nonnegative(),
  cost: z.strictObject({ centsPerJob, basis: CostBasisSchema }).nullable(),
  months: z.array(ForecastMonthSchema).length(12),
  total: z.strictObject(amounts),
});
export const ForecastSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("ready"),
    history: z.strictObject({
      from: MonthSchema,
      to: MonthSchema,
      syntheticMonths: count,
      recordMonths: count,
    }),
    hourValueCents: count,
    months: z.array(MonthSchema).length(12),
    needs: z.array(NeedForecastSchema).max(40),
    total: z.strictObject({ jobs: RangeSchema, hours: RangeSchema, inKindCents: RangeSchema }),
  }),
  z.strictObject({ status: z.literal("not_enough_history"), recordMonths: count, needed: z.literal(12) }),
]);

export const MatchPathSchema = z.enum([
  "direct",
  "via_sponsor",
  "needs_501c3",
  "partner_applies",
  "invitation_only",
  "ask_first",
  "closed",
]);
export const WhyCodeSchema = z.enum([
  "fits_needs",
  "general_support",
  "resident_group_ok",
  "sponsor_ok",
  "rolling",
  "deadline",
  "amount",
  "in_kind",
]);
export const WhySchema = z.strictObject({
  code: WhyCodeSchema,
  needs: z.array(NeedSchema).max(14).optional(),
  date: DateSchema.optional(),
});
export const CautionSchema = z.strictObject({ code: CautionCodeSchema, days: count.optional() });
export const MatchSchema = z.strictObject({
  resource: ResourceIdSchema,
  score: z.number().int().min(0).max(100),
  parts: z.strictObject({ fit: share, reach: share, timing: share }),
  path: MatchPathSchema,
  nextDeadline: DateSchema.nullable(),
  why: z.array(WhySchema).max(8),
  cautions: z.array(CautionSchema).max(CAUTION_CODES.length),
});

export const DraftKindSchema = z.enum(["impact_post", "funder_letter"]);
export const DraftSourceSchema = z.enum(["ai", "template"]);
export const DraftFlagSchema = z.enum(["ai_off", "ai_failed", "guard_rejected"]);
export const GUARD_REASONS = [
  "number",
  "percent",
  "number_word",
  "quote",
  "story",
  "link",
  "status_claim",
  "too_long",
  "empty",
] as const;
export const GuardReasonSchema = z.enum(GUARD_REASONS);
export const DraftStatusSchema = z.enum(["writing", "ready", "approved"]);
export const FactKeySchema = z.enum([
  "org",
  "month",
  "new",
  "helped",
  "unmet",
  "hours",
  "in_kind",
  "funder",
  "window",
  "horizon",
  "needs",
  "forecast_jobs",
  "forecast_hours",
  "amount",
  "deadline",
]);
export const DraftFactSchema = z.strictObject({
  key: FactKeySchema,
  label: z.string().min(1).max(80),
  text: z.string().min(1).max(200),
});
export const DraftFactsSchema = z.strictObject({
  kind: DraftKindSchema,
  month: MonthSchema,
  resource: ResourceIdSchema.nullable(),
  facts: z.array(DraftFactSchema).min(1).max(20),
  claims: z.strictObject({ c3: z.boolean(), sponsor: z.boolean() }),
  footer: z.string().min(1).max(300),
});
export const DraftTextSchema = z.string().min(1).max(DRAFT_TEXT_MAX);
export const DraftViewSchema = z.strictObject({
  id: DraftIdSchema,
  kind: DraftKindSchema,
  month: MonthSchema,
  resource: ResourceIdSchema.nullable(),
  status: DraftStatusSchema,
  source: DraftSourceSchema.nullable(),
  flag: DraftFlagSchema.nullable(),
  reasons: z.array(GuardReasonSchema).max(GUARD_REASONS.length),
  facts: z.array(DraftFactSchema).max(20),
  text: DraftTextSchema.nullable(),
  textHash: HashSchema.nullable(),
  createdAt: TimeSchema,
  approvedAt: TimeSchema.nullable(),
  approvedBy: z.strictObject({ member: MemberIdSchema, name: z.string().min(1).max(80) }).nullable(),
});

export const DraftAskSchema = z
  .strictObject({
    draft: DraftIdSchema,
    kind: DraftKindSchema,
    month: MonthSchema,
    resource: ResourceIdSchema.nullable(),
  })
  .refine((a) => (a.kind === "funder_letter") === (a.resource !== null), {
    message: "A funder letter names one resource, and an impact post names none.",
  });
export const DraftApproveSchema = z.strictObject({ draft: DraftIdSchema });

export const ResourcesViewSchema = z.strictObject({
  today: DateSchema,
  month: MonthSchema,
  demo: z.boolean(),
  catalog: z.strictObject({ version: z.string().min(1), checked: DateSchema }),
  needs: z.array(z.strictObject({ need: NeedSchema, label: z.string().min(1).max(60) })).max(40),
  resources: z.array(ResourceSchema).max(60),
  sponsors: z.array(SponsorSchema).max(10),
  forecast: ForecastSchema,
  matches: z.array(MatchSchema).max(60),
  readiness: ReadinessSchema,
  costs: z.array(CostEntrySchema).max(40),
  drafts: z.array(DraftViewSchema).max(DRAFT_LIST_MAX),
  draftMonths: z.array(MonthSchema).min(1).max(3),
  drafting: z.strictObject({ cap: count, usedToday: count }),
});

export type ResourceId = z.infer<typeof ResourceIdSchema>;
export type ResourceKind = z.infer<typeof ResourceKindSchema>;
export type SourceQuality = z.infer<typeof SourceQualitySchema>;
export type ResourceStatus = z.infer<typeof ResourceStatusSchema>;
export type StaticCaution = z.infer<typeof StaticCautionSchema>;
export type CautionCode = z.infer<typeof CautionCodeSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type Sponsor = z.infer<typeof SponsorSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;
export type Readiness = z.infer<typeof ReadinessSchema>;
export type ReadinessItem = z.infer<typeof ReadinessItemSchema>;
export type ReadinessSet = z.infer<typeof ReadinessSetSchema>;
export type CostBasis = z.infer<typeof CostBasisSchema>;
export type CostEntry = z.infer<typeof CostEntrySchema>;
export type CostSet = z.infer<typeof CostSetSchema>;
export type Range = z.infer<typeof RangeSchema>;
export type SeasonRule = z.infer<typeof SeasonRuleSchema>;
export type ForecastMonth = z.infer<typeof ForecastMonthSchema>;
export type NeedForecast = z.infer<typeof NeedForecastSchema>;
export type Forecast = z.infer<typeof ForecastSchema>;
export type ReadyForecast = Extract<Forecast, { status: "ready" }>;
export type MatchPath = z.infer<typeof MatchPathSchema>;
export type WhyCode = z.infer<typeof WhyCodeSchema>;
export type Why = z.infer<typeof WhySchema>;
export type Caution = z.infer<typeof CautionSchema>;
export type Match = z.infer<typeof MatchSchema>;
export type DraftKind = z.infer<typeof DraftKindSchema>;
export type DraftSource = z.infer<typeof DraftSourceSchema>;
export type DraftFlag = z.infer<typeof DraftFlagSchema>;
export type GuardReason = z.infer<typeof GuardReasonSchema>;
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
export type FactKey = z.infer<typeof FactKeySchema>;
export type DraftFact = z.infer<typeof DraftFactSchema>;
export type DraftFacts = z.infer<typeof DraftFactsSchema>;
export type DraftView = z.infer<typeof DraftViewSchema>;
export type DraftAsk = z.infer<typeof DraftAskSchema>;
export type DraftApprove = z.infer<typeof DraftApproveSchema>;
export type ResourcesView = z.infer<typeof ResourcesViewSchema>;
