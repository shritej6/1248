import { z } from "zod";

export const SERVICES = [
  "Homelessness / Emergency Shelter",
  "Missing Persons Network",
  "Meal Programs / Pantry",
  "Free services for elderly, disabled, pregnant (lawn care, snow removal)",
  "Bridge To Employment",
  "Transportation Service",
  "Suicide Prevention",
  "Violence Prevention / Interruption",
  "Community Clean ups",
  "Youth Stipend Fund Opportunities",
  "Incident De-escalation",
  "Burial Assistance",
  "T.E.X.T. Tactical Extraction Team for DV / Sex Trafficking",
  "Other",
] as const;

export const DIVISIONS = [
  "Pet Division",
  "Investigations / Research Team",
  "Emergency Response / Mental Health",
  "Youth Issues / Outreach",
  "Missing Persons Network",
  "Legislation / Policy Division",
  "Disaster Relief Division",
  "Tactical Extraction Team",
  "Rapid / Incident Response Team",
  "No clear home",
] as const;

export const ServiceSchema = z.enum(SERVICES);
export const DivisionSchema = z.enum(DIVISIONS);
export const UrgencySchema = z.enum(["high", "low"]);
export const LevelSchema = z.literal([1, 2, 3]);
export const DoorSchema = z.enum(["form", "email", "voice"]);
export const LangSchema = z.enum(["en", "es"]);
export const OutcomeSchema = z.enum(["done", "partly", "not_done"]);
export const FlagSchema = z.enum([
  "word_list_hit",
  "passes_disagree",
  "quote_not_found",
  "ai_down",
  "sorter_off",
  "spot_check",
  "voice_transcript",
]);
export const AiJobKeySchema = z.enum(["voice", "link", "lang"]);
export const AiOutcomeSchema = z.enum(["ok", "empty", "failed", "off"]);
export const AiStatusSchema = z.enum(["pending", "ok", "empty", "failed", "off"]);
export const LinkAnswerSchema = z.enum(["same", "not_same"]);
export const LinkScoreSchema = z.number().min(0).max(1);
export const JobFlagSchema = z.enum(["visit_check", "consent_call", "checkback_call"]);
export const JobStatusSchema = z.enum([
  "planned",
  "offered",
  "accepted",
  "on_my_way",
  "there",
  "done",
  "consent_asked",
  "partner_asked",
  "partner_yes",
  "got_it",
  "mismatch",
  "partly",
  "unmet",
  "helped",
  "unreached",
  "withdrawn",
]);
export const CLOSED_STATUSES = ["helped", "unreached", "withdrawn"] as const;
export const NeedSchema = z.string().regex(/^[a-z_]{2,20}$/);

export type Service = z.infer<typeof ServiceSchema>;
export type Division = z.infer<typeof DivisionSchema>;
export type Urgency = z.infer<typeof UrgencySchema>;
export type Level = z.infer<typeof LevelSchema>;
export type Door = z.infer<typeof DoorSchema>;
export type Lang = z.infer<typeof LangSchema>;
export type AiJobKey = z.infer<typeof AiJobKeySchema>;
export type AiOutcome = z.infer<typeof AiOutcomeSchema>;
export type AiStatus = z.infer<typeof AiStatusSchema>;
export type LinkAnswer = z.infer<typeof LinkAnswerSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type Flag = z.infer<typeof FlagSchema>;
export type JobFlag = z.infer<typeof JobFlagSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type Need = z.infer<typeof NeedSchema>;
