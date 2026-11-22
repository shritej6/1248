import type {
  DeadlineKind,
  DeskBoard,
  DeskCard,
  DeskJob,
  DeskVolunteer,
  Holder,
  PageView,
} from "@vision/contracts";
import { pendingDeadlines } from "../decide/timers.js";
import { holderOf, isClosed } from "../holder.js";
import { cardIsQuiet, suggestedNeed } from "../quiet.js";
import { openJobsByMember } from "../wave.js";
import type { CardState, HubState, JobState } from "../state.js";
import { cardLinks, eventGroups, type Shown } from "./link.js";
import {
  clockView,
  memberName,
  needLabel,
  partnerName,
  textsOf,
  type VaultReader,
  type ViewContext,
  type Viewer,
} from "./common.js";

const CLOCK_LABELS: Record<DeadlineKind, string> = {
  desk_confirm: "Desk confirm",
  page_answer: "Page answer",
  wave: "Wave wait",
  claim: "Start travel",
  visit: "Visit safety",
  consent: "Consent wait",
  partner_reply: "Partner reply",
  got_it: "GOT IT wait",
  checkback: "Check-back",
  checkback_reply: "Check-back reply",
};

const isQuiet = (ctx: ViewContext, card: CardState): boolean => cardIsQuiet(ctx.playbook, card);

const shownTo =
  (ctx: ViewContext, seesQuiet: boolean) =>
  (card: CardState | undefined): boolean =>
    card !== undefined && (seesQuiet || !isQuiet(ctx, card));

const needChoices = (ctx: ViewContext): DeskCard["needOptions"] =>
  ctx.playbook.rows.map((row) => ({ need: row.need, label: row.label }));

const aiFields = (state: HubState, card: CardState, vault: VaultReader, shown: Shown) => ({
  lang: card.lang ?? "en",
  ai: { ...card.ai },
  translation: textsOf(vault, card.id, "translation").at(-1)?.text ?? null,
  links: cardLinks(state, card.id, shown),
});

const deskCard = (
  state: HubState,
  card: CardState,
  vault: VaultReader,
  ctx: ViewContext,
  shown: Shown,
): DeskCard => {
  const sorted = card.sorted;
  return {
    card: card.id,
    receivedAt: card.receivedAt,
    door: card.door,
    zip: card.zip,
    message: textsOf(vault, card.id, "message_in")
      .map((line) => line.text)
      .join("\n"),
    quotes: textsOf(vault, card.id, "quote").map((line) => line.text),
    sorted:
      sorted === null
        ? null
        : {
            service: sorted.service,
            division: sorted.division,
            urgency: sorted.urgency,
            source: sorted.source,
          },
    flags: sorted === null ? [] : [...sorted.flags],
    needOptions: needChoices(ctx),
    suggestedNeed: suggestedNeed(ctx.playbook, sorted?.service ?? null),
    quiet: isQuiet(ctx, card),
    ...aiFields(state, card, vault, shown),
  };
};

const holderName = (holder: Holder, ctx: ViewContext): string | null => {
  if (holder.kind === "none") return null;
  if (holder.kind === "partner") return partnerName(ctx, holder.partner);
  return memberName(ctx, holder.member);
};

const jobClock = (state: HubState, ctx: ViewContext, job: JobState): DeskJob["clock"] => {
  const next = pendingDeadlines(state, ctx).find((d) => d.job === job.id);
  return next === undefined ? null : { label: CLOCK_LABELS[next.kind], dueAt: next.at };
};

const partnerAnswerOf = (vault: VaultReader, ctx: ViewContext, job: JobState): DeskJob["partnerAnswer"] => {
  const last = job.partnerAnswer;
  if (last === undefined) return null;
  const reason = textsOf(vault, job.card, "partner_reason")
    .filter((line) => line.job === job.id && line.at >= last.at)
    .at(-1);
  return {
    partnerName: partnerName(ctx, last.partner) ?? "",
    answer: last.answer,
    reason: reason?.text ?? null,
    waitUntil: last.waitUntil,
  };
};

export const deskJob = (state: HubState, vault: VaultReader, ctx: ViewContext, job: JobState): DeskJob => {
  const holder = holderOf(state, job.id, ctx);
  return {
    job: job.id,
    card: job.card,
    routeCode: state.cards[job.card]?.routeCode ?? "",
    needLabel: needLabel(ctx, job.need),
    status: job.status,
    holder: { kind: holder.kind, name: holderName(holder, ctx) },
    clock: jobClock(state, ctx, job),
    flags: [...job.flags],
    returnReason: job.returnReason,
    mismatch: job.status === "mismatch",
    promiseLate: ctx.now > job.promiseAt && job.doneAt === null && job.gotItAt === null,
    partnerLink: job.partner === null ? null : ctx.links.partner(job.id),
    partnerAnswer: partnerAnswerOf(vault, ctx, job),
  };
};

const isOpenCard = (state: HubState, card: CardState): boolean =>
  card.jobs.length === 0 || card.jobs.some((id) => !isClosed(state.jobs[id]?.status ?? "withdrawn"));

const isHigh = (card: CardState): boolean => (card.urgency ?? card.sorted?.urgency) === "high";

const pageView = (page: HubState["pages"][string]): PageView => ({
  page: page.id,
  card: page.card,
  reason: page.reason,
  sentAt: page.sentAt,
  to: page.to,
});

const deskVolunteers = (state: HubState, ctx: ViewContext): DeskVolunteer[] => {
  const open = openJobsByMember(state);
  return ctx.memberRecords
    .filter((member) => member.roles.includes("volunteer"))
    .map((member) => ({
      member: member.id,
      name: member.name,
      skills: [...member.skills],
      zone: member.zip,
      on: member.on,
      openJobs: open[member.id] ?? 0,
    }))
    .sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
};

export const deskView = (
  state: HubState,
  vault: VaultReader,
  ctx: ViewContext,
  viewer: Viewer,
): DeskBoard => {
  const seesQuiet = viewer.role === "lead";
  const shown = shownTo(ctx, seesQuiet);
  const cards = Object.values(state.cards).sort((a, b) => a.receivedAt - b.receivedAt);
  const waiting = cards.filter((card) => card.confirmedAt === null && shown(card));
  const jobs = Object.values(state.jobs)
    .filter((job) => !isClosed(job.status) && (seesQuiet || !job.quiet) && shown(state.cards[job.card]))
    .sort((a, b) => a.promiseAt - b.promiseAt);
  const onShift = state.deskOnShift;
  return {
    onShift: onShift === null ? null : { member: onShift, name: memberName(ctx, onShift) ?? "" },
    emergency: waiting.filter(isHigh).map((card) => deskCard(state, card, vault, ctx, shown)),
    triage: waiting.filter((card) => !isHigh(card)).map((card) => deskCard(state, card, vault, ctx, shown)),
    jobs: jobs.map((job) => deskJob(state, vault, ctx, job)),
    pages: Object.values(state.pages)
      .filter((page) => page.answeredAt === null && shown(state.cards[page.card]))
      .sort((a, b) => a.sentAt - b.sentAt)
      .map(pageView),
    quietCount: cards.filter((card) => isQuiet(ctx, card) && isOpenCard(state, card)).length,
    needOptions: needChoices(ctx),
    volunteers: deskVolunteers(state, ctx),
    clock: clockView(state, ctx),
    orgName: ctx.config.orgName,
    eventGroups: eventGroups(
      state,
      cards.filter((card) => shown(card) && isOpenCard(state, card)).map((card) => card.id),
    ),
  };
};
