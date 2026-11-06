import { describe, it, expect, vi } from "vitest";

// Rollout guard for the Staffing Rules id link (Codex #256): GET /api/auto-schedule/inputs is
// unversioned and a grid tab opened BEFORE the deploy keeps running the old engine bundle,
// which keys minimums and caps by shiftCode. An id-only bundle silently disabled every cap for
// that tab (two ORC accepted at Max 1), and Live Accept persisted the result. The bundle must
// therefore carry BOTH keys, with the code derived from the shift's current row.

const db = vi.hoisted(() => ({
  shifts: [] as { id: string; code: string }[],
  reqs: [] as { shiftTypeId: string; dayKey: string; minCount: number; preferredCount: number; maxCount: number | null }[],
}));

vi.mock("@/lib/pay-periods-server", () => ({ getPayPeriods: async () => [] }));
vi.mock("@/lib/prisma", () => {
  const empty = { findMany: async () => [], findFirst: async () => null };
  const shiftType = {
    findMany: async () =>
      db.shifts.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.code,
        defaultHours: 8,
        defaultHoursWeekend: null,
        defaultHoursHoliday: null,
        countsTowardFte: true,
        countsAsHolidayWork: false,
        isLeave: false,
        isOffShift: false,
        isFillShift: false,
        sortOrder: 0,
        schedulePriority: 0,
        weekendPaired: false,
        holidayWeekendPaired: false,
        ignoresWorkingDays: false,
        category: null,
        autoSchedulable: true,
      })),
  };
  const staffingRequirement = { findMany: async () => db.reqs.map((r) => ({ id: `${r.shiftTypeId}-${r.dayKey}`, ...r })) };
  const prisma = new Proxy({ shiftType, staffingRequirement } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? empty,
  });
  return { prisma };
});

import { buildAutoScheduleInput } from "../build-auto-schedule-input";

// The OLD bundle's cap lookup (src/lib/day-cap.ts at aa7df8e), verbatim: keyed by shiftCode,
// resolved through shiftTypes. This is what a pre-deploy tab runs against the new bundle.
type OldReq = { shiftCode: string; dayKey: string; maxCount?: number | null };
function oldBuildDayCapLookup(requirements: readonly OldReq[], shiftTypes: readonly { id: string; code: string }[], holidays: Iterable<string>) {
  const holidaySet = new Set(holidays);
  const byCode = new Map<string, Map<string, number>>();
  for (const r of requirements) {
    if (r.maxCount == null) continue;
    let m = byCode.get(r.shiftCode);
    if (!m) byCode.set(r.shiftCode, (m = new Map()));
    m.set(r.dayKey, r.maxCount);
  }
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  return (shiftTypeId: string, date: string) => {
    const code = codeById.get(shiftTypeId);
    if (code === undefined) return null;
    const dk = holidaySet.has(date) ? "holiday" : String(new Date(date + "T12:00:00").getDay());
    return byCode.get(code)?.get(dk) ?? null;
  };
}

describe("auto-schedule input bundle: staffing requirements carry both keys", () => {
  it("every requirement has shiftTypeId AND the shift's CURRENT code (derived from the shift, rows hold no code)", async () => {
    db.shifts = [
      { id: "st-orc", code: "ORCX" }, // renamed ORC → ORCX
      { id: "st-card", code: "CARD" },
    ];
    db.reqs = [
      { shiftTypeId: "st-orc", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 },
      { shiftTypeId: "st-card", dayKey: "1", minCount: 0, preferredCount: 0, maxCount: 2 },
    ];
    const input = await buildAutoScheduleInput("2027-01-04", "2027-01-04");
    expect(input.staffingRequirements).toEqual([
      { shiftTypeId: "st-orc", shiftCode: "ORCX", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 },
      { shiftTypeId: "st-card", shiftCode: "CARD", dayKey: "1", minCount: 0, preferredCount: 0, maxCount: 2 },
    ]);
  });

  it("old client + new bundle: the pre-id-link cap lookup still finds Max 1 for ORC on a Monday", async () => {
    db.shifts = [{ id: "st-orc", code: "ORC" }];
    db.reqs = [{ shiftTypeId: "st-orc", dayKey: "1", minCount: 1, preferredCount: 1, maxCount: 1 }];
    const input = await buildAutoScheduleInput("2027-01-04", "2027-01-04");
    // The old engine's types required shiftCode: string; assert the wire shape satisfies them.
    const oldShaped: OldReq[] = input.staffingRequirements.map((r) => {
      expect(typeof r.shiftCode).toBe("string");
      return { shiftCode: r.shiftCode as string, dayKey: r.dayKey, maxCount: r.maxCount };
    });
    const capOf = oldBuildDayCapLookup(oldShaped, input.shiftTypes, []);
    expect(capOf("st-orc", "2027-01-04")).toBe(1); // 2027-01-04 is a Monday
    // and the old minimums keying (reqsByShift.get(sr.shiftCode)) sees the row too
    const byCode = new Map(oldShaped.map((r) => [r.shiftCode, r.dayKey]));
    expect(byCode.get("ORC")).toBe("1");
  });
});
