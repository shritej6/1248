import { z } from "zod";
import {
  ActorRoleSchema,
  ActorSchema,
  CardIdSchema,
  DateSchema,
  DraftIdSchema,
  HashSchema,
  JobIdSchema,
  MemberIdSchema,
  PageIdSchema,
  PartnerIdSchema,
  TimeSchema,
  ZipSchema,
} from "./ids.js";
import {
  AiJobKeySchema,
  AiOutcomeSchema,
  DivisionSchema,
  DoorSchema,
  FlagSchema,
  JobFlagSchema,
  LangSchema,
  LevelSchema,
  LinkAnswerSchema,
  LinkScoreSchema,
  NeedSchema,
  OutcomeSchema,
  ServiceSchema,
  UrgencySchema,
} from "./needs.js";
import type { Rejection } from "./errors.js";
import { MonthSchema } from "./statement.js";
import {
  DraftFlagSchema,
  DraftKindSchema,
  DraftSourceSchema,
  DraftTextSchema,
  GuardReasonSchema,
  ResourceIdSchema,
} from "./resources.js";
import {
  TemplateIdSchema,
  type Config,
  type MemberPublic,
  type Playbook,
  type ZipCentres,
} from "./playbook.js";

const none = z.strictObject({});
const member = z.strictObject({ member: MemberIdSchema });
const partner = z.strictObject({ partner: PartnerIdSchema });
const flag = z.strictObject({ flag: JobFlagSchema });
const count = z.number().int().nonnegative();
const step = z.number().int().nonnegative();
const pageReason = z.enum(["high", "flag_timeout", "help", "sorter_down_hit"]);
const rungReason = z.enum(["no", "wait", "silence", "desk"]);

export const eventData = {
  "card.received": z.strictObject({
    door: DoorSchema,
    zip: ZipSchema.nullable(),
    safeContact: z.boolean(),
    lang: LangSchema.optional(),
  }),
  "card.sorted": z.strictObject({
    source: z.enum(["ai", "none"]),
    service: ServiceSchema.nullable(),
    division: DivisionSchema.nullable(),
    urgency: UrgencySchema.nullable(),
    flags: z.array(FlagSchema),
  }),
  "card.confirmed": z.strictObject({
    need: NeedSchema,
    urgency: UrgencySchema,
    division: DivisionSchema.nullable(),
    level: LevelSchema,
    quiet: z.boolean(),
    routeCode: z.string().min(1).max(20),
    changed: z.boolean(),
  }),
  "card.raised": z.strictObject({ to: z.literal("high") }),
  "receipt.sent": z.strictObject({ promiseAt: TimeSchema }),
  "page.sent": z.strictObject({ page: PageIdSchema, to: MemberIdSchema, reason: pageReason, step }),
  "page.moved": z.strictObject({ page: PageIdSchema, to: MemberIdSchema, step }),
  "page.answered": z.strictObject({ page: PageIdSchema, by: MemberIdSchema }),
  "job.planned": z.strictObject({
    need: NeedSchema,
    path: z.enum(["volunteers", "partner", "unmet"]),
    rung: step,
    level: LevelSchema,
    quiet: z.boolean(),
    promiseAt: TimeSchema,
  }),
  "job.approved": none,
  "offer.wave_sent": z.strictObject({ wave: z.number().int().positive(), count }),
  "offer.accepted": member,
  "offer.closed": z.strictObject({ reason: z.enum(["taken", "no_volunteer"]) }),
  "job.returned": z.strictObject({
    reason: z.enum(["no_volunteer", "claim_expired", "not_done", "hand_off"]),
  }),
  "job.on_my_way": member,
  "job.there": member,
  "job.done": z.strictObject({ member: MemberIdSchema, outcome: OutcomeSchema }),
  "job.help": member,
  "job.rung_moved": z.strictObject({ from: step, to: step, reason: rungReason }),
  "consent.asked": partner,
  "consent.answered": z.strictObject({ answer: z.enum(["yes", "no"]) }),
  "partner.asked": partner,
  "partner.answered": z.strictObject({
    partner: PartnerIdSchema,
    answer: z.enum(["yes", "no", "wait"]),
    waitUntil: TimeSchema.optional(),
  }),
  "promise.accepted": partner,
  "job.got_it": z.strictObject({ partner: PartnerIdSchema, date: DateSchema }),
  "job.unmet": none,
  "checkback.sent": z.strictObject({ try: z.literal([1, 2, 3]) }),
  "checkback.answered": z.strictObject({ answer: z.literal([1, 2, 3]) }),
  "job.reopened": z.strictObject({ as: z.enum(["mismatch", "partly"]), exclude: MemberIdSchema.nullable() }),
  "job.closed": z.strictObject({
    result: z.enum(["helped", "unreached", "withdrawn"]),
    reason: z.enum(["cancelled", "duplicate"]).nullable(),
  }),
  "job.flagged": flag,
  "job.flag_cleared": flag,
  "thread.posted": z.strictObject({ byRole: ActorRoleSchema }),
  "shift.taken": member,
  "playbook.loaded": z.strictObject({ version: z.string().min(1), rows: count }),
  "need.level_set": z.strictObject({ need: NeedSchema, level: LevelSchema }),
  "levels.master_set": z.strictObject({ on: z.boolean() }),
  "clock.jumped": z.strictObject({ byMs: z.number().int().positive() }),
  "vault.erased": z.strictObject({ due: TimeSchema, erased: count }),
  "card.lang_set": z.strictObject({ lang: LangSchema }),
  "card.gist_typed": none,
  "ai.asked": z.strictObject({ job: AiJobKeySchema }),
  "ai.done": z.strictObject({ job: AiJobKeySchema, outcome: AiOutcomeSchema }),
  "link.proposed": z.strictObject({ other: CardIdSchema, score: LinkScoreSchema }),
  "link.answered": z.strictObject({ other: CardIdSchema, answer: LinkAnswerSchema }),
  "draft.asked": z.strictObject({
    draft: DraftIdSchema,
    kind: DraftKindSchema,
    month: MonthSchema,
    resource: ResourceIdSchema.nullable(),
    by: MemberIdSchema,
  }),
  "draft.done": z.strictObject({
    draft: DraftIdSchema,
    source: DraftSourceSchema,
    flag: DraftFlagSchema.nullable(),
    textHash: HashSchema,
  }),
  "draft.approved": z.strictObject({ draft: DraftIdSchema, textHash: HashSchema, by: MemberIdSchema }),
} as const;

export type EventType = keyof typeof eventData;
export const EVENT_TYPES = Object.keys(eventData) as EventType[];
export const EventTypeSchema = z.enum(EVENT_TYPES as [EventType, ...EventType[]]);

const draftBase = { card: CardIdSchema.nullable(), job: JobIdSchema.nullable(), actor: ActorSchema };
const lineBase = {
  ...draftBase,
  seq: z.number().int().positive(),
  at: TimeSchema,
  prev: HashSchema,
  hash: HashSchema,
};

type DraftBase = { card: string | null; job: string | null; actor: z.infer<typeof ActorSchema> };
type LineBase = DraftBase & { seq: number; at: number; prev: string; hash: string };
type Typed<B> = { [K in EventType]: B & { type: K; data: z.infer<(typeof eventData)[K]> } }[EventType];

export type EventDraft = Typed<DraftBase>;
export type LedgerEvent = Typed<LineBase>;
export type EventDataOf<K extends EventType> = z.infer<(typeof eventData)[K]>;

const unionOf = <T>(base: z.ZodRawShape): z.ZodType<T> => {
  const options = EVENT_TYPES.map((type) =>
    z.strictObject({ ...base, type: z.literal(type), data: eventData[type] }),
  );
  return z.discriminatedUnion(
    "type",
    options as [(typeof options)[number], ...typeof options],
  ) as unknown as z.ZodType<T>;
};

export const EventDraftSchema = unionOf<EventDraft>(draftBase);
export const LedgerEventSchema = unionOf<LedgerEvent>(lineBase);

export const EffectSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("vault.person"),
    card: CardIdSchema,
    firstName: z.string(),
    contact: z.string(),
    address: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("vault.text"),
    card: CardIdSchema,
    job: JobIdSchema.nullable(),
    textKind: z.enum(["message_in", "quote", "note", "contact_name", "partner_reason", "translation"]),
    text: z.string(),
  }),
  z.strictObject({
    kind: z.literal("message"),
    to: z.enum(["resident", "partner"]),
    card: CardIdSchema,
    job: JobIdSchema.nullable(),
    partner: PartnerIdSchema.nullable(),
    template: TemplateIdSchema,
    slots: z.record(z.string(), z.string()),
  }),
  z.strictObject({ kind: z.literal("sort"), card: CardIdSchema }),
  z.strictObject({ kind: z.literal("ai"), job: AiJobKeySchema, card: CardIdSchema }),
  z.strictObject({ kind: z.literal("offer"), job: JobIdSchema, members: z.array(MemberIdSchema) }),
  z.strictObject({
    kind: z.literal("offer_closed"),
    job: JobIdSchema,
    members: z.array(MemberIdSchema),
    reason: z.enum(["taken", "expired"]),
  }),
  z.strictObject({ kind: z.literal("pass"), job: JobIdSchema, member: MemberIdSchema }),
  z.strictObject({ kind: z.literal("page"), page: PageIdSchema, member: MemberIdSchema }),
  z.strictObject({ kind: z.literal("partner_link"), job: JobIdSchema, partner: PartnerIdSchema }),
  z.strictObject({ kind: z.literal("draft"), draft: DraftIdSchema }),
  z.strictObject({
    kind: z.literal("draft.text"),
    draft: DraftIdSchema,
    text: DraftTextSchema,
    textHash: HashSchema,
    source: DraftSourceSchema,
    flag: DraftFlagSchema.nullable(),
    reasons: z.array(GuardReasonSchema).max(9),
  }),
]);

export type Effect = z.infer<typeof EffectSchema>;
export type Decision =
  { ok: true; events: EventDraft[]; effects: Effect[] } | { ok: false; rejection: Rejection };
export type Hasher = (text: string) => string;
export type DecideContext = {
  now: number;
  newId: (prefix: string) => string;
  playbook: Playbook;
  members: MemberPublic[];
  offered: Record<string, string[]>;
  zips: ZipCentres;
  config: Config;
};
