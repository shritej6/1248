import { execFileSync, spawn } from "node:child_process";
import { existsSync, openSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { findNode, parseNodes, screenWords } from "./lib.mjs";

export const SDK = process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
const ADB = join(SDK, "platform-tools/adb");
const EMULATOR = join(SDK, "emulator/emulator");
export const APP = "app.vision.volunteer";
const CLIP = "/sdcard/vision-media.mp4";

export const PHONES = [
  { id: "A", serial: "emulator-5554", avd: "Vision_Volunteer_A", port: 5554, member: "Avery Snow (test)" },
  { id: "B", serial: "emulator-5556", avd: "Vision_Volunteer_B", port: 5556, member: "Blake Frost (test)" },
];

export function adb(serial, ...args) {
  return execFileSync(ADB, ["-s", serial, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function readyDevices() {
  const out = execFileSync(ADB, ["devices"], { encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim().split(/\s+/u))
    .filter((p) => p[1] === "device")
    .map((p) => p[0]);
}

async function waitBoot(serial) {
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    try {
      if (adb(serial, "shell", "getprop", "sys.boot_completed").trim() === "1") return;
    } catch (error) {
      if (!String(error).includes("not found") && !String(error).includes("offline")) throw error;
    }
    await sleep(2000);
  }
  throw new Error(`${serial} did not finish booting in 4 minutes.`);
}

export async function bootPhones(logDir) {
  const ready = readyDevices();
  const started = [];
  for (const phone of PHONES.filter((p) => !ready.includes(p.serial))) {
    const log = openSync(join(logDir, `emulator-${phone.id}.log`), "w");
    const args = ["-avd", phone.avd, "-port", String(phone.port), "-no-snapshot-save", "-gpu", "host"];
    spawn(EMULATOR, args, { detached: true, stdio: ["ignore", log, log] }).unref();
    started.push(phone);
  }
  for (const phone of PHONES) await waitBoot(phone.serial);
  return started;
}

export function stopPhones(started) {
  for (const phone of started) adb(phone.serial, "emu", "kill");
}

export function nodes(serial) {
  adb(serial, "shell", "uiautomator", "dump", "/sdcard/vision-ui.xml");
  return parseNodes(adb(serial, "shell", "cat", "/sdcard/vision-ui.xml"));
}

export async function waitText(serial, pattern, ms = 30000) {
  const end = Date.now() + ms;
  let seen = [];
  while (Date.now() < end) {
    const all = nodes(serial);
    const node = findNode(all, pattern);
    if (node !== null) return node;
    seen = screenWords(all);
    await sleep(500);
  }
  throw new Error(
    `${serial}: ${String(pattern)} is not on the screen. The screen shows: ${seen.join(" | ")}`,
  );
}

export async function tap(serial, pattern, ms) {
  const node = await waitText(serial, pattern, ms);
  adb(serial, "shell", "input", "tap", String(node.x), String(node.y));
  return node;
}

export async function hold(serial, pattern, holdMs = 2500) {
  const node = await waitText(serial, pattern);
  const at = [String(node.x), String(node.y)];
  adb(serial, "shell", "input", "swipe", ...at, ...at, String(holdMs));
}

export async function joinPhone(serial, code) {
  await waitText(serial, /Join this phone/u, 60000);
  const field = nodes(serial).find((n) => n.cls.includes("EditText"));
  if (field === undefined) throw new Error(`${serial}: the join screen has no code field.`);
  adb(serial, "shell", "input", "tap", String(field.x), String(field.y));
  await sleep(400);
  adb(serial, "shell", "input", "text", code);
  await sleep(400);
  adb(serial, "shell", "input", "keyevent", "111");
  await tap(serial, /^JOIN$/u);
  await waitText(serial, /OFFERS/u, 30000);
}

export function installApp(serial, apk) {
  if (!existsSync(apk)) throw new Error(`The app is not built: ${apk} is missing.`);
  adb(serial, "install", "-r", apk);
  adb(serial, "shell", "pm", "clear", APP);
  adb(serial, "shell", "am", "start", "-n", `${APP}/.MainActivity`);
}

const DEMO = ["shell", "am", "broadcast", "-a", "com.android.systemui.demo", "-e", "command"];

export function cleanStatusBar(serial, hhmm) {
  adb(serial, "shell", "settings", "put", "global", "sysui_demo_allowed", "1");
  adb(serial, ...DEMO, "enter");
  adb(serial, ...DEMO, "clock", "-e", "hhmm", hhmm);
  adb(serial, ...DEMO, "battery", "-e", "level", "100", "-e", "plugged", "false");
  adb(serial, ...DEMO, "network", "-e", "wifi", "show", "-e", "level", "4");
  adb(serial, ...DEMO, "network", "-e", "mobile", "show", "-e", "level", "4", "-e", "datatype", "none");
  adb(serial, ...DEMO, "notifications", "-e", "visible", "false");
}

export function restoreStatusBar(serial) {
  adb(serial, ...DEMO, "exit");
}

export function screencap(serial, file) {
  const png = execFileSync(ADB, ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  writeFileSync(file, png);
}

export function startRecording(serial) {
  adb(serial, "shell", "rm", "-f", CLIP);
  const args = ["-s", serial, "shell", "screenrecord", "--time-limit", "0", "--size", "720x1600"];
  const child = spawn(ADB, [...args, "--bit-rate", "8M", CLIP], { stdio: "ignore" });
  const done = new Promise((resolve) => child.once("exit", resolve));
  return { serial, start: Date.now(), done };
}

export async function stopRecording(recording, file) {
  recording.stop = Date.now();
  adb(recording.serial, "shell", "pkill", "-INT", "screenrecord");
  await Promise.race([recording.done, sleep(15000)]);
  await sleep(1500);
  adb(recording.serial, "pull", CLIP, file);
  adb(recording.serial, "shell", "rm", "-f", CLIP);
}
