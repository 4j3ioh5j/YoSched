import { describe, it, expect } from "vitest";
import { applyScenario, type ScenarioPin, type ScenarioFree } from "../scenario";
import { type AutoScheduleInput, type ScheduleStaff, type ScheduleShiftType } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

// ─── fixtures (mirrors auto-scheduler.test.ts) ───

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));

function makeStaff(id: string, initials: string, overrides: Partial<ScheduleStaff> = {}): ScheduleStaff {
  return {
    id,
    initials,
    ftePercentage: 1,
    eligibleShiftTypeIds: ["st-or", "st-off"],
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({
      type: "available" as const,
      strength: "rule" as const,
      ...wEvery(d),
    })),
    isActive: true,
    isAutoScheduled: true,
    specialQualifications: [],
    ...overrides,
  };
}

function makeShift(id: string, code: string, overrides: Partial<ScheduleShiftType> = {}): ScheduleShiftType {
  return {
    id,
    code,
    name: code,
    defaultHours: 8,
    defaultHoursWeekend: 0,
    defaultHoursHoliday: 0,
    countsTowardFte: true,
    countsAsHolidayWork: true,
    isLeave: false,
    isOffShift: false,
    isFillShift: false,
    sortOrder: 0,
    schedulePriority: null,
    weekendPaired: false,
    holidayWeekendPaired: false,
    ignoresWorkingDays: false,
    maxPerDay: null,
    category: "clinical",
    autoSchedulable: true,
    ...overrides,
  };
}

const OFF = makeShift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = makeShift("st-or", "OR", { schedulePriority: 1, isFillShift: true });

const defaultPrefs = {
  prefer3DayWeekends: false,
  prefer4DayWeekends: false,
  preferSequentialOff: false,
  sequentialOffWeight: 1,
  threeDayWeekendWeight: 2,
  fourDayWeekendWeight: 3,
};

const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"]; // Mon–Fri

function makeInput(overrides: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return {
    dates: DATES,
    staff: [makeStaff("p1", "AB"), makeStaff("p2", "CD")],
    shiftTypes: [OR, OFF],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
    holidays: [],
    desirabilityWeights: [],
    standingCommitments: [],
    staffOverrides: [],
    dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [],
    schedulingPreferences: defaultPrefs,
    equityFactors: [],
    followRules: [],
    ...overrides,
  };
}

const lockedOR = (staffId: string, date: string) => ({
  staffId,
  date,
  shiftTypeId: "st-or",
  code: "OR",
  isLocked: true,
});

const cellAt = (grid: { staffId: string; date: string; shiftTypeId: string }[], staffId: string, date: string) =>
  grid.find((c) => c.staffId === staffId && c.date === date)?.shiftTypeId;

// ─── tests ───

describe("applyScenario — constrained re-solve", () => {
  it("locks a complete baseline: no frees/pins ⇒ zero ripple (full freeze)", () => {
    // A complete locked grid (both staff, all days) has no holes to fill.
    const baseline = DATES.flatMap((d) => [lockedOR("p1", d), lockedOR("p2", d)]);
    const out = applyScenario(makeInput({ existingAssignments: baseline }), [], []);

    expect(out.applied).toBe(true);
    expect(out.changes).toEqual([]);
    for (const d of DATES) expect(cellAt(out.grid, "p1", d)).toBe("st-or");
  });

  it("a pin lands as a locked cell in the result grid", () => {
    const out = applyScenario(makeInput(), [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or" }], []);

    expect(out.applied).toBe(true);
    expect(cellAt(out.grid, "p1", "2025-05-12")).toBe("st-or");
    const change = out.changes.find((c) => c.staffId === "p1" && c.date === "2025-05-12");
    expect(change?.before).toBeNull();
    expect(change?.after?.shiftTypeId).toBe("st-or");
  });

  it("freeing a cell opens it for re-solve and coverage is preserved", () => {
    // Monday (dow=1) needs ≥1 OR. Free p1's Monday — the engine re-solves the
    // hole and keeps coverage (it may re-place p1 or pick someone else).
    const baseline = [lockedOR("p1", "2025-05-12")];
    const input = makeInput({
      existingAssignments: baseline,
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
    });
    const out = applyScenario(input, [], [{ staffId: "p1", date: "2025-05-12" }]);

    expect(out.applied).toBe(true);
    const mondayOR = out.grid.filter((c) => c.date === "2025-05-12" && c.shiftTypeId === "st-or");
    expect(mondayOR.length).toBeGreaterThanOrEqual(1);
  });

  it("a true move ripples only the disturbed cells, not a rebuild", () => {
    // p1 has OR all week (locked). Move Monday's OR to p2 (pin p2 Mon, free p1 Mon).
    const baseline = DATES.map((d) => lockedOR("p1", d));
    const input = makeInput({ existingAssignments: baseline });
    const pins: ScenarioPin[] = [{ staffId: "p2", date: "2025-05-12", shiftTypeId: "st-or" }];
    const frees: ScenarioFree[] = [{ staffId: "p1", date: "2025-05-12" }];
    const out = applyScenario(input, pins, frees);

    expect(out.applied).toBe(true);
    // p2 now holds Monday; p1's other four days are untouched.
    expect(cellAt(out.grid, "p2", "2025-05-12")).toBe("st-or");
    for (const d of DATES.slice(1)) expect(cellAt(out.grid, "p1", d)).toBe("st-or");
    // The ripple is bounded — only Monday's two staff changed (plus any backfill),
    // never the whole grid (10 cells).
    expect(out.changes.length).toBeLessThan(DATES.length * 2);
    expect(out.changes.length).toBeGreaterThan(0);
  });
});

describe("applyScenario — HYBRID breach classification", () => {
  it("rejects a HARD-illegal pin (ineligible shift) and applies NOTHING", () => {
    // p1 is only eligible for st-or/st-off; pin them on a shift they can't hold.
    const PT = makeShift("st-pt", "PT");
    const baseline = [lockedOR("p1", "2025-05-12")];
    const input = makeInput({ shiftTypes: [OR, OFF, PT], existingAssignments: baseline });
    const out = applyScenario(input, [{ staffId: "p1", date: "2025-05-13", shiftTypeId: "st-pt" }], []);

    expect(out.applied).toBe(false);
    expect(out.changes).toEqual([]);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ staffId: "p1", date: "2025-05-13", reason: "ineligible" });
    // Grid is the untouched baseline.
    expect(cellAt(out.grid, "p1", "2025-05-12")).toBe("st-or");
  });

  it("rejects a pin on an unavailable date (weekend, not a working day)", () => {
    // Saturday 2025-05-17 is outside p1's Mon–Fri availability rules.
    const out = applyScenario(makeInput(), [{ staffId: "p1", date: "2025-05-17", shiftTypeId: "st-or" }], []);

    expect(out.applied).toBe(false);
    expect(out.rejected[0]).toMatchObject({ staffId: "p1", date: "2025-05-17", reason: "unavailable" });
  });

  it("rejects a pin onto an approved hard OFF request (request-blocked)", () => {
    // p1 has approved time off Monday — pinning them on a working shift is HARD-illegal.
    const input = makeInput({
      scheduleRequests: [
        {
          id: "req-off",
          staffId: "p1",
          startDate: "2025-05-12",
          endDate: "2025-05-12",
          kind: "OFF",
          shiftTypeIds: [],
          leaveShiftTypeId: null,
          strength: "hard",
          status: "approved",
        },
      ],
    });
    const out = applyScenario(input, [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or" }], []);

    expect(out.applied).toBe(false);
    expect(out.rejected[0]).toMatchObject({ staffId: "p1", date: "2025-05-12", reason: "request-blocked" });
  });

  it("rejects a pin onto a hard NEGATE_SHIFT for that shift (request-blocked)", () => {
    // p1 asked NOT to be given OR on Monday (approved) — pinning OR there snaps back.
    const input = makeInput({
      scheduleRequests: [
        {
          id: "req-neg",
          staffId: "p1",
          startDate: "2025-05-12",
          endDate: "2025-05-12",
          kind: "NEGATE_SHIFT",
          shiftTypeIds: ["st-or"],
          leaveShiftTypeId: null,
          strength: "hard",
          status: "approved",
        },
      ],
    });
    const out = applyScenario(input, [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or" }], []);

    expect(out.applied).toBe(false);
    expect(out.rejected[0].reason).toBe("request-blocked");
  });

  it("rejects a working pin onto an approved hard LEAVE day (request-blocked)", () => {
    // The engine enforces hard LEAVE by pre-placing the leave cell; a standalone
    // pin check must block working pins on that day itself.
    const leaveReq = {
      id: "req-leave",
      staffId: "p1",
      startDate: "2025-05-12",
      endDate: "2025-05-12",
      kind: "LEAVE" as const,
      shiftTypeIds: [],
      leaveShiftTypeId: "st-leave",
      strength: "hard" as const,
      status: "approved" as const,
    };
    const input = makeInput({ scheduleRequests: [leaveReq] });
    const working = applyScenario(input, [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or" }], []);

    expect(working.applied).toBe(false);
    expect(working.rejected[0].reason).toBe("request-blocked");

    // …but pinning OFF on the leave day is NOT over-blocked (they're off anyway).
    const off = applyScenario(input, [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-off" }], []);
    expect(off.rejected.find((r) => r.reason === "request-blocked")).toBeUndefined();
  });

  it("allows a SOFT breach (coverage below floor) and surfaces it as a warning", () => {
    // Require 2 OR on Monday (dow=1) but only one staff member — slot 2 can't fill.
    const input = makeInput({
      staff: [makeStaff("p1", "AB")],
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 2 }],
    });
    const out = applyScenario(input, [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or" }], []);

    // Still applied (soft, not snap-back) and the shortfall shows up softly.
    expect(out.applied).toBe(true);
    expect(out.rejected).toEqual([]);
    expect(out.softWarnings.length).toBeGreaterThan(0);
  });

  it("reports unknown staff / shift ids as rejections", () => {
    const out = applyScenario(makeInput(), [{ staffId: "ghost", date: "2025-05-12", shiftTypeId: "st-or" }], []);
    expect(out.applied).toBe(false);
    expect(out.rejected[0].reason).toBe("unknown-staff");
  });
});

describe("applyScenario — quality delta & purity", () => {
  it("qualityDelta is 0 for a no-op scenario (parity with baseline)", () => {
    const baseline = DATES.map((d) => lockedOR("p1", d));
    const out = applyScenario(makeInput({ existingAssignments: baseline }), [], []);
    expect(out.qualityDelta).toBe(0);
  });

  it("does not mutate the caller's input", () => {
    const baseline = [lockedOR("p1", "2025-05-12")];
    const input = makeInput({ existingAssignments: baseline });
    const before = JSON.stringify(input);
    applyScenario(input, [{ staffId: "p2", date: "2025-05-13", shiftTypeId: "st-or" }], [{ staffId: "p1", date: "2025-05-12" }]);
    expect(JSON.stringify(input)).toBe(before);
  });
});
