import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const require = createRequire(join(ROOT, "apps/web/package.json"));
const { chromium } = require("@playwright/test");

const HOST = "http://vision.local/";
const WIDTH = 1600;
const SCALE = 2;
const DIAGRAMS = [
  { source: "docs/media/src/thread.html", out: "docs/media/diagram-thread.png" },
  { source: "docs/media/src/systems.html", out: "docs/media/diagram-systems.png" },
  { source: "docs/media/src/ai.html", out: "docs/media/diagram-ai.png" },
];
const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
]);
const FAMILIES = [
  '600 16px "IBM Plex Sans"',
  '600 16px "IBM Plex Sans Condensed"',
  '500 16px "IBM Plex Mono"',
];

class DiagramError extends Error {
  name = "DiagramError";
}

const localPath = (url) => {
  const path = normalize(decodeURIComponent(new URL(url).pathname)).replace(/^\/+/u, "");
  const full = resolve(ROOT, path);
  if (!full.startsWith(ROOT)) throw new DiagramError(`Path leaves the repository: ${url}`);
  return full;
};

const serveRepo = async (route) => {
  const full = localPath(route.request().url());
  const type = TYPES.get(extname(full));
  if (type === undefined) return route.fulfill({ status: 404, body: "not served" });
  try {
    return route.fulfill({ status: 200, contentType: type, body: await readFile(full) });
  } catch (error) {
    if (error.code === "ENOENT") return route.fulfill({ status: 404, body: "missing" });
    throw error;
  }
};

const checkFonts = async (page, source) => {
  const missing = await page.evaluate(async (families) => {
    const { fonts } = globalThis.document;
    await fonts.ready;
    return families.filter((f) => !fonts.check(f));
  }, FAMILIES);
  if (missing.length > 0) throw new DiagramError(`${source}: fonts did not load: ${missing.join(", ")}`);
};

const render = async (browser, { source, out }) => {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: SCALE });
  await page.route(`${HOST}**`, serveRepo);
  await page.goto(`${HOST}${source}`, { waitUntil: "networkidle" });
  await checkFonts(page, source);
  const frame = page.locator(".frame");
  const box = await frame.boundingBox();
  if (box === null || Math.round(box.width) !== WIDTH)
    throw new DiagramError(`${source}: frame is not ${WIDTH} px`);
  await frame.screenshot({ path: join(ROOT, out), animations: "disabled" });
  await page.close();
  console.log(`${out}: ${WIDTH * SCALE} x ${Math.round(box.height * SCALE)} px`);
};

const main = async () => {
  const browser = await chromium.launch();
  try {
    const wanted = process.argv.slice(2);
    const chosen = DIAGRAMS.filter((d) => wanted.length === 0 || wanted.some((w) => d.source.includes(w)));
    for (const diagram of chosen) await render(browser, diagram);
  } finally {
    await browser.close();
  }
};

await main();
