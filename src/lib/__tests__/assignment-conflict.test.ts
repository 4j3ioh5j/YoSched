import { describe, it, expect } from "vitest";
import { parseAssignmentBase, classifyCasFailure, conflictItem } from "../assignment-conflict";

describe("parseAssignmentBase", () => {
  it("treats an absent baseUpdatedAt property as legacy (no check)", () => {
    expect(parseAssignmentBase({ staffId: "s", date: "2026-06-11", shiftTypeId: "x" })).toEqual({ kind: "legacy" });
  });

  it("treats a non-object as legacy", () => {
    expect(parseAssignmentBase(null)).toEqual({ kind: "legacy" });
    expect(parseAssignmentBase(undefined)).toEqual({ kind: "legacy" });
    expect(parseAssignmentBase("nope")).toEqual({ kind: "legacy" });
  });

  it("distinguishes explicit null (saw-empty) from an omitted property", () => {
    expect(parseAssignmentBase({ baseUpdatedAt: null })).toEqual({ kind: "check", base: null });
  });

  it("parses a valid ISO timestamp string into a Date", () => {
    const iso = "2026-06-11T15:04:05.123Z";
    const r = parseAssignmentBase({ baseUpdatedAt: iso });
    expect(r.kind).toBe("check");
    if (r.kind === "check") expect(r.base?.toISOString()).toBe(iso);
  });

  it("round-trips a millisecond-precision token exactly (TIMESTAMP(3))", () => {
    const iso = "2026-01-02T03:04:05.678Z";
    const r = parseAssignmentBase({ baseUpdatedAt: iso });
    expect(r.kind === "check" && r.base?.getTime()).toBe(new Date(iso).getTime());
  });

  it("rejects a malformed timestamp string as invalid (→ 400)", () => {
    const r = parseAssignmentBase({ baseUpdatedAt: "not-a-date" });
    expect(r.kind).toBe("invalid");
  });

  it("rejects a non-string, non-null baseUpdatedAt as invalid", () => {
    expect(parseAssignmentBase({ baseUpdatedAt: 123 }).kind).toBe("invalid");
    expect(parseAssignmentBase({ baseUpdatedAt: {} }).kind).toBe("invalid");
  });

  it("honors force:true on the object, overriding any baseUpdatedAt", () => {
    expect(parseAssignmentBase({ force: true })).toEqual({ kind: "force" });
    expect(parseAssignmentBase({ force: true, baseUpdatedAt: "2026-06-11T00:00:00.000Z" })).toEqual({ kind: "force" });
  });

  it("honors a batch-level force without a per-cell force flag", () => {
    expect(parseAssignmentBase({ baseUpdatedAt: "2026-06-11T00:00:00.000Z" }, { batchForce: true })).toEqual({ kind: "force" });
  });

  it("does not force when batchForce is false/absent", () => {
    expect(parseAssignmentBase({ baseUpdatedAt: null }, { batchForce: false }).kind).toBe("check");
  });
});

describe("classifyCasFailure", () => {
  it("classifies a missing row as gone (idempotent for delete, conflict for update — caller decides)", () => {
    expect(classifyCasFailure(null)).toBe("gone");
  });

  it("classifies a locked row as locked", () => {
    expect(classifyCasFailure({ isLocked: true })).toBe("locked");
  });

  it("classifies an existing unlocked row as conflict (changed underneath)", () => {
    expect(classifyCasFailure({ isLocked: false })).toBe("conflict");
  });
});

describe("conflictItem", () => {
  it("carries staffId, date and the current value for client cell-mapping", () => {
    expect(conflictItem("s1", "2026-06-11", { code: "ORC" })).toEqual({
      staffId: "s1",
      date: "2026-06-11",
      current: { code: "ORC" },
    });
  });

  it("represents a now-empty cell as current:null", () => {
    expect(conflictItem("s1", "2026-06-11", null)).toEqual({ staffId: "s1", date: "2026-06-11", current: null });
  });
});
