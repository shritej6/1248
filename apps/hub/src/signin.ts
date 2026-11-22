import type { Role } from "@vision/contracts";
import { BootstrapSchema, JoinSchema, sameSecret, type SessionStore } from "./auth.js";
import { fail, json, logEvent, readJson, rejectionResponse } from "./http.js";
import type { Store } from "./store.js";

export type SignInHost = {
  store: Store;
  sessions: SessionStore;
  bootstrapCode: string;
  transaction<T>(run: () => T): T;
};

export const bootstrapOrg = async (request: Request, host: SignInHost): Promise<Response> => {
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = BootstrapSchema.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "The first organiser needs a code, a name and a contact.");
  if (!sameSecret(parsed.data.code, host.bootstrapCode))
    return fail("unauthorized", "The code is not right.");
  return host.transaction(() => {
    if (host.store.memberCount() > 0) return fail("forbidden", "This organisation already has members.");
    const id = `m_${crypto.randomUUID()}`;
    const roles: Role[] = ["organiser"];
    if (parsed.data.orgName !== undefined) host.store.saveOrgName(parsed.data.orgName);
    host.store.insertMember(
      { id, name: parsed.data.name, roles, skills: [], zip: null, on: false, lastJobAt: null },
      parsed.data.contact,
    );
    logEvent({ op: "bootstrap", member: id });
    return json({ session: host.sessions.createSession(id, Date.now()), member: { id, roles } });
  });
};

export const joinOrg = async (request: Request, host: SignInHost): Promise<Response> => {
  const body = await readJson(request);
  if (!body.ok) return rejectionResponse(body.rejection);
  const parsed = JoinSchema.safeParse(body.value);
  if (!parsed.success) return fail("invalid", "Type the join code from your organiser.");
  return host.transaction(() => {
    const id = host.sessions.useJoinCode(parsed.data.code, Date.now());
    const member = id === null ? null : host.store.member(id);
    if (member === null)
      return fail("unauthorized", "This join code does not work. Ask your organiser for a new one.");
    logEvent({ op: "join", member: member.id });
    return json({
      session: host.sessions.createSession(member.id, Date.now()),
      member: { id: member.id, roles: member.roles },
    });
  });
};
