import { describe, it, expect } from "vitest";
import { normalizeProviderId, isProviderLinkConflict } from "../user-link";

describe("normalizeProviderId", () => {
  it("treats empty / whitespace / nullish as unlink (null)", () => {
    expect(normalizeProviderId("")).toBeNull();
    expect(normalizeProviderId("   ")).toBeNull();
    expect(normalizeProviderId(null)).toBeNull();
    expect(normalizeProviderId(undefined)).toBeNull();
    expect(normalizeProviderId(123)).toBeNull();
  });

  it("trims and returns a real id", () => {
    expect(normalizeProviderId("prov-1")).toBe("prov-1");
    expect(normalizeProviderId("  prov-2 ")).toBe("prov-2");
  });
});

describe("isProviderLinkConflict", () => {
  it("no conflict when unlinking", () => {
    expect(isProviderLinkConflict({ wantedProviderId: null, currentOwnerUserId: "u1", editingUserId: "u2" })).toBe(false);
  });

  it("no conflict when the provider is unowned", () => {
    expect(isProviderLinkConflict({ wantedProviderId: "p1", currentOwnerUserId: null, editingUserId: "u1" })).toBe(false);
  });

  it("no conflict when re-linking your own provider", () => {
    expect(isProviderLinkConflict({ wantedProviderId: "p1", currentOwnerUserId: "u1", editingUserId: "u1" })).toBe(false);
  });

  it("conflict when the provider is owned by a different user", () => {
    expect(isProviderLinkConflict({ wantedProviderId: "p1", currentOwnerUserId: "u1", editingUserId: "u2" })).toBe(true);
  });

  it("conflict when creating a new user (no editingUserId) for an owned provider", () => {
    expect(isProviderLinkConflict({ wantedProviderId: "p1", currentOwnerUserId: "u1", editingUserId: null })).toBe(true);
  });
});
