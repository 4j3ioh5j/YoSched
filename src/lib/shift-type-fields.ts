// Shared by the shift-type PUT and the activation POST (card #75).
// Editable columns. PUT is a partial update — only keys actually present in the
// request body are written, so omitting a field leaves it untouched (rather than
// resetting it to a default). The Settings UI sends the full object; other
// callers can safely PATCH a subset.
export const SHIFT_TYPE_EDITABLE_FIELDS = [
  "name", "code", "defaultHours", "defaultHoursWeekend", "defaultHoursHoliday",
  "countsTowardFte", "countsAsHolidayWork",
  "isLeave", "isPaid", "category", "color", "printBackgroundColor", "sortOrder",
  "schedulePriority", "isOffShift", "isFillShift", "weekendPaired", "holidayWeekendPaired",
  "ignoresWorkingDays", "autoSchedulable", "hotkey", "dedicatedColumn",
  "boldOnSchedule",
] as const;

// Accept only null or a #rrggbb hex string for the print background; any other value
// (malformed direct-API input) is coerced to null. The settings UI only emits valid hex.
export function sanitizePrintBg(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}

