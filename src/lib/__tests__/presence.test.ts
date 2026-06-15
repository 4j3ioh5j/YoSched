import { describe, it, expect } from "vitest";
import { activeEditors, PRESENCE_TTL_MS, type ActivityRow } from "../presence";

const now = new Date("2026-06-15T12:00:00.000Z");
const EDIT = ["schedule:view", "schedule:edit"];
const VIEW_ONLY = ["schedule:view"];

function row(over: Partial<ActivityRow>): ActivityRow {
  return { userId: "u", name: "User", permissions: EDIT, lastSeen: now, ...over };
}

describe("activeEditors", () => {
  it("returns other editors active within the TTL", () => {
    const rows = [
      row({ userId: "me", name: "Me" }),
      row({ userId: "a", name: "Alice" }),
      row({ userId: "b", name: "Bob" }),
    ];
    expect(activeEditors(rows, { now, selfUserId: "me" })).toEqual([
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ]);
  });

  it("excludes the viewer themselves", () => {
    const rows = [row({ userId: "me", name: "Me" })];
    expect(activeEditors(rows, { now, selfUserId: "me" })).toEqual([]);
  });

  it("excludes logins without schedule:edit", () => {
    const rows = [row({ userId: "a", name: "Alice", permissions: VIEW_ONLY })];
    expect(activeEditors(rows, { now, selfUserId: "me" })).toEqual([]);
  });

  it("excludes heartbeats older than the TTL (walked-away tab ages out)", () => {
    const stale = new Date(now.getTime() - PRESENCE_TTL_MS - 1);
    const rows = [row({ userId: "a", name: "Alice", lastSeen: stale })];
    expect(activeEditors(rows, { now, selfUserId: "me" })).toEqual([]);
  });

  it("keeps a heartbeat exactly at the TTL boundary", () => {
    const edge = new Date(now.getTime() - PRESENCE_TTL_MS);
    const rows = [row({ userId: "a", name: "Alice", lastSeen: edge })];
    expect(activeEditors(rows, { now, selfUserId: "me" })).toEqual([{ id: "a", name: "Alice" }]);
  });

  it("sorts results by name for a stable banner", () => {
    const rows = [
      row({ userId: "c", name: "Carol" }),
      row({ userId: "a", name: "Alice" }),
      row({ userId: "b", name: "Bob" }),
    ];
    expect(activeEditors(rows, { now, selfUserId: "me" }).map((e) => e.name)).toEqual([
      "Alice",
      "Bob",
      "Carol",
    ]);
  });

  it("honors a custom ttlMs", () => {
    const rows = [row({ userId: "a", name: "Alice", lastSeen: new Date(now.getTime() - 5_000) })];
    expect(activeEditors(rows, { now, selfUserId: "me", ttlMs: 1_000 })).toEqual([]);
    expect(activeEditors(rows, { now, selfUserId: "me", ttlMs: 10_000 })).toEqual([{ id: "a", name: "Alice" }]);
  });
});
