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

// Card #77: the panel used to close on "Turn on" and the save ran behind it, so the edit window
// flashed back (long enough to press Save again) and then closed by itself.
describe("activation panel save flow (card #77)", () => {
  const src = readFileSync(join(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
  const panel = src.slice(src.indexOf("function ActivationPanel("), src.indexOf("function ShiftTypesSection("));
  it("the parent closes the panel only after the save succeeded, never before awaiting it", () => {
    expect(src).toMatch(/const err = await saveShift\(activating, c\);\s*if \(!err\) setActivating\(null\);\s*return err;/);
    expect(src).not.toMatch(/setActivating\(null\); void saveShift\(/);
  });
  it("saveShift reports failure to the panel", () => {
    expect(src).toMatch(/async function saveShift\(shift: ShiftType, activation\?: ActivationChoice\): Promise<string \| null>/);
    expect(src).toMatch(/setStatus\("error"\);\s*return msg;/);
  });
  it("while saving: Turn on and Cancel are disabled, Escape is ignored, the error is shown on failure", () => {
    expect(panel).toMatch(/disabled=\{!data \|\| saving\}/);
    expect(panel).toMatch(/onClick=\{onCancel\} disabled=\{saving\}/);
    expect(panel).toMatch(/useEscape\(\(\) => \{ if \(!saving\) onCancel\(\); \}\);/);
    expect(panel).toMatch(/if \(err\) \{ setSaveError\(err\); setSaving\(false\); \}/);
    expect(panel).toMatch(/\{saveError && /);
  });
  it("opens at its full size while loading (no small window that then grows)", () => {
    expect(panel).toMatch(/min-h-\[\d+rem\]/);
  });
});
