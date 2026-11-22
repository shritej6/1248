import { z } from "zod";
import { MemberIdSchema, RoleSchema } from "./ids.js";

export const JoinCodeSchema = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
export const JoinResponseSchema = z.strictObject({
  session: z.string().min(1),
  member: z.strictObject({ id: MemberIdSchema, roles: z.array(RoleSchema).min(1) }),
});

export type JoinResponse = z.infer<typeof JoinResponseSchema>;
