import { z } from "zod";

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const idWith = (prefix: string) => z.string().regex(new RegExp(`^${prefix}${UUID_V4}$`));

export const ID_PREFIXES = {
  card: "c_",
  job: "j_",
  member: "m_",
  partner: "p_",
  page: "pg_",
  command: "cmd_",
  draft: "d_",
} as const;

export const CardIdSchema = idWith(ID_PREFIXES.card);
export const JobIdSchema = idWith(ID_PREFIXES.job);
export const MemberIdSchema = idWith(ID_PREFIXES.member);
export const PartnerIdSchema = idWith(ID_PREFIXES.partner);
export const PageIdSchema = idWith(ID_PREFIXES.page);
export const CommandIdSchema = idWith(ID_PREFIXES.command);
export const DraftIdSchema = idWith(ID_PREFIXES.draft);

export const TimeSchema = z.number().int().nonnegative();
export const ZipSchema = z.string().regex(/^\d{5}$/);
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const RoleSchema = z.enum(["desk", "volunteer", "organiser", "lead"]);
export const ActorRoleSchema = z.enum([
  "desk",
  "volunteer",
  "organiser",
  "lead",
  "resident",
  "partner",
  "system",
]);
export const ActorRefSchema = z.union([MemberIdSchema, PartnerIdSchema, CardIdSchema]);
export const ActorSchema = z.strictObject({ role: ActorRoleSchema, ref: ActorRefSchema.nullable() });

export type CardId = z.infer<typeof CardIdSchema>;
export type JobId = z.infer<typeof JobIdSchema>;
export type MemberId = z.infer<typeof MemberIdSchema>;
export type PartnerId = z.infer<typeof PartnerIdSchema>;
export type PageId = z.infer<typeof PageIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type DraftId = z.infer<typeof DraftIdSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type ActorRole = z.infer<typeof ActorRoleSchema>;
export type Actor = z.infer<typeof ActorSchema>;
