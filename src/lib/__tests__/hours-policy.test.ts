import { describe, it, expect } from "vitest";
import { autoSchedule as autoScheduleRaw, effectiveFactorKeys, type ScheduleStaff, type ScheduleShiftType, type AutoScheduleResult, type AutoGenFactorConfig } from "../auto-scheduler";
import { type ScheduleRequestData } from "../schedule-requests";
import { withDayCaps, type TestShift } from "./test-day-caps";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { validateHoursPolicies, parseHoursPolicy, isHoursPolicy } from "../autogen-hours-policy";

// Fixtures declare per-day caps inline (test-only maxPerDay); the engine reads Staffing Rules Max.
const autoSchedule = (input: Parameters<typeof autoScheduleRaw>[0]) => autoScheduleRaw(withDayCaps(input));

// Pay-period hours policy (prohibited / discouraged / allowed) + coverage repair by
// rearrangement. The fixture mirrors the January 2027 case: a 0.4-FTE requester with two
// 16h ORC requests plus an 8h locked shift in one pay period (40h vs 32h), ORC minimum 1
// every weekday, ORC → off only, ORC → X follower, and full-timers whose fill OR days block
// the day after a re-homed ORC.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));

function staff(id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff {
  return {
    id, initials, ftePercentage: 1,
    eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true, isAutoScheduled: true, specialQualifications: [],
    ...o,
  };
}
function shift(id: string, code: string, o: Partial<TestShift> = {}): TestShift {
  return {
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
    countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
    sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true,
    ...o,
  };
}
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 100, isFillShift: true });
const ORC = shift("st-orc", "ORC", { defaultHours: 16, schedulePriority: 20, maxPerDay: 1 });

// Two weeks of weekdays in one 14-day pay period (Sun 2025-05-11 .. Sat 2025-05-24).
const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16",
  "2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];

function req(staffId: string, date: string, receivedAt: string): ScheduleRequestData {
  return {
    id: `req-${staffId}-${date}`, staffId, startDate: date, endDate: date, kind: "REQUEST_SHIFT",
    shiftTypeIds: ["st-orc"], leaveShiftTypeId: null, strength: "hard", status: "pending", receivedAt,
  } as ScheduleRequestData;
}

const ORDER = ["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness"];
const DAVID_ORDER = ["hardLimits", "coverage", "underHours", "overHours", "requests", "fairness"];
function factors(order: string[], over?: string, under?: string): AutoGenFactorConfig[] {
  return order.map((key, i) => ({
    key, sortOrder: i, enabled: true,
    ...(key === "overHours" && over ? { hoursPolicy: over as AutoGenFactorConfig["hoursPolicy"] } : {}),
    ...(key === "underHours" && under ? { hoursPolicy: under as AutoGenFactorConfig["hoursPolicy"] } : {}),
  }));
}

type Locked = { staffId: string; date: string; shiftTypeId: string; code: string };
function run(factorOrder: AutoGenFactorConfig[] | undefined, extraLocked: Locked[] = []): AutoScheduleResult {
  const kz = staff("kz", "KZ", { ftePercentage: 0.4 });
  return autoSchedule({
    dates: DATES,
    staff: [staff("aa", "AA"), staff("bb", "BB"), staff("cc", "CC"), staff("dd", "DD"), kz],
    shiftTypes: [OR, ORC, OFF],
    existingAssignments: [
      // KZ already holds 8h by hand → 16 + 16 + 8 = 40h against a 32h target.
      { staffId: "kz", date: "2025-05-14", shiftTypeId: "st-or", code: "OR", isLocked: true, source: "manual" },
      ...extraLocked.map((l) => ({ ...l, isLocked: true, source: "manual" })),
    ],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [1, 2, 3, 4, 5].map((d) => ({ shiftCode: "ORC", dayKey: String(d), minCount: 1 })),
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [],
    // ORC → only a day off next.
    followRules: [{ sourceShiftId: "st-orc", allowedShiftId: null, allowOffShifts: true, mode: "allow" }],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }],
    scheduleRequests: [req("kz", "2025-05-12", "2025-04-01T00:00:00Z"), req("kz", "2025-05-20", "2025-04-02T00:00:00Z")],
    factorOrder,
  });
}

const orcOn = (r: AutoScheduleResult, date: string) => r.suggestions.filter((s) => s.code === "ORC" && s.date === date);
const cell = (r: AutoScheduleResult, staffId: string, date: string) =>
  r.suggestions.find((s) => s.staffId === staffId && s.date === date)?.code;

// One WORK shift per person per day. (The engine records a follower day off and the later
// day-off fill on the same cell as two X suggestions; that's pre-existing and harmless.)
function noDoubleBooking(r: AutoScheduleResult) {
  const seen = new Set<string>();
  for (const s of r.suggestions) {
    if (s.code === "X") continue;
    const k = `${s.staffId}:${s.date}`;
    expect(seen.has(k), `double-booked ${k}`).toBe(false);
    seen.add(k);
  }
}

describe("pay-period hours policy", () => {
  it("under=Prohibited ranked above over: keeps the requester's ORC over target and flags it (Jan 11 case)", () => {
    const r = run(factors(DAVID_ORDER, "discouraged", "prohibited"));
    expect(cell(r, "kz", "2025-05-12")).toBe("ORC");
    expect(cell(r, "kz", "2025-05-20")).toBe("ORC");
    expect(r.warnings.some((w) => w.startsWith("KZ: over target") && w.includes("2025-05-12"))).toBe(true);
    for (const d of DATES) expect(orcOn(r, d).length).toBeLessThanOrEqual(1);
    noDoubleBooking(r);
  });

  it("requests ranked above Discouraged over-target: keeps the request", () => {
    const order = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
    const r = run(factors(order, "discouraged", "discouraged"));
    expect(cell(r, "kz", "2025-05-12")).toBe("ORC");
  });

  it("over=Allowed: keeps the request whatever the rank", () => {
    const r = run(factors(ORDER, "allowed", "discouraged"));
    expect(cell(r, "kz", "2025-05-12")).toBe("ORC");
  });

  it("over=Prohibited: revokes the earliest request and rearranges someone to cover the minimum", () => {
    const r = run(factors(ORDER, "prohibited", "discouraged"));
    expect(cell(r, "kz", "2025-05-12")).not.toBe("ORC");
    const orc = orcOn(r, "2025-05-12");
    expect(orc).toHaveLength(1);
    const mover = orc[0].staffId;
    // ORC → off only: the next day is the X follower, not an OR.
    expect(cell(r, mover, "2025-05-13")).toBe("X");
    expect(r.warnings.some((w) => w.includes("deferred KZ's ORC request") && w.includes("takes ORC on 2025-05-12"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("2025-05-12") && w.includes("below its required minimum"))).toBe(false);
    noDoubleBooking(r);
  });

  it("default config (no policies, default order): the revoked slot is still covered by rearranging", () => {
    const r = run(undefined);
    expect(cell(r, "kz", "2025-05-12")).not.toBe("ORC");
    expect(orcOn(r, "2025-05-12")).toHaveLength(1);
    noDoubleBooking(r);
  });

  it("never moves manual cells: when the day after is held by hand, the minimum is flagged, not forced", () => {
    const r = run(factors(ORDER, "prohibited", "discouraged"), [
      { staffId: "aa", date: "2025-05-13", shiftTypeId: "st-or", code: "OR" },
      { staffId: "bb", date: "2025-05-13", shiftTypeId: "st-or", code: "OR" },
      { staffId: "cc", date: "2025-05-13", shiftTypeId: "st-or", code: "OR" },
      { staffId: "dd", date: "2025-05-13", shiftTypeId: "st-or", code: "OR" },
    ]);
    expect(orcOn(r, "2025-05-12")).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("2025-05-12") && w.includes("ORC below its required minimum"))).toBe(true);
    // The hand-placed cells are untouched (no suggestion overwrote them).
    expect(r.suggestions.some((s) => s.date === "2025-05-13" && s.staffId !== "kz")).toBe(false);
  });

  it("is deterministic", () => {
    const a = run(factors(ORDER, "prohibited", "discouraged"));
    const b = run(factors(ORDER, "prohibited", "discouraged"));
    expect(JSON.stringify(a.suggestions)).toBe(JSON.stringify(b.suggestions));
  });
});

describe("hours policy validation", () => {
  it("parses leniently: unknown / null → discouraged", () => {
    expect(parseHoursPolicy(null)).toBe("discouraged");
    expect(parseHoursPolicy("nope")).toBe("discouraged");
    expect(parseHoursPolicy("prohibited")).toBe("prohibited");
    expect(isHoursPolicy("allowed")).toBe(true);
    expect(isHoursPolicy("Allowed")).toBe(false);
  });

  it("validates writes strictly", () => {
    expect(validateHoursPolicies(undefined)).toEqual({ ok: true, policies: {} });
    expect(validateHoursPolicies({ overHours: "allowed", underHours: "prohibited" })).toEqual({
      ok: true, policies: { overHours: "allowed", underHours: "prohibited" },
    });
    expect(validateHoursPolicies({ overHours: "sometimes" }).ok).toBe(false);
    expect(validateHoursPolicies({ coverage: "allowed" }).ok).toBe(false);
    expect(validateHoursPolicies(["allowed"]).ok).toBe(false);
    expect(validateHoursPolicies(null).ok).toBe(false);
  });
});

// ─── Repair guarantees (Codex plan review #193) ───
// Small fixture: Mon–Wed 2025-05-12..14. KZ (0.1 FTE → 8h) requests Monday's ORC (8h here) and
// holds a hand-placed 8h OR on Wednesday → 16/8h, so (requests ranked below over-target) the
// request is revoked. AA (0.2 FTE → 16h) is the only other ORC-eligible staffer and STEP 3
// fills them OR on Mon + Tue. Covering Monday means releasing both (ORC → off-only + X follower).
describe("coverage repair guarantees", () => {
  const ORC8 = shift("st-orc", "ORC", { defaultHours: 8, defaultHoursHoliday: 8, schedulePriority: 20, maxPerDay: 1 });
  const HOL = shift("st-hol", "HOL", { isLeave: true, defaultHours: 8, defaultHoursHoliday: 8, autoSchedulable: false });
  const MON = "2025-05-12", TUE = "2025-05-13", WED = "2025-05-14";
  type Opts = { aaDays?: number[]; orMinTue?: number; tueHoliday?: boolean; factorOrder?: AutoGenFactorConfig[] };
  function small(o: Opts = {}): AutoScheduleResult {
    const aaDays = o.aaDays ?? [1, 2, 3];
    return autoSchedule({
      dates: [MON, TUE, WED],
      staff: [
        staff("aa", "AA", {
          ftePercentage: 0.2,
          availabilityRules: aaDays.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
        }),
        staff("kz", "KZ", { ftePercentage: 0.1 }),
      ],
      shiftTypes: [OR, ORC8, OFF, ...(o.tueHoliday ? [HOL] : [])],
      existingAssignments: [{ staffId: "kz", date: WED, shiftTypeId: "st-or", code: "OR", isLocked: true, source: "manual" }],
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
      holidays: o.tueHoliday ? [{ date: TUE }] : [],
      desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
      staffingRequirements: [
        { shiftCode: "ORC", dayKey: "1", minCount: 1 },
        ...(o.orMinTue ? [{ shiftCode: "OR", dayKey: "2", minCount: o.orMinTue }] : []),
      ],
      schedulingPreferences: {
        prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
        sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
        pendingRequestMode: "full", requestConflictPolicy: "reconcile", holidayPolicy: "entitlement",
      },
      equityFactors: [],
      followRules: [{ sourceShiftId: "st-orc", allowedShiftId: null, allowOffShifts: true, mode: "allow" }],
      requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }],
      scheduleRequests: [req("kz", MON, "2025-04-01T00:00:00Z")],
      factorOrder: o.factorOrder,
    });
  }
  const orcMon = (r: AutoScheduleResult) => r.suggestions.filter((s) => s.code === "ORC" && s.date === MON);

  it("baseline: AA gives up Mon + Tue OR, takes ORC + X, and is refilled on Wednesday", () => {
    const r = small();
    expect(orcMon(r).map((s) => s.staffId)).toEqual(["aa"]);
    expect(cell(r, "aa", TUE)).toBe("X");
    expect(cell(r, "aa", WED)).toBe("OR");
  });

  // Over-target Prohibited in these keeps the revoked requester KZ from being handed the
  // slot back by the repair (with over Discouraged below coverage, that is a legal cover).
  it("failed refill + under-target Prohibited: the move is rejected and the minimum is flagged", () => {
    // AA works Mon/Tue only → no refill day → the move would leave AA 8/16h.
    const r = small({ aaDays: [1, 2], factorOrder: factors(ORDER, "prohibited", "prohibited") });
    expect(orcMon(r)).toHaveLength(0);
    expect(cell(r, "aa", MON)).toBe("OR");
    expect(cell(r, "aa", TUE)).toBe("OR");
    expect(r.warnings.some((w) => w.includes(MON) && w.includes("ORC below its required minimum"))).toBe(true);
  });

  it("failed refill + under-target Discouraged (coverage ranked above it): covers and lets AA land under", () => {
    const r = small({ aaDays: [1, 2], factorOrder: factors(ORDER, "prohibited", "discouraged") });
    expect(orcMon(r).map((s) => s.staffId)).toEqual(["aa"]);
  });

  it("never releases a day whose own minimum would break", () => {
    // OR minimum 1 on Tuesday and AA is the only OR body → releasing Tuesday would open a gap there.
    const r = small({ orMinTue: 1, factorOrder: factors(ORDER, "prohibited", "discouraged") });
    expect(orcMon(r)).toHaveLength(0);
    expect(cell(r, "aa", TUE)).toBe("OR");
  });

  it("never releases an adjacent holiday-entitlement HOL", () => {
    // Tuesday is a holiday: AA holds HOL (step holiday) there, which ORC → off-only forbids after Monday.
    const r = small({ tueHoliday: true, factorOrder: factors(ORDER, "prohibited", "discouraged") });
    expect(orcMon(r)).toHaveLength(0);
    expect(cell(r, "aa", TUE)).toBe("HOL");
  });
});

describe("policy reaches every placement path", () => {
  it("a hard per-staff minimum cannot push past a Prohibited over-target", () => {
    const REQ = shift("st-req", "REQ", { schedulePriority: 1 });
    const FILL = shift("st-fill", "FILL", { isFillShift: true });
    const mk = (factorOrder?: AutoGenFactorConfig[]) => autoSchedule({
      dates: ["2025-05-12"],
      staff: [staff("p1", "AB", {
        eligibleShiftTypeIds: ["st-req", "st-fill", "st-off"],
        shiftMinimumTargets: [{ shiftTypeId: "st-req", minCount: 1, maxCount: null, window: "pay_period", windowDays: null }],
      })],
      shiftTypes: [REQ, FILL, OFF], existingAssignments: [],
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 4 }],
      holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
      staffingRequirements: [],
      schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
      equityFactors: [], followRules: [], factorOrder,
    });
    const reqCount = (r: AutoScheduleResult) => r.suggestions.filter((s) => s.code === "REQ").length;
    expect(reqCount(mk(undefined))).toBe(1); // default: hard minimum overrides the cap (unchanged)
    expect(reqCount(mk(factors(ORDER, "prohibited", "discouraged")))).toBe(0);
  });

  it("weekend pairs don't fall back to an over-target host when over-target is Prohibited", () => {
    const CALL = shift("st-call", "CALL", { schedulePriority: 10, weekendPaired: true, defaultHoursWeekend: 8, maxPerDay: 1 });
    const all7 = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
    const mk = (factorOrder?: AutoGenFactorConfig[]) => autoSchedule({
      dates: ["2025-05-17", "2025-05-18"],
      staff: [staff("p1", "AB", { eligibleShiftTypeIds: ["st-call", "st-or", "st-off"], availabilityRules: all7 })],
      shiftTypes: [OR, CALL, OFF], existingAssignments: [],
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 8 }], // 0.1 FTE of 80 → 8h; the pair is 16h
      holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
      staffingRequirements: [{ shiftCode: "CALL", dayKey: "6", minCount: 1 }, { shiftCode: "CALL", dayKey: "0", minCount: 1 }],
      schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
      equityFactors: [], followRules: [], factorOrder,
    });
    const calls = (r: AutoScheduleResult) => r.suggestions.filter((s) => s.code === "CALL").length;
    expect(calls(mk(undefined))).toBe(2); // default: coverage may push past (unchanged)
    expect(calls(mk(factors(ORDER, "prohibited", "discouraged")))).toBe(0);
  });

  it("STEP 3 never overshoots a Prohibited over-target with a whole fill shift", () => {
    const mk = (factorOrder?: AutoGenFactorConfig[]) => autoSchedule({
      dates: ["2025-05-12"],
      staff: [staff("p1", "AB")],
      shiftTypes: [OR, OFF], existingAssignments: [],
      payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 4 }],
      holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
      staffingRequirements: [],
      schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3 },
      equityFactors: [], followRules: [], factorOrder,
    });
    const ors = (r: AutoScheduleResult) => r.suggestions.filter((s) => s.code === "OR").length;
    expect(ors(mk(undefined))).toBe(1); // default: overshoot 8/4 (unchanged)
    expect(ors(mk(factors(ORDER, "prohibited", "discouraged")))).toBe(0);
    // Both Prohibited with under ranked above over: the higher row (under) wins → overshoot.
    expect(ors(mk(factors(DAVID_ORDER, "prohibited", "prohibited")))).toBe(1);
  });

  it("grading puts Prohibited hours rows first, keeping their relative order", () => {
    expect(effectiveFactorKeys(factors(ORDER))).toEqual(ORDER);
    expect(effectiveFactorKeys(factors(ORDER, "prohibited", "discouraged"))).toEqual(
      ["overHours", "hardLimits", "coverage", "underHours", "requests", "fairness"]);
    expect(effectiveFactorKeys(factors(DAVID_ORDER, "prohibited", "prohibited"))).toEqual(
      ["underHours", "overHours", "hardLimits", "coverage", "requests", "fairness"]);
    // An invalid order falls back to the default, but the policy still applies.
    const badWithUnder = [...factors(ORDER, undefined, "prohibited")].map((f) => (f.key === "fairness" ? { ...f, enabled: false } : f));
    expect(effectiveFactorKeys(badWithUnder)[0]).toBe("underHours");
  });
});

// Codex #199 regressions: one-week pay period (40h), AA at 0.4 FTE (16h) available Mon + Tue only.
describe("under-target Prohibited holds on reconciliation backfill and STEP 2", () => {
  const WEEK = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
  const avail = (ds: number[]) => ds.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
  const monTue = avail([1, 2]);
  const monTueWed = avail([1, 2, 3]);
  const base = (o: Record<string, unknown>) => autoSchedule({
    dates: WEEK, existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-17", targetHours: 40 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [], historicalAssignments: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [], followRules: [], factorOrder: factors(DAVID_ORDER, "discouraged", "prohibited"),
    ...o,
  } as unknown as Parameters<typeof autoSchedule>[0]);
  const hoursOf = (r: AutoScheduleResult, id: string, hrs: Record<string, number>) =>
    r.suggestions.filter((s) => s.staffId === id).reduce((n, s) => n + (hrs[s.code] ?? 0), 0);

  it("backfill never trades a required fill day for a shorter shift that leaves the backfiller under and the day short", () => {
    const PM = shift("st-pm", "PM", { defaultHours: 4, schedulePriority: 50 });
    const r = base({
      staff: [
        // AA (16h) available Mon–Wed: STEP 3 fills Mon (OR minimum) + one more day.
        staff("aa", "AA", { ftePercentage: 0.4, eligibleShiftTypeIds: ["st-or", "st-pm", "st-off"], availabilityRules: monTueWed }),
        // KZ: target 4h, already 4h by hand on Tuesday → the Monday PM request pushes over and is revoked.
        staff("kz", "KZ", { ftePercentage: 0.1, eligibleShiftTypeIds: ["st-pm", "st-off"], availabilityRules: monTue }),
      ],
      shiftTypes: [OR, PM, OFF],
      existingAssignments: [{ staffId: "kz", date: "2025-05-13", shiftTypeId: "st-pm", code: "PM", isLocked: true, source: "manual" }],
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
      scheduleRequests: [{
        id: "req-kz", staffId: "kz", startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT",
        shiftTypeIds: ["st-pm"], leaveShiftTypeId: null, strength: "hard", status: "pending", receivedAt: "2025-04-01T00:00:00Z",
      } as ScheduleRequestData],
      factorOrder: factors(ORDER, "prohibited", "prohibited"),
    });
    expect(cell(r, "kz", "2025-05-12")).not.toBe("PM");
    expect(cell(r, "aa", "2025-05-12")).toBe("OR"); // Monday's OR minimum stays met
    expect(hoursOf(r, "aa", { OR: 8, PM: 4 })).toBe(16);
    expect(r.warnings.some((w) => w.includes("2025-05-12") && w.includes("OR below its required minimum"))).toBe(false);
    expect(r.warnings.some((w) => w.includes("deferred KZ's PM request") && w.includes("no eligible backfill"))).toBe(true);
  });

  it("an earlier claimant who can't commit the slot never displaces a valid holder", () => {
    const PM = shift("st-pm", "PM", { defaultHours: 4, schedulePriority: 50, maxPerDay: 1 });
    const pmReq = (id: string, recv: string) => ({
      id: `req-${id}`, staffId: id, startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT",
      shiftTypeIds: ["st-pm"], leaveShiftTypeId: null, strength: "hard", status: "pending", receivedAt: recv,
    } as ScheduleRequestData);
    const r = base({
      staff: [
        // BB: 12h = Monday PM (4h) + one OR day; asked later but listed first, so STEP 0b
        // places BB's request and AA becomes the earlier challenger at reconciliation.
        staff("bb", "BB", { ftePercentage: 0.3, eligibleShiftTypeIds: ["st-pm", "st-or", "st-off"], availabilityRules: monTue }),
        // AA: the only OR body on Monday (OR minimum 1); asked for Monday PM first.
        staff("aa", "AA", { ftePercentage: 0.4, eligibleShiftTypeIds: ["st-or", "st-pm", "st-off"], availabilityRules: monTueWed }),
      ],
      shiftTypes: [OR, PM, OFF],
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
      scheduleRequests: [pmReq("aa", "2025-04-01T00:00:00Z"), pmReq("bb", "2025-04-02T00:00:00Z")],
    });
    const pm = r.suggestions.filter((x) => x.code === "PM" && x.date === "2025-05-12");
    expect(pm).toHaveLength(1);
    expect(pm[0].staffId).toBe("bb"); // the holder keeps it
    expect(cell(r, "aa", "2025-05-12")).toBe("OR");
    for (const id of ["aa", "bb"]) {
      const target = id === "aa" ? 16 : 12;
      expect(hoursOf(r, id, { OR: 8, PM: 4 }), id).toBe(target);
    }
  });

  it("a first-come transfer refills the holder who gave the shift up, or is undone under Prohibited", () => {
    const PM = shift("st-pm", "PM", { schedulePriority: 50, maxPerDay: 1 });
    const pmReq = (id: string, recv: string) => ({
      id: `req-${id}`, staffId: id, startDate: "2025-05-12", endDate: "2025-05-12", kind: "REQUEST_SHIFT",
      shiftTypeIds: ["st-pm"], leaveShiftTypeId: null, strength: "hard", status: "pending", receivedAt: recv,
    } as ScheduleRequestData);
    const mk = (bbOpts: Partial<ScheduleStaff>, factorOrder: AutoGenFactorConfig[]) => base({
      staff: [
        // BB listed first → STEP 0b places BB's (later) request; AA asked first.
        staff("bb", "BB", { ftePercentage: 0.4, eligibleShiftTypeIds: ["st-or", "st-pm", "st-off"], availabilityRules: monTue, ...bbOpts }),
        staff("aa", "AA", { ftePercentage: 0.4, eligibleShiftTypeIds: ["st-or", "st-pm", "st-off"], availabilityRules: monTue }),
      ],
      shiftTypes: [OR, PM, OFF], staffingRequirements: [],
      scheduleRequests: [pmReq("aa", "2025-04-01T00:00:00Z"), pmReq("bb", "2025-04-02T00:00:00Z")],
      factorOrder,
    });
    // BB can work OR on the freed Monday → the transfer stands and both end at 16/16.
    const r = mk({}, factors(DAVID_ORDER, "discouraged", "prohibited"));
    expect(cell(r, "aa", "2025-05-12")).toBe("PM");
    expect(cell(r, "bb", "2025-05-12")).toBe("OR");
    expect(hoursOf(r, "aa", { OR: 8, PM: 8 })).toBe(16);
    expect(hoursOf(r, "bb", { OR: 8, PM: 8 })).toBe(16);
    // BB (8h, PM only) can't be refilled: under Prohibited BB keeps it; under Discouraged first-come wins.
    const pmOnly = { ftePercentage: 0.2, eligibleShiftTypeIds: ["st-pm", "st-off"] };
    const kept = mk(pmOnly, factors(DAVID_ORDER, "discouraged", "prohibited"));
    expect(cell(kept, "bb", "2025-05-12")).toBe("PM");
    expect(kept.suggestions.filter((x) => x.code === "PM" && x.date === "2025-05-12")).toHaveLength(1);
    const moved = mk(pmOnly, factors(DAVID_ORDER, "discouraged", "discouraged"));
    expect(cell(moved, "aa", "2025-05-12")).toBe("PM");
  });

  it("STEP 2 won't place a shift + recovery day that turns a reachable target into a Prohibited shortfall", () => {
    const CALL = shift("st-call", "CALL", { schedulePriority: 10 });
    const mk = (factorOrder?: AutoGenFactorConfig[]) => base({
      staff: [staff("aa", "AA", { ftePercentage: 0.4, eligibleShiftTypeIds: ["st-or", "st-call", "st-off"], availabilityRules: monTue })],
      shiftTypes: [OR, CALL, OFF],
      staffingRequirements: [{ shiftCode: "CALL", dayKey: "1", minCount: 1 }],
      requiredFollowers: [{ sourceShiftId: "st-call", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }],
      factorOrder,
    });
    const r = mk(factors(DAVID_ORDER, "discouraged", "prohibited"));
    expect(cell(r, "aa", "2025-05-12")).toBe("OR");
    expect(cell(r, "aa", "2025-05-13")).toBe("OR");
    expect(hoursOf(r, "aa", { OR: 8, CALL: 8 })).toBe(16);
    expect(r.warnings.some((w) => w.includes("2025-05-12") && w.includes("CALL below its required minimum"))).toBe(true);
    // Under-target only Discouraged (coverage ranked above it): coverage wins, as before.
    const d = mk(factors(DAVID_ORDER, "discouraged", "discouraged"));
    expect(cell(d, "aa", "2025-05-12")).toBe("CALL");
  });

  it("over-target Allowed doesn't block a soft per-staff minimum target", () => {
    const ORL = shift("st-orl", "ORL", { defaultHours: 12, schedulePriority: 30 });
    const mk = (over: string) => base({
      staff: [staff("aa", "AA", {
        ftePercentage: 0.2, eligibleShiftTypeIds: ["st-or", "st-orl", "st-off"], availabilityRules: monTue,
        shiftMinimumTargets: [{ shiftTypeId: "st-orl", minCount: 1, window: "pay_period", strength: "preference" }],
      } as Partial<ScheduleStaff>)],
      shiftTypes: [OR, ORL, OFF], staffingRequirements: [],
      factorOrder: factors(ORDER, over, "discouraged"),
    });
    expect(mk("allowed").suggestions.some((s) => s.code === "ORL")).toBe(true);
    expect(mk("discouraged").suggestions.some((s) => s.code === "ORL")).toBe(false);
  });
});
