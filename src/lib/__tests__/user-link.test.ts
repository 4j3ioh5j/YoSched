import { describe, it, expect } from "vitest";
import { normalizeStaffId, isStaffLinkConflict } from "../user-link";

describe("normalizeStaffId", () => {
  it("treats empty / whitespace / nullish as unlink (null)", () => {
    expect(normalizeStaffId("")).toBeNull();
    expect(normalizeStaffId("   ")).toBeNull();
    expect(normalizeStaffId(null)).toBeNull();
    expect(normalizeStaffId(undefined)).toBeNull();
    expect(normalizeStaffId(123)).toBeNull();
  });

  it("trims and returns a real id", () => {
    expect(normalizeStaffId("prov-1")).toBe("prov-1");
    expect(normalizeStaffId("  prov-2 ")).toBe("prov-2");
  });
});

describe("isStaffLinkConflict", () => {
  it("no conflict when unlinking", () => {
    expect(isStaffLinkConflict({ wantedStaffId: null, currentOwnerUserId: "u1", editingUserId: "u2" })).toBe(false);
  });

  it("no conflict when the staff is unowned", () => {
    expect(isStaffLinkConflict({ wantedStaffId: "p1", currentOwnerUserId: null, editingUserId: "u1" })).toBe(false);
  });

  it("no conflict when re-linking your own staff", () => {
    expect(isStaffLinkConflict({ wantedStaffId: "p1", currentOwnerUserId: "u1", editingUserId: "u1" })).toBe(false);
  });

  it("conflict when the staff is owned by a different user", () => {
    expect(isStaffLinkConflict({ wantedStaffId: "p1", currentOwnerUserId: "u1", editingUserId: "u2" })).toBe(true);
  });

  it("conflict when creating a new user (no editingUserId) for an owned staff", () => {
    expect(isStaffLinkConflict({ wantedStaffId: "p1", currentOwnerUserId: "u1", editingUserId: null })).toBe(true);
  });
});
