import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { SocketHandlers } from "../src/live.js";

export type Reply = { status: number; body: unknown } | "network";

export const okResponse: Reply = { status: 200, body: { ok: true, events: 1 } };
export const networkError: Reply = "network";

export type Call = { url: string; init: RequestInit };

export const ABOUT_NAME = "Test Group from the hub";
const aboutReply: Reply = { status: 200, body: { orgName: ABOUT_NAME } };

export function mockFetch(replies: Reply[], fallback: Reply = okResponse, about: Reply = aboutReply): Call[] {
  const calls: Call[] = [];
  const queue = [...replies];
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const isAbout = url.endsWith("/about");
    if (!isAbout) calls.push({ url, init });
    const reply = isAbout ? about : (queue.shift() ?? fallback);
    if (reply === "network") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

export function bodyOf(call: Call): unknown {
  return typeof call.init.body === "string" ? JSON.parse(call.init.body) : null;
}

export function fixture(path: string): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(resolve(here, "../../../contracts/fixtures", path), "utf8"));
}

export type FakeSocket = {
  url: string;
  protocols: string[];
  closed: boolean;
  open: () => void;
  drop: () => void;
  push: (data: unknown) => void;
};

export function fakeSockets(failOpens = 0) {
  const made: FakeSocket[] = [];
  let failsLeft = failOpens;
  const openSocket = (url: string, protocols: string[], handlers: SocketHandlers) => {
    const socket: FakeSocket = {
      url,
      protocols,
      closed: false,
      open: () => {
        handlers.open();
      },
      drop: () => {
        handlers.close();
      },
      push: (data) => {
        handlers.message(typeof data === "string" ? data : JSON.stringify(data));
      },
    };
    made.push(socket);
    if (failsLeft > 0) {
      failsLeft -= 1;
      queueMicrotask(socket.drop);
    }
    return {
      close: () => {
        socket.closed = true;
      },
    };
  };
  const last = (): FakeSocket => {
    const socket = made.at(-1);
    if (socket === undefined) throw new Error("no socket was opened");
    return socket;
  };
  return { made, openSocket, last };
}
