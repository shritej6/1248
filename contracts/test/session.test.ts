import { describe, expect, it } from "vitest";
import { JoinCodeSchema, JoinResponseSchema } from "../src/index.js";

const member = { id: "m_1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", roles: ["desk"] };

describe("join shapes", () => {
  it("a join code has 8 characters from the code alphabet", () => {
    expect(JoinCodeSchema.safeParse("K7M2Q9XR").success).toBe(true);
    expect(JoinCodeSchema.safeParse("K7M2Q9X").success).toBe(false);
    expect(JoinCodeSchema.safeParse("K7M2Q9X0").success).toBe(false);
    expect(JoinCodeSchema.safeParse("k7m2q9xr").success).toBe(false);
  });
  it("a join response holds the session and the member roles only", () => {
    expect(JoinResponseSchema.safeParse({ session: "tok", member }).success).toBe(true);
    expect(JoinResponseSchema.safeParse({ session: "tok", member: { ...member, roles: [] } }).success).toBe(
      false,
    );
    expect(
      JoinResponseSchema.safeParse({ session: "tok", member: { ...member, name: "Dana" } }).success,
    ).toBe(false);
  });
});
