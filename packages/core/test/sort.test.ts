import { describe, expect, it } from "vitest";
import {
  SORTER_PROMPT_SHA256,
  SORTER_PROMPT_V1,
  WORD_LIST,
  checkSort,
  decide,
  emptyState,
  needForService,
  routeCode,
  sha256Hex,
} from "../src/index.js";
import { BASE_NOW, config, pass, playbook } from "./helpers.js";

const check = (message: string, passes: Parameters<typeof checkSort>[0]["passes"]) =>
  checkSort({ message, passes, error: null, wordList: WORD_LIST });

describe("checkSort", () => {
  it("a quote that is not in the message is flagged", () => {
    expect(
      checkSort({
        message: "Snow on my walk",
        passes: [{ ...pass("low"), words: "ice" }, pass("low")],
        error: null,
        wordList: WORD_LIST,
      }).flags,
    ).toContain("quote_not_found");
  });

  it("urgency is high when any pass says high and quotes are kept once", () => {
    const out = check("Gas smell in the kitchen", [pass("high", "gas smell"), pass("high", "gas smell")]);
    expect(out).toMatchObject({ source: "ai", urgency: "high", quotes: ["gas smell"] });
    expect(out.flags).not.toContain("word_list_hit");
  });

  it("passes that differ keep pass 1 and add a flag", () => {
    const out = check("Walk", [pass("low"), pass("low", "", { division: "Disaster Relief Division" })]);
    expect(out).toMatchObject({ division: "No clear home", flags: ["passes_disagree"] });
  });

  it("word list matching ignores case", () => {
    expect(
      checkSort({ message: "SHE COLLAPSED", passes: null, error: "off", wordList: WORD_LIST }).flags,
    ).toEqual(["sorter_off", "word_list_hit"]);
  });
});

describe("labels outside the lists", () => {
  it("a label outside the lists becomes Other or No clear home with a flag", () => {
    const out = check("Walk", [pass("low", "", { service: "Boats" }), pass("low")]);
    expect(out).toMatchObject({ source: "ai", service: "Other", urgency: "low", flags: ["passes_disagree"] });
  });

  it("a long free text label never reaches the card", () => {
    const long = "a".repeat(5000);
    const out = check("Walk", [pass("low", "", { service: long, division: long }), pass("low")]);
    expect(out).toMatchObject({ service: "Other", division: "No clear home", flags: ["passes_disagree"] });
  });

  it("an off-list division never drops a high from any pass", () => {
    const off = { service: "Other", division: "Pet Division (no function listed)" };
    const out = check("my neighbour looks grey and will not answer", [
      pass("high", "", off),
      pass("high", "", off),
    ]);
    expect(out).toMatchObject({ source: "ai", division: "No clear home", urgency: "high" });
    expect(out.flags).toContain("passes_disagree");
  });

  it("an empty list of passes counts as no answer", () => {
    expect(check("she isn't breathing", [])).toMatchObject({
      source: "none",
      flags: ["ai_down", "word_list_hit"],
    });
  });
});

describe("prompt, word list, route code and need", () => {
  it("the prompt fingerprint matches the tested prompt", () => {
    expect(sha256Hex(SORTER_PROMPT_V1)).toBe(SORTER_PROMPT_SHA256);
  });

  it("the word list has the 114 tested lines", () => {
    expect(WORD_LIST).toHaveLength(114);
    expect(WORD_LIST[0]).toBe("not breathing");
  });

  it("route code uses the code, the last two ZIP digits and a padded number", () => {
    expect(routeCode("SNOW", "53216", 42)).toBe("SNOW-16-042");
    expect(routeCode("CARE", null, 7)).toBe("CARE-00-007");
  });

  it("a service maps to its default row", () => {
    expect(needForService(pass("low").service, playbook)?.need).toBe("snow");
    expect(needForService(null, playbook)).toBeNull();
    expect(needForService("Other", playbook)).toBeNull();
  });
});

describe("decide dispatch", () => {
  it("an unknown command type is invalid", () => {
    const ctx = {
      now: BASE_NOW,
      newId: (p: string) => `${p}1`,
      playbook,
      members: [],
      offered: {},
      zips: {},
      config,
    };
    const d = decide(
      emptyState(),
      { id: "cmd_1", type: "no.such" } as never,
      { role: "desk", ref: null },
      ctx,
    );
    expect(d).toMatchObject({ ok: false, rejection: { code: "invalid" } });
  });
});
