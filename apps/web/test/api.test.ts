import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandIdSchema, DeskBoardSchema, JobCardSchema, type Command } from "@vision/contracts";
import {
  ApiError,
  FETCH_TIMEOUT_MS,
  getView,
  joinOrg,
  newCommandId,
  sendCommand,
  type Auth,
} from "../src/api.js";
import { bodyOf, fixture, mockFetch, networkError, okResponse } from "./helpers.js";

const auth: Auth = { kind: "session", token: "session-token" };
const cmd: Command = {
  id: "cmd_0b7c3e2a-1002-4d6f-9a1b-2c3d4e5f6a7b",
  type: "offer.accept",
  job: "j_8d4f1b27-6c3e-4a95-b0d8-7e2a5c9f1b63",
};
const taken = { status: 409, body: { ok: false, error: { code: "taken", message: "Taken" } } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendCommand", () => {
  it("a network error resends the same command id up to 3 attempts", async () => {
    const calls = mockFetch([networkError, networkError, okResponse]);
    const outcome = sendCommand("comforce-demo", auth, cmd);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ ok: true });
    const seen = calls.map((c) => (bodyOf(c) as { id: string }).id);
    expect(new Set(seen).size).toBe(1);
    expect(seen).toHaveLength(3);
  });

  it("waits 300 ms and then 900 ms between attempts", async () => {
    const calls = mockFetch([networkError, networkError, networkError]);
    const outcome = sendCommand("comforce-demo", auth, cmd);
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(899);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    expect(await outcome).toEqual({ ok: false, code: "network" });
  });

  it("a server error is tried again like a network error", async () => {
    const calls = mockFetch([{ status: 503, body: {} }, okResponse]);
    const outcome = sendCommand("comforce-demo", auth, cmd);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
  });
});

describe("sendCommand on a stalled or lost reply", () => {
  it("a fetch that never answers fails after the timeout and is tried again", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            calls.push(init);
            init.signal?.addEventListener("abort", () => {
              reject(init.signal?.reason as Error);
            });
          }),
      ),
    );
    const outcome = sendCommand("comforce-demo", auth, { ...cmd, job: "j_stalled" });
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.runAllTimersAsync();
    expect(await outcome).toEqual({ ok: false, code: "network" });
    expect(calls).toHaveLength(3);
  });

  it("a new tap after a network failure resends the first command id", async () => {
    const calls = mockFetch([networkError, networkError, networkError, okResponse, okResponse]);
    const jump: Command = { id: newCommandId(), type: "clock.jump", minutes: 60 };
    const first = sendCommand("comforce-demo", auth, jump);
    await vi.runAllTimersAsync();
    expect(await first).toEqual({ ok: false, code: "network" });
    const again = sendCommand("comforce-demo", auth, { ...jump, id: newCommandId() });
    await vi.runAllTimersAsync();
    expect(await again).toEqual({ ok: true });
    const later = sendCommand("comforce-demo", auth, { ...jump, id: newCommandId() });
    await vi.runAllTimersAsync();
    await later;
    const ids = calls.map((c) => (bodyOf(c) as { id: string }).id);
    expect(ids.slice(0, 4)).toEqual([jump.id, jump.id, jump.id, jump.id]);
    expect(ids[4]).not.toBe(jump.id);
  });
});

describe("sendCommand answers", () => {
  it("a rejection returns its code and is not sent again", async () => {
    const calls = mockFetch([taken]);
    expect(await sendCommand("comforce-demo", auth, cmd)).toEqual({ ok: false, code: "taken" });
    expect(calls).toHaveLength(1);
  });

  it("a session posts to the org commands with a bearer token", async () => {
    const calls = mockFetch([okResponse]);
    await sendCommand("comforce-demo", auth, cmd);
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/commands");
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer session-token");
  });

  it("a link token posts to its own link path with no bearer token", async () => {
    const calls = mockFetch([okResponse, okResponse]);
    await sendCommand("comforce-demo", { kind: "track", token: "tok" }, cmd);
    await sendCommand("comforce-demo", { kind: "partner", token: "ptok" }, cmd);
    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/o/comforce-demo/t/tok/commands",
      "/api/v1/o/comforce-demo/p/ptok/commands",
    ]);
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBeNull();
  });

  it("a body that is not a command response is invalid", async () => {
    mockFetch([{ status: 200, body: { hello: 1 } }]);
    expect(await sendCommand("comforce-demo", auth, cmd)).toEqual({ ok: false, code: "invalid" });
  });
});

describe("getView", () => {
  it("parses the view with its schema", async () => {
    const calls = mockFetch([{ status: 200, body: fixture("views/desk-board.json") }]);
    const view = await getView("comforce-demo", auth, "desk", DeskBoardSchema);
    expect(view.clock.now).toBeGreaterThan(0);
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/views/desk");
  });

  it("sends the query for the job view", async () => {
    const calls = mockFetch([{ status: 200, body: fixture("views/job-accepted.json") }]);
    await getView("comforce-demo", auth, "job", JobCardSchema, { job: "j_1" });
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/views/job?job=j_1");
  });

  it("a link token reads its link path", async () => {
    const calls = mockFetch([{ status: 200, body: fixture("views/tracking-open.json") }]);
    const { TrackingSchema } = await import("@vision/contracts");
    await getView("comforce-demo", { kind: "track", token: "tok" }, "tracking", TrackingSchema);
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/t/tok");
  });
});

describe("getView failures", () => {
  it("a view that drifts from its contract fails as invalid", async () => {
    const drifted = { ...(fixture("views/desk-board.json") as object), extra: 1 };
    mockFetch([{ status: 200, body: drifted }]);
    await expect(getView("comforce-demo", auth, "desk", DeskBoardSchema)).rejects.toEqual(
      new ApiError("invalid", "The view desk does not match its contract."),
    );
  });

  it("a rejection fails with its code", async () => {
    mockFetch([{ status: 401, body: { ok: false, error: { code: "unauthorized", message: "No" } } }]);
    await expect(getView("comforce-demo", auth, "desk", DeskBoardSchema)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("three network errors fail as network", async () => {
    mockFetch([networkError, networkError, networkError]);
    const view = getView("comforce-demo", auth, "desk", DeskBoardSchema);
    const settled = view.catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await settled).toMatchObject({ code: "network" });
  });
});

describe("joinOrg", () => {
  const member = { id: "m_1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", roles: ["desk"] };

  it("returns the session and the roles", async () => {
    const calls = mockFetch([{ status: 200, body: { session: "s1", member } }]);
    expect(await joinOrg("comforce-demo", "K7M2Q9XR")).toEqual({ ok: true, session: "s1", member });
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/join");
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toEqual({ code: "K7M2Q9XR" });
  });

  it("is sent once only, because a join code works one time", async () => {
    const calls = mockFetch([networkError]);
    expect(await joinOrg("comforce-demo", "K7M2Q9XR")).toEqual({ ok: false, code: "network" });
    expect(calls).toHaveLength(1);
  });

  it("a used code returns unauthorized", async () => {
    mockFetch([{ status: 401, body: { ok: false, error: { code: "unauthorized", message: "Used" } } }]);
    expect(await joinOrg("comforce-demo", "K7M2Q9XR")).toEqual({ ok: false, code: "unauthorized" });
  });
});

describe("newCommandId", () => {
  it("makes a new command id each time", () => {
    const a = newCommandId();
    expect(CommandIdSchema.safeParse(a).success).toBe(true);
    expect(newCommandId()).not.toBe(a);
  });
});
