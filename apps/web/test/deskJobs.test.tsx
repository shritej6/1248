import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeskBoardSchema, type DeskBoard, type PageView } from "@vision/contracts";
import { DeskPage, DeskView, sortCards, withLivePages, type DeskSend } from "../src/pages/DeskPage.js";
import { saveSession } from "../src/session.js";
import { bodyOf, fakeSockets, fixture, mockFetch } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const board = (): DeskBoard => ({ ...DeskBoardSchema.parse(fixture("views/desk-board.json")), pages: [] });
const sendOk = () => vi.fn<DeskSend>(() => Promise.resolve({ ok: true }));
const withStatus = (status: DeskBoard["jobs"][number]["status"]): DeskBoard => {
  const base = board();
  return { ...base, jobs: base.jobs.map((job) => ({ ...job, status })) };
};
const avery = board().volunteers.find((volunteer) => volunteer.name === "Avery Snow (test)");

describe("job actions", () => {
  it("tap for preselects the holder and sends job.tap_for", async () => {
    const send = sendOk();
    render(<DeskView board={board()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Tap on my way for" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Tap on my way for SNOW-4821/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "job.tap_for", action: "on_my_way", member: avery?.member }),
      );
    });
  });

  it("tap there for walks a volunteer without a smartphone to there", async () => {
    const send = sendOk();
    render(<DeskView board={withStatus("on_my_way")} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Tap there for" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Tap there for/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "job.tap_for", action: "there", member: avery?.member }),
      );
    });
  });
});

const openOutcomes = async (send: DeskSend) => {
  render(<DeskView board={withStatus("there")} send={send} />);
  fireEvent.click(screen.getByRole("button", { name: "Tap done for" }));
  const picker = within(await screen.findByRole("dialog", { name: /Tap done for/ }));
  fireEvent.click(picker.getByRole("button", { name: "Confirm" }));
  return within(await screen.findByRole("dialog", { name: "What happened?" }));
};

describe("tap done for", () => {
  it("asks what happened with the three outcomes in order and none picked", async () => {
    const send = sendOk();
    const dialog = await openOutcomes(send);
    const choices = within(dialog.getByRole("group", { name: "What happened?" })).getAllByRole("button");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "Done as asked",
      "Part done",
      "Could not do it",
    ]);
    for (const choice of choices) expect(choice.getAttribute("aria-pressed")).toBe("false");
    expect(dialog.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
    expect(dialog.getByText("Pick what happened first")).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["Done as asked", "done"],
    ["Part done", "partly"],
    ["Could not do it", "not_done"],
  ] as const)("%s sends the outcome %s to the hub", async (label, outcome) => {
    const send = sendOk();
    const dialog = await openOutcomes(send);
    fireEvent.click(dialog.getByRole("button", { name: label }));
    expect(dialog.getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(dialog.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "job.tap_for", action: "done", member: avery?.member, outcome }),
      );
    });
  });
});

describe("tap done for picked outcome", () => {
  it("only the picked outcome shows the picked state with a check mark", async () => {
    const dialog = await openOutcomes(sendOk());
    fireEvent.click(dialog.getByRole("button", { name: "Part done" }));
    const choices = within(dialog.getByRole("group", { name: "What happened?" })).getAllByRole("button");
    const picked = choices.filter((choice) => choice.getAttribute("aria-pressed") === "true");
    expect(picked.map((choice) => choice.textContent)).toEqual(["Part done"]);
    for (const choice of choices) {
      const isPicked = choice.textContent === "Part done";
      expect(choice.getAttribute("aria-pressed")).toBe(String(isPicked));
      expect(choice.querySelector("svg") !== null).toBe(isPicked);
    }
  });

  it("picking another outcome moves the picked state to it", async () => {
    const dialog = await openOutcomes(sendOk());
    fireEvent.click(dialog.getByRole("button", { name: "Part done" }));
    fireEvent.click(dialog.getByRole("button", { name: "Could not do it" }));
    expect(dialog.getByRole("button", { name: "Part done" }).getAttribute("aria-pressed")).toBe("false");
    expect(dialog.getByRole("button", { name: "Part done" }).querySelector("svg")).toBeNull();
    const now = dialog.getByRole("button", { name: "Could not do it" });
    expect(now.getAttribute("aria-pressed")).toBe("true");
    expect(now.querySelector("svg")).not.toBeNull();
  });
});

describe("tap done for cancel", () => {
  it("cancel at the outcome step sends nothing", async () => {
    const send = sendOk();
    const dialog = await openOutcomes(send);
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "What happened?" })).toBeNull();
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("offer actions", () => {
  it("offer to one asks for a volunteer before it sends", async () => {
    const send = sendOk();
    render(<DeskView board={withStatus("offered")} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Offer to one" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Offer SNOW-4821/ }));
    expect(dialog.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(dialog.getByRole("radio", { name: /Avery Snow/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "job.offer_to", member: avery?.member }),
      );
    });
  });

  it("an offered job can send the offer again", async () => {
    const send = sendOk();
    render(<DeskView board={withStatus("offered")} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Send offer" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "job.offer_again" }));
    });
  });
});

describe("job rows", () => {
  it("a refused command says why in the row", async () => {
    const send = vi.fn<DeskSend>(() => Promise.resolve({ ok: false, code: "wrong_state" }));
    render(<DeskView board={withStatus("planned")} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    expect(await screen.findByText(/This changed on the hub/)).toBeTruthy();
  });

  it("the waiting filter hides a job that waits for nobody", () => {
    render(<DeskView board={board()} send={sendOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Waiting" }));
    expect(screen.queryByRole("row", { name: /SNOW-4821/ })).toBeNull();
    expect(screen.getByText("No jobs in this list")).toBeTruthy();
  });

  it("with no volunteers on the board the picker says so", async () => {
    render(<DeskView board={{ ...board(), volunteers: [] }} send={sendOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Tap on my way for" }));
    expect(await screen.findByText("No volunteers on the desk board.")).toBeTruthy();
  });

  it("the picker shows each volunteer with skills, zone, switch and open jobs, on first", async () => {
    render(<DeskView board={withStatus("offered")} send={sendOk()} />);
    fireEvent.click(screen.getByRole("button", { name: "Offer to one" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Offer SNOW-4821/ }));
    const radios = dialog.getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual(
      board().volunteers.map((volunteer) => volunteer.member),
    );
    const casey = dialog.getByRole("radio", { name: /Casey Lane/ });
    expect(casey.closest("label")?.textContent).toMatch(/OFF.*53210.*snow, rides.*0 open/);
    expect(dialog.getByRole("radio", { name: /Avery Snow/ }).closest("label")?.textContent).toContain(
      "1 open",
    );
  });
});

describe("desk lanes and pages", () => {
  it("J and K move the open card through the lanes", () => {
    render(<DeskView board={board()} send={sendOk()} />);
    fireEvent.keyDown(document, { key: "j" });
    expect(screen.getByRole("region", { name: /Request/ }).textContent).toContain("gas smell");
    fireEvent.keyDown(document, { key: "j" });
    expect(screen.getByRole("region", { name: /Request/ }).textContent).toContain("Snow on my walk");
  });

  it("a high card sorts before an older low card", () => {
    const [low] = board().triage;
    if (low === undefined) throw new Error("the fixture has no triage card");
    const high = {
      ...low,
      card: "c_high",
      receivedAt: low.receivedAt + 1,
      sorted: {
        ...low.sorted,
        urgency: "high" as const,
        service: null,
        division: null,
        source: "ai" as const,
      },
    };
    expect(sortCards([low, high]).map((card) => card.card)).toEqual(["c_high", low.card]);
  });
});

describe("desk pages", () => {
  it("card keys do nothing while a page covers the desk", () => {
    const send = sendOk();
    const base = DeskBoardSchema.parse(fixture("views/desk-board.json"));
    render(<DeskView board={base} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: /Snow on my walk/, hidden: true }));
    fireEvent.keyDown(document, { key: "l" });
    fireEvent.keyDown(document, { key: "c" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a live page joins the board it came with and goes when the board changes", () => {
    const shown = board();
    const page = DeskBoardSchema.parse(fixture("views/desk-board.json")).pages[0] as PageView;
    expect(withLivePages(shown, { board: shown, pages: [page] }).pages).toEqual([page]);
    expect(withLivePages(shown, { board: board(), pages: [page] }).pages).toEqual([]);
  });

  it("two pages show one and say one more waits", () => {
    const base = DeskBoardSchema.parse(fixture("views/desk-board.json"));
    const first = base.pages[0] as PageView;
    render(<DeskView board={{ ...base, pages: [first, { ...first, page: "pg_second" }] }} send={sendOk()} />);
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByText("1 more waiting")).toBeTruthy();
  });

  it("the desk page without a session asks for a join code", () => {
    render(<DeskPage org="comforce-demo" />);
    expect(screen.getByText("Join the desk first")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Type a join code" }).getAttribute("href")).toBe(
      "/comforce-demo/join",
    );
  });
});

describe("live desk page", () => {
  it("the live desk taps on my way for a volunteer from the hub volunteer list", async () => {
    saveSession("comforce-demo", "desk-token");
    const calls = mockFetch([{ status: 200, body: board() }]);
    render(<DeskPage org="comforce-demo" openSocket={fakeSockets().openSocket} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tap on my way for" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Tap on my way for SNOW-4821/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(calls.map((call) => call.url)).toContain("/api/v1/o/comforce-demo/commands");
    });
    const command = calls.find((call) => call.url.endsWith("/commands"));
    expect(command === undefined ? null : bodyOf(command)).toMatchObject({
      type: "job.tap_for",
      action: "on_my_way",
      member: avery?.member,
    });
  });

  it("the live desk says why the hub refused a tap for on a lead only job", async () => {
    saveSession("comforce-demo", "desk-token");
    const error = { code: "forbidden", message: "Only the lead may handle this job." };
    const forbidden = { status: 403, body: { ok: false, error } };
    mockFetch([{ status: 200, body: board() }, forbidden]);
    render(<DeskPage org="comforce-demo" openSocket={fakeSockets().openSocket} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tap on my way for" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Tap on my way for SNOW-4821/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Your account cannot do this/)).toBeTruthy();
  });
});
