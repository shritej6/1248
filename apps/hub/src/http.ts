import { rejectionStatus, type Rejection, type RejectionCode } from "@vision/contracts";

export const BODY_LIMIT = 16 * 1024;
export const ORG_PATTERN = /^[a-z0-9-]{3,32}$/;

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export const rejection = (code: RejectionCode, message: string): Rejection => ({ code, message });

export const rejectionResponse = (r: Rejection): Response =>
  json({ ok: false, error: { code: r.code, message: r.message } }, rejectionStatus[r.code]);

export const fail = (code: RejectionCode, message: string): Response =>
  rejectionResponse(rejection(code, message));

export type BodyResult = { ok: true; value: unknown } | { ok: false; rejection: Rejection };

const TOO_LARGE: BodyResult = { ok: false, rejection: rejection("too_large", "The request is too large.") };

const readLimited = async (request: Request): Promise<string | null> => {
  const body = request.body as ReadableStream<Uint8Array> | null;
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
};

export const readJson = async (request: Request): Promise<BodyResult> => {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > BODY_LIMIT) return TOO_LARGE;
  const text = await readLimited(request);
  if (text === null) return TOO_LARGE;
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.name : "ParseError";
    return { ok: false, rejection: rejection("invalid", `The request body is not valid JSON (${reason}).`) };
  }
};

export type ApiPath = { org: string; rest: string[] };

export const apiPath = (url: URL): ApiPath | null => {
  const parts = url.pathname.split("/").filter((p) => p.length > 0);
  const [api, version, o, org, ...rest] = parts;
  if (api !== "api" || version !== "v1" || o !== "o" || org === undefined) return null;
  return ORG_PATTERN.test(org) ? { org, rest } : null;
};

export const logEvent = (fields: Record<string, string | number | null>): void => {
  console.log(JSON.stringify(fields));
};

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "Error");

export const unhandled = (request: Request, error: unknown): Response => {
  const route = `${request.method} ${new URL(request.url).pathname.split("/")[5] ?? ""}`;
  logEvent({ op: "unhandled", route, error: errorName(error) });
  return fail("internal", "The hub could not finish this request. Try again in a minute.");
};

export const logFailure = async (op: string, run: () => unknown): Promise<void> => {
  try {
    await run();
  } catch (error) {
    logEvent({ op, status: "failed", error: errorName(error) });
  }
};
