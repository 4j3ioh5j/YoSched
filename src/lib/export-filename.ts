// Card #299: the year export's base file name. The Settings template (exportFileName,
// null = the built-in default) has {YEAR} filled in; the dialog lets the user edit the
// result. One rule set for the setting and the dialog, safe on Windows, macOS and Linux.

export const DEFAULT_EXPORT_FILE_NAME = "SCHEDULE_{YEAR}";
export const EXPORT_FILE_NAME_MAX = 100;

export function resolveExportFileName(template: string | null | undefined, year: number): string {
  const t = template && template.trim() ? template.trim() : DEFAULT_EXPORT_FILE_NAME;
  return t.replaceAll("{YEAR}", String(year));
}

/** null when the name is usable as a base file name, else a short reason. */
export function exportFileNameError(name: string): string | null {
  if (name.length === 0) return "Enter a file name.";
  if (name.length > EXPORT_FILE_NAME_MAX) return `Use at most ${EXPORT_FILE_NAME_MAX} characters.`;
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)) return 'Leave out \\ / : * ? " < > | and control characters.';
  if (/^[. ]|[. ]$/.test(name)) return "Do not start or end with a dot or a space.";
  return null;
}

/** Years to offer: those with data plus the current one, newest first. */
export function exportYearChoices(isoDates: readonly string[], currentYear: number): number[] {
  const years = new Set<number>([currentYear]);
  for (const d of isoDates) {
    const y = Number(d.slice(0, 4));
    if (Number.isInteger(y) && y > 1900 && y < 3000) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/** The dialog's name: it follows the year until the user types a name of their own. */
export type ExportNameState = { year: number; name: string; edited: boolean };

export function initExportName(template: string | null | undefined, year: number): ExportNameState {
  return { year, name: resolveExportFileName(template, year), edited: false };
}

export function exportNameSetYear(s: ExportNameState, template: string | null | undefined, year: number): ExportNameState {
  return s.edited ? { ...s, year } : { year, name: resolveExportFileName(template, year), edited: false };
}

/** An emptied field follows the year again. */
export function exportNameEdit(s: ExportNameState, name: string): ExportNameState {
  return { ...s, name, edited: name !== "" };
}
