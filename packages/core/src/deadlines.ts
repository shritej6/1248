import type { Actor, Deadline, DecideContext, Decision, Effect } from "@vision/contracts";
import { CLOCKS } from "./clocks.js";
import { decide } from "./decide.js";
import { pendingDeadlines } from "./decide/timers.js";
import type { HubState } from "./state.js";

export const MAX_FIRES = 1000;

const SYSTEM: Actor = { role: "system", ref: null };

export type ApplyDecision = (decision: Decision, at: number, deadline: Deadline) => HubState;

const keyOf = (d: Deadline): string =>
  `${d.kind}|${d.card}|${d.job ?? ""}|${d.page ?? ""}|${String(d.step)}|${String(d.at)}`;

export const dueDeadlines = (state: HubState, ctx: DecideContext, now: number): Deadline[] =>
  pendingDeadlines(state, ctx).filter((deadline) => deadline.at <= now);

export const nextDeadlineAt = (state: HubState, ctx: DecideContext): number | null =>
  pendingDeadlines(state, ctx)[0]?.at ?? null;

const trackOffered = (
  offered: DecideContext["offered"],
  effects: readonly Effect[],
): DecideContext["offered"] =>
  effects.reduce<DecideContext["offered"]>((acc, effect) => {
    if (effect.kind === "offer")
      return { ...acc, [effect.job]: [...(acc[effect.job] ?? []), ...effect.members] };
    if (effect.kind === "offer_closed") return { ...acc, [effect.job]: [] };
    return acc;
  }, offered);

export class TimerBacklogError extends Error {
  constructor(readonly due: number) {
    super(`Clocks still due after ${String(MAX_FIRES)} fires: ${String(due)}`);
    this.name = "TimerBacklogError";
  }
}

const fireTime = (next: Deadline, due: readonly Deadline[], now: number): number => {
  if (next.kind !== "page_answer") return next.at;
  const other = due.find((d) => d !== next && d.kind !== "page_answer");
  const moves =
    other === undefined
      ? Math.floor((now - next.at) / CLOCKS.pageAnswer) + 1
      : Math.max(1, Math.ceil((other.at - next.at) / CLOCKS.pageAnswer));
  return next.at + (moves - 1) * CLOCKS.pageAnswer;
};

export const runDue = (state: HubState, ctx: DecideContext, now: number, apply: ApplyDecision): HubState => {
  const fired = new Set<string>();
  let current = state;
  let offered = ctx.offered;
  const unfired = (): Deadline[] =>
    dueDeadlines(current, { ...ctx, offered }, now).filter((d) => !fired.has(keyOf(d)));
  for (let i = 0; i < MAX_FIRES; i += 1) {
    const due = unfired();
    const next = due[0];
    if (next === undefined) return current;
    fired.add(keyOf(next));
    const at = fireTime(next, due, now);
    const decision = decide(current, { type: "timer.fired", deadline: next }, SYSTEM, {
      ...ctx,
      now: at,
      offered,
    });
    current = apply(decision, at, next);
    if (decision.ok) offered = trackOffered(offered, decision.effects);
  }
  const left = unfired().length;
  if (left > 0) throw new TimerBacklogError(left);
  return current;
};
