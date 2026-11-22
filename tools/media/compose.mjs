import { execFileSync } from "node:child_process";
import { openSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  LAYOUT,
  concatList,
  gifArgs,
  gifSourceArgs,
  gifWindows,
  joinArgs,
  normalizeArgs,
  paletteArgs,
  segmentArgs,
  stillArgs,
} from "./edit.mjs";
import { renderFrames, renderPhones } from "./frame.mjs";
import { segments, sizeText } from "./lib.mjs";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const MP4_LIMIT = 25 * 1024 * 1024;
const GIF_LIMIT = 8 * 1024 * 1024;

function ffmpeg(args, log) {
  const out = openSync(log, "a");
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", out, out] });
}

const sizeOf = (file) => statSync(file).size;

export function compressStill(raw, output, log, crop = null) {
  ffmpeg(stillArgs(raw, output, crop), log);
}

export async function phoneStills(browser, root, run, out) {
  const raw = (name) => join(run.raw, name);
  const card = (src, title, name) => ({ src: raw(src), title, name });
  const pairs = [
    [
      "phones-offer.png",
      [
        card("phone-offer-a.png", "Phone A", "Avery Snow (test)"),
        card("phone-offer-b.png", "Phone B", "Blake Frost (test)"),
      ],
    ],
    [
      "phone-job.png",
      [
        card("phone-job-a.png", "Phone A", "the job card"),
        card("phone-taken-b.png", "Phone B", "taken by Avery"),
      ],
    ],
  ];
  for (const [name, phones] of pairs) {
    await renderPhones(browser, root, phones, raw(`render-${name}`));
    compressStill(raw(`render-${name}`), join(out, name), run.log);
  }
}

function normalize(run, dir) {
  const files = {};
  for (const [name, view] of Object.entries(run.views)) {
    files[name] = join(dir, `web-${name}.mp4`);
    ffmpeg(normalizeArgs(view.video, files[name], LAYOUT.left, view.closed - view.start), run.log);
  }
  for (const rec of run.recordings) {
    files[rec.id] = join(dir, `phone-${rec.id}.mp4`);
    ffmpeg(normalizeArgs(rec.file, files[rec.id], LAYOUT.phoneA, rec.stop - rec.start), run.log);
  }
  return files;
}

function partOf(run, files, seg, frame) {
  const phone = (rec) => ({ file: files[rec.id], offset: seg.from - rec.start });
  return {
    frame,
    duration: seg.to - seg.from,
    web: { file: files[seg.view], offset: seg.from - run.views[seg.view].start },
    phones: run.recordings.map(phone),
  };
}

function encodeThread(run, files, segs, frames, crf, output) {
  const parts = segs.map((seg, i) => {
    const file = join(run.work, `part-${String(i).padStart(2, "0")}.mp4`);
    ffmpeg(segmentArgs(partOf(run, files, seg, frames[i]), file, crf), run.log);
    return file;
  });
  const list = join(run.work, "parts.txt");
  writeFileSync(list, concatList(parts));
  ffmpeg(joinArgs(list, output), run.log);
  return sizeOf(output);
}

export async function buildThread(browser, root, run, out) {
  const segs = segments(run.cuts, run.end);
  const frames = await renderFrames(browser, root, segs, run.work);
  const files = normalize(run, run.work);
  const output = join(out, "thread.mp4");
  for (const crf of [20, 24, 28]) {
    const size = encodeThread(run, files, segs, frames, crf, output);
    console.log(`media: thread.mp4 at crf ${crf} is ${sizeText(size)}`);
    if (size <= MP4_LIMIT) return { output, start: segs[0].from };
  }
  throw new Error("thread.mp4 is over 25 MB even at crf 28.");
}

export function buildGif(run, thread, out) {
  const windows = gifWindows(run.marks, thread.start);
  const output = join(out, "thread.gif");
  for (const [fps, dither] of [
    [12, "bayer:bayer_scale=4"],
    [10, "bayer:bayer_scale=3"],
    [10, "none"],
  ]) {
    const source = join(run.work, `gif-${fps}.mp4`);
    const palette = join(run.work, `palette-${fps}.png`);
    ffmpeg(gifSourceArgs(thread.output, windows, source, 960, fps), run.log);
    ffmpeg(paletteArgs(source, palette), run.log);
    ffmpeg(gifArgs(source, palette, output, dither), run.log);
    console.log(`media: thread.gif at ${fps} fps is ${sizeText(sizeOf(output))}`);
    if (sizeOf(output) <= GIF_LIMIT) return output;
  }
  throw new Error("thread.gif is over 8 MB.");
}
