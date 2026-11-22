import { describe, expect, it } from "vitest";
import { STATE_SHAPE } from "../src/state.js";
import { acceptedSnow, at, done, onMyWay, run, state, there } from "./helpers.js";

const TOP_KEYS = [
  "cards",
  "clockOffsetMs",
  "counters",
  "deskOnShift",
  "jobs",
  "lastHash",
  "levels",
  "links",
  "mismatches",
  "needRecords",
  "pages",
  "partnerCounts",
  "playbookVersion",
  "promises",
  "seq",
];
const JOB_KEYS = [
  "acceptedAt",
  "approved",
  "askedAt",
  "card",
  "checkback",
  "closedAt",
  "createdAt",
  "doneAt",
  "excluded",
  "flags",
  "gotItAt",
  "helpers",
  "holderRef",
  "hoursMs",
  "id",
  "level",
  "need",
  "onMyWayAt",
  "partner",
  "path",
  "promiseAt",
  "quiet",
  "returnReason",
  "rung",
  "status",
  "taps",
  "thereAt",
  "wave",
  "waveAt",
  "yesAt",
];
const TAP_KEYS = ["counted", "hoursMs", "startAt"];
const CARD_KEYS = [
  "ai",
  "changed",
  "confirmedAt",
  "division",
  "door",
  "gistAt",
  "id",
  "jobs",
  "lang",
  "level",
  "need",
  "promiseAt",
  "quiet",
  "receivedAt",
  "routeCode",
  "safeContact",
  "sorted",
  "urgency",
  "zip",
];

const demoState = () =>
  state(
    run(
      ...acceptedSnow(),
      at(0, onMyWay("j_1", "m_v01")),
      at(30 * 60_000, there("j_1", "m_v01")),
      at(90 * 60_000, done("j_1", "m_v01", "done")),
    ),
  );

const sortedKeys = (value: object | undefined): string[] => Object.keys(value ?? {}).sort();

describe("the derived state shape", () => {
  it("a change to the folded keys raises STATE_SHAPE", () => {
    const s = demoState();
    const job = s.jobs["j_1"];
    expect({
      shape: STATE_SHAPE,
      top: sortedKeys(s),
      card: sortedKeys(s.cards[job?.card ?? ""]),
      job: sortedKeys(job),
      taps: sortedKeys(job?.taps?.["m_v01"]),
    }).toEqual({ shape: 4, top: TOP_KEYS, card: CARD_KEYS, job: JOB_KEYS, taps: TAP_KEYS });
  });
});
