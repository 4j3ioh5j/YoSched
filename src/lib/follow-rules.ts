export type FollowRuleRow = {
  sourceShiftId: string;
  allowedShiftId: string | null;
  allowOffShifts: boolean;
  mode: string;
};

export type FollowRuleEntry = {
  shiftIds: Set<string>;
  allowOffShifts: boolean;
  mode: "allow" | "block";
};

export type FollowRuleMap = Map<string, FollowRuleEntry>;

export function buildFollowRuleMap(rules: FollowRuleRow[]): FollowRuleMap {
  const map: FollowRuleMap = new Map();
  for (const r of rules) {
    let entry = map.get(r.sourceShiftId);
    if (!entry) {
      entry = { shiftIds: new Set(), allowOffShifts: false, mode: (r.mode as "allow" | "block") || "allow" };
      map.set(r.sourceShiftId, entry);
    }
    if (r.allowedShiftId) entry.shiftIds.add(r.allowedShiftId);
    if (r.allowOffShifts) entry.allowOffShifts = true;
  }
  return map;
}

export function isShiftAllowedAfter(
  map: FollowRuleMap,
  sourceShiftId: string,
  candidateShiftId: string,
  candidateIsOff: boolean,
): boolean {
  const entry = map.get(sourceShiftId);
  if (!entry) return true;

  if (entry.mode === "block") {
    if (candidateIsOff && entry.allowOffShifts) return false;
    return !entry.shiftIds.has(candidateShiftId);
  }

  if (candidateIsOff && entry.allowOffShifts) return true;
  return entry.shiftIds.has(candidateShiftId);
}

export function isRecoveryOnly(map: FollowRuleMap, sourceShiftId: string): boolean {
  const entry = map.get(sourceShiftId);
  if (!entry) return false;
  if (entry.mode === "block") return false;
  return entry.allowOffShifts && entry.shiftIds.size === 0;
}
