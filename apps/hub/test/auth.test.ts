import { beforeEach, expect, it } from "vitest";
import {
  bootstrap,
  createJoinCode,
  get,
  joinWith,
  newId,
  organiser,
  post,
  send,
  freshOrg,
  hubFetch,
} from "./helpers.js";

let ORG = freshOrg();
beforeEach(() => {
  ORG = freshOrg();
});

it("join codes work once", async () => {
  const code = await createJoinCode(ORG, "m_v01");
  expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  expect((await joinWith(ORG, code)).status).toBe(200);
  expect((await joinWith(ORG, code)).status).toBe(401);
});

it("bootstrap works only for an org with no member and only with the code", async () => {
  expect(
    (await post(`${ORG}/bootstrap`, { code: "wrong", name: "Q", contact: "q@example.test" })).status,
  ).toBe(401);
  expect(await bootstrap(ORG)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(
    (await post(`${ORG}/bootstrap`, { code: "test-bootstrap-code", name: "Q", contact: "q@example.test" }))
      .status,
  ).toBe(403);
});

it("only an organiser can create a join code or export", async () => {
  const code = await createJoinCode(ORG, "m_d01");
  const desk = (await (await joinWith(ORG, code)).json<{ session: string }>()).session;
  expect(
    (
      await send(ORG, desk, {
        id: newId(),
        type: "join.create",
        member: "m_c49cea58-4873-4fae-92e0-e292ec742a7f",
      })
    ).status,
  ).toBe(403);
  expect((await get(`${ORG}/export`, desk)).status).toBe(403);
  expect((await get(`${ORG}/export`, await organiser(ORG))).status).toBe(200);
});

it("an organiser adds a member and a partner without any ledger line", async () => {
  const o = await organiser(ORG);
  const m = await send(ORG, o, {
    id: newId(),
    type: "member.add",
    name: "Test Person",
    contact: "t@example.test",
    roles: ["volunteer"],
    skills: ["snow"],
    zip: "53216",
  });
  expect(await m.json()).toMatchObject({
    ok: true,
    events: 0,
    id: expect.stringMatching(/^m_/) as unknown,
  });
  const p = await send(ORG, o, {
    id: newId(),
    type: "partner.add",
    name: "Test Pantry",
    contact: "p@example.test",
  });
  expect(p.status).toBe(200);
});

it("a bad org name or an unknown path is 404", async () => {
  expect((await hubFetch("https://hub.test/api/v1/o/BAD!/commands")).status).toBe(404);
  expect((await hubFetch(`https://hub.test/api/v1/o/${ORG}/nothing`)).status).toBe(404);
});
