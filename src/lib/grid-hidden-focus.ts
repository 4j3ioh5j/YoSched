// Card #343: when the grid's shown staff change (the "Print columns" view hides a column after
// an edit, or the view is switched), nothing may stay pointed at a column that is not shown:
// the next shortcut, Delete or paste would otherwise write to a person you cannot see.
// Returns null when nothing needs to change, so callers set state only when it does.
export type HiddenFocusInput = {
  activeCol: string | null;
  selection: ReadonlySet<string>; // "staffId:date" keys
  anchorStaffId: string | null;
  pickerStaffId: string | null;
};
export type HiddenFocusPrune = {
  clearActiveCol: boolean;
  selection: Set<string> | null; // the kept cells, or null when the selection is unchanged
  clearAnchor: boolean;
  closePicker: boolean;
};

export function pruneHiddenFocus(shown: ReadonlySet<string>, s: HiddenFocusInput): HiddenFocusPrune | null {
  const hidden = (id: string | null) => id !== null && !shown.has(id);
  const clearActiveCol = hidden(s.activeCol);
  const clearAnchor = hidden(s.anchorStaffId);
  const closePicker = hidden(s.pickerStaffId);
  let selection: Set<string> | null = null;
  for (const key of s.selection) {
    if (!shown.has(key.slice(0, key.indexOf(":")))) {
      selection = new Set([...s.selection].filter((k) => shown.has(k.slice(0, k.indexOf(":")))));
      break;
    }
  }
  if (!clearActiveCol && !clearAnchor && !closePicker && selection === null) return null;
  return { clearActiveCol, selection, clearAnchor, closePicker };
}
