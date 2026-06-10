import { describe, it, expect } from "vitest";
import {
  activeAdminCount,
  hasUsersEdit,
  leavesNoActiveAdmin,
  withUserRemoved,
  withUserPatched,
  withGroupPermissions,
  type AdminUser,
} from "../user-admin-safety";

const ADMIN_GROUP = ["users:edit", "staff:view"];
const PLAIN_GROUP = ["schedule:view"];

function mk(id: string, over: Partial<AdminUser> = {}): AdminUser {
  return { id, isActive: true, groupPermissions: PLAIN_GROUP, ...over };
}

describe("hasUsersEdit / activeAdminCount", () => {
  it("counts admins via group permissions", () => {
    const users = [mk("a", { groupPermissions: ADMIN_GROUP }), mk("b", { groupPermissions: PLAIN_GROUP })];
    expect(hasUsersEdit(users[0])).toBe(true);
    expect(hasUsersEdit(users[1])).toBe(false);
    expect(activeAdminCount(users)).toBe(1);
  });

  it("does not count inactive admins", () => {
    expect(activeAdminCount([mk("a", { groupPermissions: ADMIN_GROUP, isActive: false })])).toBe(0);
  });
});

describe("the last-admin invariant survives each simulated mutation", () => {
  const users: AdminUser[] = [
    mk("admin1", { groupPermissions: ADMIN_GROUP }),
    mk("admin2", { groupPermissions: ADMIN_GROUP }),
    mk("viewer", { groupPermissions: PLAIN_GROUP }),
  ];

  it("delete: removing one of two admins is OK; removing the last is not", () => {
    expect(leavesNoActiveAdmin(withUserRemoved(users, "admin1"))).toBe(false);
    const oneLeft = withUserRemoved(users, "admin1");
    expect(leavesNoActiveAdmin(withUserRemoved(oneLeft, "admin2"))).toBe(true);
  });

  it("demote: moving the last admin to a non-admin group trips it", () => {
    const onlyAdmin = [mk("admin1", { groupPermissions: ADMIN_GROUP }), mk("v", { groupPermissions: PLAIN_GROUP })];
    expect(leavesNoActiveAdmin(withUserPatched(onlyAdmin, "admin1", { groupPermissions: PLAIN_GROUP }))).toBe(true);
  });

  it("deactivate: disabling the last admin trips it", () => {
    const onlyAdmin = [mk("a", { groupPermissions: ADMIN_GROUP })];
    expect(leavesNoActiveAdmin(withUserPatched(onlyAdmin, "a", { isActive: false }))).toBe(true);
  });

  it("group permission edit: stripping users:edit from the group holding all admins trips it", () => {
    const allInGroup = [mk("a", { groupPermissions: ADMIN_GROUP }), mk("b", { groupPermissions: ADMIN_GROUP })];
    expect(leavesNoActiveAdmin(withGroupPermissions(allInGroup, new Set(["a", "b"]), PLAIN_GROUP))).toBe(true);
    // safe when an admin in a different group also exists
    const mixed = [mk("a", { groupPermissions: ADMIN_GROUP }), mk("b", { groupPermissions: ADMIN_GROUP })];
    expect(leavesNoActiveAdmin(withGroupPermissions(mixed, new Set(["a"]), PLAIN_GROUP))).toBe(false);
  });
});
