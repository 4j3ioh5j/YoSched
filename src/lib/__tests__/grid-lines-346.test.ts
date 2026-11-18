// Card #346: the faint grid line was 30% slate, so it took on whatever row tint sat behind
// it (lighter on weekends, amber under a holiday). It is now one solid color: the same 30%
// slate already mixed onto the page background, so it looks unchanged on a plain row.
import { describe, it, expect } from "vitest";
import { CELL_LINES } from "../grid-lines";

describe("faint grid line is solid (card #346)", () => {
  it("has no alpha, so a row tint cannot show through it", () => {
    const color = CELL_LINES.split(" ").find((c) => c.startsWith("border-") && c !== "border")!;
    expect(color).toBeDefined();
    expect(color).not.toMatch(/\/\d+$/);
  });
  it("mixes 30% slate-700 onto the page background", () => {
    expect(CELL_LINES).toBe("border border-[color-mix(in_srgb,var(--color-slate-700)_30%,var(--background))]");
  });
});
