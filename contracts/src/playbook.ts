import { z } from "zod";
import { MemberIdSchema, PartnerIdSchema, RoleSchema, TimeSchema, ZipSchema } from "./ids.js";
import { AiOnSchema } from "./ai.js";
import { NeedSchema, ServiceSchema } from "./needs.js";

export const RungSchema = z.discriminatedUnion("path", [
  z.strictObject({ path: z.literal("volunteers") }),
  z.strictObject({
    path: z.literal("partner"),
    partner: PartnerIdSchema,
    replyMinutes: z.number().int().positive(),
  }),
  z.strictObject({ path: z.literal("unmet") }),
]);

export const PlaybookRowSchema = z
  .strictObject({
    need: NeedSchema,
    label: z.string().min(1).max(60),
    service: ServiceSchema,
    defaultForService: z.boolean(),
    code: z.string().regex(/^[A-Z]{2,6}$/),
    level: z.literal([2, 3]),
    owner: MemberIdSchema,
    skill: z.string().regex(/^[a-z_]{2,20}$/),
    promiseHours: z.number().positive(),
    quiet: z.boolean(),
    crew: z.number().int().min(1),
    bring: z.string().min(1).max(120).nullable(),
    ladder: z.array(RungSchema).min(1),
  })
  .refine((row) => row.ladder.at(-1)?.path === "unmet", { message: "The last rung must be unmet." });

const countBy = (items: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
};

export const PlaybookSchema = z
  .strictObject({ version: z.string().min(1).max(40), rows: z.array(PlaybookRowSchema).min(1) })
  .superRefine((pb, ctx) => {
    for (const [need, n] of countBy(pb.rows.map((r) => r.need))) {
      if (n > 1) ctx.addIssue({ code: "custom", message: `Need ${need} appears more than once.` });
    }
    const defaults = pb.rows.filter((r) => r.defaultForService).map((r) => r.service);
    for (const [service, n] of countBy(defaults)) {
      if (n > 1) ctx.addIssue({ code: "custom", message: `${service} has more than one default row.` });
    }
  });

export const MemberPublicSchema = z.strictObject({
  id: MemberIdSchema,
  roles: z.array(RoleSchema).min(1),
  skills: z.array(z.string().regex(/^[a-z_]{2,20}$/)),
  zip: ZipSchema.nullable(),
  on: z.boolean(),
  lastJobAt: TimeSchema.nullable(),
});
export const MemberRecordSchema = MemberPublicSchema.extend({ name: z.string().min(1).max(80) });
export const PartnerRecordSchema = z.strictObject({ id: PartnerIdSchema, name: z.string().min(1).max(80) });

export const ConfigSchema = z.strictObject({
  org: z.string().regex(/^[a-z0-9-]{2,40}$/),
  orgName: z.string().min(1).max(80),
  pageList: z.array(MemberIdSchema),
  waveSize: z.number().int().positive(),
  maxWaves: z.number().int().positive(),
  demoMode: z.boolean(),
  forgetDays: z.number().int().positive(),
  sorterOn: z.boolean(),
  aiOn: AiOnSchema.optional(),
});

export const ZipCentresSchema = z.record(ZipSchema, z.strictObject({ lat: z.number(), lon: z.number() }));

export const TemplateIdSchema = z.enum([
  "receipt",
  "consent_ask",
  "partner_ask",
  "partner_has_it",
  "checkback",
  "unmet",
]);
const TemplateSchema = z.strictObject({ text: z.string().min(1), slots: z.array(z.string().min(1)) });
const sameSlots = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((slot) => b.includes(slot));
export const TemplatesSchema = z
  .strictObject({
    receipt: TemplateSchema,
    consent_ask: TemplateSchema,
    partner_ask: TemplateSchema,
    partner_has_it: TemplateSchema,
    checkback: TemplateSchema,
    unmet: TemplateSchema,
    es: z.partialRecord(TemplateIdSchema, TemplateSchema).optional(),
  })
  .superRefine((all, ctx) => {
    for (const [id, template] of Object.entries(all.es ?? {})) {
      const english = all[id as TemplateId];
      if (!sameSlots(template.slots, english.slots))
        ctx.addIssue({
          code: "custom",
          message: `The Spanish ${id} template needs the slots of the English one.`,
        });
    }
  });

export type Rung = z.infer<typeof RungSchema>;
export type PlaybookRow = z.infer<typeof PlaybookRowSchema>;
export type Playbook = z.infer<typeof PlaybookSchema>;
export type MemberPublic = z.infer<typeof MemberPublicSchema>;
export type MemberRecord = z.infer<typeof MemberRecordSchema>;
export type PartnerRecord = z.infer<typeof PartnerRecordSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type ZipCentres = z.infer<typeof ZipCentresSchema>;
export type TemplateId = z.infer<typeof TemplateIdSchema>;
export type Templates = z.infer<typeof TemplatesSchema>;
