import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { codeOf } from "./lib.mjs";
import { ORG } from "./hub.mjs";
import { PHONES, hold, screencap, tap, waitText } from "./phone.mjs";
import { joinWeb, pageShot, press, typeSlowly } from "./web.mjs";

const SNOW = "Snow shovelling";
const FOOD = "Food from a pantry";
const ZIP = "53216";
const [A, B] = PHONES.map((p) => p.serial);
const LABEL = {
  ask: "Resident: request form",
  track: "Resident: tracking page",
  desk: "Desk board",
  partner: "Partner card",
  statement: "Organiser: monthly statement",
  playbook: "Organiser: playbook",
};

function cut(run, view, label, caption) {
  run.cuts.push({ at: Date.now(), view, label, caption });
  console.log(`media: ${caption}`);
}

const mark = (run, name) => {
  run.marks[name] = Date.now();
};
const cropOf = async (name, area) => {
  try {
    return await area();
  } catch (error) {
    console.log(
      `media: ${name} keeps the full window, because its crop failed: ${error.message.split("\n")[0]}`,
    );
    return null;
  }
};
export const shot = async (run, view, name, area = null) => {
  const { page } = run.views[view];
  run.boxes[name] = area === null ? null : await cropOf(name, area);
  await pageShot(page, join(run.raw, name));
};
const boxOf = (locator) => () => locator.boundingBox({ timeout: 5000 });
const fixed = (box) => () => Promise.resolve(box);
export const span = (top, bottom) => async () => {
  const [a, b] = [await top.boundingBox({ timeout: 5000 }), await bottom.boundingBox({ timeout: 5000 })];
  return { x: a.x, y: a.y, width: a.width, height: b.y + b.height - a.y };
};
const phoneShot = (run, serial, name) => screencap(serial, join(run.raw, name));
const row = (page, need) => page.getByRole("row", { name: new RegExp(need, "u") });

async function setUp(run) {
  const { desk, org, resident } = run.views;
  await joinWeb(org.page, codeOf(run.codes, "Quinn Organiser (test)"), /\/org$/u);
  await joinWeb(desk.page, codeOf(run.codes, "Morgan Desk (test)"), /\/desk$/u);
  await press(desk.page.getByRole("button", { name: "Take shift" }));
  await press(
    desk.page.getByRole("dialog", { name: "Take the shift" }).getByRole("button", { name: "Confirm" }),
  );
  await desk.page.getByText("No cards to read").waitFor();
  await resident.page.goto(`/${ORG}/ask`);
  await resident.page.getByLabel("What do you need?").waitFor();
  await sleep(1500);
}

async function jump(run, label) {
  const { page } = run.views.org;
  await page.goto(`/${ORG}/org`);
  await press(page.getByRole("tab", { name: "Settings" }));
  await press(page.getByRole("button", { name: label }));
  await page.getByText(`Demo jump ${label}`).first().waitFor();
}

async function ask(run) {
  const { page } = run.views.resident;
  cut(run, "resident", LABEL.ask, "A resident who cannot clear the snow asks for help on the website.");
  const need = "My front steps and walk are under snow from the storm. Could someone shovel them this week?";
  await typeSlowly(page.getByLabel("What do you need?"), need, 30);
  await typeSlowly(page.getByLabel("Your first name"), "Dana", 60);
  await typeSlowly(page.getByLabel("How can we reach you?"), "dana.resident@example.test", 25);
  await typeSlowly(page.getByLabel("ZIP code"), ZIP, 80);
  await typeSlowly(page.getByLabel("Your address"), "100 Test Street", 40);
  await press(page.getByText("Yes", { exact: true }));
  cut(run, "resident", LABEL.ask, "She needs no account and no app. She presses Send request.");
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await sleep(1500);
  await shot(run, "resident", "ask.png", boxOf(page.locator('section[aria-labelledby="ask-title"]')));
  const send = page.getByRole("button", { name: "Send request" });
  await send.scrollIntoViewIfNeeded();
  await sleep(1500);
  await press(send);
  await page.getByRole("heading", { name: "We have your request" }).waitFor();
  mark(run, "sent");
  cut(run, "resident", LABEL.ask, "She gets a request code and a tracking link at once.");
  run.track = await page.getByRole("link", { name: /\/t\//u }).getAttribute("href");
  await sleep(4000);
}

export async function waitSorted(card) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    if (!(await card.innerText()).includes("Not sorted")) return;
    await sleep(1000);
  }
  throw new Error("The AI sorter did not answer in 2 minutes. Run npx wrangler login, then try again.");
}

export async function pickNeed(panel, need) {
  const change = panel.getByRole("button", { name: "Change" });
  if (await change.isVisible()) {
    if (await panel.getByText(need, { exact: true }).isVisible()) return;
    await press(change);
  }
  await press(panel.getByRole("radio", { name: need }));
}

async function triage(run) {
  const { page } = run.views.desk;
  cut(run, "desk", LABEL.desk, "The request reaches the desk board in real time, in the Triage lane.");
  const card = page.getByRole("region", { name: "Triage lane" }).getByRole("button", { name: /53216/u });
  await card.waitFor();
  mark(run, "triage");
  await waitSorted(card);
  await sleep(1500);
  await press(card);
  cut(run, "desk", LABEL.desk, "The AI sorter suggests the need and the urgency. A person decides.");
  const panel = page.getByRole("region", { name: `Request from ZIP ${ZIP}` });
  await panel.getByRole("region", { name: "Sorter labels" }).getByText(/^AI: /u).waitFor();
  mark(run, "sorted");
  await sleep(4000);
  cut(
    run,
    "desk",
    LABEL.desk,
    "The desk reads the words of the resident and confirms the need and the urgency.",
  );
  await pickNeed(panel, SNOW);
  await sleep(1000);
  await press(panel.getByRole("group", { name: "Urgency" }).getByRole("button", { name: "Low" }));
  await sleep(2500);
  await press(panel.getByRole("button", { name: "Confirm" }));
  await row(page, SNOW).getByRole("button", { name: "Approve plan" }).waitFor();
  await sleep(2500);
}

async function offer(run) {
  const { page } = run.views.desk;
  cut(run, "desk", LABEL.desk, "The desk approves the plan. The hub offers the job to nearby volunteers.");
  await sleep(1500);
  mark(run, "approve");
  await press(row(page, SNOW).getByRole("button", { name: "Approve plan" }));
  await waitText(A, /^ACCEPT$/u);
  await waitText(B, /^ACCEPT$/u);
  cut(run, "desk", LABEL.desk, "Both volunteer phones get the offer at the same moment.");
  await sleep(1500);
  phoneShot(run, A, "phone-offer-a.png");
  phoneShot(run, B, "phone-offer-b.png");
  await sleep(3000);
  cut(
    run,
    "desk",
    LABEL.desk,
    "Phone A accepts first. The first accept wins, and phone B hears that the job is taken.",
  );
  mark(run, "accept");
  await tap(A, /^ACCEPT$/u);
  await waitText(B, /Taken/u, 8000);
  phoneShot(run, B, "phone-taken-b.png");
  await tap(A, new RegExp(`^${SNOW}$`, "u"));
  await waitText(A, /ON MY WAY/u);
  phoneShot(run, A, "phone-job-a.png");
  await sleep(4000);
}

async function visit(run) {
  const { page } = run.views.resident;
  await page.goto(run.track);
  cut(run, "resident", LABEL.track, "Her tracking page updates live. A volunteer has the job.");
  await page.getByText("A volunteer has it").first().waitFor();
  await sleep(4000);
  cut(run, "resident", LABEL.track, "Avery taps ON MY WAY, then I AM THERE. The page follows each step.");
  mark(run, "onway");
  await tap(A, /ON MY WAY/u);
  await sleep(5000);
  await tap(A, /I AM THERE|^THERE$/u);
  await waitText(A, /DONE/u);
  await sleep(3000);
  cut(
    run,
    "desk",
    LABEL.desk,
    "The desk sees the holder and the visit clock. One holder, hand to hand, never dropped.",
  );
  await sleep(2000);
  await shot(run, "desk", "desk-board.png", fixed({ x: 0, y: 40, width: 1080, height: 200 }));
  await sleep(3000);
}

async function done(run) {
  cut(run, "desk", LABEL.desk, "The demo clock jumps 15 minutes. Avery holds DONE and sends Done as asked.");
  await jump(run, "+15 min");
  await sleep(1500);
  mark(run, "done");
  await hold(A, /^DONE$/u);
  await tap(A, /DONE AS ASKED/iu);
  await sleep(1200);
  await tap(A, /^SEND$/u);
  await sleep(3000);
  const { page } = run.views.resident;
  cut(run, "resident", LABEL.track, "Done. The resident sees each step with its time.");
  await page.getByText("Done", { exact: true }).first().waitFor();
  mark(run, "tracked");
  await sleep(2000);
  await shot(run, "resident", "track.png", boxOf(page.locator('section[aria-labelledby="track-title"]')));
  await sleep(3000);
}

async function addFood(run) {
  const { page } = run.views.desk;
  cut(
    run,
    "desk",
    LABEL.desk,
    "She also needs food. The desk adds the need, and the playbook sends it to a partner pantry.",
  );
  await sleep(2000);
  await press(row(page, SNOW).getByRole("button", { name: "Add a need" }));
  await sleep(1200);
  await press(page.getByRole("dialog").getByRole("button", { name: FOOD }));
  await row(page, FOOD).getByRole("button", { name: "Approve plan" }).waitFor();
  await sleep(2000);
  await press(row(page, FOOD).getByRole("button", { name: "Approve plan" }));
  await row(page, FOOD).getByRole("button", { name: "Approve plan" }).waitFor({ state: "hidden" });
  await sleep(3000);
  const track = run.views.resident.page;
  cut(run, "resident", LABEL.track, "Vision asks the resident before it shares anything with the partner.");
  const share = track.getByRole("button", { name: "Yes, share" });
  await share.waitFor();
  await share.scrollIntoViewIfNeeded();
  await sleep(3500);
  await press(share);
  await sleep(2500);
}

async function partnerLink(run) {
  const { page } = run.views.desk;
  const copy = row(page, FOOD).getByRole("button", { name: "Copy partner link" });
  await press(copy);
  await row(page, FOOD).getByText("Copied").waitFor();
  return page.evaluate(() => globalThis.navigator.clipboard.readText());
}

async function partner(run) {
  const { page } = run.views.partner;
  await page.goto(await partnerLink(run));
  cut(
    run,
    "partner",
    LABEL.partner,
    "The pantry sees the need and the ZIP code. It sees her name only after it says yes.",
  );
  await page.getByText(FOOD).first().waitFor();
  mark(run, "partner");
  await sleep(2500);
  await shot(run, "partner", "partner.png", boxOf(page.locator("main section").first()));
  await sleep(2500);
  cut(run, "partner", LABEL.partner, "The pantry says yes, accepts the promise and confirms GOT IT.");
  await press(page.getByRole("button", { name: "Yes, we can take it" }));
  await press(page.getByRole("button", { name: "Send answer" }));
  await sleep(1500);
  await press(page.getByRole("button", { name: "I accept this promise" }));
  await page.getByText("Dana", { exact: true }).waitFor();
  await sleep(1500);
  await typeSlowly(page.getByLabel("Who will contact them?"), "Pat Pantry (test)", 40);
  const tomorrow = new Date(Date.now() + 86400000);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}`;
  await page
    .getByLabel("When will you contact them?")
    .fill(`${day}-${String(tomorrow.getDate()).padStart(2, "0")}`);
  await sleep(1000);
  await press(page.getByRole("button", { name: "Confirm got it" }));
  await page.getByText("GOT IT is recorded. You hold this request now.").waitFor();
  await sleep(3500);
}

async function answer(page, need) {
  const region = page.getByRole("region", { name: "Did they help?" }).filter({ hasText: need });
  const found = await region
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!found) return false;
  await region.scrollIntoViewIfNeeded();
  await sleep(3000);
  await press(region.getByRole("button", { name: "Yes" }));
  await region.waitFor({ state: "hidden" });
  await sleep(2000);
  return true;
}

async function checkBack(run) {
  const { page } = run.views.resident;
  cut(
    run,
    "resident",
    LABEL.track,
    "The demo clock jumps 3 days. Vision asks her: did they help? Only she can close her request.",
  );
  await jump(run, "+3 days");
  await page.reload();
  mark(run, "checkback");
  if (!(await answer(page, SNOW))) throw new Error("The check-back for the snow job did not show.");
  run.foodAnswered = await answer(page, FOOD);
}

async function statement(run) {
  const { page } = run.views.org;
  await page.goto(`/${ORG}/org`);
  await press(page.getByRole("tab", { name: "Statement" }));
  await press(page.getByRole("button", { name: "Load again" }));
  await page.getByText("BALANCES").first().waitFor();
  cut(run, "org", LABEL.statement, "The monthly statement accounts for every request. It balances.");
  mark(run, "statement");
  await sleep(2500);
  await shot(run, "org", "statement.png", fixed({ x: 212, y: 60, width: 800, height: 420 }));
  await sleep(2500);
  cut(
    run,
    "org",
    LABEL.statement,
    "The browser checks the seal on every ledger line again. No line changed after it was written.",
  );
  await press(page.getByRole("button", { name: "Check the seal" }));
  await page.getByText(/The seal holds for all \d+ lines/u).waitFor();
  mark(run, "seal");
  await page.getByText(/The seal holds for all \d+ lines/u).scrollIntoViewIfNeeded();
  await sleep(2500);
  const record = page.getByRole("heading", { name: "Record" });
  const sealBox = span(record, page.getByRole("region", { name: "Seal check" }));
  await shot(run, "org", "seal.png", async () => ({ ...(await sealBox()), width: 940 }));
  await sleep(3000);
}

async function playbook(run) {
  const { page } = run.views.org;
  await press(page.getByRole("tab", { name: "Playbook" }));
  cut(
    run,
    "org",
    LABEL.playbook,
    "The playbook from ComForce sets the owner, the path and the promise time for each need.",
  );
  await sleep(2500);
  await shot(run, "org", "org.png", boxOf(page.getByRole("table", { name: "Playbook" })));
  await sleep(3500);
}

export async function runThread(run) {
  await setUp(run);
  run.t0 = Date.now();
  for (const step of [ask, triage, offer, visit, done, addFood, partner, checkBack, statement, playbook]) {
    await step(run);
  }
  run.end = Date.now();
}
