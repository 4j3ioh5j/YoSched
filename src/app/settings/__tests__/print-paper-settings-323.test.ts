import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { marginInchesText, parseMarginInches } from "../settings-page";

// Card #323: Settings › Printed Schedule › Paper & Margin.
const ui = readFileSync(path.join(path.resolve(__dirname, ".."), "settings-page.tsx"), "utf8");

describe("Paper & Margin section", () => {
  it("sits in the Printed Schedule group and saves both fields", () => {
    const printed = ui.slice(ui.indexOf('<SectionGroup label="Printed Schedule" />'), ui.indexOf('<SectionGroup label="Calendar" />'));
    expect(printed).toContain("<PrintPaperSection initial={schedulingPrefs.printLayout} />");
    const i = ui.indexOf("function PrintPaperSection(");
    const body = ui.slice(i, ui.indexOf("\nfunction ", i + 10));
    expect(body).toMatch(/printPaperSize: draft\.paper, printMarginHundredthsIn: /);
    expect(body).toMatch(/PRINT_PAPERS\.map/);
    expect(body).toMatch(/printFit\(/); // the shrink note
  });
  it("margin text ↔ hundredths", () => {
    expect(marginInchesText(25)).toBe("0.25");
    expect(marginInchesText(100)).toBe("1.00");
    expect(parseMarginInches("0.25")).toBeNull(); // card #556: under the 0.5in floor
    expect(parseMarginInches("0.50")).toBe(50);
    expect(parseMarginInches("1")).toBe(100);
    expect(parseMarginInches(".5")).toBe(50);
    expect(parseMarginInches("0.333")).toBeNull();
    expect(parseMarginInches("0.2")).toBeNull();
    expect(parseMarginInches("1.01")).toBeNull();
    expect(parseMarginInches("abc")).toBeNull();
    expect(parseMarginInches("")).toBeNull();
  });
});
