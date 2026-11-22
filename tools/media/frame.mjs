import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LAYOUT } from "./edit.mjs";

const COLORS = {
  ground: "#111316",
  panel: "#1b1e22",
  line: "#2c3036",
  text: "#ecebe6",
  dim: "#9a9ea6",
  amber: "#f2b01e",
};

const escapeHtml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function fontFaces(root) {
  const dir = join(root, "apps/web/public/fonts");
  const face = (family, file, weight) =>
    `@font-face{font-family:"${family}";font-weight:${weight};src:url("${pathToFileURL(join(dir, file)).href}") format("woff2")}`;
  return [
    face("Plex", "ibm-plex-sans-latin-400-normal.woff2", 400),
    face("Plex", "ibm-plex-sans-latin-500-normal.woff2", 500),
    face("Plex", "ibm-plex-sans-latin-600-normal.woff2", 600),
    face("Plex Cond", "ibm-plex-sans-condensed-latin-600-normal.woff2", 600),
    face("Plex Mono", "ibm-plex-mono-latin-500-normal.woff2", 500),
  ].join("");
}

function baseCss(root) {
  const c = COLORS;
  return `${fontFaces(root)}
*{box-sizing:border-box;margin:0}
body{background:${c.ground};color:${c.text};font-family:Plex,sans-serif;overflow:hidden}
.box{position:absolute;background:${c.panel};border:1px solid ${c.line};border-radius:10px}
.label{position:absolute;font:600 19px/1 "Plex Cond",sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${c.dim}}
.label b{color:${c.amber};font-weight:600;margin-right:10px}
.brand{font:600 30px/1 "Plex Cond",sans-serif;letter-spacing:.14em;color:${c.amber}}
.sub{font:500 21px/1.3 Plex,sans-serif;color:${c.dim}}
.mono{font-family:"Plex Mono",monospace}`;
}

const box = (r) => `left:${r.x - 1}px;top:${r.y - 1}px;width:${r.w + 2}px;height:${r.h + 2}px`;
const labelAt = (r, inner) => `<div class="label" style="left:${r.x}px;top:${r.y - 34}px">${inner}</div>`;

function compositeBody(seg, index, total) {
  const { left, phoneA, phoneB } = LAYOUT;
  const step = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  return `
<div style="position:absolute;left:55px;right:55px;top:30px;display:flex;align-items:baseline;gap:22px">
  <span class="brand">VISION</span><span class="sub">One request, from the web form to the monthly statement</span>
  <span class="sub" style="margin-left:auto">The real system, run end to end with synthetic people</span></div>
<div class="box" style="${box(left)}"></div><div class="box" style="${box(phoneA)}"></div><div class="box" style="${box(phoneB)}"></div>
${labelAt(left, `<b>Web</b>${escapeHtml(seg.label)}`)}
${labelAt(phoneA, "<b>Phone A</b>Avery Snow (test)")}
${labelAt(phoneB, "<b>Phone B</b>Blake Frost (test)")}
<div style="position:absolute;left:55px;right:55px;top:${LAYOUT.captionTop}px;height:120px;display:flex;align-items:center;gap:28px;border-top:1px solid ${COLORS.line};padding-top:8px">
  <span class="mono" style="font-size:24px;color:${COLORS.amber};white-space:nowrap">${step}</span>
  <span style="font:500 33px/1.3 Plex,sans-serif">${escapeHtml(seg.caption)}</span></div>
<div class="sub" style="position:absolute;right:55px;bottom:22px;font-size:17px">Hacksgiving 2026, Team KanyaRaasi</div>`;
}

function page(root, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss(root)}</style></head><body>${body}</body></html>`;
}

async function render(browser, html, file, size, scale) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: scale });
  const tab = await context.newPage();
  const source = `${file}.html`;
  writeFileSync(source, html);
  await tab.goto(pathToFileURL(source).href);
  await tab.evaluate(() => globalThis.document.fonts.ready);
  await tab.screenshot({ path: file });
  await context.close();
}

export async function renderFrames(browser, root, segs, dir) {
  const files = [];
  for (const [i, seg] of segs.entries()) {
    const file = join(dir, `frame-${String(i).padStart(2, "0")}.png`);
    await render(
      browser,
      page(root, compositeBody(seg, i, segs.length)),
      file,
      { width: 1920, height: 1080 },
      1,
    );
    files.push(file);
  }
  return files;
}

function phoneCard(src, title, name) {
  return `<figure style="display:flex;flex-direction:column;align-items:center;gap:18px">
  <img src="${pathToFileURL(src).href}" style="height:740px;border-radius:34px;border:6px solid #2c3036;display:block">
  <figcaption class="label" style="position:static"><b>${title}</b>${escapeHtml(name)}</figcaption></figure>`;
}

export async function renderPhones(browser, root, phones, file) {
  const cards = phones.map((p) => phoneCard(p.src, p.title, p.name)).join("");
  const body = `<div style="height:900px;display:flex;justify-content:center;align-items:center;gap:150px">${cards}</div>`;
  await render(browser, page(root, body), file, { width: 1440, height: 900 }, 2);
}
