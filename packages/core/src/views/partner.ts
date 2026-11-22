import type { PartnerCard, PartnerRecord, Playbook, Tracking } from "@vision/contracts";
import { CLOCKS } from "../clocks.js";
import { cardForgetAt } from "../forget.js";
import { isClosed } from "../holder.js";
import type { CardState, HubState, JobState, PartnerCounts } from "../state.js";

export type PartnerVault = {
  person(card: string): { firstName: string; contact: string; address: string | null } | null;
};
export type PartnerViewContext = {
  now: number;
  playbook: Playbook;
  partners: readonly PartnerRecord[];
  forgetDays: number;
  orgName: string;
};

const MINUTE = 60_000;
const NO_COUNTS: PartnerCounts = { asked: 0, yes: 0, gotIt: 0, helped: 0 };

const nameOf = (ctx: PartnerViewContext, partner: string): string =>
  ctx.partners.find((p) => p.id === partner)?.name ?? "";

const rowOf = (ctx: PartnerViewContext, job: JobState) => ctx.playbook.rows.find((r) => r.need === job.need);

const replyAt = (ctx: PartnerViewContext, job: JobState, askedAt: number): number => {
  const rung = rowOf(ctx, job)?.ladder[job.rung];
  return askedAt + (rung?.path === "partner" ? rung.replyMinutes : 120) * MINUTE;
};

const tried = (ctx: PartnerViewContext, job: JobState): string[] =>
  (rowOf(ctx, job)?.ladder ?? [])
    .slice(0, job.rung)
    .flatMap((rung) =>
      rung.path === "volunteers"
        ? ["Volunteers were asked."]
        : rung.path === "partner"
          ? [`${nameOf(ctx, rung.partner)} was asked.`]
          : [],
    );

type Open = { state: HubState; ctx: PartnerViewContext; job: JobState; card: CardState; label: string };

const askOf = (o: Open, deadline: number): PartnerCard["ask"] => ({
  job: o.job.id,
  needLabel: o.label,
  zip: o.card.zip,
  deadline,
});

const noteOf = (o: Open, person: { firstName: string; contact: string }): PartnerCard["note"] => ({
  job: o.job.id,
  gotIt: o.job.status === "got_it",
  firstName: person.firstName,
  zip: o.card.zip,
  needLabel: o.label,
  deadline: o.job.promiseAt,
  contact: person.contact,
  tried: tried(o.ctx, o.job),
});

type Shown = Pick<PartnerCard, "routeCode" | "state" | "ask" | "note" | "result" | "closesAt">;
const CLOSED: Shown = {
  routeCode: null,
  state: "closed",
  ask: null,
  note: null,
  result: null,
  closesAt: null,
};

const gotItBy = (job: JobState): number | null => (job.yesAt === null ? null : job.yesAt + CLOCKS.gotIt);

const shown = (o: Open, partner: string, person: { firstName: string; contact: string }): Shown => {
  const { job } = o;
  const open = { ...CLOSED, routeCode: o.card.routeCode };
  if (job.status === "partner_asked" && job.askedAt !== null) {
    const deadline = replyAt(o.ctx, job, job.askedAt);
    return { ...open, state: "ask", ask: askOf(o, deadline), closesAt: deadline };
  }
  const promised = o.state.promises.includes(partner);
  const byGotIt = gotItBy(job);
  if (job.status === "partner_yes" && byGotIt !== null && !promised)
    return { ...open, state: "promise", ask: askOf(o, byGotIt), closesAt: byGotIt };
  if ((job.status === "partner_yes" && promised) || job.status === "got_it") {
    const closesAt = job.status === "got_it" ? null : byGotIt;
    return { ...open, state: "note", note: noteOf(o, person), closesAt };
  }
  if (isClosed(job.status) && job.gotItAt !== null) {
    const counts = o.state.partnerCounts[partner] ?? NO_COUNTS;
    const closesAt = cardForgetAt(o.state, o.card.id, o.ctx.now, o.ctx.forgetDays);
    return { ...open, state: "result", result: { status: job.status, counts }, closesAt };
  }
  return CLOSED;
};

export const partnerView = (
  state: HubState,
  vault: PartnerVault,
  ctx: PartnerViewContext,
  partner: string,
  jobId: string,
): PartnerCard => {
  const head = {
    partner: { id: partner, name: nameOf(ctx, partner) },
    clock: { now: ctx.now, offsetMs: state.clockOffsetMs },
    orgName: ctx.orgName,
  };
  const job = state.jobs[jobId];
  const card = job === undefined ? undefined : state.cards[job.card];
  const person = job === undefined ? null : vault.person(job.card);
  if (job === undefined || card === undefined || job.partner !== partner || person === null)
    return { ...head, ...CLOSED };
  const label = rowOf(ctx, job)?.label ?? job.need;
  return { ...head, ...shown({ state, ctx, job, card, label }, partner, person) };
};

export const consentAskView = (
  state: HubState,
  ctx: PartnerViewContext,
  cardId: string,
): Tracking["consentAsk"] => {
  const card = state.cards[cardId];
  const job = (card?.jobs ?? [])
    .map((id) => state.jobs[id])
    .find((j) => j !== undefined && j.status === "consent_asked" && j.partner !== null && !j.quiet);
  if (job === undefined || job.partner === null) return null;
  return {
    job: job.id,
    partnerName: nameOf(ctx, job.partner),
    needLabel: rowOf(ctx, job)?.label ?? job.need,
  };
};
