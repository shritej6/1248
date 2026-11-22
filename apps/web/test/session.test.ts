import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSession, readSession, saveSession } from "../src/session.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("session", () => {
  it("keeps one token for each org", () => {
    saveSession("comforce-demo", "s1");
    expect(localStorage.getItem("vision.session.comforce-demo")).toBe("s1");
    expect(readSession("comforce-demo")).toBe("s1");
    expect(readSession("other-org")).toBeNull();
    clearSession("comforce-demo");
    expect(readSession("comforce-demo")).toBeNull();
  });

  it("works when storage is blocked", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => {
      saveSession("comforce-demo", "s1");
    }).not.toThrow();
    expect(readSession("comforce-demo")).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
