import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gridModalOpen } from "@/lib/grid-modal-guard";

// Card #299 r1 (Codex BLOCKED): with the Export year dialog open, Tab opened the shift
// picker and Delete cleared the selected cell behind it. One predicate now covers every
// modal, and every grid keyboard/clipboard handler checks it.

describe("grid modal guard (card #299)", () => {
  it("any open modal suppresses the grid's keys", () => {
    const none = { showVersions: false, showAlerts: false, showHelp: false, showExport: false };
    expect(gridModalOpen(none)).toBe(false);
    for (const k of Object.keys(none)) expect(gridModalOpen({ ...none, [k]: true }), k).toBe(true);
  });

  it("the keydown, copy and paste handlers return early while a modal is open", () => {
    const grid = readFileSync(join(__dirname, "../schedule-grid.tsx"), "utf8");
    expect(grid).toMatch(/const modalOpen = gridModalOpen\(\{ showVersions, showAlerts, showHelp, showExport \}\)/);
    for (const [start, end] of [["function onKeyDown(", 'document.addEventListener("keydown", onKeyDown)'], ["function onCopy(", 'document.addEventListener("copy", onCopy)'], ["async function onPaste(", 'document.addEventListener("paste", onPaste)']]) {
      const i = grid.indexOf(start);
      expect(i, start).toBeGreaterThan(-1);
      const body = grid.slice(i, grid.indexOf(end, i));
      expect(body, start).toMatch(/if \([^)]*\bmodalOpen\b[^)]*\) return;/);
      const deps = grid.slice(grid.indexOf(end, i), grid.indexOf("]);", grid.indexOf(end, i)));
      expect(deps, start).toMatch(/\bmodalOpen\b/);
    }
    // No handler still lists the modals one by one (a new modal would be missed again).
    expect(grid).not.toMatch(/showVersions \|\| showAlerts \|\| showHelp/);
  });
});
