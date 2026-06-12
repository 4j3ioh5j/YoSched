import { describe, it, expect } from "vitest";
import { describeConflict, conflictTitle } from "../conflict-format";

describe("describeConflict", () => {
  it("names the new shift code and the updater", () => {
    expect(describeConflict({ staff: "AB", date: "2026-06-11", code: "ORC", by: "Dana" })).toBe("AB · 2026-06-11 — now ORC (by Dana)");
  });

  it("falls back to 'someone else' when unattributed", () => {
    expect(describeConflict({ staff: "AB", date: "2026-06-11", code: "ORC", by: null })).toBe("AB · 2026-06-11 — now ORC (by someone else)");
  });

  it("says 'now empty' when the cell was cleared", () => {
    expect(describeConflict({ staff: "CD", date: "2026-06-12", code: null, by: "Dana" })).toBe("CD · 2026-06-12 — now empty (by Dana)");
  });
});

describe("conflictTitle", () => {
  it("is singular for one cell", () => {
    expect(conflictTitle(1)).toBe("This cell changed underneath you");
  });

  it("is plural with a count for many", () => {
    expect(conflictTitle(3)).toBe("3 cells changed underneath you");
  });
});
