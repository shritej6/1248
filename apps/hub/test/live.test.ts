import { LiveMessageSchema, type LiveMessage } from "@vision/contracts";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  accept,
  confirmCmd,
  freshOrg,
  hubFetch,
  jobOfCard,
  join,
  loadPlaybook,
  newId,
  organiser,
  send,
  submitForm,
} from "./helpers.js";

type Socket = {
  protocol: string | null;
  next(t: LiveMessage["t"], ms?: number): Promise<LiveMessage>;
  nothingWithin(ms: number, t: LiveMessage["t"]): Promise<boolean>;
  close(): void;
};

let ORG = freshOrg();
let open: Socket[] = [];
beforeEach(() => {
  ORG = freshOrg();
  open = [];
});
afterEach(() => {
  for (const s of open) s.close();
});

const rawUpgrade = (token: string): Promise<Response> =>
  hubFetch(`https://hub.test/api/v1/o/${ORG}/ws`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `vision, ${token}` },
  });

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const listen = (r: Response): Socket => {
  const ws = r.webSocket;
  if (ws === null) throw new Error(`No socket, status ${String(r.status)}`);
  ws.accept();
  const seen: LiveMessage[] = [];
  ws.addEventListener("message", (e) => {
    seen.push(LiveMessageSchema.parse(JSON.parse(String(e.data))));
  });
  const find = (t: LiveMessage["t"]) => seen.find((m) => m.t === t);
  const socket: Socket = {
    protocol: r.headers.get("Sec-WebSocket-Protocol"),
    async next(t, ms = 2000) {
      for (let waited = 0; waited < ms; waited += 20) {
        const found = find(t);
        if (found) return found;
        await wait(20);
      }
      throw new Error(`No ${t} message within ${String(ms)} ms`);
    },
    async nothingWithin(ms, t) {
      await wait(ms);
      return find(t) === undefined;
    },
    close: () => {
      ws.close(1000, "done");
    },
  };
  open.push(socket);
  return socket;
};

const socket = async (alias: string): Promise<Socket> => listen(await rawUpgrade(await join(ORG, alias)));

const snowCard = async (urgency: "high" | "low"): Promise<{ desk: string; job: string }> => {
  const desk = await join(ORG, "m_d01");
  await loadPlaybook(ORG);
  const card = await submitForm(ORG, {
    firstName: "Avery",
    address: "1 Test St",
    message: "Snow on my walk",
  });
  await send(ORG, desk, { ...confirmCmd(card), urgency });
  return { desk, job: await jobOfCard(ORG, card) };
};

const approveSnow = async (): Promise<string> => {
  const { desk, job } = await snowCard("low");
  await send(ORG, desk, { id: newId(), type: "job.approve", job });
  return job;
};

it("an offer reaches only the members of the wave", async () => {
  const s1 = await socket("m_v01");
  const s9 = await socket("m_v09");
  await approveSnow();
  expect(await s1.next("offer")).toMatchObject({ t: "offer", offer: { needLabel: "Snow shovelling" } });
  expect(await s9.nothingWithin(300, "offer")).toBe(true);
});

it("an offer holds no name and no address", async () => {
  const s1 = await socket("m_v01");
  const job = await approveSnow();
  const offer = await s1.next("offer");
  expect(offer).toMatchObject({ offer: { job, bring: "Shovel and salt", crew: 1, distanceMiles: 0 } });
  expect(JSON.stringify(offer)).not.toMatch(/Avery|Test St|Snow on my walk/);
});

it("the loser of an accept gets offer_closed with taken", async () => {
  const v1 = await join(ORG, "m_v01");
  const s1 = await socket("m_v01");
  const s2 = await socket("m_v02");
  const job = await approveSnow();
  expect((await send(ORG, v1, accept(job))).status).toBe(200);
  expect(await s2.next("offer_closed")).toMatchObject({ t: "offer_closed", job, reason: "taken" });
  expect(await s1.nothingWithin(300, "offer_closed")).toBe(true);
});

it("each committed command sends changed to every socket of the org", async () => {
  const desk = await socket("m_d01");
  const other = await socket("m_v09");
  await approveSnow();
  expect(await desk.next("changed")).toEqual({ t: "changed" });
  expect(await other.next("changed")).toEqual({ t: "changed" });
});

it("a page goes only to the paged member", async () => {
  const paged = listen(await rawUpgrade(await organiser(ORG)));
  const desk = await socket("m_d01");
  await snowCard("high");
  expect(await paged.next("page")).toMatchObject({ t: "page", page: { reason: "high" } });
  expect(await desk.nothingWithin(300, "page")).toBe(true);
});

it("the server answers the subprotocol vision", async () => {
  expect((await socket("m_v01")).protocol).toBe("vision");
});

it("a bad token cannot open a socket", async () => {
  await organiser(ORG);
  expect((await rawUpgrade("bad")).status).toBe(401);
});

it("a request without an upgrade header is refused", async () => {
  const token = await join(ORG, "m_v01");
  const r = await hubFetch(`https://hub.test/api/v1/o/${ORG}/ws`, {
    headers: { "Sec-WebSocket-Protocol": `vision, ${token}` },
  });
  expect(r.status).toBe(400);
});

it("a tracking link opens a socket that hears changed and no offer", async () => {
  await organiser(ORG);
  const form = {
    firstName: "Avery",
    contactKind: "email",
    contact: "avery@example.test",
    zip: "53216",
    message: "Snow on my walk",
    address: "1 Test St",
    safeContact: true,
    website: "",
  };
  const r = await hubFetch(`https://hub.test/api/v1/o/${ORG}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.8" },
    body: JSON.stringify(form),
  });
  const { tracking } = await r.json<{ tracking: string }>();
  const resident = listen(await rawUpgrade(tracking.split("/").at(-1) ?? ""));
  await socket("m_v01");
  await approveSnow();
  expect(await resident.next("changed")).toEqual({ t: "changed" });
  expect(await resident.nothingWithin(300, "offer")).toBe(true);
});
