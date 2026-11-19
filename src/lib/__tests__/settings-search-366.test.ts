import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { searchSettings, dedupeSettingsEntries, normalizeSearchText, type SettingsSearchEntry } from "../settings-search";

// Card #366: a search box at the top of Settings that jumps to any control.

let n = 0;
function e(label: string, section: string, extra: Partial<SettingsSearchEntry> = {}): SettingsSearchEntry {
  return { key: `k${n++}`, sectionId: section.toLowerCase().replace(/\W+/g, "-"), section, group: "Printed Schedule", label, desc: "", kind: "control", order: n, ...extra };
}

const ENTRIES: SettingsSearchEntry[] = [
  e("Table Font", "Table Font", { kind: "section", desc: "The font of the printed schedule." }),
  e("Font", "Table Font", { desc: "Letters, digits, spaces and hyphens." }),
  e("Size", "Table Font", { desc: "Points, 6 to 14." }),
  e("Weekend", "Scheduler tuning", { group: "Scheduling Engine", desc: "The two days counted as the weekend: weekend hours and weekend shading." }),
  e("Day shading", "Day Shading", { kind: "section" }),
  e("Footer font size", "Header and Footer"),
  e("Time zone", "Time Zone", { kind: "section", group: "General & System" }),
];

const labels = (q: string) => searchSettings(ENTRIES, q).map((r) => `${r.label} | ${r.section}`);

describe("normalizeSearchText", () => {
  it("lowercases, folds accents and curly quotes, and squeezes spaces", () => {
    expect(normalizeSearchText("  YoSched’s  Café\tFONT ")).toBe("yosched's cafe font");
  });
});

describe("searchSettings", () => {
  it("returns nothing for an empty or blank query", () => {
    expect(searchSettings(ENTRIES, "")).toEqual([]);
    expect(searchSettings(ENTRIES, "   ")).toEqual([]);
  });

  it("matches word starts, ignoring case, so 'fo' finds Font and Footer but not 'Info'", () => {
    const got = labels("FO");
    expect(got).toContain("Font | Table Font");
    expect(got).toContain("Footer font size | Header and Footer");
    expect(searchSettings([e("Info", "About")], "fo")).toEqual([]);
  });

  it("ranks an exact label first, then labels that start with the query, then the rest", () => {
    expect(labels("font")[0]).toBe("Font | Table Font");
    expect(labels("font").indexOf("Table Font | Table Font")).toBeGreaterThan(0);
  });

  it("needs every word, which may come from the label and the section together", () => {
    expect(labels("font size")).toEqual(["Footer font size | Header and Footer", "Size | Table Font"]);
    expect(labels("font zebra")).toEqual([]);
  });

  it("finds a control by its description, below label matches", () => {
    const got = labels("shading");
    expect(got[0]).toBe("Day shading | Day Shading");
    expect(got).toContain("Weekend | Scheduler tuning");
  });

  it("keeps page order among equal scores and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => e(`Column ${i}`, "Columns"));
    const got = searchSettings(many, "column");
    expect(got).toHaveLength(12);
    expect(got.map((r) => r.label)).toEqual(many.slice(0, 12).map((r) => r.label));
    expect(searchSettings(many, "column", 5)).toHaveLength(5);
  });
});

describe("dedupeSettingsEntries", () => {
  it("keeps the first entry for the same label in the same section, and skips blank labels", () => {
    const a = e("Font", "Table Font");
    const b = e("font ", "Table Font");
    const c = e("Font", "Header and Footer");
    const blank = e("   ", "Table Font");
    expect(dedupeSettingsEntries([a, b, c, blank])).toEqual([a, c]);
  });

  it("drops a control whose label only repeats its section's title", () => {
    const sec = e("Time Zone", "Time Zone", { kind: "section" });
    const ctl = e("Time zone", "Time Zone");
    expect(dedupeSettingsEntries([sec, ctl])).toEqual([sec]);
  });
});

// Wiring: the page builds the list from what it shows, so a new control is found with no list to update.
const ui = readFileSync(path.resolve(__dirname, "../../app/settings/settings-page.tsx"), "utf8");
const box = readFileSync(path.resolve(__dirname, "../../app/settings/settings-search.tsx"), "utf8");

describe("Settings page wiring", () => {
  it("marks every section, its body, and every field row for the index", () => {
    const sec = ui.slice(ui.indexOf("function CollapsibleSection("), ui.indexOf("\n}\n", ui.indexOf("function CollapsibleSection(")));
    expect(sec).toContain("data-settings-section={id}");
    expect(sec).toContain("data-section-title={title}");
    expect(sec).toContain("data-settings-body");
    const row = ui.slice(ui.indexOf("function FieldRow("), ui.indexOf("\n}\n", ui.indexOf("function FieldRow(")));
    expect(row).toContain("data-search-label={label}");
    expect(row).toContain("data-search-desc={description}");
    expect(ui).toContain("data-settings-group={label}");
  });

  it("can open a collapsed section without toggling an open one shut", () => {
    expect(ui).toMatch(/open: \(id: string\) => void;/);
    expect(ui).toContain("if (!store.snap.has(id)) return;");
  });

  it("puts the search box in the sticky header", () => {
    const header = ui.slice(ui.indexOf('<h1 className="text-xl font-semibold text-slate-100">Settings</h1>'), ui.indexOf("<CollapseToolbar />"));
    expect(header).toContain("<SettingsSearchBox />");
  });

  it("indexes sections, field rows, labels, subheadings and named controls, but not dialogs", () => {
    expect(box).toContain('"[data-settings-section]"');
    expect(box).toContain('"[data-search-label], label, h3, input[aria-label], select[aria-label], textarea[aria-label]"');
    expect(box).toContain('closest(\'[role="dialog"], .fixed\')');
  });

  it("opens the section, then scrolls to the control (or the section if the control is still hidden) and focuses it", () => {
    expect(box).toMatch(/openSection\(hit\.sectionId\)/);
    expect(box).toContain('scrollIntoView({ block: "center"');
    expect(box).toContain("focus({ preventScroll: true })");
    expect(box).toContain("data-search-flash");
  });

  it("supports the keyboard: / to focus, arrows to move, Enter to jump, Escape to close", () => {
    for (const k of ['"/"', '"ArrowDown"', '"ArrowUp"', '"Enter"', '"Escape"']) expect(box).toContain(k);
  });
});

describe("labels that print a description inside them", () => {
  it("take the first block of text as the name and the rest as the description", () => {
    expect(box).toContain("function splitText(el: Element)");
    expect(box).toContain("last.parent === n.parentNode");
    expect(box).toContain("desc: groups.slice(1)");
  });
});

describe("arrow keys past the dropdown's edge", () => {
  it("scroll the highlighted result into view", () => {
    expect(box).toContain('document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" })');
  });
});
