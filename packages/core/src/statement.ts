import type { EventType, JobStatus, LedgerEvent, Statement } from "@vision/contracts";
import { evolve, fold } from "./evolve.js";
import { monthBounds } from "./month.js";
import { emptyState, type HubState, type JobState } from "./state.js";
import { tappedHoursMs } from "./taps.js";

type Span = { start: number; end: number };
type Group = "helped" | "unreached" | "withdrawn" | "unmet" | "stillOpen";
type Walk = { end: HubState; hoursMs: number; delivered: Record<string, number> };
type Counted = { job: JobState; open: boolean; group: Group };

const HOUR_MS = 3_600_000;
const CLOSED: readonly JobStatus[] = ["helped", "unreached", "withdrawn"];
const SENT_BACK: readonly EventType[] = ["job.reopened", "job.returned", "job.rung_moved"];

const METHOD: Statement["method"] = {
  openAtStart: "Jobs planned before the month started that were not closed when it started.",
  new: "Jobs planned inside the month.",
  helped: "Counted jobs that closed as helped inside the month.",
  unreached: "Counted jobs that closed as unreached inside the month, after three check-back tries.",
  withdrawn: "Counted jobs that the desk closed inside the month as cancelled or duplicate.",
  unmet: "Counted jobs that were on the unmet shelf when the month ended.",
  stillOpen: "All other counted jobs, which were still open when the month ended.",
  wrong:
    "Mismatch answers, late promises, desk changes to machine labels, pages that moved on, and jobs that no volunteer took, each inside the month.",
  promise:
    "Jobs with a promise time inside the month, not withdrawn, whose promise time the ledger has reached or that are delivered now. A promise is kept when the delivery that still stands (a done tap, a partner hand-over, or a close as helped or unreached) is at or before the promise time. A job sent back, for example after a mismatch or a hand off, counts only the delivery after it, so a re-sent job finished after its promise time is late.",
  unmetTable: "Jobs in the unmet group, counted by need and ZIP. No names.",
  hours:
    "Sum of the time from each volunteer's own on my way tap (or there tap when there was no on my way) to their own done tap, hand off or the job being sent back, for spans that ended inside the month. Crew helpers get the span of the holder when the holder taps done. It is the sum of the hours on the volunteer records.",
  erased:
    "Private rows that the forget job erased inside the month. Each run erases every row that is due, so the rows due are the rows erased in those runs.",
  seal: "The number and fingerprint of the last ledger line before the month ended.",
};

const isDelivery = (e: LedgerEvent): boolean =>
  (e.type === "job.done" && e.data.outcome !== "not_done") ||
  e.type === "job.got_it" ||
  (e.type === "job.closed" && e.data.result !== "withdrawn");

const deliveredAfter = (
  delivered: Record<string, number>,
  job: string,
  e: LedgerEvent,
): Record<string, number> => {
  if (SENT_BACK.includes(e.type))
    return Object.fromEntries(Object.entries(delivered).filter(([id]) => id !== job));
  return delivered[job] === undefined && isDelivery(e) ? { ...delivered, [job]: e.at } : delivered;
};

const inSpan = (at: number, span: Span): boolean => at >= span.start && at < span.end;

const walkToEnd = (events: readonly LedgerEvent[], span: Span): Walk =>
  events
    .filter((e) => e.at < span.end)
    .reduce<Walk>(
      (walk, e) => {
        const next = evolve(walk.end, e);
        const job = e.job;
        if (job === null) return { ...walk, end: next };
        const gained = inSpan(e.at, span)
          ? tappedHoursMs(next.jobs[job]) - tappedHoursMs(walk.end.jobs[job])
          : 0;
        return {
          end: next,
          hoursMs: walk.hoursMs + gained,
          delivered: deliveredAfter(walk.delivered, job, e),
        };
      },
      { end: emptyState(), hoursMs: 0, delivered: {} },
    );

const groupOf = (status: JobStatus): Group => {
  if (status === "helped" || status === "unreached" || status === "withdrawn") return status;
  return status === "unmet" ? "unmet" : "stillOpen";
};

const countedJobs = (start: HubState, end: HubState, span: Span): Counted[] =>
  Object.values(end.jobs).flatMap<Counted>((job) => {
    if (job.createdAt >= span.start) return [{ job, open: false, group: groupOf(job.status) }];
    const before = start.jobs[job.id];
    if (before === undefined || CLOSED.includes(before.status)) return [];
    return [{ job, open: true, group: groupOf(job.status) }];
  });

const tally = (counted: readonly Counted[], group: Group): number =>
  counted.filter((c) => c.group === group).length;

const unmetTable = (counted: readonly Counted[], end: HubState): Statement["unmetTable"] => {
  const rows = new Map<string, Statement["unmetTable"][number]>();
  for (const { job } of counted.filter((c) => c.group === "unmet")) {
    const zip = end.cards[job.card]?.zip ?? null;
    const key = `${job.need}|${zip ?? ""}`;
    const row = rows.get(key) ?? { need: job.need, zip, count: 0 };
    rows.set(key, { ...row, count: row.count + 1 });
  }
  return [...rows.values()].sort(
    (a, b) => b.count - a.count || a.need.localeCompare(b.need) || (a.zip ?? "").localeCompare(b.zip ?? ""),
  );
};

const promiseFigures = (walk: Walk, span: Span, lastAt: number): Statement["promise"] => {
  const due = Object.values(walk.end.jobs).filter(
    (job) =>
      inSpan(job.promiseAt, span) &&
      job.status !== "withdrawn" &&
      (job.promiseAt <= lastAt || walk.delivered[job.id] !== undefined),
  );
  const kept = due.filter((job) => {
    const at = walk.delivered[job.id];
    return at !== undefined && at <= job.promiseAt;
  });
  return { kept: kept.length, due: due.length };
};

const distinctJobs = (events: readonly LedgerEvent[], pick: (e: LedgerEvent) => boolean): number =>
  new Set(events.filter(pick).map((e) => e.job ?? `card:${e.card ?? ""}`)).size;

const wrongFigures = (
  inMonth: readonly LedgerEvent[],
  promise: Statement["promise"],
): Statement["wrong"] => ({
  mismatches: inMonth.filter((e) => e.type === "job.reopened" && e.data.as === "mismatch").length,
  latePromises: promise.due - promise.kept,
  deskChanges: inMonth.filter((e) => e.type === "card.confirmed" && e.data.changed).length,
  pagesMoved: inMonth.filter((e) => e.type === "page.moved").length,
  noVolunteer: distinctJobs(inMonth, (e) => e.type === "job.returned" && e.data.reason === "no_volunteer"),
});

const erasedFigures = (inMonth: readonly LedgerEvent[]): Statement["erased"] => {
  const erased = inMonth.reduce((sum, e) => (e.type === "vault.erased" ? sum + e.data.erased : sum), 0);
  return { erased, due: erased };
};

const groups = (counted: readonly Counted[]) => ({
  openAtStart: counted.filter((c) => c.open).length,
  new: counted.filter((c) => !c.open).length,
  helped: tally(counted, "helped"),
  unreached: tally(counted, "unreached"),
  withdrawn: tally(counted, "withdrawn"),
  unmet: tally(counted, "unmet"),
  stillOpen: tally(counted, "stillOpen"),
});

export const statement = (events: readonly LedgerEvent[], month: string): Statement => {
  const span = monthBounds(month, "America/Chicago");
  const walk = walkToEnd(events, span);
  const atStart = fold(events.filter((e) => e.at < span.start));
  const counted = countedJobs(atStart, walk.end, span);
  const inMonth = events.filter((e) => inSpan(e.at, span));
  const figures = groups(counted);
  const lastAt = events.reduce((max, e) => Math.max(max, e.at), Number.NEGATIVE_INFINITY);
  const promise = promiseFigures(walk, span, lastAt);
  const left = figures.openAtStart + figures.new;
  const right = figures.helped + figures.unreached + figures.withdrawn + figures.unmet + figures.stillOpen;
  return {
    month,
    ...figures,
    balanced: left === right,
    wrong: wrongFigures(inMonth, promise),
    promise,
    unmetTable: unmetTable(counted, walk.end),
    hours: Math.round((walk.hoursMs / HOUR_MS) * 100) / 100,
    erased: erasedFigures(inMonth),
    seal: { seq: walk.end.seq, hash: walk.end.lastHash },
    method: METHOD,
  };
};
