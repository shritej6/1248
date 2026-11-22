import type { EventType, LedgerEvent } from "@vision/contracts";
import { CLOCKS } from "./clocks.js";
import { aiHandlers } from "./evolveai.js";
import { afterConfirm, afterRaise, isAiLow, isSeriousMiss, recordOf } from "./needrecord.js";
import { emptyState, type CardState, type HubState, type JobState, type PartnerCounts } from "./state.js";
import { endOpenSpans, tapDone, tapStart } from "./taps.js";

type EventOf<K extends EventType> = Extract<LedgerEvent, { type: K }>;
type Handlers = { [K in EventType]: (state: HubState, event: EventOf<K>) => HubState };

const same = (state: HubState): HubState => state;
const addOnce = <T>(items: readonly T[], item: T): T[] =>
  items.includes(item) ? [...items] : [...items, item];

const updateCard = (state: HubState, id: string | null, change: (card: CardState) => CardState): HubState => {
  const card = id === null ? undefined : state.cards[id];
  return card ? { ...state, cards: { ...state.cards, [card.id]: change(card) } } : state;
};

const updateJob = (state: HubState, id: string | null, change: (job: JobState) => JobState): HubState => {
  const job = id === null ? undefined : state.jobs[id];
  return job ? { ...state, jobs: { ...state.jobs, [job.id]: change(job) } } : state;
};

const checkbackAfter = (state: HubState, job: JobState, at: number): JobState["checkback"] => {
  const urgent = state.cards[job.card]?.urgency === "high";
  return { dueAt: at + (urgent ? CLOCKS.checkbackUrgent : CLOCKS.checkbackNormal), tries: 0, sentAt: null };
};

const backToDesk = (job: JobState): JobState => ({
  ...job,
  status: "planned",
  holderRef: null,
  helpers: [],
  wave: 0,
  waveAt: null,
  acceptedAt: null,
  onMyWayAt: null,
  thereAt: null,
  doneAt: null,
  checkback: null,
});

const countFor = (state: HubState, partner: string, key: keyof PartnerCounts): HubState => {
  const counts = state.partnerCounts[partner] ?? { asked: 0, yes: 0, gotIt: 0, helped: 0 };
  return {
    ...state,
    partnerCounts: { ...state.partnerCounts, [partner]: { ...counts, [key]: counts[key] + 1 } },
  };
};

const tapHours = (job: JobState, at: number): number => {
  const start = job.onMyWayAt ?? job.thereAt ?? job.acceptedAt;
  return start === null ? 0 : Math.max(0, at - start);
};

const received = (state: HubState, e: EventOf<"card.received">): HubState => {
  if (e.card === null || state.cards[e.card]) return state;
  const card: CardState = {
    id: e.card,
    receivedAt: e.at,
    door: e.data.door,
    zip: e.data.zip,
    safeContact: e.data.safeContact,
    sorted: null,
    confirmedAt: null,
    need: null,
    urgency: null,
    division: null,
    level: null,
    quiet: !e.data.safeContact,
    routeCode: null,
    changed: false,
    promiseAt: null,
    jobs: [],
    lang: e.data.lang ?? null,
    ai: {},
    gistAt: null,
  };
  return { ...state, cards: { ...state.cards, [card.id]: card } };
};

const confirmed = (state: HubState, e: EventOf<"card.confirmed">): HubState => {
  if (e.card === null || !state.cards[e.card]) return state;
  const { need, changed } = e.data;
  const before = state.cards[e.card];
  const serious = changed && before !== undefined && isSeriousMiss(before, e.data.urgency);
  const next = afterConfirm(recordOf(state, need), changed, serious);
  const withCard = updateCard(state, e.card, (card) => ({
    ...card,
    ...e.data,
    confirmedAt: e.at,
    quiet: card.quiet || e.data.quiet,
  }));
  return {
    ...withCard,
    counters: { ...state.counters, [need]: (state.counters[need] ?? 0) + 1 },
    needRecords: e.data.level === 1 ? state.needRecords : { ...state.needRecords, [need]: next },
  };
};

const raisedMiss = (card: CardState | undefined, actor: LedgerEvent["actor"]): string | null =>
  card !== undefined &&
  card.need !== null &&
  card.urgency !== "high" &&
  isAiLow(card) &&
  actor.role !== "system"
    ? card.need
    : null;

const raised = (state: HubState, e: EventOf<"card.raised">): HubState => {
  const need = raisedMiss(e.card === null ? undefined : state.cards[e.card], e.actor);
  const counted =
    need === null
      ? state
      : { ...state, needRecords: { ...state.needRecords, [need]: afterRaise(recordOf(state, need)) } };
  return updateCard(counted, e.card, (card) => ({ ...card, urgency: e.data.to }));
};

const pageSent = (state: HubState, e: EventOf<"page.sent">): HubState => {
  if (e.card === null || !state.cards[e.card] || state.pages[e.data.page]) return state;
  const page = {
    id: e.data.page,
    card: e.card,
    to: e.data.to,
    reason: e.data.reason,
    step: e.data.step,
    sentAt: e.at,
    movedAt: null,
    answeredAt: null,
    answeredBy: null,
  };
  return { ...state, pages: { ...state.pages, [page.id]: page } };
};

const updatePage = (
  state: HubState,
  id: string,
  change: (p: HubState["pages"][string]) => HubState["pages"][string],
) => {
  const page = state.pages[id];
  return page ? { ...state, pages: { ...state.pages, [id]: change(page) } } : state;
};

const planned = (state: HubState, e: EventOf<"job.planned">): HubState => {
  const card = e.card === null ? undefined : state.cards[e.card];
  if (!card || e.job === null || state.jobs[e.job]) return state;
  const job: JobState = {
    id: e.job,
    card: card.id,
    need: e.data.need,
    path: e.data.path,
    rung: e.data.rung,
    level: e.data.level,
    quiet: e.data.quiet || card.quiet,
    status: "planned",
    approved: false,
    wave: 0,
    waveAt: null,
    holderRef: null,
    helpers: [],
    excluded: [],
    flags: [],
    returnReason: null,
    createdAt: e.at,
    promiseAt: e.data.promiseAt,
    acceptedAt: null,
    onMyWayAt: null,
    thereAt: null,
    doneAt: null,
    askedAt: null,
    yesAt: null,
    gotItAt: null,
    checkback: null,
    closedAt: null,
    hoursMs: 0,
    partner: null,
  };
  const withJob = { ...state, jobs: { ...state.jobs, [job.id]: job } };
  return updateCard(withJob, card.id, (c) => ({ ...c, jobs: addOnce(c.jobs, job.id) }));
};

const accepted = (state: HubState, e: EventOf<"offer.accepted">): HubState =>
  updateJob(state, e.job, (job) => {
    const { member } = e.data;
    if (job.holderRef === null) {
      return { ...job, status: "accepted", holderRef: member, acceptedAt: e.at, returnReason: null };
    }
    return member === job.holderRef ? job : { ...job, helpers: addOnce(job.helpers, member) };
  });

const done = (state: HubState, e: EventOf<"job.done">): HubState =>
  updateJob(state, e.job, (job) => ({
    ...tapDone(job, e.data.member, e.at, e.data.outcome !== "not_done"),
    status: "done",
    doneAt: e.at,
    hoursMs: job.hoursMs + tapHours(job, e.at),
    checkback: e.data.outcome === "not_done" ? null : checkbackAfter(state, job, e.at),
  }));

const gotIt = (state: HubState, e: EventOf<"job.got_it">): HubState =>
  updateJob(countFor(state, e.data.partner, "gotIt"), e.job, (job) => ({
    ...job,
    status: "got_it",
    path: "partner",
    holderRef: e.data.partner,
    partner: e.data.partner,
    gotItAt: e.at,
    checkback: checkbackAfter(state, job, e.at),
  }));

const closed = (state: HubState, e: EventOf<"job.closed">): HubState => {
  const job = e.job === null ? undefined : state.jobs[e.job];
  const helpedBy =
    e.data.result === "helped" && job !== undefined && job.gotItAt !== null ? job.partner : null;
  const counted = helpedBy === null ? state : countFor(state, helpedBy, "helped");
  return updateJob(counted, e.job, (j) => ({ ...j, status: e.data.result, closedAt: e.at, checkback: null }));
};

const countMismatch = (state: HubState, e: EventOf<"job.reopened">): HubState =>
  e.data.as === "mismatch" && e.job !== null && state.jobs[e.job]
    ? { ...state, mismatches: { ...state.mismatches, [e.job]: (state.mismatches[e.job] ?? 0) + 1 } }
    : state;

const reopened = (state: HubState, e: EventOf<"job.reopened">): HubState =>
  updateJob(countMismatch(state, e), e.job, (job) => ({
    ...backToDesk(endOpenSpans(job, e.at)),
    status: e.data.as,
    excluded: e.data.exclude === null ? job.excluded : addOnce(job.excluded, e.data.exclude),
    partner: null,
    returnReason: e.data.as,
  }));

const rungMoved = (state: HubState, e: EventOf<"job.rung_moved">): HubState =>
  updateJob(state, e.job, (job) => ({
    ...backToDesk(endOpenSpans(job, e.at)),
    rung: e.data.to,
    partner: null,
    askedAt: null,
    yesAt: null,
  }));

const cardHandlers = {
  "card.received": received,
  "card.sorted": (s: HubState, e: EventOf<"card.sorted">) =>
    updateCard(s, e.card, (card) => ({ ...card, sorted: { ...e.data, flags: [...e.data.flags] } })),
  "card.confirmed": confirmed,
  "card.raised": raised,
  "receipt.sent": (s: HubState, e: EventOf<"receipt.sent">) =>
    updateCard(s, e.card, (card) => ({ ...card, promiseAt: e.data.promiseAt })),
  "page.sent": pageSent,
  "page.moved": (s: HubState, e: EventOf<"page.moved">) =>
    updatePage(s, e.data.page, (p) => ({ ...p, to: e.data.to, step: e.data.step, movedAt: e.at })),
  "page.answered": (s: HubState, e: EventOf<"page.answered">) =>
    updatePage(s, e.data.page, (p) => ({ ...p, answeredAt: e.at, answeredBy: e.data.by })),
  "thread.posted": same,
} satisfies Partial<Handlers>;

const jobStatusHandlers = {
  "job.planned": planned,
  "job.approved": (s: HubState, e: EventOf<"job.approved">) =>
    updateJob(s, e.job, (j) => ({ ...j, approved: true })),
  "offer.wave_sent": (s: HubState, e: EventOf<"offer.wave_sent">) =>
    updateJob(s, e.job, (j) => ({
      ...j,
      status: "offered",
      path: "volunteers",
      wave: e.data.wave,
      waveAt: e.at,
      returnReason: null,
    })),
  "offer.accepted": accepted,
  "offer.closed": (s: HubState, e: EventOf<"offer.closed">) =>
    updateJob(s, e.job, (j) => ({ ...j, waveAt: null })),
  "job.returned": (s: HubState, e: EventOf<"job.returned">) =>
    updateJob(s, e.job, (j) => ({
      ...backToDesk(endOpenSpans(j, e.at)),
      excluded:
        e.data.reason === "hand_off" && j.holderRef !== null ? addOnce(j.excluded, j.holderRef) : j.excluded,
      returnReason: e.data.reason,
    })),
  "job.on_my_way": (s: HubState, e: EventOf<"job.on_my_way">) =>
    updateJob(s, e.job, (j) => ({
      ...tapStart(j, e.data.member, e.at),
      status: "on_my_way",
      onMyWayAt: e.at,
    })),
  "job.there": (s: HubState, e: EventOf<"job.there">) =>
    updateJob(s, e.job, (j) => ({ ...tapStart(j, e.data.member, e.at), status: "there", thereAt: e.at })),
  "job.done": done,
  "job.help": same,
  "job.rung_moved": rungMoved,
  "job.unmet": (s: HubState, e: EventOf<"job.unmet">) =>
    updateJob(s, e.job, (j) => ({ ...j, status: "unmet", path: "unmet" })),
  "job.reopened": reopened,
  "job.closed": closed,
} satisfies Partial<Handlers>;

const partnerHandlers = {
  "consent.asked": (s: HubState, e: EventOf<"consent.asked">) =>
    updateJob(s, e.job, (j) => ({
      ...j,
      status: "consent_asked",
      path: "partner",
      partner: e.data.partner,
      askedAt: e.at,
    })),
  "consent.answered": same,
  "partner.asked": (s: HubState, e: EventOf<"partner.asked">) =>
    updateJob(countFor(s, e.data.partner, "asked"), e.job, (j) => ({
      ...j,
      status: "partner_asked",
      path: "partner",
      partner: e.data.partner,
      askedAt: e.at,
    })),
  "partner.answered": (s: HubState, e: EventOf<"partner.answered">) => {
    const partnerAnswer = {
      partner: e.data.partner,
      answer: e.data.answer,
      at: e.at,
      waitUntil: e.data.waitUntil ?? null,
    };
    return e.data.answer === "yes"
      ? updateJob(countFor(s, e.data.partner, "yes"), e.job, (j) => ({
          ...j,
          status: "partner_yes",
          yesAt: e.at,
          partnerAnswer,
        }))
      : updateJob(s, e.job, (j) => ({ ...j, partnerAnswer }));
  },
  "promise.accepted": (s: HubState, e: EventOf<"promise.accepted">) => ({
    ...s,
    promises: addOnce(s.promises, e.data.partner),
  }),
  "job.got_it": gotIt,
} satisfies Partial<Handlers>;

const followHandlers = {
  "checkback.sent": (s: HubState, e: EventOf<"checkback.sent">) =>
    updateJob(s, e.job, (j) => ({
      ...j,
      checkback: { dueAt: e.at + CLOCKS.checkbackReply, tries: e.data.try, sentAt: e.at },
    })),
  "checkback.answered": (s: HubState, e: EventOf<"checkback.answered">) =>
    updateJob(s, e.job, (j) => ({ ...j, checkback: null })),
  "job.flagged": (s: HubState, e: EventOf<"job.flagged">) =>
    updateJob(s, e.job, (j) => ({ ...j, flags: addOnce(j.flags, e.data.flag) })),
  "job.flag_cleared": (s: HubState, e: EventOf<"job.flag_cleared">) =>
    updateJob(s, e.job, (j) => ({ ...j, flags: j.flags.filter((f) => f !== e.data.flag) })),
} satisfies Partial<Handlers>;

const orgHandlers = {
  "shift.taken": (s: HubState, e: EventOf<"shift.taken">) => ({ ...s, deskOnShift: e.data.member }),
  "playbook.loaded": (s: HubState, e: EventOf<"playbook.loaded">) => ({
    ...s,
    playbookVersion: e.data.version,
  }),
  "need.level_set": (s: HubState, e: EventOf<"need.level_set">) => ({
    ...s,
    levels: { ...s.levels, needs: { ...s.levels.needs, [e.data.need]: e.data.level } },
  }),
  "levels.master_set": (s: HubState, e: EventOf<"levels.master_set">) => ({
    ...s,
    levels: { ...s.levels, master: e.data.on },
  }),
  "clock.jumped": (s: HubState, e: EventOf<"clock.jumped">) => ({
    ...s,
    clockOffsetMs: s.clockOffsetMs + e.data.byMs,
  }),
  "vault.erased": same,
} satisfies Partial<Handlers>;

const handlers: Handlers = {
  ...cardHandlers,
  ...jobStatusHandlers,
  ...partnerHandlers,
  ...followHandlers,
  ...orgHandlers,
  ...aiHandlers,
};

export const evolve = (state: HubState, event: LedgerEvent): HubState => {
  const handle = handlers[event.type] as (s: HubState, e: LedgerEvent) => HubState;
  return { ...handle(state, event), seq: event.seq, lastHash: event.hash };
};

export const fold = (events: readonly LedgerEvent[], from: HubState = emptyState()): HubState =>
  events.reduce(evolve, from);
