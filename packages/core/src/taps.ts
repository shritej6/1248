import type { JobState, MemberTaps } from "./state.js";

const NONE: MemberTaps = { startAt: null, hoursMs: 0, counted: false };

const tapsOf = (job: JobState): Record<string, MemberTaps> => job.taps ?? {};

const withTaps = (job: JobState, member: string, change: (taps: MemberTaps) => MemberTaps): JobState => ({
  ...job,
  taps: { ...tapsOf(job), [member]: change(tapsOf(job)[member] ?? NONE) },
});

const spanMs = (taps: MemberTaps, at: number): number =>
  taps.startAt === null ? 0 : Math.max(0, at - taps.startAt);

const spanEnd = (taps: MemberTaps, at: number): MemberTaps => ({
  ...taps,
  startAt: null,
  hoursMs: taps.hoursMs + spanMs(taps, at),
});

export const tapStart = (job: JobState, member: string, at: number): JobState =>
  withTaps(job, member, (taps) => ({ ...taps, startAt: taps.startAt ?? at, counted: true }));

const creditCrew = (job: JobState, holder: MemberTaps, at: number): JobState =>
  job.helpers.reduce(
    (next, helper) =>
      withTaps(next, helper, (taps) => ({
        startAt: null,
        hoursMs: taps.hoursMs + spanMs(holder, at),
        counted: taps.counted || holder.counted,
      })),
    job,
  );

export const tapDone = (job: JobState, member: string, at: number, counts: boolean): JobState => {
  const before = tapsOf(job)[member] ?? NONE;
  const holder = { ...before, counted: before.counted || counts };
  const credited = member === job.holderRef ? creditCrew(job, holder, at) : job;
  return withTaps(credited, member, () => spanEnd(holder, at));
};

export const endOpenSpans = (job: JobState, at: number): JobState =>
  job.taps === undefined
    ? job
    : {
        ...job,
        taps: Object.fromEntries(Object.entries(job.taps).map(([m, t]) => [m, spanEnd(t, at)])),
      };

export const memberTaps = (job: JobState, member: string): MemberTaps | undefined => tapsOf(job)[member];

export const tappedHoursMs = (job: JobState | undefined): number =>
  job === undefined ? 0 : Object.values(tapsOf(job)).reduce((sum, taps) => sum + taps.hoursMs, 0);
