import { z } from "zod";
import { JobIdSchema } from "./ids.js";
import { OfferViewSchema, PageViewSchema } from "./views.js";

export const LiveMessageSchema = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("changed") }),
  z.strictObject({ t: z.literal("offer"), offer: OfferViewSchema }),
  z.strictObject({ t: z.literal("offer_closed"), job: JobIdSchema, reason: z.enum(["taken", "expired"]) }),
  z.strictObject({ t: z.literal("page"), page: PageViewSchema }),
]);

export type LiveMessage = z.infer<typeof LiveMessageSchema>;
