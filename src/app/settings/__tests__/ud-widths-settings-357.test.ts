import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { udInchesToHundredths, udColumnChoice, udSetColumnChoice, udParseDraft } from "../settings-page";

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

// Card #359: each column's current width is shown on the Column Widths section, in every choice.
describe("Column Widths shows each column's width (card #359)", () => {
  const grid = readFileSync(path.join(path.resolve(__dirname, "../.."), "schedule-grid.tsx"), "utf8");
  it("the schedule page records the measured widths once the text is measured", () => {
    expect(grid).toMatch(/if \(!udMeasured\) return;\s*saveUdWidthSnapshot\(buildUdWidthSnapshot\(firstOfMonth\.slice\(0, 7\), udPrint\.widths, udPrint\.bestFitIn, udPrint\.titleIn\)\)/);
  });
  it("Settings reads them after mount (never in useState init) and on another tab's change", () => {
    expect(body).toContain("useState<UdWidthSnapshot | null>(null)");
    expect(body).toMatch(/useEffect\(\(\) => \{[\s\S]*?setWidthsNow\(loadUdWidthSnapshot\(\)\)[\s\S]*?addEventListener\("storage"/);
  });
  it("every column row shows its width now and its best fit, outside the per-column choice too", () => {
    expect(body).toContain("data-ud-width-now");
    expect(body).toContain("data-ud-best-fit");
    // the column list is not gated on the per-column choice
    expect(body).not.toMatch(/shown\.mode === "perColumn" && \(\s*columns\.length === 0/);
  });
});

// Card #360: in the per-column choice, each column picks Best fit or a set width.
describe("per-column choice: Best fit or Custom on each column (card #360)", () => {
  const saved = { mode: "perColumn" as const, uniformHundredths: 50, perColumn: { "ded:icu": 40 } };
  const cols = [{ key: "agg:other", label: "OTHER" }, { key: "ded:icu", label: "ICU" }, { key: "ded:card", label: "CARD" }];
  it("a column with no width is Best fit; choosing Custom pre-fills, Best fit removes the width", () => {
    let per: Record<string, string> = { "ded:icu": "0.40" };
    expect(udColumnChoice(per, "agg:other")).toBe("bestFit");
    expect(udColumnChoice(per, "ded:icu")).toBe("custom");
    per = udSetColumnChoice(per, "agg:other", "custom", "0.62");
    expect(per["agg:other"]).toBe("0.62");
    expect(udColumnChoice(per, "agg:other")).toBe("custom");
    // choosing Custom again keeps what was typed
    expect(udSetColumnChoice({ "ded:icu": "0.55" }, "ded:icu", "custom", "0.30")["ded:icu"]).toBe("0.55");
    per = udSetColumnChoice(per, "ded:icu", "bestFit", "");
    expect("ded:icu" in per).toBe(false);
  });
  it("any mix saves: Best fit columns store no width, Custom ones store theirs", () => {
    const r = udParseDraft({ mode: "perColumn", uniform: "0.50", per: { "ded:card": "0.75" } }, saved, cols);
    expect(r).toEqual({ value: { mode: "perColumn", uniformHundredths: 50, perColumn: { "ded:card": 75 } } });
  });
  it("Custom with an empty or bad width cannot be saved", () => {
    for (const bad of ["", "  ", "3", "abc"]) {
      const r = udParseDraft({ mode: "perColumn", uniform: "0.50", per: { "agg:other": bad } }, saved, cols);
      expect("problem" in r && r.problem).toMatch(/^OTHER: enter a width .* or choose Best fit\.$/);
    }
  });
  it("another choice keeps the saved per-column widths for later", () => {
    const r = udParseDraft({ mode: "uniform", uniform: "0.60", per: { "ded:icu": "" } }, saved, cols);
    expect(r).toEqual({ value: { mode: "uniform", uniformHundredths: 60, perColumn: { "ded:icu": 40 } } });
  });
  it("each row has a Best fit / Custom control; the box shows only for Custom", () => {
    expect(body).toContain("data-ud-col-choice");
    expect(body).toMatch(/choice === "custom" && \(/);
    expect(body).not.toContain('placeholder="best fit"');
    const choices = ui.slice(ui.indexOf("const UD_MODE_CHOICES"), ui.indexOf("];", ui.indexOf("const UD_MODE_CHOICES")));
    expect(choices).toContain("Choose per column (best fit or a set width)");
  });
});

// Card #364: a width the user sets that is narrower than a column's title is flagged.
import { udSetWidthHundredths } from "../settings-page";
describe("warning when a set width is narrower than the title (card #364)", () => {
  it("the width that applies to a column: one width for all, its Custom width, else none", () => {
    expect(udSetWidthHundredths({ mode: "uniform", uniform: "0.40", per: {} }, "agg:o")).toBe(40);
    expect(udSetWidthHundredths({ mode: "perColumn", uniform: "0.50", per: { "agg:o": "0.35" } }, "agg:o")).toBe(35);
    expect(udSetWidthHundredths({ mode: "perColumn", uniform: "0.50", per: {} }, "agg:o")).toBeNull();
    expect(udSetWidthHundredths({ mode: "perColumn", uniform: "0.50", per: { "agg:o": "abc" } }, "agg:o")).toBeNull();
    expect(udSetWidthHundredths({ mode: "bestFit", uniform: "0.30", per: { "agg:o": "0.30" } }, "agg:o")).toBeNull();
    expect(udSetWidthHundredths({ mode: "matchLargest", uniform: "0.30", per: {} }, "agg:o")).toBeNull();
  });
  it("each column row shows the warning with the title's width, from the measured title", () => {
    expect(body).toMatch(/udNarrowerThanTitle\(udSetWidthHundredths\(shown, c\.key\), now\?\.titleIn\)/);
    expect(body).toContain("data-ud-title-warning");
    expect(body).toMatch(/narrower than its title/);
  });
});

describe("one width for all warns with the width every column prints at (card #364 r1)", () => {
  it("the warning names the floor that applies: the widest title for one width, its own for Custom", () => {
    expect(body).toMatch(/udTitleFloorIn\(shown\.mode, c\.key, widthsNow\?\.cols \?\? \{\}\)/);
    expect(body).toMatch(/Every column prints at \{titleWarn\.at\} in so all titles fit\./);
  });
});
