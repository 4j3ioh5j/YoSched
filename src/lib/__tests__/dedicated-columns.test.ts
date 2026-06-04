import { describe, it, expect } from "vitest";
import { dedicatedColumnInitials, type CoverageProvider } from "../dedicated-columns";

describe("dedicatedColumnInitials", () => {
  const A: CoverageProvider = { id: "a", initials: "AA" };
  const B: CoverageProvider = { id: "b", initials: "BB" };
  const C: CoverageProvider = { id: "c", initials: "CC" };
  const providers = [A, B, C];
  const dates = ["2026-06-01", "2026-06-02"];

  // Simple cell map: `${id}:${date}` -> code
  const lookup = (cells: Record<string, string>) => (pid: string, date: string) => cells[`${pid}:${date}`];

  it("lists initials of providers covering the shift each day, in provider order", () => {
    const cells = {
      "a:2026-06-01": "CALL",
      "b:2026-06-01": "OR",
      "c:2026-06-01": "CALL",
      "b:2026-06-02": "CALL",
    };
    const res = dedicatedColumnInitials(providers, dates, "CALL", lookup(cells));
    expect(res["2026-06-01"]).toEqual(["AA", "CC"]); // A before C (provider order)
    expect(res["2026-06-02"]).toEqual(["BB"]);
  });

  it("returns an empty array for days with no coverage", () => {
    const res = dedicatedColumnInitials(providers, dates, "CALL", lookup({}));
    expect(res["2026-06-01"]).toEqual([]);
    expect(res["2026-06-02"]).toEqual([]);
  });

  it("matches the exact code only (no partial / case-folded matches)", () => {
    const cells = { "a:2026-06-01": "call", "b:2026-06-01": "CALLBACK" };
    const res = dedicatedColumnInitials(providers, dates, "CALL", lookup(cells));
    expect(res["2026-06-01"]).toEqual([]);
  });

  it("includes a provider whose code comes from a suggestion (lookup is source-agnostic)", () => {
    // The grid passes a lookup that falls back to suggestions; the helper just
    // compares whatever the lookup returns.
    const cells = { "c:2026-06-02": "CALL" };
    const res = dedicatedColumnInitials(providers, dates, "CALL", lookup(cells));
    expect(res["2026-06-02"]).toEqual(["CC"]);
  });

  it("covers every requested date even with no matches anywhere", () => {
    const res = dedicatedColumnInitials(providers, ["2026-06-03"], "OR", lookup({}));
    expect(Object.keys(res)).toEqual(["2026-06-03"]);
  });
});
