import { expect, test, type Browser, type Page } from "@playwright/test";
import { seedOrg } from "../../hub/scripts/seed.js";

const ORG = "comforce-resources";
const HUB = process.env.E2E_HUB_URL ?? "http://localhost:8799";
const POLL_BUDGET_MS = 60_000;
const DEMO_NOTICE =
  /^Demo mode\. The forecast uses \d+ months of synthetic history\. Funder facts are real and were checked on \d{1,2} [A-Z][a-z]+ \d{4}\.$/;

const organiserPage = async (browser: Browser): Promise<Page> => {
  const bootstrapCode = process.env.E2E_BOOTSTRAP_CODE ?? "";
  const fetcher = (url: string, init?: RequestInit) => fetch(url, init);
  const { codes } = await seedOrg({ fetcher, base: HUB, org: ORG, bootstrapCode });
  const code = codes.find((c) => c.name === "Quinn Organiser (test)")?.code;
  if (code === undefined) throw new Error("The seed gave no join code for the organiser.");
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  await page.goto(`/${ORG}/join`);
  await page.getByLabel("Join code").fill(code);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL(/\/org$/);
  return page;
};

test("with the models off the organiser writes the impact post, approves it and copies it", async ({
  browser,
}) => {
  const org = await organiserPage(browser);
  await org.getByRole("tab", { name: "Resources" }).click();
  await expect(org.getByText(DEMO_NOTICE)).toBeVisible();
  await expect(org.getByRole("img", { name: /^Likely jobs for each month, / })).toBeVisible();
  await org.getByRole("button", { name: "Write the impact post" }).click();
  const card = org.getByRole("article", { name: /^Impact post, / });
  await expect(card.getByText("Ready to approve")).toBeVisible({ timeout: POLL_BUDGET_MS });
  await expect(card.getByText("AI is off, so this is the fixed template.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Copy text" })).toBeHidden();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.getByText("Approved", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Copy text" }).click();
  await expect(card.getByText("Copied", { exact: true })).toBeVisible();
});
