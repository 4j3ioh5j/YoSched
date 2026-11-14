// Card #209: weekend and holiday shading are Settings (SchedulingPreferences), never
// hard-coded colours. null = that shading is off.

export type DayShading = {
  printWeekendColor: string | null;
  printHolidayColor: string | null;
  screenHolidayColor: string | null;
};

export const DEFAULT_DAY_SHADING: DayShading = {
  printWeekendColor: "#EBEBEB",
  printHolidayColor: "#D0D0D0",
  screenHolidayColor: "#4A3410",
};

/** STRICT check for a user write: #RRGGBB only. */
export function isShadeColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Persisted read: a stored colour, explicit null (off) kept as null, anything else → null.
 *  Never re-enables shading the user switched off. */
export function parseShadeColor(v: unknown): string | null {
  return isShadeColor(v) ? v : null;
}

/** Row shade on the printed schedule: a holiday's colour wins; a holiday with no holiday
 *  colour on a weekend still gets the weekend colour; otherwise none. */
export function rowPrintShade(isWeekend: boolean, isHoliday: boolean, s: DayShading): string | null {
  if (isHoliday && s.printHolidayColor) return s.printHolidayColor;
  if (isWeekend && s.printWeekendColor) return s.printWeekendColor;
  return null;
}

/** On-screen tint of a holiday row (null = none). */
export function screenHolidayTint(isHoliday: boolean, s: DayShading): string | null {
  return isHoliday ? s.screenHolidayColor : null;
}

/** Shading from the stored preferences row. No row yet → the defaults; a row → its values,
 *  where an explicit null stays off (never replaced by a default). */
export function dayShadingFrom(row: { printWeekendColor?: string | null; printHolidayColor?: string | null; screenHolidayColor?: string | null } | null | undefined): DayShading {
  if (!row) return { ...DEFAULT_DAY_SHADING };
  return {
    printWeekendColor: parseShadeColor(row.printWeekendColor),
    printHolidayColor: parseShadeColor(row.printHolidayColor),
    screenHolidayColor: parseShadeColor(row.screenHolidayColor),
  };
}
