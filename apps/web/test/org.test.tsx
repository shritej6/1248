import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeskBoardSchema,
  MemberRecordSchema,
  PartnerRecordSchema,
  PlaybookSchema,
  type EventDraft,
  type LedgerEvent,
  type OrgView,
} from "@vision/contracts";
import { GENESIS_HASH, sealEvent, statement } from "@vision/core";
import { App } from "../src/App.js";
import { DemoClock } from "../src/components/DemoClock/DemoClock.js";
import { SealCheck } from "../src/components/SealCheck/SealCheck.js";
import { StatementTable } from "../src/components/StatementTable/StatementTable.js";
import type { GoogleOutcome } from "../src/api.js";
import { OrgPage, OrgPageView, type AskGoogle } from "../src/pages/OrgPage.js";
import type { ResourcesClient, ResourcesOutcome } from "../src/resourcesApi.js";
import { matchRoute } from "../src/router.js";
import { fakeSockets, fixture, mockFetch } from "./helpers.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

type Body = Pick<EventDraft, "type" | "data">;
type Step = [at: number, card: string | null, job: string | null, body: Body];

const SYSTEM = { role: "system", ref: null } as const;
const nov = (day: number, hour = 12): number => Date.UTC(2026, 10, day, hour);
const here = dirname(fileURLToPath(import.meta.url));
const synthetic = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(here, "../../../data/synthetic", name), "utf8"));

const sealAll = (steps: readonly Step[]): LedgerEvent[] => {
  const out: LedgerEvent[] = [];
  let prev = GENESIS_HASH;
  steps.forEach(([at, card, job, body], i) => {
    const line = sealEvent({ card, job, actor: SYSTEM, ...body } as EventDraft, i + 1, at, prev);
    out.push(line);
    prev = line.hash;
  });
  return out;
};

const planned = (at: number, card: string, job: string, need: string): Step => [
  at,
  card,
  job,
  {
    type: "job.planned",
    data: { need, path: "volunteers", rung: 0, level: 2, quiet: false, promiseAt: at + 86_400_000 },
  },
];

const received = (at: number, card: string): Step => [
  at,
  card,
  null,
  { type: "card.received", data: { door: "form", zip: "53206", safeContact: true } },
];

const C_A = "c_0b4f6d1e-2a3c-4e5f-8a7b-9c0d1e2f3a4b";
const C_B = "c_1c5a7e2f-3b4d-4f60-9b8c-0d1e2f3a4b5c";
const C_C = "c_2d6b8f30-4c5e-4071-8c9d-1e2f3a4b5c6d";
const J_A = "j_3e7c9a41-5d6f-4182-9dae-2f3a4b5c6d7e";
const J_B = "j_4f8dab52-6e70-4293-aebf-3a4b5c6d7e8f";
const J_C = "j_5a9ebc63-7f81-43a4-bfc0-4b5c6d7e8f90";

function demoMonthEvents(): LedgerEvent[] {
  return sealAll([
    received(nov(2, 9), C_A),
    planned(nov(2, 10), C_A, J_A, "snow"),
    [nov(3, 9), C_A, J_A, { type: "job.closed", data: { result: "helped", reason: null } }],
    received(nov(5, 9), C_B),
    planned(nov(5, 10), C_B, J_B, "food"),
    [nov(5, 11), C_B, J_B, { type: "job.unmet", data: {} }],
    received(nov(10, 9), C_C),
    planned(nov(10, 10), C_C, J_C, "snow"),
  ]);
}

function brokenAt(line: number): LedgerEvent[] {
  return demoMonthEvents().map((event) =>
    event.seq === line
      ? { ...event, hash: event.hash.replace(/^./u, (c) => (c === "a" ? "b" : "a")) }
      : event,
  );
}

function orgView(demo: OrgView["demo"] = { mode: true, offsetMs: 0 }): OrgView {
  const board = DeskBoardSchema.parse(fixture("views/desk-board.json"));
  const playbook = PlaybookSchema.parse(synthetic("playbook.json"));
  const job = board.jobs[0];
  if (job === undefined) throw new Error("the desk fixture has no job");
  return {
    playbook,
    levels: {
      master: false,
      needs: playbook.rows.map((row) => ({
        need: row.need,
        level: row.level,
        clean: 0,
        changed: 0,
        canEarn: false,
      })),
    },
    members: MemberRecordSchema.array().parse(synthetic("members.json")),
    partners: PartnerRecordSchema.array().parse(synthetic("partners.json")),
    unmet: [{ ...job, status: "unmet" }],
    finish: [{ ...job, daysSinceTap: 4 }],
    demo,
    clock: { now: nov(21, 18), offsetMs: demo.offsetMs },
  };
}

const sent = () => vi.fn(() => Promise.resolve({ ok: true } as const));
const ledger = () => Promise.resolve(demoMonthEvents());
const makeCode = () => Promise.resolve({ ok: true, joinCode: "JOIN-7K2M" } as const);
const google = (outcome: GoogleOutcome = { ok: true }) => vi.fn<AskGoogle>(() => Promise.resolve(outcome));
const NO_HUB: ResourcesOutcome = { ok: false, code: "network", message: "No hub in this test." };
const fakeResources = (): ResourcesClient => ({
  load: vi.fn(() => Promise.resolve(NO_HUB)),
  post: vi.fn(() => Promise.resolve(NO_HUB)),
});

describe("StatementTable", () => {
  it("the statement shows the balance line with counts", () => {
    render(<StatementTable statement={statement(demoMonthEvents(), "2026-11")} />);
    expect(
      screen.getByText(
        "Open at start 0 + New 3 = Helped 1 + Unmet 1 + Unreached 0 + Withdrawn 0 + Still open 1",
      ),
    ).toBeTruthy();
    expect(screen.getByText("BALANCES")).toBeTruthy();
  });

  it("a statement that does not balance shows the word and a shape mark", () => {
    const month = statement(demoMonthEvents(), "2026-11");
    render(<StatementTable statement={{ ...month, helped: month.helped + 2 }} />);
    const words = screen.getByText("DOES NOT BALANCE by 2");
    expect(words.parentElement?.querySelector("svg")).toBeTruthy();
  });

  it("the how counted drawer closes with Escape", () => {
    render(<StatementTable statement={statement(demoMonthEvents(), "2026-11")} />);
    fireEvent.click(screen.getAllByRole("button", { name: "How counted: New" })[0] as HTMLElement);
    expect(screen.getByRole("heading", { name: "New" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Jobs planned inside the month.")).toBeNull();
  });

  it("each figure opens how it was counted", () => {
    render(<StatementTable statement={statement(demoMonthEvents(), "2026-11")} />);
    fireEvent.click(screen.getAllByRole("button", { name: "How counted: New" })[0] as HTMLElement);
    expect(screen.getByText("Jobs planned inside the month.")).toBeTruthy();
  });

  it("the unmet table counts need and ZIP with no names", () => {
    render(<StatementTable statement={statement(demoMonthEvents(), "2026-11")} />);
    const table = screen.getByRole("table", { name: "Unmet needs" });
    expect(within(table).getByText("food")).toBeTruthy();
    expect(within(table).getByText("53206")).toBeTruthy();
  });
});

describe("SealCheck", () => {
  it("check the seal reports the broken line", () => {
    render(<SealCheck events={brokenAt(4)} />);
    fireEvent.click(screen.getByRole("button", { name: "Check the seal" }));
    const words = screen.getByText("The seal is broken at line 4.");
    expect(words.parentElement?.querySelector("svg")).toBeTruthy();
  });

  it("an intact ledger says the seal holds", () => {
    render(<SealCheck events={demoMonthEvents()} />);
    fireEvent.click(screen.getByRole("button", { name: "Check the seal" }));
    const words = screen.getByText("The seal holds for all 8 lines.");
    expect(words.parentElement?.querySelector("svg")).toBeTruthy();
  });
});

describe("DemoClock", () => {
  it("demo clock buttons show only in demo mode", () => {
    render(<DemoClock demo={{ mode: false, offsetMs: 0 }} send={sent()} />);
    expect(screen.queryByRole("button", { name: "+1 day" })).toBeNull();
    expect(screen.getByText("Demo mode is off. The clock follows real time.")).toBeTruthy();
  });

  it("a jump sends clock.jump with the minutes", async () => {
    const send = sent();
    render(<DemoClock demo={{ mode: true, offsetMs: 0 }} send={send} />);
    fireEvent.click(screen.getByRole("button", { name: "+3 days" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "clock.jump", minutes: 4320 }));
    });
    expect(await screen.findByText("Demo jump +3 days")).toBeTruthy();
  });
});

const renderOrg = (send: ReturnType<typeof sent>, ask: AskGoogle, resources = fakeResources()) =>
  render(
    <OrgPageView
      view={orgView()}
      loadLedger={ledger}
      makeCode={makeCode}
      send={send}
      google={ask}
      resources={resources}
    />,
  );

const TAB_ORDER = ["Statement", "Unmet", "Resources", "Playbook", "Volunteers", "Partners", "Settings"];

describe("OrgPageView tabs", () => {
  it("the tab names come in the order of the plan", () => {
    renderOrg(sent(), google());
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(TAB_ORDER);
  });

  it("the resources tab loads its own view", async () => {
    const resources = fakeResources();
    renderOrg(sent(), google(), resources);
    fireEvent.click(screen.getByRole("tab", { name: "Resources" }));
    expect((await screen.findByRole("alert")).textContent).toBe("No hub in this test.");
    expect(resources.load).toHaveBeenCalledTimes(1);
  });
});

describe("OrgPageView", () => {
  it("the unmet section lists the shelf and the finish list", () => {
    renderOrg(sent(), google());
    fireEvent.click(screen.getByRole("tab", { name: "Unmet" }));
    expect(screen.getByRole("table", { name: "Unmet shelf" })).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Finish list" })).getByText("4")).toBeTruthy();
  });

  it("a level change sends need.set_level", async () => {
    const send = sent();
    renderOrg(send, google());
    fireEvent.click(screen.getByRole("tab", { name: "Playbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Set shelter to level 3" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: "need.set_level", need: "shelter", level: 3 }),
      );
    });
  });

  it("volunteers and partners show names and no contact details", async () => {
    renderOrg(sent(), google());
    fireEvent.click(screen.getByRole("tab", { name: "Volunteers" }));
    expect(screen.getByText("Morgan Desk (test)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make a join code for Morgan Desk (test)" }));
    expect(await screen.findByText("JOIN-7K2M")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Partners" }));
    expect(screen.getByText("Northside Pantry (test)")).toBeTruthy();
  });

  it("the settings section holds the demo clock and the rehearsal day", () => {
    renderOrg(sent(), google());
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "+1 day" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rehearsal day" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run rehearsal" })).toBeTruthy();
  });
});

describe("PlaybookTable levels", () => {
  it("the chosen level is marked, stays focusable and sends nothing", () => {
    const send = sent();
    render(
      <OrgPageView
        view={orgView()}
        loadLedger={ledger}
        makeCode={makeCode}
        send={send}
        google={google()}
        resources={fakeResources()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Playbook" }));
    const chosen = screen.getByRole("button", { name: "Set shelter to level 2, current" });
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    expect(chosen.hasAttribute("disabled")).toBe(false);
    fireEvent.click(chosen);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("PeopleTable", () => {
  it("each volunteer on or off state has a shape mark", () => {
    render(
      <OrgPageView
        view={orgView()}
        loadLedger={ledger}
        makeCode={makeCode}
        send={sent()}
        google={google()}
        resources={fakeResources()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Volunteers" }));
    const states = screen.getAllByText(/^(ON|OFF)$/u);
    expect(states.length).toBeGreaterThan(0);
    states.forEach((word) => {
      expect(word.parentElement?.querySelector("svg")).toBeTruthy();
    });
  });
});

describe("OrgPage route", () => {
  it("the org route asks for a join code with no session", async () => {
    const route = matchRoute("/comforce-demo/org");
    render(<App route={route} />);
    expect(await screen.findByRole("link", { name: "Type a join code" })).toBeTruthy();
  });

  it("the statement loads the export and computes in the browser", async () => {
    localStorage.setItem("vision.session.comforce-demo", "tok");
    const events = demoMonthEvents();
    mockFetch([
      { status: 200, body: orgView() },
      { status: 200, body: { events, sealed: { ok: true, seq: 8, hash: events[7]?.hash } } },
    ]);
    render(<OrgPage org="comforce-demo" openSocket={fakeSockets().openSocket} />);
    expect(await screen.findByText(/^Open at start 0 \+ New 3/u)).toBeTruthy();
  });
});

describe("Google buttons", () => {
  it("load playbook from the sheet asks the hub and says when it is loaded", async () => {
    const ask = google();
    renderOrg(sent(), ask);
    fireEvent.click(screen.getByRole("tab", { name: "Playbook" }));
    fireEvent.click(screen.getByRole("button", { name: "Load playbook from the sheet" }));
    expect(await screen.findByText("The playbook from the sheet is loaded.")).toBeTruthy();
    expect(ask).toHaveBeenCalledWith("playbook", {});
  });

  it("save statement to Drive sends the statement the browser computed and shows a refusal in words", async () => {
    const message = "The Google link is not set up for this hub.";
    const ask = google({ ok: false, code: "wrong_state", message });
    renderOrg(sent(), ask);
    fireEvent.click(await screen.findByRole("button", { name: "Save statement to Drive" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(ask).toHaveBeenCalledWith("statement", { statement: statement(demoMonthEvents(), "2026-11") });
  });
});
