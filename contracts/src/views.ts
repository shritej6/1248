import { z } from "zod";
import {
  CardIdSchema,
  JobIdSchema,
  MemberIdSchema,
  PageIdSchema,
  PartnerIdSchema,
  TimeSchema,
  ZipSchema,
} from "./ids.js";
import {
  AiStatusSchema,
  DoorSchema,
  FlagSchema,
  JobFlagSchema,
  JobStatusSchema,
  LangSchema,
  LevelSchema,
  LinkAnswerSchema,
  LinkScoreSchema,
  NeedSchema,
  UrgencySchema,
} from "./needs.js";
import { MemberRecordSchema, PartnerRecordSchema, PlaybookSchema } from "./playbook.js";

export const HolderSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("desk"), member: MemberIdSchema.nullable() }),
  z.strictObject({ kind: z.literal("volunteer"), member: MemberIdSchema }),
  z.strictObject({ kind: z.literal("partner"), partner: PartnerIdSchema }),
  z.strictObject({ kind: z.literal("owner"), member: MemberIdSchema }),
  z.strictObject({ kind: z.literal("lead"), member: MemberIdSchema.nullable() }),
  z.strictObject({ kind: z.literal("none") }),
]);
export const HolderKindSchema = z.enum(["desk", "volunteer", "partner", "owner", "lead", "none"]);

export const OrgNameSchema = z.string().min(1).max(80);
export const OrgAboutSchema = z.strictObject({ orgName: OrgNameSchema });

export const ClockViewSchema = z.strictObject({ now: TimeSchema, offsetMs: z.number().int().nonnegative() });

export const OfferViewSchema = z.strictObject({
  job: JobIdSchema,
  needLabel: z.string(),
  distanceMiles: z.number().nonnegative().nullable(),
  promiseAt: TimeSchema,
  bring: z.string().nullable(),
  crew: z.number().int().min(1),
});

export const VolunteerHomeSchema = z.strictObject({
  member: z.strictObject({
    id: MemberIdSchema,
    name: z.string(),
    on: z.boolean(),
    skills: z.array(z.string()),
    zip: ZipSchema.nullable(),
  }),
  offers: z.array(OfferViewSchema),
  jobs: z.array(z.strictObject({ job: JobIdSchema, needLabel: z.string(), status: JobStatusSchema })),
  record: z.strictObject({ jobsDone: z.number().int().nonnegative(), hours: z.number().nonnegative() }),
  clock: ClockViewSchema,
});

export const ThreadLineSchema = z.strictObject({
  at: TimeSchema,
  from: z.enum(["resident", "desk", "volunteer", "partner", "system"]),
  text: z.string(),
});

export const JobActionSchema = z.enum(["on_my_way", "there", "done", "help", "hand_off"]);

export const JobCardSchema = z.strictObject({
  job: JobIdSchema,
  routeCode: z.string(),
  needLabel: z.string(),
  status: JobStatusSchema,
  firstName: z.string(),
  address: z.string().nullable(),
  words: z.string(),
  promiseAt: TimeSchema,
  accessNotes: z.string().nullable(),
  actions: z.array(JobActionSchema),
  thread: z.array(ThreadLineSchema),
  clock: ClockViewSchema,
  promiseFrom: TimeSchema.optional(),
  steps: z.array(z.strictObject({ status: JobStatusSchema, at: TimeSchema })).optional(),
});

export const DeskAiSchema = z.strictObject({
  voice: AiStatusSchema.optional(),
  link: AiStatusSchema.optional(),
  lang: AiStatusSchema.optional(),
});

export const DeskLinkSchema = z.strictObject({
  other: CardIdSchema,
  score: LinkScoreSchema,
  answer: LinkAnswerSchema.nullable(),
  otherZip: ZipSchema.nullable(),
  otherReceivedAt: TimeSchema,
  otherUrgency: UrgencySchema.nullable(),
});

export const EventGroupSchema = z.strictObject({
  cards: z.array(CardIdSchema).min(2),
  highest: UrgencySchema.nullable(),
});

export const DeskCardSchema = z.strictObject({
  card: CardIdSchema,
  receivedAt: TimeSchema,
  door: DoorSchema,
  zip: ZipSchema.nullable(),
  message: z.string(),
  quotes: z.array(z.string()),
  sorted: z
    .strictObject({
      service: z.string().nullable(),
      division: z.string().nullable(),
      urgency: UrgencySchema.nullable(),
      source: z.enum(["ai", "none"]),
    })
    .nullable(),
  flags: z.array(FlagSchema),
  needOptions: z.array(z.strictObject({ need: NeedSchema, label: z.string() })),
  suggestedNeed: NeedSchema.nullable(),
  quiet: z.boolean(),
  lang: LangSchema.optional(),
  ai: DeskAiSchema.optional(),
  translation: z.string().nullable().optional(),
  links: z.array(DeskLinkSchema).optional(),
});

export const DeskJobSchema = z.strictObject({
  job: JobIdSchema,
  card: CardIdSchema,
  routeCode: z.string(),
  needLabel: z.string(),
  status: JobStatusSchema,
  holder: z.strictObject({ kind: HolderKindSchema, name: z.string().nullable() }),
  clock: z.strictObject({ label: z.string(), dueAt: TimeSchema }).nullable(),
  flags: z.array(JobFlagSchema),
  returnReason: z.string().nullable(),
  mismatch: z.boolean(),
  promiseLate: z.boolean(),
  partnerLink: z.string().nullable(),
  partnerAnswer: z
    .strictObject({
      partnerName: z.string(),
      answer: z.enum(["yes", "no", "wait"]),
      reason: z.string().nullable(),
      waitUntil: TimeSchema.nullable(),
    })
    .nullable()
    .optional(),
});

export const PageViewSchema = z.strictObject({
  page: PageIdSchema,
  card: CardIdSchema,
  reason: z.string(),
  sentAt: TimeSchema,
  to: z.string(),
});

export const FailedSendSchema = z.strictObject({
  kind: z.string(),
  card: CardIdSchema.nullable(),
  tries: z.number().int().nonnegative(),
  lastError: z.string(),
  at: TimeSchema,
});

export const DeskVolunteerSchema = z.strictObject({
  member: MemberIdSchema,
  name: z.string(),
  skills: z.array(z.string()),
  zone: ZipSchema.nullable(),
  on: z.boolean(),
  openJobs: z.number().int().nonnegative(),
});

export const DeskBoardSchema = z.strictObject({
  onShift: z.strictObject({ member: MemberIdSchema, name: z.string() }).nullable(),
  emergency: z.array(DeskCardSchema),
  triage: z.array(DeskCardSchema),
  jobs: z.array(DeskJobSchema),
  pages: z.array(PageViewSchema),
  quietCount: z.number().int().nonnegative(),
  needOptions: z.array(z.strictObject({ need: NeedSchema, label: z.string() })).optional(),
  volunteers: z.array(DeskVolunteerSchema),
  clock: ClockViewSchema,
  failedSends: z.array(FailedSendSchema).optional(),
  orgName: OrgNameSchema.optional(),
  eventGroups: z.array(EventGroupSchema).optional(),
});

export const TrackingSchema = z.strictObject({
  routeCode: z.string().nullable(),
  closed: z.boolean(),
  steps: z.array(z.strictObject({ word: z.string(), at: TimeSchema })),
  messages: z.array(z.strictObject({ at: TimeSchema, text: z.string() })),
  consentAsk: z.strictObject({ job: JobIdSchema, partnerName: z.string(), needLabel: z.string() }).nullable(),
  checkbackAsk: z.strictObject({ job: JobIdSchema, needLabel: z.string() }).nullable(),
  forgetAt: TimeSchema.nullable(),
  clock: ClockViewSchema,
  orgName: OrgNameSchema.optional(),
  lang: LangSchema.optional(),
});

const count = z.number().int().nonnegative();

export const PartnerCardSchema = z.strictObject({
  partner: z.strictObject({ id: PartnerIdSchema, name: z.string() }),
  routeCode: z.string().nullable(),
  state: z.enum(["ask", "promise", "note", "result", "closed"]),
  ask: z
    .strictObject({
      job: JobIdSchema,
      needLabel: z.string(),
      zip: ZipSchema.nullable(),
      deadline: TimeSchema,
    })
    .nullable(),
  note: z
    .strictObject({
      job: JobIdSchema,
      gotIt: z.boolean(),
      firstName: z.string(),
      zip: ZipSchema.nullable(),
      needLabel: z.string(),
      deadline: TimeSchema,
      contact: z.string(),
      tried: z.array(z.string()),
    })
    .nullable(),
  result: z
    .strictObject({
      status: JobStatusSchema,
      counts: z.strictObject({ asked: count, yes: count, gotIt: count, helped: count }),
    })
    .nullable(),
  closesAt: TimeSchema.nullable(),
  clock: ClockViewSchema,
  orgName: OrgNameSchema.optional(),
});

export const OrgViewSchema = z.strictObject({
  playbook: PlaybookSchema.nullable(),
  levels: z.strictObject({
    master: z.boolean(),
    needs: z.array(
      z.strictObject({
        need: NeedSchema,
        level: LevelSchema,
        clean: count,
        changed: count,
        canEarn: z.boolean(),
      }),
    ),
  }),
  members: z.array(MemberRecordSchema),
  partners: z.array(PartnerRecordSchema),
  unmet: z.array(DeskJobSchema),
  finish: z.array(DeskJobSchema.extend({ daysSinceTap: count })),
  demo: z.strictObject({ mode: z.boolean(), offsetMs: z.number().int().nonnegative() }),
  clock: ClockViewSchema,
  orgName: OrgNameSchema.optional(),
});

export type Holder = z.infer<typeof HolderSchema>;
export type ClockView = z.infer<typeof ClockViewSchema>;
export type OfferView = z.infer<typeof OfferViewSchema>;
export type VolunteerHome = z.infer<typeof VolunteerHomeSchema>;
export type ThreadLine = z.infer<typeof ThreadLineSchema>;
export type JobAction = z.infer<typeof JobActionSchema>;
export type JobCard = z.infer<typeof JobCardSchema>;
export type DeskCard = z.infer<typeof DeskCardSchema>;
export type DeskAi = z.infer<typeof DeskAiSchema>;
export type DeskLink = z.infer<typeof DeskLinkSchema>;
export type EventGroup = z.infer<typeof EventGroupSchema>;
export type DeskJob = z.infer<typeof DeskJobSchema>;
export type PageView = z.infer<typeof PageViewSchema>;
export type DeskVolunteer = z.infer<typeof DeskVolunteerSchema>;
export type DeskBoard = z.infer<typeof DeskBoardSchema>;
export type FailedSend = z.infer<typeof FailedSendSchema>;
export type Tracking = z.infer<typeof TrackingSchema>;
export type PartnerCard = z.infer<typeof PartnerCardSchema>;
export type OrgView = z.infer<typeof OrgViewSchema>;
export type OrgAbout = z.infer<typeof OrgAboutSchema>;
