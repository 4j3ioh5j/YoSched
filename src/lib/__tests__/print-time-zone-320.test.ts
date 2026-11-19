// Card #320: the printed {DATE} and {TIME} and the automatic version comment are in the Settings zone.
import { describe, it, expect } from "vitest";
import { renderPrintTemplate } from "../print-layout";
import { autoVersionComment } from "../auto-version";

const LA = "America/Los_Angeles";
const at = new Date("2026-01-15T07:59:00Z"); // 23:59 PST on the 14th

describe("print template in the zone", () => {
  it("{DATE} and {TIME} come from the same zoned instant, {TIME} carries the label", () => {
    process.env.TZ = "Asia/Tokyo"; // the printing computer's own zone must not matter
    const ctx = { year: 2026, month: 0, printedAt: at, dateFormat: "YYYY-MM-DD" as const, version: 3, zone: LA };
    expect(renderPrintTemplate("{DATE} {TIME}", ctx)).toBe("2026-01-14 23:59"); // card #368: no zone label
    expect(renderPrintTemplate("{DATE} {TIME}", { ...ctx, zone: "UTC" })).toBe("2026-01-15 07:59");
    process.env.TZ = "UTC";
  });
});

describe("automatic version comment", () => {
  it("says when, in the zone", () => {
    expect(autoVersionComment("print", at, "YYYY-MM-DD", LA)).toBe("Auto: printed 2026-01-14 23:59 PST");
    expect(autoVersionComment("export", at, "YYYY-MM-DD", LA, 2026)).toBe("Auto: exported 2026 on 2026-01-14 23:59 PST");
  });
});
