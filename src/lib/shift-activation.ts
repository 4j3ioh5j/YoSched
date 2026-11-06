// Card #75: turning a shift's "Auto-schedule" on. Every shift used to be granted to every
// active staff member and every employment type when it was created, so turning one on made it
// eligible for nearly everyone. The activation panel decides instead, from department Settings:
//
//   people who have WORKED the shift (≥1 saved assignment of it, any date) → activationWorkedDefault
//   everyone else                                                         → activationNeverDefault
//   employment-type defaults for new hires                                → activationNewHireDefault
//
// and the person can override any row before saving. The write rewrites only this shift's
// column, for ACTIVE staff (inactive staff are untouched), under the eligibility lock, with a
// compare-and-set on a version of everything it reads. Rules / minimum targets / standing
// commitments of people it unticks are kept (hidden — build-auto-schedule-input makes them
// inert) so a re-tick or Undo brings them back.

import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { lockEligibility } from "@/lib/eligibility-write";

export type ActivationGroupDefault = "eligible" | "not_eligible" | "keep";
export const ACTIVATION_GROUP_DEFAULTS: readonly ActivationGroupDefault[] = ["eligible", "not_eligible", "keep"];
export type ActivationNewHireDefault = "keep" | "match" | "none" | "all";
export const ACTIVATION_NEW_HIRE_DEFAULTS: readonly ActivationNewHireDefault[] = ["keep", "match", "none", "all"];

export const DEFAULT_ACTIVATION_WORKED: ActivationGroupDefault = "eligible";
export const DEFAULT_ACTIVATION_NEVER: ActivationGroupDefault = "not_eligible";
export const DEFAULT_ACTIVATION_NEW_HIRE: ActivationNewHireDefault = "keep";

/** STRICT checks for user writes (reject anything else with 400). */
export const isActivationGroupDefault = (v: unknown): v is ActivationGroupDefault =>
  typeof v === "string" && (ACTIVATION_GROUP_DEFAULTS as readonly string[]).includes(v);
export const isActivationNewHireDefault = (v: unknown): v is ActivationNewHireDefault =>
  typeof v === "string" && (ACTIVATION_NEW_HIRE_DEFAULTS as readonly string[]).includes(v);

/** LENIENT parses for stored values. */
export const parseActivationWorked = (v: unknown): ActivationGroupDefault => (isActivationGroupDefault(v) ? v : DEFAULT_ACTIVATION_WORKED);
export const parseActivationNever = (v: unknown): ActivationGroupDefault => (isActivationGroupDefault(v) ? v : DEFAULT_ACTIVATION_NEVER);
export const parseActivationNewHire = (v: unknown): ActivationNewHireDefault => (isActivationNewHireDefault(v) ? v : DEFAULT_ACTIVATION_NEW_HIRE);

export type ActivationPerson = {
  id: string;
  initials: string;
  name: string;
  employmentTypeId: string;
  isAutoScheduled: boolean;
  eligibleNow: boolean;
  workedCount: number;
  lastWorked: string | null; // YYYY-MM-DD
  hasRules: boolean; // eligibility rules, minimum targets, standing commitments or hour overrides for this shift
};
export type ActivationType = { id: string; name: string; defaultNow: boolean };
export type ActivationState = {
  shiftTypeId: string;
  autoSchedulable: boolean;
  people: ActivationPerson[];
  types: ActivationType[];
  version: string;
};

/** Who starts ticked, from the department settings. */
export function initialEligible(p: Pick<ActivationPerson, "workedCount" | "eligibleNow">, worked: ActivationGroupDefault, never: ActivationGroupDefault): boolean {
  const rule = p.workedCount > 0 ? worked : never;
  return rule === "keep" ? p.eligibleNow : rule === "eligible";
}

/** Which employment types give the shift to new hires, from the setting and who is ticked. */
export function initialTypeDefault(
  t: Pick<ActivationType, "id" | "defaultNow">,
  rule: ActivationNewHireDefault,
  ticked: readonly Pick<ActivationPerson, "employmentTypeId">[],
): boolean {
  if (rule === "keep") return t.defaultNow;
  if (rule === "all") return true;
  if (rule === "none") return false;
  return ticked.some((p) => p.employmentTypeId === t.id);
}

// The version covers everything the write compares: the flag, the active roster, this shift's
// eligibility rows (active staff) and its employment-type defaults (all types).
export function activationVersion(v: { autoSchedulable: boolean; activeIds: readonly string[]; eligibleIds: readonly string[]; typeIds: readonly string[]; defaultTypeIds: readonly string[] }): string {
  const sorted = (xs: readonly string[]) => [...xs].sort().join(",");
  return createHash("sha256")
    .update([v.autoSchedulable ? "1" : "0", sorted(v.activeIds), sorted(v.eligibleIds), sorted(v.typeIds), sorted(v.defaultTypeIds)].join("|"))
    .digest("hex")
    .slice(0, 24);
}

type Reader = Pick<Prisma.TransactionClient, "shiftType" | "staff" | "staffEligibleShift" | "employmentType" | "employmentTypeDefaultShift" | "assignment" | "shiftEligibilityRule" | "shiftMinimumTarget" | "standingCommitment" | "staffShiftOverride">;

export async function readActivationState(db: Reader, shiftTypeId: string): Promise<ActivationState | null> {
  const shift = await db.shiftType.findUnique({ where: { id: shiftTypeId }, select: { id: true, autoSchedulable: true } });
  if (!shift) return null;
  const [staff, elig, types, defaults, worked, rules, targets, standing, overrides] = await Promise.all([
    db.staff.findMany({ where: { isActive: true }, select: { id: true, initials: true, name: true, employmentTypeId: true, isAutoScheduled: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { initials: "asc" }] }),
    db.staffEligibleShift.findMany({ where: { shiftTypeId }, select: { staffId: true } }),
    db.employmentType.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    db.employmentTypeDefaultShift.findMany({ where: { shiftTypeId }, select: { employmentTypeId: true } }),
    db.assignment.groupBy({ by: ["staffId"], where: { shiftTypeId }, _count: { _all: true }, _max: { date: true } }),
    db.shiftEligibilityRule.findMany({ where: { shiftTypeId }, select: { staffId: true } }),
    db.shiftMinimumTarget.findMany({ where: { shiftTypeId }, select: { staffId: true } }),
    db.standingCommitment.findMany({ where: { shiftTypeId }, select: { staffId: true } }),
    db.staffShiftOverride.findMany({ where: { shiftTypeId }, select: { staffId: true } }),
  ]);
  const eligible = new Set(elig.map((e) => e.staffId));
  const withRules = new Set([...rules, ...targets, ...standing, ...overrides].map((r) => r.staffId));
  const workedBy = new Map(worked.map((w) => [w.staffId, { n: w._count._all, last: w._max.date ? w._max.date.toISOString().slice(0, 10) : null }]));
  const defaultSet = new Set(defaults.map((d) => d.employmentTypeId));
  const people: ActivationPerson[] = staff.map((p) => ({
    id: p.id,
    initials: p.initials,
    name: p.name,
    employmentTypeId: p.employmentTypeId,
    isAutoScheduled: p.isAutoScheduled,
    eligibleNow: eligible.has(p.id),
    workedCount: workedBy.get(p.id)?.n ?? 0,
    lastWorked: workedBy.get(p.id)?.last ?? null,
    hasRules: withRules.has(p.id),
  }));
  const activeIds = staff.map((p) => p.id);
  return {
    shiftTypeId,
    autoSchedulable: shift.autoSchedulable,
    people,
    types: types.map((t) => ({ id: t.id, name: t.name, defaultNow: defaultSet.has(t.id) })),
    version: activationVersion({
      autoSchedulable: shift.autoSchedulable,
      activeIds,
      eligibleIds: activeIds.filter((id) => eligible.has(id)),
      typeIds: types.map((t) => t.id),
      defaultTypeIds: types.filter((t) => defaultSet.has(t.id)).map((t) => t.id),
    }),
  };
}

export class ActivationStale extends Error {
  constructor() {
    super("This shift's eligibility changed since the panel opened (someone else saved, or staff changed). Reload and try again.");
  }
}

export type ActivationWrite = {
  shiftTypeId: string;
  version: string;
  autoSchedulable: boolean;
  eligibleStaffIds: readonly string[];
  defaultEmploymentTypeIds: readonly string[];
  /** Other shift fields saved in the same write (already filtered to the editable ones). */
  shiftData?: Prisma.ShiftTypeUpdateInput;
};
export type ActivationResult = {
  /** What Undo sends back: the state before this write. */
  inverse: { autoSchedulable: boolean; eligibleStaffIds: string[]; defaultEmploymentTypeIds: string[] };
  state: ActivationState;
};

/**
 * Apply an activation (or its Undo) atomically: eligibility lock → re-read → compare the version →
 * write the flag, this shift's eligibility for ACTIVE staff, and its employment-type defaults.
 * Ids that are not active staff / existing types are ignored. Rules and the like are never deleted.
 */
export async function applyActivation(tx: Prisma.TransactionClient, w: ActivationWrite): Promise<ActivationResult | null> {
  await lockEligibility(tx);
  const before = await readActivationState(tx, w.shiftTypeId);
  if (!before) return null;
  if (before.version !== w.version) throw new ActivationStale();

  const want = new Set(w.eligibleStaffIds);
  const add = before.people.filter((p) => want.has(p.id) && !p.eligibleNow).map((p) => p.id);
  const remove = before.people.filter((p) => !want.has(p.id) && p.eligibleNow).map((p) => p.id);
  const wantTypes = new Set(w.defaultEmploymentTypeIds);
  const addT = before.types.filter((t) => wantTypes.has(t.id) && !t.defaultNow).map((t) => t.id);
  const removeT = before.types.filter((t) => !wantTypes.has(t.id) && t.defaultNow).map((t) => t.id);

  await tx.shiftType.update({ where: { id: w.shiftTypeId }, data: { ...(w.shiftData ?? {}), autoSchedulable: w.autoSchedulable } });
  if (remove.length > 0) await tx.staffEligibleShift.deleteMany({ where: { shiftTypeId: w.shiftTypeId, staffId: { in: remove } } });
  if (add.length > 0) await tx.staffEligibleShift.createMany({ data: add.map((staffId) => ({ staffId, shiftTypeId: w.shiftTypeId })) });
  if (removeT.length > 0) await tx.employmentTypeDefaultShift.deleteMany({ where: { shiftTypeId: w.shiftTypeId, employmentTypeId: { in: removeT } } });
  if (addT.length > 0) await tx.employmentTypeDefaultShift.createMany({ data: addT.map((employmentTypeId) => ({ employmentTypeId, shiftTypeId: w.shiftTypeId })) });

  const after = await readActivationState(tx, w.shiftTypeId);
  return {
    inverse: {
      autoSchedulable: before.autoSchedulable,
      eligibleStaffIds: before.people.filter((p) => p.eligibleNow).map((p) => p.id),
      defaultEmploymentTypeIds: before.types.filter((t) => t.defaultNow).map((t) => t.id),
    },
    state: after!,
  };
}
