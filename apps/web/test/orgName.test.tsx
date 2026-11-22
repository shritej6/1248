import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeskBoardSchema,
  PartnerCardSchema,
  TrackingSchema,
  type OrgView,
  type PartnerCard,
} from "@vision/contracts";
import { App } from "../src/App.js";
import { Shell } from "../src/components/Shell/Shell.js";
import { DeskPage } from "../src/pages/DeskPage.js";
import { OrgPage } from "../src/pages/OrgPage.js";
import { PartnerView } from "../src/pages/PartnerPage.js";
import { matchRoute } from "../src/router.js";
import { saveSession } from "../src/session.js";
import { ABOUT_NAME, fakeSockets, fixture, mockFetch } from "./helpers.js";

const NAME = "Test Group demo";
const PAGE = "/test-group/";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const topBar = (): HTMLElement => {
  const [first] = screen.getAllByRole("banner");
  if (first === undefined) throw new Error("the page has no top bar");
  return first;
};
const banner = () => within(topBar());
const tracking = () => ({ ...TrackingSchema.parse(fixture("views/tracking-open.json")), orgName: NAME });
const partner = (): PartnerCard => ({
  ...PartnerCardSchema.parse(fixture("views/partner-ask.json")),
  orgName: NAME,
});
const orgView = (): OrgView => ({
  playbook: null,
  levels: { master: false, needs: [] },
  members: [],
  partners: [],
  unmet: [],
  finish: [],
  demo: { mode: false, offsetMs: 0 },
  clock: { now: Date.UTC(2026, 10, 22, 15), offsetMs: 0 },
  orgName: NAME,
});

describe("Shell organisation name", () => {
  it("shows the organisation name it is given and no name while it is unknown", () => {
    const { rerender } = render(
      <Shell theme="paper" section={null} live={null} clock={null} orgName={NAME}>
        page
      </Shell>,
    );
    expect(banner().getByText(NAME)).toBeTruthy();
    rerender(
      <Shell theme="graphite" section="Desk" live={null} clock={null} orgName={null}>
        page
      </Shell>,
    );
    expect(topBar().textContent).toBe("Desk");
  });
});

describe("resident and partner pages", () => {
  it("the tracking page header names the organisation from the tracking view", async () => {
    mockFetch([{ status: 200, body: tracking() }]);
    render(<App route={matchRoute(`${PAGE}t/tok`)} />);
    expect(await screen.findByText("SNOW-4821")).toBeTruthy();
    expect(banner().getByText(NAME)).toBeTruthy();
    expect(topBar().textContent).not.toContain("ComForce");
  });

  it("a tracking view without the name shows the organisation id", async () => {
    const { orgName, ...older } = tracking();
    expect(orgName).toBe(NAME);
    mockFetch([{ status: 200, body: older }]);
    render(<App route={matchRoute(`${PAGE}t/tok`)} />);
    expect(await screen.findByText("SNOW-4821")).toBeTruthy();
    expect(banner().getByText("test-group")).toBeTruthy();
  });

  it("the partner card header and ask heading name the organisation", async () => {
    mockFetch([{ status: 200, body: partner() }]);
    render(<App route={matchRoute(`${PAGE}p/tok`)} />);
    const heading = await screen.findByRole("heading", { name: `${NAME} asks: can you take this?` });
    expect(heading).toBeTruthy();
    expect(banner().getByText(NAME)).toBeTruthy();
    expect(document.body.textContent).not.toContain("ComForce MKE");
  });

  it("the partner promise and the result name the organisation", () => {
    const view: PartnerCard = { ...partner(), state: "promise" };
    const send = vi.fn(() => Promise.resolve({ ok: true } as const));
    const { rerender } = render(<PartnerView view={view} send={send} />);
    expect(screen.getByText(`If the person or ${NAME} asks, you delete it at once.`)).toBeTruthy();
    const result = { status: "helped" as const, counts: { asked: 1, yes: 1, gotIt: 1, helped: 1 } };
    rerender(<PartnerView view={{ ...view, state: "result", ask: null, result }} send={send} />);
    expect(screen.getByRole("heading", { name: `Your group with ${NAME}` })).toBeTruthy();
  });
});

describe("request form", () => {
  it("the request form names the organisation from the hub", async () => {
    mockFetch([]);
    render(<App route={matchRoute(`${PAGE}ask`)} />);
    expect(await screen.findByRole("heading", { name: `Ask ${ABOUT_NAME} for help` })).toBeTruthy();
    expect(banner().getByText(ABOUT_NAME)).toBeTruthy();
  });

  it("the request form names the organisation by its id when the hub does not answer", async () => {
    mockFetch([], "network", "network");
    render(<App route={matchRoute(`${PAGE}ask`)} />);
    expect(await screen.findByRole("heading", { name: "Ask test-group for help" })).toBeTruthy();
  });
});

describe("staff pages", () => {
  it("the join page names the organisation from the hub", async () => {
    mockFetch([]);
    render(<App route={matchRoute(`${PAGE}join`)} />);
    expect(await screen.findByRole("heading", { name: `Join ${ABOUT_NAME}` })).toBeTruthy();
    expect(banner().getByText(ABOUT_NAME)).toBeTruthy();
  });

  it("the desk top bar names the organisation from the desk board", async () => {
    saveSession("test-group", "desk-token");
    const board = { ...DeskBoardSchema.parse(fixture("views/desk-board.json")), orgName: NAME };
    mockFetch([], { status: 200, body: board });
    render(<DeskPage org="test-group" openSocket={fakeSockets().openSocket} />);
    expect(await banner().findByText(NAME)).toBeTruthy();
    expect(topBar().textContent).not.toContain("ComForce");
  });

  it("the organiser top bar names the organisation from the organiser view", async () => {
    saveSession("test-group", "org-token");
    mockFetch([], { status: 200, body: orgView() });
    render(<OrgPage org="test-group" openSocket={fakeSockets().openSocket} />);
    expect(await banner().findByText(NAME)).toBeTruthy();
  });
});
