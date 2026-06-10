import { describe, it, expect } from "vitest";
import {
  activeAdminCount,
  hasUsersEdit,
  leavesNoActiveAdmin,
  withUserRemoved,
  withUserPatched,
  withGroupPermissions,
  withGroupRemoved,
  type AdminUser,
} from "../user-admin-safety";

const ADMIN_GROUP = ["users:edit", "staff:view"];
const PLAIN_GROUP = ["schedule:view"];

function mk(id: string, over: Partial<AdminUser> = {}): AdminUser {
  return { id, isActive: true, role: "viewer", groupPermissions: null, ...over };
}

describe("hasUsersEdit / activeAdminCount", () => {
  it("counts admins via group permissions", () => {
    const users = [mk("a", { groupPermissions: ADMIN_GROUP }), mk("b", { groupPermissions: PLAIN_GROUP })];
    expect(hasUsersEdit(users[0])).toBe(true);
    expect(hasUsersEdit(users[1])).toBe(false);
    expect(activeAdminCount(users)).toBe(1);
  });

  it("counts ungrouped admin/manager via role default, not viewer", () => {
    const users = [
      mk("a", { role: "admin", groupPermissions: null }),
      mk("b", { role: "manager", groupPermissions: null }),
      mk("c", { role: "viewer", groupPermissions: null }),
    ];
    expect(activeAdminCount(users)).toBe(2);
  });

  it("does not count inactive admins", () => {
    expect(activeAdminCount([mk("a", { role: "admin", groupPermissions: null, isActive: false })])).toBe(0);
  });
});

describe("the last-admin invariant survives each simulated mutation", () => {
  const users: AdminUser[] = [
    mk("admin1", { groupPermissions: ADMIN_GROUP }),
    mk("mgr", { role: "manager", groupPermissions: null }), // admin via role default
    mk("viewer", { groupPermissions: PLAIN_GROUP }),
  ];

  it("delete: removing one of two admins is OK; removing the last is not", () => {
    expect(leavesNoActiveAdmin(withUserRemoved(users, "admin1"))).toBe(false);
    const oneLeft = withUserRemoved(users, "admin1");
    expect(leavesNoActiveAdmin(withUserRemoved(oneLeft, "mgr"))).toBe(true);
  });

  it("demote: changing the last admin's group/role away from users:edit trips it", () => {
    const onlyAdmin = [mk("admin1", { groupPermissions: ADMIN_GROUP }), mk("v", { groupPermissions: PLAIN_GROUP })];
    expect(leavesNoActiveAdmin(withUserPatched(onlyAdmin, "admin1", { groupPermissions: PLAIN_GROUP }))).toBe(true);
    const ungrouped = [mk("a", { role: "admin", groupPermissions: null })];
    expect(leavesNoActiveAdmin(withUserPatched(ungrouped, "a", { role: "viewer" }))).toBe(true);
  });

  it("deactivate: disabling the last admin trips it", () => {
    const onlyAdmin = [mk("a", { role: "admin", groupPermissions: null })];
    expect(leavesNoActiveAdmin(withUserPatched(onlyAdmin, "a", { isActive: false }))).toBe(true);
  });

  it("group permission edit: stripping users:edit from the group holding all admins trips it", () => {
    const allInGroup = [mk("a", { groupPermissions: ADMIN_GROUP }), mk("b", { groupPermissions: ADMIN_GROUP })];
    expect(leavesNoActiveAdmin(withGroupPermissions(allInGroup, new Set(["a", "b"]), PLAIN_GROUP))).toBe(true);
    // safe when an independent ungrouped admin-role user also exists
    const mixed = [mk("a", { groupPermissions: ADMIN_GROUP }), mk("b", { role: "admin", groupPermissions: null })];
    expect(leavesNoActiveAdmin(withGroupPermissions(mixed, new Set(["a"]), PLAIN_GROUP))).toBe(false);
  });

  it("group delete: members fall back to role default", () => {
    // admin-ROLE member keeps users:edit via the role default → safe
    const adminRole = [mk("a", { role: "admin", groupPermissions: ADMIN_GROUP })];
    expect(leavesNoActiveAdmin(withGroupRemoved(adminRole, new Set(["a"])))).toBe(false);
    // viewer-ROLE member who was an admin only through the group → loses it → trips
    const viewerRole = [mk("a", { role: "viewer", groupPermissions: ADMIN_GROUP })];
    expect(leavesNoActiveAdmin(withGroupRemoved(viewerRole, new Set(["a"])))).toBe(true);
  });
});
