import { formatDate, type DateFormatKey } from "@/lib/date-format";

// Card #173: the printed schedule carries its own print date and time (24-hour,
// local), shown to the right of "Version n". The browser's own header/footer
// (URL, page title, date) is suppressed by the print CSS's zero page margin.
export function printStampText(now: Date, format: DateFormatKey): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `Printed ${formatDate(now, format)} ${hh}:${mm}`;
}

// Card #173: the "includes unsaved edits" notice no longer prints; instead the
// scheduler is asked before printing a month whose cells differ from its saved
// version. null = nothing to warn about, print straight away.
export function unsavedPrintWarning(versionNumber: number | null, modified: boolean): string | null {
  if (versionNumber === null || !modified) return null;
  return `This month has edits that are not saved in Version ${versionNumber}, so the printout will not match Version ${versionNumber}.\n\nPrint anyway?`;
}
