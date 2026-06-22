import { describe, it, expect } from "vitest";
import { checkCellWarnings, checkDayStaffing, checkStaffPPHours, type Warning } from "../constraints";
import { buildFollowRuleMap, type FollowRuleRow } from "../follow-rules";

function makeShiftType(id: string, code: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code,
    defaultHours: 8,
    countsTowardFte: true,
    isOffShift: false,
    ignoresWorkingDays: false,
    ...overrides,
  };
}

function makeStaff(id: string, initials: string, workDays: number[] = [1, 2, 3, 4, 5]) {
  return {
    id,
    initials,
    ftePercentage: 1,
    availabilityRules: workDays.map((d) => ({
      dayOfWeek: d,
      type: "available" as const,
      strength: "rule" as const,
      pattern: "every" as const,
    })),
  };
}

function makeAssignmentMap(entries: Record<string, { shiftTypeId: string; code: string }>) {
  return { get: (key: string) => entries[key] };
}

describe("checkCellWarnings", () => {
  const stMap = new Map([
    ["st-or", makeShiftType("st-or", "OR")],
    ["st-call", makeShiftType("st-call", "CALL")],
    ["st-off", makeShiftType("st-off", "OFF", { isOffShift: true })],
    ["st-admin", makeShiftType("st-admin", "ADM", { ignoresWorkingDays: true })],
  ]);
  const staff = makeStaff("p1", "AB");
  const allStaff = [staff];
  const holidaySet = new Set<string>();
  const staffingMins = [{ role: "OR", dayType: "weekday", minimumCount: 2 }];

  it("returns empty for null shiftTypeId", () => {
    const w = checkCellWarnings({
      staffId: "p1", date: "2025-05-12", shiftTypeId: null,
      staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
      allStaff, holidaySet, staffingMins,
    });
    expect(w).toEqual([]);
  });

  it("returns empty for unknown shiftTypeId", () => {
    const w = checkCellWarnings({
      staffId: "p1", date: "2025-05-12", shiftTypeId: "unknown",
      staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
      allStaff, holidaySet, staffingMins,
    });
    expect(w).toEqual([]);
  });

  describe("non-working-day warnings", () => {
    it("warns when scheduled on a non-work day", () => {
      // 2025-05-17 is Saturday, staff works M-F
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-17", shiftTypeId: "st-or",
        staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
        allStaff, holidaySet, staffingMins,
      });
      expect(w).toHaveLength(1);
      expect(w[0].type).toBe("non-working-day");
      expect(w[0].message).toContain("Saturdays"); // full day name, not an abbreviation
    });

    it("does not warn on working days", () => {
      // 2025-05-12 is Monday
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or",
        staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
        allStaff, holidaySet, staffingMins,
      });
      expect(w.find((w) => w.type === "non-working-day")).toBeUndefined();
    });

    it("does not warn for off-shifts on non-work days", () => {
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-17", shiftTypeId: "st-off",
        staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
        allStaff, holidaySet, staffingMins,
      });
      expect(w.find((w) => w.type === "non-working-day")).toBeUndefined();
    });

    it("does not warn for ignoresWorkingDays shifts", () => {
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-17", shiftTypeId: "st-admin",
        staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
        allStaff, holidaySet, staffingMins,
      });
      expect(w.find((w) => w.type === "non-working-day")).toBeUndefined();
    });
  });

  describe("follow rule warnings", () => {
    const followRules: FollowRuleRow[] = [
      { sourceShiftId: "st-call", allowedShiftId: "st-off", allowOffShifts: true, mode: "allow" },
    ];
    const followRuleMap = buildFollowRuleMap(followRules);

    it("warns when today's shift violates yesterday's follow rule", () => {
      // Yesterday was CALL, today is OR → not allowed (only OFF allowed after CALL)
      const aMap = makeAssignmentMap({
        "p1:2025-05-11": { shiftTypeId: "st-call", code: "CALL" },
      });
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or",
        staff, shiftTypeMap: stMap, assignmentMap: aMap,
        allStaff, holidaySet, staffingMins, followRuleMap,
      });
      expect(w.some((w) => w.type === "post-shift")).toBe(true);
      expect(w.find((w) => w.type === "post-shift")!.message).toContain("cannot follow CALL");
    });

    it("no warning when today's shift is allowed after yesterday's", () => {
      const aMap = makeAssignmentMap({
        "p1:2025-05-11": { shiftTypeId: "st-call", code: "CALL" },
      });
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-off",
        staff, shiftTypeMap: stMap, assignmentMap: aMap,
        allStaff, holidaySet, staffingMins, followRuleMap,
      });
      expect(w.find((w) => w.type === "post-shift")).toBeUndefined();
    });

    it("warns when today's shift restricts tomorrow and tomorrow violates it", () => {
      // Today is CALL, tomorrow is OR → forward-looking warning
      const aMap = makeAssignmentMap({
        "p1:2025-05-13": { shiftTypeId: "st-or", code: "OR" },
      });
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-call",
        staff, shiftTypeMap: stMap, assignmentMap: aMap,
        allStaff, holidaySet, staffingMins, followRuleMap,
      });
      expect(w.some((w) => w.type === "post-shift" && w.message.includes("tomorrow"))).toBe(true);
    });

    it("no follow-rule warnings when followRuleMap not provided", () => {
      const aMap = makeAssignmentMap({
        "p1:2025-05-11": { shiftTypeId: "st-call", code: "CALL" },
      });
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or",
        staff, shiftTypeMap: stMap, assignmentMap: aMap,
        allStaff, holidaySet, staffingMins,
      });
      expect(w.find((w) => w.type === "post-shift")).toBeUndefined();
    });
  });

  describe("request-violation warnings", () => {
    const offReq = {
      id: "rq1", staffId: "p1", startDate: "2025-05-12", endDate: "2025-05-12",
      kind: "OFF" as const, shiftTypeIds: [], leaveShiftTypeId: null,
      strength: "hard" as const, status: "approved" as const,
    };

    it("flags a working shift placed on an approved hard OFF request", () => {
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or",
        staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
        allStaff, holidaySet, staffingMins, scheduleRequests: [offReq],
      });
      const v = w.find((x) => x.type === "request-violation");
      expect(v?.message).toContain("Requested OFF");
    });

    it("no request warning when scheduleRequests omitted (back-compat)", () => {
      const w = checkCellWarnings({
        staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or",
        staff, shiftTypeMap: stMap, assignmentMap: makeAssignmentMap({}),
        allStaff, holidaySet, staffingMins,
      });
      expect(w.find((x) => x.type === "request-violation")).toBeUndefined();
    });
  });
});

describe("checkDayStaffing", () => {
  const stMap = new Map([
    ["st-or", makeShiftType("st-or", "OR")],
    ["st-orc", makeShiftType("st-orc", "ORC")],
    ["st-off", makeShiftType("st-off", "OFF", { isOffShift: true })],
  ]);
  const staff = [
    makeStaff("p1", "AB"),
    makeStaff("p2", "CD"),
    makeStaff("p3", "EF"),
  ];
  const holidaySet = new Set<string>();

  describe("legacy staffing minimums", () => {
    const staffingMins = [{ role: "OR", dayType: "weekday", minimumCount: 2 }];

    it("warns when below minimum staffing", () => {
      const aMap = makeAssignmentMap({
        "p1:2025-05-12": { shiftTypeId: "st-or", code: "OR" },
      });
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet, staffingMins,
      });
      expect(w.some((w) => w.type === "understaffed")).toBe(true);
    });

    it("no warning when at or above minimum", () => {
      const aMap = makeAssignmentMap({
        "p1:2025-05-12": { shiftTypeId: "st-or", code: "OR" },
        "p2:2025-05-12": { shiftTypeId: "st-or", code: "OR" },
      });
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet, staffingMins,
      });
      expect(w.find((w) => w.type === "understaffed")).toBeUndefined();
    });

    it("does not count off-shifts toward staffing", () => {
      const aMap = makeAssignmentMap({
        "p1:2025-05-12": { shiftTypeId: "st-or", code: "OR" },
        "p2:2025-05-12": { shiftTypeId: "st-off", code: "OFF" },
      });
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet, staffingMins,
      });
      expect(w.some((w) => w.type === "understaffed")).toBe(true);
    });

    it("matches holiday day type correctly", () => {
      const hSet = new Set(["2025-05-12"]);
      const mins = [{ role: "OR", dayType: "holiday", minimumCount: 1 }];
      const aMap = makeAssignmentMap({});
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet: hSet, staffingMins: mins,
      });
      expect(w.some((w) => w.type === "understaffed")).toBe(true);
    });
  });

  describe("per-shift staffing requirements", () => {
    it("warns per shift code when below requirement", () => {
      const reqs = [{ shiftCode: "OR", dayKey: "1", minCount: 2 }];
      const aMap = makeAssignmentMap({
        "p1:2025-05-12": { shiftTypeId: "st-or", code: "OR" },
      });
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet, staffingMins: [], staffingReqs: reqs,
      });
      expect(w.some((w) => w.message.includes("OR"))).toBe(true);
    });

    it("uses shift-count type when actual is 0", () => {
      const reqs = [{ shiftCode: "OR", dayKey: "1", minCount: 1 }];
      const aMap = makeAssignmentMap({});
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet, staffingMins: [], staffingReqs: reqs,
      });
      const shiftCountWarning = w.find((w) => w.type === "shift-count");
      expect(shiftCountWarning).toBeDefined();
      expect(shiftCountWarning!.message).toContain("0/1 OR");
    });

    it("uses holiday dayKey for holidays", () => {
      const hSet = new Set(["2025-05-12"]);
      const reqs = [{ shiftCode: "OR", dayKey: "holiday", minCount: 1 }];
      const aMap = makeAssignmentMap({});
      const w = checkDayStaffing({
        date: "2025-05-12", staff, assignmentMap: aMap,
        shiftTypeMap: stMap, holidaySet: hSet, staffingMins: [], staffingReqs: reqs,
      });
      expect(w.some((w) => w.message.includes("OR") && w.message.includes("holiday"))).toBe(true);
    });
  });
});

describe("checkStaffPPHours", () => {
  const staff = makeStaff("p1", "AB");

  it("returns null when no pay period", () => {
    expect(checkStaffPPHours({
      staffId: "p1", staff, pp: null, currentHours: 100,
    })).toBeNull();
  });

  it("returns null when target is 0", () => {
    const pp = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 0 };
    expect(checkStaffPPHours({
      staffId: "p1", staff, pp, currentHours: 100,
    })).toBeNull();
  });

  it("returns null when hours equal target (within float epsilon)", () => {
    const pp = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
    expect(checkStaffPPHours({
      staffId: "p1", staff, pp, currentHours: 80,
    })).toBeNull();
    // sub-epsilon noise must not fire
    expect(checkStaffPPHours({
      staffId: "p1", staff, pp, currentHours: 80.0005,
    })).toBeNull();
  });

  it("warns on ANY amount over target (strict, no tolerance band)", () => {
    const pp = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
    const w = checkStaffPPHours({
      staffId: "p1", staff, pp, currentHours: 80.5,
    });
    expect(w).not.toBeNull();
    expect(w!.type).toBe("over-hours");
    expect(w!.message).toContain("80.5");
    expect(w!.message).toContain("+0.5");
  });

  it("warns on ANY amount under target", () => {
    const pp = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
    const w = checkStaffPPHours({
      staffId: "p1", staff, pp, currentHours: 76,
    });
    expect(w).not.toBeNull();
    expect(w!.type).toBe("under-hours");
    expect(w!.message).toContain("76");
    expect(w!.message).toContain("-4");
  });

  it("treats a fully-empty pay period as under (zero hours fires)", () => {
    const pp = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
    const w = checkStaffPPHours({
      staffId: "p1", staff, pp, currentHours: 0,
    });
    expect(w).not.toBeNull();
    expect(w!.type).toBe("under-hours");
  });

  it("scales target by FTE percentage", () => {
    const partTime = { ...staff, ftePercentage: 0.5 };
    const pp = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
    // target = 80 * 0.5 = 40
    expect(checkStaffPPHours({
      staffId: "p1", staff: partTime, pp, currentHours: 40,
    })).toBeNull();
    const w = checkStaffPPHours({
      staffId: "p1", staff: partTime, pp, currentHours: 41,
    });
    expect(w).not.toBeNull();
    expect(w!.type).toBe("over-hours");
  });
});
