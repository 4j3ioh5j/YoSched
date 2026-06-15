// Builds the "Time off / leave" chips for the My Requests modal. Kept pure (and out of
// the component) so the leave-vs-off rules are unit-testable — this is where a shift
// flagged BOTH isLeave and isOffShift (e.g. "X"/Off) previously got listed twice.

type AwayShift = { isLeave: boolean; isOffShift: boolean };

/**
 * The selectable "away" shifts for a request form, in display order.
 *
 * Leave TYPES (isLeave) are always offered, but the Off shift (isOffShift) is NOT a
 * leave type even when it also carries isLeave — so it is excluded from the leave list
 * and appended exactly once, and only when requesting a shift (`isRequest`), where
 * "I want this day off" is a valid ask. This guarantees no shift appears twice.
 */
export function awayShiftChoices<T extends AwayShift>(shiftTypes: T[], isRequest: boolean): T[] {
  const leaveTypes = shiftTypes.filter((s) => s.isLeave && !s.isOffShift);
  if (!isRequest) return leaveTypes;
  const offShift = shiftTypes.find((s) => s.isOffShift);
  return offShift ? [...leaveTypes, offShift] : leaveTypes;
}
