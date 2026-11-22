import {
  LedgerEventSchema,
  PlaybookSchema,
  type Effect,
  type EventDraft,
  type LedgerEvent,
  type MemberPublic,
  type MemberRecord,
  type Playbook,
  type PartnerRecord,
  type Role,
  type ThreadLine,
} from "@vision/contracts";
import { z } from "zod";
import {
  STATE_SHAPE,
  emptyState,
  evolve,
  fold,
  sealEvent,
  type HubState,
  type VaultPerson,
  type VaultReader,
} from "@vision/core";

const SnapshotSchema = z.object({ shape: z.literal(STATE_SHAPE), state: z.record(z.string(), z.unknown()) });

const OFFERS_END: ReadonlySet<string> = new Set(["offer.closed", "job.returned", "job.unmet", "job.closed"]);
export const MACHINE_KINDS: readonly string[] = ["link_vector"];

type EventRow = {
  seq: number;
  at: number;
  card: string | null;
  job: string | null;
  type: string;
  actor_role: string;
  actor_ref: string | null;
  data: string;
  prev: string;
  hash: string;
};

type MemberRow = {
  id: string;
  name: string;
  roles: string;
  skills: string;
  zip: string | null;
  on_duty: number;
  last_job_at: number | null;
};

export type StoredResult = { status: number; body: string };
export type StoredCommand = StoredResult & { actor_ref: string | null; type: string };
export type VaultRow = {
  card: string;
  job: string | null;
  kind: string;
  from_party: string;
  body: string;
  at: number;
};

const toEvent = (row: EventRow): LedgerEvent =>
  LedgerEventSchema.parse({
    seq: row.seq,
    at: row.at,
    card: row.card,
    job: row.job,
    type: row.type,
    actor: { role: row.actor_role, ref: row.actor_ref },
    data: JSON.parse(row.data) as unknown,
    prev: row.prev,
    hash: row.hash,
  });

const toMember = (row: MemberRow): MemberRecord => ({
  id: row.id,
  name: row.name,
  roles: JSON.parse(row.roles) as Role[],
  skills: JSON.parse(row.skills) as string[],
  zip: row.zip,
  on: row.on_duty === 1,
  lastJobAt: row.last_job_at,
});

const publicOf = (m: MemberRecord): MemberPublic => ({
  id: m.id,
  roles: m.roles,
  skills: m.skills,
  zip: m.zip,
  on: m.on,
  lastJobAt: m.lastJobAt,
});

export class Store {
  constructor(private readonly sql: SqlStorage) {}

  loadState(): HubState {
    const snap = this.sql
      .exec<{ seq: number; state: string }>("SELECT seq, state FROM snapshot WHERE id = 1")
      .toArray()[0];
    const current = snap ? SnapshotSchema.safeParse(JSON.parse(snap.state)) : null;
    if (snap === undefined || current?.success !== true) return fold(this.events(0), emptyState());
    return fold(this.events(snap.seq), current.data.state as HubState);
  }

  events(afterSeq = 0): LedgerEvent[] {
    return this.sql
      .exec<EventRow>("SELECT * FROM events WHERE seq > ? ORDER BY seq", afterSeq)
      .toArray()
      .map(toEvent);
  }

  ledgerLength(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").one().n;
  }

  append(
    state: HubState,
    drafts: readonly EventDraft[],
    at: number,
  ): { state: HubState; lines: LedgerEvent[] } {
    let next = state;
    const lines: LedgerEvent[] = [];
    for (const draft of drafts) {
      const line = sealEvent(draft, next.seq + 1, at, next.lastHash);
      lines.push(line);
      this.sql.exec(
        "INSERT INTO events (seq, at, card, job, type, actor_role, actor_ref, data, prev, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        line.seq,
        line.at,
        line.card,
        line.job,
        line.type,
        line.actor.role,
        line.actor.ref,
        JSON.stringify(line.data),
        line.prev,
        line.hash,
      );
      next = evolve(next, line);
    }
    return { state: next, lines };
  }

  writeSnapshot(state: HubState): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO snapshot (id, seq, state) VALUES (1, ?, ?)",
      state.seq,
      JSON.stringify({ shape: STATE_SHAPE, state }),
    );
  }

  storedResult(id: string): StoredCommand | null {
    return (
      this.sql
        .exec<StoredCommand>("SELECT actor_ref, type, status, body FROM commands WHERE id = ?", id)
        .toArray()[0] ?? null
    );
  }

  saveResult(
    id: string,
    owner: { actorRef: string | null; type: string },
    result: StoredResult,
    at: number,
  ): void {
    this.sql.exec(
      "INSERT INTO commands (id, actor_ref, type, status, body, at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      owner.actorRef,
      owner.type,
      result.status,
      result.body,
      at,
    );
  }

  applyEffects(effects: readonly Effect[], fromParty: string, at: number): void {
    for (const effect of effects) {
      if (effect.kind === "vault.person") {
        const body = JSON.stringify({
          firstName: effect.firstName,
          contact: effect.contact,
          address: effect.address,
        });
        this.insertVault(effect.card, null, "person", "resident", body, at);
      } else if (effect.kind === "vault.text") {
        const from = effect.textKind === "message_in" ? "resident" : fromParty;
        this.insertVault(effect.card, effect.job, effect.textKind, from, effect.text, at);
      } else if (effect.kind === "offer") {
        this.recordOffer(effect.job, effect.members, at);
      }
    }
  }

  addMessages(messages: readonly { card: string; job: string | null; text: string }[], at: number): void {
    for (const m of messages) this.insertVault(m.card, m.job, "message_out", "system", m.text, at);
  }

  private recordOffer(job: string, members: readonly string[], at: number): void {
    const wave =
      this.sql.exec<{ w: number | null }>("SELECT MAX(wave) AS w FROM offers WHERE job = ?", job).one().w ??
      0;
    for (const member of members) {
      this.sql.exec(
        "INSERT OR IGNORE INTO offers (job, member, wave, sent_at) VALUES (?, ?, ?, ?)",
        job,
        member,
        wave + 1,
        at,
      );
    }
  }

  private insertVault(
    card: string,
    job: string | null,
    kind: string,
    from: string,
    body: string,
    at: number,
  ): void {
    this.sql.exec(
      "INSERT INTO vault (card, job, kind, from_party, body, at, forget_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      card,
      job,
      kind,
      from,
      body,
      at,
    );
  }

  vaultRows(card: string): VaultRow[] {
    return this.sql
      .exec<VaultRow>(
        `SELECT card, job, kind, from_party, body, at FROM vault WHERE card = ? AND kind NOT IN (${MACHINE_KINDS.map(() => "?").join(", ")}) ORDER BY id`,
        card,
        ...MACHINE_KINDS,
      )
      .toArray();
  }

  vaultReader(): VaultReader {
    return {
      person: (card) => {
        const row = this.vaultRows(card).find((r) => r.kind === "person");
        return row ? (JSON.parse(row.body) as VaultPerson) : null;
      },
      texts: (card) =>
        this.vaultRows(card)
          .filter((r) => r.kind !== "person")
          .map((r) => ({
            at: r.at,
            job: r.job,
            textKind: r.kind,
            text: r.body,
            from: r.from_party as ThreadLine["from"],
          })),
    };
  }

  offered(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const row of this.sql.exec<{ job: string; member: string }>(
      "SELECT job, member FROM offers ORDER BY job, sent_at",
    )) {
      out[row.job] = [...(out[row.job] ?? []), row.member];
    }
    return out;
  }

  memberRecords(): MemberRecord[] {
    return this.sql.exec<MemberRow>("SELECT * FROM members ORDER BY rowid").toArray().map(toMember);
  }

  membersPublic(): MemberPublic[] {
    return this.memberRecords().map(publicOf);
  }

  member(id: string): MemberRecord | null {
    const row = this.sql.exec<MemberRow>("SELECT * FROM members WHERE id = ?", id).toArray()[0];
    return row ? toMember(row) : null;
  }

  orgName(): string | null {
    return this.sql.exec<{ name: string }>("SELECT name FROM org WHERE id = 1").toArray()[0]?.name ?? null;
  }

  saveOrgName(name: string): void {
    this.sql.exec("INSERT OR REPLACE INTO org (id, name) VALUES (1, ?)", name);
  }

  memberCount(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n;
  }

  insertMember(member: MemberRecord, contact: string): void {
    this.sql.exec(
      "INSERT INTO members (id, name, contact, roles, skills, zip, on_duty, last_job_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      member.id,
      member.name,
      contact,
      JSON.stringify(member.roles),
      JSON.stringify(member.skills),
      member.zip,
      member.on ? 1 : 0,
      member.lastJobAt,
    );
  }

  setOn(member: string, on: boolean): void {
    this.sql.exec("UPDATE members SET on_duty = ? WHERE id = ?", on ? 1 : 0, member);
  }

  noteAccepts(events: readonly LedgerEvent[]): void {
    for (const e of events) {
      if (e.type === "offer.accepted")
        this.sql.exec("UPDATE members SET last_job_at = ? WHERE id = ?", e.at, e.data.member);
      if (OFFERS_END.has(e.type)) this.sql.exec("DELETE FROM offers WHERE job = ?", e.job);
    }
  }

  savePlaybook(playbook: Playbook, at: number): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO playbook (version, rows, loaded_at) VALUES (?, ?, ?)",
      playbook.version,
      JSON.stringify(playbook.rows),
      at,
    );
  }

  insertPartner(partner: PartnerRecord, contact: string): void {
    this.sql.exec(
      "INSERT INTO partners (id, name, contact) VALUES (?, ?, ?)",
      partner.id,
      partner.name,
      contact,
    );
  }

  partners(): PartnerRecord[] {
    return this.sql
      .exec<PartnerRecord>("SELECT id, name FROM partners ORDER BY rowid")
      .toArray()
      .map((p) => ({ id: p.id, name: p.name }));
  }

  playbook(): Playbook | null {
    const row = this.sql
      .exec<{ version: string; rows: string }>(
        "SELECT version, rows FROM playbook ORDER BY loaded_at DESC LIMIT 1",
      )
      .toArray()[0];
    return row ? PlaybookSchema.parse({ version: row.version, rows: JSON.parse(row.rows) as unknown }) : null;
  }
}
