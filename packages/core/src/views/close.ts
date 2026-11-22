import type { Playbook, Tracking } from "@vision/contracts";
import { isClosed } from "../holder.js";
import type { HubState } from "../state.js";

export type CloseViewContext = { playbook: Playbook };

export const checkbackAskView = (
  state: HubState,
  ctx: CloseViewContext,
  cardId: string,
): Tracking["checkbackAsk"] => {
  const job = (state.cards[cardId]?.jobs ?? [])
    .map((id) => state.jobs[id])
    .find(
      (j) =>
        j !== undefined &&
        !j.quiet &&
        (j.status === "done" || j.status === "got_it") &&
        j.checkback !== null &&
        j.checkback.sentAt !== null,
    );
  if (job === undefined) return null;
  return { job: job.id, needLabel: ctx.playbook.rows.find((r) => r.need === job.need)?.label ?? job.need };
};

export const isMismatch = (state: HubState, jobId: string): boolean => {
  const job = state.jobs[jobId];
  return job !== undefined && !isClosed(job.status) && (state.mismatches[jobId] ?? 0) > 0;
};
