import { describe, expect, it } from "vitest";
import {
  addJob,
  confirm,
  confirmedSnow,
  effects,
  eventData,
  pass,
  raise,
  reject,
  run,
  runFrom,
  sortOff,
  sortResult,
  state,
  stateWithLevel,
  submit,
  types,
} from "./helpers.js";

describe("intake and paging", () => {
  it("AI high pages the page list at once", () => {
    const d = run(submit("c_1"), sortResult("c_1", [pass("high"), pass("low")]));
    expect(types(d)).toContain("page.sent");
    expect(eventData(d, "card.sorted")).toMatchObject({ urgency: "high", source: "ai" });
    expect(eventData(d, "page.sent")).toMatchObject({ to: "m_d01", reason: "high", step: 0 });
    expect(effects(d).at(-1)).toEqual({ kind: "page", page: "pg_1", member: "m_d01" });
  });

  it("word list hit that the AI marks low is a flag and not a page", () => {
    const d = run(
      submit("c_1", "he is not breathing right after the fall"),
      sortResult("c_1", [pass("low"), pass("low")]),
    );
    expect(eventData(d, "card.sorted").flags).toContain("word_list_hit");
    expect(types(d)).not.toContain("page.sent");
  });

  it("sorter off plus a word list hit pages", () => {
    const d = run(submit("c_1", "she isn't breathing"), sortOff("c_1"));
    expect(eventData(d, "card.sorted").flags).toEqual(
      expect.arrayContaining(["sorter_off", "word_list_hit"]),
    );
    expect(types(d)).toContain("page.sent");
  });

  it("AI down plus a word list hit pages", () => {
    const d = run(submit("c_1", "she isn't breathing"), sortResult("c_1", null, "ai_down"));
    expect(eventData(d, "page.sent")).toMatchObject({ reason: "sorter_down_hit" });
  });
});

describe("late and off-list sorts", () => {
  it("an AI high with an off-list division still pages", () => {
    const off = { service: "Other", division: "Pet Division (no function listed)" };
    const d = run(
      submit("c_1", "my neighbour looks grey and will not answer"),
      sortResult("c_1", [pass("high", "", off), pass("high", "", off)]),
    );
    expect(eventData(d, "page.sent")).toMatchObject({ reason: "high" });
  });

  it("an AI high after the desk confirmed low raises the card and pages", () => {
    const d = run(
      submit("c_1", "my dad looks grey and confused"),
      confirm("c_1", "snow", "low"),
      sortResult("c_1", [pass("high"), pass("high")]),
    );
    expect(types(d).slice(-3)).toEqual(["card.sorted", "card.raised", "page.sent"]);
    expect(eventData(d, "page.sent")).toMatchObject({ reason: "high" });
    expect(state(d).cards["c_1"]?.urgency).toBe("high");
  });

  it("a sort after a desk high does not page twice", () => {
    const d = run(
      submit("c_1"),
      confirm("c_1", "snow", "high"),
      sortResult("c_1", [pass("high"), pass("high")]),
    );
    expect(types(d).filter((t) => t === "page.sent")).toHaveLength(1);
    expect(types(d).at(-1)).toBe("card.sorted");
  });
});

describe("sort results and the vault", () => {
  it("the submit keeps the person and the message out of the ledger", () => {
    const d = run(submit("c_1"));
    expect(types(d)).toEqual(["card.received"]);
    expect(JSON.stringify(d.events)).not.toMatch(/Tess|Test St|shovel/);
    expect(effects(d).map((e) => e.kind)).toEqual(["vault.person", "vault.text", "sort"]);
  });

  it("a second sort result for one card is refused", () => {
    const d = run(...confirmedSnow(), sortResult("c_1", [pass("high"), pass("high")]));
    expect(d.rejections).toEqual(["wrong_state"]);
  });

  it("quotes found in the message go to the vault and not to the ledger", () => {
    const d = run(submit("c_1", "Snow on my walk"), sortResult("c_1", [pass("low", "Snow"), pass("low")]));
    expect(effects(d).at(-1)).toEqual({
      kind: "vault.text",
      card: "c_1",
      job: null,
      textKind: "quote",
      text: "Snow",
    });
    expect(JSON.stringify(d.events)).not.toContain("Snow on");
  });
});

describe("desk confirm", () => {
  it("the desk may lower AI high to low, and the change is counted", () => {
    const d = run(
      submit("c_1"),
      sortResult("c_1", [pass("high"), pass("high")]),
      confirm("c_1", "snow", "low"),
    );
    expect(eventData(d, "card.confirmed")).toMatchObject({ urgency: "low", changed: true });
  });

  it("confirm issues a route code and a receipt and plans one job", () => {
    const d = run(...confirmedSnow());
    expect(eventData(d, "card.confirmed")).toMatchObject({ routeCode: "SNOW-16-001", changed: false });
    expect(types(d)).toEqual(expect.arrayContaining(["receipt.sent", "job.planned"]));
    expect(effects(d).find((e) => e.kind === "message")).toMatchObject({
      to: "resident",
      template: "receipt",
    });
    expect(Object.keys(state(d).jobs)).toEqual(["j_1"]);
  });

  it("route codes count for each code and use 00 when the ZIP is missing", () => {
    const d = run(
      ...confirmedSnow("c_1"),
      submit("c_2", "Walk", { zip: null }),
      confirm("c_2", "snow", "low"),
    );
    expect(state(d).cards["c_2"]?.routeCode).toBe("SNOW-00-002");
  });

  it("a quiet card gets CARE, level 3 and no receipt message", () => {
    const d = run(
      submit("c_1", "text", { safeContact: false }),
      sortOff("c_1"),
      confirm("c_1", "snow", "low", { as: "lead" }),
    );
    expect(eventData(d, "card.confirmed")).toMatchObject({ quiet: true, level: 3, routeCode: "CARE-16-001" });
    expect(effects(d).filter((e) => e.kind === "message")).toHaveLength(0);
  });
});

describe("who may confirm and when", () => {
  it("only the lead may confirm a quiet card", () => {
    expect(reject(confirm("c_1", "text_extraction", "low"), [submit("c_1"), sortOff("c_1")])).toBe(
      "forbidden",
    );
  });

  it("a volunteer cannot confirm a card", () => {
    expect(reject(confirm("c_1", "snow", "low", { as: "volunteer" }))).toBe("forbidden");
  });

  it("a card is confirmed only once and only for a known need", () => {
    expect(reject(confirm("c_1", "snow", "low"), confirmedSnow())).toBe("wrong_state");
    expect(reject(confirm("c_1", "boats", "low"), [submit("c_1")])).toBe("invalid");
    expect(reject(confirm("c_9", "snow", "low"))).toBe("not_found");
  });

  it("a desk high on a card the AI marked low pages", () => {
    const d = run(
      submit("c_1"),
      sortResult("c_1", [pass("low"), pass("low")]),
      confirm("c_1", "snow", "high"),
    );
    expect(eventData(d, "page.sent")).toMatchObject({ reason: "high" });
  });
});

describe("auto confirm", () => {
  it("a level 1 need with no flags and low urgency confirms by itself", () => {
    const d = runFrom(
      stateWithLevel("snow", 1),
      submit("c_1"),
      sortResult("c_1", [pass("low"), pass("low")]),
    );
    expect(d.events.find((e) => e.type === "card.confirmed")).toMatchObject({
      actor: { role: "system" },
      data: { level: 1, routeCode: "SNOW-16-001" },
    });
    expect(types(d)).toContain("job.planned");
  });

  it("a desk raise before a low sort on a level 1 need stays high and waits for a person", () => {
    const d = runFrom(
      stateWithLevel("snow", 1),
      submit("c_1"),
      raise("c_1"),
      sortResult("c_1", [pass("low"), pass("low")]),
    );
    expect(types(d)).not.toContain("card.confirmed");
    expect(state(d).cards["c_1"]?.urgency).toBe("high");
  });
});

describe("raise and add job", () => {
  it("raising a confirmed card makes it high and pages", () => {
    const d = run(...confirmedSnow(), raise("c_1"));
    expect(types(d).slice(-2)).toEqual(["card.raised", "page.sent"]);
    expect(state(d).cards["c_1"]?.urgency).toBe("high");
  });

  it("a high card cannot be raised again", () => {
    expect(reject(raise("c_1"), [...confirmedSnow(), raise("c_1")])).toBe("wrong_state");
  });

  it("the desk can add a second job to one card", () => {
    const d = run(...confirmedSnow(), addJob("c_1", "food"));
    expect(Object.values(state(d).jobs).map((j) => j.need)).toEqual(["snow", "food"]);
  });

  it("a job is added only to a confirmed card and not twice for one open need", () => {
    expect(reject(addJob("c_1", "food"), [submit("c_1")])).toBe("wrong_state");
    expect(reject(addJob("c_1", "snow"), confirmedSnow())).toBe("wrong_state");
  });
});
