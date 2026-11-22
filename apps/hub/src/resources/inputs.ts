import { CatalogSchema, type Catalog, type Config, type Playbook } from "@vision/contracts";
import { activeNeeds, chicagoDate, type HubState, type ResourcesInput } from "@vision/core";
import catalogJson from "../../../../data/resources/catalog.json";
import { Store } from "../store.js";
import { draftsOn, listDrafts, readCosts, readReadiness } from "./tables.js";

export const CATALOG: Catalog = CatalogSchema.parse(catalogJson);

export const draftDay = (): string => chicagoDate(Date.now());

export type InputHost = {
  sql: SqlStorage;
  state(): HubState;
  playbook(): Playbook;
  now(): number;
  config(): Config;
};

export const resourcesInput = (host: InputHost): ResourcesInput => {
  const { sql } = host;
  const store = new Store(sql);
  const now = host.now();
  const config = host.config();
  const playbook = host.playbook();
  const active = new Set(activeNeeds(playbook).map((row) => row.need));
  return {
    now,
    demo: config.demoMode,
    orgName: config.orgName,
    events: store.events(),
    state: host.state(),
    playbook,
    catalog: CATALOG,
    readiness: readReadiness(sql),
    costs: readCosts(sql).filter((cost) => active.has(cost.need)),
    drafts: listDrafts(sql, (id) => store.member(id)?.name ?? null),
    usedToday: draftsOn(sql, draftDay()),
  };
};
