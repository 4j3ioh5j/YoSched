import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #76: the activation panel opened UNDER the shift's edit window (both z-50, panel first in
// the DOM), and Escape closed both. The panel must sit above every z-50 modal, and the shift
// section's Escape must leave the edit window alone while the panel is open.
describe("activation panel layering (card #76)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const panel = src.slice(src.indexOf("function ActivationPanel("), src.indexOf("function ShiftTypesSection("));
  it("the panel's overlay is above z-50", () => {
    const m = panel.match(/className="fixed inset-0 (z-\[?\d+\]?)/);
    expect(m).not.toBeNull();
    const z = Number(m![1].replace(/\D/g, ""));
    expect(z).toBeGreaterThan(50);
  });
  it("Escape doesn't cancel the edit window while the panel is open", () => {
    expect(src).toMatch(/useEscape\(\(\) => \{ if \(!activating\) cancelEdit\(\); \}\);/);
  });
});
