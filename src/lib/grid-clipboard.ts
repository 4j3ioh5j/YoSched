// Clipboard interchange between the schedule grid and spreadsheets (Excel/Sheets),
// which read and write tab-separated values on the clipboard. Pure string logic only —
// no DOM, no React — so the tricky orientation/ordering rules are unit-testable. The
// grid is dates=rows × staff=columns, and that orientation is preserved both ways.

const KEY_SEP = ":"; // cell key is `${staffId}:${date}`; staffId (cuid) and date (YYYY-MM-DD) never contain ":"

function splitKey(key: string): { staffId: string; date: string } | null {
  const i = key.indexOf(KEY_SEP);
  if (i < 0) return null;
  return { staffId: key.slice(0, i), date: key.slice(i + 1) };
}

/**
 * Values-only TSV for the selected cells, laid out to match the grid (dates as rows,
 * staff as columns). The block spans the bounding rectangle of the selection in grid
 * order; a cell contributes its code only if it is actually selected (other cells
 * inside the bounding box are left blank), so the rectangle Excel needs stays intact
 * without copying anything the user didn't select. Returns null when nothing usable is
 * selected.
 */
export function selectionToTsv(
  selectedKeys: Iterable<string>,
  opts: {
    dateOrder: string[];
    staffOrder: string[];
    codeAt: (staffId: string, date: string) => string | null | undefined;
  }
): string | null {
  const keys = new Set(selectedKeys);
  if (keys.size === 0) return null;

  const dateIndex = new Map(opts.dateOrder.map((d, i) => [d, i]));
  const staffIndex = new Map(opts.staffOrder.map((s, i) => [s, i]));

  // Bounding rectangle of the selection in grid coordinates. We track min/max indices
  // (NOT just the set of selected rows/cols) so skipped interior rows/columns are kept
  // as blank cells — otherwise a sparse selection like s1+s3 would collapse to adjacent
  // columns and land in the wrong Excel cells.
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const k of keys) {
    const cell = splitKey(k);
    if (!cell) continue;
    const r = dateIndex.get(cell.date);
    const c = staffIndex.get(cell.staffId);
    if (r === undefined || c === undefined) continue; // cell off the visible grid
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  if (maxR < 0 || maxC < 0) return null; // no selected cell maps onto the grid

  const rows = opts.dateOrder.slice(minR, maxR + 1);
  const cols = opts.staffOrder.slice(minC, maxC + 1);

  return rows
    .map((date) =>
      cols
        .map((staffId) => (keys.has(`${staffId}${KEY_SEP}${date}`) ? opts.codeAt(staffId, date) ?? "" : ""))
        .join("\t")
    )
    .join("\n");
}

/**
 * Parse clipboard text (as produced by Excel/Sheets/our own copy) into a row×column
 * grid of raw cell strings. Rows split on newlines (CRLF or LF), columns on tabs.
 * Spreadsheets append a trailing newline, so a single trailing empty line is dropped.
 * Cells are NOT trimmed here (the resolver does that) so the shape is preserved exactly.
 */
export function parseClipboardGrid(text: string): string[][] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return [];
  return lines.map((line) => line.split("\t"));
}

export type PasteResolution = {
  /** Cells to write, already resolved to shift type ids. */
  sets: { staffId: string; date: string; shiftTypeId: string }[];
  skippedUnknown: number; // code matched no shift type
  skippedLocked: number; // target cell is locked
  skippedBlank: number; // empty source cell (left unchanged — never clears)
  clipped: number; // fell past the right/bottom edge of the grid
};

/**
 * Positionally place a pasted block at an anchor cell (the active cell), filling down
 * and to the right — exactly how a spreadsheet paste behaves. Pure: the grid order,
 * code→id map, and lock test all come in as arguments. Blank source cells are SKIPPED
 * (paste never clears, so a partial block can't wipe assignments); unknown codes and
 * locked targets are skipped and counted; cells past the grid edge are clipped.
 */
export function resolvePaste(
  block: string[][],
  anchor: { dateIndex: number; staffIndex: number },
  opts: {
    dateOrder: string[];
    staffOrder: string[];
    codeToId: Map<string, string>; // keyed by UPPERCASE code
    isLocked: (staffId: string, date: string) => boolean;
  }
): PasteResolution {
  const sets: PasteResolution["sets"] = [];
  let skippedUnknown = 0, skippedLocked = 0, skippedBlank = 0, clipped = 0;

  for (let r = 0; r < block.length; r++) {
    const row = block[r];
    for (let c = 0; c < row.length; c++) {
      const di = anchor.dateIndex + r;
      const si = anchor.staffIndex + c;
      if (di >= opts.dateOrder.length || si >= opts.staffOrder.length) {
        clipped++;
        continue;
      }
      const code = row[c].trim();
      if (code === "") {
        skippedBlank++;
        continue;
      }
      const shiftTypeId = opts.codeToId.get(code.toUpperCase());
      if (!shiftTypeId) {
        skippedUnknown++;
        continue;
      }
      const date = opts.dateOrder[di];
      const staffId = opts.staffOrder[si];
      if (opts.isLocked(staffId, date)) {
        skippedLocked++;
        continue;
      }
      sets.push({ staffId, date, shiftTypeId });
    }
  }

  return { sets, skippedUnknown, skippedLocked, skippedBlank, clipped };
}

/**
 * One-line human summary of a paste, e.g. "12 cells set · 2 locked · 1 unknown code".
 * `extraLocked` folds in any additional locks the server caught that the client's local
 * state didn't know about. Only non-zero categories are shown.
 */
export function pasteSummary(
  appliedCount: number,
  r: Pick<PasteResolution, "skippedUnknown" | "skippedLocked" | "skippedBlank" | "clipped">,
  extraLocked = 0
): string {
  const parts = [`${appliedCount} cell${appliedCount === 1 ? "" : "s"} set`];
  const locked = r.skippedLocked + extraLocked;
  if (locked) parts.push(`${locked} locked`);
  if (r.skippedUnknown) parts.push(`${r.skippedUnknown} unknown code${r.skippedUnknown === 1 ? "" : "s"}`);
  if (r.clipped) parts.push(`${r.clipped} past edge`);
  if (r.skippedBlank) parts.push(`${r.skippedBlank} blank`);
  return parts.join(" · ");
}
