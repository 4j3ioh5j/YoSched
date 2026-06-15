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
