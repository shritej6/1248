import type { Playbook } from "@vision/contracts";
import { DEFAULT_CHANCES, type RehearsalInput, type RehearsalLabel } from "@vision/core";
import configFile from "../../../../../data/synthetic/config.json" with { type: "json" };
import labelsFile from "../../../../../data/synthetic/rehearsal-labels.json" with { type: "json" };
import playbookFile from "../../../../../data/synthetic/playbook.json" with { type: "json" };
import zipsFile from "../../../../../data/synthetic/zip-centres.json" with { type: "json" };

export const rehearsalInput = (seed: number): RehearsalInput => ({
  seed,
  labels: labelsFile.labels as RehearsalLabel[],
  source: labelsFile.source,
  playbook: playbookFile as Playbook,
  zips: zipsFile,
  config: configFile,
  chances: DEFAULT_CHANCES,
});
