import { describe, it, expect } from "vitest";
import { computeTrend } from "../trend";
import { buildBuckets } from "../buckets";
import type { RawStatsData } from "../model";

const call = { id: "call", code: "CALL", defaultHours: 24, countsTowardFte: true, isLeave: false, isOffShift: false };

const raw: RawStatsData = {
  providers: [
    { id: "p1", initials: "AA", name: "Alice", ftePercentage: 1.0, isActive: true, isAutoScheduled: true, employmentTypeName: "FTE", eligibleShiftTypeIds: [] },
    { id: "p2", initials: "BB", name: "Bob", ftePercentage: 1.0, isActive: true, isAutoScheduled: true, employmentTypeName: "FTE", eligibleShiftTypeIds: [] },
  ],
  assignments: [
    { providerId: "p1", shiftTypeId: "call", date: "2026-06-03", shiftType: call },
    { providerId: "p2", shiftTypeId: "call", date: "2026-06-10", shiftType: call },
    { providerId: "p1", shiftTypeId: "call", date: "2026-07-03", shiftType: call },
  ],
  shiftTypes: [{ id: "call", countsTowardFte: true, countsOnWeekend: true, defaultHours: 24 }],
  desirabilityWeights: [],
  holidays: [],
  equityFactors: [],
  overrides: [],
};

describe("computeTrend", () => {
  it("produces one line per included provider and one point per month bucket", () => {
    const dates = raw.assignments.map((a) => a.date);
    const buckets = buildBuckets(dates, "month", []);
    const { points, lines } = computeTrend(raw, buckets, "hours", {}, ["p1", "p2"], []);

    expect(lines).toEqual([
      { id: "p1", initials: "AA" },
      { id: "p2", initials: "BB" },
    ]);
    expect(points).toEqual([
      { bucket: "Jun 2026", AA: 24, BB: 24 },
      { bucket: "Jul 2026", AA: 24, BB: 0 }, // Bob worked no July shift
    ]);
  });

  it("only plots the requested providers", () => {
    const buckets = buildBuckets(["2026-06-03"], "month", []);
    const { lines, points } = computeTrend(raw, buckets, "hours", {}, ["p1"], []);
    expect(lines).toEqual([{ id: "p1", initials: "AA" }]);
    expect(points[0]).toEqual({ bucket: "Jun 2026", AA: 24 });
  });
});
