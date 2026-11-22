import type { EventDraft } from "@vision/contracts";
import { cardForgetAt, type HubState } from "@vision/core";

export type Erased = { due: number; erased: number };

export const FORGET_TABLES = ["vault", "outbox", "vault_audio"] as const;

export const nextForgetAt = (sql: SqlStorage): number | null =>
  sql
    .exec<{
      at: number | null;
    }>(
      `SELECT MIN(at) AS at FROM (${FORGET_TABLES.map((t) => `SELECT MIN(forget_at) AS at FROM ${t}`).join(" UNION ALL ")})`,
    )
    .one().at;

export const eraseDue = (sql: SqlStorage, now: number): Erased | null => {
  const erased = FORGET_TABLES.reduce(
    (sum, table) => sum + sql.exec(`DELETE FROM ${table} WHERE forget_at <= ?`, now).rowsWritten,
    0,
  );
  return erased === 0 ? null : { due: now, erased };
};

export const startForgetClocks = (
  sql: SqlStorage,
  state: HubState,
  cards: Iterable<string>,
  clock: { at: number; forgetDays: number },
): void => {
  for (const card of new Set(cards)) {
    const forgetAt = cardForgetAt(state, card, clock.at, clock.forgetDays);
    for (const table of FORGET_TABLES)
      sql.exec(`UPDATE ${table} SET forget_at = ? WHERE card = ?`, forgetAt, card);
  }
};

export const erasedLine = (erased: Erased): EventDraft => ({
  card: null,
  job: null,
  actor: { role: "system", ref: null },
  type: "vault.erased",
  data: erased,
});

export const alarmAt = (hubTimes: readonly (number | null)[], offsetMs: number): number | null => {
  const times = hubTimes.filter((t): t is number => t !== null);
  return times.length === 0 ? null : Math.min(...times) - offsetMs;
};

export const scheduleAlarm = async (storage: DurableObjectStorage, at: number | null): Promise<void> => {
  if (at === null) await storage.deleteAlarm();
  else await storage.setAlarm(at);
};
