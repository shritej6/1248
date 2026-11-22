import { secondsOf } from "./lib.mjs";

export const LAYOUT = {
  left: { x: 54, y: 140, w: 1120, h: 700 },
  phoneA: { x: 1214, y: 140, w: 316, h: 702 },
  phoneB: { x: 1550, y: 140, w: 316, h: 702 },
  captionTop: 880,
};

export const FPS = 30;

export const GIF_MOMENTS = [
  { mark: "sent", before: 2500, length: 3000, speed: 1 },
  { mark: "triage", before: 300, length: 2500, speed: 1 },
  { mark: "sorted", before: 300, length: 4000, speed: 1 },
  { mark: "approve", before: 300, length: 4500, speed: 1 },
  { mark: "accept", before: 300, length: 4000, speed: 1 },
  { mark: "onway", before: 0, length: 8000, speed: 2.5 },
  { mark: "tracked", before: 500, length: 3000, speed: 1 },
  { mark: "partner", before: 300, length: 3000, speed: 1 },
  { mark: "statement", before: 300, length: 2500, speed: 1 },
  { mark: "seal", before: 300, length: 2500, speed: 1 },
];

const H264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"];

export function normalizeArgs(input, output, size, durationMs) {
  const filters = [
    `fps=${FPS}`,
    `scale=${size.w}:${size.h}:flags=lanczos`,
    "setsar=1",
    `tpad=stop_mode=clone:stop_duration=${secondsOf(durationMs)}`,
  ];
  const time = ["-t", secondsOf(durationMs)];
  return [
    "-y",
    "-i",
    input,
    "-vf",
    filters.join(","),
    ...time,
    ...H264,
    "-preset",
    "veryfast",
    "-crf",
    "12",
    output,
  ];
}

const clip = (file, offsetMs, durationMs) => [
  "-ss",
  secondsOf(Math.max(0, offsetMs)),
  "-t",
  secondsOf(durationMs),
  "-i",
  file,
];

export function segmentArgs(part, output, crf = 20) {
  const { left, phoneA, phoneB } = LAYOUT;
  const d = secondsOf(part.duration);
  const inputs = [
    ...["-loop", "1", "-framerate", String(FPS), "-t", d, "-i", part.frame],
    ...clip(part.web.file, part.web.offset, part.duration),
    ...clip(part.phones[0].file, part.phones[0].offset, part.duration),
    ...clip(part.phones[1].file, part.phones[1].offset, part.duration),
  ];
  const graph = [
    "[0:v]format=yuv420p[bg]",
    `[bg][1:v]overlay=${left.x}:${left.y}:eof_action=repeat[x]`,
    `[x][2:v]overlay=${phoneA.x}:${phoneA.y}:eof_action=repeat[y]`,
    `[y][3:v]overlay=${phoneB.x}:${phoneB.y}:eof_action=repeat,format=yuv420p[v]`,
  ].join(";");
  const encode = ["-t", d, "-r", String(FPS), ...H264, "-preset", "medium", "-crf", String(crf), "-g", "150"];
  return ["-y", ...inputs, "-filter_complex", graph, "-map", "[v]", ...encode, output];
}

export function concatList(files) {
  return files
    .map((f) => `file '${f.replaceAll("'", "'\\''")}'`)
    .join("\n")
    .concat("\n");
}

export function joinArgs(list, output) {
  return ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", output];
}

export function gifWindows(marks, t0, moments = GIF_MOMENTS) {
  return moments
    .filter((m) => marks[m.mark] !== undefined)
    .map((m) => ({ from: Math.max(0, marks[m.mark] - t0 - m.before), length: m.length, speed: m.speed }));
}

export function gifSourceArgs(input, windows, output, width, fps) {
  const inputs = windows.flatMap((w) => clip(input, w.from, w.length));
  const parts = windows.map(
    (w, i) =>
      `[${i}:v]setpts=(PTS-STARTPTS)/${w.speed},fps=${fps},scale=${width}:-2:flags=lanczos,setsar=1[c${i}]`,
  );
  const join = `${windows.map((_, i) => `[c${i}]`).join("")}concat=n=${windows.length}:v=1:a=0[v]`;
  const graph = [...parts, join].join(";");
  return ["-y", ...inputs, "-filter_complex", graph, "-map", "[v]", ...H264, "-crf", "8", output];
}

export function paletteArgs(input, palette) {
  return ["-y", "-i", input, "-vf", "palettegen=max_colors=256:stats_mode=diff", "-update", "1", palette];
}

export function gifArgs(input, palette, output, dither) {
  const use = `[0:v][1:v]paletteuse=dither=${dither}:diff_mode=rectangle`;
  return ["-y", "-i", input, "-i", palette, "-lavfi", use, "-loop", "0", output];
}

export function cropBox(box, scale, pad, limit) {
  const x = Math.max(0, Math.floor((box.x - pad) * scale));
  const y = Math.max(0, Math.floor((box.y - pad) * scale));
  const w = Math.min(limit.width * scale - x, Math.ceil((box.width + 2 * pad) * scale));
  const h = Math.min(limit.height * scale - y, Math.ceil((box.height + 2 * pad) * scale));
  return { x, y, w: w - (w % 2), h: h - (h % 2) };
}

export function stillArgs(input, output, crop = null, width = 1200) {
  const cut = crop === null ? [] : [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`];
  const graph = [...cut, `scale='min(${width},iw)':-2:flags=lanczos`].join(",");
  return ["-y", "-i", input, "-vf", graph, "-frames:v", "1", "-update", "1", output];
}
