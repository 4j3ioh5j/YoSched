import { describe, it, expect } from "vitest";
import { isHiddenStaffLogin } from "../user-view";

const ADMIN_GROUP = { permissions: ["users:edit", "schedule:view"] };
const STAFF_GROUP = { permissions: ["schedule:view", "requests:self"] };

describe("isHiddenStaffLogin", () => {
  it("never hides a login that isn't linked to staff", () => {
    expect(isHiddenStaffLogin({ isActive: true, group: STAFF_GROUP, staff: null })).toBe(false);
    expect(isHiddenStaffLogin({ isActive: false, group: ADMIN_GROUP, staff: null })).toBe(false);
  });

  it("never hides a login whose staff is active", () => {
    expect(isHiddenStaffLogin({ isActive: false, group: STAFF_GROUP, staff: { isActive: true } })).toBe(false);
  });

  it("hides a non-admin login whose staff is inactive", () => {
    expect(isHiddenStaffLogin({ isActive: false, group: STAFF_GROUP, staff: { isActive: false } })).toBe(true);
  });

  it("does NOT hide an effective-admin login (group grants users:edit) even when its staff is inactive", () => {
    expect(isHiddenStaffLogin({ isActive: true, group: ADMIN_GROUP, staff: { isActive: false } })).toBe(false);
  });
});
