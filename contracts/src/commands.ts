import { z } from "zod";
import { CallbackSchema } from "./ai.js";
import {
  CardIdSchema,
  CommandIdSchema,
  DateSchema,
  JobIdSchema,
  MemberIdSchema,
  PageIdSchema,
  RoleSchema,
  TimeSchema,
  ZipSchema,
} from "./ids.js";
import {
  AiOutcomeSchema,
  DivisionSchema,
  DoorSchema,
  JobFlagSchema,
  LangSchema,
  LevelSchema,
  LinkAnswerSchema,
  LinkScoreSchema,
  NeedSchema,
  OutcomeSchema,
  UrgencySchema,
} from "./needs.js";
import { PlaybookSchema } from "./playbook.js";

const cmd = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ id: CommandIdSchema, type: z.literal(type), ...shape });

const job = { job: JobIdSchema };
const note = z.string().min(1).max(500);
const answerLine = z
  .string()
  .min(1)
  .max(140)
  .regex(/^[^\p{Cc}]+$/u);

const deskCommands = [
  cmd("shift.take", {}),
  cmd("card.confirm", {
    card: CardIdSchema,
    need: NeedSchema,
    urgency: UrgencySchema,
    division: DivisionSchema.nullable(),
    zip: ZipSchema.optional(),
  }),
  cmd("card.raise", { card: CardIdSchema }),
  cmd("card.add_job", { card: CardIdSchema, need: NeedSchema }),
  cmd("page.answer", { page: PageIdSchema }),
  cmd("job.approve", job),
  cmd("job.offer_again", job),
  cmd("job.offer_to", { ...job, member: MemberIdSchema }),
  cmd("job.next_rung", job),
  cmd("job.tap_for", {
    ...job,
    member: MemberIdSchema,
    action: z.enum(["accept", "on_my_way", "there", "done"]),
    outcome: OutcomeSchema.optional(),
  }),
  cmd("job.withdraw", { ...job, reason: z.enum(["cancelled", "duplicate"]) }),
  cmd("job.clear_flag", { ...job, flag: JobFlagSchema }),
  cmd("thread.post", { card: CardIdSchema, text: note }),
  cmd("link.answer", { card: CardIdSchema, other: CardIdSchema, answer: LinkAnswerSchema }),
  cmd("voice.gist", { card: CardIdSchema, text: z.string().trim().min(1).max(2000) }),
] as const;

const volunteerCommands = [
  cmd("member.set_on", { on: z.boolean() }),
  cmd("offer.accept", job),
  cmd("offer.pass", job),
  cmd("job.on_my_way", job),
  cmd("job.there", job),
  cmd("job.done", { ...job, outcome: OutcomeSchema, note: note.optional() }),
  cmd("job.help", { ...job, note: note.optional() }),
  cmd("job.hand_off", { ...job, note }),
] as const;

const linkCommands = [
  cmd("consent.answer", { ...job, answer: z.enum(["yes", "no"]) }),
  cmd("checkback.answer", { ...job, answer: z.literal([1, 2, 3]) }),
  cmd("promise.accept", {}),
  cmd("ask.answer", {
    ...job,
    answer: z.enum(["yes", "no", "wait"]),
    reason: answerLine.optional(),
    waitUntil: TimeSchema.optional(),
  }),
  cmd("handover.got_it", { ...job, date: DateSchema, contactName: z.string().min(1).max(80) }),
] as const;

const organiserCommands = [
  cmd("playbook.load", { playbook: PlaybookSchema }),
  cmd("need.set_level", { need: NeedSchema, level: LevelSchema }),
  cmd("levels.master", { on: z.boolean() }),
  cmd("clock.jump", { minutes: z.literal([15, 60, 1440, 4320]) }),
] as const;

const adminCommands = [
  cmd("member.add", {
    name: z.string().min(1).max(80),
    contact: z.string().min(3).max(120),
    roles: z.array(RoleSchema).min(1),
    skills: z.array(z.string().regex(/^[a-z_]{2,20}$/)),
    zip: ZipSchema.nullable(),
  }),
  cmd("partner.add", { name: z.string().min(1).max(80), contact: z.string().min(3).max(120) }),
  cmd("join.create", { member: MemberIdSchema }),
] as const;

const coreCommands = [...deskCommands, ...volunteerCommands, ...linkCommands, ...organiserCommands] as const;

export const CoreCommandSchema = z.discriminatedUnion("type", coreCommands);
export const AdminCommandSchema = z.discriminatedUnion("type", adminCommands);
export const CommandSchema = z.discriminatedUnion("type", [...coreCommands, ...adminCommands]);
export const CommandTypeSchema = z.enum(
  [...coreCommands, ...adminCommands].map((c) => c.shape.type.value) as [CommandType, ...CommandType[]],
);

export const DeadlineKindSchema = z.enum([
  "desk_confirm",
  "page_answer",
  "wave",
  "claim",
  "visit",
  "consent",
  "partner_reply",
  "got_it",
  "checkback",
  "checkback_reply",
]);
export const DeadlineSchema = z.strictObject({
  kind: DeadlineKindSchema,
  at: TimeSchema,
  card: CardIdSchema,
  job: JobIdSchema.nullable(),
  page: PageIdSchema.nullable(),
  step: z.number().int().nonnegative(),
});

export const RequestSubmitSchema = z.strictObject({
  type: z.literal("request.submit"),
  card: CardIdSchema,
  door: DoorSchema,
  zip: ZipSchema.nullable(),
  safeContact: z.boolean(),
  firstName: z.string().min(1).max(40),
  contact: z.string().min(3).max(120),
  address: z.string().max(200).nullable(),
  message: z.string().min(1).max(2000),
  lang: LangSchema.optional(),
});
export const SortPassSchema = z.strictObject({
  service: z.string(),
  division: z.string(),
  urgency: UrgencySchema,
  words: z.string(),
  reason: z.string(),
});
export const SortResultSchema = z.strictObject({
  type: z.literal("sort.result"),
  card: CardIdSchema,
  message: z.string(),
  passes: z.array(SortPassSchema).nullable(),
  error: z.enum(["off", "ai_down"]).nullable(),
});
export const TimerFiredSchema = z.strictObject({ type: z.literal("timer.fired"), deadline: DeadlineSchema });
export const VaultErasedSchema = z.strictObject({
  type: z.literal("vault.erased"),
  due: TimeSchema,
  erased: z.number().int().nonnegative(),
});
const machineText = z.string().max(4000).nullable();
export const VoiceReceivedSchema = z.strictObject({
  type: z.literal("voice.received"),
  card: CardIdSchema,
  zip: ZipSchema.nullable(),
  callback: CallbackSchema.nullable(),
});
export const VoiceResultSchema = z.strictObject({
  type: z.literal("voice.result"),
  card: CardIdSchema,
  outcome: AiOutcomeSchema,
  text: machineText,
});
export const LinkResultSchema = z.strictObject({
  type: z.literal("link.result"),
  card: CardIdSchema,
  outcome: AiOutcomeSchema,
  matches: z.array(z.strictObject({ other: CardIdSchema, score: LinkScoreSchema })).max(20),
});
export const LangResultSchema = z.strictObject({
  type: z.literal("lang.result"),
  card: CardIdSchema,
  outcome: AiOutcomeSchema,
  text: machineText,
});
export const SystemCommandSchema = z.discriminatedUnion("type", [
  RequestSubmitSchema,
  SortResultSchema,
  TimerFiredSchema,
  VaultErasedSchema,
  VoiceReceivedSchema,
  VoiceResultSchema,
  LinkResultSchema,
  LangResultSchema,
]);

export const RequestFormSchema = z.strictObject({
  firstName: z.string().trim().min(1).max(40),
  contactKind: z.enum(["email", "phone"]),
  contact: z.string().trim().min(3).max(120),
  zip: ZipSchema,
  message: z.string().trim().min(1).max(2000),
  address: z.string().trim().max(200),
  safeContact: z.boolean(),
  website: z.literal(""),
  lang: LangSchema.optional(),
});

export type RequestSubmit = z.infer<typeof RequestSubmitSchema>;
export type SortPass = z.infer<typeof SortPassSchema>;
export type SortResult = z.infer<typeof SortResultSchema>;
export type TimerFired = z.infer<typeof TimerFiredSchema>;
export type VaultErased = z.infer<typeof VaultErasedSchema>;
export type VoiceReceived = z.infer<typeof VoiceReceivedSchema>;
export type VoiceResult = z.infer<typeof VoiceResultSchema>;
export type LinkResult = z.infer<typeof LinkResultSchema>;
export type LangResult = z.infer<typeof LangResultSchema>;
export type SystemCommand = z.infer<typeof SystemCommandSchema>;
export type RequestForm = z.infer<typeof RequestFormSchema>;
export type CoreCommand = z.infer<typeof CoreCommandSchema>;
export type AdminCommand = z.infer<typeof AdminCommandSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command["type"];
export type DeadlineKind = z.infer<typeof DeadlineKindSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;

export const SenderSchema = z.enum(["desk", "volunteer", "organiser", "lead", "resident", "partner"]);
export type Sender = z.infer<typeof SenderSchema>;

const deskLead: Sender[] = ["desk", "lead"];
const deskLeadOrganiser: Sender[] = ["desk", "lead", "organiser"];
const anyMember: Sender[] = ["desk", "volunteer", "organiser", "lead"];

export const commandRoles: Record<CommandType, Sender[]> = {
  "shift.take": deskLead,
  "card.confirm": deskLead,
  "card.raise": deskLead,
  "card.add_job": deskLead,
  "page.answer": anyMember,
  "job.approve": deskLeadOrganiser,
  "job.offer_again": deskLead,
  "job.offer_to": deskLead,
  "job.next_rung": deskLead,
  "job.tap_for": deskLead,
  "job.withdraw": deskLeadOrganiser,
  "job.clear_flag": deskLead,
  "thread.post": ["desk", "lead", "volunteer"],
  "link.answer": deskLead,
  "voice.gist": deskLead,
  "member.set_on": ["volunteer"],
  "offer.accept": ["volunteer"],
  "offer.pass": ["volunteer"],
  "job.on_my_way": ["volunteer"],
  "job.there": ["volunteer"],
  "job.done": ["volunteer"],
  "job.help": ["volunteer"],
  "job.hand_off": ["volunteer"],
  "consent.answer": ["resident", "desk", "lead"],
  "checkback.answer": ["resident", "desk", "lead"],
  "promise.accept": ["partner"],
  "ask.answer": ["partner"],
  "handover.got_it": ["partner"],
  "playbook.load": ["organiser"],
  "need.set_level": ["organiser"],
  "levels.master": ["organiser"],
  "clock.jump": ["organiser"],
  "member.add": ["organiser"],
  "partner.add": ["organiser"],
  "join.create": ["organiser"],
};
