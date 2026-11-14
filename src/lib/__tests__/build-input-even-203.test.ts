import { describe, it, expect, vi, beforeEach } from "vitest";

// Card #203: the input bundle carries what "Keep counts even across months" and the spacing
// check need — and nothing extra when neither is on.

const db = vi.hoisted(() => ({
  even: false, spread: false, from: null as string | null,
  calls: [] as { model: string; where: unknown }[],
}));
const D = (s: string) => new Date(s + "T00:00:00Z");

vi.mock("@/lib/pay-periods-server", () => ({ getPayPeriods: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const empty = { findMany: async () => [], findFirst: async () => null };
  const shiftType = {
    findMany: async () => [{
      id: "st-call", code: "CALL", name: "CALL", defaultHours: 12, defaultHoursWeekend: null, defaultHoursHoliday: null,
      countsTowardFte: true, countsAsHolidayWork: false, isLeave: false, isOffShift: false, isFillShift: false, sortOrder: 0,
      schedulePriority: 1, weekendPaired: false, holidayWeekendPaired: false, ignoresWorkingDays: false, category: null,
      autoSchedulable: true, spreadOverMonth: db.spread, evenAcrossMonths: db.even,
    }],
  };
  const staff = {
    findMany: async () => [{
      id: "br", initials: "BR", isActive: true, isAutoScheduled: true, ftePercentage: 1, createdAt: new Date("2027-01-10T15:30:00Z"),
      tempStartDate: D("2027-01-15"), tempEndDate: null,
      employmentType: { usesFtePercentage: true, includedInFairness: true, defaultFtePercentage: 1 },
    }],
  };
  const staffEligibleShift = { findMany: async () => [
    { staffId: "br", shiftTypeId: "st-call", eligibleSince: new Date("2027-01-20T09:00:00Z") },
    { staffId: "br", shiftTypeId: "st-orc", eligibleSince: null }, // legacy row: no tick date
  ] };
  const schedulingPreferences = { findFirst: async () => ({ id: "default", shiftBalanceFrom: db.from ? D(db.from) : null, holidayShiftId: "st-hol" }) };
  const scheduleRequest = { findMany: async (a: { where: unknown }) => { db.calls.push({ model: "scheduleRequest", where: a.where }); return [
    { id: "r1", staffId: "br", startDate: D("2027-02-03"), endDate: D("2027-02-03"), kind: "off", shiftTypeIds: [], leaveShiftTypeId: null, strength: "hard", status: "approved" },
  ]; } };
  const assignment = { findMany: async (a: { where: unknown }) => { db.calls.push({ model: "assignment", where: a.where }); return JSON.stringify(a.where).includes('"gt"')
    ? [{ staffId: "br", date: D("2027-02-10"), shiftTypeId: "st-call", isLocked: false, source: "manual" }] : []; } };
  const prisma = new Proxy({ shiftType, staff, staffEligibleShift, schedulingPreferences, scheduleRequest, assignment } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? empty,
  });
  return { prisma };
});

import { buildAutoScheduleInput } from "../build-auto-schedule-input";

const PPS = [
  { startDate: D("2026-12-20"), endDate: D("2027-01-02") },
  { startDate: D("2027-01-03"), endDate: D("2027-01-16") },
  { startDate: D("2027-01-17"), endDate: D("2027-01-30") },
];
const build = () => buildAutoScheduleInput("2027-01-17", "2027-01-30", { payPeriods: PPS as never });

beforeEach(() => { db.even = false; db.spread = false; db.from = null; db.calls = []; });

describe("input bundle for card #203", () => {
  it("off: no balance requests, pay periods or spread context, and no extra reads", async () => {
    const input = await build();
    expect(input.balanceRequests).toBeUndefined();
    expect(input.balancePayPeriods).toBeUndefined();
    expect(input.spreadContext).toBeUndefined();
    expect(input.schedulingPreferences.shiftBalanceFrom).toBeNull();
    expect(db.calls.filter((c) => JSON.stringify(c.where).includes('"gt"'))).toEqual([]);
  });

  it("ticked but no start date: still off (each month on its own)", async () => {
    db.even = true;
    const input = await build();
    expect(input.balanceRequests).toBeUndefined();
    expect(input.shiftTypes[0].evenAcrossMonths).toBe(true);
  });

  it("on: the start date, approved requests from it, pay periods from it, and the joining dates", async () => {
    db.even = true; db.from = "2027-01-03";
    const input = await build();
    expect(input.schedulingPreferences.shiftBalanceFrom).toBe("2027-01-03");
    expect(input.balancePayPeriods).toEqual([
      { startDate: "2027-01-03", endDate: "2027-01-16" },
      { startDate: "2027-01-17", endDate: "2027-01-30" },
    ]);
    expect(input.balanceRequests).toEqual([expect.objectContaining({ id: "r1", startDate: "2027-02-03", kind: "off", strength: "hard" })]);
    const reqWhere = db.calls.find((c) => c.model === "scheduleRequest" && JSON.stringify(c.where).includes('"approved"') && !JSON.stringify(c.where).includes("pending"))!.where;
    expect(reqWhere).toEqual({ status: "approved", startDate: { lte: D("2027-01-30") }, endDate: { gte: D("2027-01-03") } });
    expect(input.staff[0]).toMatchObject({ createdOn: "2027-01-10", tempStartDate: "2027-01-15", tempEndDate: null, eligibleSince: { "st-call": "2027-01-20" } });
  });

  it("start date older than the stored pay periods: ranges are extended back to it (yearly rollover)", async () => {
    db.even = true; db.from = "2026-11-25";
    const input = await build();
    expect(input.balancePayPeriods?.slice(0, 3)).toEqual([
      { startDate: "2026-11-22", endDate: "2026-12-05" },
      { startDate: "2026-12-06", endDate: "2026-12-19" },
      { startDate: "2026-12-20", endDate: "2027-01-02" },
    ]);
  });

  it("spread on: the two weeks after the range are read as context", async () => {
    db.spread = true;
    const input = await build();
    expect(input.spreadContext).toEqual([{ staffId: "br", date: "2027-02-10", shiftTypeId: "st-call", code: "CALL", isLocked: false, source: "manual" }]);
    const w = db.calls.find((c) => JSON.stringify(c.where).includes('"gt"'))!.where;
    expect(w).toEqual({ date: { gt: D("2027-01-30"), lte: D("2027-02-13") } });
  });
});

describe("input bundle for card #207", () => {
  it("passes the chosen holiday shift id through to the engine", async () => {
    const input = await build();
    expect(input.schedulingPreferences.holidayShiftId).toBe("st-hol");
  });
});
