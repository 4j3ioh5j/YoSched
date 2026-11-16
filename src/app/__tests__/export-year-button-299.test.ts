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

  it("opens the picker straight from the click (no await before runYearExport)", () => {
    const body = dialog.slice(dialog.indexOf("const onExport = () => {"), dialog.indexOf("runYearExport("));
    expect(body).not.toMatch(/await|\.then\(/);
  });
});

describe("Export year: Download instead (card #308)", () => {
  it("has a Download instead button that runs the export in download mode", () => {
    expect(dialog).toMatch(/>Download instead</);
    expect(dialog).toMatch(/onClick=\{\(\) => onExport\("download"\)\}/);
    expect(dialog).toMatch(/browserExportEnv\(\),\s*\{ mode \},/);
  });

  it("the folder hint names the protected folders", () => {
    expect(dialog).toMatch(/inside Downloads or Documents/);
  });

  it("Download instead also starts with no await before runYearExport", () => {
    const body = dialog.slice(dialog.indexOf("const onExport = ("), dialog.indexOf("runYearExport("));
    expect(body).not.toMatch(/await|\.then\(/);
  });
});
