import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourcesViewSchema, type DraftView, type Resource, type ResourcesView } from "@vision/contracts";
import { ResourcesSection } from "../src/components/Resources/ResourcesSection.js";
import type { ResourcesClient, ResourcesOutcome } from "../src/resourcesApi.js";
import { fixture } from "./helpers.js";

const VIEW = ResourcesViewSchema.parse(fixture("views/resources-demo.json"));
const DEMO_NOTICE =
  "Demo mode. The forecast uses 24 months of synthetic history. Funder facts are real and were checked on 22 November 2026.";
const CAP = "Vision writes at most 20 drafts a day. Try again tomorrow.";
const DOWN = "Vision could not reach the hub. Check the connection and try again.";
const POST_CARD = "Impact post, November 2026";

const ok = (view: ResourcesView): ResourcesOutcome => ({ ok: true, view });

function fakeClient(loads: ResourcesOutcome[] = [], reply: ResourcesOutcome = ok(VIEW)) {
  const queue = [...loads];
  const load = vi.fn<ResourcesClient["load"]>(() => Promise.resolve(queue.shift() ?? ok(VIEW)));
  const post = vi.fn<ResourcesClient["post"]>(() => Promise.resolve(reply));
  return { load, post };
}

const draftAt = (view: ResourcesView, index: number): DraftView => {
  const draft = view.drafts[index];
  if (draft === undefined) throw new Error(`the fixture has no draft ${String(index)}`);
  return draft;
};

const withDrafts = (drafts: DraftView[]): ResourcesView => ({ ...VIEW, drafts });
const settle = (d: DraftView): DraftView =>
  d.status === "writing"
    ? { ...d, status: "ready", source: "template", flag: "ai_off", text: "Done text." }
    : d;
const settled = (view: ResourcesView): ResourcesView => withDrafts(view.drafts.map(settle));

const showSection = async (client: ReturnType<typeof fakeClient>) => {
  render(<ResourcesSection client={client} />);
  return screen.findByText(DEMO_NOTICE);
};

const draftCard = (name: string) => {
  const heading = screen.getByRole("heading", { name });
  const card = heading.closest("article");
  if (card === null) throw new Error(`no card for ${name}`);
  return within(card);
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Resources forecast", () => {
  it("shows the demo notice and the no AI notice", async () => {
    await showSection(fakeClient());
    expect(screen.getByText("Code makes the forecast and the match. It uses no AI.")).toBeTruthy();
  });

  it("the chart has its accessible name and the table has 12 body rows", async () => {
    await showSection(fakeClient());
    const name =
      "Likely jobs for each month, December 2026 to November 2027, all needs. Highest: January 2027, 53.";
    expect(screen.getByRole("img", { name })).toBeTruthy();
    const table = screen.getByRole("table", { name: "Forecast by month" });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(12);
    expect(within(table).getByRole("cell", { name: "44" })).toBeTruthy();
  });

  it("choosing one need changes the chart and the numbers", async () => {
    await showSection(fakeClient());
    fireEvent.change(screen.getByLabelText("Need"), { target: { value: "snow" } });
    const name =
      "Likely jobs for each month, December 2026 to November 2027, Snow shovelling. Highest: January 2027, 30.";
    expect(screen.getByRole("img", { name })).toBeTruthy();
    const first = screen.getByRole("table", { name: "Forecast by month" }).querySelector("tbody tr");
    expect(first?.textContent).toContain("December 2026");
    expect(within(first as HTMLElement).getByRole("cell", { name: "21" })).toBeTruthy();
    expect(within(first as HTMLElement).getByRole("cell", { name: "$525" })).toBeTruthy();
  });

  it("a forecast without enough history says how many months the record has", async () => {
    const view: ResourcesView = {
      ...VIEW,
      forecast: { status: "not_enough_history", recordMonths: 10, needed: 12 },
    };
    render(<ResourcesSection client={fakeClient([ok(view)])} />);
    const words = "Vision needs 12 full months of the record for a forecast. The record has 10.";
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("Resources unit costs", () => {
  it("saving 25.00 for snow posts the cents and the basis", async () => {
    const client = fakeClient();
    await showSection(client);
    const input = screen.getByRole("textbox", { name: "Dollars for each job, Snow shovelling" });
    fireEvent.change(input, { target: { value: "25.00" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Save the unit cost for Snow shovelling" }));
    expect(client.post).toHaveBeenCalledWith("costs", { need: "snow", centsPerJob: 2500, basis: "estimate" });
  });

  it("a cost from receipts posts the receipts basis", async () => {
    const client = fakeClient();
    await showSection(client);
    const input = screen.getByRole("textbox", { name: "Dollars for each job, Food from a pantry" });
    fireEvent.change(input, { target: { value: "12.5" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "From receipts for Food from a pantry" }));
    fireEvent.click(screen.getByRole("button", { name: "Save the unit cost for Food from a pantry" }));
    expect(client.post).toHaveBeenCalledWith("costs", { need: "food", centsPerJob: 1250, basis: "receipts" });
  });

  it("clear posts a null cost for the need", async () => {
    const client = fakeClient();
    await showSection(client);
    fireEvent.click(screen.getByRole("button", { name: "Clear the unit cost for Snow shovelling" }));
    expect(client.post).toHaveBeenCalledWith("costs", { need: "snow", centsPerJob: null, basis: "estimate" });
  });

  it("a need with no entry says the unit cost is not yet measured", async () => {
    await showSection(fakeClient());
    expect(screen.getByText("Unit cost not yet measured")).toBeTruthy();
    const snow = screen.getByRole("rowheader", { name: "Snow shovelling" }).closest("tr") as HTMLElement;
    expect(within(snow).getByText("$25.00 a job").parentElement?.querySelector("svg")).toBeTruthy();
  });
});

const MATCH_NAMES = [
  "Safe & Sound Good Neighbor Grant Fund",
  "Bader Philanthropies, preliminary application",
  "United Way Urgent Need Fund, flood recovery",
];

const matchItem = (name: string) => {
  const item = screen.getByRole("heading", { name }).closest("li");
  if (item === null) throw new Error(`no match item for ${name}`);
  return within(item);
};

describe("Resources matches", () => {
  it("keeps the order of the view and shows the score and the path in words", async () => {
    await showSection(fakeClient());
    const list = within(screen.getByRole("list", { name: "Ranked matches" }));
    expect(list.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(MATCH_NAMES);
    const score = matchItem(MATCH_NAMES[0] ?? "").getByText("100").parentElement;
    expect(score?.textContent).toBe("Score 100 of 100");
    expect(matchItem(MATCH_NAMES[0] ?? "").getByText("Apply directly")).toBeTruthy();
    expect(matchItem(MATCH_NAMES[1] ?? "").getByText("Ask first")).toBeTruthy();
  });

  it("Bader shows its deadline and eligibility cautions, each chip with text and a shape", async () => {
    await showSection(fakeClient());
    const bader = matchItem("Bader Philanthropies, preliminary application");
    for (const words of [
      "Deadline in 8 days",
      "Eligibility not stated. Ask first.",
      "Next deadline 30 November 2026",
    ]) {
      expect(bader.getByText(words).parentElement?.querySelector("svg")).toBeTruthy();
    }
    expect(bader.getByText("Opened page, checked 22 November 2026")).toBeTruthy();
    const good = matchItem("Safe & Sound Good Neighbor Grant Fund");
    expect(good.getByText("Fits Snow shovelling, Food from a pantry")).toBeTruthy();
    expect(good.getByText("Up to $2,500")).toBeTruthy();
    expect(good.getByText("Resident groups only, not a business or a nonprofit")).toBeTruthy();
  });
});

describe("Resources match chips", () => {
  it("leaves out a reason that has no words, so no chip is blank", async () => {
    const resources = VIEW.resources.map((r): Resource =>
      r.id === "safe_sound_good_neighbor" ? { ...r, amount: null } : r,
    );
    await showSection(fakeClient([ok({ ...VIEW, resources })]));
    const good = matchItem("Safe & Sound Good Neighbor Grant Fund");
    const why = within(good.getByRole("list", { name: "Why it fits" }));
    const words = why.getAllByRole("listitem").map((li) => li.textContent);
    expect(words).toHaveLength(4);
    expect(words).not.toContain("");
    expect(good.queryByText("Up to $2,500")).toBeNull();
  });
});

describe("Resources match actions", () => {
  it("the source link opens in a new tab and the app does not fetch it", async () => {
    await showSection(fakeClient());
    const link = matchItem("Bader Philanthropies, preliminary application").getByRole("link");
    expect(link.getAttribute("href")).toBe("https://bader.org/apply-for-a-grant/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("an open grant gets a letter button and a closed one does not", async () => {
    const client = fakeClient();
    await showSection(client);
    expect(screen.queryByRole("button", { name: `Write a letter to ${MATCH_NAMES[2] ?? ""}` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Write a letter to ${MATCH_NAMES[1] ?? ""}` }));
    expect(client.post).toHaveBeenCalledWith("drafts", {
      draft: expect.stringMatching(/^d_[0-9a-f-]{36}$/u) as unknown,
      kind: "funder_letter",
      month: "2026-11",
      resource: "bader_preliminary",
    });
  });
});

describe("Resources readiness", () => {
  it("setting the sponsor to signed posts readiness and shows the view that comes back", async () => {
    const signed: ResourcesView = { ...VIEW, readiness: { ...VIEW.readiness, sponsor: "signed" } };
    const client = fakeClient([], ok(signed));
    await showSection(client);
    const current = screen.getByRole("button", {
      name: "Set Fiscal sponsor agreement to Not started, current",
    });
    expect(current.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Set Fiscal sponsor agreement to Signed" }));
    expect(client.post).toHaveBeenCalledWith("readiness", { item: "sponsor", state: "signed" });
    const now = await screen.findByRole("button", {
      name: "Set Fiscal sponsor agreement to Signed, current",
    });
    expect(now.getAttribute("aria-pressed")).toBe("true");
  });

  it("each item shows its reason line", async () => {
    await showSection(fakeClient());
    expect(screen.getByText("A federal grant needs a UEI, renewed each year.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set Own 501(c)(3) status, later to Yes" })).toBeTruthy();
  });
});

describe("Resources drafts", () => {
  it("write the impact post posts a new draft for the month with no resource", async () => {
    const client = fakeClient();
    await showSection(client);
    expect(
      screen.getByText("Vision never sends or posts. Copy an approved draft and send it yourself."),
    ).toBeTruthy();
    expect(screen.getByText("Drafts today: 3 of 20")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write the impact post" }));
    expect(client.post).toHaveBeenCalledWith("drafts", {
      draft: expect.stringMatching(/^d_[0-9a-f-]{36}$/u) as unknown,
      kind: "impact_post",
      month: "2026-11",
      resource: null,
    });
  });
});

describe("Resources draft sources", () => {
  it("each draft says who wrote it", async () => {
    await showSection(fakeClient());
    const post = draftCard("Impact post, November 2026");
    expect(post.getByText("AI is off, so this is the fixed template.")).toBeTruthy();
    expect(post.getByText("Ready to approve")).toBeTruthy();
    const letter = draftCard("Funder letter to Bader Philanthropies, preliminary application, November 2026");
    expect(letter.getByText("AI wrote this draft from the facts. The draft guard checked it.")).toBeTruthy();
    expect(letter.getByText("Approved by Quinn Organiser (test)")).toBeTruthy();
    expect(letter.getByText("c1868e864cd0")).toBeTruthy();
  });

  it("a stopped AI text names what the draft guard found", async () => {
    const stopped: DraftView = { ...draftAt(VIEW, 1), flag: "guard_rejected", reasons: ["number", "quote"] };
    render(<ResourcesSection client={fakeClient([ok(withDrafts([stopped]))])} />);
    const card = within(
      (await screen.findByRole("heading", { name: "Impact post, November 2026" })).closest(
        "article",
      ) as HTMLElement,
    );
    expect(
      card.getByText("The draft guard stopped the AI text, so this is the fixed template."),
    ).toBeTruthy();
    expect(card.getByText("It found a number that is not a fact and a quotation mark.")).toBeTruthy();
  });
});

describe("Resources approve", () => {
  it("approve posts the draft id, and only an approved draft can be copied or downloaded", async () => {
    const client = fakeClient();
    await showSection(client);
    const post = draftCard("Impact post, November 2026");
    expect(post.queryByRole("button", { name: "Copy text" })).toBeNull();
    fireEvent.click(post.getByRole("button", { name: "Approve" }));
    expect(client.post).toHaveBeenCalledWith("approve", { draft: draftAt(VIEW, 1).id });
    const letter = draftCard("Funder letter to Bader Philanthropies, preliminary application, November 2026");
    expect(letter.getByRole("button", { name: "Download text" })).toBeTruthy();
    expect(letter.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("copy writes the full text to the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await showSection(fakeClient());
    const letter = draftCard("Funder letter to Bader Philanthropies, preliminary application, November 2026");
    fireEvent.click(letter.getByRole("button", { name: "Copy text" }));
    expect(await letter.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(draftAt(VIEW, 2).text);
  });
});

describe("Resources copy failure and download", () => {
  it("a rejected copy shows the alert", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(() => Promise.reject(new Error("denied"))) },
    });
    await showSection(fakeClient());
    const letter = draftCard("Funder letter to Bader Philanthropies, preliminary application, November 2026");
    fireEvent.click(letter.getByRole("button", { name: "Copy text" }));
    expect((await letter.findByRole("alert")).textContent).toBe(
      "Copy did not work. Select the text and copy it.",
    );
  });

  it("download saves the text as a file named for the kind and the month", async () => {
    const make = vi.fn(() => "blob:draft");
    Object.assign(URL, { createObjectURL: make, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await showSection(fakeClient());
    const letter = draftCard("Funder letter to Bader Philanthropies, preliminary application, November 2026");
    fireEvent.click(letter.getByRole("button", { name: "Download text" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe("vision-funder_letter-2026-11.txt");
  });
});

describe("Resources polling", () => {
  it("a writing draft makes the section load again after 2 seconds and show ready", async () => {
    vi.useFakeTimers();
    const client = fakeClient([ok(VIEW), ok(settled(VIEW))]);
    render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    const name = "Funder letter to Safe & Sound Good Neighbor Grant Fund, November 2026";
    expect(draftCard(name).getByText("Writing the draft")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(client.load).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(client.load).toHaveBeenCalledTimes(2);
    expect(draftCard(name).getByText("Ready to approve")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(client.load).toHaveBeenCalledTimes(2);
  });

  it("loads again at most 30 times", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(2_000 * 40));
    expect(client.load).toHaveBeenCalledTimes(31);
  });

  it("stops loading on unmount", async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const { unmount } = render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(2_000 * 3));
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(2_000 * 3));
    expect(client.load).toHaveBeenCalledTimes(4);
  });
});

describe("Resources polling of a new draft", () => {
  it("a new writing draft gets a fresh budget of 30 loads", async () => {
    vi.useFakeTimers();
    const writing = draftAt(VIEW, 0);
    const two = withDrafts([{ ...writing, id: "d_3f1c2b4a-5d6e-4f70-8a91-b2c3d4e5f607" }, ...VIEW.drafts]);
    const client = fakeClient();
    client.load.mockImplementation(() =>
      Promise.resolve(ok(client.load.mock.calls.length <= 11 ? VIEW : two)),
    );
    render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    for (let n = 0; n < 60; n += 1) await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(client.load).toHaveBeenCalledTimes(42);
  });
});

describe("Resources late answers", () => {
  it("a load asked before a post that answers after it does not bring back the old view", async () => {
    vi.useFakeTimers();
    const approved = withDrafts(
      VIEW.drafts.map((d, i) =>
        i === 1
          ? { ...d, status: "approved", approvedAt: d.createdAt, approvedBy: draftAt(VIEW, 2).approvedBy }
          : d,
      ),
    );
    let answer: (outcome: ResourcesOutcome) => void = () => undefined;
    const client = fakeClient([], ok(approved));
    client.load
      .mockImplementationOnce(() => Promise.resolve(ok(VIEW)))
      .mockImplementationOnce(
        () =>
          new Promise<ResourcesOutcome>((resolve) => {
            answer = resolve;
          }),
      );
    render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(client.load).toHaveBeenCalledTimes(2);
    fireEvent.click(draftCard(POST_CARD).getByRole("button", { name: "Approve" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(draftCard(POST_CARD).getByRole("button", { name: "Copy text" })).toBeTruthy();
    await act(() => {
      answer(ok(VIEW));
      return vi.advanceTimersByTimeAsync(0);
    });
    expect(draftCard(POST_CARD).getByRole("button", { name: "Copy text" })).toBeTruthy();
  });
});

describe("Resources failures", () => {
  it("a failed load shows the message and Retry loads again", async () => {
    const failed: ResourcesOutcome = {
      ok: false,
      code: "forbidden",
      message: "Only an organiser can use Resources.",
    };
    const client = fakeClient([failed]);
    render(<ResourcesSection client={client} />);
    expect((await screen.findByRole("alert")).textContent).toBe("Only an organiser can use Resources.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(DEMO_NOTICE)).toBeTruthy();
  });

  it("a 429 from the client shows the hub message and keeps the last view", async () => {
    const client = fakeClient([], { ok: false, code: "rate_limited", message: CAP });
    await showSection(client);
    fireEvent.click(screen.getByRole("button", { name: "Write the impact post" }));
    expect((await screen.findByRole("alert")).textContent).toBe(CAP);
    expect(screen.getByText(DEMO_NOTICE)).toBeTruthy();
  });
});

describe("Resources errors and later loads", () => {
  it("a failed load while a draft is writing shows its message until a later load works", async () => {
    vi.useFakeTimers();
    const client = fakeClient([ok(VIEW), { ok: false, code: "network", message: DOWN }]);
    render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("alert").textContent).toBe(DOWN);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(client.load).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the answer to a post stays when a later load works", async () => {
    vi.useFakeTimers();
    const client = fakeClient([], { ok: false, code: "rate_limited", message: CAP });
    render(<ResourcesSection client={client} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    fireEvent.click(screen.getByRole("button", { name: "Write the impact post" }));
    await act(() => vi.advanceTimersByTimeAsync(2_000 * 2));
    expect(client.load).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert").textContent).toBe(CAP);
  });
});
