import {
  CostSetSchema,
  DRAFT_DAILY_CAP,
  DraftApproveSchema,
  DraftAskSchema,
  ReadinessSetSchema,
  type Actor,
  type Config,
  type CostSet,
  type DraftApprove,
  type DraftAsk,
  type DraftFacts,
  type MemberRecord,
  type Playbook,
  type Resource,
  type ResourcesView,
  type SystemCommand,
  writesLetter,
} from "@vision/contracts";
import {
  activeNeeds,
  draftFacts,
  resourcesView,
  statement,
  unsafeFacts,
  type HubState,
  type ResourcesInput,
} from "@vision/core";
import type { z } from "zod";
import type { DoorResult } from "../doors.js";
import { fail, json, readJson, rejectionResponse } from "../http.js";
import { CATALOG, draftDay, resourcesInput } from "./inputs.js";
import {
  approveDraft,
  draftRecord,
  insertDraft,
  writeCost,
  writeReadiness,
  type DraftRecord,
} from "./tables.js";

export type ResourcesHost = {
  sql: SqlStorage;
  member(request: Request): MemberRecord | null;
  transaction<T>(run: () => T): T;
  apply(command: SystemCommand, actor: Actor): DoorResult;
  state(): HubState;
  playbook(): Playbook;
  now(): number;
  config(): Config;
};

type Caller = { ok: true; member: MemberRecord } | { ok: false; response: Response };

const SYSTEM: Actor = { role: "system", ref: null };
const ACTIONS = ["costs", "readiness", "drafts", "approve"] as const;
type Action = (typeof ACTIONS)[number];

const NOT_VALID = "The request is not valid.";
const NOT_IN_PLAYBOOK = "This need is not in the playbook.";
const WRONG_MONTH = "Pick the current month or a recent month with records.";
const ID_USED = "This draft id is already used.";
const NOT_IN_CATALOG = "This resource is not in the catalog.";
const NO_LETTER =
  "This resource does not take a letter. Vision writes to grants and companies that are not closed.";
const UNSAFE_FACT =
  "A name in the record holds a web address or a hidden mark, so Vision will not draft from it.";
const CAPPED = `Vision writes at most ${String(DRAFT_DAILY_CAP)} drafts a day. Try again tomorrow.`;
const NOT_HERE = "This draft is not here.";
const NOT_READY = "This draft is not ready, or it is approved already.";

const organiserCaller = (request: Request, host: ResourcesHost): Caller => {
  const member = host.member(request);
  if (member === null) return { ok: false, response: fail("unauthorized", "Sign in again.") };
  if (!member.roles.includes("organiser"))
    return { ok: false, response: fail("forbidden", "Only an organiser can use Resources.") };
  return { ok: true, member };
};

const viewResponse = (host: ResourcesHost, status = 200): Response =>
  json(resourcesView(resourcesInput(host)), status);

const withBody = <T>(schema: z.ZodType<T>, value: unknown, run: (body: T) => Response): Response => {
  const parsed = schema.safeParse(value);
  return parsed.success ? run(parsed.data) : fail("invalid", NOT_VALID);
};

const applyThen = (host: ResourcesHost, command: SystemCommand, then: () => void): DoorResult =>
  host.transaction(() => {
    const result = host.apply(command, SYSTEM);
    if (result.status < 300) then();
    return result;
  });

const answer = (host: ResourcesHost, result: DoorResult, status: number): Response =>
  result.status < 300 ? viewResponse(host, status) : json(result.body, result.status);

const postCost = (host: ResourcesHost, set: CostSet, member: MemberRecord): Response => {
  if (!activeNeeds(host.playbook()).some((row) => row.need === set.need))
    return fail("invalid", NOT_IN_PLAYBOOK);
  writeCost(host.sql, set, host.now(), member.id);
  return viewResponse(host);
};

const catalogRow = (id: string | null): Resource | null =>
  id === null ? null : (CATALOG.resources.find((row) => row.id === id) ?? null);

const sameAsk = (record: DraftRecord, ask: DraftAsk): boolean =>
  record.kind === ask.kind && record.month === ask.month && record.resource === ask.resource;

const factsFor = (
  input: ResourcesInput,
  view: ResourcesView,
  ask: DraftAsk,
  resource: Resource | null,
): DraftFacts =>
  draftFacts({
    kind: ask.kind,
    orgName: input.orgName,
    month: ask.month,
    partial: ask.month === view.month,
    statement: statement(input.events, ask.month),
    forecast: view.forecast,
    resource,
    playbook: input.playbook,
    readiness: input.readiness,
    today: view.today,
  });

const postDraft = (host: ResourcesHost, ask: DraftAsk, member: MemberRecord): Response => {
  const input = resourcesInput(host);
  const view = resourcesView(input);
  if (!view.draftMonths.includes(ask.month)) return fail("invalid", WRONG_MONTH);
  const resource = catalogRow(ask.resource);
  if (ask.resource !== null && resource === null) return fail("not_found", NOT_IN_CATALOG);
  if (resource !== null && !writesLetter(resource)) return fail("invalid", NO_LETTER);
  const record = draftRecord(host.sql, ask.draft);
  if (record !== null) return sameAsk(record, ask) ? json(view) : fail("invalid", ID_USED);
  if (input.usedToday >= DRAFT_DAILY_CAP) return fail("rate_limited", CAPPED);
  const facts = factsFor(input, view, ask, resource);
  if (unsafeFacts(facts).length > 0) return fail("invalid", UNSAFE_FACT);
  const row = { id: ask.draft, facts, day: draftDay(), at: input.now };
  const command: SystemCommand = {
    type: "draft.ask",
    draft: ask.draft,
    kind: ask.kind,
    month: ask.month,
    resource: ask.resource,
    by: member.id,
  };
  const result = applyThen(host, command, () => {
    insertDraft(host.sql, row);
  });
  return answer(host, result, 201);
};

const postApprove = (host: ResourcesHost, approve: DraftApprove, member: MemberRecord): Response => {
  const record = draftRecord(host.sql, approve.draft);
  if (record === null) return fail("not_found", NOT_HERE);
  const textHash = record.textHash;
  if (record.status !== "ready" || textHash === null) return fail("wrong_state", NOT_READY);
  const command: SystemCommand = { type: "draft.approve", draft: approve.draft, textHash, by: member.id };
  const at = host.now();
  const result = applyThen(host, command, () => {
    approveDraft(host.sql, approve.draft, member.id, at);
  });
  return answer(host, result, 200);
};

const postReadiness = (host: ResourcesHost, value: unknown, member: MemberRecord): Response =>
  withBody(ReadinessSetSchema, value, (set) => {
    writeReadiness(host.sql, set, host.now(), member.id);
    return viewResponse(host);
  });

const postAction = (host: ResourcesHost, action: Action, value: unknown, member: MemberRecord): Response => {
  if (action === "costs") return withBody(CostSetSchema, value, (set) => postCost(host, set, member));
  if (action === "readiness") return postReadiness(host, value, member);
  if (action === "drafts") return withBody(DraftAskSchema, value, (ask) => postDraft(host, ask, member));
  return withBody(DraftApproveSchema, value, (approve) => postApprove(host, approve, member));
};

const postResources = async (request: Request, action: Action, host: ResourcesHost): Promise<Response> => {
  const caller = organiserCaller(request, host);
  if (!caller.ok) return caller.response;
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  return postAction(host, action, body.value, caller.member);
};

const getResources = (request: Request, host: ResourcesHost): Response => {
  const caller = organiserCaller(request, host);
  return caller.ok ? viewResponse(host) : caller.response;
};

const isAction = (value: string | undefined): value is Action => ACTIONS.some((action) => action === value);

export const routeResources = (
  request: Request,
  parts: readonly string[],
  host: ResourcesHost,
): Promise<Response> | null => {
  const [first, action] = parts;
  if (first !== "resources") return null;
  if (request.method === "GET" && parts.length === 1) return Promise.resolve(getResources(request, host));
  if (request.method === "POST" && parts.length === 2 && isAction(action))
    return postResources(request, action, host);
  return null;
};
