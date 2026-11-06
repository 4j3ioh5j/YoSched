import { describe, it, expect } from "vitest";
import { decideApproval, dayLabel, reasonFromRejection, type ApprovalRequest, type ContextCell } from "../request-approval-outcome";
import { type AutoScheduleInput, type ScheduleStaff, type ScheduleAssignment } from "../auto-scheduler";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";
import { buildDayCapLookup } from "../day-cap";
import { type ScheduleRequestData, type ApprovalConflictPolicy } from "../schedule-requests";
import { withDayCaps, type TestShift } from "./test-day-caps";

// Card #67 — the pure decision: pin the requested shift, re-arrange only auto-placed
// cells within the policy's reach, and VERIFY every hard rule on the grid that would be
// saved. Fixtures mirror scenario.test.ts.

const wEvery = (d: number) => whenToColumns(legacyPatternToWhen({ dayOfWeek: d, pattern: "every" }));
const ELIGIBLE = ["st-or", "st-off", "st-orc", "st-adm", "st-al"];

function makeStaff(id: string, initials: string, overrides: Partial<ScheduleStaff> = {}): ScheduleStaff {
  return {
    id,
    initials,
    ftePercentage: 1, fixedHoursPerPp: null, inFairness: true,
    eligibleShiftTypeIds: ELIGIBLE,
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })),
    isActive: true,
    isAutoScheduled: true,
    specialQualifications: [],
    ...overrides,
  };
}

function makeShift(id: string, code: string, overrides: Partial<TestShift> = {}): TestShift {
  return {
    id, code, name: code, defaultHours: 8, defaultHoursWeekend: 0, defaultHoursHoliday: 0, countsTowardFte: true,
    countsAsHolidayWork: true, isLeave: false, isOffShift: false, isFillShift: false, sortOrder: 0, schedulePriority: null,
    weekendPaired: false, holidayWeekendPaired: false, ignoresWorkingDays: false, category: "clinical", autoSchedulable: true,
    ...overrides,
  };
}

const OFF = makeShift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = makeShift("st-or", "OR", { schedulePriority: 1, isFillShift: true });
const ORC = makeShift("st-orc", "ORC", { maxPerDay: 1 });
const ADM = makeShift("st-adm", "ADM");
const AL = makeShift("st-al", "AL", { isLeave: true, countsTowardFte: false, autoSchedulable: false, maxPerDay: 1 });

const MON = "2025-05-12", TUE = "2025-05-13", WED = "2025-05-14", THU = "2025-05-15", FRI = "2025-05-16";
const DATES = [MON, TUE, WED, THU, FRI];

function makeInput(overrides: Partial<AutoScheduleInput> = {}): AutoScheduleInput {
  return withDayCaps({
    dates: DATES,
    staff: [makeStaff("p1", "AB"), makeStaff("p2", "CD")],
    shiftTypes: [OR, OFF, ORC, ADM, AL],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
    holidays: [],
    desirabilityWeights: [],
    standingCommitments: [],
    staffOverrides: [],
    dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [],
    schedulingPreferences: {
      prefer3DayWeekends: false, prefer4DayWeekends: false, preferSequentialOff: false,
      sequentialOffWeight: 1, threeDayWeekendWeight: 2, fourDayWeekendWeight: 3,
    },
    equityFactors: [],
    followRules: [],
    ...overrides,
  });
}

const CODE: Record<string, string> = { "st-or": "OR", "st-off": "X", "st-orc": "ORC", "st-adm": "ADM", "st-al": "AL" };
const cell = (staffId: string, date: string, shiftTypeId: string, source = "auto", isLocked = false): ScheduleAssignment =>
  ({ staffId, date, shiftTypeId, code: CODE[shiftTypeId], isLocked, source });

function mkReq(id: string, staffId: string, kind: ApprovalRequest["kind"], overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { id, staffId, kind, shiftTypeIds: [], leaveShiftTypeId: null, startDate: MON, endDate: MON, strength: "hard", ...overrides };
}
const wantORC = (id = "r1", staffId = "p1", date = MON) => mkReq(id, staffId, "REQUEST_SHIFT", { shiftTypeIds: ["st-orc"], startDate: date, endDate: date });
const wantOR = (id = "r1", staffId = "p1", date = MON) => mkReq(id, staffId, "REQUEST_SHIFT", { shiftTypeIds: ["st-or"], startDate: date, endDate: date });
const wantOff = (id = "r1", staffId = "p1", date = MON) => mkReq(id, staffId, "OFF", { startDate: date, endDate: date });
const wantLeave = (id = "r1", staffId = "p1", date = MON) => mkReq(id, staffId, "LEAVE", { leaveShiftTypeId: "st-al", startDate: date, endDate: date });

/** An APPROVED request already in the input (someone else's, or the requester's other one). */
function approvedData(id: string, staffId: string, kind: ScheduleRequestData["kind"], date: string, extra: Partial<ScheduleRequestData> = {}): ScheduleRequestData {
  return { id, staffId, startDate: date, endDate: date, kind, shiftTypeIds: [], leaveShiftTypeId: null, strength: "hard", status: "approved", autoApproved: false, ...extra };
}

const keys = (writes: { staffId: string; date: string }[]) => writes.map((w) => `${w.staffId}:${w.date}`).sort();
const decide = (input: AutoScheduleInput, req: ApprovalRequest, placement: string, policy: ApprovalConflictPolicy = "resolve-pp", context: ContextCell[] = []) =>
  decideApproval(input, req, placement, policy, context);
function expectImpossible(d: ReturnType<typeof decideApproval>, text: string) {
  expect(d.ok).toBe(false);
  if (!d.ok) expect(d.reason).toContain(text);
}
function expectOk(d: ReturnType<typeof decideApproval>) {
  expect(d.ok, d.ok ? "" : d.reason).toBe(true);
  if (!d.ok) throw new Error(d.reason);
  return d;
}

const ORC_TO_ADM_EACH_DAY = [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_day", countsTowardTargets: true }];
const ORC_TO_ADM_EACH_RUN = [{ sourceShiftId: "st-orc", followerShiftId: "st-adm", scope: "each_run", countsTowardTargets: true }];
const ORC_THEN_OFF_ONLY = [{ sourceShiftId: "st-orc", allowedShiftId: null, allowOffShifts: true, mode: "allow" }];

describe("decideApproval — 1. the requested shift on a free day, and its required followers", () => {
  it("writes exactly the requested cell, source request; the engine's fills elsewhere are never written", () => {
    const d = expectOk(decide(makeInput(), wantORC(), "st-orc"));
    expect(d.writes).toEqual([{ staffId: "p1", date: MON, shiftTypeId: "st-orc", source: "request" }]);
    expect(d.ring).toBe(0);
  });

  it("each_day follower: the pin plus the follower the next day (auto)", () => {
    const d = expectOk(decide(makeInput({ requiredFollowers: ORC_TO_ADM_EACH_DAY }), wantORC(), "st-orc"));
    expect(d.writes).toEqual(expect.arrayContaining([
      { staffId: "p1", date: MON, shiftTypeId: "st-orc", source: "request" },
      { staffId: "p1", date: TUE, shiftTypeId: "st-adm", source: "auto" },
    ]));
    expect(keys(d.writes)).toEqual([`p1:${MON}`, `p1:${TUE}`]);
  });

  it("a work follower cannot land on a holiday → impossible, naming the holiday", () => {
    const d = decide(makeInput({ requiredFollowers: ORC_TO_ADM_EACH_DAY, holidays: [{ date: TUE }] }), wantORC(), "st-orc");
    expectImpossible(d, `a required ADM after ORC could not be placed on ${dayLabel(TUE)} (holiday)`);
  });

  it("a follower day set by hand is never overwritten → impossible", () => {
    const input = makeInput({ requiredFollowers: ORC_TO_ADM_EACH_DAY, existingAssignments: [cell("p1", TUE, "st-or", "manual")] });
    expectImpossible(decide(input, wantORC(), "st-orc"), `could not be placed on ${dayLabel(TUE)} (that day holds OR)`);
  });

  it("each_run: approving a second ORC after an auto ORC+ADM run moves the ADM to the new run end", () => {
    const input = makeInput({ requiredFollowers: ORC_TO_ADM_EACH_RUN, existingAssignments: [cell("p1", MON, "st-orc"), cell("p1", TUE, "st-adm")] });
    const d = expectOk(decide(input, wantORC("r1", "p1", TUE), "st-orc"));
    expect(d.writes).toEqual(expect.arrayContaining([
      { staffId: "p1", date: TUE, shiftTypeId: "st-orc", source: "request" },
      { staffId: "p1", date: WED, shiftTypeId: "st-adm", source: "auto" },
    ]));
  });
});

describe("decideApproval — 1b. the allow-list for followers comes only from writes that are kept (review #328)", () => {
  it("a Monday ORC approval under `flag` never writes followers of ORC fills the engine made elsewhere", () => {
    // Coverage wants one ORC every weekday and ORC is a distributed (priority) shift, so the
    // re-solve fills ORC Tue–Fri for someone and generates an ADM after each; those fills are
    // discarded, so their followers must be too (the unfixed code wrote ADM Wed–Fri).
    const input = makeInput({
      shiftTypes: [OR, OFF, makeShift("st-orc", "ORC", { maxPerDay: 1, schedulePriority: 2 }), ADM, AL],
      requiredFollowers: ORC_TO_ADM_EACH_DAY,
      staffingRequirements: ["1", "2", "3", "4", "5"].map((dayKey) => ({ shiftTypeId: "st-orc", dayKey, minCount: 1, maxCount: 1 })),
    });
    for (const policy of ["flag", "resolve-day", "resolve-pp"] as const) {
      const d = expectOk(decide(input, wantORC(), "st-orc", policy));
      expect(keys(d.writes)).toEqual([`p1:${MON}`, `p1:${TUE}`]);
    }
  });

  it("a freed holder re-filled with a follower-bearing shift may have its follower written; nothing else may", () => {
    // p2 holds ORC Mon (auto) + ADM Tue (auto, its follower). Approving p1 ORC Mon frees p2 Mon; whatever
    // the engine puts there, the writes stay within p1's pin+follower and p2's freed cell (+ its follower).
    const input = makeInput({ requiredFollowers: ORC_TO_ADM_EACH_DAY, existingAssignments: [cell("p2", MON, "st-orc"), cell("p2", TUE, "st-adm")] });
    const d = expectOk(decide(input, wantORC(), "st-orc", "resolve-pp"));
    const allowed = new Set([`p1:${MON}`, `p1:${TUE}`, `p2:${MON}`, `p2:${TUE}`]);
    for (const k of keys(d.writes)) expect(allowed.has(k), k).toBe(true);
  });
});

describe("decideApproval — 2a. a Max of 0 flags, never crashes (review #328)", () => {
  const noOrcMonday = () => makeInput({ staffingRequirements: [{ shiftTypeId: "st-orc", dayKey: "1", minCount: 0, maxCount: 0 }] });
  const noLeaveMonday = () => makeInput({ staffingRequirements: [{ shiftTypeId: "st-al", dayKey: "1", minCount: 0, maxCount: 0 }] });

  it("a working shift with Max 0 that day → 'not allowed', under every policy", () => {
    for (const policy of ["flag", "resolve-day", "resolve-pp"] as const) {
      expect(decide(noOrcMonday(), wantORC(), "st-orc", policy)).toEqual({ ok: false, reason: `ORC is not allowed on ${dayLabel(MON)}` });
    }
  });

  it("a leave with Max 0 that day (an away pin) → 'not allowed', even with no holders", () => {
    expect(decide(noLeaveMonday(), wantLeave(), "st-al", "resolve-pp")).toEqual({ ok: false, reason: `AL is not allowed on ${dayLabel(MON)}` });
  });

  it("Max 0 on another day does not stop the request on this day", () => {
    const input = makeInput({ staffingRequirements: [{ shiftTypeId: "st-orc", dayKey: "2", minCount: 0, maxCount: 0 }] });
    expectOk(decide(input, wantORC(), "st-orc"));
  });
});

describe("decideApproval — 2. a day at the shift's Max", () => {
  it("an auto holder is moved: the writes are the pin and that holder's cell, nothing else", () => {
    const input = makeInput({ existingAssignments: [cell("p2", MON, "st-orc", "auto")] });
    const d = expectOk(decide(input, wantORC(), "st-orc"));
    expect(keys(d.writes)).toEqual([`p1:${MON}`, `p2:${MON}`]);
    const p2 = d.writes.find((w) => w.staffId === "p2")!;
    expect(p2.shiftTypeId).not.toBe("st-orc");
    expect(p2.source).toBe("auto");
  });

  it("a holder set by hand is never moved → flagged with who holds it", () => {
    const input = makeInput({ existingAssignments: [cell("p2", MON, "st-orc", "manual")] });
    const d = decide(input, wantORC(), "st-orc");
    expectImpossible(d, `${dayLabel(MON)} already has its 1 ORC (set by hand for CD)`);
  });

  it("a locked holder → '(locked for CD)'", () => {
    const input = makeInput({ existingAssignments: [cell("p2", MON, "st-orc", "auto", true)] });
    expectImpossible(decide(input, wantORC(), "st-orc"), `${dayLabel(MON)} already has its 1 ORC (locked for CD)`);
  });

  it("a holder placed for another approved request → '(held by CD for another approved request)'", () => {
    const input = makeInput({
      existingAssignments: [cell("p2", MON, "st-orc", "request")],
      scheduleRequests: [approvedData("r0", "p2", "REQUEST_SHIFT", MON, { shiftTypeIds: ["st-orc"] })],
    });
    expectImpossible(decide(input, wantORC(), "st-orc"), `${dayLabel(MON)} already has its 1 ORC (held by CD for another approved request)`);
  });

  it("an impossible approval carries no writes", () => {
    const d = decide(makeInput({ existingAssignments: [cell("p2", MON, "st-orc", "manual")] }), wantORC(), "st-orc");
    expect(d.ok).toBe(false);
    expect("writes" in d).toBe(false);
  });
});

describe("decideApproval — 3. leave is capped too, and an away pin needs no eligibility", () => {
  it("a leave Max held by hand → impossible", () => {
    const input = makeInput({ existingAssignments: [cell("p2", MON, "st-al", "manual")] });
    expectImpossible(decide(input, wantLeave(), "st-al"), `${dayLabel(MON)} already has its 1 AL`);
  });

  it("LEAVE for a staffer whose eligibility lacks the leave shift is still placed (away pin)", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] }), makeStaff("p2", "CD")] });
    const d = expectOk(decide(input, wantLeave(), "st-al"));
    expect(d.writes).toEqual([{ staffId: "p1", date: MON, shiftTypeId: "st-al", source: "request" }]);
  });
});

describe("decideApproval — 4. conditional availability: the requester's and the dependents'", () => {
  const dependsOnP2 = (): ScheduleStaff =>
    makeStaff("p1", "AB", {
      availabilityRules: [1, 2, 3, 4, 5].map((d) => ({ type: "available" as const, strength: "rule" as const, conditionStaffId: "p2", conditionType: "working" as const, ...wEvery(d) })),
    });

  it("the requester is only available when p2 works: p2 blank → unavailable; p2 working → ok", () => {
    const blank = makeInput({ staff: [dependsOnP2(), makeStaff("p2", "CD")] });
    expectImpossible(decide(blank, wantORC(), "st-orc"), `AB is unavailable on ${dayLabel(MON)}`);
    const working = makeInput({ staff: [dependsOnP2(), makeStaff("p2", "CD")], existingAssignments: [cell("p2", MON, "st-or", "manual")] });
    expectOk(decide(working, wantORC(), "st-orc"));
  });

  it("approving p2 OFF when p1's auto OR depends on p2 working re-arranges p1 off that shift (card #69)", () => {
    // The verify step re-checks the dependents of every changed cell. Since card #69 the engine reads
    // a LOCKED off cell as "not working" for conditional rules, so the re-solve moves p1 off the OR
    // and the request is accommodated (ring 1) instead of refused.
    for (const policy of ["resolve-day", "resolve-pp"] as const) {
      const input = makeInput({ staff: [dependsOnP2(), makeStaff("p2", "CD")], existingAssignments: [cell("p1", MON, "st-or", "auto")] });
      const d = decide(input, wantOff("r1", "p2"), "st-off", policy);
      expect(d.ok).toBe(true);
      if (!d.ok) continue;
      expect(d.ring).toBeGreaterThanOrEqual(1);
      expect(d.writes).toContainEqual({ staffId: "p2", date: MON, shiftTypeId: "st-off", source: "request" });
      const p1 = d.writes.find((w) => w.staffId === "p1" && w.date === MON);
      expect(p1).toBeDefined();
      expect(p1!.shiftTypeId).not.toBe("st-or");
    }
  });

  it("… under the flag policy nothing moves, so it is impossible", () => {
    const input = makeInput({ staff: [dependsOnP2(), makeStaff("p2", "CD")], existingAssignments: [cell("p1", MON, "st-or", "auto")] });
    expectImpossible(decide(input, wantOff("r1", "p2"), "st-off", "flag"), `AB would no longer be available to work on ${dayLabel(MON)}`);
  });

  it("… and when p1's cell was set by hand it can never be moved → impossible", () => {
    const input = makeInput({ staff: [dependsOnP2(), makeStaff("p2", "CD")], existingAssignments: [cell("p1", MON, "st-or", "manual")] });
    expectImpossible(decide(input, wantOff("r1", "p2"), "st-off", "resolve-pp"), `AB would no longer be available to work on ${dayLabel(MON)}`);
  });
});

describe("decideApproval — 5. per-staff hard targets", () => {
  const orcMax1Per7 = { shiftTypeId: "st-orc", minCount: 0, maxCount: 1, window: "days" as const, windowDays: 7 };

  it("rolling max: a second ORC within 7 days is refused when the first cannot move (resolve-day)", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB", { shiftMinimumTargets: [orcMax1Per7] }), makeStaff("p2", "CD")], existingAssignments: [cell("p1", MON, "st-orc", "auto")] });
    expectImpossible(decide(input, wantORC("r1", "p1", WED), "st-orc", "resolve-day"), "AB would be over their ORC maximum");
  });

  it("rolling max: within the pay period the earlier auto ORC is moved off instead (resolve-pp)", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB", { shiftMinimumTargets: [orcMax1Per7] }), makeStaff("p2", "CD")], existingAssignments: [cell("p1", MON, "st-orc", "auto")] });
    const d = decide(input, wantORC("r1", "p1", WED), "st-orc", "resolve-pp");
    if (d.ok) {
      expect(d.ring).toBe(2);
      const mon = d.writes.find((w) => w.staffId === "p1" && w.date === MON);
      expect(mon).toBeDefined();
      expect(mon!.shiftTypeId).not.toBe("st-orc");
    } else {
      expect(d.reason).toContain("AB would be over their ORC maximum");
    }
  });

  it("rolling max with a hand-placed earlier ORC → impossible under every policy", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB", { shiftMinimumTargets: [orcMax1Per7] }), makeStaff("p2", "CD")], existingAssignments: [cell("p1", MON, "st-orc", "manual")] });
    expectImpossible(decide(input, wantORC("r1", "p1", WED), "st-orc", "resolve-pp"), "AB would be over their ORC maximum");
  });

  const p2MinOrc = () => makeStaff("p2", "CD", { shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 1, window: "pay_period" }] });
  const p2Week = () => [cell("p2", MON, "st-orc"), cell("p2", TUE, "st-or"), cell("p2", WED, "st-or"), cell("p2", THU, "st-or"), cell("p2", FRI, "st-or")];

  it("per-window min: taking the holder's only ORC within the day alone would leave them short → impossible (resolve-day)", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB"), p2MinOrc()], existingAssignments: p2Week() });
    expectImpossible(decide(input, wantORC(), "st-orc", "resolve-day"), "CD would fall short of their ORC minimum");
  });

  it("per-window min: within the pay period the holder keeps an ORC on another day, or the approval is refused — never silently short", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB"), p2MinOrc()], existingAssignments: p2Week() });
    const d = decide(input, wantORC(), "st-orc", "resolve-pp");
    if (d.ok) {
      expect(d.ring).toBe(2);
      const p2Orc = d.writes.filter((w) => w.staffId === "p2" && w.shiftTypeId === "st-orc");
      expect(p2Orc.length).toBeGreaterThanOrEqual(1);
      expect(p2Orc[0].date).not.toBe(MON);
    } else {
      expect(d.reason).toContain("CD would fall short of their ORC minimum");
    }
  });
});

describe("decideApproval — 6/7. the allow-list: pins always written, protected cells never, blank fills never", () => {
  it("at ring 2 no manual/imported/request-placed/locked/other-approved cell is ever written; the pin always is", () => {
    const input = makeInput({
      staff: [makeStaff("p1", "AB"), makeStaff("p2", "CD")],
      existingAssignments: [
        cell("p2", MON, "st-orc", "auto"),          // the holder (movable)
        cell("p2", TUE, "st-or", "manual"),
        cell("p2", WED, "st-or", "imported"),
        cell("p2", THU, "st-or", "request"),
        cell("p1", FRI, "st-or", "auto", true),     // locked
        cell("p1", THU, "st-or", "auto"),           // covered by p1's other approved request
      ],
      scheduleRequests: [approvedData("r0", "p1", "REQUEST_SHIFT", THU, { shiftTypeIds: ["st-or"] })],
    });
    const d = expectOk(decide(input, wantORC(), "st-orc", "resolve-pp"));
    const k = keys(d.writes);
    expect(k).toContain(`p1:${MON}`);
    for (const protectedKey of [`p2:${TUE}`, `p2:${WED}`, `p2:${THU}`, `p1:${FRI}`, `p1:${THU}`]) expect(k).not.toContain(protectedKey);
  });

  it("the engine's blank fills are never written: with p2 all blank only the requester's cell is written", () => {
    const d = expectOk(decide(makeInput(), wantORC(), "st-orc", "resolve-pp"));
    expect(d.writes.every((w) => w.staffId === "p1")).toBe(true);
    expect(d.writes).toHaveLength(1);
  });
});

describe("decideApproval — 8. follow rules, eligibility, availability, own approvals, the flag policy", () => {
  it("a follow rule 'after ORC only off' refuses OR the day after a hand-placed ORC", () => {
    const input = makeInput({ followRules: ORC_THEN_OFF_ONLY, existingAssignments: [cell("p1", MON, "st-orc", "manual")] });
    expectImpossible(decide(input, wantOR("r1", "p1", TUE), "st-or"), `OR cannot follow ORC for AB on ${dayLabel(TUE)}`);
  });

  it("not eligible for the shift", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] }), makeStaff("p2", "CD")] });
    expectImpossible(decide(input, wantORC(), "st-orc"), `AB is not eligible for ORC on ${dayLabel(MON)}`);
  });

  it("not available that day", () => {
    const input = makeInput({
      staff: [makeStaff("p1", "AB", { availabilityRules: [1, 2, 3, 4].map((d) => ({ type: "available" as const, strength: "rule" as const, ...wEvery(d) })) }), makeStaff("p2", "CD")],
    });
    expectImpossible(decide(input, wantORC("r1", "p1", FRI), "st-orc"), `AB is unavailable on ${dayLabel(FRI)}`);
  });

  it("the requester's own approved hard OFF that day is a hard rule too", () => {
    const input = makeInput({ scheduleRequests: [approvedData("r0", "p1", "OFF", MON)] });
    expectImpossible(decide(input, wantORC(), "st-orc"), `AB is already approved for Off on ${dayLabel(MON)}`);
  });

  it("the flag policy never moves a holder, even a movable one: plain reason", () => {
    const input = makeInput({ existingAssignments: [cell("p2", MON, "st-orc", "auto")] });
    const d = decide(input, wantORC(), "st-orc", "flag");
    expect(d).toEqual({ ok: false, reason: `${dayLabel(MON)} already has its 1 ORC` });
  });

  it("OFF and LEAVE on a free day are placed", () => {
    expect(expectOk(decide(makeInput(), wantOff(), "st-off")).writes).toEqual([{ staffId: "p1", date: MON, shiftTypeId: "st-off", source: "request" }]);
    expect(expectOk(decide(makeInput(), wantLeave(), "st-al")).writes).toEqual([{ staffId: "p1", date: MON, shiftTypeId: "st-al", source: "request" }]);
  });
});

describe("decideApproval — 9. a day already held by the requester's other approved request", () => {
  const heldOrc = () => makeInput({
    existingAssignments: [cell("p1", MON, "st-orc", "request")],
    scheduleRequests: [approvedData("r0", "p1", "REQUEST_SHIFT", MON, { shiftTypeIds: ["st-orc"] })],
  });

  it("a different shift contradicts the approved one → impossible", () => {
    expectImpossible(decide(heldOrc(), wantOR(), "st-or"), `AB is already approved for Wants ORC on ${dayLabel(MON)}`);
    expectImpossible(decide(heldOrc(), wantOff(), "st-off"), `AB is already approved for Wants ORC on ${dayLabel(MON)}`);
  });

  it("the same shift is simply honoured: nothing to write", () => {
    const d = expectOk(decide(heldOrc(), wantORC("r1"), "st-orc"));
    expect(d.writes).toEqual([]);
  });

  it("a covered cell that already holds the shift as an auto placement is re-sourced to request", () => {
    const d = expectOk(decide(makeInput({ existingAssignments: [cell("p1", MON, "st-orc", "auto")] }), wantORC(), "st-orc"));
    expect(d.writes).toEqual([{ staffId: "p1", date: MON, shiftTypeId: "st-orc", source: "request" }]);
  });
});

describe("decideApproval — 11. fixed context outside the range (the padding)", () => {
  const SUN = "2025-05-11";
  const orcMax1Per7 = { shiftTypeId: "st-orc", minCount: 0, maxCount: 1, window: "days" as const, windowDays: 7 };
  const sunOrc: ContextCell[] = [{ staffId: "p1", date: SUN, shiftTypeId: "st-orc", isLocked: false, source: "auto" }];

  it("a rolling max sees the ORC just before the range", () => {
    const input = makeInput({ staff: [makeStaff("p1", "AB", { shiftMinimumTargets: [orcMax1Per7] }), makeStaff("p2", "CD")] });
    expectImpossible(decide(input, wantORC(), "st-orc", "resolve-pp", sunOrc), "AB would be over their ORC maximum");
    expectOk(decide(input, wantORC(), "st-orc", "resolve-pp", []));
  });

  it("a follow rule sees the ORC just before the range; context is never written", () => {
    const input = makeInput({ followRules: ORC_THEN_OFF_ONLY });
    expectImpossible(decide(input, wantOR(), "st-or", "resolve-pp", sunOrc), `OR cannot follow ORC for AB on ${dayLabel(MON)}`);
    const d = expectOk(decide(input, wantOR(), "st-or", "resolve-pp", []));
    expect(d.writes.some((w) => w.date === SUN)).toBe(false);
    const away = expectOk(decide(input, wantOff(), "st-off", "resolve-pp", sunOrc));
    expect(away.writes.some((w) => w.date === SUN)).toBe(false);
  });

  it("a context cell inside the engine range is ignored (the baseline wins)", () => {
    const input = makeInput();
    const d = expectOk(decide(input, wantORC(), "st-orc", "resolve-pp", [{ staffId: "p2", date: MON, shiftTypeId: "st-orc", isLocked: true }]));
    expect(d.writes).toEqual([{ staffId: "p1", date: MON, shiftTypeId: "st-orc", source: "request" }]);
  });
});

describe("helpers", () => {
  it("dayLabel is the UTC calendar day", () => {
    expect(dayLabel("2026-11-09")).toBe("Mon 11/9");
    expect(dayLabel("2025-05-16")).toBe("Fri 5/16");
  });

  it("reasonFromRejection: a cap of 0 says the shift is not allowed; otherwise it names the cap", () => {
    const names = { initialsOf: () => "AB", codeOf: () => "ORC", capOf: buildDayCapLookup([{ shiftTypeId: "st-orc", dayKey: "1", maxCount: 0 }], new Set()) };
    expect(reasonFromRejection({ staffId: "p1", date: MON, shiftTypeId: "st-orc", reason: "day-full" }, names)).toBe(`ORC is not allowed on ${dayLabel(MON)}`);
    const one = { ...names, capOf: buildDayCapLookup([{ shiftTypeId: "st-orc", dayKey: "1", maxCount: 1 }], new Set()) };
    expect(reasonFromRejection({ staffId: "p1", date: MON, shiftTypeId: "st-orc", reason: "day-full" }, one)).toBe(`${dayLabel(MON)} already has its 1 ORC`);
    expect(reasonFromRejection({ staffId: "p1", date: MON, shiftTypeId: "st-orc", reason: "manual-locked" }, one)).toBe(`${dayLabel(MON)} is locked for AB`);
  });
});
