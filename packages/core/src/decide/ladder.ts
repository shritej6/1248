import type { Actor, DecideContext, Effect, EventDraft, Playbook, Rung, TemplateId } from "@vision/contracts";
import type { HubState, JobState } from "../state.js";
import type { Lines } from "./result.js";

type Body = EventDraft extends infer E ? (E extends EventDraft ? Pick<E, "type" | "data"> : never) : never;
export type OtherRung = Exclude<Rung, { path: "volunteers" }>;

export const labelOf = (playbook: Playbook, job: JobState): string =>
  playbook.rows.find((row) => row.need === job.need)?.label ?? job.need;

export const line = (job: JobState, actor: Actor, draft: Body): EventDraft => ({
  card: job.card,
  job: job.id,
  actor,
  ...draft,
});

export const mayMessage = (state: HubState, job: JobState): boolean =>
  !job.quiet && state.cards[job.card]?.safeContact === true;

export const toResident = (
  job: JobState,
  template: TemplateId,
  partner: string | null,
  slots: Record<string, string>,
): Effect => ({ kind: "message", to: "resident", card: job.card, job: job.id, partner, template, slots });

const askConsent = (state: HubState, job: JobState, partner: string, actor: Actor, ctx: DecideContext) => {
  const asked = line(job, actor, { type: "consent.asked", data: { partner } });
  if (!mayMessage(state, job)) {
    return {
      events: [asked, line(job, actor, { type: "job.flagged", data: { flag: "consent_call" } })],
      effects: [],
    };
  }
  const slots = { orgName: ctx.config.orgName, needLabel: labelOf(ctx.playbook, job) };
  return { events: [asked], effects: [toResident(job, "consent_ask", partner, slots)] };
};

const unmet = (state: HubState, job: JobState, actor: Actor, ctx: DecideContext): Lines => ({
  events: [line(job, actor, { type: "job.unmet", data: {} })],
  effects: mayMessage(state, job)
    ? [toResident(job, "unmet", null, { needLabel: labelOf(ctx.playbook, job) })]
    : [],
});

export const startOtherRung = (
  state: HubState,
  job: JobState,
  rung: OtherRung,
  actor: Actor,
  ctx: DecideContext,
): Lines =>
  rung.path === "partner" ? askConsent(state, job, rung.partner, actor, ctx) : unmet(state, job, actor, ctx);
