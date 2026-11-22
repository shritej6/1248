import {
  CostEntrySchema,
  DEFAULT_READINESS,
  DRAFT_LIST_MAX,
  DraftFactsSchema,
  DraftFlagSchema,
  DraftKindSchema,
  DraftSourceSchema,
  DraftStatusSchema,
  GuardReasonSchema,
  MonthSchema,
  ReadinessSchema,
  type CostEntry,
  type CostSet,
  type DraftFacts,
  type DraftFlag,
  type DraftKind,
  type DraftSource,
  type DraftStatus,
  type DraftView,
  type Effect,
  type GuardReason,
  type Month,
  type Readiness,
  type ReadinessSet,
} from "@vision/contracts";
import { z } from "zod";

export type DraftTextEffect = Extract<Effect, { kind: "draft.text" }>;

export type DraftRecord = {
  id: string;
  kind: DraftKind;
  month: Month;
  resource: string | null;
  day: string;
  status: DraftStatus;
  source: DraftSource | null;
  flag: DraftFlag | null;
  reasons: GuardReason[];
  facts: DraftFacts;
  text: string | null;
  textHash: string | null;
  createdAt: number;
  approvedAt: number | null;
  approvedBy: string | null;
};

type CostRow = { need: string; cents_per_job: number; basis: string; updated_at: number };

type DraftRow = {
  id: string;
  kind: string;
  month: string;
  resource: string | null;
  day: string;
  status: string;
  source: string | null;
  flag: string | null;
  reasons: string;
  facts: string;
  text: string | null;
  text_hash: string | null;
  created_at: number;
  approved_at: number | null;
  approved_by: string | null;
};

const DRAFT_COLUMNS =
  "id, kind, month, resource, day, status, source, flag, reasons, facts, text, text_hash, created_at, approved_at, approved_by";
const ReasonsSchema = z.array(GuardReasonSchema);

export const readCosts = (sql: SqlStorage): CostEntry[] =>
  sql
    .exec<CostRow>("SELECT need, cents_per_job, basis, updated_at FROM resource_costs ORDER BY need")
    .toArray()
    .map((row) =>
      CostEntrySchema.parse({
        need: row.need,
        centsPerJob: row.cents_per_job,
        basis: row.basis,
        updatedAt: row.updated_at,
      }),
    );

export const writeCost = (sql: SqlStorage, set: CostSet, at: number, by: string): void => {
  if (set.centsPerJob === null) {
    sql.exec("DELETE FROM resource_costs WHERE need = ?", set.need);
    return;
  }
  sql.exec(
    "INSERT INTO resource_costs (need, cents_per_job, basis, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(need) DO UPDATE SET cents_per_job = excluded.cents_per_job, basis = excluded.basis, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    set.need,
    set.centsPerJob,
    set.basis,
    at,
    by,
  );
};

export const readReadiness = (sql: SqlStorage): Readiness => {
  const rows = sql
    .exec<{ item: string; state: string }>("SELECT item, state FROM resource_readiness")
    .toArray();
  return ReadinessSchema.parse({
    ...DEFAULT_READINESS,
    ...Object.fromEntries(rows.map((row) => [row.item, row.state])),
  });
};

export const writeReadiness = (sql: SqlStorage, set: ReadinessSet, at: number, by: string): void => {
  sql.exec(
    "INSERT INTO resource_readiness (item, state, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(item) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    set.item,
    set.state,
    at,
    by,
  );
};

const toRecord = (row: DraftRow): DraftRecord => ({
  id: row.id,
  kind: DraftKindSchema.parse(row.kind),
  month: MonthSchema.parse(row.month),
  resource: row.resource,
  day: row.day,
  status: DraftStatusSchema.parse(row.status),
  source: DraftSourceSchema.nullable().parse(row.source),
  flag: DraftFlagSchema.nullable().parse(row.flag),
  reasons: ReasonsSchema.parse(JSON.parse(row.reasons) as unknown),
  facts: DraftFactsSchema.parse(JSON.parse(row.facts) as unknown),
  text: row.text,
  textHash: row.text_hash,
  createdAt: row.created_at,
  approvedAt: row.approved_at,
  approvedBy: row.approved_by,
});

export const insertDraft = (
  sql: SqlStorage,
  row: { id: string; facts: DraftFacts; day: string; at: number },
): void => {
  sql.exec(
    "INSERT INTO resource_drafts (id, kind, month, resource, day, status, reasons, facts, created_at) VALUES (?, ?, ?, ?, ?, 'writing', '[]', ?, ?)",
    row.id,
    row.facts.kind,
    row.facts.month,
    row.facts.resource,
    row.day,
    JSON.stringify(row.facts),
    row.at,
  );
};

export const draftRecord = (sql: SqlStorage, id: string): DraftRecord | null => {
  const row = sql
    .exec<DraftRow>(`SELECT ${DRAFT_COLUMNS} FROM resource_drafts WHERE id = ?`, id)
    .toArray()[0];
  return row === undefined ? null : toRecord(row);
};

export const readDraftFacts = (sql: SqlStorage, id: string): DraftFacts | null => {
  const row = sql
    .exec<{ facts: string }>("SELECT facts FROM resource_drafts WHERE id = ? AND status = 'writing'", id)
    .toArray()[0];
  return row === undefined ? null : DraftFactsSchema.parse(JSON.parse(row.facts) as unknown);
};

export const finishDraft = (sql: SqlStorage, e: DraftTextEffect): void => {
  sql.exec(
    "UPDATE resource_drafts SET status = 'ready', source = ?, flag = ?, reasons = ?, text = ?, text_hash = ? WHERE id = ? AND status = 'writing'",
    e.source,
    e.flag,
    JSON.stringify(e.reasons),
    e.text,
    e.textHash,
    e.draft,
  );
};

export const approveDraft = (sql: SqlStorage, id: string, by: string, at: number): void => {
  sql.exec(
    "UPDATE resource_drafts SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ? AND status = 'ready'",
    at,
    by,
    id,
  );
};

const approver = (
  member: string | null,
  nameOf: (member: string) => string | null,
): DraftView["approvedBy"] => (member === null ? null : { member, name: nameOf(member) ?? member });

const viewOf = (record: DraftRecord, nameOf: (member: string) => string | null): DraftView => ({
  id: record.id,
  kind: record.kind,
  month: record.month,
  resource: record.resource,
  status: record.status,
  source: record.source,
  flag: record.flag,
  reasons: record.reasons,
  facts: record.facts.facts,
  text: record.text,
  textHash: record.textHash,
  createdAt: record.createdAt,
  approvedAt: record.approvedAt,
  approvedBy: approver(record.approvedBy, nameOf),
});

export const listDrafts = (sql: SqlStorage, nameOf: (member: string) => string | null): DraftView[] =>
  sql
    .exec<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM resource_drafts ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      DRAFT_LIST_MAX,
    )
    .toArray()
    .map((row) => viewOf(toRecord(row), nameOf));

export const draftsOn = (sql: SqlStorage, day: string): number =>
  sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM resource_drafts WHERE day = ?", day).one().n;
