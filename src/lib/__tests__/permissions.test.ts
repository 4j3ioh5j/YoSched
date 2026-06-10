import { describe, it, expect } from "vitest";
import { effectivePermissions, FULL_PERMISSIONS, VIEWER_PERMISSIONS } from "../permissions";

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
