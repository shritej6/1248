import {
  DRAFT_DAILY_CAP,
  DRAFT_LIST_MAX,
  type Catalog,
  type CostEntry,
  type DraftView,
  type LedgerEvent,
  type Month,
  type Readiness,
  type ResourcesView,
} from "@vision/contracts";
import { monthBounds } from "../month.js";
import { addMonths, chicagoDate, chicagoMonth } from "./calendar.js";
import { buildForecast } from "./forecast.js";
import { activeNeeds, type HistoryInput } from "./history.js";
import { matchResources } from "./match.js";

export type ResourcesInput = HistoryInput & {
  orgName: string;
  catalog: Catalog;
  readiness: Readiness;
  costs: readonly CostEntry[];
  drafts: readonly DraftView[];
  usedToday: number;
};

const DRAFT_MONTHS = 3;

export const draftMonths = (events: readonly LedgerEvent[], now: number): Month[] => {
  const current = chicagoMonth(now);
  const first = events[0]?.at;
  const started = (month: Month): boolean =>
    first !== undefined && first < monthBounds(month, "America/Chicago").end;
  return Array.from({ length: DRAFT_MONTHS }, (_, back) => addMonths(current, -back)).filter(
    (month, back) => back === 0 || started(month),
  );
};

export const resourcesView = (input: ResourcesInput): ResourcesView => {
  const { catalog, playbook, readiness } = input;
  const today = chicagoDate(input.now);
  const forecast = buildForecast(input, input.costs);
  return {
    today,
    month: chicagoMonth(input.now),
    demo: input.demo,
    catalog: { version: catalog.version, checked: catalog.checked },
    needs: activeNeeds(playbook).map(({ need, label }) => ({ need, label })),
    resources: [...catalog.resources],
    sponsors: [...catalog.sponsors],
    forecast,
    matches: matchResources({ resources: catalog.resources, forecast, playbook, readiness, today }),
    readiness,
    costs: [...input.costs],
    drafts: input.drafts.slice(0, DRAFT_LIST_MAX),
    draftMonths: draftMonths(input.events, input.now),
    drafting: { cap: DRAFT_DAILY_CAP, usedToday: input.usedToday },
  };
};
