// Shared by the shift-type PUT and the activation POST (card #75).
// Editable columns. PUT is a partial update — only keys actually present in the
// request body are written, so omitting a field leaves it untouched (rather than
// resetting it to a default). The Settings UI sends the full object; other
// callers can safely PATCH a subset.
export const SHIFT_TYPE_EDITABLE_FIELDS = [
  "name", "code", "defaultHours", "defaultHoursWeekend", "defaultHoursHoliday",
  "countsTowardFte", "countsAsHolidayWork",
  "isLeave", "isPaid", "category", "color", "printBackgroundColor", "sortOrder",
  "schedulePriority", "isOffShift", "isFillShift", "weekendPaired", "holidayWeekendPaired", "spreadOverMonth", "evenAcrossMonths", "minGapDays", "minGapStrength",
  "ignoresWorkingDays", "autoSchedulable", "hotkey", "dedicatedColumn",
  "boldOnSchedule",
] as const;

// Accept only null or a #rrggbb hex string for the print background; any other value
// (malformed direct-API input) is coerced to null. The settings UI only emits valid hex.
export function sanitizePrintBg(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
}


// Card #260: "at least N days between two of this shift for one person". null = off; N is a
// whole number 2..60 (1 would mean nothing: two of a shift are always ≥ 1 day apart).
export const MIN_GAP_LIMITS = { min: 2, max: 60 } as const;
export const MIN_GAP_STRENGTHS = ["rule", "preference"] as const;
/** The error to answer 400 with, or null. Only checks the keys that are present. */
export function minGapError(data: Record<string, unknown>): string | null {
  if ("minGapDays" in data) {
    const v = data.minGapDays;
    if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= MIN_GAP_LIMITS.min && v <= MIN_GAP_LIMITS.max)) {
      return `Minimum days between two must be blank or a whole number between ${MIN_GAP_LIMITS.min} and ${MIN_GAP_LIMITS.max}`;
    }
  }
  if ("minGapStrength" in data && !(MIN_GAP_STRENGTHS as readonly unknown[]).includes(data.minGapStrength)) {
    return "Minimum days between two must be Hard or Prefer";
  }
  return null;
}
