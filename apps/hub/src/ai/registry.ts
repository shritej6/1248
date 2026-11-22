import {
  AiJobKeySchema,
  CardIdSchema,
  type Actor,
  type AiJobKey,
  type AiOn,
  type SystemCommand,
} from "@vision/contracts";
import type { HubState } from "@vision/core";
import { z } from "zod";
import { logEvent } from "../http.js";
import type { OutboxRow, Sender } from "../outbox.js";
import { giveUpDraft, sendDraft } from "../resources/job.js";
import { DRAFT_KIND } from "../resources/kind.js";
import { langJob } from "./lang.js";
import { linkJob } from "./link.js";
import { AiJobError, type AiEnv, type AiJob, type AiModels, type AiTools } from "./types.js";
import { voiceJob } from "./voice.js";

export const AI_KIND_PREFIX = "ai.";
export const AI_JOBS: Record<AiJobKey, AiJob> = { voice: voiceJob, link: linkJob, lang: langJob };

const SYSTEM: Actor = { role: "system", ref: null };
const AiRowSchema = z.object({ card: CardIdSchema });

export type AiHost = {
  env: AiEnv;
  sql: SqlStorage;
  state(): HubState;
  now(): number;
  apply(command: SystemCommand, actor: Actor): unknown;
};

export const aiKind = (job: AiJobKey): string => `${AI_KIND_PREFIX}${job}`;

export const isAiKind = (kind: string): boolean => kind.startsWith(AI_KIND_PREFIX);

export const aiOn = (env: AiModels): AiOn => ({
  voice: AI_JOBS.voice.model(env).length > 0,
  link: AI_JOBS.link.model(env).length > 0,
  lang: AI_JOBS.lang.model(env).length > 0,
});

const jobOf = (kind: string): AiJob => {
  const key = AiJobKeySchema.safeParse(kind.slice(AI_KIND_PREFIX.length));
  if (!isAiKind(kind) || !key.success) throw new AiJobError(`The outbox kind ${kind} is not an AI job.`);
  return AI_JOBS[key.data];
};

const cardOf = (row: OutboxRow): string => AiRowSchema.parse(JSON.parse(row.payload)).card;

const NO_BINDING = /needs to be run remotely/u;

const runJob = async (job: AiJob, card: string, tools: AiTools, row: OutboxRow): Promise<SystemCommand> => {
  try {
    return await job.run(card, tools);
  } catch (error) {
    if (!(error instanceof Error) || !NO_BINDING.test(error.message)) throw error;
    logEvent({ op: "ai", id: row.id, kind: row.kind, status: "no_binding" });
    return job.fallback(card, "failed");
  }
};

export const aiSender =
  (host: AiHost): Sender =>
  async (row) => {
    if (row.kind === DRAFT_KIND) {
      await sendDraft(host, row);
      return;
    }
    const job = jobOf(row.kind);
    const card = cardOf(row);
    const model = job.model(host.env);
    if (model.length === 0) {
      host.apply(job.fallback(card, "off"), SYSTEM);
      return;
    }
    const run: AiTools["run"] = (id, input) => host.env.AI.run(id, input);
    const tools = { run, model, sql: host.sql, state: host.state(), now: host.now() };
    host.apply(await runJob(job, card, tools, row), SYSTEM);
  };

export const aiGiveUp =
  (host: AiHost) =>
  (row: OutboxRow): void => {
    if (!isAiKind(row.kind)) return;
    if (row.kind === DRAFT_KIND) {
      giveUpDraft(host, row);
      return;
    }
    host.apply(jobOf(row.kind).fallback(cardOf(row), "failed"), SYSTEM);
    logEvent({ op: "ai", id: row.id, kind: row.kind, status: "gave_up" });
  };
