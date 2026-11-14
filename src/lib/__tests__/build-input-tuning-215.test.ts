import { describe, it, expect, vi, beforeEach } from "vitest";

// Card #215: the input bundle carries the scheduler tuning from Settings (lenient: a bad stored
// value is the default), and the "spread out" forward context reaches as far as the spacing
// reach — never a fixed two weeks.

const db = vi.hoisted(() => ({ prefs: null as Record<string, unknown> | null, calls: [] as { where: unknown }[] }));
const D = (s: string) => new Date(s + "T00:00:00Z");

vi.mock("@/lib/pay-periods-server", () => ({ getPayPeriods: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const empty = { findMany: async () => [], findFirst: async () => null };
  const assignment = { findMany: async (a: { where: unknown }) => { db.calls.push({ where: a.where }); return []; } };
  const shiftType = { findMany: async () => [{ id: "st-call", code: "CALL", spreadOverMonth: true }] };
  const schedulingPreferences = { findFirst: async () => db.prefs };
  const prisma = new Proxy({ assignment, shiftType, schedulingPreferences } as Record<string, unknown>, { get: (t, k: string) => t[k] ?? empty });
  return { prisma };
});

import { buildAutoScheduleInput } from "../build-auto-schedule-input";
import { TUNING_DEFAULTS } from "../scheduler-tuning";

const PPS = [{ startDate: D("2026-11-15"), endDate: D("2026-11-28"), targetHours: 80 }];
const build = () => buildAutoScheduleInput("2026-11-15", "2026-11-28", { payPeriods: PPS as never });
const spreadReadEnd = () => {
  const c = db.calls.find((x) => JSON.stringify(x.where).includes('"gt"'))!.where as { date: { gt: Date; lte: Date } };
  return [c.date.gt.toISOString().slice(0, 10), c.date.lte.toISOString().slice(0, 10)];
};

beforeEach(() => { db.prefs = null; db.calls = []; });

describe("input bundle for card #215", () => {
  it("no saved row: the defaults, and the spread context reads 14 days past the run", async () => {
    const input = await build();
    expect(input.schedulingPreferences).toMatchObject(TUNING_DEFAULTS);
    expect(spreadReadEnd()).toEqual(["2026-11-28", "2026-12-12"]);
  });

  it("a saved reach of 20 reads 20 days; the other values pass through; a corrupt one is the default", async () => {
    db.prefs = { id: "default", spreadRadiusDays: 20, evenBandCalls: 2, softRequestOffWeight: 0, softAvoidFollowWeight: 7, scarcePoolSize: 99, weekendStartDow: 5 };
    const input = await build();
    expect(spreadReadEnd()).toEqual(["2026-11-28", "2026-12-18"]);
    expect(input.schedulingPreferences).toMatchObject({ spreadRadiusDays: 20, evenBandCalls: 2, softRequestOffWeight: 0, softAvoidFollowWeight: 7, scarcePoolSize: TUNING_DEFAULTS.scarcePoolSize, weekendStartDow: 5 });
  });
});
