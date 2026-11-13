// Card #177: a soft "avoid B the day after A" rule, one row per pair.
export type FollowAvoidData = { id: string; sourceShiftId: string; avoidShiftId: string };

/** Whether the ticked avoid set differs from the saved rows of `sourceShiftId`. */
export function followAvoidsChanged(saved: FollowAvoidData[], sourceShiftId: string, checked: Set<string>): boolean {
  const before = new Set(saved.filter((r) => r.sourceShiftId === sourceShiftId).map((r) => r.avoidShiftId));
  return before.size !== checked.size || [...checked].some((id) => !before.has(id));
}
