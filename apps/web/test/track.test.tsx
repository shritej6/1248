import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackingSchema, type Tracking } from "@vision/contracts";
import { App } from "../src/App.js";
import { TrackPage, TrackView } from "../src/pages/TrackPage.js";
import { matchRoute } from "../src/router.js";
import { fakeSockets, fixture, mockFetch } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const open = (): Tracking => TrackingSchema.parse(fixture("views/tracking-open.json"));
const closed = (): Tracking => TrackingSchema.parse(fixture("views/tracking-closed.json"));
const sent = () => vi.fn(() => Promise.resolve({ ok: true } as const));
const jobId = "j_2b7e9d14-3f6a-4c81-9e25-6a0d8c3b7f49";

describe("TrackView", () => {
  it("the tracking page shows consent buttons only when asked", () => {
    const { rerender } = render(<TrackView view={{ ...open(), consentAsk: null }} send={sent()} />);
    expect(screen.queryByRole("button", { name: "Yes, share" })).toBeNull();
    rerender(<TrackView view={open()} send={sent()} />);
    expect(screen.getByRole("button", { name: "Yes, share" })).toBeTruthy();
    expect(screen.getByText(/Northside Pantry \(test\)/)).toBeTruthy();
  });

  it("a closed request shows only the closed message", () => {
    render(<TrackView view={closed()} send={sent()} />);
    expect(screen.getByText("This request is closed.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the route code and marks the last step as current", () => {
    render(<TrackView view={{ ...open(), forgetAt: Date.UTC(2026, 11, 21, 18) }} send={sent()} />);
    expect(screen.getByText("This record is deleted on Dec 21, 2026.")).toBeTruthy();
    expect(screen.getByText("SNOW-4821")).toBeTruthy();
    const steps = screen.getAllByRole("listitem").filter((item) => item.closest("ol") !== null);
    expect(steps.map((item) => item.getAttribute("aria-current"))).toEqual([null, null, "step"]);
    expect(steps[0]?.textContent).toContain("Received");
  });
});

describe("TrackView answers", () => {
  it("a consent tap sends the answer for that job", async () => {
    const send = sent();
    render(<TrackView view={open()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, share" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "consent.answer", job: jobId, answer: "yes" }),
      );
    });
    expect(await screen.findByText("Sent. Thank you.")).toBeTruthy();
  });

  it("a check-back tap of Partly sends answer 2", async () => {
    const send = sent();
    const view = { ...open(), consentAsk: null, checkbackAsk: { job: jobId, needLabel: "Snow shovelling" } };
    render(<TrackView view={view} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Partly" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "checkback.answer", answer: 2 }));
    });
  });
});

describe("TrackView next ask", () => {
  it("a check-back for a second job shows its own answer buttons", async () => {
    const send = sent();
    const ask = (job: string, needLabel: string) => ({
      ...open(),
      consentAsk: null,
      checkbackAsk: { job, needLabel },
    });
    const { rerender } = render(<TrackView view={ask(jobId, "Snow shovelling")} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(await screen.findByText("Sent. Thank you.")).toBeTruthy();
    rerender(
      <TrackView view={ask("j_5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", "Food from a pantry")} send={send} />,
    );
    expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
    expect(screen.queryByText("Sent. Thank you.")).toBeNull();
  });
});

describe("TrackPage", () => {
  it("loads the tracking view by its link token", async () => {
    const calls = mockFetch([{ status: 200, body: open() }]);
    render(<App route={matchRoute("/comforce-demo/t/tok")} />);
    expect(await screen.findByText("SNOW-4821")).toBeTruthy();
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/t/tok");
  });

  it("an unknown or forgotten link shows the closed message, not an error", async () => {
    mockFetch([{ status: 404, body: { ok: false, error: { code: "not_found", message: "No card" } } }]);
    render(<TrackPage org="comforce-demo" token="old" />);
    expect(await screen.findByText("This request is closed.")).toBeTruthy();
  });

  it("a changed message refetches the tracking view and the chip says Live", async () => {
    const calls = mockFetch([], { status: 200, body: open() });
    const sockets = fakeSockets();
    render(<TrackPage org="comforce-demo" token="tok" openSocket={sockets.openSocket} />);
    expect(await screen.findByText("SNOW-4821")).toBeTruthy();
    expect(sockets.last().protocols).toEqual(["vision", "tok"]);
    act(() => {
      sockets.last().open();
    });
    expect(screen.getByText("Live")).toBeTruthy();
    act(() => {
      sockets.last().push({ t: "changed" });
    });
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]?.url).toBe("/api/v1/o/comforce-demo/t/tok");
  });
});

const spanish = (): Tracking => ({ ...open(), lang: "es" });

describe("TrackView in Spanish", () => {
  it("a Spanish card shows the tracking page in human-written Spanish", () => {
    render(<TrackView view={{ ...spanish(), forgetAt: Date.UTC(2026, 11, 21, 18) }} send={sent()} />);
    expect(screen.getByRole("heading", { name: "Su solicitud" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Pasos de su solicitud" })).toBeTruthy();
    expect(screen.getByText("Recibida")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sí, compartir" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No, no compartir" })).toBeTruthy();
    expect(screen.getByText("Llame al 911.")).toBeTruthy();
    expect(screen.getByText("Este registro se borra el 21 de diciembre de 2026.")).toBeTruthy();
    expect(document.querySelector('section[lang="es"]')).not.toBeNull();
  });
});

describe("TrackView answers in Spanish", () => {
  it("the Spanish check-back sends the same answers", async () => {
    const send = sent();
    const view = {
      ...spanish(),
      consentAsk: null,
      checkbackAsk: { job: jobId, needLabel: "Snow shovelling" },
    };
    render(<TrackView view={view} send={send} />);
    expect(screen.getByRole("heading", { name: "¿Le ayudaron?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sí" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "No" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "En parte" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "checkback.answer", answer: 2 }));
    });
    expect(await screen.findByText("Enviado. Gracias.")).toBeTruthy();
  });

  it("an English or unknown language keeps the English page", () => {
    render(<TrackView view={{ ...open(), lang: "en" }} send={sent()} />);
    expect(screen.getByRole("heading", { name: "Your request" })).toBeTruthy();
    cleanup();
    render(<TrackView view={open()} send={sent()} />);
    expect(screen.getByRole("heading", { name: "Your request" })).toBeTruthy();
    expect(document.querySelector('[lang="es"]')).toBeNull();
  });
});
