import type { Playbook } from "@vision/contracts";
import type { CardState } from "./state.js";

export const suggestedNeed = (playbook: Playbook, service: string | null): string | null => {
  const rows = playbook.rows.filter((row) => service !== null && row.service === service);
  return (rows.find((row) => row.defaultForService) ?? rows[0])?.need ?? null;
};

export const cardIsQuiet = (playbook: Playbook, card: CardState): boolean => {
  const need = card.need ?? suggestedNeed(playbook, card.sorted?.service ?? null);
  return card.quiet || (need !== null && playbook.rows.find((row) => row.need === need)?.quiet === true);
};
