import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Card #299: the Export year button exports the SAVED schedule and is off in Live.
const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
const dialog = readFileSync(join(__dirname, "../export-year-dialog.tsx"), "utf8");

describe("Export year button (card #299)", () => {
  it("is disabled in Live and the dialog never mounts in Live", () => {
    expect(grid).toMatch(/onClick=\{\(\) => setShowExport\(true\)\}\s*disabled=\{liveMode\}/);
    expect(grid).toMatch(/\{showExport && !liveMode && \(/);
  });

  it("snapshots the saved assignments, not the Live display map", () => {
    const snap = grid.slice(grid.indexOf("<ExportYearDialog"), grid.indexOf("onClose={() => setShowExport(false)}"));
    expect(snap).toMatch(/localAssignments\.map/);
    expect(snap).not.toMatch(/effectiveAssignmentMap|liveDisplayMap|liveOutcome/);
  });

  // The "no await before runYearExport" pin protected the folder picker's user activation;
  // the picker is gone (card #311) and Export now awaits the version save first (card #312).
  it("the only wait before the downloads is the version save (card #312)", () => {
    const body = dialog.slice(dialog.indexOf("const onExport = () => {"), dialog.indexOf("runYearExport("));
    expect(body.match(/await /g)).toEqual(["await ", "await "]); // prepare(year), then runYearExport itself
    expect(body.endsWith("await ")).toBe(true);
    expect(body).toContain("await prepare(year)");
  });
});

describe("Export year: Export downloads; no folder button (cards #308, #311)", () => {
  it("Export and Enter download both files (Chrome's own Save As reaches every folder)", () => {
    expect(dialog).toMatch(/onClick=\{\(\) => onExport\(\)\}[^>]*>Export</);
    expect(dialog).toMatch(/const onExport = \(\) => \{/);
  });

  it("there is no folder button and no folder picker (card #311)", () => {
    expect(dialog).not.toMatch(/Save to a folder|hasPicker|showDirectoryPicker|>Download instead</);
  });

  it("the hint says where downloads go and how to choose the folder", () => {
    expect(dialog).toMatch(/Ask where to save each file/);
  });

  it("no .then chains before runYearExport", () => {
    const body = dialog.slice(dialog.indexOf("const onExport = ("), dialog.indexOf("runYearExport("));
    expect(body).not.toMatch(/\.then\(/);
  });
});
