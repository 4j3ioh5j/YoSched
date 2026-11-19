import { describe, it, expect } from "vitest";
import { autoSchedule, countedHoursFn, type AutoScheduleInput, type ScheduleStaff } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #349 (David, Feb 2027): CL (0.5 FTE) works only Mondays and Tuesdays; one Monday is a
// holiday (HOL). Four 8 h days make 32 of 40, so CL needs the day's ORC (16 h). ORC owes a
// required X the next day, so the hours repair never traded it and CL stayed 8 h under.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const avail = (days: number[]) => days.map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) }));
const staff = (id: string, initials: string, o: Partial<ScheduleStaff> = {}): ScheduleStaff => ({
  id, initials, ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
  eligibleShiftTypeIds: ["st-or", "st-off", "st-orc", "st-hol"],
  availabilityRules: avail([1, 2, 3, 4, 5]),
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
const HOL = shift("st-hol", "HOL", { isLeave: true, autoSchedulable: false, defaultHoursHoliday: 8 });

// PP Sun 2025-05-11 .. Sat 2025-05-24; Mon 2025-05-19 is a holiday.
const W1 = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
const W2 = ["2025-05-19", "2025-05-20", "2025-05-21", "2025-05-22", "2025-05-23"];
const PP = { startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 };
const req = (shiftTypeId: string, code: string, min: number, max: number | null = null) =>
  ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId, shiftCode: code, dayKey, minCount: min, preferredCount: min, maxCount: max }));

function build(o: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: [...W1, ...W2],
    staff: [
      staff("cl", "CL", { ftePercentage: 0.5, availabilityRules: avail([1, 2]) }),
      // ST prefers ORC on Tuesdays (the staff card's "eligible · Prefer" rule), so STEP 2 hands ST
      // both Tuesday ORCs before CL's hours are looked at — CL's only long-shift days.
      staff("st", "ST", { shiftEligibilityRules: [{ shiftTypeId: "st-orc", type: "eligible" as const, strength: "preference" as const, ...wEvery(2) }] }), staff("bc", "BC"), staff("dh", "DH"), staff("lm", "LM"),
    ],
    shiftTypes: [OR, OFF, ORC, HOL],
    existingAssignments: [],
    payPeriods: [PP],
    holidays: [{ date: W2[0] }], desirabilityWeights: [], standingCommitments: [], staffOverrides: [], dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [...req("st-orc", "ORC", 1, 1), ...req("st-or", "OR", 2)],
    requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-off", scope: "each_day", countsTowardTargets: true }],
    schedulingPreferences: { prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false, sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3, holidayShiftId: "st-hol" },
    equityFactors: [], followRules: [],
    ...o,
  });
}

function hoursOf(inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>, who: string): number {
  const h = countedHoursFn(inp);
  let t = 0;
  for (const s of r.suggestions) if (s.staffId === who && s.date >= PP.startDate && s.date <= PP.endDate) t += h(who, s.shiftTypeId, s.date);
  return t;
}

describe("the hours repair can trade a shift that owes a follower (card #349)", () => {
  it("CL reaches 40 with an ORC; everyone else stays on 80; ORC is still followed by X", () => {
    const inp = build();
    const r = autoSchedule(inp);
    const rows = Object.fromEntries(inp.staff.map((p) => [p.initials, r.suggestions.filter((s) => s.staffId === p.id).sort((a, b) => a.date.localeCompare(b.date)).map((s) => `${s.date.slice(5)}=${s.code}`).join(" ")]));
    expect(hoursOf(inp, r, "cl"), JSON.stringify(rows)).toBe(40);
    for (const p of ["st", "bc", "dh", "lm"]) expect(hoursOf(inp, r, p), JSON.stringify(rows)).toBe(80);
    for (const s of r.suggestions.filter((x) => x.code === "ORC")) {
      const next = new Date(s.date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      const nd = next.toISOString().slice(0, 10);
      if ([...W1, ...W2].includes(nd)) expect(r.suggestions.find((x) => x.staffId === s.staffId && x.date === nd)?.code, `${s.staffId} after ORC ${s.date}`).toBe("X");
    }
    for (const d of [...W1, ...W2].filter((x) => x !== W2[0])) expect(r.suggestions.filter((s) => s.date === d && s.code === "ORC")).toHaveLength(1);
  });
});

describe("the follower-source trade never touches what it must not (card #349)", () => {
  // In the main shape CL takes BC's Tuesday ORC (W1[1]). Held by hand or locked, it stays BC's.
  for (const [label, locked, source] of [["locked", true, "auto"], ["typed by hand", false, "manual"]] as const) {
    it(`an ORC ${label} is never traded to CL`, () => {
      const inp = build({ existingAssignments: [{ staffId: "bc", date: W1[1], shiftTypeId: "st-orc", code: "ORC", isLocked: locked, source }] });
      const r = autoSchedule(inp);
      expect(r.suggestions.filter((s) => s.date === W1[1] && s.code === "ORC")).toEqual([]);
      expect(r.suggestions.find((s) => s.staffId === "bc" && s.date === W1[1])).toBeUndefined();
    });
  }
  it("a WORK follower CL is not eligible for blocks the trade (CL never holds an ORC it can't follow)", () => {
    const ADM = shift("st-adm", "ADM", { autoSchedulable: true });
    const inp = build({
      shiftTypes: [OR, OFF, ORC, HOL, ADM],
      requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }],
    });
    for (const p of inp.staff) if (p.id !== "cl") p.eligibleShiftTypeIds = [...p.eligibleShiftTypeIds, "st-adm"];
    const r = autoSchedule(inp);
    expect(r.suggestions.filter((s) => s.staffId === "cl" && s.code === "ORC")).toEqual([]);
  });
  // Codex #1627 r1: with a WORK follower (ORC→ADM), CL (now available Wednesdays, but held off
  // OR/ORC there by a hard "not this shift" request) takes BC's Tuesday ORC and its ADM. The
  // donor's cleared ADM counts toward BC's hard minimum, so the trade must not take it.
  const admShape = (kind: "NEGATE_SHIFT" | "OFF") => {
    const ADM = shift("st-adm", "ADM", { autoSchedulable: true });
    const inp = build({
      shiftTypes: [OR, OFF, ORC, HOL, ADM],
      requiredFollowers: [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }],
      scheduleRequests: [W1[2], W2[2]].map((d, i) => ({
        id: "q" + i, staffId: "cl", startDate: d, endDate: d, kind,
        shiftTypeIds: kind === "NEGATE_SHIFT" ? ["st-or", "st-orc"] : [], leaveShiftTypeId: null,
        strength: "hard" as const, status: "approved" as const, autoApproved: false,
      })),
    });
    inp.staff[0].availabilityRules = avail([1, 2, 3]);
    for (const p of inp.staff) p.eligibleShiftTypeIds = [...p.eligibleShiftTypeIds, "st-adm"];
    return inp;
  };
  const rowsOf = (inp: AutoScheduleInput, r: ReturnType<typeof autoSchedule>) => JSON.stringify(Object.fromEntries(inp.staff.map((p) => [p.initials, r.suggestions.filter((s) => s.staffId === p.id).sort((a, b) => a.date.localeCompare(b.date)).map((s) => `${s.date.slice(5)}=${s.code}`).join(" ")])));
  it("the trade never takes the donor below a hard minimum for the follower shift", () => {
    const inp = admShape("NEGATE_SHIFT");
    for (const p of inp.staff) if (p.id !== "cl") p.shiftMinimumTargets = [{ shiftTypeId: "st-adm", minCount: 2, maxCount: null, window: "pay_period", windowDays: null, strength: "rule" }];
    const r = autoSchedule(inp);
    for (const p of inp.staff.filter((x) => x.id !== "cl")) {
      expect(r.suggestions.filter((s) => s.staffId === p.id && s.code === "ADM").length, `${p.initials} ${rowsOf(inp, r)}`).toBeGreaterThanOrEqual(2);
    }
  });
  it("with no minimum the trade still runs (the guard is not a blanket refusal)", () => {
    const inp = admShape("NEGATE_SHIFT");
    const r = autoSchedule(inp);
    expect(r.suggestions.find((s) => s.staffId === "cl" && s.code === "ORC")?.step, rowsOf(inp, r)).toBe("repair");
    expect(hoursOf(inp, r, "cl"), rowsOf(inp, r)).toBe(40);
  });
  it("the trade never lands a work follower on a day the taker asked off (hard request)", () => {
    const inp = admShape("OFF");
    const r = autoSchedule(inp);
    for (const d of [W1[2], W2[2]]) {
      const c = r.suggestions.find((s) => s.staffId === "cl" && s.date === d);
      expect(c?.code ?? "X", `${d} ${rowsOf(inp, r)}`).toBe("X");
    }
  });
  // Card #351 (Codex #1629 follow-up): CL already holds the follower (ADM typed by hand on Wed)
  // at a hard max of 1, and is 8 h short. The trade adds no ADM, so the max must not refuse it.
  it("a follower the taker already holds does not count against their maximum", () => {
    const inp = admShape("NEGATE_SHIFT");
    inp.existingAssignments = [{ staffId: "cl", date: W1[2], shiftTypeId: "st-adm", code: "ADM", isLocked: false, source: "manual" }];
    inp.staff[0].ftePercentage = 0.6; // 48 h: OR, OR, ADM, HOL, OR is 40, so CL needs the ORC
    inp.staff[0].shiftMinimumTargets = [{ shiftTypeId: "st-adm", minCount: 0, maxCount: 1, window: "pay_period", windowDays: null, strength: "rule" }];
    const r = autoSchedule(inp);
    expect(r.suggestions.find((s) => s.staffId === "cl" && s.date === W1[1])?.code, rowsOf(inp, r)).toBe("ORC");
    expect(r.suggestions.filter((s) => s.staffId === "cl" && s.code === "ADM" && s.date !== W1[2]), rowsOf(inp, r)).toEqual([]);
  });
  // Card #352 (Codex #1631 follow-up): a follower that does not count toward targets never meets
  // the taker's maximum for it (the max counts only counting cells), so a max of 0 must not block.
  it("a non-counting follower is not held to the taker's maximum", () => {
    const inp = admShape("NEGATE_SHIFT");
    inp.requiredFollowers = [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: false }];
    inp.staff[0].shiftMinimumTargets = [{ shiftTypeId: "st-adm", minCount: 0, maxCount: 0, window: "pay_period", windowDays: null, strength: "rule" }];
    const r = autoSchedule(inp);
    expect(r.suggestions.find((s) => s.staffId === "cl" && s.code === "ORC")?.step, rowsOf(inp, r)).toBe("repair");
  });
});

