import { describe, it, expect } from "vitest";
import { canSeeView, canManageView, nextOwnerId } from "../view-access";

const OWNER = "user-1";
const OTHER = "user-2";

describe("canSeeView", () => {
  it("anyone can see a shared view", () => {
    expect(canSeeView({ isShared: true, ownerId: OWNER }, OTHER)).toBe(true);
    expect(canSeeView({ isShared: true, ownerId: null }, OTHER)).toBe(true);
  });

  it("only the owner can see a private view", () => {
    expect(canSeeView({ isShared: false, ownerId: OWNER }, OWNER)).toBe(true);
    expect(canSeeView({ isShared: false, ownerId: OWNER }, OTHER)).toBe(false);
  });

  it("a private orphan (ownerId null) is visible to nobody", () => {
    expect(canSeeView({ isShared: false, ownerId: null }, OWNER)).toBe(false);
    expect(canSeeView({ isShared: false, ownerId: null }, OTHER)).toBe(false);
  });
});

describe("canManageView", () => {
  it("any manager may edit/delete a shared view", () => {
    expect(canManageView({ isShared: true, ownerId: OWNER }, OTHER)).toBe(true);
  });

  it("only the owner may edit/delete a private view", () => {
    expect(canManageView({ isShared: false, ownerId: OWNER }, OWNER)).toBe(true);
    expect(canManageView({ isShared: false, ownerId: OWNER }, OTHER)).toBe(false);
  });
});

describe("nextOwnerId (CR #346: making a shared view private)", () => {
  it("a department-owned shared view (ownerId null) becoming private is claimed by the actor — no orphan", () => {
    // Regression: without this the view would become isShared=false, ownerId=null → invisible to all.
    expect(nextOwnerId({ isShared: true, ownerId: null }, false, OTHER)).toBe(OTHER);
    expect(canSeeView({ isShared: false, ownerId: OTHER }, OTHER)).toBe(true);
  });

  it("another user's shared view becoming private is claimed by the actor — not mis-owned", () => {
    expect(nextOwnerId({ isShared: true, ownerId: OWNER }, false, OTHER)).toBe(OTHER);
  });

  it("leaves ownership untouched when a private view stays private (e.g. rename)", () => {
    expect(nextOwnerId({ isShared: false, ownerId: OWNER }, undefined, OWNER)).toBe(OWNER);
    expect(nextOwnerId({ isShared: false, ownerId: OWNER }, false, OWNER)).toBe(OWNER);
  });

  it("leaves ownership untouched when making a private view shared", () => {
    expect(nextOwnerId({ isShared: false, ownerId: OWNER }, true, OTHER)).toBe(OWNER);
  });

  it("leaves ownership untouched when a shared view stays shared (spec/name edit)", () => {
    expect(nextOwnerId({ isShared: true, ownerId: OWNER }, undefined, OTHER)).toBe(OWNER);
    expect(nextOwnerId({ isShared: true, ownerId: OWNER }, true, OTHER)).toBe(OWNER);
  });
});
