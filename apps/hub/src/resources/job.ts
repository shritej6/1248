import { DraftIdSchema, type Actor, type DraftFacts, type SystemCommand } from "@vision/contracts";
import {
  createDrafter,
  failedDraft,
  offDraft,
  type DraftOutcome,
  type ModelRun,
  type Wait,
} from "@vision/core";
import { z } from "zod";
import { logEvent } from "../http.js";
import { readDraftFacts } from "./tables.js";

export type DraftJobHost = {
  env: { DRAFT_MODEL: string; AI: { run: ModelRun } };
  sql: SqlStorage;
  apply(command: SystemCommand, actor: Actor): unknown;
};

export type DraftJobRow = { id: number; kind: string; payload: string };

const SYSTEM: Actor = { role: "system", ref: null };
const PayloadSchema = z.object({ draft: DraftIdSchema });

const sleep: Wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const applyOutcome = (host: DraftJobHost, draft: string, outcome: DraftOutcome): void => {
  const { text, source, flag, reasons } = outcome;
  host.apply({ type: "draft.result", draft, text, source, flag, reasons }, SYSTEM);
};

const writeDraft = (host: DraftJobHost, facts: DraftFacts): Promise<DraftOutcome> => {
  const model = host.env.DRAFT_MODEL;
  if (model.length === 0) return Promise.resolve(offDraft(facts));
  const run: ModelRun = (id, input) => host.env.AI.run(id, input);
  return createDrafter(run, model, { wait: sleep, log: logEvent })(facts);
};

export const sendDraft = async (host: DraftJobHost, row: DraftJobRow): Promise<void> => {
  const { draft } = PayloadSchema.parse(JSON.parse(row.payload) as unknown);
  const facts = readDraftFacts(host.sql, draft);
  if (facts === null) {
    logEvent({ op: "draft", id: row.id, draft, status: "not_writing" });
    return;
  }
  const outcome = await writeDraft(host, facts);
  applyOutcome(host, draft, outcome);
  logEvent({ op: "draft", id: row.id, draft, status: outcome.source, flag: outcome.flag });
};

const draftOf = (row: DraftJobRow): string | null => {
  try {
    return PayloadSchema.parse(JSON.parse(row.payload) as unknown).draft;
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    logEvent({ op: "draft", id: row.id, status: "bad_payload", error: name });
    return null;
  }
};

export const giveUpDraft = (host: DraftJobHost, row: DraftJobRow): void => {
  const draft = draftOf(row);
  const facts = draft === null ? null : readDraftFacts(host.sql, draft);
  if (draft === null || facts === null) return;
  applyOutcome(host, draft, failedDraft(facts));
  logEvent({ op: "draft", id: row.id, draft, status: "gave_up" });
};
