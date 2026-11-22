import { describe, expect, it } from "vitest";
import zipsFile from "../../../data/synthetic/zip-centres.json" with { type: "json" };
import { offerView, pageView } from "../src/index.js";
import { offeredSnow, pass, playbook, run, sortResult, state, submit } from "./helpers.js";

const ctx = { playbook, zips: zipsFile };

describe("live offer and page views", () => {
  it("an offer view holds the need, distance, bring and crew, and no name or address", () => {
    const s = state(run(...offeredSnow()));
    const offer = offerView(s, ctx, "53212", "j_1");
    expect(offer).toMatchObject({
      job: "j_1",
      needLabel: "Snow shovelling",
      promiseAt: s.jobs["j_1"]?.promiseAt,
      bring: "Shovel and salt",
      crew: 1,
    });
    expect(offer?.distanceMiles).toBe(Math.round((offer?.distanceMiles ?? 0) * 10) / 10);
    expect(offer?.distanceMiles).toBeGreaterThan(0);
    expect(JSON.stringify(offer)).not.toMatch(/Tess|Test St|tess@/);
  });

  it("an offer view has no distance when the member has no zip", () => {
    const s = state(run(...offeredSnow()));
    expect(offerView(s, ctx, null, "j_1")?.distanceMiles).toBeNull();
  });

  it("an offer view for an unknown job is null", () => {
    expect(offerView(state(run(...offeredSnow())), ctx, "53216", "j_9")).toBeNull();
  });

  it("a page view names the paged member and falls back to the id", () => {
    const s = state(run(submit("c_1"), sortResult("c_1", [pass("high"), pass("low")])));
    const named = pageView(s, "pg_1", (m) => (m === "m_d01" ? "Morgan Desk (test)" : null));
    expect(named).toMatchObject({
      page: "pg_1",
      card: "c_1",
      reason: "high",
      to: "Morgan Desk (test)",
    });
    expect(pageView(s, "pg_1", () => null)?.to).toBe("m_d01");
    expect(pageView(s, "pg_9", () => null)).toBeNull();
  });
});
