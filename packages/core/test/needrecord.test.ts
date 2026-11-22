import { describe, expect, it } from "vitest";
import {
  BASE_NOW,
  config,
  confirm,
  eventData,
  members,
  pass,
  playbook,
  raise,
  reject,
  run,
  setLevel,
  sortResult,
  state,
  submit,
  types,
  type Step,
} from "./helpers.js";
import { orgView } from "../src/views/organiser.js";
import type { ViewContext } from "../src/views/common.js";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };

const aiLow = (need: string) =>
  pass("low", "", { service: playbook.rows.find((r) => r.need === need)?.service ?? "Other" });

const lowCard = (card: string, need = "snow"): Step[] => [
  submit(card),
  sortResult(card, [aiLow(need), aiLow(need)]),
];

let cardCount = 0;
const nextCard = (prefix: string): string => {
  cardCount += 1;
  return `c_${prefix}${String(cardCount)}`;
};

const cleanCards = (need: string, n: number): Step[] =>
  Array.from({ length: n }, () => nextCard("k")).flatMap((card) => [
    ...lowCard(card, need),
    confirm(card, need, "low"),
  ]);

const levelOne = (need: string): Step[] => [...cleanCards(need, 60), setLevel(need, 1)];

const autoCards = (need: string, n: number): Step[] =>
  Array.from({ length: n }, () => nextCard("a")).flatMap((card) => lowCard(card, need));

const aiLowCardRaisedByDesk = (need: string): Step[] => {
  const card = nextCard("r");
  return [...lowCard(card, need), raise(card)];
};

const spotFlags = (d: ReturnType<typeof run>): number =>
  d.events.filter(
    (e) => e.type === "card.sorted" && (e.data as { flags: string[] }).flags.includes("spot_check"),
  ).length;

const viewCtx: ViewContext = {
  now: BASE_NOW,
  newId: (prefix) => `${prefix}view`,
  playbook,
  members,
  offered: {},
  zips: zipsFile,
  config,
  memberRecords: [],
  partners: [],
  links: { partner: () => null },
};

const snowLevel = (d: ReturnType<typeof run>) =>
  orgView(state(d), { person: () => null, texts: () => [] }, viewCtx).levels.needs.find(
    (n) => n.need === "snow",
  );

describe("earning level 1", () => {
  it("level 1 is refused before 60 clean cards and allowed after", () => {
    expect(reject(setLevel("snow", 1), cleanCards("snow", 59))).toBe("not_earned");
    expect(run(...cleanCards("snow", 60), setLevel("snow", 1)).rejections).toEqual([]);
  });

  it("a desk change starts the count again", () => {
    const changed = nextCard("x");
    const steps = [
      ...cleanCards("snow", 30),
      ...lowCard(changed),
      confirm(changed, "snow", "high"),
      ...cleanCards("snow", 59),
    ];
    expect(reject(setLevel("snow", 1), steps)).toBe("not_earned");
    expect(run(...steps, ...cleanCards("snow", 1), setLevel("snow", 1)).rejections).toEqual([]);
  });

  it("the organiser view says when a need can earn level 1", () => {
    expect(snowLevel(run(...cleanCards("snow", 59)))).toMatchObject({ clean: 59, canEarn: false });
    expect(snowLevel(run(...cleanCards("snow", 60)))).toMatchObject({ clean: 60, canEarn: true });
    expect(snowLevel(run(...levelOne("snow")))).toMatchObject({ level: 1, canEarn: false });
  });

  it("cards that go by themselves at level 1 do not count as clean", () => {
    const d = run(...levelOne("snow"), ...autoCards("snow", 5));
    expect(types(d).filter((t) => t === "card.confirmed")).toHaveLength(65);
    expect(state(d).needRecords["snow"]?.clean).toBe(60);
  });
});

describe("a serious miss", () => {
  it("one serious miss returns the need to level 2", () => {
    const d = run(...levelOne("snow"), ...aiLowCardRaisedByDesk("snow"));
    expect(eventData(d, "need.level_set")).toEqual({ need: "snow", level: 2 });
    expect(state(d).levels.needs["snow"]).toBe(2);
    expect(state(d).needRecords["snow"]).toMatchObject({ clean: 0, serious: 1 });
  });

  it("the desk confirming high on a spot check the AI marked low returns the need to level 2", () => {
    const steps = [...levelOne("snow"), ...autoCards("snow", 9)];
    const spot = nextCard("s");
    const d = run(...steps, ...lowCard(spot), confirm(spot, "snow", "high"));
    expect(state(d).cards[spot]?.sorted?.flags).toContain("spot_check");
    expect(eventData(d, "need.level_set")).toEqual({ need: "snow", level: 2 });
  });

  it("a raise of a confirmed card at level 2 resets the count but sets no level", () => {
    const card = nextCard("r");
    const d = run(...cleanCards("snow", 10), ...lowCard(card), confirm(card, "snow", "low"), raise(card));
    expect(types(d)).not.toContain("need.level_set");
    expect(state(d).needRecords["snow"]).toMatchObject({ clean: 0, serious: 1 });
  });
});

describe("spot checks", () => {
  it("every 10th level 1 card goes to the desk as a spot check", () => {
    const d = run(...levelOne("snow"), ...autoCards("snow", 10));
    expect(spotFlags(d)).toBe(1);
    expect(state(d).cards[`c_a${String(cardCount)}`]?.confirmedAt).toBeNull();
  });

  it("the spot check comes back every 10 cards", () => {
    expect(spotFlags(run(...levelOne("snow"), ...autoCards("snow", 30)))).toBe(3);
  });

  it("a need at level 2 gets no spot check", () => {
    expect(spotFlags(run(...autoCards("snow", 10)))).toBe(0);
    expect(playbook.rows.find((r) => r.need === "snow")?.level).toBe(2);
  });
});
