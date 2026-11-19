import { describe, it, expect } from "vitest";
import { renderPrintTemplate, footerLine, DEFAULT_PRINT_FOOTER } from "../print-layout";

// Card #368: the printed schedules (print, PDF, Excel) show {TIME} without the time zone.
const ctx = { month: 0, year: 2026, dateFormat: "YYYY-MM-DD", version: 3, zone: "America/Los_Angeles" } as const;

describe("{TIME} on printed schedules has no time zone (card #368)", () => {
  it("winter and summer: the zone's wall clock, no PST or PDT", () => {
    expect(renderPrintTemplate("{TIME}", { ...ctx, printedAt: new Date("2026-01-15T07:59:00Z") })).toBe("23:59");
    expect(renderPrintTemplate("{TIME}", { ...ctx, printedAt: new Date("2026-07-15T07:59:00Z") })).toBe("00:59");
  });
  it("the default footer line", () => {
    const line = footerLine(DEFAULT_PRINT_FOOTER.text, { ...ctx, printedAt: new Date("2026-01-15T07:59:00Z") });
    expect(line).toBe("2026-01-14 23:59 VER: 03 - YoSched");
    expect(line).not.toMatch(/P[SD]T|UTC/);
  });
});
