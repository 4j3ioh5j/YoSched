// Card #320: one time zone for every time YoSched shows or asks for.
import { describe, it, expect } from "vitest";
import { resolveZone, formatClock, zonedSlot, convertWallTime, zoneChoices, wallClock } from "../time-zone";

const LA = "America/Los_Angeles";

describe("resolveZone", () => {
  it("keeps a valid IANA zone", () => {
    expect(resolveZone(LA)).toBe(LA);
    expect(resolveZone("Asia/Kolkata")).toBe("Asia/Kolkata");
  });
  it("null, empty, junk → UTC", () => {
    for (const v of [null, undefined, "", "Mars/Olympus", 5, "UTC; drop"]) expect(resolveZone(v)).toBe("UTC");
  });
});

describe("zoneChoices", () => {
  it("includes UTC explicitly (the rollback target) and LA", () => {
    const z = zoneChoices();
    expect(z).toContain("UTC");
    expect(z).toContain(LA);
    expect(new Set(z).size).toBe(z.length);
  });
});

describe("formatClock", () => {
  it("24-hour with the zone label", () => {
    expect(formatClock(new Date("2026-01-15T01:00:00Z"), LA)).toBe("17:00 PST");
    expect(formatClock(new Date("2026-07-15T00:00:00Z"), LA)).toBe("17:00 PDT");
    expect(formatClock(new Date("2026-07-15T00:05:00Z"), "UTC")).toBe("00:05 UTC");
    expect(formatClock(new Date("2026-01-15T12:00:00Z"), "Asia/Kolkata")).toMatch(/^17:30 /);
  });
  it("midnight is 00, never 24", () => {
    expect(formatClock(new Date("2026-01-15T08:00:00Z"), LA)).toBe("00:00 PST");
  });
});

describe("wallClock", () => {
  it("date and time parts come from the same zoned instant (no midnight mismatch)", () => {
    // 23:59 PST on 2026-01-14 is 07:59Z on the 15th.
    expect(wallClock(new Date("2026-01-15T07:59:00Z"), LA)).toEqual({ year: 2026, month: 1, day: 14, hour: 23, minute: 59 });
  });
});

describe("zonedSlot", () => {
  it("latest instant at or before now whose wall clock is HH:MM", () => {
    // Winter: 17:00 LA = 01:00Z next day.
    expect(zonedSlot(new Date("2026-01-15T02:00:00Z"), "17:00", LA).toISOString()).toBe("2026-01-15T01:00:00.000Z");
    expect(zonedSlot(new Date("2026-01-15T00:59:00Z"), "17:00", LA).toISOString()).toBe("2026-01-14T01:00:00.000Z");
    // Summer: 17:00 LA = 00:00Z.
    expect(zonedSlot(new Date("2026-07-15T00:00:00Z"), "17:00", LA).toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });
  it("UTC behaves like the old server-local slot", () => {
    expect(zonedSlot(new Date("2026-01-15T01:30:00Z"), "01:00", "UTC").toISOString()).toBe("2026-01-15T01:00:00.000Z");
    expect(zonedSlot(new Date("2026-01-15T00:30:00Z"), "01:00", "UTC").toISOString()).toBe("2026-01-14T01:00:00.000Z");
  });
  it("half-hour zone", () => {
    expect(zonedSlot(new Date("2026-01-15T12:00:00Z"), "17:30", "Asia/Kolkata").toISOString()).toBe("2026-01-15T12:00:00.000Z");
  });
  it("spring-forward gap: 02:30 on 2026-03-08 does not exist in LA → first valid minute after (03:00 PDT)", () => {
    expect(zonedSlot(new Date("2026-03-08T12:00:00Z"), "02:30", LA).toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });
  it("fall-back overlap: 01:30 on 2026-11-01 happens twice in LA → the first (PDT)", () => {
    expect(zonedSlot(new Date("2026-11-01T12:00:00Z"), "01:30", LA).toISOString()).toBe("2026-11-01T08:30:00.000Z");
  });
  it("one slot per calendar day across DST changes", () => {
    const a = zonedSlot(new Date("2026-03-09T03:00:00Z"), "17:00", LA); // after 17:00 PDT on Mar 8
    const b = zonedSlot(new Date("2026-03-08T01:30:00Z"), "17:00", LA); // after 17:00 PST on Mar 7
    expect(a.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    expect(b.toISOString()).toBe("2026-03-08T01:00:00.000Z");
  });
});

describe("convertWallTime", () => {
  it("keeps the moment when the zone changes", () => {
    expect(convertWallTime("01:00", "UTC", LA, new Date("2026-11-17T05:00:00Z"))).toBe("17:00");
    expect(convertWallTime("17:00", LA, "UTC", new Date("2026-11-17T05:00:00Z"))).toBe("01:00");
    expect(convertWallTime("01:00", "UTC", LA, new Date("2026-07-01T05:00:00Z"))).toBe("18:00");
    expect(convertWallTime("01:00", "UTC", "UTC", new Date())).toBe("01:00");
  });
  it("the next due instant is the same before and after a zone change", () => {
    const at = new Date("2026-11-17T05:00:00Z");
    const next = (now: Date, t: string, z: string) => new Date(zonedSlot(now, t, z).getTime() + 0);
    const lt = convertWallTime("01:00", "UTC", LA, at);
    // The latest slot at or before a later time is the same instant in both settings.
    const later = new Date("2026-11-18T02:00:00Z");
    expect(next(later, lt, LA).toISOString()).toBe(next(later, "01:00", "UTC").toISOString());
  });
});

import { zonedCalendarDate, clockHHMM } from "../time-zone";
describe("zonedCalendarDate / clockHHMM", () => {
  it("23:59 PST on the 14th is the 14th, even though it is the 15th in UTC", () => {
    const at = new Date("2026-01-15T07:59:00Z");
    const z = zonedCalendarDate(at, LA);
    expect([z.getFullYear(), z.getMonth() + 1, z.getDate()]).toEqual([2026, 1, 14]);
    expect(clockHHMM(at, LA)).toBe("23:59");
    const u = zonedCalendarDate(at, "UTC");
    expect(u.getDate()).toBe(15);
  });
});
