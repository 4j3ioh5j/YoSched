/**
 * CSV export for the Statistics data table. Pure + tested: the view only wires a
 * download. The CSV mirrors the columns currently visible in the table so the
 * export matches what the user sees.
 */

/** The subset of an equity table row the CSV needs (structurally compatible
 *  with the page's EquityRow). */
export type EquityCsvRow = {
  initials: string;
  name: string;
  employmentTypeName: string;
  ftePercentage: number;
  displayDeviation: { desirability: number };
  deviation: { desirability: number };
  holidayWorkCount: number;
  shiftCounts: Record<string, number>;
  shiftTally: Record<string, number>;
  totalHours: number;
  totalWorkDays: number;
  totalLeaveDays: number;
};

export type EquityCsvOptions = {
  showDesirability: boolean;
  showHoliday: boolean;
  activeShiftCodes: string[];
  showTallies: boolean;
  tallyCodes: string[];
};

/** Quote a CSV cell only when it contains a delimiter, quote, or newline. */
function csvCell(value: string | number): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join a 2D array into RFC-4180 CSV text (CRLF rows, minimal quoting). */
export function toCsvText(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Round to 2 decimals, returning a number (drops trailing zeros). */
function round2(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Build the header + data rows for the equity table CSV, matching the columns
 * the table shows for the given options. The desirability / opportunity-adjusted
 * columns use the same negated convention as the table (higher = more desirable).
 */
export function buildEquityCsvRows(rows: EquityCsvRow[], opts: EquityCsvOptions): (string | number)[][] {
  const header: string[] = ["Initials", "Name", "Type", "FTE%"];
  if (opts.showDesirability) header.push("Desirability", "Opp. Adj.");
  if (opts.showHoliday) header.push("Holidays");
  for (const code of opts.activeShiftCodes) header.push(code);
  header.push("Hours", "Work Days", "Leave Days");
  if (opts.showTallies) for (const code of opts.tallyCodes) header.push(`Tally ${code}`);

  const body = rows.map((r) => {
    const cells: (string | number)[] = [
      r.initials,
      r.name,
      r.employmentTypeName,
      Math.round(r.ftePercentage * 100),
    ];
    if (opts.showDesirability) {
      cells.push(round2(-r.displayDeviation.desirability), round2(-r.deviation.desirability));
    }
    if (opts.showHoliday) cells.push(r.holidayWorkCount);
    for (const code of opts.activeShiftCodes) cells.push(r.shiftCounts[code] || 0);
    cells.push(r.totalHours, r.totalWorkDays, r.totalLeaveDays);
    if (opts.showTallies) for (const code of opts.tallyCodes) cells.push(r.shiftTally[code] || 0);
    return cells;
  });

  return [header, ...body];
}
