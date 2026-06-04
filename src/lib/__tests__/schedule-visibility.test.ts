import { describe, it, expect } from "vitest";
import { isPastMonth, visibleProvidersForMonth, type VisProvider, type VisAssignment } from "../schedule-visibility";

describe("isPastMonth", () => {
  const now = new Date(2026, 5, 15); // June 2026 (month index 5)
  it("prior year is past", () => expect(isPastMonth(2025, 11, now)).toBe(true));
  it("prior month same year is past", () => expect(isPastMonth(2026, 4, now)).toBe(true));
  it("current month is NOT past", () => expect(isPastMonth(2026, 5, now)).toBe(false));
  it("future month same year is NOT past", () => expect(isPastMonth(2026, 6, now)).toBe(false));
  it("future year is NOT past", () => expect(isPastMonth(2027, 0, now)).toBe(false));
  it("Dec->Jan boundary", () => {
    const jan = new Date(2026, 0, 10);
    expect(isPastMonth(2025, 11, jan)).toBe(true); // Dec 2025 from Jan 2026
    expect(isPastMonth(2026, 0, jan)).toBe(false); // current
  });
});

describe("visibleProvidersForMonth", () => {
  const A: VisProvider = { id: "active1", isActive: true };
  const A2: VisProvider = { id: "active2", isActive: true }; // active, no assignments
  const INACTIVE: VisProvider = { id: "sts", isActive: false }; // departed historical
  const providers = [A, A2, INACTIVE];
  const off = new Set(["off"]); // "X" off-shift type id

  const first = "2023-03-01";
  const last = "2023-03-31";

  it("future/current month → active roster only, even if inactive has assignments", () => {
    const asn: VisAssignment[] = [{ providerId: "sts", date: "2023-03-10", shiftTypeId: "OR" }];
    const res = visibleProvidersForMonth(providers, asn, first, last, /*past*/ false, /*showAll*/ false, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2"]); // A2 shown despite no assignments
  });

  it("past month → only providers with a REAL assignment that month", () => {
    const asn: VisAssignment[] = [
      { providerId: "active1", date: "2023-03-05", shiftTypeId: "OR" }, // real
      { providerId: "sts", date: "2023-03-20", shiftTypeId: "ICU" }, // inactive but worked → shown
    ];
    const res = visibleProvidersForMonth(providers, asn, first, last, true, false, off);
    expect(res.map((p) => p.id).sort()).toEqual(["active1", "sts"]);
    // active2 (no assignment) is suppressed
    expect(res.map((p) => p.id)).not.toContain("active2");
  });

  it("past month → off-shift (X) only does NOT make a provider visible", () => {
    const asn: VisAssignment[] = [
      { providerId: "active1", date: "2023-03-05", shiftTypeId: "off" }, // X only
      { providerId: "active2", date: "2023-03-06", shiftTypeId: "off" }, // X only
    ];
    const res = visibleProvidersForMonth(providers, asn, first, last, true, false, off);
    expect(res).toEqual([]);
  });

  it("past month → a leave shift counts as scheduled", () => {
    const asn: VisAssignment[] = [{ providerId: "active1", date: "2023-03-05", shiftTypeId: "SL" }];
    const res = visibleProvidersForMonth(providers, asn, first, last, true, false, off);
    expect(res.map((p) => p.id)).toEqual(["active1"]);
  });

  it("past month → mixed X + real → visible", () => {
    const asn: VisAssignment[] = [
      { providerId: "active1", date: "2023-03-01", shiftTypeId: "off" },
      { providerId: "active1", date: "2023-03-15", shiftTypeId: "OR" },
    ];
    const res = visibleProvidersForMonth(providers, asn, first, last, true, false, off);
    expect(res.map((p) => p.id)).toEqual(["active1"]);
  });

  it("past month → assignment in adjacent-month padding is ignored", () => {
    const asn: VisAssignment[] = [{ providerId: "active1", date: "2023-02-26", shiftTypeId: "OR" }]; // Feb padding
    const res = visibleProvidersForMonth(providers, asn, first, last, true, false, off);
    expect(res).toEqual([]);
  });

  it("past month + showAll → full set regardless of assignments", () => {
    const res = visibleProvidersForMonth(providers, [], first, last, true, /*showAll*/ true, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2", "sts"]);
  });

  it("showAll must NOT leak inactive providers into a current/future month", () => {
    // Regression: showAllStaff persists across navigation; it must only apply to
    // past months, never the active-roster (current/future) view.
    const res = visibleProvidersForMonth(providers, [], first, last, /*past*/ false, /*showAll*/ true, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2"]);
    expect(res.map((p) => p.id)).not.toContain("sts");
  });
});
