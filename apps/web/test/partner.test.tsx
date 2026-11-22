import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerCardSchema, type PartnerCard } from "@vision/contracts";
import { App } from "../src/App.js";
import { PartnerPage, PartnerView } from "../src/pages/PartnerPage.js";
import { matchRoute } from "../src/router.js";
import { fixture, mockFetch } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ask = (): PartnerCard => PartnerCardSchema.parse(fixture("views/partner-ask.json"));
const note = (): PartnerCard => PartnerCardSchema.parse(fixture("views/partner-note.json"));
const sent = () => vi.fn(() => Promise.resolve({ ok: true } as const));
const jobId = "j_2b7e9d14-3f6a-4c81-9e25-6a0d8c3b7f49";

describe("PartnerView ask", () => {
  it("the ask shows YES, NO and WAIT", () => {
    render(<PartnerView view={ask()} send={sent()} />);
    for (const name of ["Yes, we can take it", "Wait, ask again later", "No, we cannot"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByText("Food from a pantry")).toBeTruthy();
    expect(screen.getByText("53216")).toBeTruthy();
  });

  it("a tap of Wait sends the answer for that job", async () => {
    const send = sent();
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Wait, ask again later" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "ask.answer", job: jobId, answer: "wait" }),
      );
    });
    expect(await screen.findByText("Sent. Thank you.")).toBeTruthy();
  });

  it("a failed answer says what to do", async () => {
    const send = vi.fn(() => Promise.resolve({ ok: false, code: "network" } as const));
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "No, we cannot" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(await screen.findByText("Not sent. No connection. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send answer" })).toBeTruthy();
  });
});

describe("PartnerView ask confirm and footer", () => {
  it("a tap of No or Wait asks to confirm and can be changed before anything is sent", () => {
    const send = sent();
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "No, we cannot" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText("Your answer: No, we cannot.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change answer" }));
    expect(screen.getByRole("button", { name: "Wait, ask again later" })).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("the ask has the promise link and the close date in the footer", () => {
    render(<PartnerView view={ask()} send={sent()} />);
    expect(screen.getByText("Read the promise")).toBeTruthy();
    expect(screen.getByText("This card closes on Nov 22, 2026.")).toBeTruthy();
  });

  it("the header shows the route code on every step", () => {
    render(<PartnerView view={ask()} send={sent()} />);
    expect(screen.getByText("FOOD-16-001")).toBeTruthy();
    cleanup();
    render(<PartnerView view={note()} send={sent()} />);
    expect(screen.getByText("FOOD-16-001")).toBeTruthy();
    expect(screen.getByText("This card closes on Nov 23, 2026.")).toBeTruthy();
  });

  it("a card with no close date shows only the promise link", () => {
    render(<PartnerView view={{ ...note(), closesAt: null }} send={sent()} />);
    expect(screen.getByText("Read the promise")).toBeTruthy();
    expect(screen.queryByText(/This card closes on/)).toBeNull();
  });
});

describe("PartnerView answer line", () => {
  it("each answer opens a one-line field, and yes sends its reason after the confirm", async () => {
    const send = sent();
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, we can take it" }));
    expect(send).not.toHaveBeenCalled();
    const field = screen.getByLabelText("Reason, one line (optional)");
    expect(field.getAttribute("maxLength")).toBe("140");
    fireEvent.change(field, { target: { value: "  We can deliver on Tuesday  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ answer: "yes", reason: "We can deliver on Tuesday" }),
      );
    });
  });

  it("no with an empty line sends no reason", async () => {
    const send = sent();
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "No, we cannot" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ answer: "no" }));
    });
    expect(JSON.stringify(send.mock.calls)).not.toContain("reason");
  });
});

describe("PartnerView wait time", () => {
  it("wait opens a time field and sends the time to ask again", async () => {
    const send = sent();
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Wait, ask again later" }));
    fireEvent.change(screen.getByLabelText("Ask again after (optional)"), {
      target: { value: "2026-11-24T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ answer: "wait", waitUntil: new Date("2026-11-24T10:00").getTime() }),
      );
    });
  });

  it("a wait time that is not after now is not sent", () => {
    const send = sent();
    render(<PartnerView view={ask()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Wait, ask again later" }));
    fireEvent.change(screen.getByLabelText("Ask again after (optional)"), {
      target: { value: "2026-11-01T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    expect(screen.getByText("Pick a time after now.")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
});

describe("PartnerView promise", () => {
  it("the promise must be accepted before the note shows", async () => {
    const send = sent();
    render(<PartnerView view={{ ...note(), state: "promise" }} send={send} />);
    expect(screen.getByRole("button", { name: "I accept this promise" })).toBeTruthy();
    expect(screen.queryByText("Avery")).toBeNull();
    expect(screen.queryByText("avery@example.test")).toBeNull();
    expect(screen.getByText(/until the request closes, plus 90 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I accept this promise" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "promise.accept" }));
    });
  });
});

describe("PartnerView note", () => {
  it("the note shows the details and what was tried", () => {
    render(<PartnerView view={note()} send={sent()} />);
    expect(screen.getByText("Avery")).toBeTruthy();
    expect(screen.getByText("avery@example.test")).toBeTruthy();
    expect(screen.getByText("Volunteers were asked first")).toBeTruthy();
  });
});

describe("PartnerView GOT IT", () => {
  it("GOT IT needs a date and a contact name", async () => {
    const send = sent();
    render(<PartnerView view={note()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirm got it" }));
    expect(await screen.findByText("Type the name of the person who will contact them.")).toBeTruthy();
    expect(screen.getByText("Pick the date you will contact them.")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it("GOT IT sends the job, the date and the contact name", async () => {
    const send = sent();
    render(<PartnerView view={note()} send={send} />);
    fireEvent.change(screen.getByLabelText("Who will contact them?"), { target: { value: "Jordan (test)" } });
    fireEvent.change(screen.getByLabelText("When will you contact them?"), {
      target: { value: "2026-11-22" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm got it" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "handover.got_it",
          job: jobId,
          date: "2026-11-22",
          contactName: "Jordan (test)",
        }),
      );
    });
  });

  it("after GOT IT the card shows that it is recorded and no form", () => {
    const view = note();
    const recorded = { ...view, note: view.note === null ? null : { ...view.note, gotIt: true } };
    render(<PartnerView view={recorded} send={sent()} />);
    expect(screen.getByText("GOT IT is recorded. You hold this request now.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm got it" })).toBeNull();
    expect(screen.getByText("Avery")).toBeTruthy();
  });
});

describe("PartnerView result and closed", () => {
  it("the result shows the status and the counts for this partner", () => {
    const result = { status: "helped" as const, counts: { asked: 4, yes: 3, gotIt: 2, helped: 1 } };
    render(<PartnerView view={{ ...note(), state: "result", note: null, result }} send={sent()} />);
    expect(screen.getByText("The person said you helped.")).toBeTruthy();
    expect(screen.getByText("4 asked, 3 yes, 2 GOT IT, 1 helped")).toBeTruthy();
    expect(screen.queryByText("Avery")).toBeNull();
    expect(screen.getByText("Read the promise")).toBeTruthy();
  });

  it("a closed card shows only the closed message", () => {
    render(<PartnerView view={{ ...note(), state: "closed" }} send={sent()} />);
    expect(screen.getByText("This request is closed.")).toBeTruthy();
    expect(screen.queryByText("Avery")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("PartnerPage", () => {
  it("loads the partner card by its link token", async () => {
    const calls = mockFetch([{ status: 200, body: ask() }]);
    render(<App route={matchRoute("/comforce-demo/p/tok")} />);
    expect(await screen.findByRole("button", { name: "Yes, we can take it" })).toBeTruthy();
    expect(calls[0]?.url).toBe("/api/v1/o/comforce-demo/p/tok");
  });

  it("an old link shows the closed message, not an error", async () => {
    mockFetch([{ status: 404, body: { ok: false, error: { code: "not_found", message: "No card" } } }]);
    render(<PartnerPage org="comforce-demo" token="old" />);
    expect(await screen.findByText("This request is closed.")).toBeTruthy();
  });

  it("an answer posts to the partner link and refetches the card", async () => {
    const calls = mockFetch(
      [
        { status: 200, body: ask() },
        { status: 200, body: { ok: true, events: 1 } },
      ],
      {
        status: 200,
        body: ask(),
      },
    );
    render(<PartnerPage org="comforce-demo" token="tok" />);
    fireEvent.click(await screen.findByRole("button", { name: "Yes, we can take it" }));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => {
      expect(calls.length).toBeGreaterThanOrEqual(3);
    });
    expect(calls[1]?.url).toBe("/api/v1/o/comforce-demo/p/tok/commands");
    expect(calls[2]?.url).toBe("/api/v1/o/comforce-demo/p/tok");
  });
});
