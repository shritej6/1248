import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeskBoardSchema,
  type Command,
  type DeskBoard,
  type DeskCard,
  type DeskJob,
} from "@vision/contracts";
import { countdown } from "../src/components/ClockText/ClockText.js";
import { markQuotes } from "../src/components/CardPanel/CardPanel.js";
import { DeskView, type DeskSend } from "../src/pages/DeskPage.js";
import { fixture } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const board = (): DeskBoard => DeskBoardSchema.parse(fixture("views/desk-board.json"));
const quiet = (): DeskBoard => ({ ...board(), pages: [] });
const sendOk = () => vi.fn<DeskSend>(() => Promise.resolve({ ok: true }));
const sentTypes = (send: ReturnType<typeof sendOk>) =>
  send.mock.calls.map(([command]: [Command]) => command.type);

function withMessage(message: string, quotes: string[]): DeskBoard {
  const base = quiet();
  const card = base.triage[0];
  if (card === undefined) throw new Error("the fixture has no triage card");
  const changed: DeskCard = { ...card, message, quotes };
  return { ...base, triage: [changed] };
}

function openTriage(name: RegExp = /Snow on my walk/) {
  fireEvent.click(screen.getByRole("button", { name }));
  return within(screen.getByRole("region", { name: /Request/ }));
}

describe("DeskView card panel", () => {
  it("confirm stays disabled until the desk picks an urgency", async () => {
    const send = sendOk();
    render(<DeskView board={quiet()} send={send} />);
    const panel = openTriage();
    expect(panel.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
    expect(panel.getByText("Pick urgency first")).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    const confirm = panel.getByRole("button", { name: "Confirm" });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "card.confirm", need: "snow", urgency: "low", division: null }),
      );
    });
  });

  it("quoted words are marked and script text shows as text", () => {
    render(
      <DeskView board={withMessage("<script>x</script> not breathing", ["not breathing"])} send={sendOk()} />,
    );
    const panel = openTriage(/not breathing/);
    expect(panel.getByText("not breathing", { selector: "mark" })).toBeTruthy();
    expect(panel.getByText(/<script>x<\/script>/)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("DeskView card panel labels", () => {
  it("the AI label says it is from the AI and quotes its words", () => {
    render(<DeskView board={quiet()} send={sendOk()} />);
    const panel = openTriage();
    expect(panel.getByText('AI: low. Words: "cannot get to the bus"')).toBeTruthy();
  });

  it("raise sends card.raise for a triage card", async () => {
    const send = sendOk();
    render(<DeskView board={quiet()} send={send} />);
    fireEvent.click(openTriage().getByRole("button", { name: "Raise to emergency" }));
    await waitFor(() => {
      expect(sentTypes(send)).toEqual(["card.raise"]);
    });
  });
});

function withTriage(change: Partial<DeskCard>): DeskBoard {
  const base = quiet();
  const card = base.triage[0];
  if (card === undefined) throw new Error("the fixture has no triage card");
  return { ...base, triage: [{ ...card, ...change }] };
}

function sortedWith(division: string | null): Partial<DeskCard> {
  const card = quiet().triage[0];
  if (card?.sorted == null) throw new Error("the fixture triage card is not sorted");
  return { sorted: { ...card.sorted, division } };
}

describe("DeskView card panel division", () => {
  it("confirm sends a sorter division that is on the list", async () => {
    const send = sendOk();
    render(<DeskView board={withTriage(sortedWith("Pet Division"))} send={send} />);
    const panel = openTriage();
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    fireEvent.click(panel.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "card.confirm", division: "Pet Division" }),
      );
    });
  });

  it("confirm sends no division when the sorter named one that is not on the list", async () => {
    const send = sendOk();
    render(<DeskView board={withTriage(sortedWith("Snow Team"))} send={send} />);
    const panel = openTriage();
    fireEvent.click(panel.getByRole("button", { name: "Low" }));
    fireEvent.click(panel.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "card.confirm", division: null }));
    });
  });
});

describe("DeskView lane rows", () => {
  const minute = 60_000;
  const rowOf = (name: RegExp) => within(screen.getByRole("button", { name }));

  it("each row shows its state word and the desk confirm clock", () => {
    const now = quiet().clock.now;
    render(<DeskView board={withTriage({ receivedAt: now - 14 * minute })} send={sendOk()} />);
    const row = rowOf(/Snow on my walk/);
    expect(row.getByText("SORTED")).toBeTruthy();
    expect(row.getByText("LATE")).toBeTruthy();
  });

  it("a row past the desk confirm limit says OVERDUE", () => {
    const now = quiet().clock.now;
    render(<DeskView board={withTriage({ receivedAt: now - 20 * minute, sorted: null })} send={sendOk()} />);
    const row = rowOf(/Snow on my walk/);
    expect(row.getByText("NEW")).toBeTruthy();
    expect(row.getByText("OVERDUE")).toBeTruthy();
  });

  it("an emergency row carries the word Emergency", () => {
    render(<DeskView board={quiet()} send={sendOk()} />);
    expect(rowOf(/gas smell in my kitchen/).getByText("EMERGENCY")).toBeTruthy();
  });
});

describe("desk styles", () => {
  const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
  const css = (path: string) => readFileSync(resolve(src, path), "utf8");
  const rule = (text: string, selector: string) => {
    const at = text.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no rule ${selector}`);
    return text.slice(at, text.indexOf("}", at));
  };
  const deskSheets = [
    "components/CardPanel/CardPanel.module.css",
    "components/JobRow/JobRow.module.css",
    "components/MemberPicker/MemberPicker.module.css",
    "components/PageAlert/PageAlert.module.css",
    "pages/DeskPage.module.css",
  ];

  it("takes every colour from the tokens", () => {
    for (const sheet of deskSheets) {
      expect(css(sheet), sheet).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
    }
  });

  it("puts a 3 px bar in the full colour beside every crit tint row", () => {
    expect(rule(css("components/CardPanel/CardPanel.module.css"), ".rowEmergency")).toMatch(
      /border-left-color: var\(--color-crit\)/u,
    );
    expect(rule(css("components/JobRow/JobRow.module.css"), ".mismatch td:first-child")).toMatch(
      /inset 3px 0 0 var\(--color-crit\)/u,
    );
  });
});

describe("DeskView lanes", () => {
  it("the emergency lane comes first with the word and a mark", () => {
    render(<DeskView board={quiet()} send={sendOk()} />);
    const lanes = screen.getAllByRole("region", { name: /lane/ });
    expect(lanes.map((lane) => lane.getAttribute("aria-label"))).toEqual(["Emergency lane", "Triage lane"]);
    expect(within(lanes[0] as HTMLElement).getByText(/gas smell in my kitchen/)).toBeTruthy();
  });

  it("an empty emergency lane says so", () => {
    render(<DeskView board={{ ...quiet(), emergency: [] }} send={sendOk()} />);
    expect(screen.getByText("No emergencies")).toBeTruthy();
  });
});

describe("DeskView page", () => {
  it("a page covers the screen until someone answers it", async () => {
    const send = sendOk();
    render(<DeskView board={board()} send={send} />);
    expect(screen.getByRole("alertdialog", { name: "Emergency page" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "page.answer" }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("a failed answer keeps the page and says why", async () => {
    const send = vi.fn<DeskSend>(() => Promise.resolve({ ok: false, code: "network" }));
    render(<DeskView board={board()} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(await screen.findByText(/Not sent. No connection/)).toBeTruthy();
    expect(screen.getByRole("alertdialog", { name: "Emergency page" })).toBeTruthy();
  });
});

describe("DeskView jobs", () => {
  it("each job shows its holder and its clock in words", () => {
    render(<DeskView board={quiet()} send={sendOk()} />);
    const row = screen.getByRole("row", { name: /SNOW-4821/ });
    expect(within(row).getByText("Held by")).toBeTruthy();
    expect(within(row).getByText("Avery Snow (test)")).toBeTruthy();
    expect(within(row).getByText("Start travel")).toBeTruthy();
    expect(within(row).getByText("2:00 h")).toBeTruthy();
    expect(within(row).getByText("ACCEPTED")).toBeTruthy();
  });

  it("a planned job offers approve plan", async () => {
    const send = sendOk();
    const base = quiet();
    const jobs = base.jobs.map((job) => ({ ...job, status: "planned" as const }));
    render(<DeskView board={{ ...base, jobs }} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Approve plan" }));
    await waitFor(() => {
      expect(sentTypes(send)).toEqual(["job.approve"]);
    });
  });
});

describe("DeskView shift", () => {
  it("take shift asks for a confirm and then sends shift.take", async () => {
    const send = sendOk();
    render(<DeskView board={{ ...quiet(), onShift: null }} send={send} />);
    expect(screen.getByText("No one on shift")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take shift" }));
    const dialog = within(await screen.findByRole("dialog", { name: "Take the shift" }));
    fireEvent.click(dialog.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(sentTypes(send)).toEqual(["shift.take"]);
    });
  });
});

describe("countdown", () => {
  it("formats minutes, hours, late and overdue", () => {
    const min = 60_000;
    expect(countdown(10 * min, 0, 15 * min)).toEqual({ text: "10:00", tone: "normal" });
    expect(countdown(3 * min, 0, 15 * min)).toEqual({ text: "3:00", tone: "late" });
    expect(countdown(0, 90_000, 15 * min)).toEqual({ text: "+1:30", tone: "overdue" });
    expect(countdown(125 * min, 0, null)).toEqual({ text: "2:05 h", tone: "normal" });
  });
});

describe("markQuotes", () => {
  it("splits the message around each quote without case", () => {
    expect(markQuotes("I am Not Breathing well", ["not breathing"])).toEqual([
      { text: "I am ", marked: false },
      { text: "Not Breathing", marked: true },
      { text: " well", marked: false },
    ]);
    expect(markQuotes("plain", ["missing"])).toEqual([{ text: "plain", marked: false }]);
  });
});

function boardWithJob(change: Partial<DeskJob>): DeskBoard {
  const base = quiet();
  return { ...base, jobs: base.jobs.map((job) => ({ ...job, ...change })) };
}

const jobRow = () => within(screen.getByRole("row", { name: /SNOW-4821/ }));

async function sentOne(send: ReturnType<typeof sendOk>, expected: Record<string, unknown>) {
  await waitFor(() => {
    expect(send).toHaveBeenCalledWith(expect.objectContaining(expected));
  });
}

describe("DeskView partner answer", () => {
  it("the job row shows why the partner said no and when to ask again", () => {
    const no = {
      partnerName: "Test Pantry",
      answer: "no",
      reason: "Closed for the holiday",
      waitUntil: null,
    } as const;
    const { unmount } = render(<DeskView board={boardWithJob({ partnerAnswer: no })} send={sendOk()} />);
    expect(jobRow().getByText("Test Pantry said no: Closed for the holiday")).toBeTruthy();
    unmount();
    const waitUntil = new Date("2026-11-24T10:00:00-06:00").getTime();
    const wait = { partnerName: "Test Pantry", answer: "wait", reason: null, waitUntil } as const;
    render(<DeskView board={boardWithJob({ partnerAnswer: wait })} send={sendOk()} />);
    expect(jobRow().getByText("Test Pantry said wait. Ask again after Nov 24 10:00 AM")).toBeTruthy();
  });

  it("a wait with a reason shows both, and a plain yes shows no line", () => {
    const waitUntil = new Date("2026-11-24T10:00:00-06:00").getTime();
    const wait = {
      partnerName: "Test Pantry",
      answer: "wait",
      reason: "Restock on Tuesday",
      waitUntil,
    } as const;
    const { unmount } = render(<DeskView board={boardWithJob({ partnerAnswer: wait })} send={sendOk()} />);
    const words = "Test Pantry said wait: Restock on Tuesday. Ask again after Nov 24 10:00 AM";
    expect(jobRow().getByText(words)).toBeTruthy();
    unmount();
    const yes = { partnerName: "Test Pantry", answer: "yes", reason: null, waitUntil: null } as const;
    render(<DeskView board={boardWithJob({ partnerAnswer: yes })} send={sendOk()} />);
    expect(jobRow().queryByText(/Test Pantry said/)).toBeNull();
  });
});

describe("DeskView P1 jobs", () => {
  it("a mismatch shows the word Mismatch and a button to send it to a new volunteer", async () => {
    const send = sendOk();
    render(<DeskView board={boardWithJob({ status: "mismatch", mismatch: true })} send={send} />);
    expect(jobRow().getByText("Mismatch: the person said they were not helped")).toBeTruthy();
    expect(jobRow().getByText("MISMATCH")).toBeTruthy();
    fireEvent.click(jobRow().getByRole("button", { name: "Send to new volunteer" }));
    await sentOne(send, { type: "job.offer_again" });
  });

  it("a job back at the desk after a wave offers it again instead of a second approve", async () => {
    const send = sendOk();
    render(
      <DeskView board={boardWithJob({ status: "planned", returnReason: "no_volunteer" })} send={send} />,
    );
    expect(jobRow().getByText("Back to desk: no volunteer took it")).toBeTruthy();
    expect(jobRow().queryByRole("button", { name: "Approve plan" })).toBeNull();
    fireEvent.click(jobRow().getByRole("button", { name: "Offer again" }));
    await sentOne(send, { type: "job.offer_again" });
  });

  it("the desk can add a second job to a card", async () => {
    const send = sendOk();
    render(<DeskView board={quiet()} send={send} />);
    fireEvent.click(jobRow().getByRole("button", { name: "Add a need" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Add a need to SNOW-4821/ }));
    expect(dialog.queryByRole("button", { name: "Snow shovelling" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Food from a pantry" }));
    await sentOne(send, { type: "card.add_job", need: "food", card: quiet().jobs[0]?.card });
  });

  it("withdraw asks for the reason and sends it", async () => {
    const send = sendOk();
    render(<DeskView board={quiet()} send={send} />);
    fireEvent.click(jobRow().getByRole("button", { name: "Withdraw" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Withdraw SNOW-4821/ }));
    fireEvent.click(dialog.getByRole("button", { name: "Duplicate request" }));
    await sentOne(send, { type: "job.withdraw", reason: "duplicate" });
  });
});

describe("DeskView P1 job paths", () => {
  it("next path moves a partner job down the ladder", async () => {
    const send = sendOk();
    render(<DeskView board={boardWithJob({ status: "partner_asked" })} send={send} />);
    fireEvent.click(jobRow().getByRole("button", { name: "Next path" }));
    await sentOne(send, { type: "job.next_rung" });
  });
});

describe("DeskView partner link", () => {
  it("a partner job shows its link to copy", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <DeskView
        board={boardWithJob({ status: "partner_asked", partnerLink: "/comforce-demo/p/tok" })}
        send={sendOk()}
      />,
    );
    fireEvent.click(jobRow().getByRole("button", { name: "Copy partner link" }));
    expect(await jobRow().findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/comforce-demo/p/tok`);
  });

  it("a failed copy shows the link to copy by hand", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<DeskView board={boardWithJob({ partnerLink: "/comforce-demo/p/tok" })} send={sendOk()} />);
    fireEvent.click(jobRow().getByRole("button", { name: "Copy partner link" }));
    expect(await jobRow().findByText(/Not copied. Select the link/)).toBeTruthy();
    expect(jobRow().getByText(`${window.location.origin}/comforce-demo/p/tok`)).toBeTruthy();
  });
});

describe("DeskView call tasks", () => {
  it("a consent call task takes the answer from the phone call", async () => {
    const send = sendOk();
    render(
      <DeskView board={boardWithJob({ status: "consent_asked", flags: ["consent_call"] })} send={send} />,
    );
    expect(jobRow().getByText("Call for consent")).toBeTruthy();
    fireEvent.click(jobRow().getByRole("button", { name: "Said yes" }));
    await sentOne(send, { type: "consent.answer", answer: "yes" });
  });

  it("a check-back call task takes the answer from the phone call", async () => {
    const send = sendOk();
    render(<DeskView board={boardWithJob({ status: "done", flags: ["checkback_call"] })} send={send} />);
    expect(jobRow().getByText("Call the resident back")).toBeTruthy();
    fireEvent.click(jobRow().getByRole("button", { name: "Not helped" }));
    await sentOne(send, { type: "checkback.answer", answer: 3 });
  });

  it("a visit check can be cleared after the desk reaches the volunteer", async () => {
    const send = sendOk();
    render(<DeskView board={boardWithJob({ status: "there", flags: ["visit_check"] })} send={send} />);
    fireEvent.click(jobRow().getByRole("button", { name: "Volunteer is safe" }));
    await sentOne(send, { type: "job.clear_flag", flag: "visit_check" });
  });
});

describe("DeskView quiet lane", () => {
  it("a quiet card goes to its own lane for the lead with the rule in words", () => {
    render(<DeskView board={withTriage({ quiet: true })} send={sendOk()} />);
    const lane = within(screen.getByRole("region", { name: "Quiet lane" }));
    expect(lane.getByText(/Snow on my walk/)).toBeTruthy();
    expect(lane.getByText("Only the lead sees these. Vision sends nothing to the person.")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Triage lane" })).getByText("No cards to read"),
    ).toBeTruthy();
  });

  it("a quiet card panel says that no message goes out", () => {
    render(<DeskView board={withTriage({ quiet: true })} send={sendOk()} />);
    const panel = openTriage();
    expect(
      panel.getByText("Quiet card. Vision sends nothing to the person. Contact only by the lead."),
    ).toBeTruthy();
  });
});

describe("DeskView need choices", () => {
  it("a board from a hub without the board need list still parses and offers the card needs", async () => {
    const { needOptions, ...older } = fixture("views/desk-board.json") as Record<string, unknown>;
    expect(needOptions).toBeDefined();
    const parsed = DeskBoardSchema.parse(older);
    const send = sendOk();
    render(<DeskView board={{ ...parsed, pages: [] }} send={send} />);
    fireEvent.click(jobRow().getByRole("button", { name: "Add a need" }));
    const dialog = within(await screen.findByRole("dialog", { name: /Add a need to SNOW-4821/ }));
    expect(dialog.queryByRole("button", { name: "Food from a pantry" })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: "Lawn mowing" }));
    await sentOne(send, { type: "card.add_job", need: "lawn" });
  });
});
