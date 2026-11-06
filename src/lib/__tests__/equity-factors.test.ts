import { describe, it, expect } from "vitest";
import { deriveEquityFactorCodes, buildEquityFactorsSave, equitySaveErrorMessage, EQUITY_FACTORS_SAVE_URL } from "../equity-factors";
import { computeFairness } from "../fairness";
import { STALE_CLIENT } from "../stale-client";

// Equity factors are stored by shift id; the code the fairness math keys on is derived
// from the shift list loaded in the same request, so a rename follows automatically.

describe("deriveEquityFactorCodes", () => {
  it("gives each shift factor its shift's CURRENT code; built-ins and unknown ids get null", () => {
    const shifts = [
      { id: "st-orc", code: "ORCX" }, // renamed ORC → ORCX
      { id: "st-call", code: "CALL" },
    ];
    const out = deriveEquityFactorCodes(
      [
        { factorType: "desirability", shiftTypeId: null, weight: 1, enabled: true },
        { factorType: "shift", shiftTypeId: "st-orc", weight: 1, enabled: true },
        { factorType: "shift", shiftTypeId: "st-call", weight: 2, enabled: false },
        { factorType: "shift", shiftTypeId: "st-gone", weight: 1, enabled: true },
      ],
      shifts,
    );
    expect(out.map((f) => f.shiftCode)).toEqual([null, "ORCX", "CALL", null]);
    expect(out[1]).toMatchObject({ factorType: "shift", shiftTypeId: "st-orc", weight: 1 });
  });
});

describe("fairness keyed through the shift id", () => {
  // Two shifts whose codes are each other's ids: any code/id mix-up shows up.
  const A = { id: "st-a", code: "st-b", defaultHours: 8, countsTowardFte: true, countsAsHolidayWork: false, isLeave: false, isOffShift: false };
  const B = { id: "st-b", code: "st-a", defaultHours: 8, countsTowardFte: true, countsAsHolidayWork: false, isLeave: false, isOffShift: false };
  const staff = [
    { id: "p1", initials: "AA", ftePercentage: 1, isActive: true, isAutoScheduled: true },
    { id: "p2", initials: "BB", ftePercentage: 1, isActive: true, isAutoScheduled: true },
  ];
  // p1 works B three times; p2 works A three times.
  const assignments = [
    ...["2027-01-04", "2027-01-05", "2027-01-06"].map((date) => ({ staffId: "p1", date, shiftType: B })),
    ...["2027-01-04", "2027-01-05", "2027-01-06"].map((date) => ({ staffId: "p2", date, shiftType: A })),
  ];

  it("a factor on shift B (by id) weights B's counts, not A's", () => {
    const factors = deriveEquityFactorCodes([{ factorType: "shift", shiftTypeId: "st-b", weight: 1, enabled: true }], [A, B]);
    expect(factors[0].shiftCode).toBe("st-a"); // B's code
    const fairness = computeFairness({ assignments, staff, desirabilityWeights: [], holidays: [], equityFactors: factors });
    expect(fairness.equityShiftCodes).toEqual(["st-a"]);
    expect(fairness.averages.perShift["st-a"]).toBe(1.5); // (3 + 0) / 2
    const p1 = fairness.metrics.find((m) => m.staffId === "p1")!;
    const p2 = fairness.metrics.find((m) => m.staffId === "p2")!;
    expect(p1.shiftCounts["st-a"]).toBe(3);
    expect(p2.shiftCounts["st-a"] ?? 0).toBe(0);
  });

  it("after a rename the derived code follows and the factor still contributes", () => {
    const Bx = { ...B, code: "BX" };
    const renamedAssignments = assignments.map((a) => (a.shiftType === B ? { ...a, shiftType: Bx } : a));
    const factors = deriveEquityFactorCodes([{ factorType: "shift", shiftTypeId: "st-b", weight: 1, enabled: true }], [A, Bx]);
    expect(factors[0].shiftCode).toBe("BX");
    const fairness = computeFairness({ assignments: renamedAssignments, staff, desirabilityWeights: [], holidays: [], equityFactors: factors });
    expect(fairness.equityShiftCodes).toEqual(["BX"]);
    expect(fairness.averages.perShift["BX"]).toBe(1.5);
  });
});

describe("Settings save payload (fail closed against an old server)", () => {
  it("carries ids only — no shiftCode key anywhere — and targets the id-only route", () => {
    const body = buildEquityFactorsSave([
      { factorType: "desirability", shiftTypeId: null, weight: 1, enabled: true },
      { factorType: "shift", shiftTypeId: "st-orc", weight: 2, enabled: false },
    ]);
    expect(EQUITY_FACTORS_SAVE_URL).toBe("/api/settings/equity-factors/by-shift-id");
    expect(body).toEqual({
      factors: [
        { factorType: "desirability", shiftTypeId: null, weight: 1, enabled: true, sortOrder: 0 },
        { factorType: "shift", shiftTypeId: "st-orc", weight: 2, enabled: false, sortOrder: 1 },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("shiftCode");
  });

  it("a 404/405 (pre-slice server after a rollback) is the reload message; other errors show the server's text", () => {
    expect(equitySaveErrorMessage(404, "<!DOCTYPE html>not found")).toBe(STALE_CLIENT.error);
    expect(equitySaveErrorMessage(405, "")).toBe(STALE_CLIENT.error);
    expect(equitySaveErrorMessage(409, JSON.stringify(STALE_CLIENT))).toBe(STALE_CLIENT.error);
    expect(equitySaveErrorMessage(400, JSON.stringify({ error: "Unknown shift x", reason: "unknown-shift" }))).toBe("Unknown shift x");
    expect(equitySaveErrorMessage(500, "boom")).toBe("boom");
    expect(equitySaveErrorMessage(502, "")).toBe("Save failed (502)");
  });
});
