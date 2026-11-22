import type { DecideContext, OfferView, PageView } from "@vision/contracts";
import type { HubState } from "../state.js";
import { milesBetween } from "../wave.js";

export type OfferViewContext = Pick<DecideContext, "playbook" | "zips">;

export const offerView = (
  state: HubState,
  ctx: OfferViewContext,
  memberZip: string | null,
  jobId: string,
): OfferView | null => {
  const job = state.jobs[jobId];
  if (job === undefined) return null;
  const row = ctx.playbook.rows.find((r) => r.need === job.need);
  const miles = milesBetween(memberZip, state.cards[job.card]?.zip ?? null, ctx.zips);
  return {
    job: job.id,
    needLabel: row?.label ?? job.need,
    distanceMiles: miles === null ? null : Math.round(miles * 10) / 10,
    promiseAt: job.promiseAt,
    bring: row?.bring ?? null,
    crew: row?.crew ?? 1,
  };
};

export const pageView = (
  state: HubState,
  pageId: string,
  name: (member: string) => string | null,
): PageView | null => {
  const page = state.pages[pageId];
  if (page === undefined) return null;
  return {
    page: page.id,
    card: page.card,
    reason: page.reason,
    sentAt: page.sentAt,
    to: name(page.to) ?? page.to,
  };
};
