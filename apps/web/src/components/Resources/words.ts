import type {
  Caution,
  CautionCode,
  CostBasis,
  DraftFlag,
  DraftKind,
  DraftStatus,
  GuardReason,
  MatchPath,
  Readiness,
  ReadinessItem,
  Resource,
  ResourceKind,
  SourceQuality,
  Why,
  WhyCode,
} from "@vision/contracts";
import { dateLabel } from "@vision/core";
import type { ChipState } from "../StateChip/StateChip.js";

export const CAUTION_WORDS: Record<CautionCode, string> = {
  closed: "Closed now",
  invitation_only: "By invitation only",
  partner_applies: "A partner must apply",
  needs_501c3: "Needs own 501(c)(3) status",
  needs_sponsor: "Needs a signed fiscal sponsor agreement",
  through_sponsor: "Through the fiscal sponsor",
  eligibility_not_stated: "Eligibility not stated. Ask first.",
  federal_uei: "Federal money: needs a UEI on SAM.gov",
  dfi_check: "Check the Wisconsin DFI registration first",
  deadline_soon: "Deadline soon",
  no_open_deadline: "No open deadline now",
  resident_group_only: "Resident groups only, not a business or a nonprofit",
  no_stipends: "No stipends or gifts to people",
  match_required: "A match is required",
  no_equipment: "No tools or equipment",
  no_business_account: "Will not pay into a business bank account",
  board_rules: "Board rules apply to the applicant",
  one_grant_a_year: "One grant a year",
  area_limited: "Only some neighbourhoods",
  not_free: "Not free",
  platform_fees: "Fees depend on the settings",
  funding_uncertain: "Funding is not certain",
  ask_contact_first: "Ask a known contact first",
  amount_unverified: "Amount not checked",
  activity_unconfirmed: "Current activity not confirmed",
  conflicting_source: "The sources do not agree",
  single_source: "One source only",
  old_source: "Old source",
  search_summary: "Search summary only",
  secondary_source: "Third-party source",
  check_before_apply: "Check the source page again before you apply",
};

const daysWords = (days: number): string => {
  if (days === 0) return "Deadline today";
  if (days === 1) return "Deadline in 1 day";
  return `Deadline in ${String(days)} days`;
};

export const cautionWords = (c: Caution): string =>
  c.code === "deadline_soon" && c.days !== undefined ? daysWords(c.days) : CAUTION_WORDS[c.code];

const WHOLE = new Intl.NumberFormat("en-US");
const DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export const countText = (n: number): string => WHOLE.format(n);
export const dollarsText = (cents: number): string => DOLLARS.format(Math.round(cents / 100));
export const centsText = (cents: number): string => CENTS.format(cents / 100);
const wholeDollars = (dollars: number): string => `$${countText(dollars)}`;

const amountWords = (resource: Resource): string => {
  const amount = resource.amount;
  if (amount === null) return "";
  if (amount.min === null) return `Up to ${wholeDollars(amount.max)}`;
  return `${wholeDollars(amount.min)} to ${wholeDollars(amount.max)}`;
};

type WhyContext = { labels: ReadonlyMap<string, string>; resource: Resource };

const WHY_WORDS: Record<WhyCode, (w: Why, ctx: WhyContext) => string> = {
  fits_needs: (w, { labels }) => `Fits ${(w.needs ?? []).map((n) => labels.get(n) ?? n).join(", ")}`,
  general_support: () => "General support",
  resident_group_ok: () => "A resident group can apply",
  sponsor_ok: () => "Takes a fiscal sponsor",
  rolling: () => "Rolling",
  deadline: (w) => (w.date === undefined ? "Next deadline" : `Next deadline ${dateLabel(w.date)}`),
  amount: (_w, { resource }) => amountWords(resource),
  in_kind: (_w, { resource }) => resource.inKind ?? "",
};

export const whyWords = (w: Why, labels: ReadonlyMap<string, string>, resource: Resource): string =>
  WHY_WORDS[w.code](w, { labels, resource });

export const PATH_WORDS: Record<MatchPath, string> = {
  direct: "Apply directly",
  via_sponsor: "Through a fiscal sponsor",
  needs_501c3: "Needs own 501(c)(3)",
  partner_applies: "A partner applies",
  invitation_only: "By invitation",
  ask_first: "Ask first",
  closed: "Closed",
};

export const KIND_WORDS: Record<ResourceKind, string> = {
  grant: "Grant",
  people: "People and crowdfunding",
  company: "Company",
  goods_skills: "Goods, space and skills",
};

export const QUALITY_WORDS: Record<SourceQuality, string> = {
  opened: "Opened page",
  search_summary: "Search summary",
  secondary: "Third-party source",
  old: "Old source",
};

export const sourceWords = (resource: Resource): string =>
  `${QUALITY_WORDS[resource.source.quality]}, checked ${dateLabel(resource.source.checked)}`;

type ReadinessWords<K extends ReadinessItem> = {
  label: string;
  reason: string;
  states: Record<Readiness[K], string>;
};

export const READINESS_ITEMS: readonly ReadinessItem[] = ["sponsor", "dfi", "c3", "uei"];

export const READINESS_WORDS: { [K in ReadinessItem]: ReadinessWords<K> } = {
  sponsor: {
    label: "Fiscal sponsor agreement",
    reason: "Most grants and online giving need a 501(c)(3). A sponsor lends its status for a fee.",
    states: { none: "Not started", talking: "Talking", signed: "Signed" },
  },
  dfi: {
    label: "Wisconsin DFI charitable registration",
    reason: "A charity registers before it asks the public in Wisconsin for money, unless it is exempt.",
    states: {
      not_checked: "Not checked",
      exempt_confirmed: "DFI confirmed the exemption",
      registered: "Registered",
    },
  },
  c3: {
    label: "Own 501(c)(3) status, later",
    reason: "Tax receipts and many foundations need it.",
    states: { no: "No", applied: "Applied", yes: "Yes" },
  },
  uei: {
    label: "SAM.gov and a UEI, for federal money only",
    reason: "A federal grant needs a UEI, renewed each year.",
    states: { not_needed: "Not needed", needed: "Needed", active: "Active" },
  },
};

export const DRAFT_KIND_WORDS: Record<DraftKind, string> = {
  impact_post: "Impact post",
  funder_letter: "Funder letter",
};

export const DRAFT_STATUS_CHIPS: Record<DraftStatus, ChipState> = {
  writing: { label: "Writing the draft", mark: "hourglass", tone: "grey" },
  ready: { label: "Ready to approve", mark: "hollow_circle", tone: "strong" },
  approved: { label: "Approved", mark: "filled_check", tone: "ok" },
};

export const COST_CHIPS: Record<CostBasis, ChipState> = {
  estimate: { label: "Estimate", mark: "half_circle", tone: "grey" },
  receipts: { label: "From receipts", mark: "filled_check", tone: "ok" },
};

export const FLAG_WORDS: Record<DraftFlag, string> = {
  ai_off: "AI is off, so this is the fixed template.",
  ai_failed: "AI did not answer, so this is the fixed template.",
  guard_rejected: "The draft guard stopped the AI text, so this is the fixed template.",
};

export const AI_WORDS = "AI wrote this draft from the facts. The draft guard checked it.";

export const TEMPLATE_WORDS = "This is the fixed template.";

export const REASON_WORDS: Record<GuardReason, string> = {
  number: "a number that is not a fact",
  percent: "a percent",
  number_word: "a number in words",
  quote: "a quotation mark",
  story: "a quote or a story about a person",
  link: "a link or an email address",
  status_claim: "a claim of tax or sponsor status",
  too_long: "text that is too long",
  empty: "text that is too short",
};

export const reasonsWords = (reasons: readonly GuardReason[]): string => {
  const words = reasons.map((r) => REASON_WORDS[r]);
  const last = words.pop();
  if (last === undefined) return "";
  return `It found ${words.length === 0 ? last : `${words.join(", ")} and ${last}`}.`;
};

export const METHOD_NOTE =
  "Code makes this forecast from the record. It uses no AI. Volunteer time counts at $34.67 an hour as " +
  "in-kind value, never as cash. Cash needs a unit cost from ComForce.";

export const NO_AI_NOTICE = "Code makes the forecast and the match. It uses no AI.";

export const NEVER_SENDS = "Vision never sends or posts. Copy an approved draft and send it yourself.";
