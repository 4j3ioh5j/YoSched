import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #81: hover outlines the staff header and the date; selection keeps the solid fill.
const src = readFileSync(join(__dirname, "../../app/schedule-grid.tsx"), "utf8");

describe("schedule hover outline (card #81)", () => {
  it("defines an outline-only hover style", () => {
    expect(src).toMatch(/const HOVER_OUTLINE: React\.CSSProperties = \{ boxShadow: "inset 0 0 0 2px #[0-9a-f]{6}" \}/);
  });

  it("staff header: selected = solid fill, hover = outline (never the solid fill)", () => {
    expect(src).toContain('style={isActiveCol ? { backgroundColor: "rgba(29,78,216,0.7)" } : hoverCol === p.id ? HOVER_OUTLINE : undefined}');
    expect(src).not.toMatch(/isActiveCol \|\| hoverCol === p\.id/);
  });

  it("date cell gets the outline on hover unless it is the selected date", () => {
    expect(src).toContain("...(!isActiveRow && hoverRow === date ? HOVER_OUTLINE : null)");
  });

  it("staff cells, dedicated cells and the date cell set and clear the hovered date", () => {
    const sets = src.match(/setHoverRow\(date\)/g) ?? [];
    const clears = src.match(/setHoverRow\(null\)/g) ?? [];
    expect(sets.length).toBe(3);
    expect(clears.length).toBe(3);
  });
});
