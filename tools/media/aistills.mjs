import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { ORG } from "./hub.mjs";
import { shot, span, waitSorted } from "./thread.mjs";
import { press } from "./web.mjs";

const VOICEMAIL = fileURLToPath(new URL("../../data/synthetic/voicemail-demo.mp3", import.meta.url));
const URGENT = {
  zip: "53210",
  name: "Lee",
  need: "My mother is 84 and on oxygen. Deep snow blocks her ramp, and she cannot get out to her dialysis ride on Monday.",
};
const TREE_A = {
  zip: "53206",
  name: "Sam",
  need: "A big tree fell across the alley behind our block. It blocks the garages and pulled a wire down.",
};
const TREE_B = {
  zip: "53206",
  name: "Rae",
  need: "It pulled a wire down and blocks the garages. A big tree fell across the alley behind our block.",
};
const SPANISH = {
  zip: "53204",
  name: "Rosa",
  need: "Necesito ayuda con la nieve en la entrada de mi casa. Tengo 79 años y no puedo salir a la tienda.",
};

const lanes = (page) =>
  page.locator('section[aria-label="Emergency lane"], section[aria-label="Triage lane"]');
const rowFor = (page, zip) =>
  lanes(page)
    .getByRole("button", { name: new RegExp(zip, "u") })
    .first();
const panelFor = (page, zip) => page.getByRole("region", { name: `Request from ZIP ${zip}` });

async function closeAlerts(page) {
  const gotIt = page.getByRole("button", { name: "Got it" });
  for (let i = 0; i < 5 && (await gotIt.isVisible()); i += 1) {
    await press(gotIt.first());
    await sleep(800);
  }
}

async function sendRequest(page, request) {
  await page.goto(`/${ORG}/ask`);
  await page.getByLabel("What do you need?").fill(request.need);
  await page.getByLabel("Your first name").fill(request.name);
  await page.getByLabel("How can we reach you?").fill(`${request.name.toLowerCase()}.resident@example.test`);
  await page.getByLabel("ZIP code").fill(request.zip);
  await press(page.getByText("Yes", { exact: true }));
  await press(page.getByRole("button", { name: "Send request" }));
  await page.getByRole("heading", { name: "We have your request" }).waitFor();
}

async function openSorted(page, zip) {
  const row = rowFor(page, zip);
  await row.waitFor({ timeout: 120000 });
  await waitSorted(row);
  await sleep(1500);
  await closeAlerts(page);
  await press(row);
  const panel = panelFor(page, zip);
  await panel.getByRole("region", { name: "Sorter labels" }).getByText(/^AI: /u).waitFor();
  await sleep(1500);
  await closeAlerts(page);
  return panel;
}

async function askSpanish(run) {
  const { page } = run.views.resident;
  await page.goto(`/${ORG}/ask`);
  await press(page.getByText("Español", { exact: true }));
  await page.getByLabel("¿Qué necesita?").fill(SPANISH.need);
  await page.getByLabel("Su nombre").fill(SPANISH.name);
  await page.getByLabel("¿Cómo podemos comunicarnos con usted?").fill("rosa.resident@example.test");
  await page.getByLabel("Código postal (ZIP)").fill(SPANISH.zip);
  await press(page.getByText("Sí", { exact: true }));
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await sleep(1500);
  await shot(run, "resident", "ask-spanish.png", () =>
    page.locator('section[aria-labelledby="ask-title"]').boundingBox({ timeout: 5000 }),
  );
  console.log("media: ask-spanish.png shows the ask form in Spanish");
}

async function deskCard(run) {
  const desk = run.views.desk.page;
  await sendRequest(run.views.resident.page, URGENT);
  const panel = await openSorted(desk, URGENT.zip);
  await panel.getByRole("region", { name: "Words of the resident" }).locator("mark").first().waitFor();
  await shot(run, "desk", "desk-card.png", span(panel, panel.getByRole("button", { name: "Confirm" })));
  console.log("media: desk-card.png shows the AI suggestion and the marked words");
}

async function voicemail(run) {
  const page = run.views.desk.page;
  await press(page.getByRole("button", { name: "Add a voicemail" }));
  const dialog = page.getByRole("dialog", { name: "Add a voicemail" });
  await dialog.getByLabel("Audio file").setInputFiles(VOICEMAIL);
  await dialog.getByLabel("Callback number (optional)").fill("414-555-0177");
  await dialog.getByLabel("ZIP code (optional)").fill("53212");
  await press(dialog.getByRole("button", { name: "Add" }));
  await dialog.waitFor({ state: "hidden" });
  const panel = await openSorted(page, "53212");
  await panel.getByText("Transcript by speech AI. Listen before you confirm.").waitFor();
  await panel.getByLabel("Voicemail recording").waitFor();
  await shot(run, "desk", "voicemail.png", span(panel, panel.getByRole("region", { name: "Sorter labels" })));
  console.log("media: voicemail.png shows the recording, the transcript and the flags");
}

async function sameEvent(run) {
  const desk = run.views.desk.page;
  const resident = run.views.resident.page;
  await sendRequest(resident, TREE_A);
  await waitSorted(rowFor(desk, TREE_A.zip));
  await sendRequest(resident, TREE_B);
  const marked = lanes(desk)
    .getByRole("button", { name: /Same event\?/u })
    .first();
  await marked.waitFor({ timeout: 120000 });
  await waitSorted(marked);
  await sleep(1500);
  await closeAlerts(desk);
  await press(marked);
  const panel = panelFor(desk, TREE_A.zip);
  const section = panel.getByRole("region", { name: "Same event?" });
  await section.getByRole("button", { name: "Not the same" }).waitFor();
  await sleep(1500);
  const words = panel.getByRole("region", { name: "Words of the resident" });
  await shot(run, "desk", "same-event.png", span(words, section));
  console.log("media: same-event.png shows the Same event? proposal");
}

export async function runAiStills(run) {
  for (const step of [askSpanish, deskCard, voicemail, sameEvent]) await step(run);
}
