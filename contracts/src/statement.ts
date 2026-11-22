import { z } from "zod";
import { HashSchema, ZipSchema } from "./ids.js";
import { NeedSchema } from "./needs.js";

const count = z.number().int().nonnegative();

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const StatementSchema = z.strictObject({
  month: MonthSchema,
  openAtStart: count,
  new: count,
  helped: count,
  unreached: count,
  withdrawn: count,
  unmet: count,
  stillOpen: count,
  balanced: z.boolean(),
  wrong: z.strictObject({
    mismatches: count,
    latePromises: count,
    deskChanges: count,
    pagesMoved: count,
    noVolunteer: count,
  }),
  promise: z.strictObject({ kept: count, due: count }),
  unmetTable: z.array(z.strictObject({ need: NeedSchema, zip: ZipSchema.nullable(), count })),
  hours: z.number().nonnegative(),
  erased: z.strictObject({ erased: count, due: count }),
  seal: z.strictObject({ seq: count, hash: HashSchema }),
  method: z.record(z.string(), z.string().min(1)),
});

export type Month = z.infer<typeof MonthSchema>;
export type Statement = z.infer<typeof StatementSchema>;
