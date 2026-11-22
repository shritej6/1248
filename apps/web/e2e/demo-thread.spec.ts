import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { seedOrg, type SeedCode } from "../../hub/scripts/seed.js";

const ORG = "comforce-demo";
const HUB = process.env.E2E_HUB_URL ?? "http://localhost:8799";
const API = `${HUB}/api/v1/o/${ORG}`;
const SNOW = "Snow shovelling";
const FOOD = "Food from a pantry";

type Volunteer = { name: string; token: string };
type HomeBody = { offers: { job: string; needLabel: string }[] };
type CommandBody = { ok: boolean; error?: { code: string } };
type Thread = {
  codes: SeedCode[];
  resident: Page;
  desk: Page;
  first: Volunteer;
  second: Volunteer;
};

const codeOf = (codes: SeedCode[], name: string): string => {
  const found = codes.find((c) => c.name === name);
  if (found === undefined) throw new Error(`The seed gave no join code for ${name}.`);
  return found.code;
};

const joinApi = async (codes: SeedCode[], name: string): Promise<Volunteer> => {
  const response = await fetch(`${API}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: codeOf(codes, name) }),
  });
  expect(response.status, `join for ${name}`).toBe(200);
  const body = (await response.json()) as { session: string };
  return { name, token: body.session };
};

const send = async (who: Volunteer, command: Record<string, unknown>): Promise<CommandBody> => {
  const response = await fetch(`${API}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.token}` },
    body: JSON.stringify({ id: `cmd_${crypto.randomUUID()}`, ...command }),
  });
  return (await response.json()) as CommandBody;
};

const sendOk = async (who: Volunteer, command: Record<string, unknown>): Promise<void> => {
  const body = await send(who, command);
  expect(body.ok, `${who.name} sends ${String(command.type)}`).toBe(true);
};

const offers = async (who: Volunteer): Promise<string[]> => {
  const response = await fetch(`${API}/views/home`, { headers: { Authorization: `Bearer ${who.token}` } });
  expect(response.status, `home view for ${who.name}`).toBe(200);
  const body = (await response.json()) as HomeBody;
  return body.offers.filter((o) => o.needLabel === SNOW).map((o) => o.job);
};

const waitForOffer = async (who: Volunteer): Promise<string> => {
  await expect
    .poll(async () => (await offers(who)).length, { message: `${who.name} waits for a snow offer` })
    .toBe(1);
  const [job] = await offers(who);
  if (job === undefined) throw new Error(`${who.name} lost the snow offer.`);
  return job;
};

const staffPage = async (browser: Browser, code: string, home: RegExp): Promise<Page> => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.goto(`/${ORG}/join`);
  await page.getByLabel("Join code").fill(code);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL(home);
  return page;
};

const jobRow = (desk: Page, need: string): Locator => desk.getByRole("row", { name: new RegExp(need) });

const askFor = (resident: Page, need: string): Locator =>
  resident.getByRole("region", { name: "Did they help?" }).filter({ hasText: need });

const residentAsks = async (page: Page): Promise<string> => {
  await page.goto(`/${ORG}/ask`);
  await page
    .getByLabel("What do you need?")
    .fill("My front steps and walk are under deep snow. I cannot get out to the bus stop.");
  await page.getByLabel("Your first name").fill("Dana");
  await page.getByLabel("How can we reach you?").fill("dana.resident@example.test");
  await page.getByLabel("ZIP code").fill("53216");
  await page.getByLabel("Your address").fill("100 Test Street");
  await page.getByText("Yes", { exact: true }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "We have your request" })).toBeVisible();
  const href = await page.getByRole("link", { name: /\/t\// }).getAttribute("href");
  if (href === null) throw new Error("The receipt has no tracking link.");
  return href;
};

const deskConfirms = async (desk: Page): Promise<void> => {
  await desk.getByRole("button", { name: "Take shift" }).click();
  await desk.getByRole("dialog", { name: "Take the shift" }).getByRole("button", { name: "Confirm" }).click();
  await desk.getByRole("region", { name: "Triage lane" }).getByRole("button", { name: /53216/ }).click();
  const panel = desk.getByRole("region", { name: "Request from ZIP 53216" });
  await expect(panel.getByRole("region", { name: "Words of the resident" })).toContainText("deep snow");
  await panel.getByRole("radio", { name: SNOW }).check({ force: true });
  await panel.getByRole("group", { name: "Urgency" }).getByRole("button", { name: "Low" }).click();
  await panel.getByRole("button", { name: "Confirm" }).click();
  await jobRow(desk, SNOW).getByRole("button", { name: "Approve plan" }).click();
};

const firstAcceptWins = async (thread: Thread): Promise<string> => {
  const job = await waitForOffer(thread.first);
  expect(await waitForOffer(thread.second)).toBe(job);
  await sendOk(thread.first, { type: "offer.accept", job });
  expect((await send(thread.second, { type: "offer.accept", job })).error?.code).toBe("taken");
  expect(await offers(thread.second)).not.toContain(job);
  return job;
};

const volunteerFinishes = async (thread: Thread, job: string, tracking: string): Promise<void> => {
  const { resident } = thread;
  await resident.goto(tracking);
  await expect(resident.getByRole("banner").getByRole("status")).toHaveText("Live");
  await expect(resident.getByText("A volunteer has it")).toBeVisible();
  await sendOk(thread.first, { type: "job.on_my_way", job });
  await expect(resident.getByText("On the way")).toBeVisible();
  await sendOk(thread.first, { type: "job.there", job });
  await sendOk(thread.first, { type: "job.done", job, outcome: "done" });
  await expect(resident.getByText("Done", { exact: true })).toBeVisible();
};

const deskAddsFood = async (thread: Thread): Promise<string> => {
  const { desk, resident } = thread;
  await jobRow(desk, SNOW).getByRole("button", { name: "Add a need" }).click();
  await desk.getByRole("dialog").getByRole("button", { name: FOOD }).click();
  const food = jobRow(desk, FOOD);
  await food.getByRole("button", { name: "Approve plan" }).click();
  await expect(food.getByRole("button", { name: "Approve plan" })).toBeHidden();
  await expect(food.getByRole("alert")).toHaveCount(0);
  await resident.getByRole("button", { name: "Yes, share" }).click();
  await food.getByRole("button", { name: "Copy partner link" }).click();
  await expect(food.getByText("Copied")).toBeVisible();
  return desk.evaluate(() => navigator.clipboard.readText());
};

const partnerTakesFood = async (browser: Browser, thread: Thread, link: string): Promise<void> => {
  const partner = await (await browser.newContext()).newPage();
  await partner.goto(link);
  await expect(partner.getByText(FOOD)).toBeVisible();
  await partner.getByRole("button", { name: "Yes, we can take it" }).click();
  await partner.getByRole("button", { name: "Send answer" }).click();
  await partner.getByRole("button", { name: "I accept this promise" }).click();
  await expect(partner.getByText("Dana", { exact: true })).toBeVisible();
  await partner.getByLabel("Who will contact them?").fill("Pat Pantry (test)");
  await partner.getByLabel("When will you contact them?").fill("2026-11-22");
  await partner.getByRole("button", { name: "Confirm got it" }).click();
  await expect(partner.getByText("GOT IT is recorded. You hold this request now.")).toBeVisible();
  await expect(jobRow(thread.desk, FOOD)).toContainText("Northside Pantry (test)");
  await expect(thread.resident.getByText("Northside Pantry (test) has it")).toBeVisible();
};

const jumpThreeDays = async (org: Page, count: number): Promise<void> => {
  await org.getByRole("tab", { name: "Settings" }).click();
  await org.getByRole("button", { name: "+3 days" }).click();
  await expect(org.getByText("Demo jump +3 days")).toHaveCount(count);
};

const mismatchAndOfferAgain = async (thread: Thread): Promise<string> => {
  const { desk, resident } = thread;
  await askFor(resident, SNOW).getByRole("button", { name: "No" }).click();
  const snow = jobRow(desk, SNOW);
  await expect(snow).toContainText("Mismatch");
  await askFor(resident, FOOD).getByRole("button", { name: "Yes" }).click();
  await expect(askFor(resident, FOOD)).toBeHidden();
  await snow.getByRole("button", { name: "Send to new volunteer" }).click();
  const job = await waitForOffer(thread.second);
  expect(await offers(thread.first)).not.toContain(job);
  await sendOk(thread.second, { type: "offer.accept", job });
  await sendOk(thread.second, { type: "job.on_my_way", job });
  await sendOk(thread.second, { type: "job.there", job });
  await sendOk(thread.second, { type: "job.done", job, outcome: "done" });
  return job;
};

const statementBalances = async (org: Page): Promise<void> => {
  await org.getByRole("tab", { name: "Statement" }).click();
  await org.getByRole("button", { name: "Load again" }).click();
  const panel = org.getByRole("tabpanel", { name: "Statement" });
  await expect(panel.getByText("BALANCES")).toBeVisible();
  await expect(
    panel.getByText(/= Helped 2 \+ Unmet 0 \+ Unreached 0 \+ Withdrawn 0 \+ Still open 0/),
  ).toBeVisible();
  const wrong = panel.getByRole("table", { name: "What went wrong" });
  await expect(
    wrong
      .getByRole("row", { name: /Mismatch answers/ })
      .getByRole("cell")
      .nth(1),
  ).toHaveText("1");
  const seal = panel.getByRole("region", { name: "Seal check" });
  await seal.getByRole("button", { name: "Check the seal" }).click();
  await expect(seal.getByRole("status")).toContainText(/The seal holds for all \d+ lines\./);
};

const startThread = async (browser: Browser): Promise<Thread & { tracking: string }> => {
  const bootstrapCode = process.env.E2E_BOOTSTRAP_CODE ?? "";
  const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
  const { codes } = await seedOrg({ fetcher, base: HUB, org: ORG, bootstrapCode });
  const resident = await (await browser.newContext()).newPage();
  const tracking = await residentAsks(resident);
  const desk = await staffPage(browser, codeOf(codes, "Morgan Desk (test)"), /\/desk$/);
  const first = await joinApi(codes, "Avery Snow (test)");
  const second = await joinApi(codes, "Blake Frost (test)");
  return { codes, resident, desk, first, second, tracking };
};

test("the demo thread runs from a request to a balanced statement and a sound seal", async ({ browser }) => {
  const thread = await startThread(browser);
  await deskConfirms(thread.desk);
  const job = await firstAcceptWins(thread);
  await volunteerFinishes(thread, job, thread.tracking);
  const partnerLink = await deskAddsFood(thread);
  await partnerTakesFood(browser, thread, partnerLink);
  const org = await staffPage(browser, codeOf(thread.codes, "Quinn Organiser (test)"), /\/org$/);
  await jumpThreeDays(org, 1);
  await mismatchAndOfferAgain(thread);
  await jumpThreeDays(org, 2);
  await askFor(thread.resident, SNOW).getByRole("button", { name: "Yes" }).click();
  await expect(askFor(thread.resident, SNOW)).toBeHidden();
  await statementBalances(org);
});
