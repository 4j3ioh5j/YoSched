// Test helper: fixtures still declare a shift's per-day cap inline as `maxPerDay`
// (test-only field); the engine reads caps from staffingRequirements[].maxCount
// (Staffing Rules "Max", keyed by the shift's id), so runners convert with withDayCaps
// before calling it.
import type { AutoScheduleInput, ScheduleShiftType } from "../auto-scheduler";

export type TestShift = ScheduleShiftType & { maxPerDay?: number | null };
export const DAY_KEYS = ["0", "1", "2", "3", "4", "5", "6", "holiday"];

export function capRows(shiftTypeId: string, max: number, dayKeys: readonly string[] = DAY_KEYS) {
  return dayKeys.map((dayKey) => ({ shiftTypeId, dayKey, minCount: 0, maxCount: max }));
}

/** Merge each fixture shift's `maxPerDay` into staffingRequirements as maxCount on every day key. */
export function withDayCaps<T extends Pick<AutoScheduleInput, "shiftTypes" | "staffingRequirements">>(input: T): T {
  const reqs = [...(input.staffingRequirements ?? [])];
  for (const st of input.shiftTypes as TestShift[]) {
    if (st.maxPerDay == null) continue;
    for (const dayKey of DAY_KEYS) {
      const i = reqs.findIndex((r) => r.shiftTypeId === st.id && r.dayKey === dayKey);
      if (i >= 0) reqs[i] = { ...reqs[i], maxCount: reqs[i].maxCount ?? st.maxPerDay };
      else reqs.push({ shiftTypeId: st.id, dayKey, minCount: 0, maxCount: st.maxPerDay });
    }
  }
  return { ...input, staffingRequirements: reqs };
}
