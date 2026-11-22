import type { Playbook, PlaybookRow } from "@vision/contracts";

export const QUIET_CODE = "CARE";

export const routeCode = (code: string, zip: string | null, n: number): string =>
  `${code}-${zip === null ? "00" : zip.slice(-2)}-${String(n).padStart(3, "0")}`;

export const needForService = (service: string | null, playbook: Playbook): PlaybookRow | null => {
  if (service === null) return null;
  const rows = playbook.rows.filter((row) => row.service === service);
  return rows.find((row) => row.defaultForService) ?? rows[0] ?? null;
};
