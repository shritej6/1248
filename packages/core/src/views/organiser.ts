import type { OrgView } from "@vision/contracts";
import { isClosed } from "../holder.js";
import { canEarn, levelOf, recordOf } from "../needrecord.js";
import type { HubState, JobState } from "../state.js";
import { DAY_MS, clockView, type VaultReader, type ViewContext } from "./common.js";
import { deskJob } from "./desk.js";

const STARTED: readonly JobState["status"][] = ["accepted", "on_my_way", "there"];

const lastTap = (job: JobState): number =>
  Math.max(job.acceptedAt ?? 0, job.onMyWayAt ?? 0, job.thereAt ?? 0);

const levelsOf = (state: HubState, ctx: ViewContext): OrgView["levels"] => ({
  master: state.levels.master,
  needs: ctx.playbook.rows.map((row) => {
    const record = recordOf(state, row.need);
    return {
      need: row.need,
      level: levelOf(state, row),
      clean: record.clean,
      changed: record.changed,
      canEarn: canEarn(state, row),
    };
  }),
});

const finishList = (
  state: HubState,
  vault: VaultReader,
  ctx: ViewContext,
  jobs: JobState[],
): OrgView["finish"] =>
  jobs
    .filter((job) => STARTED.includes(job.status))
    .sort((a, b) => lastTap(a) - lastTap(b))
    .map((job) => ({
      ...deskJob(state, vault, ctx, job),
      daysSinceTap: Math.max(0, Math.floor((ctx.now - lastTap(job)) / DAY_MS)),
    }));

export const orgView = (state: HubState, vault: VaultReader, ctx: ViewContext): OrgView => {
  const open = Object.values(state.jobs).filter((job) => !isClosed(job.status) && !job.quiet);
  return {
    playbook: ctx.playbook,
    levels: levelsOf(state, ctx),
    members: ctx.memberRecords,
    partners: ctx.partners,
    unmet: open
      .filter((job) => job.status === "unmet")
      .sort((a, b) => a.promiseAt - b.promiseAt)
      .map((job) => deskJob(state, vault, ctx, job)),
    finish: finishList(state, vault, ctx, open),
    demo: { mode: ctx.config.demoMode, offsetMs: state.clockOffsetMs },
    clock: clockView(state, ctx),
    orgName: ctx.config.orgName,
  };
};
