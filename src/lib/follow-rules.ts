export type FollowRuleRow = {
  sourceShiftId: string;
  allowedShiftId: string | null;
  allowOffShifts: boolean;
};

export type FollowRuleEntry = {
  allowedIds: Set<string>;
  allowOffShifts: boolean;
};

export type FollowRuleMap = Map<string, FollowRuleEntry>;

export function buildFollowRuleMap(rules: FollowRuleRow[]): FollowRuleMap {
  const map: FollowRuleMap = new Map();
  for (const r of rules) {
    let entry = map.get(r.sourceShiftId);
    if (!entry) {
      entry = { allowedIds: new Set(), allowOffShifts: false };
      map.set(r.sourceShiftId, entry);
    }
    if (r.allowedShiftId) entry.allowedIds.add(r.allowedShiftId);
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
  if (candidateIsOff && entry.allowOffShifts) return true;
  return entry.allowedIds.has(candidateShiftId);
}

export function isRecoveryOnly(map: FollowRuleMap, sourceShiftId: string): boolean {
  const entry = map.get(sourceShiftId);
  if (!entry) return false;
  return entry.allowOffShifts && entry.allowedIds.size === 0;
}
