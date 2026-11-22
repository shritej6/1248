import {
  GUARD_REASONS,
  type DraftFacts,
  type DraftFlag,
  type DraftSource,
  type GuardReason,
} from "@vision/contracts";
import { z } from "zod";
import { replyObject, type ModelRun, type SorterLog, type Wait } from "../sorter.js";
import { draftText, guardDraft } from "./guard.js";
import { DRAFT_PROMPT_V1 } from "./prompt.js";
import { templateDraft, withFooter } from "./template.js";

export const DRAFT_TRIES = 3;
export const DRAFT_MAX_TOKENS = { impact_post: 400, funder_letter: 700 } as const;
const FIRST_WAIT_MS = 250;
const WAIT_GROWTH = 4;

export type DraftOutcome = {
  text: string;
  source: DraftSource;
  flag: DraftFlag | null;
  reasons: GuardReason[];
};
export type DrafterTools = { wait: Wait; log: SorterLog };

type Verdict =
  { kind: "passed"; text: string } | { kind: "stopped"; reasons: GuardReason[] } | { kind: "none" };

const DraftReplySchema = z.object({ text: z.string() });

export const drafterInput = (facts: DraftFacts): unknown => ({
  messages: [
    { role: "system", content: DRAFT_PROMPT_V1 },
    {
      role: "user",
      content: JSON.stringify({
        kind: facts.kind,
        facts: facts.facts.map(({ label, text }) => ({ label, text })),
      }),
    },
  ],
  max_tokens: DRAFT_MAX_TOKENS[facts.kind],
  chat_template_kwargs: { enable_thinking: false },
});

export const readDraftText = (reply: unknown): string | null => {
  const parsed = DraftReplySchema.safeParse(replyObject(reply));
  return parsed.success ? parsed.data.text.trim() : null;
};

const templateOutcome = (
  facts: DraftFacts,
  flag: DraftFlag,
  reasons: readonly GuardReason[],
): DraftOutcome => ({
  text: withFooter(templateDraft(facts), facts),
  source: "template",
  flag,
  reasons: GUARD_REASONS.filter((reason) => reasons.includes(reason)),
});

export const offDraft = (facts: DraftFacts): DraftOutcome => templateOutcome(facts, "ai_off", []);

export const failedDraft = (facts: DraftFacts): DraftOutcome => templateOutcome(facts, "ai_failed", []);

const callOnce = async (
  run: ModelRun,
  model: string,
  input: unknown,
  log: SorterLog,
): Promise<string | null> => {
  try {
    return readDraftText(await run(model, input));
  } catch (error) {
    log({
      op: "drafter",
      model,
      status: "call_failed",
      error: error instanceof Error ? error.name : "Error",
    });
    return null;
  }
};

const judge = (text: string | null, facts: DraftFacts): Verdict => {
  if (text === null) return { kind: "none" };
  const clean = draftText(text);
  const result = guardDraft(clean, facts);
  return result.ok ? { kind: "passed", text: clean } : { kind: "stopped", reasons: result.reasons };
};

const afterTries = (facts: DraftFacts, verdicts: readonly Verdict[]): DraftOutcome => {
  const stopped = verdicts.flatMap((verdict) => (verdict.kind === "stopped" ? [verdict.reasons] : []));
  return templateOutcome(facts, stopped.length > 0 ? "guard_rejected" : "ai_failed", stopped.flat());
};

export const createDrafter =
  (run: ModelRun, model: string, tools: DrafterTools) =>
  async (facts: DraftFacts): Promise<DraftOutcome> => {
    const input = drafterInput(facts);
    const verdicts: Verdict[] = [];
    for (let tries = 1; tries <= DRAFT_TRIES; tries += 1) {
      const verdict = judge(await callOnce(run, model, input, tools.log), facts);
      if (verdict.kind === "passed") {
        return { text: withFooter(verdict.text, facts), source: "ai", flag: null, reasons: [] };
      }
      verdicts.push(verdict);
      if (tries < DRAFT_TRIES) await tools.wait(FIRST_WAIT_MS * WAIT_GROWTH ** (tries - 1));
    }
    return afterTries(facts, verdicts);
  };
