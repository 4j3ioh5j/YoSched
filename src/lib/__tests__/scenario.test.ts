import { describe, it, expect } from "vitest";
import { applyScenario, applyScenarioExpanding, cellsToCommitOnAccept, freesForRing, freesForScope, type ScenarioPin, type ScenarioFree } from "../scenario";
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

  it("chains: re-solving from a prior outcome's grid preserves it (no-op)", () => {
    // Live mode chains edits by feeding each outcome's grid back as the next
    // baseline. Re-solving that grid with no new edit must reproduce it exactly —
    // otherwise edits would drift on every interaction.
    const baseline = DATES.map((d) => lockedOR("p1", d));
    const out1 = applyScenario(
      makeInput({ existingAssignments: baseline }),
      [{ staffId: "p2", date: "2025-05-12", shiftTypeId: "st-or" }],
      [],
    );
    expect(out1.applied).toBe(true);

    const chained = makeInput({
      existingAssignments: out1.grid.map((c) => ({ ...c, isLocked: false })),
    });
    const out2 = applyScenario(chained, [], []);
    expect(out2.applied).toBe(true);
    expect(out2.changes).toEqual([]);
    expect(cellAt(out2.grid, "p2", "2025-05-12")).toBe("st-or");
    for (const d of DATES) expect(cellAt(out2.grid, "p1", d)).toBe("st-or");
  });

  it("compensation: freeing non-pinned cells lets the engine backfill what a pin broke", () => {
    // The Live ripple: pin one cell, free the rest, the engine re-solves to stay
    // feasible. Here pinning p1 off OR (→ ORL) drops OR coverage below its min; with
    // p2's day freed the engine moves p2 onto OR to compensate.
    const ORL = makeShift("st-orl", "ORL");
    const elig = ["st-or", "st-orl", "st-off"];
    const input = makeInput({
      staff: [makeStaff("p1", "AB", { eligibleShiftTypeIds: elig }), makeStaff("p2", "CD", { eligibleShiftTypeIds: elig })],
      shiftTypes: [OR, ORL, OFF],
      existingAssignments: [
        { staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false },
        { staffId: "p2", date: "2025-05-12", shiftTypeId: "st-off", code: "X", isLocked: false },
      ],
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
    });
    const pin = [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-orl" }];

    // With the rest LOCKED (no free) → no room to compensate: p2 stays off, OR uncovered.
    const noComp = applyScenario(input, pin, []);
    expect(cellAt(noComp.grid, "p1", "2025-05-12")).toBe("st-orl");
    expect(cellAt(noComp.grid, "p2", "2025-05-12")).toBe("st-off");

    // Freeing p2's (non-pinned) cell → engine backfills OR onto p2 (the ripple).
    const comp = applyScenario(input, pin, [{ staffId: "p2", date: "2025-05-12" }]);
    expect(comp.applied).toBe(true);
    expect(cellAt(comp.grid, "p1", "2025-05-12")).toBe("st-orl");
    expect(cellAt(comp.grid, "p2", "2025-05-12")).toBe("st-or");
  });

  it("does not mutate the caller's input", () => {
    const baseline = [lockedOR("p1", "2025-05-12")];
    const input = makeInput({ existingAssignments: baseline });
    const before = JSON.stringify(input);
    applyScenario(input, [{ staffId: "p2", date: "2025-05-13", shiftTypeId: "st-or" }], [{ staffId: "p1", date: "2025-05-12" }]);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("cellsToCommitOnAccept — WYSIWYG Accept (Auto-generate)", () => {
  const savedGridOf = (input: AutoScheduleInput) => {
    const m = new Map<string, string>();
    for (const a of input.existingAssignments) m.set(`${a.staffId}:${a.date}`, a.shiftTypeId);
    return m;
  };
  const k = (s: string, d: string) => `${s}:${d}`;

  it("commits every enter-time fill of an empty slot (the auto-fill-disappears fix)", () => {
    // Saved grid is PARTIAL: only p1/Mon is stored; force OR coverage so the engine
    // fills the empty slots on enter (the no-pin/no-free re-solve = Auto-generate).
    const input = makeInput({
      existingAssignments: [lockedOR("p1", "2025-05-12")],
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 2 }],
    });
    const saved = savedGridOf(input);
    const out = applyScenario(input, [], []);
    const committed = new Set(cellsToCommitOnAccept(out.grid, saved).map((c) => k(c.staffId, c.date)));

    // Cells the engine filled into un-saved slots are EXACTLY what the old
    // enter-time-snapshot diff silently dropped. Every one must be committed.
    const fills = out.grid.filter((c) => !saved.has(k(c.staffId, c.date)));
    expect(fills.length).toBeGreaterThan(0);
    expect(committed.has(k("p2", "2025-05-12"))).toBe(true); // p2/Mon was forced-filled
    for (const f of fills) expect(committed.has(k(f.staffId, f.date))).toBe(true);
  });

  it("omits cells unchanged from the saved grid (they keep their stored source)", () => {
    const input = makeInput({ existingAssignments: [lockedOR("p1", "2025-05-12")] });
    const saved = savedGridOf(input);
    const out = applyScenario(input, [], []);
    const commit = cellsToCommitOnAccept(out.grid, saved);
    // p1/Mon is locked OR in the saved grid and the engine can't move a locked cell,
    // so it is unchanged ⇒ NOT re-committed (would otherwise re-stamp its source).
    expect(commit.find((c) => c.staffId === "p1" && c.date === "2025-05-12")).toBeUndefined();
  });

  it("commits a user edit that diverges from the saved grid", () => {
    const input = makeInput({ existingAssignments: [] });
    const saved = savedGridOf(input); // empty
    const out = applyScenario(input, [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or" }], []);
    const pinned = cellsToCommitOnAccept(out.grid, saved).find((c) => c.staffId === "p1" && c.date === "2025-05-12");
    expect(pinned?.shiftTypeId).toBe("st-or");
  });
});

describe("freesForScope — ripple scope → freed cells (Auto-generate)", () => {
  const keysOf = (frees: ScenarioFree[]) => new Set(frees.map((f) => `${f.staffId}:${f.date}`));
  const filled = (locked = false) =>
    DATES.flatMap((d) => [
      { staffId: "p1", date: d, shiftTypeId: "st-or", code: "OR", isLocked: locked },
      { staffId: "p2", date: d, shiftTypeId: "st-or", code: "OR", isLocked: locked },
    ]);

  it("frees NOTHING when no date is touched — even at range scope (the phantom-ripple bug)", () => {
    const input = makeInput({ existingAssignments: filled() });
    // This is the bare scope-switch case: no pins, no touched dates.
    expect(freesForScope(input, new Set<string>(), new Set<string>(), "range")).toEqual([]);
    expect(freesForScope(input, new Set<string>(), new Set<string>(), "pp")).toEqual([]);
    expect(freesForScope(input, new Set<string>(), new Set<string>(), "day")).toEqual([]);
  });

  it("range scope frees every unlocked, un-pinned cell once a date is touched", () => {
    // p2's cells are locked → never freed; p1's are unlocked.
    const existing = DATES.flatMap((d) => [
      { staffId: "p1", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false },
      { staffId: "p2", date: d, shiftTypeId: "st-or", code: "OR", isLocked: true },
    ]);
    const input = makeInput({ existingAssignments: existing });
    const frees = keysOf(freesForScope(input, new Set(["p1:2025-05-12"]), new Set(["2025-05-12"]), "range"));
    expect(frees.has("p1:2025-05-12")).toBe(false); // pinned by the edit
    expect(frees.has("p1:2025-05-13")).toBe(true);  // unlocked, not pinned, in range
    expect(frees.has("p2:2025-05-12")).toBe(false); // locked
  });

  it("never frees a manual cell — even unlocked and in scope", () => {
    // A hand-placed cell (source "manual") stays fixed during a Live re-solve;
    // the engine compensates for an edit by reshuffling only its own auto fills.
    const existing = [
      { staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false }, // the edit (pinned)
      { staffId: "p1", date: "2025-05-13", shiftTypeId: "st-or", code: "OR", isLocked: false, source: "manual" },
      { staffId: "p1", date: "2025-05-14", shiftTypeId: "st-or", code: "OR", isLocked: false, source: "auto" },
    ];
    const input = makeInput({ existingAssignments: existing });
    const frees = keysOf(freesForScope(input, new Set(["p1:2025-05-12"]), new Set(["2025-05-12"]), "range"));
    expect(frees.has("p1:2025-05-13")).toBe(false); // manual → never freed
    expect(frees.has("p1:2025-05-14")).toBe(true);  // auto → discretionary, freed
  });

  it("day scope frees only the touched date; pp scope frees the touched pay period", () => {
    const input = makeInput({ existingAssignments: filled() });
    const touched = new Set(["2025-05-12"]);
    const day = keysOf(freesForScope(input, new Set<string>(), touched, "day"));
    expect(day.has("p1:2025-05-12")).toBe(true);
    expect(day.has("p1:2025-05-13")).toBe(false);
    // All DATES fall in PP 2025-05-11..2025-05-24, so pp scope frees them all.
    const pp = keysOf(freesForScope(input, new Set<string>(), touched, "pp"));
    for (const d of DATES) expect(pp.has(`p1:${d}`)).toBe(true);
  });
});

describe("freesForRing — minimal-freeing ladder (#248 Option 4)", () => {
  const keysOf = (frees: ScenarioFree[]) => new Set(frees.map((f) => `${f.staffId}:${f.date}`));
  const filled = () =>
    DATES.flatMap((d) => [
      { staffId: "p1", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false },
      { staffId: "p2", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false },
    ]);

  it("ring 0 frees nothing extra; higher rings widen day → pp → range", () => {
    const input = makeInput({ existingAssignments: filled() });
    const touched = new Set(["2025-05-12"]);
    const noPins = new Set<string>();

    expect(freesForRing(input, noPins, touched, 0)).toEqual([]); // ring 0: nothing

    const ring1 = keysOf(freesForRing(input, noPins, touched, 1));
    expect(ring1.has("p1:2025-05-12")).toBe(true);  // touched day
    expect(ring1.has("p1:2025-05-13")).toBe(false); // other day excluded

    // pp + range both cover every day here (single PP spans the week).
    const ring2 = keysOf(freesForRing(input, noPins, touched, 2));
    const ring3 = keysOf(freesForRing(input, noPins, touched, 3));
    for (const d of DATES) { expect(ring2.has(`p1:${d}`)).toBe(true); expect(ring3.has(`p1:${d}`)).toBe(true); }
  });

  it("ring N matches the equivalent scope (freesForScope delegates here)", () => {
    const input = makeInput({ existingAssignments: filled() });
    const touched = new Set(["2025-05-12"]);
    const noPins = new Set<string>();
    expect(freesForRing(input, noPins, touched, 1)).toEqual(freesForScope(input, noPins, touched, "day"));
    expect(freesForRing(input, noPins, touched, 3)).toEqual(freesForScope(input, noPins, touched, "range"));
  });
});

describe("applyScenarioExpanding — expand only as far as coverage needs (#248 Option 4)", () => {
  const cellKeys = (changes: { staffId: string; date: string }[]) => changes.map((c) => `${c.staffId}:${c.date}`);

  it("stops at ring 0 when the edit doesn't drop coverage — ripple = just the edited cell", () => {
    // Both staff OR all days; minCount OR(Mon)=1, so p1 dropping off Monday still
    // leaves p2 covering it → no hard breach → no discretionary cell is ever freed.
    const baseline = DATES.flatMap((d) => [
      { staffId: "p1", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false },
      { staffId: "p2", date: d, shiftTypeId: "st-or", code: "OR", isLocked: false },
    ]);
    const input = makeInput({
      existingAssignments: baseline,
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
    });
    const pins: ScenarioPin[] = [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-off" }];
    const pinned = new Set(["p1:2025-05-12"]);
    const touched = new Set(["2025-05-12"]);

    // Even with the WIDEST ceiling, expanding stops at ring 0.
    const out = applyScenarioExpanding(input, pins, [], touched, pinned, "range");
    expect(out.applied).toBe(true);
    expect(cellKeys(out.changes)).toEqual(["p1:2025-05-12"]); // only the edit moved

    // Full-scope (un-expanded) freeing can only ever touch ≥ as many cells.
    const full = applyScenario(input, pins, freesForScope(input, pinned, touched, "range"));
    expect(out.changes.length).toBeLessThanOrEqual(full.changes.length);
  });

  it("widens until coverage is restored — backfills the freed slot from the next ring", () => {
    // p1 covers Monday's OR (minCount 1), p2 is off. Pinning p1 off Monday breaks
    // coverage at ring 0 (delta +1 hard breach) → expand to ring 1 → p2:Mon is freed
    // and the engine must place p2 on OR (hard min) → coverage restored.
    const baseline = [
      { staffId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false },
      { staffId: "p2", date: "2025-05-12", shiftTypeId: "st-off", code: "X", isLocked: false },
    ];
    const input = makeInput({
      existingAssignments: baseline,
      staffingRequirements: [{ shiftCode: "OR", dayKey: "1", minCount: 1 }],
    });
    const pins: ScenarioPin[] = [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-off" }];
    const pinned = new Set(["p1:2025-05-12"]);
    const touched = new Set(["2025-05-12"]);

    const out = applyScenarioExpanding(input, pins, [], touched, pinned, "range");
    expect(out.applied).toBe(true);
    expect(cellAt(out.grid, "p2", "2025-05-12")).toBe("st-or"); // backfilled by expansion
    expect(out.result.quality.breakdown.hardBreaches).toBe(0);  // coverage whole again
  });

  it("a hard-illegal pin snaps back without widening", () => {
    const input = makeInput({ existingAssignments: DATES.flatMap((d) => [lockedOR("p1", d)]) });
    // p1 isn't eligible for a shift that doesn't exist in their eligibility set.
    const pins: ScenarioPin[] = [{ staffId: "p1", date: "2025-05-12", shiftTypeId: "st-ghost" }];
    const out = applyScenarioExpanding(input, pins, [], new Set(["2025-05-12"]), new Set(["p1:2025-05-12"]), "range");
    expect(out.applied).toBe(false);
    expect(out.changes).toEqual([]);
  });
});
