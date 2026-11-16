import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Card #301: Settings for the printed schedule's header/footer, table font and the
// DATE/DAY columns. The values and the PUT are unit-tested elsewhere (print-layout lib,
// print-layout-301 route test); these checks pin how the settings page wires them.

const DIR = path.resolve(__dirname, "..");
const ui = readFileSync(path.join(DIR, "settings-page.tsx"), "utf8");
const page = readFileSync(path.join(DIR, "page.tsx"), "utf8");

function fnBody(name: string): string {
  const i = ui.search(new RegExp(`function ${name}[(<]`));
  expect(i, name).toBeGreaterThan(-1);
  const next = ui.indexOf("\nfunction ", i + 10);
  return ui.slice(i, next === -1 ? undefined : next);
}

describe("settings page gets the saved print layout", () => {
  it("page.tsx reads it with printLayoutFrom", () => {
    expect(page).toContain("printLayout: printLayoutFrom(schedulingPrefsRow)");
  });
});

describe("sections and where they sit", () => {
  it("Header & Footer and Table Font are in the Printed Schedule group; Date Columns sits with the date format", () => {
    const printed = ui.slice(ui.indexOf('<SectionGroup label="Printed Schedule" />'), ui.indexOf('<SectionGroup label="Calendar" />'));
    expect(printed).toContain("<PrintHeaderFooterSection initial={schedulingPrefs.printLayout} />");
    expect(printed).toContain("<PrintFontSection initial={schedulingPrefs.printLayout} />");
    const general = ui.slice(ui.indexOf('<SectionGroup label="General & System" />'));
    expect(general).toContain("<DateColumnsSection initial={schedulingPrefs.printLayout} />");
  });
});

describe("each section saves, cancels and resets from the last SAVED value", () => {
  for (const name of ["PrintHeaderFooterSection", "PrintFontSection", "DateColumnsSection"]) {
    it(`${name}`, () => {
      const body = fnBody(name);
      expect(body).toContain("useSavedDraft(");
      expect(body).toMatch(/>Save</);
      expect(body).toMatch(/>Cancel</);
      expect(body).toMatch(/>Reset to default</);
      // Cancel goes back to the saved value, not the page-load prop.
      expect(body).toContain("onClick={() => setDraft(saved)}");
      // Inputs lock while a save is in flight, so a late result never lands over typing.
      expect(body).toMatch(/disabled=\{!canEdit \|\| busy\}/);
    });
  }

  it("the shared hook adopts a value only after the server accepted it", () => {
    const hook = fnBody("useSavedDraft");
    const ok = hook.indexOf("if (!res.ok)");
    const adopt = hook.indexOf("setSaved(next)");
    expect(ok).toBeGreaterThan(-1);
    expect(adopt).toBeGreaterThan(ok);
    expect(hook).toContain('fetch("/api/settings/scheduling-preferences"');
  });
});

describe("what each section sends", () => {
  it("Header & Footer sends whole validated blocks; Reset stores null (the built-in default)", () => {
    const body = fnBody("PrintHeaderFooterSection");
    expect(body).toContain("printHeader: draft.header, printFooter: draft.footer");
    expect(body).toContain("printHeader: null, printFooter: null");
    expect(body).toContain("validatePrintBlock(draft.header).ok && validatePrintBlock(draft.footer).ok");
  });

  it("the footer preview shows the fixed ' - YoSched' ending", () => {
    const body = fnBody("PrintHeaderFooterSection");
    expect(body).toContain("footerLine(draft.footer.text, previewCtx)");
    expect(body).toContain("YOSCHED_FOOTER_SUFFIX");
  });

  it("Table Font sends family, size and the PP-label switch", () => {
    const body = fnBody("PrintFontSection");
    expect(body).toContain("printFontFamily: draft.fontFamily, printFontSize: draft.fontSize, printPayPeriodLabels: draft.payPeriodLabels");
    expect(body).toContain("validatePrintFontFamily(draft.fontFamily) && validatePrintFontSize(draft.fontSize)");
  });

  it("Date Columns sends the split switch and both formats, offering every format", () => {
    const body = fnBody("DateColumnsSection");
    expect(body).toContain("splitDateDayColumns: draft.splitDateDay, dateColumnFormat: draft.dateColumnFormat, dayColumnFormat: draft.dayColumnFormat");
    expect(body).toContain("DATE_COLUMN_FORMATS.map(");
    expect(body).toContain("DAY_COLUMN_FORMATS.map(");
  });
});
