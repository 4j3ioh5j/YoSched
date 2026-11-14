import { describe, it, expect } from "vitest";
import { isHolidayCreditShift, resolveHolidayShift } from "../holiday-policy";

// Card #207: one predicate for what may be the holiday shift; lookups by id, never by code.

const s = (id: string, code: string, o: Partial<{ countsTowardFte: boolean; isLeave: boolean; isOffShift: boolean; printBackgroundColor: string | null }> = {}) =>
  ({ id, code, countsTowardFte: true, isLeave: true, isOffShift: false, printBackgroundColor: null as string | null, ...o });

describe("isHolidayCreditShift", () => {
  it("only a leave shift that counts toward hours and is not an off shift", () => {
    expect(isHolidayCreditShift(s("a", "HOL"))).toBe(true);
    expect(isHolidayCreditShift(s("b", "ORC", { isLeave: false }))).toBe(false);
    expect(isHolidayCreditShift(s("c", "LWOP", { countsTowardFte: false }))).toBe(false);
    expect(isHolidayCreditShift(s("d", "X", { isOffShift: true }))).toBe(false);
  });
});

describe("resolveHolidayShift", () => {
  const shifts = [s("st-hol", "HOLX"), s("st-decoy", "HOL"), s("st-work", "ORC", { isLeave: false })];
  it("finds the chosen shift by id even when renamed, never a different shift coded HOL", () => {
    expect(resolveHolidayShift(shifts, "st-hol")?.code).toBe("HOLX");
  });
  it("null, undefined, unknown or no-longer-valid → null", () => {
    expect(resolveHolidayShift(shifts, null)).toBeNull();
    expect(resolveHolidayShift(shifts, undefined)).toBeNull();
    expect(resolveHolidayShift(shifts, "st-gone")).toBeNull();
    expect(resolveHolidayShift(shifts, "st-work")).toBeNull();
  });
});
