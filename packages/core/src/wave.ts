import type { DecideContext, JobStatus, MemberPublic, PlaybookRow } from "@vision/contracts";
import type { CardState, HubState, JobState } from "./state.js";

export const MAX_OPEN_JOBS = 3;
export const HELD_STATUSES: readonly JobStatus[] = ["accepted", "on_my_way", "there"];

export const crewOf = (job: JobState): string[] =>
  job.holderRef === null ? [] : [job.holderRef, ...job.helpers];

export const crewSize = (ctx: Pick<DecideContext, "playbook">, job: JobState): number =>
  ctx.playbook.rows.find((row) => row.need === job.need)?.crew ?? 1;

export const crewOpen = (ctx: Pick<DecideContext, "playbook">, job: JobState): boolean =>
  HELD_STATUSES.includes(job.status) && crewOf(job).length < crewSize(ctx, job);

export const offerOpenFor = (
  ctx: Pick<DecideContext, "playbook" | "offered">,
  job: JobState,
  member: string,
): boolean =>
  (ctx.offered[job.id] ?? []).includes(member) &&
  !crewOf(job).includes(member) &&
  (job.status === "offered" || crewOpen(ctx, job));

const EARTH_MILES = 3958.8;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export type ZipCentres = DecideContext["zips"];

export const milesBetween = (a: string | null, b: string | null, zips: ZipCentres): number | null => {
  const from = a === null ? undefined : zips[a];
  const to = b === null ? undefined : zips[b];
  if (from === undefined || to === undefined) return null;
  const dLat = toRadians(to.lat - from.lat);
  const dLon = toRadians(to.lon - from.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLon / 2) ** 2;
  const miles = 2 * EARTH_MILES * Math.asin(Math.sqrt(h));
  return Math.round(miles * 2) / 2;
};

export const openJobsByMember = (state: HubState): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const job of Object.values(state.jobs)) {
    if (!HELD_STATUSES.includes(job.status)) continue;
    for (const member of crewOf(job)) counts[member] = (counts[member] ?? 0) + 1;
  }
  return counts;
};

export type Ineligible = "not_eligible" | "too_many_jobs";

export const acceptBlock = (
  member: MemberPublic,
  job: JobState,
  row: PlaybookRow,
  openJobs: Readonly<Record<string, number>>,
): Ineligible | null => {
  if (!member.roles.includes("volunteer") || !member.skills.includes(row.skill)) return "not_eligible";
  if (job.excluded.includes(member.id)) return "not_eligible";
  return (openJobs[member.id] ?? 0) >= MAX_OPEN_JOBS ? "too_many_jobs" : null;
};

export type WaveInput = {
  job: JobState;
  card: CardState;
  row: PlaybookRow;
  members: readonly MemberPublic[];
  offered: readonly string[];
  openJobs: Readonly<Record<string, number>>;
  zips: ZipCentres;
  size: number;
};

type Ranked = { id: string; miles: number; waitedSince: number };

const byNearestThenLongestWait = (a: Ranked, b: Ranked): number =>
  a.miles - b.miles || a.waitedSince - b.waitedSince || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const pickWave = (input: WaveInput): string[] =>
  input.members
    .filter((m) => m.on && !input.offered.includes(m.id))
    .filter((m) => acceptBlock(m, input.job, input.row, input.openJobs) === null)
    .map((m) => ({
      id: m.id,
      miles: milesBetween(m.zip, input.card.zip, input.zips) ?? Number.POSITIVE_INFINITY,
      waitedSince: m.lastJobAt ?? Number.NEGATIVE_INFINITY,
    }))
    .sort(byNearestThenLongestWait)
    .slice(0, input.size)
    .map((r) => r.id);
