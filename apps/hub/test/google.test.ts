import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env as workerEnv } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerEventSchema, PlaybookSchema, StatementSchema } from "@vision/contracts";
import { statement } from "@vision/core";
import playbookJson from "../../../data/synthetic/playbook.json";
import { cardForMessage } from "../src/doors.js";
import { createGoogle, GoogleError } from "../src/google.js";
import { mailKey } from "../src/outbox.js";
import type { Env } from "../src/orghub.js";
import {
  confirmCmd,
  exportLedger,
  freshOrg,
  hubFetch,
  join,
  loadPlaybook,
  offeredSnowJob,
  organiser,
  post,
  send,
  sql,
} from "./helpers.js";

const env = workerEnv as unknown as Env;
const GOOGLE = "https://google.test/exec";
const API = "https://hub.test/api/v1/o";
const MINUTE = 60_000;
const FUTURE = 365 * 24 * 60 * MINUTE;
const PLAYBOOK = PlaybookSchema.parse(playbookJson);

type FakeGoogle = {
  posts: Record<string, unknown>[];
  ledgerLines: number;
  sheet: number[];
  playbookCalls: number;
  failLedger: number;
};

let ORG = freshOrg();
let clock = 0;
beforeEach(async () => {
  ORG = freshOrg();
  clock = Date.now() + FUTURE;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await organiser(ORG);
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, { GOOGLE_URL: "", GOOGLE_SECRET: "", DOOR_SECRET: "test-door-secret" });
});

const stub = (org: string) => env.ORG.getByName(org);

const keepNewLines = (g: FakeGoogle, lines: unknown): void => {
  const known = g.sheet.at(-1) ?? 0;
  const seqs = LedgerEventSchema.array()
    .parse(lines)
    .map((l) => l.seq);
  g.ledgerLines += seqs.length;
  g.sheet.push(...seqs.filter((seq) => seq > known));
};

const fakeGoogle = (failLedger = 0): FakeGoogle => {
  const g: FakeGoogle = { posts: [], ledgerLines: 0, sheet: [], playbookCalls: 0, failLedger };
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${GOOGLE}?`) && url.includes("kind=playbook")) {
      g.playbookCalls += 1;
      return Promise.resolve(Response.json({ playbook: PLAYBOOK }));
    }
    if (url !== GOOGLE || typeof init?.body !== "string") throw new TypeError("Unexpected outside call");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (body.kind === "ledger" && g.failLedger > 0) {
      g.failLedger -= 1;
      return Promise.resolve(new Response("down", { status: 503 }));
    }
    g.posts.push(body);
    if (body.kind === "ledger") keepNewLines(g, body.lines);
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  return g;
};

const useGoogle = (url: string): Promise<void> =>
  runInDurableObject(stub(ORG), (hub) => {
    Object.assign((hub as unknown as { env: Env }).env, {
      GOOGLE_URL: url,
      GOOGLE_SECRET: "test-google-secret",
    });
  });

const doneSnowJob = async (g: FakeGoogle | null): Promise<void> => {
  await useGoogle(g === null ? "" : GOOGLE);
  await offeredSnowJob(ORG);
};

const runAlarmTimes = async (times: number): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await runDurableObjectAlarm(stub(ORG));
    clock += 10 * MINUTE;
  }
};

const outboxCount = (): Promise<number> =>
  sql(ORG, (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE kind != 'sort'").one().n);

const mail = (messageId: string) => ({
  messageId,
  fromName: "Avery Test",
  fromAddress: "avery@example.test",
  subject: "Snow help",
  text: "Snow on my walk at 53216, I cannot get out.",
});

const postEmail = (body: Record<string, unknown>, secret = env.DOOR_SECRET ?? ""): Promise<Response> =>
  hubFetch(`${API}/${ORG}/doors/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Door-Secret": secret },
    body: JSON.stringify(body),
  });

describe("mail door", () => {
  it("the mail door is idempotent by message id", async () => {
    expect((await postEmail(mail("m-1"))).status).toBe(201);
    expect((await postEmail(mail("m-1"))).status).toBe(200);
    const received = (await exportLedger(ORG)).events.filter((e) => e.type === "card.received");
    expect(received).toHaveLength(1);
    expect(received[0]?.card).toBe(cardForMessage("m-1"));
    expect(received[0]?.data).toEqual({ door: "email", zip: "53216", safeContact: true });
  });

  it("a five digit house number is not taken as the ZIP", async () => {
    await postEmail({ ...mail("m-5"), text: "Snow at 10125 W North Ave, I cannot get out." });
    const received = (await exportLedger(ORG)).events.find((e) => e.type === "card.received");
    expect(received?.data).toEqual({ door: "email", zip: null, safeContact: true });
  });

  it("the mail door refuses a wrong secret", async () => {
    expect((await postEmail(mail("m-2"), "wrong")).status).toBe(401);
    expect((await exportLedger(ORG)).events).toHaveLength(0);
  });

  it("the mail door keeps the sender and the words out of the ledger", async () => {
    await postEmail(mail("m-3"));
    expect(JSON.stringify(await exportLedger(ORG))).not.toMatch(/Avery|avery@example|Snow on my walk/);
  });

  it("a mail with no words is refused", async () => {
    expect((await postEmail({ ...mail("m-4"), subject: " ", text: "" })).status).toBe(400);
  });
});

describe("outbox to Google", () => {
  it("new ledger lines go to Drive through the outbox", async () => {
    const g = fakeGoogle();
    await doneSnowJob(g);
    await runAlarmTimes(1);
    expect(g.ledgerLines).toBeGreaterThan(0);
    expect(g.posts.every((p) => p.secret === "test-google-secret")).toBe(true);
    expect(await outboxCount()).toBe(0);
  });

  it("the receipt goes by mail to a resident who wrote from a mail address", async () => {
    const g = fakeGoogle();
    await doneSnowJob(g);
    await runAlarmTimes(1);
    const mails = g.posts.filter((p) => p.kind === "mail" && p.to === "resident@example.test");
    expect(mails.length).toBeGreaterThan(0);
    expect(mails[0]?.body).toMatch(/Your code is SNOW-16-\d{3}\./);
  });

  it("the hub works with no Google url", async () => {
    await doneSnowJob(null);
    expect(await outboxCount()).toBe(0);
  });
});

const mailedCards = (): Promise<number> =>
  sql(
    ORG,
    (s) =>
      s
        .exec<{ n: number }>(
          "SELECT COUNT(DISTINCT card) AS n FROM outbox WHERE kind = 'mail' AND json_extract(payload, '$.to') = 'avery@example.test'",
        )
        .one().n,
  );

const mailedRequest = async (desk: string, id: string): Promise<void> => {
  expect((await postEmail({ ...mail(id), text: `Snow on my walk at 53216, ${id}` })).status).toBe(201);
  await send(ORG, desk, confirmCmd(cardForMessage(id)));
};

describe("resident mail limit", () => {
  it("one address gets mail for at most three requests a day, so a form cannot flood a stranger", async () => {
    await useGoogle(GOOGLE);
    await loadPlaybook(ORG);
    const desk = await join(ORG, "m_d01");
    for (const id of ["m-f1", "m-f2", "m-f3", "m-f4", "m-f5"]) await mailedRequest(desk, id);
    expect(await mailedCards()).toBe(3);
    clock += 25 * 60 * MINUTE;
    await mailedRequest(desk, "m-f6");
    expect(await mailedCards()).toBe(4);
  });
});

describe("resident mail key", () => {
  it("one Gmail inbox written five ways counts as one address", async () => {
    await useGoogle(GOOGLE);
    await loadPlaybook(ORG);
    const desk = await join(ORG, "m_d01");
    const ways = [
      "avery@gmail.com",
      "Avery+1@gmail.com",
      "a.very@gmail.com",
      "avery@gmail.com.",
      "a.v.e.r.y+snow@googlemail.com",
    ];
    for (const [i, fromAddress] of ways.entries()) {
      const id = `m-k${String(i)}`;
      expect(
        (await postEmail({ ...mail(id), fromAddress, text: `Snow on my walk at 53216, ${id}` })).status,
      ).toBe(201);
      await send(ORG, desk, confirmCmd(cardForMessage(id)));
    }
    const mailed = await sql(
      ORG,
      (s) =>
        s.exec<{ n: number }>("SELECT COUNT(DISTINCT card) AS n FROM outbox WHERE kind = 'mail'").one().n,
    );
    expect(mailed).toBe(3);
  });

  it("keeps the plus tag and dots of an address outside Gmail", () => {
    expect(mailKey(" Avery.Test+snow@Example.test. ")).toBe("avery.test@example.test");
    expect(mailKey("a.v.e.r.y+1@googlemail.com")).toBe("avery@gmail.com");
  });
});

describe("outbox gaps and unset secrets", () => {
  it("every ledger line reaches the sheet when an older send fails and a newer one goes first", async () => {
    const g = fakeGoogle(1);
    await doneSnowJob(g);
    const queued = await sql(
      ORG,
      (s) => s.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'ledger'").one().n,
    );
    expect(queued).toBeGreaterThan(1);
    await runAlarmTimes(3);
    const seqs = (await exportLedger(ORG)).events.map((e) => e.seq);
    expect(g.sheet).toEqual(seqs);
    expect(await outboxCount()).toBe(0);
  });

  it("the hub takes cards when the Google and door secrets were never set", async () => {
    await runInDurableObject(stub(ORG), (hub) => {
      const hubEnv = (hub as unknown as { env: Partial<Env> }).env;
      delete hubEnv.GOOGLE_URL;
      delete hubEnv.GOOGLE_SECRET;
      delete hubEnv.DOOR_SECRET;
    });
    await offeredSnowJob(ORG);
    expect((await exportLedger(ORG)).events.length).toBeGreaterThan(0);
    expect((await postEmail(mail("m-unset"), "")).status).toBe(401);
  });
});

const ask = (action: string, body: unknown, token: string) => post(`${ORG}/google/${action}`, body, token);

describe("organiser buttons", () => {
  it("the playbook loads from the sheet as one ledger line", async () => {
    const g = fakeGoogle();
    await useGoogle(GOOGLE);
    const r = await ask("playbook", {}, await organiser(ORG));
    expect(r.status).toBe(200);
    expect(g.playbookCalls).toBe(1);
    const loaded = (await exportLedger(ORG)).events.filter((e) => e.type === "playbook.loaded");
    expect(loaded).toHaveLength(1);
  });

  it("the statement the browser computed goes to Drive through the outbox", async () => {
    const g = fakeGoogle();
    await useGoogle(GOOGLE);
    const shown = statement([], "2026-11");
    expect((await ask("statement", { statement: shown }, await organiser(ORG))).status).toBe(202);
    await runAlarmTimes(1);
    const sent = g.posts.find((p) => p.kind === "statement");
    expect(StatementSchema.parse(sent?.statement)).toEqual(shown);
  });

  it("the buttons say the link is off when the hub has no Google url", async () => {
    await useGoogle("");
    const r = await ask("playbook", {}, await organiser(ORG));
    expect(r.status).toBe(409);
    expect(await r.text()).toMatch(/Google link is not set up/);
  });
});

describe("organiser buttons refuse", () => {
  it("only an organiser can use the buttons", async () => {
    await useGoogle(GOOGLE);
    expect((await ask("statement", { statement: statement([], "2026-11") }, "not-a-session")).status).toBe(
      403,
    );
  });

  it("a statement that is not in the statement shape is refused", async () => {
    await useGoogle(GOOGLE);
    expect((await ask("statement", { month: "2026-11" }, await organiser(ORG))).status).toBe(400);
  });
});

describe("createGoogle", () => {
  it("tries the playbook sheet 3 times and then gives a typed error", async () => {
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response("down", { status: 503 }));
    };
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = createGoogle(GOOGLE, "s", fetcher).fetchPlaybook();
    const caught = pending.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await caught).toBeInstanceOf(GoogleError);
    expect(calls).toBe(3);
  });

  it("sends each kind with the secret", async () => {
    const bodies: unknown[] = [];
    const fetcher: typeof fetch = (_input, init) => {
      bodies.push(JSON.parse(typeof init?.body === "string" ? init.body : "null"));
      return Promise.resolve(new Response("{}"));
    };
    const g = createGoogle(GOOGLE, "s", fetcher);
    await g.sendMail("a@example.test", "Hello", "Body");
    await g.appendLedger([]);
    expect(bodies).toEqual([
      { to: "a@example.test", subject: "Hello", body: "Body", secret: "s", kind: "mail" },
      { lines: [], secret: "s", kind: "ledger" },
    ]);
  });
});
