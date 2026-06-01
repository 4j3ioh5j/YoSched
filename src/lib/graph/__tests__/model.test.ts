import { describe, it, expect } from "vitest";
import { assembleEquityModel, computeStatsModel, type AssembleShiftType, type RawStatsData } from "../model";
import type { FairnessSummary, FairnessMetrics, FairnessDeviation } from "../../fairness";

const metric = (
  providerId: string,
  initials: string,
  ftePercentage: number,
  extra: Partial<FairnessMetrics> = {},
): FairnessMetrics => ({
  providerId,
  initials,
  ftePercentage,
  desirabilityScore: 0,
  undesirableShiftCount: 0,
  desirableShiftCount: 0,
  holidayWorkCount: 0,
  totalWorkDays: 0,
  totalLeaveDays: 0,
  shiftCounts: {},
  ...extra,
});

const dev = (o: Partial<FairnessDeviation> = {}): FairnessDeviation => ({
  desirability: 0,
  holidayWork: 0,
  overall: 0,
  perShift: {},
  ...o,
});

function fairness(
  metrics: FairnessMetrics[],
  opts: {
    deviations?: Record<string, FairnessDeviation>;
    displayDeviations?: Record<string, FairnessDeviation>;
    averages?: FairnessSummary["averages"];
  } = {},
): FairnessSummary {
  return {
    metrics,
    averages: opts.averages ?? { desirabilityScore: 1.5, holidayWorkCount: 2, perShift: { CALL: 3 } },
    trackedShiftCodes: ["CALL"],
    equityShiftCodes: ["CALL"],
    deviations: new Map(metrics.map((m) => [m.providerId, opts.deviations?.[m.providerId] ?? dev()])),
    displayDeviations: new Map(metrics.map((m) => [m.providerId, opts.displayDeviations?.[m.providerId] ?? dev()])),
  };
}

// work = weekday-only (skipped on weekends); call = counts on weekends; off = not FTE.
const SHIFT_TYPES: AssembleShiftType[] = [
  { id: "work", countsTowardFte: true, countsOnWeekend: false, defaultHours: 10 },
  { id: "call", countsTowardFte: true, countsOnWeekend: true, defaultHours: 24 },
  { id: "off", countsTowardFte: false, countsOnWeekend: false, defaultHours: 0 },
];

describe("assembleEquityModel — hours / weekend / override parity", () => {
  // 2026-06-03 Wed (weekday), 2026-06-06 Sat (weekend).
  const model = assembleEquityModel({
    fairness: fairness([
      metric("p1", "AA", 1.0, { totalWorkDays: 3, totalLeaveDays: 1 }),
      metric("p2", "BB", 0.5, { totalWorkDays: 1, totalLeaveDays: 0 }),
    ]),
    providers: [
      { id: "p1", name: "Alice", isAutoScheduled: true, ftePercentage: 1.0, employmentTypeName: "FTE" },
      { id: "p2", name: "Bob", isAutoScheduled: false, ftePercentage: 0.5, employmentTypeName: "Fee Basis" },
    ],
    assignments: [
      { providerId: "p1", shiftTypeId: "work", date: "2026-06-03", code: "WORK", isOffShift: false },
      { providerId: "p1", shiftTypeId: "work", date: "2026-06-06", code: "WORK", isOffShift: false },
      { providerId: "p1", shiftTypeId: "call", date: "2026-06-06", code: "CALL", isOffShift: false },
      { providerId: "p2", shiftTypeId: "call", date: "2026-06-03", code: "CALL", isOffShift: false },
    ],
    shiftTypes: SHIFT_TYPES,
    overrides: [{ providerId: "p1", shiftTypeId: "call", durationHrs: 30 }],
  });

  const p1 = () => model.data.find((d) => d.providerId === "p1")!;
  const p2 = () => model.data.find((d) => d.providerId === "p2")!;

  it("skips weekend hours for weekday-only shifts, keeps weekend-eligible ones, and applies overrides", () => {
    // p1: WORK Wed +10; WORK Sat skipped; CALL Sat override 30 => 40
    expect(p1().totalHours).toBe(40);
    // p2: CALL Wed default 24
    expect(p2().totalHours).toBe(24);
  });

  it("tallies every non-off shift regardless of weekend", () => {
    expect(p1().shiftTally).toEqual({ WORK: 2, CALL: 1 });
    expect(p2().shiftTally).toEqual({ CALL: 1 });
  });

  it("derives the date range from assignment dates", () => {
    expect(model.dateRange).toEqual({ min: "2026-06-03", max: "2026-06-06" });
  });

  it("lists shift codes sorted and unique", () => {
    expect(model.shiftCodes).toEqual(["CALL", "WORK"]);
  });

  it("FTE-normalizes department averages and passes fairness averages through", () => {
    // totalHours: (40/1 + 24/0.5) / 2 = 44
    expect(model.averages.totalHours).toBe(44);
    // workDays: (3/1 + 1/0.5) / 2 = 2.5 ; leaveDays: (1/1 + 0) / 2 = 0.5
    expect(model.averages.totalWorkDays).toBe(2.5);
    expect(model.averages.totalLeaveDays).toBe(0.5);
    expect(model.averages.desirabilityScore).toBe(1.5);
    expect(model.averages.holidayWorkCount).toBe(2);
    expect(model.averages.perShift).toEqual({ CALL: 3 });
  });
});

describe("assembleEquityModel — provider mapping", () => {
  it("maps name/employment/fte and wires both deviation maps through", () => {
    const model = assembleEquityModel({
      fairness: fairness(
        [metric("p1", "AA", 1.0)],
        {
          deviations: { p1: dev({ desirability: 0.7, holidayWork: -0.2, overall: 0.5, perShift: { CALL: 0.3 } }) },
          displayDeviations: { p1: dev({ desirability: 0.1, holidayWork: 0.2, overall: 0.9, perShift: { CALL: -0.4 } }) },
        },
      ),
      providers: [{ id: "p1", name: "Alice", isAutoScheduled: true, ftePercentage: null, employmentTypeName: "FTE" }],
      assignments: [],
      shiftTypes: SHIFT_TYPES,
      overrides: [],
    });
    const row = model.data[0];
    expect(row.name).toBe("Alice");
    expect(row.employmentTypeName).toBe("FTE");
    expect(row.ftePercentage).toBe(1.0); // null defaults to 1.0
    expect(row.deviation).toEqual({ desirability: 0.7, holidayWork: -0.2, overall: 0.5, perShift: { CALL: 0.3 } });
    expect(row.displayDeviation).toEqual({ desirability: 0.1, holidayWork: 0.2, overall: 0.9, perShift: { CALL: -0.4 } });
  });
});

describe("computeStatsModel — full engine wiring", () => {
  it("runs computeFairness + assembleEquityModel from the raw payload", () => {
    const raw: RawStatsData = {
      providers: [
        { id: "p1", initials: "AA", name: "Alice", ftePercentage: 1.0, isActive: true, isAutoScheduled: true, employmentTypeName: "FTE", eligibleShiftTypeIds: [] },
      ],
      assignments: [
        {
          providerId: "p1",
          shiftTypeId: "call",
          date: "2026-06-03",
          shiftType: { id: "call", code: "CALL", defaultHours: 24, countsTowardFte: true, isLeave: false, isOffShift: false },
        },
      ],
      shiftTypes: [{ id: "call", countsTowardFte: true, countsOnWeekend: true, defaultHours: 24 }],
      desirabilityWeights: [],
      holidays: [],
      equityFactors: [],
      overrides: [],
    };
    const model = computeStatsModel(raw);
    expect(model.data).toHaveLength(1);
    expect(model.data[0].providerId).toBe("p1");
    expect(model.data[0].totalHours).toBe(24);
    expect(model.data[0].shiftTally).toEqual({ CALL: 1 });
    expect(model.dateRange).toEqual({ min: "2026-06-03", max: "2026-06-03" });
    expect(model.shiftCodes).toEqual(["CALL"]);
  });

  it("excludes inactive / non-auto-scheduled providers (computeFairness gate)", () => {
    const raw: RawStatsData = {
      providers: [
        { id: "p1", initials: "AA", name: "Alice", ftePercentage: 1.0, isActive: false, isAutoScheduled: true, employmentTypeName: "FTE", eligibleShiftTypeIds: [] },
      ],
      assignments: [],
      shiftTypes: [],
      desirabilityWeights: [],
      holidays: [],
      equityFactors: [],
      overrides: [],
    };
    expect(computeStatsModel(raw).data).toHaveLength(0);
  });
});

describe("assembleEquityModel — off-shift handling", () => {
  it("excludes off shifts from tallies and hours but still emits the provider row", () => {
    const model = assembleEquityModel({
      fairness: fairness([metric("p3", "CC", 1.0)]),
      providers: [{ id: "p3", name: "Cara", isAutoScheduled: true, ftePercentage: 1.0, employmentTypeName: "FTE" }],
      assignments: [{ providerId: "p3", shiftTypeId: "off", date: "2026-06-08", code: "OFF", isOffShift: true }],
      shiftTypes: SHIFT_TYPES,
      overrides: [],
    });
    expect(model.data).toHaveLength(1);
    expect(model.data[0].shiftTally).toEqual({});
    expect(model.data[0].totalHours).toBe(0);
    expect(model.shiftCodes).toEqual([]);
  });
});
