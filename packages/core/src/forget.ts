import { isClosed } from "./holder.js";
import type { HubState } from "./state.js";

const DAY_MS = 86_400_000;

export const cardForgetAt = (
  state: HubState,
  card: string,
  at: number,
  forgetDays: number,
): number | null => {
  const jobs = (state.cards[card]?.jobs ?? []).flatMap((id) => state.jobs[id] ?? []);
  if (jobs.length === 0 || !jobs.every((job) => isClosed(job.status))) return null;
  return Math.max(...jobs.map((job) => job.closedAt ?? at)) + forgetDays * DAY_MS;
};
