import { createRequire } from "node:module";
import { join } from "node:path";
import { BASE, ORG } from "./hub.mjs";

export const VIEWPORT = { width: 1440, height: 900 };

export function loadChromium(root) {
  const require = createRequire(join(root, "apps/web/package.json"));
  return require("@playwright/test").chromium;
}

export async function openView(browser, videoDir) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    permissions: ["clipboard-read", "clipboard-write"],
    recordVideo: { dir: videoDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  return { context, page, start: Date.now() };
}

export async function closeView(view) {
  const video = view.page.video();
  await view.context.close();
  return video === null ? null : video.path();
}

export async function press(locator) {
  await locator.waitFor();
  await locator.evaluate((el) => el.click());
}

export async function typeSlowly(locator, text, delay = 35) {
  await locator.waitFor();
  await locator.pressSequentially(text, { delay });
}

export async function joinWeb(page, code, home) {
  await page.goto(`/${ORG}/join`);
  await page.getByLabel("Join code").fill(code);
  await press(page.getByRole("button", { name: "Join" }));
  await page.waitForURL(home);
}

export async function pageShot(page, file) {
  await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
}
