import { z } from "zod";

export const RejectionCodeSchema = z.enum([
  "invalid",
  "too_large",
  "unauthorized",
  "forbidden",
  "not_found",
  "wrong_state",
  "taken",
  "not_eligible",
  "too_many_jobs",
  "not_earned",
  "demo_off",
  "rate_limited",
  "internal",
]);
export const RejectionSchema = z.strictObject({ code: RejectionCodeSchema, message: z.string() });
export const ErrorBodySchema = z.strictObject({ ok: z.literal(false), error: RejectionSchema });
export const CommandOkSchema = z.strictObject({
  ok: z.literal(true),
  events: z.number().int().nonnegative(),
});
export const CommandResponseSchema = z.discriminatedUnion("ok", [CommandOkSchema, ErrorBodySchema]);

export type RejectionCode = z.infer<typeof RejectionCodeSchema>;
export type Rejection = z.infer<typeof RejectionSchema>;
export type ErrorBody = z.infer<typeof ErrorBodySchema>;
export type CommandOk = z.infer<typeof CommandOkSchema>;
export type CommandResponse = z.infer<typeof CommandResponseSchema>;

export const rejectionStatus: Record<RejectionCode, number> = {
  invalid: 400,
  too_large: 413,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  rate_limited: 429,
  wrong_state: 409,
  taken: 409,
  not_eligible: 409,
  too_many_jobs: 409,
  not_earned: 409,
  demo_off: 409,
  internal: 500,
};
