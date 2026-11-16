import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #307: every field that holds a decimal (hours, FTE, weights) uses the shared
// DecimalField, so 0.2, 0.20, .4 and 00.45 can be typed and are shown back unrounded.

const src = (p: string) => readFileSync(join(__dirname, "..", "..", "..", p), "utf8");
const settings = src("src/app/settings/settings-page.tsx");
const staff = src("src/app/staff/staff-page.tsx");
const picker = src("src/app/equity/controls/StaffPicker.tsx");

describe("decimal fields use DecimalField (card #307)", () => {
  it("print column rules: FTE is a fraction, typed and shown unrounded", () => {
    expect(settings).not.toMatch(/Math\.round\(f \* 100\)/);
    expect(settings).not.toMatch(/parsePct|pctVal/);
    expect(settings).toMatch(/aria-label="Minimum FTE"/);
    expect(settings).toMatch(/aria-label="Maximum FTE"/);
    expect(settings).not.toMatch(/FTE %:/);
  });

  it("shift hours, hours per pay period and equity weight lose no keystrokes", () => {
    expect(settings).not.toMatch(/parseFloat\(e\.target\.value\) \|\| 0/);
    expect(settings).not.toMatch(/parseFloat\(e\.target\.value\) \|\| 80/);
    expect(settings).not.toMatch(/parseFloat\(e\.target\.value\) \|\| 1\b/);
    for (const label of ["Hours per shift on weekdays", "Hours per shift on weekends", "Hours per shift on holidays", "Hours per pay period", "Factor weight"]) {
      expect(settings, label).toMatch(new RegExp(`<DecimalField[^>]*aria-label="${label}"`));
    }
  });

  it("scheduler tuning boxes are text boxes with the decimal keypad (no step to trip on)", () => {
    const block = settings.slice(settings.indexOf("TUNING_FIELDS.map("), settings.indexOf("TUNING_FIELDS.map(") + 1200);
    expect(block).not.toMatch(/type="number"/);
    expect(block).toMatch(/inputMode="decimal"/);
  });

  it("staff FTE, fixed hours and hour overrides use DecimalField", () => {
    expect(staff).toMatch(/<DecimalField[^>]*aria-label="FTE"/);
    expect(staff).toMatch(/<DecimalField[^>]*aria-label="Hours per pay period"/);
    expect((staff.match(/<DecimalField/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(staff).not.toMatch(/step="0\.5"/);
  });

  it("equity Min FTE uses DecimalField", () => {
    expect(picker).toMatch(/<DecimalField/);
    expect(picker).not.toMatch(/parseFloat\(raw\) \|\| null/);
  });

  it("no decimal field is left as a raw type=number box", () => {
    // Whole-number fields (counts, days, ports, point sizes) may stay type="number".
    for (const [name, text] of [["settings", settings], ["staff", staff], ["picker", picker]] as const) {
      for (const m of text.matchAll(/type="number"[\s\S]{0,400}?onChange=\{[^\n]*/g)) {
        expect(m[0], `${name}: ${m[0].slice(0, 200)}`).not.toMatch(/parseFloat|Number\(|valueAsNumber[^\n]*\/ ?100/);
      }
    }
  });
});
