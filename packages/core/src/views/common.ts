import type {
  ClockView,
  DecideContext,
  MemberRecord,
  PartnerRecord,
  PlaybookRow,
  Rejection,
  ThreadLine,
} from "@vision/contracts";
import type { HubState } from "../state.js";

export type VaultPerson = { firstName: string; contact: string; address: string | null };
export type VaultTextLine = {
  at: number;
  job: string | null;
  textKind: string;
  text: string;
  from: ThreadLine["from"];
};

export type VaultReader = {
  person(card: string): VaultPerson | null;
  texts(card: string): VaultTextLine[];
};

export type ViewContext = DecideContext & {
  memberRecords: MemberRecord[];
  partners: PartnerRecord[];
  links: { partner(job: string): string | null };
};

export type Viewer = { role: MemberRecord["roles"][number]; member: string };

export const DAY_MS = 86_400_000;

export const clockView = (state: HubState, ctx: ViewContext): ClockView => ({
  now: ctx.now,
  offsetMs: state.clockOffsetMs,
});

export const rowFor = (ctx: ViewContext, need: string): PlaybookRow | undefined =>
  ctx.playbook.rows.find((row) => row.need === need);

export const needLabel = (ctx: ViewContext, need: string): string => rowFor(ctx, need)?.label ?? need;

export const memberName = (ctx: ViewContext, member: string | null): string | null =>
  member === null ? null : (ctx.memberRecords.find((m) => m.id === member)?.name ?? null);

export const partnerName = (ctx: ViewContext, partner: string | null): string | null =>
  partner === null ? null : (ctx.partners.find((p) => p.id === partner)?.name ?? null);

export const textsOf = (vault: VaultReader, card: string, kind: string): VaultTextLine[] =>
  vault.texts(card).filter((line) => line.textKind === kind);

export const rejection = (code: Rejection["code"], message: string): Rejection => ({ code, message });
