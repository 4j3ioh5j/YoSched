import { describe, it, expect } from "vitest";
import {
  type AssignmentSnapshot,
  monthDateRange,
  dateInMonth,
  canonicalizeSnapshot,
  hashSnapshot,
  nextVersionNumber,
  diffSnapshots,
  summarizeChanges,
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

describe("diffSnapshots", () => {
  const prev = [
    snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
    snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
    snap({ providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
  ];

  it("detects added / removed / changed cells", () => {
    const next = [
      // p1 unchanged
      snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
      // p2 changed ICU -> ADM
      snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ADM" }),
      // p3 removed (absent)
      // p4 added
      snap({ providerId: "p4", date: "2026-06-03", shiftTypeId: "ORC" }),
    ];
    const changes = diffSnapshots(prev, next);
    expect(changes).toEqual([
      { kind: "changed", providerId: "p2", date: "2026-06-01", fromShiftTypeId: "ICU", toShiftTypeId: "ADM" },
      { kind: "removed", providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" },
      { kind: "added", providerId: "p4", date: "2026-06-03", shiftTypeId: "ORC" },
    ]);
  });

  it("reports a lock flip (same shift) as a 'locked' change", () => {
    const next = [
      snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR", isLocked: true }),
      snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
      snap({ providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
    ];
    expect(diffSnapshots(prev, next)).toEqual([
      { kind: "locked", providerId: "p1", date: "2026-06-01", shiftTypeId: "OR", isLocked: true },
    ]);
  });

  it("prefers a shift change over a lock change on the same cell", () => {
    const next = [
      snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "ADM", isLocked: true }),
      snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
      snap({ providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
    ];
    const changes = diffSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "changed", providerId: "p1", toShiftTypeId: "ADM" });
  });

  it("ignores source/notes-only edits (consistent with the hash)", () => {
    const next = prev.map((s) => snap({ ...s, source: "auto", notes: "x" }));
    expect(diffSnapshots(prev, next)).toEqual([]);
  });

  it("treats an empty previous snapshot as all-added (first version)", () => {
    const changes = diffSnapshots([], prev);
    expect(changes.every((c) => c.kind === "added")).toBe(true);
    expect(changes).toHaveLength(3);
  });

  it("is sorted by date then providerId", () => {
    const next = [
      snap({ providerId: "p9", date: "2026-06-05", shiftTypeId: "OR" }),
      snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
      snap({ providerId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
      snap({ providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
      snap({ providerId: "p0", date: "2026-06-05", shiftTypeId: "OR" }),
    ];
    const order = diffSnapshots(prev, next).map((c) => `${c.date}:${c.providerId}`);
    expect(order).toEqual([...order].sort());
  });
});

describe("summarizeChanges", () => {
  it("counts each kind and the total", () => {
    const changes = diffSnapshots(
      [snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "OR" }), snap({ providerId: "p3", date: "2026-06-02", shiftTypeId: "OR" })],
      [snap({ providerId: "p1", date: "2026-06-01", shiftTypeId: "ADM" }), snap({ providerId: "p2", date: "2026-06-03", shiftTypeId: "OR" })],
    );
    // p1 changed, p3 removed, p2 added
    expect(summarizeChanges(changes)).toEqual({ added: 1, removed: 1, changed: 1, locked: 0, total: 3 });
  });

  it("an empty diff summarizes to zeros", () => {
    expect(summarizeChanges([])).toEqual({ added: 0, removed: 0, changed: 0, locked: 0, total: 0 });
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
