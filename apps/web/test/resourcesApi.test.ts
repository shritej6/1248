import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftIdSchema, ResourcesViewSchema } from "@vision/contracts";
import { FETCH_TIMEOUT_MS, type Auth } from "../src/api.js";
import { newDraftId, resourcesClient, type ResourcesOutcome } from "../src/resourcesApi.js";
import { bodyOf, fixture, mockFetch, networkError, type Reply } from "./helpers.js";

const auth: Auth = { kind: "session", token: "session-token" };
const view = ResourcesViewSchema.parse(fixture("views/resources-demo.json"));
const capMessage = "Vision writes at most 20 drafts a day. Try again tomorrow.";
const NETWORK_WORDS = "Vision could not reach the hub. Check the connection and try again.";
const UNREADABLE_WORDS = "The hub sent an answer that Vision cannot read.";

const failure = (status: number, code: string, message: string): Reply => ({
  status,
  body: { ok: false, error: { code, message } },
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resourcesClient requests", () => {
  it("load reads the resources view with the bearer token", async () => {
    const calls = mockFetch([{ status: 200, body: view }]);
    const outcome = await resourcesClient("comforce-demo", auth).load();
    expect(outcome).toEqual({ ok: true, view });
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/resources");
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer session-token");
    expect(calls[0]?.init.method).toBeUndefined();
  });

  it("post sends the body as JSON to the action path", async () => {
    const calls = mockFetch([{ status: 201, body: view }]);
    const ask = { draft: newDraftId(), kind: "impact_post", month: "2026-11", resource: null };
    const outcome = await resourcesClient("comforce-demo", auth).post("drafts", ask);
    expect(outcome.ok).toBe(true);
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/resources/drafts");
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/json");
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toEqual(ask);
  });

  it("a draft id is d_ with a version 4 UUID", () => {
    expect(DraftIdSchema.safeParse(newDraftId()).success).toBe(true);
    expect(newDraftId()).not.toBe(newDraftId());
  });
});

const CASES: [name: string, reply: Reply, expected: ResourcesOutcome][] = [
  [
    "a 429 gives the hub message as is",
    failure(429, "rate_limited", capMessage),
    { ok: false, code: "rate_limited", message: capMessage },
  ],
  [
    "a 403 gives the hub message as is",
    failure(403, "forbidden", "Only an organiser can use Resources."),
    { ok: false, code: "forbidden", message: "Only an organiser can use Resources." },
  ],
  [
    "a network error says the hub is not reachable",
    networkError,
    { ok: false, code: "network", message: NETWORK_WORDS },
  ],
  [
    "a body that is not a view says the answer cannot be read",
    { status: 200, body: { ...view, demo: "yes" } },
    { ok: false, code: "invalid", message: UNREADABLE_WORDS },
  ],
  [
    "an error body that is not readable says the answer cannot be read",
    { status: 400, body: { problem: true } },
    { ok: false, code: "invalid", message: UNREADABLE_WORDS },
  ],
  [
    "a server error with no error body says the hub is not reachable",
    { status: 502, body: "Bad gateway" },
    { ok: false, code: "network", message: NETWORK_WORDS },
  ],
];

describe("resourcesClient failures", () => {
  it.each(CASES)("%s", async (_name, reply, expected) => {
    mockFetch([reply]);
    expect(await resourcesClient("comforce-demo", auth).post("approve", { draft: newDraftId() })).toEqual(
      expected,
    );
  });

  it("a fetch that never answers stops after the timeout and logs the error name", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(init.signal?.reason as Error);
            });
          }),
      ),
    );
    const outcome = resourcesClient("comforce-demo", auth).load();
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    expect(await outcome).toEqual({ ok: false, code: "network", message: NETWORK_WORDS });
    expect(console.warn).toHaveBeenCalledWith("resources: load got no answer (TimeoutError)");
  });
});
