import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { LiveMessageSchema, type LiveMessage } from "@vision/contracts";
import { ApiError, getView, type Auth, type FailureCode, type ViewName, type ViewQuery } from "./api.js";

export type LiveStatus = "live" | "connecting" | "offline";
export type LiveState = { status: LiveStatus; since: number | null };
export type LiveHandle = LiveState & { retry: () => void };
export type SocketHandlers = { open: () => void; close: () => void; message: (data: unknown) => void };
export type OpenSocket = (
  url: string,
  protocols: string[],
  handlers: SocketHandlers,
) => { close: () => void };
export type LiveConnection = { retry: () => void; close: () => void };

export type LiveOptions = {
  url: string;
  protocols: string[];
  onMessage: (message: LiveMessage) => void;
  onState: (state: LiveState) => void;
  onReopen?: (() => void) | undefined;
  openSocket?: OpenSocket | undefined;
  random?: () => number;
  now?: () => number;
};

export const RECONNECT_WAITS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;
export const OFFLINE_AFTER = 3;
const JITTER = 0.2;
const LAST_WAIT = 15_000;

export const browserSocket: OpenSocket = (url, protocols, handlers) => {
  const socket = new WebSocket(url, protocols);
  socket.onopen = () => {
    handlers.open();
  };
  socket.onclose = () => {
    handlers.close();
  };
  socket.onmessage = (event: MessageEvent) => {
    handlers.message(event.data);
  };
  return {
    close: () => {
      socket.close();
    },
  };
};

function parseMessage(data: unknown): LiveMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = LiveMessageSchema.safeParse(JSON.parse(data));
    if (parsed.success) return parsed.data;
    console.warn("live: a message does not match the live contract");
    return null;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    console.warn(`live: a message is not JSON (${name})`);
    return null;
  }
}

export function liveUrl(org: string): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/api/v1/o/${encodeURIComponent(org)}/ws`;
}

class LiveLink implements LiveConnection {
  private failures = 0;
  private opens = 0;
  private stopped = false;
  private current: object | null = null;
  private socket: { close: () => void } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private since: number | null = null;
  private readonly options: LiveOptions;

  constructor(options: LiveOptions) {
    this.options = options;
    this.report("connecting");
    this.attempt();
  }

  retry(): void {
    if (this.stopped || this.timer === undefined) return;
    clearTimeout(this.timer);
    this.report("connecting");
    this.attempt();
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
  }

  private report(status: LiveStatus): void {
    if (status === "live") this.since = null;
    if (status === "offline") this.since ??= (this.options.now ?? Date.now)();
    this.options.onState({ status, since: status === "offline" ? this.since : null });
  }

  private schedule(): void {
    const index = Math.min(Math.max(this.failures - 1, 0), RECONNECT_WAITS.length - 1);
    const base = RECONNECT_WAITS[index] ?? LAST_WAIT;
    const jitter = Math.floor(base * JITTER * (this.options.random ?? Math.random)());
    this.timer = setTimeout(() => {
      this.attempt();
    }, base + jitter);
  }

  private opened(): void {
    const recovered = this.opens > 0 || this.failures > 0;
    this.failures = 0;
    this.opens += 1;
    this.report("live");
    if (recovered) this.options.onReopen?.();
  }

  private closed(opened: boolean): void {
    this.current = null;
    this.socket = null;
    this.failures = opened ? 0 : this.failures + 1;
    this.report(this.failures >= OFFLINE_AFTER ? "offline" : "connecting");
    this.schedule();
  }

  private attempt(): void {
    this.timer = undefined;
    const token = {};
    const mine = () => this.current === token && !this.stopped;
    let opened = false;
    this.current = token;
    const open = this.options.openSocket ?? browserSocket;
    this.socket = open(this.options.url, this.options.protocols, {
      open: () => {
        if (!mine()) return;
        opened = true;
        this.opened();
      },
      close: () => {
        if (mine()) this.closed(opened);
      },
      message: (data) => {
        const message = mine() ? parseMessage(data) : null;
        if (message !== null) this.options.onMessage(message);
      },
    });
  }
}

export function connectLive(options: LiveOptions): LiveConnection {
  return new LiveLink(options);
}

export type LiveExtras = { onReopen?: () => void; openSocket?: OpenSocket | undefined };

export function useLive(
  org: string,
  auth: Auth,
  onMessage: (message: LiveMessage) => void,
  extras: LiveExtras = {},
): LiveHandle {
  const [state, setState] = useState<LiveState>({ status: "connecting", since: null });
  const handler = useRef(onMessage);
  const reopen = useRef(extras.onReopen);
  const connection = useRef<LiveConnection | null>(null);
  const { openSocket } = extras;
  useEffect(() => {
    handler.current = onMessage;
    reopen.current = extras.onReopen;
  });
  useEffect(() => {
    const live = connectLive({
      url: liveUrl(org),
      protocols: ["vision", auth.token],
      onMessage: (message) => {
        handler.current(message);
      },
      onState: setState,
      onReopen: () => reopen.current?.(),
      openSocket,
    });
    connection.current = live;
    return () => {
      live.close();
      connection.current = null;
    };
  }, [org, auth.token, openSocket]);
  const retry = useCallback(() => {
    connection.current?.retry();
  }, []);
  return { ...state, retry };
}

export type ViewState<T> =
  { state: "loading" } | { state: "ready"; view: T } | { state: "failed"; code: FailureCode };

export type ViewOptions = {
  query?: ViewQuery;
  onMessage?: (message: LiveMessage) => void;
  openSocket?: OpenSocket;
};

export type ViewHandle<T> = { view: ViewState<T>; live: LiveHandle; refresh: () => void };

function nextState<T>(previous: ViewState<T>, code: FailureCode): ViewState<T> {
  return code === "network" && previous.state === "ready" ? previous : { state: "failed", code };
}

function useFetchedView<T>(
  org: string,
  auth: Auth,
  name: ViewName,
  schema: z.ZodType<T>,
  query: ViewQuery | undefined,
): [ViewState<T>, () => void] {
  const [view, setView] = useState<ViewState<T>>({ state: "loading" });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);
  const queryKey = new URLSearchParams(query).toString();
  useEffect(() => {
    let active = true;
    getView(org, auth, name, schema, Object.fromEntries(new URLSearchParams(queryKey))).then(
      (value) => {
        if (active) setView({ state: "ready", view: value });
      },
      (error: unknown) => {
        const code = error instanceof ApiError ? error.code : "network";
        if (active) setView((previous) => nextState(previous, code));
      },
    );
    return () => {
      active = false;
    };
  }, [org, auth.kind, auth.token, name, schema, queryKey, version]);
  return [view, refresh];
}

export function useView<T>(
  org: string,
  auth: Auth,
  name: ViewName,
  schema: z.ZodType<T>,
  options: ViewOptions = {},
): ViewHandle<T> {
  const [view, refresh] = useFetchedView(org, auth, name, schema, options.query);
  const { onMessage } = options;
  const live = useLive(
    org,
    auth,
    (message) => {
      if (message.t === "changed") refresh();
      onMessage?.(message);
    },
    { onReopen: refresh, openSocket: options.openSocket },
  );
  return { view, live, refresh };
}
