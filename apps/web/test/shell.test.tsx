import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { Shell } from "../src/components/Shell/Shell.js";
import type { LiveHandle } from "../src/live.js";
import { matchRoute } from "../src/router.js";

afterEach(cleanup);

const live = (status: LiveHandle["status"], since: number | null = null): LiveHandle => ({
  status,
  since,
  retry: vi.fn(),
});
const at942 = Date.UTC(2026, 10, 22, 3, 42);

describe("Shell", () => {
  it("shows the demo clock mark only while the clock is moved", () => {
    const { rerender } = render(
      <Shell theme="graphite" section="Desk" live={null} clock={{ now: at942, offsetMs: 0 }} orgName={null}>
        board
      </Shell>,
    );
    expect(screen.queryByText("Demo clock")).toBeNull();
    rerender(
      <Shell
        theme="graphite"
        section="Desk"
        live={null}
        clock={{ now: at942 + 3_600_000, offsetMs: 3_600_000 }}
        orgName={null}
      >
        board
      </Shell>,
    );
    expect(screen.getByText("Demo clock")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("sim 10:42 PM");
    expect(screen.getByRole("note").textContent).toContain("real 9:42 PM");
  });
});

describe("Shell connection", () => {
  it("names the connection state in words", () => {
    const { rerender } = render(
      <Shell theme="graphite" section="Desk" live={live("live")} clock={null} orgName={null}>
        board
      </Shell>,
    );
    expect(screen.getByRole("status").textContent).toBe("Live");
    rerender(
      <Shell theme="graphite" section="Desk" live={live("offline", at942)} clock={null} orgName={null}>
        board
      </Shell>,
    );
    expect(screen.getByRole("status").textContent).toBe("Offline since 9:42 PM");
  });

  it("shows the offline bar with a retry button", () => {
    const handle = live("offline", at942);
    render(
      <Shell theme="graphite" section="Desk" live={handle} clock={null} orgName={null}>
        board
      </Shell>,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Offline. Actions are paused. Clocks show last sync.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(handle.retry).toHaveBeenCalledTimes(1);
  });

  it("uses calm words on paper pages", () => {
    render(
      <Shell theme="paper" section={null} live={live("offline", at942)} clock={null} orgName={null}>
        page
      </Shell>,
    );
    expect(screen.getByRole("alert").textContent).toContain("No connection. We keep trying.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("App", () => {
  it("shows a plain message for an unknown path", () => {
    render(<App route={matchRoute("/nowhere")} />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});
