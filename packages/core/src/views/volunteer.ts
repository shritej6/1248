import type { JobAction, JobCard, JobStatus, OfferView, Rejection, VolunteerHome } from "@vision/contracts";
import type { HubState, JobState } from "../state.js";
import { memberTaps } from "../taps.js";
import { HELD_STATUSES, milesBetween, offerOpenFor } from "../wave.js";
import {
  clockView,
  needLabel,
  rejection,
  rowFor,
  textsOf,
  type VaultReader,
  type ViewContext,
} from "./common.js";

const HOUR_MS = 3_600_000;

const ACTIONS: Partial<Record<JobStatus, JobAction[]>> = {
  accepted: ["on_my_way", "there", "done", "help", "hand_off"],
  on_my_way: ["there", "done", "help", "hand_off"],
  there: ["done", "help", "hand_off"],
};

const worksOn = (job: JobState, member: string): boolean =>
  job.holderRef === member || job.helpers.includes(member);

const isHeldBy = (job: JobState, member: string): boolean =>
  HELD_STATUSES.includes(job.status) && worksOn(job, member);

const offerOf = (state: HubState, ctx: ViewContext, job: JobState, zip: string | null): OfferView[] => {
  const row = rowFor(ctx, job.need);
  const card = state.cards[job.card];
  if (row === undefined || card === undefined) return [];
  return [
    {
      job: job.id,
      needLabel: row.label,
      distanceMiles: milesBetween(zip, card.zip, ctx.zips),
      promiseAt: job.promiseAt,
      bring: row.bring,
      crew: row.crew,
    },
  ];
};

const recordOf = (jobs: readonly JobState[], member: string): VolunteerHome["record"] => {
  const worked = jobs.flatMap((job) => memberTaps(job, member) ?? []);
  const hoursMs = worked.reduce((sum, taps) => sum + taps.hoursMs, 0);
  const jobsDone = worked.filter((taps) => taps.counted).length;
  return { jobsDone, hours: Math.round((hoursMs / HOUR_MS) * 100) / 100 };
};

export const homeView = (state: HubState, ctx: ViewContext, member: string): VolunteerHome => {
  const record = ctx.memberRecords.find((m) => m.id === member);
  const zip = record?.zip ?? null;
  const jobs = Object.values(state.jobs);
  const offers = jobs
    .filter((job) => offerOpenFor(ctx, job, member))
    .flatMap((job) => offerOf(state, ctx, job, zip));
  return {
    member: {
      id: member,
      name: record?.name ?? "",
      on: record?.on ?? false,
      skills: record?.skills ?? [],
      zip,
    },
    offers,
    jobs: jobs
      .filter((job) => isHeldBy(job, member))
      .map((job) => ({ job: job.id, needLabel: needLabel(ctx, job.need), status: job.status })),
    record: recordOf(jobs, member),
    clock: clockView(state, ctx),
  };
};

export const jobView = (
  state: HubState,
  vault: VaultReader,
  ctx: ViewContext,
  member: string,
  jobId: string,
): JobCard | Rejection => {
  const job = state.jobs[jobId];
  const card = job === undefined ? undefined : state.cards[job.card];
  if (job === undefined || card === undefined) return rejection("not_found", "This job is not on the board.");
  if (!isHeldBy(job, member)) return rejection("forbidden", "Only the volunteer who holds this job sees it.");
  const person = vault.person(card.id);
  const notes = textsOf(vault, card.id, "note");
  return {
    job: job.id,
    routeCode: card.routeCode ?? "",
    needLabel: needLabel(ctx, job.need),
    status: job.status,
    firstName: person?.firstName ?? "",
    address: person?.address ?? null,
    words: textsOf(vault, card.id, "message_in")
      .map((line) => line.text)
      .join("\n"),
    promiseAt: job.promiseAt,
    accessNotes: notes.filter((line) => line.from === "desk").at(-1)?.text ?? null,
    actions: job.holderRef === member ? (ACTIONS[job.status] ?? []) : [],
    thread: notes.map((line) => ({ at: line.at, from: line.from, text: line.text })),
    clock: clockView(state, ctx),
  };
};
