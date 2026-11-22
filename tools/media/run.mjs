import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGif, buildThread, compressStill, phoneStills } from "./compose.mjs";
import { buildWeb, seedHub, startHub, stopHub } from "./hub.mjs";
import { STILLS, clockText, codeOf, sizeText } from "./lib.mjs";
import {
  PHONES,
  SDK,
  bootPhones,
  cleanStatusBar,
  installApp,
  joinPhone,
  restoreStatusBar,
  startRecording,
  stopPhones,
  stopRecording,
} from "./phone.mjs";
import { cropBox } from "./edit.mjs";
import { runAiStills } from "./aistills.mjs";
import { runThread } from "./thread.mjs";
import { VIEWPORT, closeView, loadChromium, openView } from "./web.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = join(ROOT, "docs/media");
const APK = join(ROOT, "apps/android/app/build/outputs/apk/debug/app-debug.apk");
const WEB_STILLS = STILLS.filter((name) => !name.startsWith("phone"));

function buildApp(log) {
  const java = join(homedir(), "Library/Java/JavaVirtualMachines/corretto-17.0.13/Contents/Home");
  const env = { ...process.env };
  if (env.JAVA_HOME === undefined && existsSync(java)) env.JAVA_HOME = java;
  if (env.ANDROID_HOME === undefined) env.ANDROID_HOME = SDK;
  const out = openSync(log, "a");
  const cwd = join(ROOT, "apps/android");
  execFileSync("./gradlew", ["--quiet", "assembleDebug"], { cwd, env, stdio: ["ignore", out, out] });
}

async function prepare(state, run) {
  console.log("media: building the website and the app");
  buildWeb(ROOT, join(run.dir, "build.log"));
  buildApp(join(run.dir, "build.log"));
  console.log("media: starting the hub on port 8787 with a fresh state and live AI");
  state.hub = await startHub(ROOT, run.dir);
  run.codes = seedHub(ROOT, state.hub, run.dir);
  console.log("media: starting the phones");
  state.started = await bootPhones(run.dir);
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  for (const phone of PHONES) {
    installApp(phone.serial, APK);
    cleanStatusBar(phone.serial, hhmm);
    await joinPhone(phone.serial, codeOf(run.codes, phone.member));
  }
}

async function record(state, run) {
  const chromium = loadChromium(ROOT);
  state.browser = await chromium.launch();
  const videos = join(run.dir, "video");
  for (const name of ["resident", "desk", "org", "partner"]) {
    run.views[name] = await openView(state.browser, videos);
  }
  state.recordings = PHONES.map((p) => ({ ...startRecording(p.serial), id: p.id }));
  console.log("media: recording the thread");
  await runThread(run);
  console.log("media: making the stills of the AI parts");
  await runAiStills(run);
  for (const rec of state.recordings) {
    rec.file = join(run.dir, `phone-${rec.id}.mp4`);
    await stopRecording(rec, rec.file);
  }
  run.recordings = state.recordings;
  state.recordings = [];
  for (const view of Object.values(run.views)) {
    view.closed = Date.now();
    view.video = await closeView(view);
  }
}

async function produce(state, run) {
  mkdirSync(OUT, { recursive: true });
  console.log("media: making the stills");
  for (const name of WEB_STILLS) {
    const box = run.boxes[name] ?? null;
    const crop = box === null ? null : cropBox(box, 2, 16, VIEWPORT);
    compressStill(join(run.raw, name), join(OUT, name), run.log, crop);
  }
  await phoneStills(state.browser, ROOT, run, OUT);
  console.log("media: making thread.mp4");
  const thread = await buildThread(state.browser, ROOT, run, OUT);
  console.log("media: making thread.gif");
  buildGif(run, thread, OUT);
}

async function attempt(label, task) {
  try {
    await task();
  } catch (error) {
    console.error(
      `media: clean-up step "${label}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

async function cleanUp(state, run) {
  for (const rec of state.recordings) {
    await attempt(`stop phone ${rec.id}`, () => stopRecording(rec, join(run.dir, `phone-${rec.id}.mp4`)));
  }
  if (state.browser !== null) await attempt("close the browser", () => state.browser.close());
  await attempt("stop the hub", () => stopHub(state.hub));
  for (const phone of PHONES) await attempt(`status bar ${phone.id}`, () => restoreStatusBar(phone.serial));
  await attempt("stop the phones", () => stopPhones(state.started));
}

function report(began, run) {
  for (const name of [...STILLS, "thread.mp4", "thread.gif"]) {
    console.log(`media: docs/media/${name} ${sizeText(statSync(join(OUT, name)).size)}`);
  }
  console.log(`media: the thread ran for ${clockText(run.end - run.t0)}`);
  console.log(`media: the whole run took ${clockText(Date.now() - began)}. Work files are in ${run.dir}`);
}

async function main() {
  const began = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "vision-media-"));
  const run = { dir, raw: join(dir, "raw"), work: join(dir, "work"), log: join(dir, "ffmpeg.log") };
  Object.assign(run, { cuts: [], marks: {}, views: {}, recordings: [], boxes: {} });
  mkdirSync(run.raw);
  mkdirSync(run.work);
  const state = { hub: null, browser: null, started: [], recordings: [] };
  try {
    await prepare(state, run);
    await record(state, run);
    await produce(state, run);
    report(began, run);
  } finally {
    await cleanUp(state, run);
  }
}

main().catch((error) => {
  console.error(`media: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
});
