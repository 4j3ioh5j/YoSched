import { describe, it, expect } from "vitest";
import { autoSchedule, type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #178 (David, Feb 2027 review): shifts marked "Spread over the month" are spread, as
// one group per person, across the weeks instead of bunched into one week.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-orl"], availabilityRules: avail([1, 2, 3, 4, 5]),
  isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
});
const shift = (id: string, code: string, o: Partial<TestShift> = {}): TestShift => ({
  id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
  countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
  sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
  ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
});
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 30, isFillShift: true });
const ORC = shift("st-orc", "ORC", { defaultHours: 16, schedulePriority: 20 });
const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 25 });

// PP Sun 2025-05-11 .. Sat 2025-05-24.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const manual = (staffId: string, date: string, shiftTypeId: string, code: string): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code, isLocked: false, source: "manual" });
const reqOn = (shiftTypeId: string, code: string, dayKeys: string[]) =>
  dayKeys.map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: 1, preferredCount: 1, maxCount: 1 }));

function input(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2], staff: [], shiftTypes: [OR, OFF, ORC, ORL], existingAssignments: [], payPeriods: [PP],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
    equityFactors: [], followRules: [],
    ...o,
  });
}
const at = (r: ReturnType<typeof autoSchedule>, inp: AutoScheduleInput, who: string, d: string) =>
  r.suggestions.find((s) => s.staffId === who && s.date === d)?.code ?? inp.existingAssignments.find((a) => a.staffId === who && a.date === d)?.code;
const orcOn = (r: ReturnType<typeof autoSchedule>, d: string) => r.suggestions.find((s) => s.date === d && s.shiftTypeId === "st-orc")?.staffId;

const CALL = shift("st-call", "CALL", { defaultHours: 8 });
const ALL = [OR, OFF, ORC, ORL, CALL];
const mark = (ids: string[]) => ALL.map((s) => (ids.includes(s.id) ? { ...s, spreadOverMonth: true } : s));
const elig = { eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-orl", "st-call"] };
const both = (o: Partial<AutoScheduleInput>, ids: string[]) =>
  [autoSchedule(input({ ...o, shiftTypes: ALL })), autoSchedule(input({ ...o, shiftTypes: mark(ids) }))] as const;
const ofShift = (r: ReturnType<typeof autoSchedule>, st: string) =>
  r.suggestions.filter((s) => s.shiftTypeId === st).map((s) => `${s.staffId}${s.date.slice(8)}`).sort();
const spreadWarnings = (r: ReturnType<typeof autoSchedule>) => r.warnings.filter((w) => w.includes("spread shifts"));
const MIN = (n: number) => ({ shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: n, maxCount: null, window: "pay_period", windowDays: null }] }) as Partial<ScheduleStaff>;

describe("who gets a marked shift (card #178)", () => {
  // AB worked a CALL Tuesday, CD an OR (same hours); Thursday's ORC is otherwise a tie.
  const tie = { staff: [staff("ab", elig), staff("cd", elig)], existingAssignments: [manual("ab", W1[1], "st-call", "CALL"), manual("cd", W1[1], "st-or", "OR")], staffingRequirements: reqOn("st-orc", "ORC", ["4"]) };

  it("among equally-shared people, the one without a marked shift close by", () => {
    const [plain, marked] = both(tie, ["st-orc", "st-call"]);
    expect(orcOn(plain, W1[3])).toBe("ab"); // unmarked: the tie goes to AB, two days after the CALL
    expect(orcOn(marked, W1[3])).toBe("cd");
  });

  it("only the marked shifts count: marking ORC alone leaves the CALL out of it", () => {
    expect(orcOn(both(tie, ["st-orc"])[1], W1[3])).toBe("ab");
  });

  it("share fairness still comes first", () => {
    const o = { ...tie, existingAssignments: [...tie.existingAssignments, manual("cd", W2[1], "st-orc", "ORC")] };
    expect(orcOn(both(o, ["st-orc", "st-call"])[1], W1[3])).toBe("ab"); // CD already has an ORC
  });

  it("a hard minimum still comes first", () => {
    const o = { ...tie, staff: [staff("ab", { ...elig, ...MIN(2) }), staff("cd", elig)] };
    expect(orcOn(both(o, ["st-orc", "st-call"])[1], W1[3])).toBe("ab");
  });

  it("marking a shift nobody has or needs changes nothing", () => {
    const o = { ...tie, staffingRequirements: reqOn("st-orl", "ORL", ["2", "4"]) };
    const [plain, marked] = both({ ...o, existingAssignments: [] }, ["st-call"]);
    expect(marked).toEqual(plain);
  });
});

describe("paired groups (card #178)", () => {
  // ORL (12h, 8h fill) goes in pairs; needed Mon+Fri both weeks. AB has CALLs Mon 12 and
  // Thu 15, CD a CALL Thu 22.
  const o = {
    staff: [staff("ab", elig), staff("cd", elig)],
    existingAssignments: [manual("ab", W1[0], "st-call", "CALL"), manual("ab", W1[3], "st-call", "CALL"), manual("cd", W2[3], "st-call", "CALL")],
    staffingRequirements: reqOn("st-orl", "ORL", ["1", "5"]),
  };
  const callDays: Record<string, number[]> = { ab: [12, 15], cd: [22] };
  const nearCall = (orls: string[]) => orls.filter((x) => callDays[x.slice(0, 2)].some((c) => Math.abs(c - Number(x.slice(2))) <= 3));

  it("each pair is hosted by whoever's OWN pair lands clear of their marked shifts", () => {
    // Placement under test: the card #266 spacing trial is off here (see the next test).
    const plain = autoSchedule(input({ ...o, shiftTypes: ALL }));
    const marked = autoSchedule(input({ ...o, shiftTypes: mark(["st-orl", "st-call"]) }));
    expect(nearCall(ofShift(plain, "st-orl")).length).toBeGreaterThan(0);
    // Scored on the first need date alone, CD (nothing near Mon 12) took all four, two next to its CALL.
    expect(ofShift(marked, "st-orl")).toEqual(["ab19", "ab23", "cd12", "cd16"]);
    expect(nearCall(ofShift(marked, "st-orl"))).toEqual([]);
  });

});

describe("owed shifts and the report (card #178)", () => {
  it("a second owed ORC goes 4+ days from the first", () => {
    const o = { staff: [staff("ab", MIN(2))], payPeriods: [{ ...PP, targetHours: 32 }] };
    const [plain, marked] = both(o, ["st-orc"]);
    expect(ofShift(plain, "st-orc")).toEqual(["ab12", "ab13"]);
    const days = ofShift(marked, "st-orc").map((x) => Number(x.slice(2)));
    expect(days).toHaveLength(2);
    expect(days[1] - days[0]).toBeGreaterThanOrEqual(4);
  });

  // AB: CALL Mon+Tue, the engine adds Wednesday's ORC (CD is busy then); CD takes the next one.
  const bunched = {
    staff: [staff("ab", elig), staff("cd", elig)],
    existingAssignments: [manual("ab", W1[0], "st-call", "CALL"), manual("ab", W1[1], "st-call", "CALL"), manual("cd", W1[2], "st-or", "OR")],
    staffingRequirements: reqOn("st-orc", "ORC", ["3"]),
  };

  it("names a person left with 3 marked shifts in 7 days and a whole week without any", () => {
    const [plain, marked] = both(bunched, ["st-orc", "st-call"]);
    expect(at(marked, input(bunched), "ab", W1[2])).toBe("ORC");
    expect(spreadWarnings(plain)).toEqual([]);
    expect(spreadWarnings(marked)).toHaveLength(1);
    expect(spreadWarnings(marked)[0]).toMatch(/^AB: 3 spread shifts in 7 days \(05-\d\d\.\.05-\d\d\), none in 05-\d\d\.\.05-\d\d$/);
  });

  it("stays quiet when no whole week is empty", () => {
    const o = { ...bunched, existingAssignments: [...bunched.existingAssignments, manual("ab", W2[2], "st-call", "CALL")] };
    expect(spreadWarnings(both(o, ["st-orc", "st-call"])[1])).toEqual([]);
  });

  it("a frozen (already published) week never counts as the empty one", () => {
    // Same bunch in week 2; week 1 is published. Unfrozen, the empty week 1 is named.
    const o = {
      staff: [staff("ab", elig), staff("cd", elig)],
      existingAssignments: [manual("ab", W2[0], "st-call", "CALL"), manual("ab", W2[1], "st-call", "CALL"), manual("cd", W2[2], "st-or", "OR"), manual("cd", W1[2], "st-or", "OR"), manual("ab", W1[2], "st-or", "OR")],
      staffingRequirements: reqOn("st-orc", "ORC", ["3"]),
    };
    const open = autoSchedule(input({ ...o, shiftTypes: mark(["st-orc", "st-call"]) }));
    expect(spreadWarnings(open)).toHaveLength(1);
    const frozen = autoSchedule(input({ ...o, shiftTypes: mark(["st-orc", "st-call"]), writableFrom: W2[0] }));
    expect(at(frozen, input(o), "ab", W2[2])).toBe("ORC");
    expect(spreadWarnings(frozen)).toEqual([]);
  });
});
