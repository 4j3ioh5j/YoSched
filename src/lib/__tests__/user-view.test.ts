import { describe, it, expect } from "vitest";
import { isHiddenStaffLogin } from "../user-view";

const ADMIN_GROUP = { permissions: ["users:edit", "schedule:view"] };
const STAFF_GROUP = { permissions: ["schedule:view", "requests:self"] };

describe("isHiddenStaffLogin", () => {
  it("never hides a login that isn't linked to staff", () => {
    expect(isHiddenStaffLogin({ role: "viewer", isActive: true, group: STAFF_GROUP, staff: null })).toBe(false);
    expect(isHiddenStaffLogin({ role: "admin", isActive: false, group: null, staff: null })).toBe(false);
  });

  it("never hides a login whose staff is active", () => {
    expect(isHiddenStaffLogin({ role: "viewer", isActive: false, group: STAFF_GROUP, staff: { isActive: true } })).toBe(false);
  });

  it("hides a non-admin login whose staff is inactive", () => {
    expect(isHiddenStaffLogin({ role: "viewer", isActive: false, group: STAFF_GROUP, staff: { isActive: false } })).toBe(true);
  });

  it("does NOT hide an effective-admin login even when its staff is inactive (group grants users:edit)", () => {
    expect(isHiddenStaffLogin({ role: "viewer", isActive: true, group: ADMIN_GROUP, staff: { isActive: false } })).toBe(false);
  });

  it("does NOT hide an ungrouped admin-by-role login whose staff is inactive", () => {
    expect(isHiddenStaffLogin({ role: "admin", isActive: true, group: null, staff: { isActive: false } })).toBe(false);
  });

  it("HIDES a grouped login whose role is admin but whose group lacks users:edit (effective perms come from the group)", () => {
    // Mirrors the real 'Corey Downs' case: role=admin but in the Scheduler/Staff group.
    expect(isHiddenStaffLogin({ role: "admin", isActive: true, group: STAFF_GROUP, staff: { isActive: false } })).toBe(true);
  });
});
