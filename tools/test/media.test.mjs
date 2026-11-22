import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockText,
  codeOf,
  envValue,
  findNode,
  hubEnv,
  parseCodes,
  parseNodes,
  screenWords,
  secondsOf,
  segments,
  sizeText,
  STILLS,
} from "../media/lib.mjs";
import { hubArgs } from "../media/hub.mjs";
import {
  GIF_MOMENTS,
  LAYOUT,
  concatList,
  cropBox,
  gifWindows,
  joinArgs,
  normalizeArgs,
  segmentArgs,
  stillArgs,
} from "../media/edit.mjs";

const XML = [
  '<hierarchy><node index="0" text="ACCEPT" content-desc="" class="android.widget.Button" bounds="[100,200][300,260]" />',
  '<node text="" content-desc="Offers &amp; jobs" class="android.view.View" bounds="[0,0][1080,100]" /></hierarchy>',
].join("");

test("reads the text, the class and the centre of each screen node", () => {
  const nodes = parseNodes(XML);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[0], { text: "ACCEPT", desc: "", cls: "android.widget.Button", x: 200, y: 230 });
  assert.equal(nodes[1].desc, "Offers & jobs");
});

test("finds a node by its text or its description", () => {
  const nodes = parseNodes(XML);
  assert.equal(findNode(nodes, /^ACCEPT$/u)?.x, 200);
  assert.equal(findNode(nodes, /jobs/u)?.y, 50);
  assert.equal(findNode(nodes, /DONE/u), null);
  assert.deepEqual(screenWords(nodes), ["ACCEPT", "Offers & jobs"]);
});

test("reads the join codes that the seed prints", () => {
  const text = [
    "Vision join codes for comforce-demo. All people are synthetic test people.",
    "",
    "Avery Snow (test) | volunteer | 224RL9GU",
    "Morgan Desk (test) | desk | LR69ZPCU",
  ].join("\n");
  const codes = parseCodes(text);
  assert.equal(codes.size, 2);
  assert.equal(codeOf(codes, "Morgan Desk (test)"), "LR69ZPCU");
  assert.throws(() => codeOf(codes, "Nobody (test)"), /no join code for Nobody/u);
});

test("replaces only the placeholder values in the hub settings", () => {
  const text = "BOOTSTRAP_CODE=change-me-to-a-long-random-code\nDOOR_SECRET=kept-value\nGOOGLE_URL=\n";
  const env = hubEnv(text, (key) => `new-${key}`);
  assert.equal(envValue(env, "BOOTSTRAP_CODE"), "new-BOOTSTRAP_CODE");
  assert.equal(envValue(env, "DOOR_SECRET"), "kept-value");
  assert.equal(envValue(env, "GOOGLE_URL"), "");
  assert.equal(envValue(env, "MISSING"), "");
});

test("turns the cuts into segments and drops the empty ones", () => {
  const cuts = [
    { at: 1000, view: "resident" },
    { at: 1050, view: "desk" },
    { at: 4000, view: "org" },
  ];
  const segs = segments(cuts, 9000);
  assert.deepEqual(
    segs.map((s) => [s.view, s.from, s.to]),
    [
      ["desk", 1050, 4000],
      ["org", 4000, 9000],
    ],
  );
});

test("writes times and sizes in plain units", () => {
  assert.equal(secondsOf(1234.4), "1.234");
  assert.equal(sizeText(2 * 1024 * 1024), "2.0 MB");
  assert.equal(sizeText(3000), "3 KB");
  assert.equal(clockText(125000), "2 min 05 s");
});

test("places every panel on even pixels inside the 1920 by 1080 frame", () => {
  for (const box of [LAYOUT.left, LAYOUT.phoneA, LAYOUT.phoneB]) {
    for (const n of [box.x, box.y, box.w, box.h]) assert.equal(n % 2, 0);
    assert.ok(box.x + box.w <= 1920 && box.y + box.h <= LAYOUT.captionTop);
  }
  assert.ok(LAYOUT.left.x + LAYOUT.left.w < LAYOUT.phoneA.x);
  assert.ok(LAYOUT.phoneA.x + LAYOUT.phoneA.w < LAYOUT.phoneB.x);
});

test("builds one composite part from a frame, a web clip and two phone clips", () => {
  const part = {
    frame: "f.png",
    duration: 2500,
    web: { file: "w.mp4", offset: 4000 },
    phones: [
      { file: "a.mp4", offset: -200 },
      { file: "b.mp4", offset: 1000 },
    ],
  };
  const args = segmentArgs(part, "out.mp4", 22);
  assert.deepEqual(args.slice(args.indexOf("w.mp4") - 5, args.indexOf("w.mp4") + 1), [
    "-ss",
    "4.000",
    "-t",
    "2.500",
    "-i",
    "w.mp4",
  ]);
  assert.equal(args[args.indexOf("a.mp4") - 4], "0.000");
  assert.match(args[args.indexOf("-filter_complex") + 1], /overlay=1550:140/u);
  assert.equal(args.at(-1), "out.mp4");
  assert.equal(args[args.indexOf("-crf") + 1], "22");
});

test("holds the last frame so a short recording still fills its time", () => {
  const args = normalizeArgs("in.webm", "out.mp4", { w: 1120, h: 700 }, 61000);
  assert.match(args[args.indexOf("-vf") + 1], /scale=1120:700.*tpad=stop_mode=clone:stop_duration=61.000/u);
  assert.equal(args[args.indexOf("-t") + 1], "61.000");
});

test("picks the hero moments that the run marked, in order", () => {
  const marks = { sent: 12000, accept: 30000 };
  const moments = [
    { mark: "sent", before: 2500, length: 3000, speed: 1 },
    { mark: "missing", before: 0, length: 1000, speed: 1 },
    { mark: "accept", before: 300, length: 4000, speed: 2 },
  ];
  assert.deepEqual(gifWindows(marks, 10000, moments), [
    { from: 0, length: 3000, speed: 1 },
    { from: 19700, length: 4000, speed: 2 },
  ]);
});

test("writes a concat list that survives quotes in paths", () => {
  assert.equal(concatList(["/a/b.mp4", "/c/it's.mp4"]), "file '/a/b.mp4'\nfile '/c/it'\\''s.mp4'\n");
  assert.deepEqual(joinArgs("l.txt", "o.mp4").slice(-3), ["-movflags", "+faststart", "o.mp4"]);
});

test("keeps a still at full colour and at most 1200 pixels wide", () => {
  const graph = stillArgs("in.png", "out.png")[4];
  assert.equal(graph, "scale='min(1200,iw)':-2:flags=lanczos");
  assert.doesNotMatch(graph, /palette/u);
});

test("crops a still to the part that matters before it is resized", () => {
  const crop = cropBox({ x: 960, y: 80, width: 480, height: 600 }, 2, 16, { width: 1440, height: 900 });
  assert.deepEqual(crop, { x: 1888, y: 128, w: 992, h: 1264 });
  assert.match(stillArgs("in.png", "out.png", crop)[4], /^crop=992:1264:1888:128,scale=/u);
});

test("keeps a crop inside the window", () => {
  const crop = cropBox({ x: -10, y: 700, width: 600, height: 900 }, 2, 16, { width: 1440, height: 900 });
  assert.deepEqual(crop, { x: 0, y: 1368, w: 1264, h: 432 });
});

test("starts the media hub with the AI binding on Workers AI and its own state folder", () => {
  const args = hubArgs(8787, "/run/hub-state", "/run/hub.env");
  assert.ok(!args.includes("--local"));
  assert.equal(args[args.indexOf("--ip") + 1], "127.0.0.1");
  assert.equal(args[args.indexOf("--persist-to") + 1], "/run/hub-state");
  assert.equal(args[args.indexOf("--port") + 1], "8787");
  assert.equal(args[args.indexOf("--env-file") + 1], "/run/hub.env");
});

test("makes a still of each AI part that the desk and the resident see", () => {
  for (const name of ["voicemail.png", "same-event.png", "ask-spanish.png", "desk-card.png"]) {
    assert.ok(STILLS.includes(name), name);
  }
});

test("shows the AI suggestion in the GIF between the new card and the plan", () => {
  const order = GIF_MOMENTS.map((m) => m.mark);
  assert.ok(order.indexOf("triage") < order.indexOf("sorted"));
  assert.ok(order.indexOf("sorted") < order.indexOf("approve"));
});
