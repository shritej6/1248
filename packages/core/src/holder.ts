import {
  CLOSED_STATUSES,
  type Holder,
  type JobStatus,
  type MemberPublic,
  type Playbook,
} from "@vision/contracts";
import type { HubState } from "./state.js";

export type HolderContext = { playbook: Playbook; members: readonly MemberPublic[] };

const VOLUNTEER_HOLDS: readonly JobStatus[] = ["accepted", "on_my_way", "there"];

export const isClosed = (status: JobStatus): boolean =>
  (CLOSED_STATUSES as readonly JobStatus[]).includes(status);

const leadOf = (members: readonly MemberPublic[]): string | null =>
  members.find((m) => m.roles.includes("lead"))?.id ?? null;

export const holderOf = (state: HubState, jobId: string, ctx: HolderContext): Holder => {
  const job = state.jobs[jobId];
  if (!job || isClosed(job.status)) return { kind: "none" };
  if (VOLUNTEER_HOLDS.includes(job.status) && job.holderRef !== null) {
    return { kind: "volunteer", member: job.holderRef };
  }
  if (job.status === "got_it" && job.holderRef !== null) return { kind: "partner", partner: job.holderRef };
  if (job.quiet || job.level === 3) return { kind: "lead", member: leadOf(ctx.members) };
  const owner = ctx.playbook.rows.find((row) => row.need === job.need)?.owner;
  if (job.status === "unmet" && owner !== undefined) return { kind: "owner", member: owner };
  return { kind: "desk", member: state.deskOnShift };
};
