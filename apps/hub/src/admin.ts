import type { AdminCommand, Command, Rejection } from "@vision/contracts";
import type { SessionStore } from "./auth.js";
import { rejection } from "./http.js";
import type { Store } from "./store.js";

export type AdminResult =
  | { ok: true; body: { ok: true; events: 0; id?: string; code?: string } }
  | { ok: false; rejection: Rejection };

export const isAdmin = (
  c: Command,
): c is Extract<Command, { type: "member.add" | "partner.add" | "join.create" }> =>
  c.type === "member.add" || c.type === "partner.add" || c.type === "join.create";

export type AdminDeps = { store: Store; sessions: SessionStore; now: number };

export const runAdmin = (command: AdminCommand, deps: AdminDeps): AdminResult => {
  const { store, sessions, now } = deps;
  if (command.type === "member.add") {
    const id = `m_${crypto.randomUUID()}`;
    const record = {
      id,
      name: command.name,
      roles: command.roles,
      skills: command.skills,
      zip: command.zip,
      on: false,
      lastJobAt: null,
    };
    store.insertMember(record, command.contact);
    return { ok: true, body: { ok: true, events: 0, id } };
  }
  if (command.type === "partner.add") {
    const id = `p_${crypto.randomUUID()}`;
    store.insertPartner({ id, name: command.name }, command.contact);
    return { ok: true, body: { ok: true, events: 0, id } };
  }
  if (store.member(command.member) === null) {
    return { ok: false, rejection: rejection("not_found", "There is no such member.") };
  }
  return { ok: true, body: { ok: true, events: 0, code: sessions.createJoinCode(command.member, now) } };
};
