import { DurableObject } from "cloudflare:workers";
import * as core from "@vision/core";
import {
  CommandSchema,
  commandRoles,
  type Actor,
  type ActorRole,
  type Command,
  type CommandType,
  type Config,
  type DecideContext,
  type Decision,
  type DeskBoard,
  type Effect,
  type JobCard,
  type MemberRecord,
  type Rejection,
  type Role,
  type Statement,
  type SystemCommand,
  type ThreadLine,
  type Tracking,
  type VolunteerHome,
  TemplatesSchema,
  ZipCentresSchema,
} from "@vision/contracts";
import {
  closedTracking,
  decide,
  nextDeadlineAt,
  offerView,
  orgView,
  pageView,
  partnerView,
  pendingDeadlines,
  runDue,
  verifySeal,
  type HubState,
  type VaultReader,
  type Viewer,
  type ViewContext,
} from "@vision/core";
import templates from "../../../data/synthetic/templates.json";
import zipCentres from "../../../data/synthetic/zip-centres.json";
import { isAdmin, runAdmin } from "./admin.js";
import { alarmAt, eraseDue, erasedLine, nextForgetAt, scheduleAlarm, startForgetClocks } from "./alarm.js";
import { aiGiveUp, aiOn, aiSender, type AiHost } from "./ai/registry.js";
import { routeAi, type AiRouteHost } from "./ai/routes.js";
import type { AiModels } from "./ai/types.js";
import { bearerToken, sessionStore, type SessionStore } from "./auth.js";
import {
  FormLimit,
  insertPartnerLink,
  partnerLinkOf,
  routeDoor,
  shownPartnerLink,
  trackingCard,
  type DoorHost,
  type PartnerLink,
} from "./doors.js";
import { googleOn, hubGoogle } from "./google.js";
import {
  fail,
  json,
  logEvent,
  logFailure,
  readJson,
  rejection,
  rejectionResponse,
  unhandled,
} from "./http.js";
import { LiveChannel, socketToken, type Listener, type LiveViews } from "./live.js";
import { namePartners, residentMessages } from "./render.js";
import {
  drainOutbox,
  enqueue,
  enqueueOutside,
  failedSends,
  hubSender,
  nextOutboxAt,
  type SenderEnv,
} from "./outbox.js";
import { migrate } from "./schema.js";
import { bootstrapOrg, joinOrg, type SignInHost } from "./signin.js";
import { Store } from "./store.js";

export type Env = AiModels & {
  ORG: DurableObjectNamespace<OrgHub>;
  BOOTSTRAP_CODE: string;
  DOOR_SECRET?: string;
  DEMO_MODE: "on" | "off";
  SORTER_MODEL: string;
  AI: SenderEnv["AI"];
  GOOGLE_URL?: string;
  GOOGLE_SECRET?: string;
  PUBLIC_ORIGIN: string;
};

export type CommandResult = { status: number; body: unknown };

type Rules = {
  deskView(state: HubState, vault: VaultReader, ctx: ViewContext, viewer: Viewer): DeskBoard;
  homeView(state: HubState, ctx: ViewContext, member: string): VolunteerHome;
  jobView(
    state: HubState,
    vault: VaultReader,
    ctx: ViewContext,
    member: string,
    job: string,
  ): JobCard | Rejection;
  trackingView(state: HubState, vault: VaultReader, ctx: ViewContext, card: string): Tracking;
};

const rules = core as unknown as Partial<Rules>;
const ZIPS = ZipCentresSchema.parse(zipCentres);
const TEMPLATES = TemplatesSchema.parse(templates);
const NOT_READY = rejection("invalid", "This part of Vision is not in this build yet.");
const ID_USED = rejection("invalid", "This command id was already used. Send it with a new id.");
const CODE_SHOWN = rejection("wrong_state", "This join code was shown once. Make a new code.");
const PAGE_ROLES: readonly Role[] = ["desk", "organiser", "lead"];
const HUB_DEFAULTS = { waveSize: 10, maxWaves: 3, forgetDays: 90 } as const;

const partyOf = (role: ActorRole): ThreadLine["from"] =>
  role === "resident" || role === "volunteer" || role === "partner" || role === "system" ? role : "desk";

const roleFor = (roles: readonly Role[], type: CommandType): Role | null =>
  roles.find((r) => (commandRoles[type] as readonly string[]).includes(r)) ?? null;

const rejected = (r: Rejection): CommandResult => ({
  status: rejectionResponse(r).status,
  body: { ok: false, error: r },
});

const decisionResult = (decision: Decision, events: number): CommandResult =>
  decision.ok ? { status: 200, body: { ok: true, events } } : rejected(decision.rejection);

type Accepted = Extract<Decision, { ok: true }>;

export class OrgHub extends DurableObject<Env> {
  private readonly store: Store;
  private readonly sessions: SessionStore;
  private readonly formLimit = new FormLimit();
  private readonly live: LiveChannel;
  private state: HubState = core.emptyState();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
    this.sessions = sessionStore(ctx.storage.sql);
    this.live = new LiveChannel(ctx);
    void ctx.blockConcurrencyWhile(() => {
      migrate(ctx.storage.sql);
      this.state = this.store.loadState();
      return Promise.resolve();
    });
  }

  now(): number {
    return Date.now() + this.state.clockOffsetMs;
  }

  config(): Config {
    const org = this.ctx.id.name ?? "unknown";
    const pageList = this.store
      .membersPublic()
      .filter((m) => m.roles.some((r) => PAGE_ROLES.includes(r)))
      .map((m) => m.id);
    const flags = { demoMode: this.env.DEMO_MODE === "on", sorterOn: this.env.SORTER_MODEL.length > 0 };
    return {
      org,
      orgName: this.store.orgName() ?? org,
      pageList,
      ...HUB_DEFAULTS,
      ...flags,
      aiOn: aiOn(this.env),
    };
  }

  decideContext(now: number): DecideContext {
    return {
      now,
      newId: (prefix) => `${prefix}${crypto.randomUUID()}`,
      playbook: this.store.playbook() ?? { version: "none", rows: [] },
      members: this.store.membersPublic(),
      offered: this.store.offered(),
      zips: ZIPS,
      config: this.config(),
    };
  }

  private transaction<T>(run: () => T): T {
    return this.live.within(() => this.ctx.storage.transactionSync(run));
  }

  applyCommand(command: Command | SystemCommand, actor: Actor): CommandResult {
    const result = this.runCommand(command, actor);
    void this.refreshAlarm(null).catch((error: unknown) => {
      logEvent({ op: "alarm", status: "not_set", error: error instanceof Error ? error.name : "Error" });
    });
    return result;
  }

  private runCommand(command: Command | SystemCommand, actor: Actor): CommandResult {
    return this.transaction(() => {
      const id = "id" in command ? command.id : null;
      const stored = id === null ? null : this.store.storedResult(id);
      if (stored) {
        if (stored.actor_ref !== actor.ref || stored.type !== command.type) return rejected(ID_USED);
        return { status: stored.status, body: JSON.parse(stored.body) as unknown };
      }
      const now = this.now();
      const result = this.execute(command, actor, now);
      if (command.type === "clock.jump" && result.status === 200) this.runClocks(this.now());
      if (id !== null) {
        const replay =
          command.type === "join.create" && result.status === 200 ? rejected(CODE_SHOWN) : result;
        const owner = { actorRef: actor.ref, type: command.type };
        this.store.saveResult(id, owner, { status: replay.status, body: JSON.stringify(replay.body) }, now);
      }
      logEvent({ op: "command", type: command.type, id, status: result.status });
      return result;
    });
  }

  private execute(command: Command | SystemCommand, actor: Actor, now: number): CommandResult {
    if (command.type === "member.set_on") {
      if (actor.ref !== null) this.store.setOn(actor.ref, command.on);
      this.live.queue([], this.liveViews());
      return { status: 200, body: { ok: true, events: 0 } };
    }
    if ("id" in command && isAdmin(command)) {
      const r = runAdmin(command, { store: this.store, sessions: this.sessions, now });
      if (r.ok) this.live.queue([], this.liveViews());
      return r.ok ? { status: 200, body: r.body } : rejected(r.rejection);
    }
    const decision = decide(this.state, command, actor, this.decideContext(now));
    if (!decision.ok) return decisionResult(decision, 0);
    if (command.type === "playbook.load") this.store.savePlaybook(command.playbook, now);
    return decisionResult(decision, this.commit(decision, partyOf(actor.role), now));
  }

  private commit(decision: Accepted, fromParty: string, at: number): number {
    const { state, lines } = this.store.append(this.state, decision.events, at);
    const named = namePartners(decision.effects, this.store.partners());
    const messages = residentMessages(named, TEMPLATES, (card) => state.cards[card]?.lang ?? "en");
    this.store.applyEffects(decision.effects, fromParty, at);
    const outside = { at, google: googleOn(this.env), origin: this.env.PUBLIC_ORIGIN };
    enqueueOutside(this.ctx.storage.sql, { effects: decision.effects, lines, messages }, outside);
    this.store.addMessages(messages, at);
    this.makePartnerLinks(state, decision.effects, at);
    const cards = [...lines.flatMap((l) => l.card ?? []), ...messages.map((m) => m.card)];
    startForgetClocks(this.ctx.storage.sql, state, cards, { at, forgetDays: HUB_DEFAULTS.forgetDays });
    this.store.noteAccepts(lines);
    this.store.writeSnapshot(state);
    this.state = state;
    this.live.queue(decision.effects, this.liveViews());
    return lines.length;
  }

  private makePartnerLinks(state: HubState, effects: readonly Effect[], at: number): void {
    for (const e of effects) {
      const card = e.kind === "partner_link" ? state.jobs[e.job]?.card : undefined;
      if (e.kind === "partner_link" && card !== undefined)
        insertPartnerLink(this.ctx.storage.sql, this.ctx.id.name ?? "unknown", { ...e, card }, at);
    }
  }

  private runClocks(now: number): HubState {
    runDue(this.state, this.decideContext(now), now, (decision, at, deadline) => {
      if (decision.ok) this.commit(decision, "system", at);
      else logEvent({ op: "timer", type: deadline.kind, code: decision.rejection.code });
      return this.state;
    });
    const erased = eraseDue(this.ctx.storage.sql, now);
    if (erased !== null) this.commit({ ok: true, events: [erasedLine(erased)], effects: [] }, "system", now);
    return this.state;
  }

  override async alarm(): Promise<void> {
    const runNow = this.now();
    await logFailure("clocks", () => this.transaction(() => this.runClocks(runNow)));
    const sql = this.ctx.storage.sql;
    const send = hubSender(this.env, sql, (c, a) => this.applyCommand(c, a), aiSender(this.aiHost()));
    await logFailure("outbox", () => drainOutbox(sql, this.now(), send, aiGiveUp(this.aiHost())));
    await this.refreshAlarm(runNow);
  }

  private async refreshAlarm(ranAt: number | null): Promise<void> {
    const ctx = this.decideContext(this.now());
    const deadline =
      ranAt === null
        ? nextDeadlineAt(this.state, ctx)
        : (pendingDeadlines(this.state, ctx).find((d) => d.at > ranAt)?.at ?? null);
    const sql = this.ctx.storage.sql;
    const times = [deadline, nextOutboxAt(sql), nextForgetAt(sql)];
    await scheduleAlarm(this.ctx.storage, alarmAt(times, this.state.clockOffsetMs));
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (error) {
      return unhandled(request, error);
    }
  }

  private async route(request: Request): Promise<Response> {
    const parts = new URL(request.url).pathname.split("/").slice(5);
    const route = `${request.method} ${parts.join("/")}`;
    if (route === "POST bootstrap") return bootstrapOrg(request, this.signInHost());
    if (route === "POST join") return joinOrg(request, this.signInHost());
    if (route === "POST commands") return this.command(request);
    if (route === "GET export") return this.exportLedger(request);
    if (route === "GET about") return json({ orgName: this.config().orgName });
    if (route === "GET ws") return this.live.open(request, this.listener(request));
    if (request.method === "GET" && parts[0] === "views" && parts.length === 2) {
      return this.view(request, parts[1] ?? "");
    }
    const door = routeAi(request, parts, this.aiRouteHost()) ?? routeDoor(request, parts, this.doorHost());
    return (await door) ?? fail("not_found", "There is no such page.");
  }

  private aiHost(): AiHost {
    const sql = this.ctx.storage.sql;
    const apply = (c: SystemCommand, a: Actor) => this.applyCommand(c, a);
    return { env: this.env, sql, state: () => this.state, now: () => this.now(), apply };
  }

  private aiRouteHost(): AiRouteHost {
    return {
      org: this.ctx.id.name ?? "unknown",
      sql: this.ctx.storage.sql,
      doorSecret: this.env.DOOR_SECRET ?? "",
      member: (request) => this.signedIn(request),
      transaction: (run) => this.transaction(run),
      apply: (command, actor) => this.applyCommand(command, actor),
      state: () => this.state,
      playbook: () => this.store.playbook() ?? { version: "none", rows: [] },
      now: () => this.now(),
      config: () => this.config(),
    };
  }

  private signInHost(): SignInHost {
    const transaction = <T>(run: () => T): T => this.ctx.storage.transactionSync(run);
    return {
      store: this.store,
      sessions: this.sessions,
      bootstrapCode: this.env.BOOTSTRAP_CODE,
      transaction,
    };
  }

  private doorHost(): DoorHost {
    return {
      org: this.ctx.id.name ?? "unknown",
      sql: this.ctx.storage.sql,
      limit: this.formLimit,
      hasMembers: () => this.store.memberCount() > 0,
      transaction: (run) => this.transaction(run),
      apply: (command, actor) => this.applyCommand(command, actor),
      jobCard: (job) => this.state.jobs[job]?.card ?? null,
      jobClosed: (job) => this.state.jobs[job] !== undefined && core.isClosed(this.state.jobs[job].status),
      sentBefore: (id, actorRef) => this.store.storedResult(id)?.actor_ref === actorRef,
      tracking: (card) => this.trackingView(card),
      partnerCard: (link) => this.partnerCard(link),
      doorSecret: this.env.DOOR_SECRET ?? "",
      google: hubGoogle(this.env, {
        member: (request) => this.signedIn(request),
        apply: (command, actor) => this.applyCommand(command, actor),
        queueStatement: (statement) => this.queueStatement(statement),
      }),
    };
  }

  private queueStatement(statement: Statement): Promise<void> {
    enqueue(this.ctx.storage.sql, { kind: "statement", card: null, payload: { statement } }, this.now());
    return this.refreshAlarm(null);
  }

  private liveViews(): LiveViews {
    const ctx = { playbook: this.store.playbook() ?? { version: "none", rows: [] }, zips: ZIPS };
    return {
      offer: (job, member) => offerView(this.state, ctx, this.store.member(member)?.zip ?? null, job),
      page: (page) => pageView(this.state, page, (member) => this.store.member(member)?.name ?? null),
    };
  }

  private listener(request: Request): Listener | null {
    const token = socketToken(request);
    if (token === null) return null;
    const id = this.sessions.sessionMember(token, Date.now());
    const member = id === null ? null : this.store.member(id);
    if (member !== null) return { kind: "member", member };
    const card =
      trackingCard(this.ctx.storage.sql, token) ??
      this.state.jobs[partnerLinkOf(this.ctx.storage.sql, token)?.job ?? ""]?.card ??
      null;
    return card === null ? null : { kind: "link", card };
  }

  private trackingView(card: string): Response {
    if (rules.trackingView === undefined) return rejectionResponse(NOT_READY);
    const vault = this.store.vaultReader();
    const ctx = this.viewContext(this.now());
    if (vault.person(card) === null) return json(closedTracking(this.state, ctx));
    return json(rules.trackingView(this.state, vault, ctx, card));
  }

  private partnerCard(link: PartnerLink): Response {
    const { now, playbook, config } = this.decideContext(this.now());
    const { forgetDays, orgName } = config;
    const ctx = { now, playbook, partners: this.store.partners(), forgetDays, orgName };
    return json(partnerView(this.state, this.store.vaultReader(), ctx, link.partner, link.job));
  }

  private signedIn(request: Request): MemberRecord | null {
    const token = bearerToken(request);
    const id = token === null ? null : this.sessions.sessionMember(token, Date.now());
    return id === null ? null : this.store.member(id);
  }

  private async command(request: Request): Promise<Response> {
    const member = this.signedIn(request);
    if (member === null) return fail("unauthorized", "Sign in again.");
    const body = await readJson(request);
    if (!body.ok) return rejectionResponse(body.rejection);
    const parsed = CommandSchema.safeParse(body.value);
    if (!parsed.success) return fail("invalid", "The command is not valid.");
    const role = roleFor(member.roles, parsed.data.type);
    if (role === null) {
      logEvent({ op: "command", type: parsed.data.type, id: parsed.data.id, code: "forbidden" });
      return fail("forbidden", "Your role cannot do this.");
    }
    const result = this.applyCommand(parsed.data, { role, ref: member.id });
    return json(result.body, result.status);
  }

  private exportLedger(request: Request): Response {
    const member = this.signedIn(request);
    if (member === null) return fail("unauthorized", "Sign in again.");
    if (!member.roles.includes("organiser"))
      return fail("forbidden", "Only an organiser can export the record.");
    const events = this.store.events();
    return json({ events, sealed: verifySeal(events) });
  }

  private viewContext(now: number): ViewContext {
    return {
      ...this.decideContext(now),
      memberRecords: this.store.memberRecords(),
      partners: this.store.partners(),
      links: {
        partner: (job) => {
          const partner = this.state.jobs[job]?.partner ?? null;
          return partner === null ? null : shownPartnerLink(this.ctx.storage.sql, { job, partner });
        },
      },
    };
  }

  private view(request: Request, name: string): Response {
    const member = this.signedIn(request);
    if (member === null) return fail("unauthorized", "Sign in again.");
    const now = this.now();
    if (name === "desk") return this.deskView(member, now);
    if (name === "org") {
      if (!member.roles.includes("organiser")) return fail("forbidden", "This view is for organisers.");
      return json({
        ...orgView(this.state, this.store.vaultReader(), this.viewContext(now)),
        playbook: this.store.playbook(),
      });
    }
    if (name === "home" || name === "job") {
      if (!member.roles.includes("volunteer")) return fail("forbidden", "This view is for volunteers.");
      if (name === "home")
        return rules.homeView
          ? json(rules.homeView(this.state, this.viewContext(now), member.id))
          : rejectionResponse(NOT_READY);
      const job = new URL(request.url).searchParams.get("job") ?? "";
      if (rules.jobView === undefined) return rejectionResponse(NOT_READY);
      const card = rules.jobView(this.state, this.store.vaultReader(), this.viewContext(now), member.id, job);
      return "code" in card ? rejectionResponse(card) : json(card);
    }
    return fail("not_found", "There is no such view.");
  }

  private deskView(member: MemberRecord, now: number): Response {
    const role =
      member.roles.find((r) => r === "lead") ?? member.roles.find((r) => r === "desk" || r === "organiser");
    if (role === undefined) return fail("forbidden", "This view is for the desk.");
    if (rules.deskView === undefined) return rejectionResponse(NOT_READY);
    const board = rules.deskView(this.state, this.store.vaultReader(), this.viewContext(now), {
      role,
      member: member.id,
    });
    return json({ ...board, failedSends: failedSends(this.ctx.storage.sql) });
  }
}
