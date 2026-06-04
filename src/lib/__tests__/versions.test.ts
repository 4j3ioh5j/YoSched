import { describe, it, expect } from "vitest";
import {
  type AssignmentSnapshot,
  monthDateRange,
  dateInMonth,
  canonicalizeSnapshot,
  hashSnapshot,
  nextVersionNumber,
} from "../versions";

function snap(partial: Partial<AssignmentSnapshot> & { providerId: string; date: string; shiftTypeId: string }): AssignmentSnapshot {
  return { isLocked: false, source: "manual", notes: null, ...partial };
}

describe("monthDateRange", () => {
  it("returns UTC [start, endExclusive) for the calendar month", () => {
    const { start, end } = monthDateRange(2026, 5); // June (0-based)
    expect(start.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rolls over the year for December", () => {
    const { start, end } = monthDateRange(2026, 11); // December
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("dateInMonth", () => {
  it("matches dates within the 0-based calendar month", () => {
    expect(dateInMonth("2026-06-01", 2026, 5)).toBe(true);
    expect(dateInMonth("2026-06-30", 2026, 5)).toBe(true);
    expect(dateInMonth("2026-05-31", 2026, 5)).toBe(false);
    expect(dateInMonth("2026-07-01", 2026, 5)).toBe(false);
    expect(dateInMonth("2025-06-15", 2026, 5)).toBe(false);
  });
});

describe("canonicalizeSnapshot", () => {
  it("sorts by providerId then date, independent of input order", () => {
    const a = snap({ providerId: "p2", date: "2026-06-02", shiftTypeId: "s" });
    const b = snap({ providerId: "p1", date: "2026-06-05", shiftTypeId: "s" });
    const c = snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "s" });
    const out = canonicalizeSnapshot([a, b, c]);
    expect(out.map((x) => `${x.providerId}:${x.date}`)).toEqual([
      "p1:2026-06-01",
      "p1:2026-06-05",
      "p2:2026-06-02",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [snap({ providerId: "p2", date: "2026-06-02", shiftTypeId: "s" }), snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "s" })];
    const before = input.map((x) => x.providerId);
    canonicalizeSnapshot(input);
    expect(input.map((x) => x.providerId)).toEqual(before);
  });
});

describe("hashSnapshot", () => {
  const base = [
    snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
    snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
  ];

  it("is independent of row order", () => {
    expect(hashSnapshot(base)).toBe(hashSnapshot([...base].reverse()));
  });

  it("changes when a shift assignment changes", () => {
    const changed = [snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "ADM" }), base[1]];
    expect(hashSnapshot(changed)).not.toBe(hashSnapshot(base));
  });

  it("changes when lock state changes", () => {
    const locked = [snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR", isLocked: true }), base[1]];
    expect(hashSnapshot(locked)).not.toBe(hashSnapshot(base));
  });

  it("ignores source and notes (bookkeeping the grid does not carry)", () => {
    const reannotated = [
      snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR", source: "auto", notes: "swapped" }),
      snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ICU", source: "imported" }),
    ];
    expect(hashSnapshot(reannotated)).toBe(hashSnapshot(base));
  });

  it("distinguishes adding an assignment from removing one", () => {
    const withExtra = [...base, snap({ providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" })];
    expect(hashSnapshot(withExtra)).not.toBe(hashSnapshot(base));
  });

  it("an empty month has a stable hash", () => {
    expect(hashSnapshot([])).toBe(hashSnapshot([]));
    expect(hashSnapshot([])).not.toBe(hashSnapshot(base));
  });
});

describe("nextVersionNumber", () => {
  it("starts at 1 for a month with no versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("is max + 1, not count + 1 (survives gaps from deletions)", () => {
    expect(nextVersionNumber([1, 2, 3])).toBe(4);
    expect(nextVersionNumber([1, 5])).toBe(6);
    expect(nextVersionNumber([3])).toBe(4);
  });
});
