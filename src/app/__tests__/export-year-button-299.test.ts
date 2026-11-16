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

describe("Export year: Export downloads, the folder picker is optional (card #308)", () => {
  it("Export and Enter download both files (Chrome's own Save As reaches every folder)", () => {
    expect(dialog).toMatch(/onClick=\{\(\) => onExport\(\)\}[^>]*>Export</);
    expect(dialog).toMatch(/const onExport = \(mode: "auto" \| "download" = "download"\)/);
    expect(dialog).toMatch(/browserExportEnv\(\),\s*\{ mode \},/);
  });

  it("Save to a folder… is the optional picker, shown only where one exists", () => {
    expect(dialog).toMatch(/\{hasPicker && \(\s*<button[^>]*onClick=\{\(\) => onExport\("auto"\)\}[^>]*>Save to a folder…</);
    expect(dialog).not.toMatch(/>Download instead</);
  });

  it("the hint says where downloads go and how to choose the folder", () => {
    expect(dialog).toMatch(/Ask where to save each file/);
  });

  it("no await before runYearExport", () => {
    const body = dialog.slice(dialog.indexOf("const onExport = ("), dialog.indexOf("runYearExport("));
    expect(body).not.toMatch(/await|\.then\(/);
  });
});
