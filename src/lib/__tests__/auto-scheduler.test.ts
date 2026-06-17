import { describe, it, expect } from "vitest";
import { daysBetween, bestSpread, autoSchedule, maxReachableDailyHours, type ScheduleStaff, type ScheduleShiftType, type AutoScheduleResult } from "../auto-scheduler";
import { type ScheduleRequestData } from "../schedule-requests";
import { whenToColumns, legacyPatternToWhen, standingToWhen } from "../recurrence";

// ─── helpers ───

// WHEN columns for a plain "every occurrence of weekday d" rule (slice 7: rules
// are WHEN-only). sw() derives WHEN columns for a standing commitment from its
// former legacy dayOfWeek + frequency shape.
const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const sw = (dayOfWeek: number | null, frequency: string) => whenToColumns(standingToWhen({ dayOfWeek, frequency }));

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
    countsTowardFte: true,
    countsOnWeekend: false,
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

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + "T12:00:00");
  while (dates.length < count) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function runSchedule(overrides: Record<string, unknown> = {}): AutoScheduleResult {
  return autoSchedule({
    dates: weekdayDates("2025-05-12", 5),
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
  });
}

// ─── daysBetween ───

describe("daysBetween", () => {
  it("returns 0 for the same date", () => {
    expect(daysBetween("2025-05-12", "2025-05-12")).toBe(0);
  });

  it("returns positive for adjacent dates", () => {
    expect(daysBetween("2025-05-12", "2025-05-13")).toBe(1);
  });

  it("is symmetric", () => {
    expect(daysBetween("2025-05-12", "2025-05-20")).toBe(daysBetween("2025-05-20", "2025-05-12"));
  });

  it("handles cross-month", () => {
    expect(daysBetween("2025-05-30", "2025-06-02")).toBe(3);
  });
});

// ─── bestSpread ───

describe("bestSpread", () => {
  const alwaysValid = () => true;

  it("returns all candidates when count >= length", () => {
    const result = bestSpread(["2025-05-12", "2025-05-13"], 5, [], alwaysValid);
    expect(result).toEqual(["2025-05-12", "2025-05-13"]);
  });

  it("picks maximally spread dates", () => {
    const candidates = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
    const result = bestSpread(candidates, 2, [], alwaysValid);
    // Should pick the two endpoints for max gap (4 days)
    expect(result).toEqual(["2025-05-12", "2025-05-16"]);
  });

  it("respects anchors when spreading", () => {
    const candidates = ["2025-05-13", "2025-05-14", "2025-05-15"];
    // Anchor at 2025-05-12, so picking 2025-05-13 would be gap=1 from anchor
    // Picking 2025-05-15 maximizes min gap (3 from anchor)
    const result = bestSpread(candidates, 1, ["2025-05-12"], alwaysValid);
    expect(result).toEqual(["2025-05-15"]);
  });

  it("respects validity filter", () => {
    const candidates = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
    // Block the endpoints
    const isValid = (_picked: string[], next: string) => next !== "2025-05-12" && next !== "2025-05-16";
    const result = bestSpread(candidates, 2, [], isValid);
    expect(result).not.toContain("2025-05-12");
    expect(result).not.toContain("2025-05-16");
    expect(result).toHaveLength(2);
  });

  it("returns empty when no valid combination exists", () => {
    const candidates = ["2025-05-12"];
    const isValid = () => false;
    const result = bestSpread(candidates, 1, [], isValid);
    expect(result).toEqual([]);
  });
});

// ─── autoSchedule ───

describe("autoSchedule", () => {
  it("returns suggestions, warnings, and stats", () => {
    const result = runSchedule();
    expect(result).toHaveProperty("suggestions");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("stats");
    expect(result.stats).toHaveProperty("totalSlotsFilled");
    expect(result.stats).toHaveProperty("byStep");
  });

  describe("step 1: standing commitments", () => {
    it("assigns standing commitments on matching days", () => {
      const result = runSchedule({
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-or", ...sw(1, "weekly") },
        ],
        staffingRequirements: [],
      });
      const mondayCommitments = result.suggestions.filter(
        (s) => s.staffId === "p1" && s.step === "standing" && s.date === "2025-05-12"
      );
      expect(mondayCommitments).toHaveLength(1);
      expect(mondayCommitments[0].code).toBe("OR");
    });

    it("skips standing commitments on holidays", () => {
      const result = runSchedule({
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-or", ...sw(1, "weekly") },
        ],
        holidays: [{ date: "2025-05-12" }],
      });
      const mondayStanding = result.suggestions.filter(
        (s) => s.staffId === "p1" && s.step === "standing" && s.date === "2025-05-12"
      );
      expect(mondayStanding).toHaveLength(0);
    });

    it("skips standing commitments when temporal eligibility rules block the date", () => {
      const result = runSchedule({
        staff: [
          makeStaff("p1", "AB", {
            shiftEligibilityRules: [
              { shiftTypeId: "st-or", type: "eligible", strength: "rule", ...wEvery(3) },
            ],
          }),
        ],
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-or", ...sw(1, "weekly") },
        ],
      });
      // p1 has temporal rules for OR: only Wednesday eligible
      // Standing commitment is for Monday — should be skipped
      const mondayStanding = result.suggestions.filter(
        (s) => s.staffId === "p1" && s.step === "standing" && s.date === "2025-05-12"
      );
      expect(mondayStanding).toHaveLength(0);
    });

    it("skips standing commitments for non-autoSchedulable shifts", () => {
      const result = runSchedule({
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-off", ...sw(1, "weekly") },
        ],
      });
      const standing = result.suggestions.filter((s) => s.step === "standing");
      expect(standing).toHaveLength(0);
    });

    // Slice 6: the scheduler now honors biweekly/monthly recurrences (previously
    // dropped — only weekly / any-day fired). Routed through standingToWhen + matchesWhen.
    const TWO_PP = [
      { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 },
      { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 40 },
    ];

    it("biweekly commitment fires every other week only", () => {
      const result = runSchedule({
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-or", ...sw(1, "biweekly") },
        ],
        dates: weekdayDates("2025-05-12", 20), // 4 weeks Mon–Fri
        payPeriods: TWO_PP,
      });
      const mondays = result.suggestions
        .filter((s) => s.staffId === "p1" && s.step === "standing")
        .map((s) => s.date)
        .sort();
      // PP0-wk1 + PP1-wk1 Mondays; PP0-wk2 (05-19) + PP1-wk2 (06-02) skipped.
      expect(mondays).toEqual(["2025-05-12", "2025-05-26"]);
    });

    it("monthly commitment fires on the 1st matching weekday of the month only", () => {
      const result = runSchedule({
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-or", ...sw(1, "monthly") },
        ],
        dates: weekdayDates("2025-05-12", 20),
        payPeriods: TWO_PP,
      });
      const days = result.suggestions
        .filter((s) => s.staffId === "p1" && s.step === "standing")
        .map((s) => s.date)
        .sort();
      // 1st Monday of May = 05-05 (before range); 1st Monday of June = 06-02.
      // In-range May Mondays (12/19/26) are the 2nd/3rd/4th → not matched.
      expect(days).toEqual(["2025-06-02"]);
    });
  });

  describe("step 2: staffing requirements", () => {
    it("fills staffing requirements evenly across staff", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 2, autoSchedulable: true });
      const staff = [
        makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"] }),
        makeStaff("p2", "CD", { eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"] }),
      ];
      const result = runSchedule({
        staff,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      const orcByStaff = new Map<string, number>();
      for (const s of result.suggestions) {
        if (s.code === "ORC") {
          orcByStaff.set(s.staffId, (orcByStaff.get(s.staffId) || 0) + 1);
        }
      }
      // Should be roughly even — neither staff gets all 5
      for (const [, count] of orcByStaff) {
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count).toBeLessThanOrEqual(3);
      }
    });

    it("warns when no eligible staff is available", () => {
      const RARE = makeShift("st-rare", "RARE", { schedulePriority: 1, autoSchedulable: true });
      const result = runSchedule({
        staff: [makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
        shiftTypes: [OR, RARE, OFF],
        staffingRequirements: [{ shiftCode: "RARE", dayKey: "1", minCount: 1 }],
      });
      // No staff is eligible for RARE
      expect(result.warnings.some((w) => w.includes("RARE"))).toBe(true);
    });
  });

  describe("step 3: fill shifts for FTE hours", () => {
    it("fills to target hours", () => {
      const result = runSchedule({
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      });
      const p1Fill = result.suggestions.filter(
        (s) => s.staffId === "p1" && s.step === "fill"
      );
      // 40 target / 8 hrs per day = 5 fill days needed
      expect(p1Fill.length).toBe(5);
    });

    it("warns when not enough available days to reach target", () => {
      // Only 2 weekday dates available, but target is 40hrs (5 days needed)
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 2),
        staff: [makeStaff("p1", "AB")],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      });
      expect(result.warnings.some((w) => w.includes("cannot reach"))).toBe(true);
    });

    it("respects FTE percentage for part-time staff", () => {
      const result = runSchedule({
        staff: [makeStaff("p1", "AB", { ftePercentage: 0.5 })],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
        dates: weekdayDates("2025-05-12", 10),
      });
      const p1Fill = result.suggestions.filter(
        (s) => s.staffId === "p1" && s.step === "fill"
      );
      // 80 * 0.5 = 40 target / 8 hrs per day = 5 fill days
      expect(p1Fill.length).toBe(5);
    });
  });

  describe("step 4: off-shift fill", () => {
    it("fills remaining empty cells with off-shift", () => {
      const result = runSchedule();
      const offSuggestions = result.suggestions.filter((s) => s.step === "off");
      // 2 staff * 5 days = 10 slots, minus fill slots = off slots
      const totalSlots = 2 * 5;
      const fillSlots = result.suggestions.filter((s) => s.step === "fill").length;
      expect(offSuggestions.length).toBe(totalSlots - fillSlots);
    });
  });

  describe("existing assignments", () => {
    it("does not overwrite existing assignments", () => {
      const result = runSchedule({
        existingAssignments: [
          { staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false },
        ],
      });
      const p1Mon = result.suggestions.filter(
        (s) => s.staffId === "p1" && s.date === "2025-05-12"
      );
      expect(p1Mon).toHaveLength(0);
    });
  });

  describe("follow rules integration", () => {
    it("places a recovery day off via an each_day required follower (ORC→X style)", () => {
      const CALL = makeShift("st-call", "CALL", { schedulePriority: 1, autoSchedulable: true });
      const staff = [
        makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-call", "st-off"] }),
      ];
      const result = runSchedule({
        staff,
        shiftTypes: [OR, CALL, OFF],
        staffingRequirements: [
          { shiftCode: "CALL", dayKey: "1", minCount: 1 },
        ],
        requiredFollowers: [
          { sourceShiftId: "st-call", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false },
        ],
      });
      const callDay = result.suggestions.find((s) => s.code === "CALL");
      expect(callDay).toBeDefined();
      const nextDay = result.suggestions.find(
        (s) => s.staffId === callDay!.staffId && s.step === "follower"
      );
      expect(nextDay).toBeDefined();
      expect(nextDay!.code).toBe("X");
    });
  });

  describe("required followers", () => {
    // consecutive calendar dates INCLUDING weekends (weekdayDates skips them)
    function allDates(startDate: string, count: number): string[] {
      const out: string[] = [];
      const cur = new Date(startDate + "T12:00:00");
      for (let i = 0; i < count; i++) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        const d = String(cur.getDate()).padStart(2, "0");
        out.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    }

    const CALL = makeShift("st-call", "CALL", { schedulePriority: 1, autoSchedulable: true });
    // ADM has no schedulePriority → never distributed by staffing; only placed as a
    // follower or to satisfy a per-staff target.
    const ADM = makeShift("st-adm", "ADM", { defaultHours: 8, autoSchedulable: true });
    const ORC = makeShift("st-orc", "ORC", { defaultHours: 16, schedulePriority: 2, autoSchedulable: true });
    const followerShifts = [OR, CALL, ADM, ORC, OFF];
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      type: "available" as const, strength: "rule" as const, ...wEvery(d),
    }));
    function fStaff(overrides: Partial<ScheduleStaff> = {}) {
      return makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-call", "st-adm", "st-orc", "st-off"],
        availabilityRules: everyDay,
        ...overrides,
      });
    }
    const pp = [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }];
    const callWeekend = (locked = true) => [
      { staffId: "p1", date: "2025-05-17", shiftTypeId: "st-call", code: "CALL", isLocked: locked },
      { staffId: "p1", date: "2025-05-18", shiftTypeId: "st-call", code: "CALL", isLocked: locked },
    ];

    it("each_run: a CALL weekend gets ONE ADM the next day, not one per CALL day", () => {
      const result = runSchedule({
        dates: allDates("2025-05-17", 5), // Sat, Sun, Mon, Tue, Wed
        staff: [fStaff()],
        shiftTypes: followerShifts,
        existingAssignments: callWeekend(),
        payPeriods: pp,
        requiredFollowers: [
          { sourceShiftId: "st-call", followerShiftId: "st-adm", scope: "each_run", countsTowardTargets: false },
        ],
      });
      const adm = result.suggestions.filter((s) => s.code === "ADM");
      expect(adm).toHaveLength(1);
      expect(adm[0].date).toBe("2025-05-19"); // the Monday after the weekend run
      expect(adm[0].step).toBe("follower");
    });

    it("each_run: skips and warns when the follower's day is already filled", () => {
      const result = runSchedule({
        dates: allDates("2025-05-17", 5),
        staff: [fStaff()],
        shiftTypes: followerShifts,
        existingAssignments: [
          ...callWeekend(),
          { staffId: "p1", date: "2025-05-19", shiftTypeId: "st-or", code: "OR", isLocked: true },
        ],
        payPeriods: pp,
        requiredFollowers: [
          { sourceShiftId: "st-call", followerShiftId: "st-adm", scope: "each_run", countsTowardTargets: false },
        ],
      });
      expect(result.suggestions.filter((s) => s.code === "ADM")).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("ADM") && w.includes("CALL"))).toBe(true);
    });

    it("each_day: places a follower after EVERY occurrence (ORC→X on Tue and Thu)", () => {
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5), // Mon..Fri
        staff: [fStaff()],
        shiftTypes: followerShifts,
        payPeriods: pp,
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 }, // Monday
          { shiftCode: "ORC", dayKey: "3", minCount: 1 }, // Wednesday
        ],
        requiredFollowers: [
          { sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false },
        ],
      });
      const orc = result.suggestions.filter((s) => s.code === "ORC").map((s) => s.date).sort();
      expect(orc).toEqual(["2025-05-12", "2025-05-14"]);
      // each ORC is followed the next day by an X placed by the follower step
      for (const d of ["2025-05-13", "2025-05-15"]) {
        const x = result.suggestions.find((s) => s.code === "X" && s.date === d && s.step === "follower");
        expect(x, `expected recovery X on ${d}`).toBeDefined();
      }
    });

    it("countsTowardTargets=false: the follower ADM does NOT satisfy an ADM target (extra)", () => {
      const result = runSchedule({
        dates: allDates("2025-05-17", 6), // Sat..Thu
        staff: [fStaff({
          shiftMinimumTargets: [{ shiftTypeId: "st-adm", minCount: 1, maxCount: 1, window: "pay_period", windowDays: null }],
        })],
        shiftTypes: followerShifts,
        existingAssignments: callWeekend(),
        payPeriods: pp,
        requiredFollowers: [
          { sourceShiftId: "st-call", followerShiftId: "st-adm", scope: "each_run", countsTowardTargets: false },
        ],
      });
      const adm = result.suggestions.filter((s) => s.code === "ADM");
      // one ADM from the follower (extra), one SEPARATE ADM to satisfy the target
      expect(adm.map((s) => s.step).sort()).toEqual(["follower", "min-target"]);
    });

    it("countsTowardTargets=false: a non-counting follower does NOT satisfy a staffing requirement", () => {
      // ADM is staffed on Monday (req 1). p1 does the CALL weekend → a non-counting
      // ADM follower lands Monday. That follower must NOT satisfy the requirement, so
      // the scheduler still places a real (counting) ADM for p2.
      const ADM_REQ = makeShift("st-adm", "ADM", { defaultHours: 8, autoSchedulable: true, schedulePriority: 3 });
      const p2 = makeStaff("p2", "CD", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"], availabilityRules: everyDay });
      const result = runSchedule({
        dates: allDates("2025-05-17", 4), // Sat, Sun, Mon, Tue
        staff: [fStaff(), p2],
        shiftTypes: [OR, CALL, ADM_REQ, OFF],
        existingAssignments: callWeekend(),
        payPeriods: pp,
        staffingRequirements: [{ shiftCode: "ADM", dayKey: "1", minCount: 1 }], // Monday
        requiredFollowers: [
          { sourceShiftId: "st-call", followerShiftId: "st-adm", scope: "each_run", countsTowardTargets: false },
        ],
      });
      const mondayAdm = result.suggestions.filter((s) => s.code === "ADM" && s.date === "2025-05-19");
      // one follower (p1, noCount) + one real coverage ADM (p2)
      expect(mondayAdm.some((s) => s.step === "follower" && s.staffId === "p1")).toBe(true);
      expect(mondayAdm.some((s) => s.step !== "follower")).toBe(true);
      expect(mondayAdm).toHaveLength(2);
    });

    it("countsTowardTargets=true: the follower ADM DOES satisfy the ADM target", () => {
      const result = runSchedule({
        dates: allDates("2025-05-17", 6),
        staff: [fStaff({
          shiftMinimumTargets: [{ shiftTypeId: "st-adm", minCount: 1, maxCount: 1, window: "pay_period", windowDays: null }],
        })],
        shiftTypes: followerShifts,
        existingAssignments: callWeekend(),
        payPeriods: pp,
        requiredFollowers: [
          { sourceShiftId: "st-call", followerShiftId: "st-adm", scope: "each_run", countsTowardTargets: true },
        ],
      });
      const adm = result.suggestions.filter((s) => s.code === "ADM");
      expect(adm).toHaveLength(1);
      expect(adm[0].step).toBe("follower");
    });
  });

  describe("weekend-paired shifts", () => {
    it("assigns paired weekend shifts to the same staff", () => {
      const ORC = makeShift("st-orc", "ORC", {
        schedulePriority: 1,
        autoSchedulable: true,
        weekendPaired: true,
        countsOnWeekend: true,
      });
      const staff = [
        makeStaff("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            type: "available" as const, strength: "rule" as const, ...wEvery(d),
          })),
        }),
        makeStaff("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            type: "available" as const, strength: "rule" as const, ...wEvery(d),
          })),
        }),
      ];
      // Include Sat+Sun in dates
      const dates = ["2025-05-17", "2025-05-18"]; // Sat, Sun
      const result = runSchedule({
        dates,
        staff,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "6", minCount: 1 },
          { shiftCode: "ORC", dayKey: "0", minCount: 1 },
        ],
      });
      const orcSuggestions = result.suggestions.filter((s) => s.code === "ORC");
      expect(orcSuggestions).toHaveLength(2);
      expect(orcSuggestions[0].staffId).toBe(orcSuggestions[1].staffId);
    });

    function pairedHolidayStaff() {
      return [
        makeStaff("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            type: "available" as const, strength: "rule" as const, ...wEvery(d),
          })),
        }),
        makeStaff("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            type: "available" as const, strength: "rule" as const, ...wEvery(d),
          })),
        }),
      ];
    }

    it("extends a paired weekend to a leading Friday holiday (FRI-SAT-SUN, same staff)", () => {
      const ORC = makeShift("st-orc", "ORC", {
        schedulePriority: 1, autoSchedulable: true,
        weekendPaired: true, holidayWeekendPaired: true, countsOnWeekend: true,
      });
      const result = runSchedule({
        dates: ["2025-05-23", "2025-05-24", "2025-05-25"], // Fri (holiday), Sat, Sun
        holidays: [{ date: "2025-05-23" }],
        staff: pairedHolidayStaff(),
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "holiday", minCount: 1 },
          { shiftCode: "ORC", dayKey: "6", minCount: 1 },
          { shiftCode: "ORC", dayKey: "0", minCount: 1 },
        ],
      });
      const orc = result.suggestions.filter((s) => s.code === "ORC");
      expect(orc).toHaveLength(3);
      expect(new Set(orc.map((s) => s.staffId)).size).toBe(1);
    });

    it("extends a paired weekend to a following Monday holiday (SAT-SUN-MON, same staff)", () => {
      const ORC = makeShift("st-orc", "ORC", {
        schedulePriority: 1, autoSchedulable: true,
        weekendPaired: true, holidayWeekendPaired: true, countsOnWeekend: true,
      });
      const result = runSchedule({
        dates: ["2025-05-24", "2025-05-25", "2025-05-26"], // Sat, Sun, Mon (Memorial Day)
        holidays: [{ date: "2025-05-26" }],
        staff: pairedHolidayStaff(),
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "6", minCount: 1 },
          { shiftCode: "ORC", dayKey: "0", minCount: 1 },
          { shiftCode: "ORC", dayKey: "holiday", minCount: 1 },
        ],
      });
      const orc = result.suggestions.filter((s) => s.code === "ORC");
      expect(orc).toHaveLength(3);
      expect(new Set(orc.map((s) => s.staffId)).size).toBe(1);
    });

    it("does NOT pull an adjacent holiday into the weekend group when holidayWeekendPaired is off", () => {
      const ORC = makeShift("st-orc", "ORC", {
        schedulePriority: 1, autoSchedulable: true,
        weekendPaired: true, holidayWeekendPaired: false, countsOnWeekend: true,
      });
      const result = runSchedule({
        dates: ["2025-05-23", "2025-05-24", "2025-05-25"], // Fri (holiday), Sat, Sun
        holidays: [{ date: "2025-05-23" }],
        staff: pairedHolidayStaff(),
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "holiday", minCount: 1 },
          { shiftCode: "ORC", dayKey: "6", minCount: 1 },
          { shiftCode: "ORC", dayKey: "0", minCount: 1 },
        ],
      });
      const orc = result.suggestions.filter((s) => s.code === "ORC");
      // All three days are still staffed, but the holiday is filled
      // independently (even distribution), not glued to the weekend person.
      expect(orc).toHaveLength(3);
      const holidayStaff = orc.find((s) => s.date === "2025-05-23")!.staffId;
      const saturdayStaff = orc.find((s) => s.date === "2025-05-24")!.staffId;
      expect(holidayStaff).not.toBe(saturdayStaff);
    });
  });

  describe("inactive / non-auto staff", () => {
    it("skips inactive staff entirely", () => {
      const result = runSchedule({
        staff: [
          makeStaff("p1", "AB"),
          makeStaff("p2", "CD", { isActive: false }),
        ],
      });
      const p2Suggestions = result.suggestions.filter((s) => s.staffId === "p2");
      expect(p2Suggestions).toHaveLength(0);
    });

    it("skips non-auto-scheduled staff", () => {
      const result = runSchedule({
        staff: [
          makeStaff("p1", "AB"),
          makeStaff("p2", "CD", { isAutoScheduled: false }),
        ],
      });
      const p2Suggestions = result.suggestions.filter((s) => s.staffId === "p2");
      expect(p2Suggestions).toHaveLength(0);
    });
  });

  describe("stats tracking", () => {
    it("counts total slots filled", () => {
      const result = runSchedule();
      expect(result.stats.totalSlotsFilled).toBe(result.suggestions.length);
    });

    it("tracks counts per step", () => {
      const result = runSchedule();
      const sumByStep = Object.values(result.stats.byStep).reduce((a, b) => a + b, 0);
      expect(sumByStep).toBe(result.stats.totalSlotsFilled);
    });
  });

  describe("shift eligibility rules", () => {
    it("restricts staff to eligible days only via temporal rules", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const staff = [
        makeStaff("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftEligibilityRules: [
            { shiftTypeId: "st-orc", type: "eligible", strength: "rule", ...wEvery(1) },
          ],
        }),
        makeStaff("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
      ];
      const dates = weekdayDates("2025-05-12", 5); // Mon-Fri
      const result = runSchedule({
        dates,
        staff,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      // p1 has temporal rules for ORC: only Monday eligible
      // So p1 should only get ORC on Monday, p2 gets the rest
      const p1Orc = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "ORC");
      const p1OrcDays = p1Orc.map((s) => new Date(s.date + "T12:00:00").getDay());
      for (const dow of p1OrcDays) {
        expect(dow).toBe(1); // Monday only
      }
    });

    it("falls back to static eligibility when no temporal rules exist", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const staff = [
        makeStaff("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftEligibilityRules: [], // empty = no temporal rules
        }),
      ];
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }],
      });
      // Should still assign ORC since static eligibility allows it
      const p1Orc = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "ORC");
      expect(p1Orc.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("shift minimum targets", () => {
    it("prioritizes staff below their minimum target", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const staff = [
        makeStaff("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 3, window: "pay_period" }],
        }),
        makeStaff("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
      ];
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      const p1Orc = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "ORC");
      // p1 has min 3/PP so should get at least 3
      expect(p1Orc.length).toBeGreaterThanOrEqual(3);
    });

    it("warns when minimum cannot be met", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const staff = [
        makeStaff("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 10, window: "pay_period" }],
        }),
      ];
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      // 10/PP is impossible with only 5 days — should warn
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("ORC"))).toBe(true);
    });
  });

  describe("maxCount enforcement", () => {
    it("caps assignments at maxCount per window", () => {
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 2, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff: [p],
        staffingRequirements: [
          { shiftCode: "OR", dayKey: "1", minCount: 1 },
          { shiftCode: "OR", dayKey: "2", minCount: 1 },
          { shiftCode: "OR", dayKey: "3", minCount: 1 },
          { shiftCode: "OR", dayKey: "4", minCount: 1 },
          { shiftCode: "OR", dayKey: "5", minCount: 1 },
        ],
      });
      const orCount = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "OR").length;
      expect(orCount).toBeLessThanOrEqual(2);
    });

    it("warns when maxCount is exceeded by existing assignments", () => {
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 1, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff: [p],
        existingAssignments: [
          { staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false },
          { staffId: "p1", date: "2025-05-13", shiftTypeId: "st-or", code: "OR", isLocked: false },
        ],
      });
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("max") && w.includes("OR"))).toBe(true);
    });

    it("caps standing commitments at maxCount", () => {
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 2, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff: [p],
        standingCommitments: [
          { staffId: "p1", shiftTypeId: "st-or", ...sw(null, "weekly") },
        ],
      });
      const orCount = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "OR").length;
      expect(orCount).toBeLessThanOrEqual(2);
    });

    it("warns when fill-hours is capped by maxCount", () => {
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 2, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff: [p],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      });
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("capped by max"))).toBe(true);
    });

    it("caps weekend-paired shifts at maxCount and warns", () => {
      const CALL = makeShift("st-call", "CALL", {
        weekendPaired: true,
        countsOnWeekend: true,
        schedulePriority: 1,
      });
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-call", "st-off"],
        availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          type: "available" as const,
          strength: "rule" as const,
          ...wEvery(d),
        })),
        shiftMinimumTargets: [
          { shiftTypeId: "st-call", minCount: 0, maxCount: 1, window: "pay_period" as const },
        ],
      });
      // 2025-05-17 is Saturday, 2025-05-18 is Sunday
      const dates = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16", "2025-05-17", "2025-05-18"];
      const result = runSchedule({
        dates,
        staff: [p],
        shiftTypes: [CALL, OFF],
        staffingRequirements: [
          { shiftCode: "CALL", dayKey: "6", minCount: 1 },
          { shiftCode: "CALL", dayKey: "0", minCount: 1 },
        ],
      });
      const callCount = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "CALL").length;
      expect(callCount).toBeLessThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("capped by max"))).toBe(true);
    });
  });

  describe("min target proactive scheduling", () => {
    it("assigns shifts to meet per-staff minimums even without staffing requirements", () => {
      const ADM = makeShift("st-adm", "ADM", { schedulePriority: null });
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-adm", minCount: 1, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff: [p],
        shiftTypes: [OR, ADM, OFF],
        staffingRequirements: [],
      });
      const admCount = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "ADM").length;
      expect(admCount).toBeGreaterThanOrEqual(1);
      expect(result.suggestions.some((s) => s.code === "ADM" && s.step === "min-target")).toBe(true);
    });

    it("respects eligibility rules when placing min-target shifts", () => {
      const ADM = makeShift("st-adm", "ADM", { schedulePriority: null });
      const p = makeStaff("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"],
        shiftEligibilityRules: [
          { shiftTypeId: "st-adm", type: "eligible" as const, strength: "rule" as const, ...wEvery(5) },
          { shiftTypeId: "st-adm", type: "ineligible" as const, strength: "rule" as const, ...wEvery(1) },
          { shiftTypeId: "st-adm", type: "ineligible" as const, strength: "rule" as const, ...wEvery(2) },
          { shiftTypeId: "st-adm", type: "ineligible" as const, strength: "rule" as const, ...wEvery(3) },
          { shiftTypeId: "st-adm", type: "ineligible" as const, strength: "rule" as const, ...wEvery(4) },
        ],
        shiftMinimumTargets: [
          { shiftTypeId: "st-adm", minCount: 1, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        staff: [p],
        shiftTypes: [OR, ADM, OFF],
        staffingRequirements: [],
      });
      const admSuggestions = result.suggestions.filter((s) => s.code === "ADM");
      expect(admSuggestions.length).toBe(1);
      // 2025-05-16 is Friday (day 5) — the only eligible day
      expect(admSuggestions[0].date).toBe("2025-05-16");
    });

    it("places a hard-minimum shift on a constrained low-FTE staff over a broadly-available full-timer, even when it exceeds their PP hours", () => {
      // ORC is 16h; LO is 0.3 FTE ⇒ PP target 12h, so a single ORC overshoots and
      // wouldBreakPPHours would normally exclude LO. But LO has an unmet hard minimum
      // (1 ORC/PP), which must take precedence over the soft hours cap. HI (1.0 FTE,
      // no minimum) must NOT win the only required ORC slot.
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true, defaultHours: 16 });
      const staff = [
        makeStaff("p1", "LO", {
          ftePercentage: 0.3,
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 1, maxCount: 1, window: "pay_period" as const }],
        }),
        makeStaff("p2", "HI", {
          ftePercentage: 1.0,
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
      ];
      const result = runSchedule({
        dates: ["2025-05-12"], // Monday (dayKey 1)
        staff,
        shiftTypes: [OR, ORC, OFF],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
        staffingRequirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }],
      });
      const orc = result.suggestions.filter((s) => s.code === "ORC");
      expect(orc).toHaveLength(1);
      expect(orc[0].staffId).toBe("p1"); // LO wins despite breaking PP hours
    });

    it("rolling max: a '1 per 2 PP' cap respaces a near-boundary ORC instead of allowing two close together", () => {
      // RM has min 1 / max 1 ORC per 2 pay periods. An ORC already sits at the end
      // of PP1 (2025-06-06). We schedule PP2+PP3. With the OLD fixed-block tiling,
      // PP2 fell in block 1 ([PP2,PP3]) — separate from the PP1 seed in block 0 —
      // so an ORC would have been placed early in PP2, only ~2 weeks after the
      // seed (the RM bug). With the rolling max, every PP2 date is within a 2-PP
      // span of the seed and is blocked; the ORC is respaced into PP3.
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true, defaultHours: 8 });
      const FOUR_PP = [
        { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }, // PP0
        { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 40 }, // PP1
        { startDate: "2025-06-08", endDate: "2025-06-21", targetHours: 40 }, // PP2
        { startDate: "2025-06-22", endDate: "2025-07-05", targetHours: 40 }, // PP3
      ];
      const rm = makeStaff("p1", "RM", {
        eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-orc", minCount: 1, maxCount: 1, window: "pay_period" as const, windowCount: 2 },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-06-09", 20), // all weekdays of PP2 (06-09..06-20) + PP3 (06-23..07-04)
        staff: [rm],
        shiftTypes: [OR, ORC, OFF],
        payPeriods: FOUR_PP,
        existingAssignments: [
          { staffId: "p1", date: "2025-06-06", shiftTypeId: "st-orc", code: "ORC", isLocked: true }, // PP1
        ],
        // daily ORC requirement so the scheduler actively tries to place ORC every day
        staffingRequirements: [1, 2, 3, 4, 5].map((d) => ({ shiftCode: "ORC", dayKey: String(d), minCount: 1 })),
      });
      const orc = result.suggestions.filter((s) => s.staffId === "p1" && s.code === "ORC");
      // count preserved: the min still gets satisfied (one new ORC placed) ...
      expect(orc.length).toBeGreaterThanOrEqual(1);
      // ... but NONE in PP2 (all within a rolling 2-PP span of the 2025-06-06 seed) ...
      expect(orc.some((s) => s.date >= "2025-06-08" && s.date <= "2025-06-21")).toBe(false);
      // ... and it lands in PP3, respaced ~2 PP from the seed.
      expect(orc.every((s) => s.date >= "2025-06-22")).toBe(true);
      // and the final audit does NOT falsely flag the (legal, respaced) result.
      expect(result.warnings.some((w) => w.includes("RM") && w.includes("exceeds max"))).toBe(false);
    });

    it("rolling max: the final audit flags a rolling cap violation forced by locked assignments", () => {
      // Two locked ORCs sit 14 days apart in ADJACENT pay periods (PP1 + PP2) —
      // inside a rolling 2-PP span, so '1 per 2 PP' is violated. The old fixed-block
      // audit put them in different blocks ([0,1] vs [2,3]) and stayed silent; the
      // rolling audit must surface it (locked placements bypass isAvailable).
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true, defaultHours: 8 });
      const FOUR_PP = [
        { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }, // PP0
        { startDate: "2025-05-25", endDate: "2025-06-07", targetHours: 40 }, // PP1
        { startDate: "2025-06-08", endDate: "2025-06-21", targetHours: 40 }, // PP2
        { startDate: "2025-06-22", endDate: "2025-07-05", targetHours: 40 }, // PP3
      ];
      const rm = makeStaff("p1", "RM", {
        eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-orc", minCount: 1, maxCount: 1, window: "pay_period" as const, windowCount: 2 },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-06-09", 5),
        staff: [rm],
        shiftTypes: [OR, ORC, OFF],
        payPeriods: FOUR_PP,
        existingAssignments: [
          { staffId: "p1", date: "2025-05-30", shiftTypeId: "st-orc", code: "ORC", isLocked: true }, // PP1
          { staffId: "p1", date: "2025-06-13", shiftTypeId: "st-orc", code: "ORC", isLocked: true }, // PP2
        ],
        staffingRequirements: [],
      });
      expect(
        result.warnings.some((w) => w.includes("RM") && w.includes("exceeds max") && w.includes("rolling")),
      ).toBe(true);
    });

    it("does NOT override the PP-hours cap for a low-FTE staff WITHOUT a hard minimum", () => {
      // Same setup but LO has no minimum target — the soft hours cap still protects
      // them, so the broadly-available full-timer takes the ORC slot. This guards that
      // the override is driven by the hard minimum, not by FTE alone.
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true, defaultHours: 16 });
      const staff = [
        makeStaff("p1", "LO", {
          ftePercentage: 0.3,
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
        makeStaff("p2", "HI", {
          ftePercentage: 1.0,
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
      ];
      const result = runSchedule({
        dates: ["2025-05-12"], // Monday (dayKey 1)
        staff,
        shiftTypes: [OR, ORC, OFF],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
        staffingRequirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }],
      });
      const orc = result.suggestions.filter((s) => s.code === "ORC");
      expect(orc).toHaveLength(1);
      expect(orc[0].staffId).toBe("p2"); // HI wins; LO protected by PP-hours cap
    });
  });
});

// ─── schedule requests (approved constraints) ───
//
// Default runSchedule: 2 staff, OR fill shift, FTE target 40h ⇒ each staff
// is filled with OR on all 5 weekdays. These tests assert how an approved request
// perturbs that baseline. Only approved requests exert force; pending/soft don't.

describe("autoSchedule — schedule requests", () => {
  const AL = makeShift("st-al", "AL", {
    isLeave: true,
    countsTowardFte: false,
    autoSchedulable: false,
    ignoresWorkingDays: true,
  });

  function req(
    o: Partial<ScheduleRequestData> & {
      staffId: string;
      startDate: string;
      endDate: string;
      kind: ScheduleRequestData["kind"];
    }
  ): ScheduleRequestData {
    return {
      id: `req-${o.staffId}-${o.startDate}-${o.kind}`,
      shiftTypeIds: [],
      leaveShiftTypeId: null,
      strength: "hard",
      status: "approved",
      ...o,
    };
  }

  const worksOR = (r: AutoScheduleResult, staffId: string, date: string) =>
    r.suggestions.some((s) => s.staffId === staffId && s.date === date && s.code === "OR");

  it("control: without requests, p1 works OR every weekday", () => {
    const r = runSchedule({});
    expect(worksOR(r, "p1", "2025-05-12")).toBe(true);
    expect(worksOR(r, "p1", "2025-05-13")).toBe(true);
  });

  it("approved hard OFF keeps the staff off working shifts", () => {
    const r = runSchedule({
      scheduleRequests: [req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF" })],
    });
    expect(worksOR(r, "p1", "2025-05-12")).toBe(false);
    // The constraint is scoped to that one date — p1 still works the next day.
    expect(worksOR(r, "p1", "2025-05-13")).toBe(true);
    // p2 is unaffected.
    expect(worksOR(r, "p2", "2025-05-12")).toBe(true);
  });

  it("approved hard NEGATE_SHIFT blocks only that shift on that date", () => {
    const r = runSchedule({
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-13", endDate: "2025-05-13", kind: "NEGATE_SHIFT", shiftTypeIds: ["st-or"] }),
      ],
    });
    expect(worksOR(r, "p1", "2025-05-13")).toBe(false);
    expect(worksOR(r, "p1", "2025-05-14")).toBe(true);
  });

  it("approved hard LEAVE pre-places the leave shift across the whole range", () => {
    const r = runSchedule({
      shiftTypes: [OR, AL, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-13", kind: "LEAVE", leaveShiftTypeId: "st-al" }),
      ],
    });
    const leave = r.suggestions.filter((s) => s.staffId === "p1" && s.code === "AL");
    expect(leave.map((s) => s.date).sort()).toEqual(["2025-05-12", "2025-05-13"]);
    expect(leave.every((s) => s.step === "request-leave")).toBe(true);
    // Leave days are not also filled with a working shift.
    expect(worksOR(r, "p1", "2025-05-12")).toBe(false);
    expect(worksOR(r, "p1", "2025-05-13")).toBe(false);
  });

  it("warns (and skips) when an approved leave references an unknown shift type", () => {
    const r = runSchedule({
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-missing" }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("unknown shift type"))).toBe(true);
    expect(r.suggestions.some((s) => s.staffId === "p1" && s.date === "2025-05-12" && s.step === "request-leave")).toBe(false);
  });

  it("ignores pending requests — only approved exert force", () => {
    const r = runSchedule({
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF", status: "pending" }),
      ],
    });
    expect(worksOR(r, "p1", "2025-05-12")).toBe(true);
  });

  it("soft OFF advises only — it does not forbid working", () => {
    const r = runSchedule({
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF", strength: "soft" }),
      ],
    });
    expect(worksOR(r, "p1", "2025-05-12")).toBe(true);
  });

  it("hard OFF overrides a standing commitment on the same date", () => {
    const r = runSchedule({
      standingCommitments: [{ staffId: "p1", shiftTypeId: "st-or", ...sw(null, "weekly") }],
      scheduleRequests: [req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF" })],
    });
    expect(worksOR(r, "p1", "2025-05-12")).toBe(false);
    // The standing commitment still applies on a day with no request.
    expect(worksOR(r, "p1", "2025-05-13")).toBe(true);
  });
});

// ─── schedule request preferences: forcing + soft weighting (slice 2d) ───

describe("autoSchedule — schedule request preferences", () => {
  const ADM = makeShift("st-adm", "ADM", { schedulePriority: 2 });
  const AL = makeShift("st-al", "AL", { isLeave: true });

  function req(
    o: Partial<ScheduleRequestData> & {
      staffId: string;
      startDate: string;
      endDate: string;
      kind: ScheduleRequestData["kind"];
    }
  ): ScheduleRequestData {
    return {
      id: `req-${o.staffId}-${o.startDate}-${o.kind}-${o.strength ?? "hard"}`,
      shiftTypeIds: [],
      leaveShiftTypeId: null,
      strength: "hard",
      status: "approved",
      ...o,
    };
  }

  const has = (r: AutoScheduleResult, staffId: string, date: string, code: string) =>
    r.suggestions.some((s) => s.staffId === staffId && s.date === date && s.code === code);

  // ── hard REQUEST_SHIFT (forcing) ──

  it("approved hard REQUEST_SHIFT pre-places the wanted shift for an eligible staff", () => {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"] }),
      ],
    });
    const adm = r.suggestions.find((s) => s.staffId === "p1" && s.date === "2025-05-12" && s.code === "ADM");
    expect(adm).toBeDefined();
    expect(adm!.step).toBe("request-shift");
  });

  // ── pendingRequestMode: honoring PENDING (unapproved) requests ──

  it("full mode: a PENDING hard REQUEST_SHIFT is pre-placed just like an approved one", () => {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, OFF],
      schedulingPreferences: { ...defaultPrefs, pendingRequestMode: "full" },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"], status: "pending" }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(true);
  });

  it("off mode (default): the same PENDING request is ignored", () => {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"], status: "pending" }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(false);
  });

  it("full mode: a PENDING hard OFF forbids working", () => {
    const r = runSchedule({
      schedulingPreferences: { ...defaultPrefs, pendingRequestMode: "full" },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF", status: "pending" }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "OR")).toBe(false);
  });

  it("soft mode: a PENDING hard OFF is downgraded — it advises but does not forbid working", () => {
    const r = runSchedule({
      schedulingPreferences: { ...defaultPrefs, pendingRequestMode: "soft" },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF", status: "pending" }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "OR")).toBe(true);
  });

  it("full mode: flags contradictory requests (hard OFF + hard request to work) in warnings", () => {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, OFF],
      schedulingPreferences: { ...defaultPrefs, pendingRequestMode: "full" },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "OFF" }),
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"], status: "pending" }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("AB") && w.includes("2025-05-12") && w.includes("conflicts"))).toBe(true);
  });

  // ── rule-break-on-honor warnings ──

  it("warns when honoring away requests pushes a date past the soft leave limit", () => {
    const r = runSchedule({
      shiftTypes: [OR, AL, OFF],
      schedulingPreferences: { ...defaultPrefs, maxLeavePerDay: 1 },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-al" }),
        req({ staffId: "p2", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-al" }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("2025-05-12") && w.includes("soft leave limit"))).toBe(true);
  });

  it("does not warn about the leave limit when the cap is 0 (no cap)", () => {
    const r = runSchedule({
      shiftTypes: [OR, AL, OFF],
      schedulingPreferences: { ...defaultPrefs, maxLeavePerDay: 0 },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-al" }),
        req({ staffId: "p2", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-al" }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("soft leave limit"))).toBe(false);
  });

  it("warns when honoring an away request strands a staffing minimum", () => {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-al", "st-off"] });
    const r = runSchedule({
      staff: [p1],
      shiftTypes: [OR, AL, OFF],
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }], // 2025-05-12 is a Monday (dow 1)
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-al" }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("2025-05-12") && w.includes("OR") && w.includes("below its required minimum"))).toBe(true);
  });

  it("warns (and places nothing) when a hard REQUEST_SHIFT names a shift the staff can't do", () => {
    const r = runSchedule({
      // default staff are eligible only for OR/off, not ADM
      shiftTypes: [OR, ADM, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"] }),
      ],
    });
    // An approved request that can't be placed names "approved".
    expect(r.warnings.some((w) => w.includes("could not honor approved shift request"))).toBe(true);
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(false);
  });

  it("names 'pending' on the could-not-honor warning for an unhonored pending request", () => {
    const r = runSchedule({
      shiftTypes: [OR, ADM, OFF], // default staff not eligible for ADM
      schedulingPreferences: { ...defaultPrefs, pendingRequestMode: "full" },
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"], status: "pending" }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("could not honor pending shift request"))).toBe(true);
  });

  it("flags two distinct hard work requests that can't both be placed (only one fits the cell)", () => {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, OFF],
      schedulingPreferences: { ...defaultPrefs, pendingRequestMode: "full" },
      scheduleRequests: [
        // two SEPARATE hard requests for different work shifts on the same day → only one placeable
        req({ id: "rq-or", staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-or"] }),
        req({ id: "rq-adm", staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"] }),
      ],
    });
    expect(r.warnings.some((w) => w.includes("AB") && w.includes("2025-05-12") && w.includes("only one can be placed"))).toBe(true);
  });

  // ── soft weighting in contested staffing (STEP 2 pickStaff) ──

  function contestedADM(overrides: Record<string, unknown>): AutoScheduleResult {
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-adm", "st-off"] });
    const p2 = makeStaff("p2", "CD", { eligibleShiftTypeIds: ["st-adm", "st-off"] });
    return runSchedule({
      staff: [p1, p2],
      shiftTypes: [ADM, OFF],
      dates: weekdayDates("2025-05-12", 1), // Monday 2025-05-12 only
      staffingRequirements: [{ shiftCode: "ADM", dayKey: "1", minCount: 1 }], // Mon needs 1
      ...overrides,
    });
  }

  it("control: with no requests the first-ordered staff (p1) wins a contested shift", () => {
    const r = contestedADM({});
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(true);
    expect(has(r, "p2", "2025-05-12", "ADM")).toBe(false);
  });

  it("soft REQUEST_SHIFT preference flips a tie toward the preferring staff", () => {
    const r = contestedADM({
      scheduleRequests: [
        req({ staffId: "p2", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"], strength: "soft" }),
      ],
    });
    expect(has(r, "p2", "2025-05-12", "ADM")).toBe(true);
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(false);
  });

  it("soft NEGATE_SHIFT (avoid) pushes a contested shift onto the other staff", () => {
    const r = contestedADM({
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "NEGATE_SHIFT", shiftTypeIds: ["st-adm"], strength: "soft" }),
      ],
    });
    expect(has(r, "p2", "2025-05-12", "ADM")).toBe(true);
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(false);
  });

  it("soft preference only tiebreaks — it never starves a hard minimum-target deficit", () => {
    // p1 must hit an ADM minimum (deficit), p2 merely prefers ADM. The hard
    // deficit outranks the soft preference, so p1 still gets it.
    const p1 = makeStaff("p1", "AB", {
      eligibleShiftTypeIds: ["st-adm", "st-off"],
      shiftMinimumTargets: [{ shiftTypeId: "st-adm", minCount: 1, window: "pay_period" as const }],
    });
    const p2 = makeStaff("p2", "CD", { eligibleShiftTypeIds: ["st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, p2],
      shiftTypes: [ADM, OFF],
      dates: weekdayDates("2025-05-12", 1),
      staffingRequirements: [{ shiftCode: "ADM", dayKey: "1", minCount: 1 }],
      scheduleRequests: [
        req({ staffId: "p2", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"], strength: "soft" }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(true);
    expect(has(r, "p2", "2025-05-12", "ADM")).toBe(false);
  });

  // ── soft "prefers off" biasing the FTE fill step (STEP 3) ──

  it("soft OFF steers the fill step to leave that day off when there is slack", () => {
    // FTE 0.8 ⇒ target 32h ⇒ 4 of 5 weekdays filled, 1 day off. The soft OFF on
    // Wed should make Wed the chosen day off (default off-day pick would be Mon).
    const p1 = makeStaff("p1", "AB", { ftePercentage: 0.8 });
    const r = runSchedule({
      staff: [p1],
      shiftTypes: [OR, OFF],
      payPeriods: [{ startDate: "2025-05-12", endDate: "2025-05-16", targetHours: 40 }],
      dates: weekdayDates("2025-05-12", 5),
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-14", endDate: "2025-05-14", kind: "OFF", strength: "soft" }),
      ],
    });
    expect(has(r, "p1", "2025-05-14", "OR")).toBe(false); // Wed off
    expect(has(r, "p1", "2025-05-12", "OR")).toBe(true);
    expect(has(r, "p1", "2025-05-16", "OR")).toBe(true);
  });

  it("control: without the soft OFF, the fill step's default day off is not Wed", () => {
    const p1 = makeStaff("p1", "AB", { ftePercentage: 0.8 });
    const r = runSchedule({
      staff: [p1],
      shiftTypes: [OR, OFF],
      payPeriods: [{ startDate: "2025-05-12", endDate: "2025-05-16", targetHours: 40 }],
      dates: weekdayDates("2025-05-12", 5),
    });
    expect(has(r, "p1", "2025-05-14", "OR")).toBe(true); // Wed worked by default
  });

  // ── pre-placement respects isAutoScheduled ──

  it("does not pre-place leave or wanted shifts for a non-auto-scheduled staff", () => {
    // A staff scheduled manually (isAutoScheduled=false) is off-limits to the
    // auto-scheduler entirely — even approved hard leave / shift requests.
    const manual = makeStaff("p1", "AB", {
      isAutoScheduled: false,
      eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"],
    });
    const r = runSchedule({
      staff: [manual, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "LEAVE", leaveShiftTypeId: "st-adm" }),
        req({ staffId: "p1", startDate: "2025-05-13", endDate: "2025-05-13", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm"] }),
      ],
    });
    expect(r.suggestions.some((s) => s.staffId === "p1")).toBe(false);
  });

  // ── REQUEST_SHIFT carrying off/leave shifts (consolidated staff form) ──
  // Staff now ask for time off by requesting the Off/leave shift, so a REQUEST_SHIFT
  // may carry an "away" shift the staff isn't work-eligible for. It must still place.
  const ALr = makeShift("st-al", "AL", { isLeave: true, countsTowardFte: false, autoSchedulable: false, ignoresWorkingDays: true });
  const SLr = makeShift("st-sl", "SL", { isLeave: true, countsTowardFte: false, autoSchedulable: false, ignoresWorkingDays: true, sortOrder: 21 });

  it("hard REQUEST_SHIFT for a leave shift places it authoritatively (bypasses work-eligibility)", () => {
    // p1 is NOT work-eligible for AL (leave), yet a request for it must place it,
    // exactly as the old LEAVE kind did.
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ALr, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-al"] }),
      ],
    });
    const al = r.suggestions.find((s) => s.staffId === "p1" && s.date === "2025-05-12" && s.code === "AL");
    expect(al).toBeDefined();
    expect(al!.step).toBe("request-shift");
    expect(has(r, "p1", "2025-05-12", "OR")).toBe(false); // not also given work
  });

  it("hard REQUEST_SHIFT mixing work + leave prefers the legal work shift (OR semantics)", () => {
    // Wants ADM (work, eligible) OR AL (leave): the staff works if they can.
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ADM, ALr, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm", "st-al"] }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(true);
    expect(has(r, "p1", "2025-05-12", "AL")).toBe(false);
  });

  it("among requested work shifts, the lower sortOrder one wins (not arbitrary id)", () => {
    const ORlo = makeShift("st-or", "OR", { sortOrder: 1, isFillShift: true, schedulePriority: 1 });
    const ADMhi = makeShift("st-adm", "ADM", { sortOrder: 5, schedulePriority: 2 });
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-adm", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [ORlo, ADMhi, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-adm", "st-or"] }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "OR")).toBe(true);
    expect(has(r, "p1", "2025-05-12", "ADM")).toBe(false);
  });

  it("with only away shifts requested, the lower sortOrder away shift is placed", () => {
    // AL sortOrder default 0, SL sortOrder 21 → AL wins regardless of id order.
    const p1 = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] });
    const r = runSchedule({
      staff: [p1, makeStaff("p2", "CD")],
      shiftTypes: [OR, ALr, SLr, OFF],
      scheduleRequests: [
        req({ staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT", shiftTypeIds: ["st-sl", "st-al"] }),
      ],
    });
    expect(has(r, "p1", "2025-05-12", "AL")).toBe(true);
    expect(has(r, "p1", "2025-05-12", "SL")).toBe(false);
  });
});

// ─── Slice 2: ORC under-distribution fix (handoff #190) ───

describe("maxReachableDailyHours", () => {
  const empty = new Map<string, number>();
  const ORh = makeShift("st-or", "OR", { defaultHours: 8, isFillShift: true });
  const ORLh = makeShift("st-orl", "ORL", { defaultHours: 12 });
  const ORCh = makeShift("st-orc", "ORC", { defaultHours: 16 });
  const LEAVEh = makeShift("st-al", "AL", { defaultHours: 8, isLeave: true });
  const OFFh = makeShift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
  // A long but non-auto-schedulable shift (e.g. a meeting block) the staff can't be auto-given.
  const NONSCHEDh = makeShift("st-mtg", "MTG", { defaultHours: 20, autoSchedulable: false });
  const allShifts = [ORh, ORLh, ORCh, LEAVEh, OFFh, NONSCHEDh];

  it("returns the longest eligible, FTE-counting, schedulable work shift", () => {
    const s = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-orl", "st-orc", "st-off"] });
    expect(maxReachableDailyHours(s, allShifts, empty)).toBe(16); // ORC
  });

  it("ignores shifts the staff isn't eligible for", () => {
    const s = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-orl", "st-off"] }); // no ORC
    expect(maxReachableDailyHours(s, allShifts, empty)).toBe(12); // ORL
  });

  it("excludes off, leave, and non-auto-schedulable shifts even when longer", () => {
    const s = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-al", "st-off", "st-mtg"] });
    // AL=leave, X=off, MTG=non-schedulable(20h) → only OR(8h) qualifies
    expect(maxReachableDailyHours(s, allShifts, empty)).toBe(8);
  });

  it("respects per-staff hour overrides", () => {
    const s = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"] });
    const ov = new Map<string, number>([["p1:st-orc", 10]]); // p1's ORC is 10h, not 16
    expect(maxReachableDailyHours(s, allShifts, ov)).toBe(10); // max(OR 8, ORC 10)
  });

  it("returns 0 when no qualifying shift exists (caller falls back to fill hours)", () => {
    const s = makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-off", "st-al"] });
    expect(maxReachableDailyHours(s, allShifts, empty)).toBe(0);
  });
});

describe("autoSchedule — ORC distribution (Slice 2)", () => {
  // Recovery-only ORC: a 16h shift that forces an X the next day (ORC→X each_day).
  // Before the fix, wouldBreakPPHours valued every open day at the 8h fill shift,
  // so weekday-only full-timers (BC/LM) were falsely judged unable to reach their
  // PP target and dropped from the primary pool. The pool collapsed to the single
  // staff with extra availability (YA), who then absorbed the whole week
  // (ORC/off/ORC/off/ORC = 3 ORC). Valuing days at the real reachable shift hours
  // (ORC=16h) keeps everyone feasible, so run-count fairness spreads ORC evenly.
  const everyDay = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
    type: "available" as const, strength: "rule" as const, ...wEvery(d),
  }));
  const weekdaysOnly = [1, 2, 3, 4, 5].map((d) => ({
    type: "available" as const, strength: "rule" as const, ...wEvery(d),
  }));
  const ORC = makeShift("st-orc", "ORC", { defaultHours: 16, schedulePriority: 2, autoSchedulable: true });
  const eligible = ["st-or", "st-orc", "st-off"];

  it("does not let a single full-timer absorb a week of ORC; weekday-only staff are not zeroed", () => {
    const r = runSchedule({
      dates: weekdayDates("2025-05-12", 5), // Mon..Fri (one week)
      staff: [
        makeStaff("ya", "YA", { eligibleShiftTypeIds: eligible, availabilityRules: everyDay }),
        makeStaff("bc", "BC", { eligibleShiftTypeIds: eligible, availabilityRules: weekdaysOnly }),
        makeStaff("lm", "LM", { eligibleShiftTypeIds: eligible, availabilityRules: weekdaysOnly }),
      ],
      shiftTypes: [OR, ORC, OFF],
      // 88h/PP target makes weekday-only staff "tight" under the old flat-8h estimate
      // (8 remaining days × 8h = 64 < 72h still needed) → they were wrongly excluded.
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 88 }],
      staffingRequirements: [1, 2, 3, 4, 5].map((d) => ({ shiftCode: "ORC", dayKey: String(d), minCount: 1 })),
      requiredFollowers: [
        { sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false },
      ],
    });
    const orcCount = (id: string) => r.suggestions.filter((s) => s.code === "ORC" && s.staffId === id).length;
    const total = r.suggestions.filter((s) => s.code === "ORC").length;

    expect(total).toBe(5); // 1/day × 5 weekdays
    // No single staff clusters 3-in-a-week (the bug); with total=5 and max≤2 every
    // staff necessarily gets ≥1, so BC and LM are no longer zeroed.
    for (const id of ["ya", "bc", "lm"]) {
      expect(orcCount(id)).toBeLessThanOrEqual(2);
    }
    expect(orcCount("bc")).toBeGreaterThanOrEqual(1);
    expect(orcCount("lm")).toBeGreaterThanOrEqual(1);
  });
});

describe("step 3: fill off-day feasibility (CR #939 carry-over)", () => {
  // The fill shift is NOT distributed in Step 2 (it's excluded there); its staffing
  // requirements are met during Step 3's FTE fill. When a staff has surplus days and
  // must choose an off day, the off-day picker must not vacate a day where the fill
  // shift is still required and otherwise unstaffed (the fillStaffedCount guard).
  it("won't take an off day that would leave a fill-required day understaffed", () => {
    const r = runSchedule({
      dates: weekdayDates("2025-05-12", 5), // Mon..Fri
      // single weekday-only full-timer; default makeStaff availability is Mon–Fri
      staff: [makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
      shiftTypes: [OR, OFF],
      // target 32 = 4×8h → 4 fill days + exactly 1 weekday off out of the 5
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 32 }],
      // OR required on Monday — the off-day picker's first/highest-scoring candidate
      // (Mon extends the prior weekend) would vacate it; feasibility must veto that.
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
    });
    const orcOnMon = r.suggestions.filter((s) => s.code === "OR" && s.date === "2025-05-12");
    expect(orcOnMon).toHaveLength(1); // Monday stays staffed
    // exactly one weekday off (4 OR placed across Mon–Fri)
    expect(r.suggestions.filter((s) => s.code === "OR").length).toBe(4);
  });
});
