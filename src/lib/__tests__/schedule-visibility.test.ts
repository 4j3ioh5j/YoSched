import { describe, it, expect } from "vitest";
import { isPastMonth, visibleStaffForMonth, type VisStaff, type VisAssignment } from "../schedule-visibility";

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

describe("visibleStaffForMonth", () => {
  const A: VisStaff = { id: "active1", isActive: true };
  const A2: VisStaff = { id: "active2", isActive: true }; // active, no assignments
  const INACTIVE: VisStaff = { id: "sts", isActive: false }; // departed historical
  const staff = [A, A2, INACTIVE];
  const off = new Set(["off"]); // "X" off-shift type id

  const first = "2023-03-01";
  const last = "2023-03-31";

  it("future/current month → active roster only, even if inactive has assignments", () => {
    const asn: VisAssignment[] = [{ staffId: "sts", date: "2023-03-10", shiftTypeId: "OR" }];
    const res = visibleStaffForMonth(staff, asn, first, last, /*past*/ false, /*showAll*/ false, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2"]); // A2 shown despite no assignments
  });

  it("past month → only staff with a REAL assignment that month", () => {
    const asn: VisAssignment[] = [
      { staffId: "active1", date: "2023-03-05", shiftTypeId: "OR" }, // real
      { staffId: "sts", date: "2023-03-20", shiftTypeId: "ICU" }, // inactive but worked → shown
    ];
    const res = visibleStaffForMonth(staff, asn, first, last, true, false, off);
    expect(res.map((p) => p.id).sort()).toEqual(["active1", "sts"]);
    // active2 (no assignment) is suppressed
    expect(res.map((p) => p.id)).not.toContain("active2");
  });

  it("past month → off-shift (X) only does NOT make a staff visible", () => {
    const asn: VisAssignment[] = [
      { staffId: "active1", date: "2023-03-05", shiftTypeId: "off" }, // X only
      { staffId: "active2", date: "2023-03-06", shiftTypeId: "off" }, // X only
    ];
    const res = visibleStaffForMonth(staff, asn, first, last, true, false, off);
    expect(res).toEqual([]);
  });

  it("past month → a leave shift counts as scheduled", () => {
    const asn: VisAssignment[] = [{ staffId: "active1", date: "2023-03-05", shiftTypeId: "SL" }];
    const res = visibleStaffForMonth(staff, asn, first, last, true, false, off);
    expect(res.map((p) => p.id)).toEqual(["active1"]);
  });

  it("past month → mixed X + real → visible", () => {
    const asn: VisAssignment[] = [
      { staffId: "active1", date: "2023-03-01", shiftTypeId: "off" },
      { staffId: "active1", date: "2023-03-15", shiftTypeId: "OR" },
    ];
    const res = visibleStaffForMonth(staff, asn, first, last, true, false, off);
    expect(res.map((p) => p.id)).toEqual(["active1"]);
  });

  it("past month → assignment in adjacent-month padding is ignored", () => {
    const asn: VisAssignment[] = [{ staffId: "active1", date: "2023-02-26", shiftTypeId: "OR" }]; // Feb padding
    const res = visibleStaffForMonth(staff, asn, first, last, true, false, off);
    expect(res).toEqual([]);
  });

  it("past month + showAll → active roster, NOT inactive staff with no assignment that month", () => {
    // showAll reveals active staff who had no shifts, but must not resurrect a
    // departed/inactive staff who never worked the viewed month.
    const res = visibleStaffForMonth(staff, [], first, last, true, /*showAll*/ true, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2"]);
    expect(res.map((p) => p.id)).not.toContain("sts");
  });

  it("past month + showAll → inactive staff WITH a real assignment that month is still shown", () => {
    const asn: VisAssignment[] = [{ staffId: "sts", date: "2023-03-12", shiftTypeId: "OR" }];
    const res = visibleStaffForMonth(staff, asn, first, last, true, /*showAll*/ true, off);
    expect(res.map((p) => p.id).sort()).toEqual(["active1", "active2", "sts"]);
  });

  it("past month + showAll → inactive staff with only an off-shift (X) stays hidden", () => {
    const asn: VisAssignment[] = [{ staffId: "sts", date: "2023-03-12", shiftTypeId: "off" }];
    const res = visibleStaffForMonth(staff, asn, first, last, true, /*showAll*/ true, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2"]);
    expect(res.map((p) => p.id)).not.toContain("sts");
  });

  it("showAll must NOT leak inactive staff into a current/future month", () => {
    // Regression: showAllStaff persists across navigation; it must only apply to
    // past months, never the active-roster (current/future) view.
    const res = visibleStaffForMonth(staff, [], first, last, /*past*/ false, /*showAll*/ true, off);
    expect(res.map((p) => p.id)).toEqual(["active1", "active2"]);
    expect(res.map((p) => p.id)).not.toContain("sts");
  });
});
