import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JoinPage } from "../src/pages/JoinPage.js";
import { readSession } from "../src/session.js";
import { bodyOf, mockFetch, networkError } from "./helpers.js";

const memberId = "m_1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const joined = (roles: string[]) => ({
  status: 200,
  body: { session: "s1", member: { id: memberId, roles } },
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function join(code: string) {
  const navigate = vi.fn();
  render(<JoinPage org="comforce-demo" navigate={navigate} />);
  fireEvent.change(screen.getByLabelText("Join code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  return navigate;
}

describe("JoinPage", () => {
  it("a desk code keeps the session and opens the desk", async () => {
    const calls = mockFetch([joined(["desk"])]);
    const navigate = join("k7m2-q9xr");
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/comforce-demo/desk");
    });
    expect(bodyOf(calls[0] ?? { url: "", init: {} })).toEqual({ code: "K7M2Q9XR" });
    expect(readSession("comforce-demo")).toBe("s1");
  });

  it("an organiser code opens the organiser view", async () => {
    mockFetch([joined(["organiser"])]);
    const navigate = join("K7M2Q9XR");
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/comforce-demo/org");
    });
  });

  it("a short code shows a plain error and sends nothing", async () => {
    const calls = mockFetch([]);
    join("K7M2");
    expect(await screen.findByText("Type the 8 characters of the code.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe("JoinPage failures", () => {
  it("a used code says what to do", async () => {
    mockFetch([{ status: 401, body: { ok: false, error: { code: "unauthorized", message: "Used" } } }]);
    join("K7M2Q9XR");
    expect((await screen.findByRole("alert")).textContent).toContain("Ask the organiser for a new code.");
  });

  it("no connection says it was not sent", async () => {
    mockFetch([networkError]);
    join("K7M2Q9XR");
    expect((await screen.findByRole("alert")).textContent).toBe("Not sent. No connection. Try again.");
  });

  it("a volunteer code keeps no session on the website", async () => {
    mockFetch([joined(["volunteer"])]);
    const navigate = join("K7M2Q9XR");
    expect((await screen.findByRole("alert")).textContent).toContain("volunteer app");
    expect(navigate).not.toHaveBeenCalled();
    expect(readSession("comforce-demo")).toBeNull();
  });
});
