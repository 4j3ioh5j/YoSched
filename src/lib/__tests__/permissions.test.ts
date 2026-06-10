import { describe, it, expect } from "vitest";
import { effectivePermissions, effectiveGroupLevel, canManageGroupLevel, FULL_PERMISSIONS, VIEWER_PERMISSIONS } from "../permissions";

describe("effectivePermissions", () => {
  it("uses the group's permissions when grouped — role is ignored", () => {
    expect(effectivePermissions("viewer", { permissions: ["users:edit", "staff:view"] })).toEqual(["users:edit", "staff:view"]);
    // an admin-ROLE user is still limited by a restricted group
    expect(effectivePermissions("admin", { permissions: ["schedule:view"] })).toEqual(["schedule:view"]);
  });

  it("falls back to the full set for ungrouped admin/manager", () => {
    expect(effectivePermissions("admin", null)).toEqual(FULL_PERMISSIONS);
    expect(effectivePermissions("manager", null)).toEqual(FULL_PERMISSIONS);
    expect(effectivePermissions("admin", null)).toContain("users:edit");
  });

  it("falls back to the viewer set for ungrouped viewer", () => {
    expect(effectivePermissions("viewer", null)).toEqual(VIEWER_PERMISSIONS);
    expect(effectivePermissions("viewer", null)).not.toContain("users:edit");
  });

  it("treats undefined group like null", () => {
    expect(effectivePermissions("admin", undefined)).toEqual(FULL_PERMISSIONS);
  });
});

describe("effectiveGroupLevel", () => {
  it("uses the group level when grouped (role ignored)", () => {
    expect(effectiveGroupLevel("viewer", { level: 3 })).toBe(3);
    expect(effectiveGroupLevel("admin", { level: 0 })).toBe(0);
  });

  it("falls back by role when ungrouped — admin 3, manager 2, else 0", () => {
    expect(effectiveGroupLevel("admin", null)).toBe(3);
    expect(effectiveGroupLevel("manager", null)).toBe(2);
    expect(effectiveGroupLevel("viewer", null)).toBe(0);
    expect(effectiveGroupLevel("admin", undefined)).toBe(3);
  });

  it("an ungrouped admin target is NOT manageable by a super user (the privilege-bypass guard)", () => {
    const actor = 2; // super user
    const target = effectiveGroupLevel("admin", null); // 3, despite no group
    expect(canManageGroupLevel(actor, target)).toBe(false);
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
