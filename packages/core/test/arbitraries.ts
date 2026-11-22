import fc from "fast-check";
import type {
  Actor,
  EventDataOf,
  EventDraft,
  EventType,
  JobStatus,
  LedgerEvent,
  MemberPublic,
  Playbook,
  PlaybookRow,
  Urgency,
} from "@vision/contracts";
import { CHECKBACK_TRIES } from "../src/clocks.js";
import { fold } from "../src/evolve.js";
import { GENESIS_HASH, sealEvent } from "../src/seal.js";
import type { HubState } from "../src/state.js";

export const uid = (prefix: string, n: number): string =>
  `${prefix}00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const IDS = {
  desk: uid("m_", 1),
  desk2: uid("m_", 2),
  owner: uid("m_", 3),
  lead: uid("m_", 4),
  v01: uid("m_", 11),
  v02: uid("m_", 12),
  pantry: uid("p_", 1),
  card: uid("c_", 1),
  job: uid("j_", 1),
} as const;

export const BASE_AT = 1_800_000_000_000;

const row = (need: string, over: Partial<PlaybookRow>): PlaybookRow => ({
  need,
  label: need,
  service: "Other",
  defaultForService: false,
  code: need.slice(0, 4).toUpperCase(),
  level: 2,
  owner: IDS.owner,
  skill: need,
  promiseHours: 48,
  quiet: false,
  crew: 1,
  bring: null,
  ladder: [{ path: "volunteers" }, { path: "unmet" }],
  ...over,
});

export const playbook: Playbook = {
  version: "test-1",
  rows: [
    row("snow", { service: "Free services for elderly, disabled, pregnant (lawn care, snow removal)" }),
    row("food", {
      service: "Meal Programs / Pantry",
      ladder: [
        { path: "partner", partner: IDS.pantry, replyMinutes: 120 },
        { path: "volunteers" },
        { path: "unmet" },
      ],
    }),
    row("text_extraction", { code: "TEXT", level: 3, quiet: true }),
  ],
};

const member = (id: string, roles: MemberPublic["roles"], skills: string[]): MemberPublic => ({
  id,
  roles,
  skills,
  zip: "53216",
  on: true,
  lastJobAt: null,
});

export const members: MemberPublic[] = [
  member(IDS.desk, ["desk"], []),
  member(IDS.desk2, ["desk"], []),
  member(IDS.owner, ["organiser"], []),
  member(IDS.lead, ["lead"], []),
  member(IDS.v01, ["volunteer"], ["snow", "food"]),
  member(IDS.v02, ["volunteer"], ["snow"]),
];

export const ctx = { playbook, members };

export type Body = { [K in EventType]: { type: K; data: EventDataOf<K> } }[EventType];
type Model = { status: JobStatus; member: string | null; tries: number; wave: number; rung: number };
type Option = { bodies: Body[]; next: Model; actor?: Actor };

const SYSTEM: Actor = { role: "system", ref: null };
const tryNo = (n: number): 1 | 2 | 3 => (n <= 1 ? 1 : n === 2 ? 2 : 3);
const vol = (m: Model): Actor => ({ role: "volunteer", ref: m.member });
const stay = (m: Model, body: Body): Option => ({ bodies: [body], next: m });

const withdraw = (m: Model): Option => ({
  bodies: [{ type: "job.closed", data: { result: "withdrawn", reason: "cancelled" } }],
  next: { ...m, status: "withdrawn" },
});
const wave = (m: Model): Option => ({
  bodies: [{ type: "offer.wave_sent", data: { wave: m.wave + 1, count: 2 } }],
  next: { ...m, status: "offered", wave: m.wave + 1, member: null },
});
const back = (m: Model, reason: EventDataOf<"job.returned">["reason"], lead: Body[] = []): Option => ({
  bodies: [...lead, { type: "job.returned", data: { reason } }],
  next: { ...m, status: "planned", member: null, wave: 0 },
});
const rung = (m: Model, reason: EventDataOf<"job.rung_moved">["reason"], lead: Body[] = []): Option => ({
  bodies: [...lead, { type: "job.rung_moved", data: { from: m.rung, to: m.rung + 1, reason } }],
  next: { ...m, status: "planned", rung: m.rung + 1, member: null },
});
const move = (m: Model, body: Body, status: JobStatus, member: string | null = m.member): Option => ({
  bodies: [body],
  next: { ...m, status, member },
  actor: { role: "volunteer", ref: member },
});
const done = (m: Model, outcome: "done" | "partly"): Option => ({
  bodies: [{ type: "job.done", data: { member: m.member ?? IDS.v01, outcome } }],
  next: { ...m, status: "done", tries: 0 },
  actor: vol(m),
});

const answer = (m: Model, value: 1 | 2 | 3): Option => {
  const tail: Body =
    value === 1
      ? { type: "job.closed", data: { result: "helped", reason: null } }
      : { type: "job.reopened", data: { as: value === 2 ? "partly" : "mismatch", exclude: m.member } };
  const status: JobStatus = value === 1 ? "helped" : value === 2 ? "partly" : "mismatch";
  return {
    bodies: [{ type: "checkback.answered", data: { answer: value } }, tail],
    next: { ...m, status, member: null, wave: 0 },
  };
};

const checkback = (m: Model): Option[] => {
  const ask: Option[] =
    m.tries < CHECKBACK_TRIES
      ? [
          {
            bodies: [{ type: "checkback.sent", data: { try: tryNo(m.tries + 1) } }],
            next: { ...m, tries: m.tries + 1 },
          },
        ]
      : [
          {
            bodies: [{ type: "job.closed", data: { result: "unreached", reason: null } }],
            next: { ...m, status: "unreached" },
          },
        ];
  return m.tries === 0 ? ask : [...ask, answer(m, 1), answer(m, 2), answer(m, 3)];
};

const partnerYes = (m: Model): Option => ({
  bodies: [
    { type: "promise.accepted", data: { partner: IDS.pantry } },
    { type: "job.got_it", data: { partner: IDS.pantry, date: "2026-11-22" } },
  ],
  next: { ...m, status: "got_it", member: null, tries: 0 },
});

const byStatus: Partial<Record<JobStatus, (m: Model) => Option[]>> = {
  planned: (m) => [
    wave(m),
    stay(m, { type: "job.approved", data: {} }),
    {
      bodies: [{ type: "consent.asked", data: { partner: IDS.pantry } }],
      next: { ...m, status: "consent_asked" },
    },
    { bodies: [{ type: "job.unmet", data: {} }], next: { ...m, status: "unmet" } },
  ],
  offered: (m) => [
    move(m, { type: "offer.accepted", data: { member: IDS.v01 } }, "accepted", IDS.v01),
    move(m, { type: "offer.accepted", data: { member: IDS.v02 } }, "accepted", IDS.v02),
    wave(m),
    back(m, "no_volunteer", [{ type: "offer.closed", data: { reason: "no_volunteer" } }]),
  ],
  accepted: (m) => [
    move(m, { type: "job.on_my_way", data: { member: m.member ?? IDS.v01 } }, "on_my_way"),
    move(m, { type: "job.there", data: { member: m.member ?? IDS.v01 } }, "there"),
    back(m, "claim_expired"),
  ],
  on_my_way: (m) => [
    move(m, { type: "job.there", data: { member: m.member ?? IDS.v01 } }, "there"),
    back(m, "hand_off"),
    stay(m, { type: "job.help", data: { member: m.member ?? IDS.v01 } }),
  ],
  there: (m) => [
    done(m, "done"),
    done(m, "partly"),
    back(m, "not_done", [{ type: "job.done", data: { member: m.member ?? IDS.v01, outcome: "not_done" } }]),
    stay(m, { type: "job.flagged", data: { flag: "visit_check" } }),
    stay(m, { type: "job.flag_cleared", data: { flag: "visit_check" } }),
  ],
  done: checkback,
  got_it: checkback,
  consent_asked: (m) => [
    {
      bodies: [
        { type: "consent.answered", data: { answer: "yes" } },
        { type: "partner.asked", data: { partner: IDS.pantry } },
      ],
      next: { ...m, status: "partner_asked" },
    },
    rung(m, "no", [{ type: "consent.answered", data: { answer: "no" } }]),
    stay(m, { type: "job.flagged", data: { flag: "consent_call" } }),
    withdraw(m),
  ],
  partner_asked: (m) => [
    {
      bodies: [{ type: "partner.answered", data: { partner: IDS.pantry, answer: "yes" } }],
      next: { ...m, status: "partner_yes" },
    },
    rung(m, "no", [{ type: "partner.answered", data: { partner: IDS.pantry, answer: "no" } }]),
    rung(m, "wait", [{ type: "partner.answered", data: { partner: IDS.pantry, answer: "wait" } }]),
    rung(m, "silence"),
  ],
  partner_yes: (m) => [partnerYes(m), rung(m, "silence")],
  mismatch: (m) => [wave(m), withdraw(m)],
  partly: (m) => [wave(m), withdraw(m)],
  unmet: (m) => [rung(m, "desk"), withdraw(m)],
};

const draftOf = (card: string | null, job: string | null, body: Body, actor: Actor): EventDraft => ({
  card,
  job,
  actor,
  ...body,
});

const walk = (card: string, job: string, choices: readonly number[]): EventDraft[] => {
  const out: EventDraft[] = [];
  let m: Model = { status: "planned", member: null, tries: 0, wave: 0, rung: 0 };
  for (const choice of choices) {
    const options = byStatus[m.status]?.(m) ?? [];
    const pick = options[choice % Math.max(options.length, 1)];
    if (!pick) break;
    for (const body of pick.bodies) out.push(draftOf(card, job, body, pick.actor ?? SYSTEM));
    m = pick.next;
  }
  return out;
};

export type CardSpec = {
  need: "snow" | "food" | "text_extraction";
  urgency: Urgency;
  changed: boolean;
  safeContact: boolean;
  choices: number[];
};

const confirmed = (n: number, spec: CardSpec, pbRow: PlaybookRow): Body => ({
  type: "card.confirmed",
  data: {
    need: spec.need,
    urgency: spec.urgency,
    division: null,
    level: pbRow.level,
    quiet: pbRow.quiet || !spec.safeContact,
    routeCode: `${pbRow.level === 3 ? "CARE" : pbRow.code}-16-${String(n).padStart(3, "0")}`,
    changed: spec.changed,
  },
});

const intake = (n: number, spec: CardSpec, pbRow: PlaybookRow): Body[] => {
  const page = uid("pg_", n);
  const pages: Body[] =
    spec.urgency === "high"
      ? [
          { type: "page.sent", data: { page, to: IDS.desk, reason: "high", step: 0 } },
          { type: "page.moved", data: { page, to: IDS.desk2, step: 1 } },
          { type: "page.answered", data: { page, by: IDS.desk2 } },
        ]
      : [];
  return [
    { type: "card.received", data: { door: "form", zip: "53216", safeContact: spec.safeContact } },
    {
      type: "card.sorted",
      data: { source: "none", service: null, division: null, urgency: null, flags: ["sorter_off"] },
    },
    ...pages,
    confirmed(n, spec, pbRow),
    { type: "receipt.sent", data: { promiseAt: BASE_AT + pbRow.promiseHours * 3_600_000 } },
  ];
};

export const cardScript = (n: number, spec: CardSpec): EventDraft[] => {
  const card = uid("c_", n);
  const job = uid("j_", n);
  const pbRow = playbook.rows.find((r) => r.need === spec.need) ?? row(spec.need, {});
  const planned: Body = {
    type: "job.planned",
    data: {
      need: spec.need,
      path: pbRow.ladder[0]?.path ?? "unmet",
      rung: 0,
      level: pbRow.level,
      quiet: pbRow.quiet || !spec.safeContact,
      promiseAt: BASE_AT + pbRow.promiseHours * 3_600_000,
    },
  };
  return [
    ...intake(n, spec, pbRow).map((b) => draftOf(card, null, b, SYSTEM)),
    draftOf(card, job, planned, SYSTEM),
    ...walk(card, job, spec.choices),
  ];
};

export const seal = (drafts: readonly EventDraft[]): LedgerEvent[] => {
  const out: LedgerEvent[] = [];
  let prev = GENESIS_HASH;
  for (const [i, d] of drafts.entries()) {
    const e = sealEvent(d, i + 1, BASE_AT + (i + 1) * 60_000, prev);
    out.push(e);
    prev = e.hash;
  }
  return out;
};

const DESK: Actor = { role: "desk", ref: IDS.desk };
const DRAFT_ID = uid("d_", 1);
const TEXT_HASH = "a".repeat(64);
const ORGANISER: Actor = { role: "organiser", ref: IDS.owner };
const metaDrafts: EventDraft[] = [
  draftOf(null, null, { type: "shift.taken", data: { member: IDS.desk } }, DESK),
  draftOf(null, null, { type: "shift.taken", data: { member: IDS.desk2 } }, { role: "desk", ref: IDS.desk2 }),
  draftOf(null, null, { type: "clock.jumped", data: { byMs: 3_600_000 } }, ORGANISER),
  draftOf(null, null, { type: "levels.master_set", data: { on: true } }, ORGANISER),
  draftOf(null, null, { type: "need.level_set", data: { need: "snow", level: 1 } }, ORGANISER),
  draftOf(null, null, { type: "playbook.loaded", data: { version: "test-1", rows: 3 } }, ORGANISER),
  draftOf(
    null,
    null,
    {
      type: "draft.asked",
      data: { draft: DRAFT_ID, kind: "impact_post", month: "2026-11", resource: null, by: IDS.owner },
    },
    SYSTEM,
  ),
  draftOf(
    null,
    null,
    {
      type: "draft.done",
      data: { draft: DRAFT_ID, source: "template", flag: "ai_off", textHash: TEXT_HASH },
    },
    SYSTEM,
  ),
  draftOf(
    null,
    null,
    { type: "draft.approved", data: { draft: DRAFT_ID, textHash: TEXT_HASH, by: IDS.owner } },
    SYSTEM,
  ),
];

const cardSpec: fc.Arbitrary<CardSpec> = fc.record({
  need: fc.constantFrom("snow", "food", "text_extraction"),
  urgency: fc.constantFrom("high", "low"),
  changed: fc.boolean(),
  safeContact: fc.boolean(),
  choices: fc.array(fc.nat({ max: 50 }), { maxLength: 40 }),
});

const interleave = (queues: EventDraft[][], order: readonly number[]): EventDraft[] => {
  const live = queues.map((q) => [...q]).filter((q) => q.length > 0);
  const out: EventDraft[] = [];
  let k = 0;
  while (live.length > 0) {
    const i = (order[k] ?? 0) % live.length;
    k += 1;
    const queue = live[i] ?? [];
    const next = queue.shift();
    if (next) out.push(next);
    if (queue.length === 0) live.splice(i, 1);
  }
  return out;
};

export const arbHistory = (): fc.Arbitrary<LedgerEvent[]> =>
  fc
    .record({
      cards: fc.array(cardSpec, { minLength: 1, maxLength: 4 }),
      meta: fc.subarray(metaDrafts),
      order: fc.array(fc.nat({ max: 10 }), { maxLength: 200 }),
    })
    .map(({ cards, meta, order }) =>
      seal(interleave([...cards.map((c, i) => cardScript(i + 1, c)), ...meta.map((d) => [d])], order)),
    );

export const withJob = (
  status: JobStatus,
  holderRef: string | null,
  need: CardSpec["need"] = "snow",
): HubState => {
  const s = fold(
    seal(cardScript(1, { need, urgency: "low", changed: false, safeContact: true, choices: [] })),
  );
  const job = s.jobs[IDS.job];
  if (!job) throw new Error(`withJob could not plan a ${need} job`);
  return { ...s, jobs: { ...s.jobs, [IDS.job]: { ...job, status, holderRef } } };
};
