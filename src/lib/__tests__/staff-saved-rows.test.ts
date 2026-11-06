import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SavedRows } from "../staff-saved-rows";

// Card #25: Cancel after a save in the same visit used to restore the PAGE-LOAD row.
type Row = { id: string; initials: string; ftePercentage: number };
const AB: Row = { id: "s1", initials: "AB", ftePercentage: 1 };

describe("SavedRows — what Cancel / Undo restore", () => {
  it("save, edit again, Cancel → the just-saved row, not the page-load one", () => {
    const saved = new SavedRows([AB]);
    const afterSave = { ...AB, ftePercentage: 0.8 };
    saved.remember(afterSave); // the save succeeded
    // the user opens the row again, types 0.5, presses Cancel:
    expect(saved.get("s1")).toEqual(afterSave);
  });

  it("an unsaved draft never becomes the saved row", () => {
    const saved = new SavedRows([AB]);
    const draft = { ...AB, ftePercentage: 0.5 }; // edited, not saved
    void draft;
    expect(saved.get("s1")).toEqual(AB);
  });

  it("Undo of a save writes the previous saved row back and it becomes the saved row again", () => {
    const saved = new SavedRows([AB]);
    const prev = saved.get("s1")!;
    saved.remember({ ...AB, ftePercentage: 0.8 });
    saved.remember(prev); // Undo's PUT succeeded
    expect(saved.get("s1")).toEqual(AB);
  });

  it("a row added this visit has a saved version (Cancel works on it); a removed one has none", () => {
    const saved = new SavedRows<Row>([]);
    saved.remember({ id: "n1", initials: "NEW", ftePercentage: 1 });
    expect(saved.get("n1")?.initials).toBe("NEW");
    saved.forget("n1");
    expect(saved.get("n1")).toBeUndefined();
  });
});

describe("the Staff page restores from saved rows, never the page-load props (card #25)", () => {
  const src = readFileSync(join(__dirname, "../../app/staff/staff-page.tsx"), "utf8");
  it("no handler looks rows up in the page-load `initial` list", () => {
    expect(src).not.toMatch(/\binitial\.find\(/);
  });
  it("Cancel, the save's previous row and delete's Undo row come from savedRows", () => {
    expect(src).toMatch(/const orig = savedRows\.current\.get\(editingId\)/);
    expect(src).toMatch(/const prev = savedRows\.current\.get\(member\.id\)/);
    expect(src).toMatch(/const member = savedRows\.current\.get\(id\)/);
    expect(src).toMatch(/remember\(member\);/);
  });
  it("every Undo updates the saved rows only after the server accepted it (Codex #362 WARNING)", () => {
    // In every Undo callback, each remember()/forget() has `if (!res?.ok) return;` between it and
    // the fetch that precedes it.
    const starts = [...src.matchAll(/execute: async \(\) => \{/g)].map((m) => m.index!);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    let checked = 0;
    for (const st of starts) {
      const end = Math.min(...["} finally", "\n  async function", "\n  function "].map((t) => src.indexOf(t, st)).filter((n) => n > st));
      const body = src.slice(st, end); // just this Undo callback
      for (const m of body.matchAll(/remember\(|savedRows\.current\.forget\(/g)) {
        const before = body.slice(0, m.index);
        const lastFetch = before.lastIndexOf("fetch(");
        expect(lastFetch).toBeGreaterThan(-1);
        expect(before.slice(lastFetch)).toMatch(/if \(!res\?\.ok\) return;/);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});

