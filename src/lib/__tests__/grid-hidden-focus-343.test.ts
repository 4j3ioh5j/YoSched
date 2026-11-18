import { describe, it, expect } from "vitest";
import { pruneHiddenFocus } from "@/lib/grid-hidden-focus";

// Card #343 r1 (Codex BLOCKED): in the "Print columns" view an edit can hide the column you are
// on (its last qualifying shift replaced). Nothing may stay pointed at a hidden column, or the
// next shortcut / Delete / paste writes to a person you cannot see.
describe("pruneHiddenFocus (card #343)", () => {
  const shown = new Set(["a", "c"]);
  it("returns null when everything points at shown columns", () => {
    expect(pruneHiddenFocus(shown, { activeCol: "a", selection: new Set(["a:2027-01-01", "c:2027-01-02"]), anchorStaffId: "c", pickerStaffId: "a" })).toBeNull();
    expect(pruneHiddenFocus(shown, { activeCol: null, selection: new Set(), anchorStaffId: null, pickerStaffId: null })).toBeNull();
  });
  it("clears a hidden active column, anchor and picker", () => {
    const r = pruneHiddenFocus(shown, { activeCol: "b", selection: new Set(), anchorStaffId: "b", pickerStaffId: "b" });
    expect(r).toEqual({ clearActiveCol: true, selection: null, clearAnchor: true, closePicker: true });
  });
  it("drops hidden cells from the selection and keeps the shown ones", () => {
    const r = pruneHiddenFocus(shown, { activeCol: "a", selection: new Set(["a:2027-01-01", "b:2027-01-01", "c:2027-01-01"]), anchorStaffId: "a", pickerStaffId: null });
    expect(r).toEqual({ clearActiveCol: false, selection: new Set(["a:2027-01-01", "c:2027-01-01"]), clearAnchor: false, closePicker: false });
  });
  it("two consecutive edits: once the column hides, the second edit has no hidden target", () => {
    // Edit 1 lands on b while shown; then b's column hides (shown loses b).
    let state = { activeCol: "b" as string | null, selection: new Set<string>(), anchorStaffId: "b" as string | null, pickerStaffId: null as string | null };
    const r = pruneHiddenFocus(new Set(["a", "c"]), state);
    expect(r?.clearActiveCol).toBe(true);
    state = { ...state, activeCol: null, anchorStaffId: null };
    // Edit 2's target set (what hotkeyAssign / Delete would use) is empty.
    const targets = state.selection.size > 0 ? [...state.selection] : state.activeCol ? [state.activeCol] : [];
    expect(targets).toEqual([]);
  });
});
