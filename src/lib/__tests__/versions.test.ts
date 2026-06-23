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
  restoreAffectedCells,
} from "../versions";

function snap(partial: Partial<AssignmentSnapshot> & { staffId: string; date: string; shiftTypeId: string }): AssignmentSnapshot {
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
  it("sorts by staffId then date, independent of input order", () => {
    const a = snap({ staffId: "p2", date: "2026-06-02", shiftTypeId: "s" });
    const b = snap({ staffId: "p1", date: "2026-06-05", shiftTypeId: "s" });
    const c = snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "s" });
    const out = canonicalizeSnapshot([a, b, c]);
    expect(out.map((x) => `${x.staffId}:${x.date}`)).toEqual([
      "p1:2026-06-01",
      "p1:2026-06-05",
      "p2:2026-06-02",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [snap({ staffId: "p2", date: "2026-06-02", shiftTypeId: "s" }), snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "s" })];
    const before = input.map((x) => x.staffId);
    canonicalizeSnapshot(input);
    expect(input.map((x) => x.staffId)).toEqual(before);
  });
});

describe("hashSnapshot", () => {
  const base = [
    snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
    snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
  ];

  it("is independent of row order", () => {
    expect(hashSnapshot(base)).toBe(hashSnapshot([...base].reverse()));
  });

  it("changes when a shift assignment changes", () => {
    const changed = [snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "ADM" }), base[1]];
    expect(hashSnapshot(changed)).not.toBe(hashSnapshot(base));
  });

  it("changes when lock state changes", () => {
    const locked = [snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR", isLocked: true }), base[1]];
    expect(hashSnapshot(locked)).not.toBe(hashSnapshot(base));
  });

  it("ignores source and notes (bookkeeping the grid does not carry)", () => {
    const reannotated = [
      snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR", source: "auto", notes: "swapped" }),
      snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ICU", source: "imported" }),
    ];
    expect(hashSnapshot(reannotated)).toBe(hashSnapshot(base));
  });

  it("distinguishes adding an assignment from removing one", () => {
    const withExtra = [...base, snap({ staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" })];
    expect(hashSnapshot(withExtra)).not.toBe(hashSnapshot(base));
  });

  it("an empty month has a stable hash", () => {
    expect(hashSnapshot([])).toBe(hashSnapshot([]));
    expect(hashSnapshot([])).not.toBe(hashSnapshot(base));
  });
});

describe("diffSnapshots", () => {
  const prev = [
    snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
    snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
    snap({ staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
  ];

  it("detects added / removed / changed cells", () => {
    const next = [
      // p1 unchanged
      snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
      // p2 changed ICU -> ADM
      snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ADM" }),
      // p3 removed (absent)
      // p4 added
      snap({ staffId: "p4", date: "2026-06-03", shiftTypeId: "ORC" }),
    ];
    const changes = diffSnapshots(prev, next);
    expect(changes).toEqual([
      { kind: "changed", staffId: "p2", date: "2026-06-01", fromShiftTypeId: "ICU", toShiftTypeId: "ADM" },
      { kind: "removed", staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" },
      { kind: "added", staffId: "p4", date: "2026-06-03", shiftTypeId: "ORC" },
    ]);
  });

  it("reports a lock flip (same shift) as a 'locked' change", () => {
    const next = [
      snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR", isLocked: true }),
      snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
      snap({ staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
    ];
    expect(diffSnapshots(prev, next)).toEqual([
      { kind: "locked", staffId: "p1", date: "2026-06-01", shiftTypeId: "OR", isLocked: true },
    ]);
  });

  it("prefers a shift change over a lock change on the same cell", () => {
    const next = [
      snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "ADM", isLocked: true }),
      snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
      snap({ staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
    ];
    const changes = diffSnapshots(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "changed", staffId: "p1", toShiftTypeId: "ADM" });
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

  it("is sorted by date then staffId", () => {
    const next = [
      snap({ staffId: "p9", date: "2026-06-05", shiftTypeId: "OR" }),
      snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR" }),
      snap({ staffId: "p2", date: "2026-06-01", shiftTypeId: "ICU" }),
      snap({ staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" }),
      snap({ staffId: "p0", date: "2026-06-05", shiftTypeId: "OR" }),
    ];
    const order = diffSnapshots(prev, next).map((c) => `${c.date}:${c.staffId}`);
    expect(order).toEqual([...order].sort());
  });
});

describe("summarizeChanges", () => {
  it("counts each kind and the total", () => {
    const changes = diffSnapshots(
      [snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "OR" }), snap({ staffId: "p3", date: "2026-06-02", shiftTypeId: "OR" })],
      [snap({ staffId: "p1", date: "2026-06-01", shiftTypeId: "ADM" }), snap({ staffId: "p2", date: "2026-06-03", shiftTypeId: "OR" })],
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

describe("restoreAffectedCells", () => {
  it("unions before (cleared) and after (recreated) cells", () => {
    const before = [
      { staffId: "s1", date: "2026-08-17" }, // dropped by the restore
      { staffId: "s2", date: "2026-08-01" },
    ];
    const after = [
      { staffId: "s2", date: "2026-08-01" }, // unchanged (in both)
      { staffId: "s3", date: "2026-08-05" }, // added by the restore
    ];
    const cells = restoreAffectedCells(before, after);
    // The dropped cell must be present so its stranded approval can be reverted.
    expect(cells).toContainEqual({ staffId: "s1", date: "2026-08-17" });
    // The added cell must be present so a now-satisfied request can auto-approve.
    expect(cells).toContainEqual({ staffId: "s3", date: "2026-08-05" });
    expect(cells).toContainEqual({ staffId: "s2", date: "2026-08-01" });
  });

  it("dedupes a cell present in both snapshots (same staff+date once)", () => {
    const cell = { staffId: "s1", date: "2026-08-17" };
    expect(restoreAffectedCells([cell], [{ ...cell }])).toEqual([cell]);
  });

  it("returns [] when both sides are empty", () => {
    expect(restoreAffectedCells([], [])).toEqual([]);
  });

  it("keeps same-date cells for different staff distinct", () => {
    const cells = restoreAffectedCells(
      [{ staffId: "a", date: "2026-08-04" }],
      [{ staffId: "b", date: "2026-08-04" }],
    );
    expect(cells).toHaveLength(2);
  });
});
