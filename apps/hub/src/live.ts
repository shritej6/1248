import type { Effect, LiveMessage, MemberRecord, OfferView, PageView } from "@vision/contracts";
import { fail, logEvent } from "./http.js";

export const LIVE_PROTOCOL = "vision";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

export type Listener = { kind: "member"; member: MemberRecord } | { kind: "link"; card: string };

export type LiveViews = {
  offer(job: string, member: string): OfferView | null;
  page(page: string): PageView | null;
};

type Push = { tag: string | null; message: LiveMessage };

export const socketToken = (request: Request): string | null => {
  const offered = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((p) => p.trim());
  const [protocol, token, ...extra] = offered;
  if (protocol !== LIVE_PROTOCOL || token === undefined || extra.length > 0) return null;
  return TOKEN_PATTERN.test(token) ? token : null;
};

export const tagsFor = (listener: Listener): string[] =>
  listener.kind === "member"
    ? [`member:${listener.member.id}`, ...listener.member.roles.map((r) => `role:${r}`)]
    : [`link:${listener.card}`];

const pushesFor = (effect: Effect, views: LiveViews): Push[] => {
  if (effect.kind === "offer")
    return effect.members.flatMap((m) => {
      const offer = views.offer(effect.job, m);
      return offer === null ? [] : [{ tag: `member:${m}`, message: { t: "offer", offer } }];
    });
  if (effect.kind === "offer_closed")
    return effect.members.map((m) => ({
      tag: `member:${m}`,
      message: { t: "offer_closed", job: effect.job, reason: effect.reason },
    }));
  if (effect.kind === "page") {
    const page = views.page(effect.page);
    return page === null ? [] : [{ tag: `member:${effect.member}`, message: { t: "page", page } }];
  }
  return [];
};

export class LiveChannel {
  private queued: Push[] = [];
  private depth = 0;

  constructor(private readonly ctx: DurableObjectState) {}

  open(request: Request, listener: Listener | null): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return fail("invalid", "The live channel needs a WebSocket.");
    if (listener === null) return fail("unauthorized", "Sign in again.");
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, tagsFor(listener));
    logEvent({ op: "live_open", kind: listener.kind });
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": LIVE_PROTOCOL },
    });
  }

  queue(effects: readonly Effect[], views: LiveViews): void {
    const kept = this.queued.filter((p) => p.message.t !== "changed");
    this.queued = [
      ...kept,
      ...effects.flatMap((e) => pushesFor(e, views)),
      { tag: null, message: { t: "changed" } },
    ];
  }

  within<T>(run: () => T): T {
    this.depth += 1;
    try {
      const out = run();
      if (this.depth === 1) this.flush();
      return out;
    } catch (error) {
      if (this.depth === 1) this.queued = [];
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  private flush(): void {
    const pushes = this.queued;
    this.queued = [];
    for (const push of pushes) {
      const text = JSON.stringify(push.message);
      const sockets = push.tag === null ? this.ctx.getWebSockets() : this.ctx.getWebSockets(push.tag);
      for (const ws of sockets) this.sendOne(ws, text, push.message.t);
    }
  }

  private sendOne(ws: WebSocket, text: string, t: LiveMessage["t"]): void {
    try {
      ws.send(text);
    } catch (error) {
      const reason = error instanceof Error ? error.name : "SendError";
      logEvent({ op: "live_send_failed", t, reason });
    }
  }
}
