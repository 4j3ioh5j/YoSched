import { describe, it, expect } from "vitest";
import { planStaffLoginShells, type StaffForBackfill } from "../staff-login-backfill";

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

  it("tolerates a missing Staff group (null groupId)", () => {
    const shells = planStaffLoginShells(staff, new Set(), null);
    expect(shells.every((s) => s.groupId === null)).toBe(true);
  });
});
