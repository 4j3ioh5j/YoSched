// Card #320: printStampText (never called; it printed the computer's local time) was removed.
// Card #173: the "includes unsaved edits" notice no longer prints; instead the
// scheduler is asked before printing a month whose cells differ from its saved
// version. null = nothing to warn about, print straight away.
export function unsavedPrintWarning(versionNumber: number | null, modified: boolean): string | null {
  if (versionNumber === null || !modified) return null;
  return `This month has edits that are not saved in Version ${versionNumber}, so the printout will not match Version ${versionNumber}.\n\nPrint anyway?`;
}
