// Card #75 C1: unticking someone for a shift keeps their rules / minimum targets / standing
// commitments for it (hidden, so a re-tick restores them) — but a (staff, shift) pair with no
// eligibility row must be inert everywhere: the input builder drops the hidden rows, and the
// engine and the pin check never let an "eligible" rule or a standing commitment grant the shift.
import { describe, it, expect, vi } from "vitest";
import { buildAutoScheduleInput } from "../build-auto-schedule-input";
import { autoSchedule as autoScheduleRaw, type ScheduleStaff } from "../auto-scheduler";
import { pinHardLegality } from "../scenario";
import { withDayCaps, type TestShift } from "./test-day-caps";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

vi.mock("@/lib/pay-periods-server", () => ({ getPayPeriods: async () => [] }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const WEEKDAYS = [1, 2, 3, 4, 5];

// ── The builder ──
function client(rows: Record<string, unknown[]>) {
  return new Proxy({}, {
    get: (_t, model: string) => ({
      findMany: async () => rows[model] ?? [],
      findFirst: async () => (rows[model] ?? [])[0] ?? null,
      findUnique: async () => (rows[model] ?? [])[0] ?? null,
    }),
  }) as never;
}
const et = { id: "et", usesFtePercentage: true, defaultFtePercentage: 1, allowsFixedHours: false, includedInFairness: true };
const person = (id: string) => ({ id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, isActive: true, isAutoScheduled: true, specialQualifications: [], employmentType: et });
const when = { whenKind: "every", whenDays: [1], whenPpWeek: null, whenOrds: [], whenCycleUnit: null, whenCycleN: null, whenCycleOffset: null };

describe("card #75 — hidden rows are inert", () => {
  it("the builder drops rules, minimum targets and standing commitments of a pair without an eligibility row", async () => {
    const input = await buildAutoScheduleInput("2025-05-12", "2025-05-16", {
      payPeriods: [],
      client: client({
        staff: [person("ab"), person("cd")],
        shiftType: [{ id: "st-card", code: "CARD", autoSchedulable: true }, { id: "st-or", code: "OR", autoSchedulable: true }],
        staffEligibleShift: [{ staffId: "ab", shiftTypeId: "st-or" }, { staffId: "cd", shiftTypeId: "st-card" }],
        shiftEligibilityRule: [
          { staffId: "ab", shiftTypeId: "st-card", type: "eligible", strength: "rule", ...when },
          { staffId: "cd", shiftTypeId: "st-card", type: "eligible", strength: "rule", ...when },
        ],
        shiftMinimumTarget: [
          { staffId: "ab", shiftTypeId: "st-card", minCount: 1, maxCount: null, window: "week", windowDays: null, windowCount: 1 },
          { staffId: "cd", shiftTypeId: "st-card", minCount: 1, maxCount: null, window: "week", windowDays: null, windowCount: 1 },
        ],
        standingCommitment: [{ staffId: "ab", shiftTypeId: "st-card", ...when }, { staffId: "cd", shiftTypeId: "st-card", ...when }],
      }),
    });
    const ab = input.staff.find((p) => p.id === "ab")!;
    const cd = input.staff.find((p) => p.id === "cd")!;
    expect(ab.shiftEligibilityRules).toEqual([]);
    expect(ab.shiftMinimumTargets?.filter((t) => t.shiftTypeId === "st-card")).toEqual([]);
    expect(cd.shiftEligibilityRules).toHaveLength(1); // ticked: kept
    expect(cd.shiftMinimumTargets?.filter((t) => t.shiftTypeId === "st-card")).toHaveLength(1);
    expect(input.standingCommitments.map((s) => s.staffId)).toEqual(["cd"]);
  });
});

// ── The engine and the pin check (defence in depth: a caller that passes hidden rows anyway) ──
function shift(id: string, code: string, o: Partial<TestShift> = {}): TestShift {
  return {
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0,
    countsTowardFte: true, countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false,
    sortOrder: 0, schedulePriority: null, weekendPaired: false, holidayWeekendPaired: false,
    ignoresWorkingDays: false, category: "clinical", autoSchedulable: true, ...o,
  };
}
const OFF = shift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = shift("st-or", "OR", { schedulePriority: 100, isFillShift: true });
const CARD = shift("st-card", "CARD", { schedulePriority: 50 });
const ADM = shift("st-adm", "ADM", { schedulePriority: 60 });
const DATES = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const eligRule = WEEKDAYS.map((d) => ({ shiftTypeId: "st-card", type: "eligible" as const, strength: "rule" as const, ...wEvery(d) }));
function staff(id: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff {
  return {
    id, initials: id.toUpperCase(), ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
    eligibleShiftTypeIds: ["st-or", "st-off"],
    availabilityRules: WEEKDAYS.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true, isAutoScheduled: true, specialQualifications: [], ...o,
  };
}
function run(people: ScheduleStaff[], o: Record<string, unknown> = {}) {
  return autoScheduleRaw(withDayCaps({
    dates: DATES, staff: people, shiftTypes: [OR, CARD, ADM, OFF], existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
    holidays: [], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [], staffingRequirements: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
      pendingRequestMode: "full", requestConflictPolicy: "reconcile",
    },
    equityFactors: [], followRules: [], requiredFollowers: [], scheduleRequests: [],
    ...o,
  } as never));
}
const cardFor = (r: ReturnType<typeof run>, id: string) => r.suggestions.filter((s) => s.staffId === id && s.code === "CARD").length;
const CARD_MIN = WEEKDAYS.map((d) => ({ shiftTypeId: "st-card", dayKey: String(d), minCount: 1 }));

describe("card #75 — the engine never grants a shift without an eligibility row", () => {
  it("a retained 'eligible' rule does not let coverage place the shift", () => {
    const r = run([staff("ab", { shiftEligibilityRules: eligRule })], { staffingRequirements: CARD_MIN });
    expect(cardFor(r, "ab")).toBe(0);
  });
  it("re-ticked (row present), the same rule and minimum place it again", () => {
    const r = run([staff("ab", { shiftEligibilityRules: eligRule, eligibleShiftTypeIds: ["st-or", "st-off", "st-card"] })], { staffingRequirements: CARD_MIN });
    expect(cardFor(r, "ab")).toBeGreaterThan(0);
  });
  it("a retained standing commitment does not place the shift; re-ticked it does", () => {
    const sc = [{ staffId: "ab", shiftTypeId: "st-card", ...wEvery(1) }];
    expect(cardFor(run([staff("ab")], { standingCommitments: sc }), "ab")).toBe(0);
    expect(cardFor(run([staff("ab", { eligibleShiftTypeIds: ["st-or", "st-off", "st-card"] })], { standingCommitments: sc }), "ab")).toBe(1);
  });
  it("the pin check: an 'eligible' rule never grants without the row; it can still narrow with it", () => {
    const args = ["2025-05-12", [], () => false, [], "full", () => false] as const;
    expect(pinHardLegality(staff("ab", { shiftEligibilityRules: eligRule }), CARD as never, ...(args as unknown as [string, never, never, never, never, never]))).toBe("ineligible");
    const ban = [{ shiftTypeId: "st-card", type: "ineligible" as const, strength: "rule" as const, ...wEvery(1) }];
    expect(pinHardLegality(staff("ab", { eligibleShiftTypeIds: ["st-card"], shiftEligibilityRules: ban }), CARD as never, ...(args as unknown as [string, never, never, never, never, never]))).toBe("ineligible");
    expect(pinHardLegality(staff("ab", { eligibleShiftTypeIds: ["st-card"] }), CARD as never, ...(args as unknown as [string, never, never, never, never, never]))).not.toBe("ineligible");
  });
  it("a WORK follower is never placed for a person not eligible for it (CARD→ADM); a day-off follower still is", () => {
    const sc = { staffingRequirements: [{ shiftTypeId: "st-card", dayKey: "1", minCount: 1 }] };
    const base = ["st-or", "st-off", "st-card"];
    const adm = (r: ReturnType<typeof run>) => r.suggestions.filter((x) => x.staffId === "ab" && x.code === "ADM").length;
    const workFollower = { requiredFollowers: [{ sourceShiftId: "st-card", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }], ...sc };
    const r0 = run([staff("ab", { eligibleShiftTypeIds: base })], workFollower);
    expect(cardFor(r0, "ab")).toBe(1);
    expect(adm(r0)).toBe(0);
    expect(r0.warnings.some((w) => w.includes("not eligible for ADM"))).toBe(true);
    expect(adm(run([staff("ab", { eligibleShiftTypeIds: [...base, "st-adm"] })], workFollower))).toBe(1);
    // A recovery day off needs no eligibility.
    const offFollower = { requiredFollowers: [{ sourceShiftId: "st-card", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: false }], ...sc };
    const r2 = run([staff("ab", { eligibleShiftTypeIds: ["st-or", "st-card"] })], offFollower);
    expect(r2.suggestions.find((x) => x.staffId === "ab" && x.date === "2025-05-13")?.step).toBe("follower");
  });
});
