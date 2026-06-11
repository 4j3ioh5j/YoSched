import { describe, it, expect } from "vitest";
import { otherColumnInitials, type OtherStaff } from "../other-column";

const staff: OtherStaff[] = [
  { id: "a", initials: "AB" },
  { id: "b", initials: "CD" },
  { id: "c", initials: "EF" },
];
const dates = ["2026-07-01", "2026-07-02"];

describe("otherColumnInitials", () => {
  it("lists initials of scheduled staff per day, in staff order", () => {
    // a + c scheduled on day 1; only b on day 2.
    const sched = new Set(["a:2026-07-01", "c:2026-07-01", "b:2026-07-02"]);
    const out = otherColumnInitials(staff, dates, (id, d) => sched.has(`${id}:${d}`));
    expect(out["2026-07-01"]).toEqual(["AB", "EF"]); // order preserved (a before c)
    expect(out["2026-07-02"]).toEqual(["CD"]);
  });

  it("returns an empty array for a day with nobody scheduled", () => {
    const out = otherColumnInitials(staff, dates, () => false);
    expect(out["2026-07-01"]).toEqual([]);
    expect(out["2026-07-02"]).toEqual([]);
  });

  it("respects the caller's predicate (e.g. off-shifts excluded)", () => {
    // Caller treats 'a' as off (off-shift) on day 1 → not scheduled; b is working.
    const out = otherColumnInitials(staff, ["2026-07-01"], (id) => id === "b");
    expect(out["2026-07-01"]).toEqual(["CD"]);
  });

  it("preserves the given staff order, not insertion/lookup order", () => {
    const out = otherColumnInitials(staff, ["2026-07-01"], () => true);
    expect(out["2026-07-01"]).toEqual(["AB", "CD", "EF"]);
  });
});
