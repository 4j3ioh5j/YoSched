import { describe, it, expect } from "vitest";
import { effectivePermissions, canManageGroupLevel } from "../permissions";

describe("effectivePermissions", () => {
  it("returns the group's permission array", () => {
    expect(effectivePermissions({ permissions: ["users:edit", "staff:view"] })).toEqual(["users:edit", "staff:view"]);
    expect(effectivePermissions({ permissions: ["schedule:view"] })).toEqual(["schedule:view"]);
    expect(effectivePermissions({ permissions: [] })).toEqual([]);
  });
});

describe("canManageGroupLevel", () => {
  // Seeded levels: Admin 3, Super User 2, Scheduler 1, Staff 0.
  it("lets an admin (3) assign/manage at or below — including another admin", () => {
    expect(canManageGroupLevel(3, 3)).toBe(true); // admin → admin (the fix)
    expect(canManageGroupLevel(3, 2)).toBe(true);
    expect(canManageGroupLevel(3, 0)).toBe(true);
  });

  it("blocks assigning/managing strictly above your level", () => {
    expect(canManageGroupLevel(2, 3)).toBe(false); // super user cannot touch admin
    expect(canManageGroupLevel(1, 2)).toBe(false);
    expect(canManageGroupLevel(0, 1)).toBe(false);
  });

  it("lets a super user (2) manage peers but not admins", () => {
    expect(canManageGroupLevel(2, 2)).toBe(true);
    expect(canManageGroupLevel(2, 1)).toBe(true);
    expect(canManageGroupLevel(2, 3)).toBe(false);
  });
});
