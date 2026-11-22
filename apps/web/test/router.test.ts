import { describe, expect, it } from "vitest";
import { matchRoute, themeFor } from "../src/router.js";

describe("matchRoute", () => {
  it("routes each page", () => {
    expect(matchRoute("/comforce-demo/t/abc")).toEqual({ page: "track", org: "comforce-demo", token: "abc" });
    expect(matchRoute("/comforce-demo/p/x_Y-9")).toEqual({
      page: "partner",
      org: "comforce-demo",
      token: "x_Y-9",
    });
    expect(matchRoute("/comforce-demo/desk")).toEqual({ page: "desk", org: "comforce-demo" });
    expect(matchRoute("/comforce-demo/org")).toEqual({ page: "org", org: "comforce-demo" });
    expect(matchRoute("/comforce-demo/ask")).toEqual({ page: "ask", org: "comforce-demo" });
    expect(matchRoute("/comforce-demo/join")).toEqual({ page: "join", org: "comforce-demo" });
    expect(matchRoute("/x")).toEqual({ page: "not_found" });
  });

  it("accepts one trailing slash", () => {
    expect(matchRoute("/comforce-demo/desk/")).toEqual({ page: "desk", org: "comforce-demo" });
  });
});

describe("matchRoute refusals", () => {
  it("refuses paths that do not match a page", () => {
    for (const path of [
      "/",
      "",
      "/comforce-demo",
      "/comforce-demo/t",
      "/comforce-demo/t/abc/more",
      "/comforce-demo/desk/more",
      "/comforce-demo/t/a%20b",
      "/Comforce/desk",
      "/ab/desk",
      "/comforce-demo/admin",
      "/comforce-demo//desk",
      "/comforce-demo/constructor",
      "/comforce-demo/__proto__/abc",
    ]) {
      expect(matchRoute(path), path).toEqual({ page: "not_found" });
    }
  });

  it("gives graphite to staff pages and paper to public pages", () => {
    expect(themeFor(matchRoute("/comforce-demo/desk"))).toBe("graphite");
    expect(themeFor(matchRoute("/comforce-demo/org"))).toBe("graphite");
    expect(themeFor(matchRoute("/comforce-demo/join"))).toBe("graphite");
    expect(themeFor(matchRoute("/comforce-demo/ask"))).toBe("paper");
    expect(themeFor(matchRoute("/comforce-demo/t/abc"))).toBe("paper");
    expect(themeFor(matchRoute("/comforce-demo/p/abc"))).toBe("paper");
    expect(themeFor(matchRoute("/x"))).toBe("paper");
  });
});
