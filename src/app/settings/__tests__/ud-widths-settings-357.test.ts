import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { udInchesToHundredths } from "../settings-page";

// Card #357: Settings › Printed Schedule › Column Widths.
const ui = readFileSync(path.join(path.resolve(__dirname, ".."), "settings-page.tsx"), "utf8");
const i = ui.indexOf("function UdColumnWidthSection(");
const body = ui.slice(i, ui.indexOf("\nfunction ", i + 10));

describe("Column Widths section", () => {
  it("sits in the Printed Schedule group, right after Column Order, from the saved choice", () => {
    const printed = ui.slice(ui.indexOf('<SectionGroup label="Printed Schedule" />'), ui.indexOf('<SectionGroup label="Calendar" />'));
    expect(printed).toMatch(/<SpecialColumnOrderSection[\s\S]*?\/>\s*<UdColumnWidthSection\s+initial=\{schedulingPrefs\.printLayout\.udWidth\}/);
    expect(body).toContain("useState<UdWidthSettings>(initial)");
    expect(body).toContain("const shown = draft ?? udDraftFrom(saved);");
  });
  it("offers the four choices, best fit first (the default)", () => {
    const choices = ui.slice(ui.indexOf("const UD_MODE_CHOICES"), ui.indexOf("];", ui.indexOf("const UD_MODE_CHOICES")));
    expect([...choices.matchAll(/mode: "(\w+)"/g)].map((m) => m[1])).toEqual(["bestFit", "matchLargest", "uniform", "perColumn"]);
    expect(choices).toContain("(Default)");
  });
  it("saves the three fields the API validates, with Cancel and Reset to default", () => {
    expect(body).toContain("printUdWidthMode: value.mode, printUdWidthHundredths: value.uniformHundredths, printUdColumnWidths: value.perColumn");
    expect(body).toContain('onClick={() => setDraft(null)}');
    expect(body).toContain("put({ ...DEFAULT_UD_WIDTH, perColumn: {} })");
    // the per-column list covers additional and shift columns, keyed like Column Order
    expect(body).toContain('specialColumnKey("agg", c.id)');
    expect(body).toContain('specialColumnKey("ded", st.id)');
  });
  it("inches text ↔ hundredths, inside 0.20–2.00", () => {
    expect(udInchesToHundredths("0.20")).toBe(20);
    expect(udInchesToHundredths("2")).toBe(200);
    expect(udInchesToHundredths(".75")).toBe(75);
    expect(udInchesToHundredths(" 1.5 ")).toBe(150);
    for (const bad of ["0.19", "2.01", "0.333", "abc", "", ".", "-1", "1e1"]) expect(udInchesToHundredths(bad)).toBeNull();
  });
});
