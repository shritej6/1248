import { expect, it } from "vitest";
import { BODY_LIMIT, readJson } from "../src/http.js";

const CHUNK = 1024;

const streamOf = (chunks: number) => {
  const pulled = { count: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count >= chunks) {
        controller.close();
        return;
      }
      pulled.count += 1;
      controller.enqueue(new Uint8Array(CHUNK).fill(97));
    },
  });
  return { body, pulled };
};

const streamRequest = (body: ReadableStream<Uint8Array>, length?: number): Request =>
  new Request("https://hub.test/api/v1/o/comforce-demo/commands", {
    method: "POST",
    headers: length === undefined ? {} : { "Content-Length": String(length) },
    body,
    duplex: "half",
  } as RequestInit);

it("a body with no length stops being read once it passes the limit", async () => {
  const { body, pulled } = streamOf(1000);
  const result = await readJson(streamRequest(body));
  expect(result).toMatchObject({ ok: false, rejection: { code: "too_large" } });
  expect(pulled.count).toBeLessThanOrEqual(BODY_LIMIT / CHUNK + 2);
});

it("a body that claims a small length but sends more is refused", async () => {
  const { body, pulled } = streamOf(1000);
  const result = await readJson(streamRequest(body, 10));
  expect(result).toMatchObject({ ok: false, rejection: { code: "too_large" } });
  expect(pulled.count).toBeLessThanOrEqual(BODY_LIMIT / CHUNK + 2);
});

it("a small JSON body is read in full", async () => {
  const request = new Request("https://hub.test/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
  expect(await readJson(request)).toEqual({ ok: true, value: { a: 1 } });
});
