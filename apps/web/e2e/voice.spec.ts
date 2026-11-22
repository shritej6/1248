import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedOrg } from "../../hub/scripts/seed.js";

const ORG = "comforce-voice";
const HUB = process.env.E2E_HUB_URL ?? "http://localhost:8799";
const DEMO = fileURLToPath(new URL("../../../data/synthetic/voicemail-demo.mp3", import.meta.url));
const GIST = "Snow on the front walk. Gas smell in the kitchen since last night.";

const deskPage = async (browser: Browser): Promise<Page> => {
  const bootstrapCode = process.env.E2E_BOOTSTRAP_CODE ?? "";
  const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
  const { codes } = await seedOrg({ fetcher, base: HUB, org: ORG, bootstrapCode });
  const code = codes.find((c) => c.name === "Morgan Desk (test)")?.code;
  if (code === undefined) throw new Error("The seed gave no join code for the desk.");
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/${ORG}/join`);
  await page.getByLabel("Join code").fill(code);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL(/\/desk$/);
  return page;
};

const addVoicemail = async (desk: Page): Promise<void> => {
  await desk.getByRole("button", { name: "Add a voicemail" }).click();
  const dialog = desk.getByRole("dialog", { name: "Add a voicemail" });
  await dialog.getByLabel("Audio file").setInputFiles(DEMO);
  await dialog.getByLabel("Callback number (optional)").fill("414-555-0177");
  await dialog.getByLabel("ZIP code (optional)").fill("53216");
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();
};

test("with the models off the desk adds a voicemail, types the gist and confirms it", async ({ browser }) => {
  const desk = await deskPage(browser);
  await desk.getByRole("button", { name: "Take shift" }).click();
  await desk.getByRole("dialog", { name: "Take the shift" }).getByRole("button", { name: "Confirm" }).click();
  await addVoicemail(desk);
  await desk.getByRole("region", { name: "Triage lane" }).getByRole("button", { name: /53216/ }).click();
  const panel = desk.getByRole("region", { name: "Request from ZIP 53216" });
  const voicemail = panel.getByRole("region", { name: "Voicemail" });
  await expect(voicemail.getByText("Listen to the voicemail", { exact: true })).toBeVisible();
  await expect(voicemail.getByLabel("Voicemail recording")).toHaveAttribute("src", /^blob:/);
  await expect(panel.getByText("Voicemail", { exact: true })).toBeVisible();
  await voicemail.getByLabel("Type the gist").fill(GIST);
  await voicemail.getByRole("button", { name: "Save the gist" }).click();
  await desk.getByRole("button", { name: "Got it" }).click();
  await expect(desk.getByRole("button", { name: "Got it" })).toBeHidden();
  await expect(panel.getByRole("region", { name: "Words of the resident" })).toContainText("Gas smell");
  await expect(panel.getByText("Word list hit")).toBeVisible();
  await expect(panel.getByText("Voicemail. A person must confirm it.")).toBeVisible();
  await expect(voicemail.getByRole("button", { name: "Save the gist" })).toBeHidden();
  await panel.getByRole("radio", { name: "Snow shovelling" }).check({ force: true });
  await panel.getByRole("group", { name: "Urgency" }).getByRole("button", { name: "High" }).click();
  await panel.getByRole("button", { name: "Confirm" }).click();
  await expect(desk.getByRole("row", { name: /Snow shovelling/ })).toBeVisible();
});
