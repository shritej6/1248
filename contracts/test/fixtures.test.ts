import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import {
  CommandSchema,
  LiveMessageSchema,
  VolunteerHomeSchema,
  JobCardSchema,
  DeskBoardSchema,
  TrackingSchema,
  PartnerCardSchema,
} from "../src/index.js";

const read = (dir: string) =>
  readdirSync(new URL(`../fixtures/${dir}/`, import.meta.url)).map((f) => ({
    f,
    v: JSON.parse(readFileSync(new URL(`../fixtures/${dir}/${f}`, import.meta.url), "utf8")) as unknown,
  }));

describe("fixtures", () => {
  it("every command fixture parses", () => {
    for (const { f, v } of read("commands")) expect(CommandSchema.safeParse(v).success, f).toBe(true);
  });
  it("every live fixture parses", () => {
    for (const { f, v } of read("live")) expect(LiveMessageSchema.safeParse(v).success, f).toBe(true);
  });
  it("view fixtures parse with their schema", () => {
    const byPrefix = {
      home: VolunteerHomeSchema,
      job: JobCardSchema,
      desk: DeskBoardSchema,
      tracking: TrackingSchema,
      partner: PartnerCardSchema,
    };
    for (const { f, v } of read("views")) {
      const schema = Object.entries(byPrefix).find(([p]) => f.startsWith(p))?.[1];
      expect(schema?.safeParse(v).success, f).toBe(true);
    }
  });
});
