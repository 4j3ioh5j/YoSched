// Card #71: one place that decides a staff member's FTE % and pay-period hours target.
// What an employment type means comes from its settings (usesFtePercentage, allowsFixedHours,
// includedInFairness), never from its name, so renaming a type changes nothing but its label.

export type EmploymentTypeFlags = {
  usesFtePercentage: boolean;
  allowsFixedHours: boolean;
  includedInFairness: boolean;
  defaultFtePercentage: number;
};

export type StaffFteFields = {
  ftePercentage: number | null;
  fixedHoursPerPp: number | null;
};

/** The person's FTE %, or null when their type has no FTE %. */
export function effectiveFte(staff: StaffFteFields, type: EmploymentTypeFlags): number | null {
  if (!type.usesFtePercentage) return null;
  return staff.ftePercentage ?? type.defaultFtePercentage;
}

/** Fixed hours per pay period, or null when unchecked or the type doesn't allow them. */
export function effectiveFixedHours(staff: StaffFteFields, type: EmploymentTypeFlags): number | null {
  if (type.usesFtePercentage || !type.allowsFixedHours) return null;
  const h = staff.fixedHoursPerPp;
  return h != null && Number.isFinite(h) && h > 0 ? h : null;
}

/**
 * The person's hours target for a pay period whose standard hours are `ppTargetHours`,
 * or null when they have no target (no colouring, no under/over alerts).
 * Fixed hours are absolute: they are not scaled by the pay period's hours.
 */
export function staffPpTarget(fte: number | null, fixedHours: number | null, ppTargetHours: number): number | null {
  if (fte != null) return ppTargetHours * fte;
  if (fixedHours != null) return fixedHours;
  return null;
}

/** Valid fixed-hours value for the API: a number > 0 and <= 999. */
export function isValidFixedHours(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 999;
}

/**
 * The grid's PP +/- cell. No target → "–", neutral colour, no target in the tooltip.
 * With a target: green on target, red under, amber over (only once any hours are scheduled).
 */
export function ppDiffCell(hours: number, target: number | null): { label: string; colorClass: string; tip: string } {
  if (target == null) return { label: "–", colorClass: "text-slate-500", tip: `${hours}hrs (no hours target)` };
  const diff = hours - target;
  const diffLabel = diff >= 0 ? `+${diff}` : `${diff}`;
  let colorClass = "text-slate-500";
  if (hours > 0) {
    colorClass = Math.abs(diff) < 0.001 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-amber-400";
  }
  return { label: hours > 0 ? diffLabel : "–", colorClass, tip: `${hours}hrs / ${target}hrs target (${diffLabel})` };
}

export type StaffHoursWrite =
  | { ok: true; ftePercentage: number | undefined; fixedHoursPerPp: number | null | undefined }
  | { ok: false; error: string };

/**
 * Card #71: what the staff API stores for FTE % and fixed hours, decided by the person's
 * (new) employment type's settings. `undefined` = leave the stored value alone.
 * Values a type does not use are never destroyed on an ordinary save: the resolver ignores them, so
 * turning a type setting back on (or Undo) brings them back. They are only reset on create or a
 * change of employment type, where the old type's values have no meaning.
 *  - Type with an FTE %: the sent FTE % (a number >= 0), else the type default on create/type change.
 *  - Type without an FTE %: a sent FTE % is ignored (old cached clients may still send 1);
 *    0 on create/type change (Phase A: old code then also gives no hours target).
 *  - Fixed hours are written only when the type allows them: null = unchecked, a number must be
 *    > 0 and <= 999. Omitted (an old cached client) keeps the stored value.
 */
export function staffHoursWrite(args: {
  type: EmploymentTypeFlags;
  sentFte: unknown;
  hasFixedKey: boolean;
  sentFixed: unknown;
  /** true on create, or when the employment type changes */
  typeChangedOrNew: boolean;
}): StaffHoursWrite {
  const { type, sentFte, hasFixedKey, sentFixed, typeChangedOrNew } = args;
  const resetFixed = typeChangedOrNew ? null : undefined;
  if (type.usesFtePercentage) {
    const fte = typeof sentFte === "number" && Number.isFinite(sentFte) && sentFte >= 0
      ? sentFte
      : typeChangedOrNew ? type.defaultFtePercentage : undefined;
    return { ok: true, ftePercentage: fte, fixedHoursPerPp: resetFixed };
  }
  const fte = typeChangedOrNew ? 0 : undefined;
  if (!type.allowsFixedHours || !hasFixedKey) return { ok: true, ftePercentage: fte, fixedHoursPerPp: resetFixed };
  if (sentFixed === null) return { ok: true, ftePercentage: fte, fixedHoursPerPp: null };
  if (!isValidFixedHours(sentFixed)) {
    return { ok: false, error: "Fixed hours per pay period must be a number above 0 and at most 999." };
  }
  return { ok: true, ftePercentage: fte, fixedHoursPerPp: sentFixed };
}

export type TypeFlags = { usesFtePercentage: boolean; allowsFixedHours: boolean; includedInFairness: boolean };

export type TypeFlagsWrite = { ok: true; flags: TypeFlags } | { ok: false; error: string };

/**
 * Card #71: the employment-type API's flag write. Omitted keys keep the stored value (old cached
 * clients). An FTE % and fixed hours are mutually exclusive. Changing a setting never touches the
 * type's staff: values a setting turns off are ignored by the resolver, not deleted, so turning it
 * back on (or Undo) restores them exactly.
 */
export function typeFlagsWrite(args: { existing: TypeFlags | null; body: Record<string, unknown> }): TypeFlagsWrite {
  const { existing, body } = args;
  // Only the three flags: `existing` may be a whole stored row, and spreading it would write its
  // other columns (e.g. the old name) back over the caller's update.
  const flags: TypeFlags = existing
    ? { usesFtePercentage: existing.usesFtePercentage, allowsFixedHours: existing.allowsFixedHours, includedInFairness: existing.includedInFairness }
    : { usesFtePercentage: true, allowsFixedHours: false, includedInFairness: true };
  for (const k of ["usesFtePercentage", "allowsFixedHours", "includedInFairness"] as const) {
    if (!(k in body) || body[k] === undefined) continue;
    if (typeof body[k] !== "boolean") return { ok: false, error: `${k} must be true or false` };
    flags[k] = body[k] as boolean;
  }
  if (flags.usesFtePercentage && flags.allowsFixedHours) {
    return { ok: false, error: "A type can have an FTE % or fixed hours per pay period, not both." };
  }
  return { ok: true, flags };
}
