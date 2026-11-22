import type { Tracking } from "@vision/contracts";
import { cardForgetAt } from "../forget.js";
import { isClosed } from "../holder.js";
import type { CardState, HubState, JobState } from "../state.js";
import { clockView, needLabel, partnerName, textsOf, type VaultReader, type ViewContext } from "./common.js";

type Step = Tracking["steps"][number];

const stepOf = (word: string, at: number | null): Step[] => (at === null ? [] : [{ word, at }]);

const jobSteps = (ctx: ViewContext, job: JobState): Step[] => [
  ...stepOf("A volunteer has it", job.acceptedAt),
  ...stepOf("On the way", job.onMyWayAt),
  ...stepOf("Arrived", job.thereAt),
  ...stepOf("Done", job.doneAt),
  ...stepOf(`${partnerName(ctx, job.partner) ?? "A partner"} has it`, job.gotItAt),
  ...stepOf("Confirmed", job.status === "helped" ? job.closedAt : null),
];

const stepsOf = (ctx: ViewContext, card: CardState, jobs: readonly JobState[]): Step[] =>
  [
    ...stepOf("Received", card.receivedAt),
    ...stepOf("Sorted", card.confirmedAt),
    ...jobs.flatMap((job) => jobSteps(ctx, job)),
  ].sort((a, b) => a.at - b.at);

export const closedTracking = (state: HubState, ctx: ViewContext): Tracking => ({
  routeCode: null,
  closed: true,
  steps: [],
  messages: [],
  consentAsk: null,
  checkbackAsk: null,
  forgetAt: null,
  clock: clockView(state, ctx),
  orgName: ctx.config.orgName,
});

const asks = (ctx: ViewContext, open: readonly JobState[]): Pick<Tracking, "consentAsk" | "checkbackAsk"> => {
  const consent = open.find((job) => job.status === "consent_asked");
  const checkback = open.find((job) => job.checkback !== null && job.checkback.sentAt !== null);
  return {
    consentAsk:
      consent === undefined
        ? null
        : {
            job: consent.id,
            partnerName: partnerName(ctx, consent.partner) ?? "",
            needLabel: needLabel(ctx, consent.need),
          },
    checkbackAsk:
      checkback === undefined ? null : { job: checkback.id, needLabel: needLabel(ctx, checkback.need) },
  };
};

export const trackingView = (
  state: HubState,
  vault: VaultReader,
  ctx: ViewContext,
  cardId: string,
): Tracking => {
  const card = state.cards[cardId];
  if (card === undefined) return closedTracking(state, ctx);
  const jobs = card.jobs.flatMap((id) => state.jobs[id] ?? []);
  const open = jobs.filter((job) => !isClosed(job.status));
  if (jobs.length > 0 && open.length === 0)
    return {
      ...closedTracking(state, ctx),
      forgetAt: cardForgetAt(state, cardId, ctx.now, ctx.config.forgetDays),
    };
  const messages = textsOf(vault, cardId, "message_out").map((line) => ({ at: line.at, text: line.text }));
  return {
    routeCode: card.routeCode,
    closed: false,
    steps: stepsOf(ctx, card, jobs),
    messages,
    ...asks(ctx, open),
    forgetAt: null,
    clock: clockView(state, ctx),
    orgName: ctx.config.orgName,
    lang: card.lang ?? "en",
  };
};
