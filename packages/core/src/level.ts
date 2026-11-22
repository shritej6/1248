import type { Flag, Level, Urgency } from "@vision/contracts";

export type LevelInput = {
  needLevel: Level;
  flags: readonly Flag[];
  urgency: Urgency;
  quiet: boolean;
  master: boolean;
};

export const effectiveLevel = (input: LevelInput): Level => {
  if (input.quiet || input.needLevel === 3) return 3;
  const raised = input.master || input.flags.length > 0 || input.urgency === "high";
  return raised ? 2 : input.needLevel;
};
