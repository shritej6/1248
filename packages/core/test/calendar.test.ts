import { expect, it } from "vitest";
import {
  addMonths,
  chicagoDate,
  chicagoMonth,
  dateLabel,
  daysBetween,
  monthIndex,
  monthLabel,
  monthRange,
} from "../src/resources/calendar.js";

const LATE_ON_30_NOVEMBER = Date.UTC(2026, 11, 1, 5, 30);
const NOON_22_NOVEMBER = Date.UTC(2026, 10, 22, 18, 0);

it("23:30 on 30 November in Chicago is still November, though UTC is in December", () => {
  expect(new Date(LATE_ON_30_NOVEMBER).toISOString().slice(0, 10)).toBe("2026-12-01");
  expect(chicagoDate(LATE_ON_30_NOVEMBER)).toBe("2026-11-30");
  expect(chicagoMonth(LATE_ON_30_NOVEMBER)).toBe("2026-11");
});

it("noon on 22 November in Chicago is the date 2026-11-22", () => {
  expect(chicagoDate(NOON_22_NOVEMBER)).toBe("2026-11-22");
  expect(chicagoMonth(NOON_22_NOVEMBER)).toBe("2026-11");
});

it.each([
  ["2026-11", 2, "2027-01"],
  ["2026-01", -2, "2025-11"],
  ["2026-11", 0, "2026-11"],
  ["2026-12", 1, "2027-01"],
  ["2024-11", 24, "2026-11"],
  ["2026-11", -24, "2024-11"],
])("addMonths(%s, %i) is %s", (month, n, want) => {
  expect(addMonths(month, n)).toBe(want);
});

it.each(["2026-13", "2026-00", "2026-1", "26-11", "", "2026-11-22", " 2026-11"])(
  "the bad month %j throws a RangeError",
  (bad) => {
    expect(() => addMonths(bad, 1)).toThrow(RangeError);
    expect(() => monthIndex(bad)).toThrow(RangeError);
    expect(() => monthLabel(bad)).toThrow(RangeError);
    expect(() => monthRange(bad, 2)).toThrow(RangeError);
  },
);

it("a step that is not a whole number of months throws a RangeError", () => {
  expect(() => addMonths("2026-11", 1.5)).toThrow(RangeError);
});

it("monthRange counts forward from the first month", () => {
  expect(monthRange("2026-11", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  expect(monthRange("2024-11", 24)).toHaveLength(24);
  expect(monthRange("2024-11", 24).at(-1)).toBe("2026-10");
  expect(monthRange("2026-11", 0)).toEqual([]);
});

it("monthIndex is 0 for January and 11 for December", () => {
  expect(monthIndex("2027-01")).toBe(0);
  expect(monthIndex("2026-05")).toBe(4);
  expect(monthIndex("2026-12")).toBe(11);
});

it("labels use fixed English month names", () => {
  expect(monthLabel("2026-11")).toBe("November 2026");
  expect(monthLabel("2027-01")).toBe("January 2027");
  expect(dateLabel("2026-11-30")).toBe("30 November 2026");
  expect(dateLabel("2027-05-01")).toBe("1 May 2027");
});

it("daysBetween counts whole days, to minus from", () => {
  expect(daysBetween("2026-11-22", "2026-11-30")).toBe(8);
  expect(daysBetween("2026-11-30", "2026-11-22")).toBe(-8);
  expect(daysBetween("2026-11-22", "2026-11-22")).toBe(0);
  expect(daysBetween("2026-12-23", "2027-01-31")).toBe(39);
  expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
  expect(daysBetween("2026-11-22", "2027-05-31")).toBe(190);
});

it.each(["2026-11-31", "2026-02-29", "2026-11-3", "30 November 2026", "2026-11"])(
  "the bad date %j throws a RangeError",
  (bad) => {
    expect(() => daysBetween(bad, "2026-11-30")).toThrow(RangeError);
    expect(() => daysBetween("2026-11-30", bad)).toThrow(RangeError);
    expect(() => dateLabel(bad)).toThrow(RangeError);
  },
);
