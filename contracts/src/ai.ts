import { z } from "zod";
import { ZipSchema } from "./ids.js";

export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 120;
export const VOICE_TYPES = [
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
] as const;
export const LINK_WINDOW_DAYS = 7;

export const VoiceTypeSchema = z.enum(VOICE_TYPES);

const optionalZip = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .pipe(ZipSchema.nullable());
export const CallbackSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^\+?[0-9][0-9 ().-]*$/);

const optionalCallback = z
  .string()
  .trim()
  .max(40)
  .transform((value) => (value === "" ? null : value))
  .pipe(CallbackSchema.nullable());

export const VoicemailFieldsSchema = z.strictObject({
  zip: optionalZip.optional().transform((value) => value ?? null),
  callback: optionalCallback.optional().transform((value) => value ?? null),
  seconds: z.coerce.number().positive().max(VOICE_MAX_SECONDS),
});
export const VoiceDoorFieldsSchema = VoicemailFieldsSchema.extend({
  recordingId: z.string().trim().min(1).max(200),
});

export const AiOnSchema = z.strictObject({ voice: z.boolean(), link: z.boolean(), lang: z.boolean() });

export type VoiceType = z.infer<typeof VoiceTypeSchema>;
export type VoicemailFields = z.infer<typeof VoicemailFieldsSchema>;
export type VoiceDoorFields = z.infer<typeof VoiceDoorFieldsSchema>;
export type AiOn = z.infer<typeof AiOnSchema>;
