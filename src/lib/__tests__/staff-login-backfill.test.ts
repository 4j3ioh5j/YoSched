import { describe, it, expect } from "vitest";
import { planStaffLoginShells, needsStaffLogin, type StaffForBackfill } from "../staff-login-backfill";

const staff: StaffForBackfill[] = [
  { id: "s1", name: "Alice", isActive: true },
  { id: "s2", name: "Bob", isActive: true },
  { id: "s3", name: "Carol (inactive)", isActive: false },
];

describe("planStaffLoginShells", () => {
  it("creates a disabled, credential-less shell in the Staff group for each unlinked active staff", () => {
    const shells = planStaffLoginShells(staff, new Set(), "grp-staff");
    expect(shells).toEqual([
      { staffId: "s1", name: "Alice", email: null, passwordHash: null, isActive: false, groupId: "grp-staff" },
      { staffId: "s2", name: "Bob", email: null, passwordHash: null, isActive: false, groupId: "grp-staff" },
    ]);
  });

  it("skips inactive staff", () => {
    const shells = planStaffLoginShells(staff, new Set(), "grp-staff");
    expect(shells.map((s) => s.staffId)).not.toContain("s3");
  });

  it("is idempotent — staff already linked to a login are skipped", () => {
    const shells = planStaffLoginShells(staff, new Set(["s1"]), "grp-staff");
    expect(shells.map((s) => s.staffId)).toEqual(["s2"]);
  });

  it("a second run after all are linked produces nothing", () => {
    const shells = planStaffLoginShells(staff, new Set(["s1", "s2"]), "grp-staff");
    expect(shells).toEqual([]);
  });

  it("places every shell in the provided (Staff) group", () => {
    const shells = planStaffLoginShells(staff, new Set(), "grp-staff");
    expect(shells.length).toBeGreaterThan(0);
    expect(shells.every((s) => s.groupId === "grp-staff")).toBe(true);
  });
});

describe("needsStaffLogin", () => {
  // The single-staff predicate behind ensureStaffLogin's self-heal. The reactivation bug
  // was that this decision was never evaluated outside create/backfill, so imported staff
  // (and inactive-at-backfill staff later reactivated) stayed active with no login.
  it("provisions when active and not yet linked to a login", () => {
    expect(needsStaffLogin(true, false)).toBe(true);
  });

  it("skips when the staff already has a linked login (idempotent self-heal)", () => {
    expect(needsStaffLogin(true, true)).toBe(false);
  });

  it("skips inactive staff even when they have no login", () => {
    expect(needsStaffLogin(false, false)).toBe(false);
  });

  it("skips inactive staff that still have a (reset) shell login", () => {
    expect(needsStaffLogin(false, true)).toBe(false);
  });
});
