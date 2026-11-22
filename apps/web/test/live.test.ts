import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeskBoardSchema, type LiveMessage } from "@vision/contracts";
import type { Auth } from "../src/api.js";
import { connectLive, useView, type LiveState } from "../src/live.js";
import { fakeSockets, fixture, mockFetch } from "./helpers.js";

const auth: Auth = { kind: "session", token: "session-token" };
const board = { status: 200, body: fixture("views/desk-board.json") };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function connect(sockets: ReturnType<typeof fakeSockets>) {
  const states: LiveState[] = [];
  const messages: LiveMessage[] = [];
  const conn = connectLive({
    url: "ws://hub/api/v1/o/comforce-demo/ws",
    protocols: ["vision", "session-token"],
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
    openSocket: sockets.openSocket,
    random: () => 0,
    now: () => 1_000,
  });
  const status = () => states.at(-1)?.status;
  return { conn, states, messages, status };
}

async function statusAfterRetries(sockets: ReturnType<typeof fakeSockets>) {
  const live = connect(sockets);
  await vi.advanceTimersByTimeAsync(1_000 + 2_000);
  return live;
}

describe("connectLive", () => {
  it("opens the socket with the vision subprotocol and the token", () => {
    const sockets = fakeSockets();
    const live = connect(sockets);
    expect(sockets.last().protocols).toEqual(["vision", "session-token"]);
    expect(live.status()).toBe("connecting");
    sockets.last().open();
    expect(live.status()).toBe("live");
  });

  it("three failed reconnects show offline", async () => {
    const sockets = fakeSockets(3);
    const live = await statusAfterRetries(sockets);
    expect(live.status()).toBe("offline");
    expect(live.states.at(-1)?.since).toBe(1_000);
    expect(sockets.made).toHaveLength(3);
  });

  it("waits 1 s, 2 s and 4 s between failed opens", async () => {
    const sockets = fakeSockets(5);
    connect(sockets);
    await vi.advanceTimersByTimeAsync(999);
    expect(sockets.made).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.made).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(sockets.made).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.made).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sockets.made).toHaveLength(4);
  });
});

describe("connectLive recovery", () => {
  it("keeps trying after 4 s while offline and comes back live", async () => {
    const sockets = fakeSockets(3);
    const live = await statusAfterRetries(sockets);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sockets.made).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets.made).toHaveLength(4);
    sockets.last().open();
    expect(live.status()).toBe("live");
  });

  it("retry opens a socket at once", async () => {
    const sockets = fakeSockets(3);
    const live = await statusAfterRetries(sockets);
    live.conn.retry();
    expect(sockets.made).toHaveLength(4);
    expect(live.status()).toBe("connecting");
    sockets.last().open();
    expect(live.status()).toBe("live");
  });
});

describe("connectLive messages", () => {
  it("passes on live messages and ignores bad ones", () => {
    const sockets = fakeSockets();
    const live = connect(sockets);
    sockets.last().open();
    sockets.last().push({ t: "changed" });
    sockets.last().push("not json");
    sockets.last().push({ t: "unknown" });
    expect(live.messages).toEqual([{ t: "changed" }]);
  });

  it("close stops every reconnect", async () => {
    const sockets = fakeSockets();
    const live = connect(sockets);
    sockets.last().open();
    live.conn.close();
    expect(sockets.last().closed).toBe(true);
    sockets.last().drop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.made).toHaveLength(1);
    expect(live.status()).toBe("live");
  });
});

function renderBoard(sockets: ReturnType<typeof fakeSockets>) {
  return renderHook(() =>
    useView("comforce-demo", auth, "desk", DeskBoardSchema, { openSocket: sockets.openSocket }),
  );
}

describe("useView", () => {
  it("reconnect_refetches_views", async () => {
    const calls = mockFetch([], board);
    const sockets = fakeSockets();
    const { result } = renderBoard(sockets);
    await act(async () => {
      sockets.last().open();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.view.state).toBe("ready");
    await act(async () => {
      sockets.last().drop();
      await vi.advanceTimersByTimeAsync(1_200);
      sockets.last().open();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sockets.made).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});

describe("useView first open", () => {
  it("first_open_after_failure_refetches_failed_view", async () => {
    const calls = mockFetch(["network", "network", "network"], board);
    const sockets = fakeSockets(1);
    const { result } = renderBoard(sockets);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_200);
    });
    expect(result.current.view).toEqual({ state: "failed", code: "network" });
    await act(async () => {
      sockets.last().open();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sockets.made).toHaveLength(2);
    expect(calls).toHaveLength(4);
    expect(result.current.view.state).toBe("ready");
  });

  it("first_open_after_failed_attempts_refetches_ready_view", async () => {
    const calls = mockFetch([], board);
    const sockets = fakeSockets(2);
    const { result } = renderBoard(sockets);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(result.current.view.state).toBe("ready");
    expect(calls).toHaveLength(1);
    await act(async () => {
      sockets.last().open();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(sockets.made).toHaveLength(3);
    expect(calls).toHaveLength(2);
  });
});

describe("useView refetch", () => {
  it("a changed message refetches the view", async () => {
    const calls = mockFetch([], board);
    const sockets = fakeSockets();
    renderBoard(sockets);
    await act(async () => {
      sockets.last().open();
      sockets.last().push({ t: "changed" });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toHaveLength(2);
  });

  it("keeps the last view when a refetch has no network", async () => {
    mockFetch([board, "network", "network", "network"]);
    const sockets = fakeSockets();
    const { result } = renderBoard(sockets);
    await act(async () => {
      sockets.last().open();
      await vi.advanceTimersByTimeAsync(0);
      sockets.last().push({ t: "changed" });
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(result.current.view.state).toBe("ready");
  });

  it("shows the rejection when the view is refused", async () => {
    mockFetch([{ status: 401, body: { ok: false, error: { code: "unauthorized", message: "No" } } }]);
    const sockets = fakeSockets();
    const { result } = renderBoard(sockets);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.view).toEqual({ state: "failed", code: "unauthorized" });
  });
});
