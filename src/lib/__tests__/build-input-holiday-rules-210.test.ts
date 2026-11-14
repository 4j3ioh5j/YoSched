import { describe, it, expect, vi, beforeEach } from "vitest";

// Card #210: the input bundle carries the holiday rules, each holiday's type, and (only when a rule
// reaches past the run's end) the read-only cells just after it — nothing extra without rules.

const db = vi.hoisted(() => ({ withRules: false, calls: [] as { where: unknown }[] }));
const D = (s: string) => new Date(s + "T00:00:00Z");

vi.mock("@/lib/pay-periods-server", () => ({ getPayPeriods: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const empty = { findMany: async () => [], findFirst: async () => null };
  const holiday = { findMany: async () => [{ id: "h1", date: D("2026-11-26"), name: "Thanksgiving Day", holidayTypeId: "tg" }] };
  const holidayRule = { findMany: async () => (db.withRules ? [
    { id: "r2", name: "Thanksgiving 2", holidayTypeId: "tg", sortOrder: 1, days: [{ offset: 1, shiftTypeId: "st-orc" }, { offset: 3, shiftTypeId: "st-call" }] },
  ] : []) };
  const assignment = { findMany: async (a: { where: unknown }) => { db.calls.push({ where: a.where }); return JSON.stringify(a.where).includes('"gt"')
    ? [{ staffId: "br", date: D("2026-11-29"), shiftTypeId: "st-call", isLocked: false, source: "manual" }] : []; } };
  const shiftType = { findMany: async () => [{ id: "st-call", code: "CALL" }] };
  const prisma = new Proxy({ holiday, holidayRule, assignment, shiftType } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? empty });
  return { prisma };
});

import { buildAutoScheduleInput } from "../build-auto-schedule-input";

const PPS = [{ startDate: D("2026-11-15"), endDate: D("2026-11-28"), targetHours: 80 }];
const build = () => buildAutoScheduleInput("2026-11-15", "2026-11-28", { payPeriods: PPS as never });

beforeEach(() => { db.withRules = false; db.calls = []; });

describe("input bundle for card #210", () => {
  it("holidays carry their type even without rules; no rules, no context read", async () => {
    const input = await build();
    expect(input.holidays).toEqual([{ date: "2026-11-26", holidayTypeId: "tg" }]);
    expect(input.holidayRules).toBeUndefined();
    expect(input.holidayRuleContext).toBeUndefined();
    expect(db.calls.some((c) => JSON.stringify(c.where).includes('"gt"'))).toBe(false);
  });

  it("with rules: the rules, and the cells up to the longest reach after the run's end", async () => {
    db.withRules = true;
    const input = await build();
    expect(input.holidayRules?.map((r) => r.name)).toEqual(["Thanksgiving 2"]);
    expect(input.holidayRuleContext).toEqual([{ staffId: "br", date: "2026-11-29", shiftTypeId: "st-call", code: "CALL", isLocked: false, source: "manual" }]);
    const ctx = db.calls.find((c) => JSON.stringify(c.where).includes('"gt"'))!.where as { date: { gt: Date; lte: Date } };
    expect(ctx.date.gt.toISOString().slice(0, 10)).toBe("2026-11-28");
    expect(ctx.date.lte.toISOString().slice(0, 10)).toBe("2026-12-01"); // 3 days: the furthest rule day
  });
});
