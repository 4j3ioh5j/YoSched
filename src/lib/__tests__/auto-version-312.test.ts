import { describe, it, expect } from "vitest";
import { hashSnapshot } from "@/lib/versions";
import {
  monthsNeedingVersion,
  autoVersionComment,
  parseAutoVersionMode,
  yearMonths,
  AUTO_VERSION_MODES,
} from "@/lib/auto-version";

// Card #312: Print and Export save a version first when a month changed or has none.

const cells = (staffId: string, date: string, shiftTypeId = "D", isLocked = false) => ({ staffId, date, shiftTypeId, isLocked });

describe("monthsNeedingVersion (card #312)", () => {
  const live = new Map<string, string>([
    ["2027-1", hashSnapshot([cells("a", "2027-02-01")])],
    ["2027-2", hashSnapshot([])],
  ]);
  const liveHashOf = (y: number, m: number) => live.get(`${y}-${m}`) ?? hashSnapshot([]);

  it("a month with no version needs one", () => {
    expect(monthsNeedingVersion([{ year: 2027, month: 1 }], liveHashOf, () => null)).toEqual([
      { year: 2027, month: 1, expectedHash: liveHashOf(2027, 1) },
    ]);
  });

  it("a blank month with no version still needs one (it becomes Version 1)", () => {
    const out = monthsNeedingVersion([{ year: 2027, month: 2 }], liveHashOf, () => null);
    expect(out).toEqual([{ year: 2027, month: 2, expectedHash: hashSnapshot([]) }]);
  });

  it("a month whose live cells match its current version is skipped", () => {
    const out = monthsNeedingVersion([{ year: 2027, month: 1 }], liveHashOf, () => ({ snapshotHash: liveHashOf(2027, 1) }));
    expect(out).toEqual([]);
  });

  it("a month that drifted from its current version needs one", () => {
    const out = monthsNeedingVersion([{ year: 2027, month: 1 }], liveHashOf, () => ({ snapshotHash: "other-1" }));
    expect(out.map((m) => m.month)).toEqual([1]);
  });

  it("keeps the input order and handles a whole year", () => {
    const year = yearMonths(2027);
    expect(year).toHaveLength(12);
    expect(year[0]).toEqual({ year: 2027, month: 0 });
    expect(year[11]).toEqual({ year: 2027, month: 11 });
    const out = monthsNeedingVersion(year, liveHashOf, (y, m) => (m === 1 ? { snapshotHash: liveHashOf(y, m) } : null));
    expect(out.map((m) => m.month)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe("autoVersionComment (card #312)", () => {
  const now = new Date(Date.UTC(2026, 10, 16, 14, 5));
  it("print: date in the chosen format, 24-hour time", () => {
    expect(autoVersionComment("print", now, "YYYY-MM-DD", "UTC")).toBe("Auto: printed 2026-11-16 14:05 UTC");
  });
  it("export: names the year exported", () => {
    expect(autoVersionComment("export", now, "MM/DD/YYYY", "UTC", 2027)).toBe("Auto: exported 2027 on 11/16/2026 14:05 UTC");
  });
  it("afternoon hours stay 24-hour, single digits are padded", () => {
    expect(autoVersionComment("print", new Date(Date.UTC(2026, 0, 2, 9, 7)), "YYYY-MM-DD", "UTC")).toBe("Auto: printed 2026-01-02 09:07 UTC");
  });
});

describe("parseAutoVersionMode (card #312)", () => {
  it("knows the three modes", () => {
    expect(AUTO_VERSION_MODES).toEqual(["auto", "ask", "off"]);
    for (const m of AUTO_VERSION_MODES) expect(parseAutoVersionMode(m)).toBe(m);
  });
  it("anything else (missing, old server, junk) is Automatic", () => {
    for (const v of [null, undefined, "", "AUTO", 3, "never"]) expect(parseAutoVersionMode(v)).toBe("auto");
  });
});
